// serve.js — tiny static dev server. Run with: node serve.js
// Zero dependencies; uses Node stdlib only. CommonJS so no package.json needed.
const { createServer } = require('node:http');
const { readFile }     = require('node:fs/promises');
const { extname, join, normalize, sep } = require('node:path');

const PORT = 8080;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  const url  = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const path = normalize(join(ROOT, url));
  if (!path.startsWith(ROOT + sep) && path !== ROOT) {
    res.writeHead(403); return res.end('forbidden');
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
