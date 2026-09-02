const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const LOG_FILE = path.join(app.getPath('userData'), 'main.log');
function logError(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // best-effort logging only
  }
}
process.on('uncaughtException', (err) => logError('uncaughtException', err.stack || err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', (err && err.stack) || err));

const DIST_DIR = path.join(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Serves the built frontend over http://localhost so relative asset URLs
 * and WebSocket host detection (window.location.hostname) behave exactly
 * like they do in a browser — a plain file:// load can't offer either. */
function serveDist() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(DIST_DIR, requestPath === '/' ? 'index.html' : requestPath);
      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA fallback: unknown paths resolve to index.html.
          fs.readFile(path.join(DIST_DIR, 'index.html'), (fallbackErr, fallbackData) => {
            if (fallbackErr) {
              res.writeHead(404);
              res.end('Not found');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(fallbackData);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => logError('did-fail-load', code, desc));
  win.webContents.on('render-process-gone', (_e, details) => logError('render-process-gone', JSON.stringify(details)));
  win.webContents.on('preload-error', (_e, preloadPath, error) => logError('preload-error', preloadPath, error.stack || error));
  win.loadURL(`http://localhost:${port}/`);
}

app.whenReady().then(async () => {
  // Starts the WebSocket multiplayer server on its usual fixed port (8787)
  // as a side effect of require() — the client already expects that port.
  require('../dist-electron/server.cjs');

  const port = await serveDist();
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
}).catch((err) => logError('startup failed', err.stack || err));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// The renderer's Exit Game button (see preload.cjs) — quits the whole app,
// not just the focused window, same as closing every window would.
ipcMain.on('app:exit', () => {
  logError('app:exit received, calling app.exit()');
  app.exit(0);
});
