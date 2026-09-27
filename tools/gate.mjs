// Path filter in front of n8n for a public tunnel: only the form webhook and the signed
// approval links pass; the editor, the REST API and every other path get 404.
// Usage: node tools/gate.mjs [listenPort=5680] [n8nPort=5678]
import http from 'node:http';

const [listen = 5680, upstream = 5678] = process.argv.slice(2).map(Number);
const allowed = (method, path) =>
  (method === 'POST' && path === '/webhook/lead-intake') ||
  (method === 'GET' && /^\/webhook-waiting\/[A-Za-z0-9-]+$/.test(path));

http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  const ok = allowed(req.method, path);
  console.log(`${new Date().toISOString()} ${ok ? 'pass' : 'deny'} ${req.method} ${path}`);
  if (!ok) { res.writeHead(404).end(); return; }
  const up = http.request({ host: '127.0.0.1', port: upstream, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(listen, '127.0.0.1', () => console.log(`gate on 127.0.0.1:${listen} → n8n :${upstream}`));
