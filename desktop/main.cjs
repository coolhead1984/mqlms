const { app, BrowserWindow, dialog, Menu } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 49583;
const APP_URL = `http://${HOST}:${PORT}/`;
const APP_ORIGIN = new URL(APP_URL).origin;
const SERVER_ID = 'LaCasaQuoteStudio/1.0';
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};
const ROUTES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/manifest.json', 'manifest.json'],
  ['/sw.js', 'sw.js'],
  ['/favicon.ico', 'assets/icon.svg'],
  ['/assets/icon.svg', 'assets/icon.svg'],
  ['/assets/la-casa-logo.png', 'assets/la-casa-logo.png']
]);

let server;
let mainWindow;

function setHeaders(response, contentType = 'text/plain; charset=utf-8') {
  response.setHeader('Content-Type', contentType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    'script-src \'self\' https://accounts.google.com/gsi/client; ' +
    'connect-src \'self\' https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com; ' +
    'frame-src https://accounts.google.com; form-action \'self\' https://accounts.google.com; ' +
    "manifest-src 'self'; worker-src 'self'");
  response.setHeader('Server', SERVER_ID);
  response.setHeader('Connection', 'close');
}

function sendText(response, statusCode, message) {
  setHeaders(response);
  response.writeHead(statusCode);
  response.end(message);
}

function serve(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return sendText(response, 405, 'A GET or HEAD request is required.');
  }

  let route;
  try {
    route = decodeURIComponent(new URL(request.url, APP_URL).pathname);
  } catch {
    return sendText(response, 400, 'Invalid request path.');
  }

  const fileName = ROUTES.get(route);
  if (!fileName) return sendText(response, 404, 'Not found.');

  const filePath = path.join(app.getAppPath(), fileName);
  fs.readFile(filePath, (error, body) => {
    if (error) {
      console.error(`Could not read app resource "${fileName}":`, error);
      return sendText(response, 500, 'The application resource could not be loaded.');
    }

    setHeaders(response, CONTENT_TYPES[path.extname(fileName)] || 'application/octet-stream');
    response.writeHead(200, { 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

async function isQuoteStudioServerRunning() {
  try {
    const response = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) });
    return response.ok &&
      response.headers.get('server') === SERVER_ID &&
      (await response.text()).includes('<title>La Casa | Quote Studio</title>');
  } catch {
    return false;
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(serve);
    server.once('error', async (error) => {
      if (error.code === 'EADDRINUSE' && await isQuoteStudioServerRunning()) {
        server = null;
        return resolve();
      }
      reject(error);
    });
    server.listen(PORT, HOST, resolve);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 850,
    minHeight: 620,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    title: 'La Casa Quote Studio',
    ...(process.platform === 'win32'
      ? { icon: path.join(app.getAppPath(), 'assets', 'la-casa.ico') }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      return origin === APP_ORIGIN || origin === 'https://accounts.google.com'
        ? { action: 'allow' }
        : { action: 'deny' };
    } catch {
      return { action: 'deny' };
    }
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL).catch((error) => {
    console.error('Could not open Quote Studio:', error);
    dialog.showErrorBox(
      'Quote Studio could not open',
      'The app window could not load. Close other Quote Studio instances and try again.'
    );
    app.quit();
  });
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await startServer();
      createWindow();
    } catch (error) {
      console.error('Could not start the Quote Studio server:', error);
      dialog.showErrorBox(
        'Quote Studio could not start',
        `The local app server could not start on 127.0.0.1:${PORT}. Close other apps using that port and try again.`
      );
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    if (server) server.close();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
