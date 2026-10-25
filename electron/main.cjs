const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let serverProcess = null;
let backendPort = 3000;

function findFreePort(preferredPort) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      probe.close(() => {
        const fallback = net.createServer();
        fallback.listen(0, '127.0.0.1', () => {
          const address = fallback.address();
          const port = typeof address === 'object' && address ? address.port : preferredPort;
          fallback.close(() => resolve(port));
        });
      });
    });
    probe.listen(preferredPort, '127.0.0.1', () => {
      probe.close(() => resolve(preferredPort));
    });
  });
}

async function waitForBackend(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function startEmbeddedBackend() {
  const isDev = !app.isPackaged;
  if (isDev) return; // In dev mode, tsx server.ts is already running on port 3000

  // Backend bundle + UI assets ship as extraResources (plain files, outside app.asar),
  // because a child node process cannot read from an asar archive.
  const resourcesRoot = process.resourcesPath;
  const serverScript = path.join(resourcesRoot, 'app-dist', 'server.cjs');
  if (!fs.existsSync(serverScript)) {
    throw new Error(`Bundled backend not found at ${serverScript}`);
  }

  backendPort = await findFreePort(Number(process.env.PORT) || 3000);
  serverProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      PORT: String(backendPort),
      NODE_ENV: 'production',
      // Run the Electron binary as a plain Node runtime for the backend child.
      ELECTRON_RUN_AS_NODE: '1',
      FORGESWE_DIST_DIR: path.join(resourcesRoot, 'app-dist'),
      // Keep mutable state (skills/plans/snapshots) outside the install directory.
      FORGESWE_DATA_DIR: process.env.FORGESWE_DATA_DIR || path.join(app.getPath('userData'), 'data'),
    },
    cwd: resourcesRoot,
    stdio: 'inherit',
  });

  serverProcess.on('error', (error) => {
    console.error('Failed to start bundled backend:', error);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 740,
    title: 'ForgeSWE Coding Harness (Windows x64)',
    backgroundColor: '#0B0F17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  mainWindow.loadURL(targetUrl.replace('localhost:3000', `127.0.0.1:${backendPort}`));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('harness:select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Local Project Directory for ForgeSWE Harness',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('harness:platform-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  };
});

app.whenReady().then(async () => {
  try {
    await startEmbeddedBackend();
  } catch (error) {
    dialog.showErrorBox(
      'ForgeSWE Backend Error',
      `Failed to launch the bundled backend.\n\n${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
    return;
  }
  if (app.isPackaged && !(await waitForBackend(backendPort))) {
    dialog.showErrorBox('ForgeSWE Backend Error', 'Backend did not become ready in time.');
    app.quit();
    return;
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
