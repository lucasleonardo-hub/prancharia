import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8115,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1200,height:800}});
await pg.goto('http://localhost:8115/local.html');
await pg.waitForSelector('#nav button');
const r = await pg.evaluate(async () => {
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const shapes = await import('./js/core/shapes.js');
  const rooms = await import('./js/core/rooms.js');
  const bytes = new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer());
  const doc = await pdfdoc.openPdf(bytes);
  const page = await doc.getPage(1);
  const formas = shapes.coletorDeFormas(pdfdoc.isRed);
  await pdfdoc.walkPaths(page, p => formas.visit(p));
  const textos = await pdfdoc.readText(page);
  const tags = shapes.montarTags(formas.resultado, textos);
  const amb = rooms.lerAmbientes(textos);
  const alvo = amb.filter(a => /SERVI|VESTI|DEP.SITO|DUCHA|LAVABO/i.test(a.nome))
    .map(a => ({ nome: a.nome, x: Math.round(a.x), y: Math.round(a.y), area: a.area, conf: a.confianca }));
  const perto = (a) => tags.filter(t => Math.abs(t.x - a.x) < 160 && Math.abs(t.y - a.y) < 160)
    .map(t => ({ f: t.forma, n: t.numero, dx: Math.round(t.x - a.x), dy: Math.round(t.y - a.y) }));
  return { alvo: alvo.map(a => ({ ...a, tags: perto(a) })), totalTags: tags.length };
});
console.log('tags na folha:', r.totalTags);
for (const a of r.alvo) console.log(a.nome, '@', a.x, a.y, '|', a.area, a.conf, '| tags perto:', JSON.stringify(a.tags));
await b.close(); srv.close(); process.exit(0);
