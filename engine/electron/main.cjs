// Sprout Engine for Windows (and Mac/Linux): wraps the editor in a desktop window.
const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://sprout';

// Serve the editor from app://sprout/ so it gets its own safe origin
// (needed for saved projects, and for talking to the AI service).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#1b1f2b',
    title: 'Sprout Engine',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(`${ORIGIN}/index.html`);
  // Links open in the normal web browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // The Claude API allows direct browser access. As a safety net, make sure
  // its responses are readable from the app's origin.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://api.anthropic.com/*'] }, (details, callback) => {
    const headers = details.responseHeaders || {};
    const has = Object.keys(headers).some((k) => k.toLowerCase() === 'access-control-allow-origin');
    if (!has) {
      headers['Access-Control-Allow-Origin'] = [ORIGIN];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    }
    callback({ responseHeaders: headers });
  });

  ipcMain.handle('sprout:save-file', async (event, { suggestedName, text, kind }) => {
    const filters = kind === 'game'
      ? [{ name: 'Web page (playable game)', extensions: ['html'] }]
      : [{ name: 'Sprout project', extensions: ['sprout'] }];
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, String(text), 'utf8');
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle('sprout:open-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Sprout project', extensions: ['sprout', 'json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    return { name: path.basename(file), text: await fs.readFile(file, 'utf8') };
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
