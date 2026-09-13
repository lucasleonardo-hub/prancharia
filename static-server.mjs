import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const porta = Number(process.argv[2]) || 5500;

const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const servidor = http.createServer((req, res) => {
  let rota = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rota === '/') rota = '/index.html';
  const arquivo = path.join(root, rota);
  if (!arquivo.startsWith(root) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
    res.writeHead(404); return res.end('não encontrado');
  }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
});

servidor.listen(porta, () => console.log(`servindo ${root} em http://localhost:${porta}`));
