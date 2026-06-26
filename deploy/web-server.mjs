// Minimal static file server for the AROS web SPA (apps/web/dist).
// Serves real files when present and falls back to index.html for any
// other path so client-side routes (/login, /auth, /signup, …) work on
// deep links and refreshes. Copied to /app/server.mjs in the image.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 3000);
const root = join(process.cwd(), 'dist');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function resolvePath(url = '/') {
  const pathname = decodeURIComponent(url.split('?')[0] || '/');
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(root, clean === '/' ? 'index.html' : clean);
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(root, 'index.html');
}

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const file = resolvePath(req.url);
  res.writeHead(200, {
    'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-type': contentTypes[extname(file)] || 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log(`AROS web listening on ${port}`);
});
