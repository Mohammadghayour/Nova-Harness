import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { INITIAL_SKILLS } from './src/data/presets.ts';
import {
  HarnessPlan,
  HarnessSkill,
  RepoSymbolNode,
  SearchReplaceBlock,
  WorkspaceFile,
} from './src/types/harness.ts';

dotenv.config();

const execAsync = promisify(exec);
const PREFERRED_PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.FORGESWE_DATA_DIR || path.join(process.cwd(), '.forgeswe-data');
const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'snapshots.json');
let activeWorkspaceDir = path.resolve('/tmp/forgeswe-workspace');
let skillsState: HarnessSkill[] = loadJson<HarnessSkill[]>(SKILLS_FILE, structuredClone(INITIAL_SKILLS));
let plansState: HarnessPlan[] = loadJson<HarnessPlan[]>(PLANS_FILE, []);
const persistedSnapshots = loadJson<Record<string, Record<string, string>>>(SNAPSHOTS_FILE, {});

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function persistJson(filePath: string, value: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(temporaryPath, filePath);
}

// Track initial snapshot of files for diff view
const originalSnapshots: Map<string, string> = new Map();

function activateWorkspaceSnapshots(): void {
  originalSnapshots.clear();
  const saved = persistedSnapshots[activeWorkspaceDir] || {};
  for (const [relativePath, content] of Object.entries(saved)) {
    originalSnapshots.set(relativePath, content);
  }
}

function persistWorkspaceSnapshot(relativePath: string, content: string): void {
  if (!persistedSnapshots[activeWorkspaceDir]) persistedSnapshots[activeWorkspaceDir] = {};
  persistedSnapshots[activeWorkspaceDir][relativePath] = content;
  persistJson(SNAPSHOTS_FILE, persistedSnapshots);
}

activateWorkspaceSnapshots();
const pendingHitlApprovals = new Map<string, { expiresAt: number; commandHash: string }>();

function hashCommand(command: string): string {
  return crypto.createHash('sha256').update(command.trim()).digest('hex');
}

function issueHitlApproval(command: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  pendingHitlApprovals.set(token, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    commandHash: hashCommand(command),
  });
  return token;
}

function consumeHitlApproval(token: unknown, command: string): boolean {
  if (typeof token !== 'string') return false;
  const approval = pendingHitlApprovals.get(token);
  if (!approval || approval.expiresAt < Date.now()) {
    pendingHitlApprovals.delete(token);
    return false;
  }
  if (approval.commandHash !== hashCommand(command)) return false;
  pendingHitlApprovals.delete(token);
  return true;
}

const BLOCKED_COMMAND_PATTERNS = [
  /(^|[;&|])\s*(rm\s+-rf|del\s+\/s|rmdir\s+\/s|format\s+[a-z]:)/i,
  /(^|\s)(shutdown|restart-computer|stop-computer|reboot)(\s|$)/i,
  /(^|\s)(git\s+push\b[^\n]*--force|git\s+reset\s+--hard)(\s|$)/i,
  /(curl|wget|iwr)[^\n]*(\||;|&&)\s*(sh|bash|powershell)/i,
  /powershell[^\n]*-(enc|encodedcommand)\b/i,
];

function resolveWorkspacePath(relativePath: unknown): { relativePath: string; fullPath: string } | null {
  if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) return null;
  const normalizedInput = relativePath.trim().replace(/\\/g, '/');
  if (path.isAbsolute(normalizedInput)) return null;
  const fullPath = path.resolve(activeWorkspaceDir, normalizedInput);
  const relative = path.relative(activeWorkspaceDir, fullPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return { relativePath: relative.replace(/\\/g, '/'), fullPath };
}

function classifyCommand(command: string): 'safe' | 'approval' | 'blocked' {
  const normalized = command.trim();
  if (!normalized) return 'blocked';
  if (BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) return 'blocked';
  if (/(^|[;&|])\s*(npm\s+install|pnpm\s+add|yarn\s+add|pip\s+install|git\s+(push|commit|checkout|clean)|docker\s+(run|rm|system\s+prune)|python\s+-c|node\s+-e)/i.test(normalized)) {
    return 'approval';
  }
  return 'safe';
}

interface ServerModelConfig {
  provider: 'openai-compatible' | 'gemini';
  modelName: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
}

