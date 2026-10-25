const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
let backend;
let baseUrl;
let tempRoot;

function request(url, options = {}) {
  return fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  }).then(async (response) => ({
    status: response.status,
    body: await response.json().catch(() => ({})),
  }));
}

async function waitForHealth(port) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Backend health check timed out');
}

function startMockModel() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      if (req.url.endsWith('/chat/completions')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            diagnosis: 'اصلاح تستی',
            patches: [{ filePath: 'test.js', search: 'throw new Error(\'broken\')', replace: 'console.log(\'fixed\')' }],
          }) } }],
        }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test.before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeswe-tests-'));
  const port = 31237;
  baseUrl = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, [path.join(root, 'dist', 'server.cjs')], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FORGESWE_DATA_DIR: path.join(tempRoot, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth(port);
});

test.after(() => {
  backend?.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('API health and bootstrap respond with persisted state', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const bootstrap = await request('/api/bootstrap');
  assert.equal(bootstrap.status, 200);
  assert.ok(Array.isArray(bootstrap.body.skills));
  assert.ok(Array.isArray(bootstrap.body.plans));
});

test('workspace file operations work and reject path traversal', async () => {
  const opened = await request('/api/workspace/open', { method: 'POST', body: JSON.stringify({ targetPath: tempRoot }) });
  assert.equal(opened.status, 200);
  const created = await request('/api/workspace/file', { method: 'POST', body: JSON.stringify({ filePath: 'safe.js', content: 'module.exports = 1;' }) });
  assert.equal(created.status, 200);
  assert.equal(fs.readFileSync(path.join(tempRoot, 'safe.js'), 'utf8'), 'module.exports = 1;');
  const traversal = await request('/api/workspace/file', { method: 'POST', body: JSON.stringify({ filePath: '../escape.txt', content: 'nope' }) });
  assert.equal(traversal.status, 400);
  assert.equal(fs.existsSync(path.join(path.dirname(tempRoot), 'escape.txt')), false);
});

test('dangerous commands are blocked and approval is command-bound', async () => {
  const blocked = await request('/api/workspace/exec', { method: 'POST', body: JSON.stringify({ command: 'git reset --hard HEAD' }) });
  assert.equal(blocked.status, 403);
  const approval = await request('/api/hitl/approve', { method: 'POST', body: JSON.stringify({ command: 'node -e "console.log(1)"' }) });
  assert.equal(approval.status, 200);
  const wrongCommand = await request('/api/workspace/exec', { method: 'POST', body: JSON.stringify({ command: 'node -e "console.log(2)"', approvalToken: approval.body.approvalToken }) });
  assert.equal(wrongCommand.status, 403);
});

test('self-correction applies a patch and verifies the command', async () => {
  const model = await startMockModel();
  try {
    const port = model.address().port;
    await request('/api/model/config', { method: 'POST', body: JSON.stringify({ provider: 'openai-compatible', modelName: 'mock', baseUrl: `http://127.0.0.1:${port}/v1` }) });
    fs.writeFileSync(path.join(tempRoot, 'test.js'), "throw new Error('broken')", 'utf8');
    const result = await request('/api/harness/self-correct', { method: 'POST', body: JSON.stringify({ errorOutput: 'broken', failedCommand: 'node test.js' }) });
    assert.equal(result.status, 200);
    assert.equal(result.body.resolved, true);
    assert.equal(result.body.testExitCode, 0);
  } finally {
    model.close();
  }
});

test('Electron entrypoint passes syntax and exposes backend readiness logic', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'electron', 'main.cjs')]);
  const source = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(source, /waitForBackend/);
  assert.match(source, /findFreePort/);
});
