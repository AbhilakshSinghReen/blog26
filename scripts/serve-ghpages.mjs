// Serve dist/ the way GitHub Pages does, so local testing matches production.
//
// Neither `serve` nor `astro preview` is faithful here: `serve` resolves
// /blog/slug/ to blog/slug.html and returns 200 (so 404.html never runs and the
// trailing-slash redirect never fires), while `astro preview` 404s but shows its
// own dev warning page instead of our 404.html.
//
// Pages' actual rules:
//   /            -> index.html
//   /foo         -> foo.html if present; else 301 to /foo/ when foo/index.html exists
//   /foo/        -> foo/index.html only
//   miss         -> 404 status, body of 404.html
//
// Usage: npm run serve:pages [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.argv[2] ?? 4322);

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.avif': 'image/avif', '.xml': 'application/xml', '.txt': 'text/plain',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();
const send = (res, status, body, type = 'text/html') => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};

if (!existsSync(ROOT)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(pathname);

  if (p === '/') return send(res, 200, readFileSync(path.join(ROOT, 'index.html')));

  const bare = p.replace(/^\/+/, '').replace(/\/+$/, '');
  const target = path.join(ROOT, bare);

  // Guard against path traversal.
  if (!target.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  if (p.endsWith('/')) {
    const idx = path.join(target, 'index.html');
    if (isFile(idx)) return send(res, 200, readFileSync(idx));
  } else {
    if (isFile(`${target}.html`)) return send(res, 200, readFileSync(`${target}.html`));
    if (isFile(path.join(target, 'index.html'))) {
      res.writeHead(301, { location: `/${bare}/` });
      return res.end();
    }
    if (isFile(target)) {
      const type = TYPES[path.extname(target)] ?? 'application/octet-stream';
      return send(res, 200, readFileSync(target), type);
    }
  }

  const notFound = path.join(ROOT, '404.html');
  return send(res, 404, isFile(notFound) ? readFileSync(notFound) : 'Not Found');
}).listen(PORT, () => {
  console.log(`GitHub Pages simulation: http://localhost:${PORT}`);
});