let modelConfig: ServerModelConfig = {
  provider: 'gemini',
  modelName: 'gemini-3.8-flash',
  baseUrl: '',
  apiKey: '',
  temperature: 0.2,
};

function getSafeModelConfigForClient() {
  const hasCustomKey = Boolean(modelConfig.apiKey && modelConfig.apiKey.length > 0);
  const maskedKey = hasCustomKey
    ? modelConfig.apiKey.length > 8
      ? `${modelConfig.apiKey.slice(0, 4)}...${modelConfig.apiKey.slice(-4)}`
      : '********'
    : '';

  return {
    provider: modelConfig.provider,
    modelName: modelConfig.modelName,
    baseUrl: modelConfig.baseUrl,
    hasCustomKey,
    maskedKey,
    temperature: modelConfig.temperature,
  };
}

function getGenAIClient(overrideKey?: string, overrideBaseUrl?: string): GoogleGenAI | null {
  const effectiveKey =
    overrideKey || modelConfig.apiKey || process.env.GEMINI_API_KEY;
  if (!effectiveKey || effectiveKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  const httpOptions: Record<string, unknown> = {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  };
  const effectiveBaseUrl =
    overrideBaseUrl !== undefined ? overrideBaseUrl : modelConfig.baseUrl;
  if (effectiveBaseUrl) {
    httpOptions.baseUrl = effectiveBaseUrl;
  }
  return new GoogleGenAI({
    apiKey: effectiveKey,
    httpOptions,
  });
}

function extractCleanJson(rawText: string): string {
  const trimmed = (rawText || '').trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

async function callOpenAICompatibleChat(params: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
}): Promise<string> {
  const cleanBase = (params.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const endpoint = cleanBase.endsWith('/chat/completions')
    ? cleanBase
    : `${cleanBase}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.apiKey) {
    headers['Authorization'] = `Bearer ${params.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.modelName,
      temperature: params.temperature,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`HTTP ${response.status} from ${endpoint}: ${errBody.slice(0, 250)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || '';
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.html')) return 'html';
  return 'javascript';
}

function ensureInitialWorkspace(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir);
  if (existing.length === 0) {
    const pkgJson = JSON.stringify(
      {
        name: 'workspace-app',
        version: '1.0.0',
        scripts: {
          test: 'node test.js',
        },
      },
      null,
      2
    );
    const indexJs = `// Workspace Entry File (index.js)\n\nfunction main() {\n  return "Ready";\n}\n\nmodule.exports = { main };\n`;
    fs.writeFileSync(path.join(dir, 'package.json'), pkgJson, 'utf-8');
    fs.writeFileSync(path.join(dir, 'index.js'), indexJs, 'utf-8');
    originalSnapshots.set('package.json', pkgJson);
    originalSnapshots.set('index.js', indexJs);
  }
}

ensureInitialWorkspace(activeWorkspaceDir);

function readWorkspaceFiles(dir: string, baseDir = dir): WorkspaceFile[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: WorkspaceFile[] = [];

  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name.startsWith('.')
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      results.push(...readWorkspaceFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 250 * 1024) continue;
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (!originalSnapshots.has(relPath)) {
          originalSnapshots.set(relPath, content);
          persistWorkspaceSnapshot(relPath, content);
        }
        results.push({
          path: relPath,
          name: entry.name,
          language: detectLanguage(relPath),
          content,
          originalContent: originalSnapshots.get(relPath) ?? content,
          lastModified: stat.mtime.toISOString(),
        });
      } catch {
        // Ignore unreadable files
      }
    }
  }
  return results;
}

function extractRepoMap(files: WorkspaceFile[]): RepoSymbolNode[] {
  return files.map((file) => {
    const lines = file.content.split('\n');
    const classes: string[] = [];
    const functions: string[] = [];
    const imports: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const classMatch = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
      if (classMatch) classes.push(classMatch[1]);

      const fnMatch =
        trimmed.match(/^(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/) ||
        trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/) ||
        trimmed.match(/^const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
      if (fnMatch) {
        functions.push(`${fnMatch[1]}(${fnMatch[2]})`);
      }

      const reqMatch =
        trimmed.match(/require\(["']([^"']+)["']\)/) ||
        trimmed.match(/from\s+["']([^"']+)["']/);
      if (reqMatch) imports.push(reqMatch[1]);
    }

    return {
      filePath: file.path,
      language: file.language,
      lineCount: lines.length,
      classes,
      functions,
      imports,
    };
  });
}

function applySearchReplace(
  original: string,
  search: string,
  replace: string
): { success: boolean; newContent: string; error?: string } {
  const normOriginal = original.replace(/\r\n/g, '\n');
  const normSearch = (search || '').replace(/\r\n/g, '\n').trim();
  const normReplace = (replace || '').replace(/\r\n/g, '\n');

  if (!normSearch || !normOriginal.trim()) {
    return { success: true, newContent: normReplace };
  }

  if (normOriginal.includes(normSearch)) {
    return {
      success: true,
      newContent: normOriginal.replace(normSearch, normReplace),
    };
  }

  const origLines = normOriginal.split('\n');
  const searchLines = normSearch.split('\n').map((l) => l.trim());

  if (searchLines.length > 0) {
    for (let i = 0; i <= origLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (origLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        const before = origLines.slice(0, i);
        const after = origLines.slice(i + searchLines.length);
        return {
          success: true,
          newContent: [...before, normReplace, ...after].join('\n'),
        };
      }
    }
  }

  return {
    success: false,
    newContent: original,
    error: 'بلوک SEARCH در فایل هدف پیدا نشد. لطفاً خطوط کد را بررسی یا ویرایش کنید.',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // 1. Bootstrap current workspace, skills & model config
  app.get('/api/bootstrap', (_req, res) => {
    const files = readWorkspaceFiles(activeWorkspaceDir);
    res.json({
      workspace: {
        workspacePath: activeWorkspaceDir,
        files,
      },
      repoMap: extractRepoMap(files),
      skills: skillsState,
      modelConfig: getSafeModelConfigForClient(),
      plans: plansState,
    });
  });

  app.post('/api/harness/plan/:planId/rollback', (req, res) => {
    const plan = plansState.find((item) => item.id === req.params.planId);
    if (!plan) {
      res.status(404).json({ error: 'پلن پیدا نشد.' });
      return;
    }
    // Rollback is intentionally explicit: restore only files recorded by the plan's patches.
    for (const step of plan.steps) {
      if (!step.patch) continue;
      const resolvedPath = resolveWorkspacePath(step.patch.filePath);
      if (!resolvedPath) continue;
      const snapshot = originalSnapshots.get(resolvedPath.relativePath);
      if (snapshot === undefined) continue;
      if (snapshot === '') {
        if (fs.existsSync(resolvedPath.fullPath)) fs.unlinkSync(resolvedPath.fullPath);
      } else {
        fs.writeFileSync(resolvedPath.fullPath, snapshot, 'utf-8');
      }
    }
    plan.status = 'failed';
    plansState = plansState.map((item) => (item.id === plan.id ? plan : item));
    persistJson(PLANS_FILE, plansState);
    res.json({ success: true, plan, workspace: { workspacePath: activeWorkspaceDir, files: readWorkspaceFiles(activeWorkspaceDir) } });
  });

  app.post('/api/harness/plan/:planId/finalize', (req, res) => {
    const plan = plansState.find((item) => item.id === req.params.planId);
    if (!plan) {
      res.status(404).json({ error: 'پلن پیدا نشد.' });
      return;
    }
    if (plan.steps.some((step) => step.status !== 'completed')) {
      res.status(409).json({ error: 'همه گام‌ها باید قبل از تأیید نهایی موفق شوند.' });
      return;
    }
    plan.status = 'completed';
    plansState = plansState.map((item) => (item.id === plan.id ? plan : item));
    persistJson(PLANS_FILE, plansState);
    res.json({ success: true, plan });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'forgeswe-coding-harness' });
  });

  // Model settings endpoints
  app.get('/api/model/config', (_req, res) => {
    res.json({ config: getSafeModelConfigForClient() });
  });

  app.post('/api/model/config', (req, res) => {
    const { provider, modelName, baseUrl, apiKey, temperature } = req.body as Partial<ServerModelConfig>;
    if (provider === 'openai-compatible' || provider === 'gemini') {
      modelConfig.provider = provider;
    }
    if (typeof modelName === 'string' && modelName.trim()) {
      modelConfig.modelName = modelName.trim();
    }
    if (typeof baseUrl === 'string') {
      modelConfig.baseUrl = baseUrl.trim();
    }
    if (typeof apiKey === 'string' && apiKey.trim()) {
      modelConfig.apiKey = apiKey.trim();
    }
    if (typeof temperature === 'number') {
      modelConfig.temperature = Math.max(0, Math.min(1, temperature));
    }
    res.json({ success: true, config: getSafeModelConfigForClient() });
  });

  // Test Connection to configured or draft Model Provider
  app.post('/api/model/test', async (req, res) => {
    const { provider, modelName, baseUrl, apiKey, temperature } = req.body as Partial<ServerModelConfig>;
    const testProvider = provider || modelConfig.provider;
    const testModel = (modelName || modelConfig.modelName || 'gemini-3.8-flash').trim();
    const testBaseUrl = (baseUrl !== undefined ? baseUrl : modelConfig.baseUrl).trim();
    const testKey = (apiKey || modelConfig.apiKey || process.env.GEMINI_API_KEY || '').trim();

    try {
      if (testProvider === 'openai-compatible') {
        const reply = await callOpenAICompatibleChat({
          baseUrl: testBaseUrl || 'https://api.openai.com/v1',
          apiKey: testKey,
          modelName: testModel,
          systemPrompt: 'Reply with a short confirmation.',
          userPrompt: 'Ping',
          temperature: temperature ?? 0.2,
        });
        res.json({
          ok: true,
          message: `اتصال به پروایدر (${testModel}) موفق بود. پاسخ: ${reply.slice(0, 80)}`,
        });
        return;
      }

      const ai = getGenAIClient(testKey, testBaseUrl);
      if (!ai) {
        res.status(400).json({
          ok: false,
          error: 'کلید API وارد نشده است.',
        });
        return;
      }
      const response = await ai.models.generateContent({
        model: testModel,
        contents: 'Say OK',
      });
      res.json({
        ok: true,
        message: `اتصال به مدل ${testModel} با موفقیت برقرار شد (${(response.text || 'OK').trim().slice(0, 40)}).`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطا در اتصال به مدل';
      res.status(400).json({ ok: false, error: msg });
    }
  });

  // 2. Open or switch local workspace directory path
  app.post('/api/workspace/open', (req, res) => {
    const { targetPath } = req.body as { targetPath: string };
    if (!targetPath || !targetPath.trim()) {
      res.status(400).json({ error: 'مسیر پوشه نامعتبر است.' });
      return;
    }
    try {
      const resolved = path.resolve(targetPath.trim());
      fs.mkdirSync(resolved, { recursive: true });
      activeWorkspaceDir = resolved;
      activateWorkspaceSnapshots();
      const files = readWorkspaceFiles(activeWorkspaceDir);
      res.json({
        workspace: {
          workspacePath: activeWorkspaceDir,
          files,
        },
        repoMap: extractRepoMap(files),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطا در باز کردن پوشه';
      res.status(400).json({ error: msg });
    }
  });

  // 3. Import uploaded files from user's system into active workspace
  app.post('/api/workspace/import', (req, res) => {
    const { importedFiles } = req.body as {
      importedFiles: Array<{ path: string; content: string }>;
    };
    if (!Array.isArray(importedFiles)) {
      res.status(400).json({ error: 'فرمت فایل‌های ورودی نامعتبر است.' });
      return;
    }

    for (const item of importedFiles) {
      const resolvedPath = resolveWorkspacePath(item.path);
      if (!resolvedPath) {
        res.status(400).json({ error: 'مسیر فایل خارج از workspace یا نامعتبر است.' });
        return;
      }
      const { relativePath: safeRel, fullPath } = resolvedPath;
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, item.content, 'utf-8');
      originalSnapshots.set(safeRel, item.content);
      persistWorkspaceSnapshot(safeRel, item.content);
    }

    const files = readWorkspaceFiles(activeWorkspaceDir);
    res.json({
      workspace: {
        workspacePath: activeWorkspaceDir,
        files,
      },
      repoMap: extractRepoMap(files),
    });
  });

  // 4. Save or create a single file in workspace
  app.post('/api/workspace/file', (req, res) => {
    const { filePath, content } = req.body as { filePath: string; content: string };
    if (!filePath || !filePath.trim()) {
      res.status(400).json({ error: 'نام فایل الزامی است.' });
      return;
    }
    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      res.status(400).json({ error: 'مسیر فایل خارج از workspace یا نامعتبر است.' });
      return;
    }
    const { relativePath: safeRel, fullPath } = resolvedPath;
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (!fs.existsSync(fullPath)) {
      originalSnapshots.set(safeRel, content);
      persistWorkspaceSnapshot(safeRel, content);
    }
    fs.writeFileSync(fullPath, content, 'utf-8');

    const files = readWorkspaceFiles(activeWorkspaceDir);
    res.json({
      workspace: {
        workspacePath: activeWorkspaceDir,
        files,
      },
      repoMap: extractRepoMap(files),
    });
  });

  // 5. Delete a file from workspace
  app.delete('/api/workspace/file', (req, res) => {
    const { filePath } = req.body as { filePath: string };
    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      res.status(400).json({ error: 'مسیر فایل خارج از workspace یا نامعتبر است.' });
      return;
    }
    const { relativePath: safeRel, fullPath } = resolvedPath;
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      originalSnapshots.delete(safeRel);
    }
    const files = readWorkspaceFiles(activeWorkspaceDir);
    res.json({
      workspace: {
        workspacePath: activeWorkspaceDir,
        files,
      },
      repoMap: extractRepoMap(files),
    });
  });

  // 6. Apply Aider-style SEARCH/REPLACE patch (or create new file) with SWE-agent Linter Guard
  app.post('/api/workspace/patch', async (req, res) => {
    const { patch, approvalToken } = req.body as {
      patch: SearchReplaceBlock;
      approvalToken?: string;
    };
    if (!consumeHitlApproval(approvalToken, `PATCH:${patch.filePath}`)) {
      res.status(403).json({ error: 'تأیید HITL معتبر برای اعمال تغییر فایل وجود ندارد.' });
      return;
    }
    if (!patch || !patch.filePath) {
      res.status(400).json({ error: 'پچ نامعتبر است.' });
      return;
    }

    const resolvedPath = resolveWorkspacePath(patch.filePath);
    if (!resolvedPath) {
      res.status(400).json({ error: 'مسیر فایل خارج از workspace یا نامعتبر است.' });
      return;
    }
    const { relativePath: safeRel, fullPath } = resolvedPath;
    const fileExists = fs.existsSync(fullPath);
    const previousContent = fileExists ? fs.readFileSync(fullPath, 'utf-8') : '';

    if (!fileExists) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      originalSnapshots.set(safeRel, '');
      persistWorkspaceSnapshot(safeRel, '');
    }

    const result = applySearchReplace(previousContent, patch.search, patch.replace);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    fs.writeFileSync(fullPath, result.newContent, 'utf-8');

    let syntaxCheckOutput = 'Syntax OK';
    let syntaxValid = true;

    if (safeRel.endsWith('.js') || safeRel.endsWith('.cjs') || safeRel.endsWith('.mjs')) {
      try {
        await execAsync(`node --check "${safeRel}"`, {
          cwd: activeWorkspaceDir,
          timeout: 5000,
        });
        syntaxCheckOutput = `Syntax OK (node --check ${safeRel})`;
      } catch (err: unknown) {
        const execErr = err as { stderr?: string; message?: string };
        syntaxValid = false;
        syntaxCheckOutput = execErr.stderr || execErr.message || 'SyntaxError';
        if (fileExists) {
          fs.writeFileSync(fullPath, previousContent, 'utf-8');
        }
      }
    }

    const files = readWorkspaceFiles(activeWorkspaceDir);
    res.json({
      success: syntaxValid,
      syntaxCheckOutput,
      workspace: {
        workspacePath: activeWorkspaceDir,
        files,
      },
      repoMap: extractRepoMap(files),
    });
  });

  app.post('/api/hitl/approve', (req, res) => {
    const { command } = req.body as { command?: string };
    if (!command || classifyCommand(command) === 'blocked') {
      res.status(400).json({ error: 'دستور خالی یا مسدود قابل تأیید نیست.' });
      return;
    }
    res.json({ approvalToken: issueHitlApproval(command), expiresInSeconds: 300 });
  });

  // 7. Execute real terminal command inside activeWorkspaceDir
  app.post('/api/workspace/exec', async (req, res) => {
    const { command, requiresApproval, approvalToken } = req.body as {
      command: string;
      requiresApproval?: boolean;
      approvalToken?: string;
    };
    const classification = classifyCommand(command);
    if (classification === 'blocked') {
      res.status(403).json({ error: 'این دستور به دلیل خطر بالقوه مسدود شده است.', exitCode: 126 });
      return;
    }
    if ((classification === 'approval' || requiresApproval) && !consumeHitlApproval(approvalToken, command)) {
      res.status(403).json({
        error: 'این دستور نیازمند تأیید HITL معتبر برای همین دستور است.',
        exitCode: 126,
      });
      return;
    }
    const startTime = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: activeWorkspaceDir,
        timeout: 15000,
      });
      const files = readWorkspaceFiles(activeWorkspaceDir);
      res.json({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        durationMs: Date.now() - startTime,
        workspace: {
          workspacePath: activeWorkspaceDir,
          files,
        },
        repoMap: extractRepoMap(files),
      });
    } catch (err: unknown) {
      const execErr = err as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      const files = readWorkspaceFiles(activeWorkspaceDir);
      res.json({
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || 'Command failed',
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
        durationMs: Date.now() - startTime,
        workspace: {
          workspacePath: activeWorkspaceDir,
          files,
        },
        repoMap: extractRepoMap(files),
      });
    }
  });

  // 8. Manage Modular Skills (toggle, add custom skill)
  app.post('/api/skills/toggle', (req, res) => {
    const { skillId } = req.body as { skillId: string };
    skillsState = skillsState.map((s) =>
      s.id === skillId ? { ...s, enabled: !s.enabled } : s
    );
    persistJson(SKILLS_FILE, skillsState);
    res.json({ skills: skillsState });
  });

  app.post('/api/skills/add', (req, res) => {
    const { skill } = req.body as { skill: HarnessSkill };
    skillsState = [skill, ...skillsState];
    persistJson(SKILLS_FILE, skillsState);
    res.json({ skills: skillsState });
  });

  // 9. Generate Multi-Step Execution Plan (supports both Gemini SDK & OpenAI-Compatible providers)
  app.post('/api/harness/plan', async (req, res) => {
    const { taskPrompt } = req.body as { taskPrompt: string };
    const files = readWorkspaceFiles(activeWorkspaceDir);
    const repoMap = extractRepoMap(files);
    const enabledSkills = skillsState.filter((s) => s.enabled);

    try {
      const filesContext = files
        .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
        .join('\n\n');

      const systemPrompt = `You are ForgeSWE Architect, an autonomous Coding Harness combining Aider's SEARCH/REPLACE surgical editing, SWE-agent's modular ACI skills, and Agentless hierarchical localization.
Analyze the user's coding task, the current RepoMap, and the workspace files.
Break the task into logical, sequential steps ('edit', 'command', 'test', 'skill').
Rules:
1. Write step titles, descriptions, and architectSummary in fluent Persian.
2. For any file creation or modification, use step type 'edit' and provide a 'patch' object:
   - If modifying an existing file, 'search' MUST contain the exact existing lines from that file to replace, and 'replace' contains the new lines.
   - If creating a new file or replacing an empty file, set 'search' to "" and put the full file code in 'replace'.
3. Include a verification step (type 'test' or 'command', e.g., 'node <test_file>.js' or 'npm test') to verify that the code runs with Exit Code 0.
4. Set 'requiresApproval' to true for file edits ('edit') or high-risk commands.
5. Respond ONLY with a valid JSON object matching:
{
  "architectSummary": "string",
  "localizedFiles": ["string"],
  "steps": [
    {
      "title": "string",
      "description": "string",
      "type": "edit | command | test | skill",
      "targetFile": "string",
      "command": "string",
      "skillId": "string",
      "riskLevel": "low | medium | high",
      "requiresApproval": true,
      "patch": { "filePath": "string", "search": "string", "replace": "string", "explanation": "string" }
    }
  ]
}`;

      const userPrompt = `User Task: ${taskPrompt}\n\nWorkspace Path: ${activeWorkspaceDir}\n\nRepoMap: ${JSON.stringify(
        repoMap
      )}\n\nEnabled Skills: ${JSON.stringify(
        enabledSkills.map((s) => ({ id: s.id, name: s.name, description: s.description }))
      )}\n\nCurrent Workspace Files:\n${filesContext || '(Empty Workspace)'}`;

      let rawJsonText = '';

      if (modelConfig.provider === 'openai-compatible') {
        const rawReply = await callOpenAICompatibleChat({
          baseUrl: modelConfig.baseUrl,
          apiKey: modelConfig.apiKey,
          modelName: modelConfig.modelName,
          systemPrompt,
          userPrompt,
          temperature: modelConfig.temperature,
        });
        rawJsonText = extractCleanJson(rawReply);
      } else {
        const ai = getGenAIClient();
        if (!ai) {
          res.status(500).json({
            error: 'کلید API تنظیم نشده است. لطفاً از بخش تنظیمات مدل، کلید خود را وارد کنید.',
          });
          return;
        }
        const response = await ai.models.generateContent({
          model: modelConfig.modelName || 'gemini-3.8-flash',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            temperature: modelConfig.temperature,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                architectSummary: { type: Type.STRING },
                localizedFiles: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                steps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      description: { type: Type.STRING },
                      type: { type: Type.STRING },
                      targetFile: { type: Type.STRING },
                      command: { type: Type.STRING },
                      skillId: { type: Type.STRING },
                      riskLevel: { type: Type.STRING },
                      requiresApproval: { type: Type.BOOLEAN },
                      patch: {
                        type: Type.OBJECT,
                        properties: {
                          filePath: { type: Type.STRING },
                          search: { type: Type.STRING },
                          replace: { type: Type.STRING },
                          explanation: { type: Type.STRING },
                        },
                      },
                    },
                    required: ['title', 'description', 'type', 'riskLevel', 'requiresApproval'],
                  },
                },
              },
              required: ['architectSummary', 'localizedFiles', 'steps'],
            },
          },
        });
        rawJsonText = extractCleanJson(response.text || '{}');
      }

      const parsed = JSON.parse(rawJsonText || '{}');

      const plan: HarnessPlan = {
        id: `plan-${Date.now()}`,
        taskPrompt,
        createdAt: new Date().toISOString(),
        architectSummary: parsed.architectSummary || 'تحلیل معماری انجام شد.',
        localizedFiles: parsed.localizedFiles || [],
        status: 'ready',
        steps: (parsed.steps || []).map((s: Record<string, unknown>, idx: number) => ({
          id: `step-${idx + 1}`,
          index: idx + 1,
          title: String(s.title || `گام ${idx + 1}`),
          description: String(s.description || ''),
          type: (['analyze', 'edit', 'command', 'test', 'skill'].includes(String(s.type))
            ? s.type
            : s.patch
            ? 'edit'
            : 'command') as HarnessPlan['steps'][0]['type'],
          targetFile: s.targetFile ? String(s.targetFile) : undefined,
          command: s.command ? String(s.command) : undefined,
          skillId: s.skillId ? String(s.skillId) : undefined,
          riskLevel: (['low', 'medium', 'high'].includes(String(s.riskLevel))
            ? s.riskLevel
            : 'medium') as 'low' | 'medium' | 'high',
          requiresApproval: Boolean(s.requiresApproval ?? (s.type === 'edit')),
          status: 'pending',
          patch:
            s.patch &&
            typeof s.patch === 'object' &&
            typeof (s.patch as SearchReplaceBlock).filePath === 'string'
              ? {
                  filePath: (s.patch as SearchReplaceBlock).filePath,
                  search: (s.patch as SearchReplaceBlock).search || '',
                  replace: (s.patch as SearchReplaceBlock).replace || '',
                  explanation: (s.patch as SearchReplaceBlock).explanation || '',
                }
              : undefined,
        })),
      };

      plansState = [plan, ...plansState.filter((savedPlan) => savedPlan.id !== plan.id)];
      persistJson(PLANS_FILE, plansState);

      res.json({ plan });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'خطا در ارتباط با مدل زبانی';
      res.status(500).json({ error: msg });
    }
  });

  // 10. Automated Self-Correction Loop Endpoint (supports both Gemini SDK & OpenAI-Compatible providers)
  app.post('/api/harness/self-correct', async (req, res) => {
    const { errorOutput, failedCommand } = req.body as {
      errorOutput: string;
      failedCommand?: string;
    };
    const files = readWorkspaceFiles(activeWorkspaceDir);

    try {
      const filesContext = files
        .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
        .join('\n\n');

      const systemPrompt = `You are ForgeSWE Self-Correction Engine. Diagnose the terminal/test error in Persian and return ONLY a JSON object with exact SEARCH/REPLACE patches:
{
  "diagnosis": "string",
  "patches": [
    { "filePath": "string", "search": "string", "replace": "string", "explanation": "string" }
  ]
}`;
      const userPrompt = `Command/Test Failed (${failedCommand || 'node test.js'}):\n${errorOutput}\n\nCurrent Workspace Files:\n${filesContext}\n\nDiagnose the root cause in Persian and provide exact SEARCH/REPLACE patches to fix the error so the command succeeds with exit code 0. If replacing an entire file or creating a missing file, set 'search' to "".`;

      let rawJsonText = '';

      if (modelConfig.provider === 'openai-compatible') {
        const rawReply = await callOpenAICompatibleChat({
          baseUrl: modelConfig.baseUrl,
          apiKey: modelConfig.apiKey,
          modelName: modelConfig.modelName,
          systemPrompt,
          userPrompt,
          temperature: modelConfig.temperature,
        });
        rawJsonText = extractCleanJson(rawReply);
      } else {
        const ai = getGenAIClient();
        if (!ai) {
          res.status(500).json({ error: 'کلید API تنظیم نشده است.' });
          return;
        }
        const response = await ai.models.generateContent({
          model: modelConfig.modelName || 'gemini-3.8-flash',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            temperature: modelConfig.temperature,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                diagnosis: { type: Type.STRING },
                patches: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      filePath: { type: Type.STRING },
                      search: { type: Type.STRING },
                      replace: { type: Type.STRING },
                      explanation: { type: Type.STRING },
                    },
                    required: ['filePath', 'search', 'replace'],
                  },
                },
              },
              required: ['diagnosis', 'patches'],
            },
          },
        });
        rawJsonText = extractCleanJson(response.text || '{}');
      }

      const parsed = JSON.parse(rawJsonText || '{}');
      const diagnosis = parsed.diagnosis || 'تحلیل خودکار خطا و اصلاح کد انجام شد.';
      const patches: SearchReplaceBlock[] = parsed.patches || [];

      const appliedPatches: SearchReplaceBlock[] = [];
      for (const p of patches) {
        const resolvedPath = resolveWorkspacePath(p.filePath);
        if (!resolvedPath) continue;
        const { relativePath: safeRel, fullPath } = resolvedPath;
        const currentContent = fs.existsSync(fullPath)
          ? fs.readFileSync(fullPath, 'utf-8')
          : '';
        const resPatch = applySearchReplace(currentContent, p.search, p.replace);
        if (resPatch.success) {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, resPatch.newContent, 'utf-8');
          appliedPatches.push(p);
        }
      }

      const cmdToVerify = failedCommand || 'npm test';
      let testExitCode = 0;
      let testOutput = '';
      try {
        const { stdout, stderr } = await execAsync(cmdToVerify, {
          cwd: activeWorkspaceDir,
          timeout: 10000,
        });
        testOutput = (stdout || '') + (stderr || '');
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; code?: number };
        testExitCode = typeof execErr.code === 'number' ? execErr.code : 1;
        testOutput = (execErr.stdout || '') + '\n' + (execErr.stderr || '');
      }

      const updatedFiles = readWorkspaceFiles(activeWorkspaceDir);
      res.json({
        diagnosis,
        appliedPatches,
        testExitCode,
        testOutput,
        resolved: testExitCode === 0,
        workspace: {
          workspacePath: activeWorkspaceDir,
          files: updatedFiles,
        },
        repoMap: extractRepoMap(updatedFiles),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطا در چرخه اصلاح خودکار';
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    // Loaded lazily so the packaged/production backend never requires Vite at runtime.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = process.env.FORGESWE_DIST_DIR || path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PREFERRED_PORT, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : PREFERRED_PORT;
    console.log(`ForgeSWE Coding Harness Server running on http://127.0.0.1:${port}`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') {
      console.error('ForgeSWE backend failed to start:', error);
      return;
    }
    const fallbackServer = app.listen(0, '127.0.0.1', () => {
      const address = fallbackServer.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      console.log(`ForgeSWE Coding Harness Server running on fallback port ${port}`);
    });
  });
}

startServer();
