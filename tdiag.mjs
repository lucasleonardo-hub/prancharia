import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const arq=process.argv[2]||'EX05PISOSUB_E_TERR01.pdf';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8113,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1200,height:800}});
await pg.goto('http://localhost:8113/local.html');
await pg.waitForSelector('#nav button');
const r = await pg.evaluate(async (arq) => {
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const tbl = await import('./js/core/tables.js');
  const bytes = new Uint8Array(await (await fetch('./testdata/' + arq)).arrayBuffer());
  const doc = await pdfdoc.openPdf(bytes);
  const page = await doc.getPage(1);
  const fios = tbl.coletorDeFios();
  await pdfdoc.walkPaths(page, p => fios.visit(p));
  const textos = await pdfdoc.readText(page);
  const achaLegenda = textos.filter(t => /LEGENDA|BAGUETE|TABELA|QUADRO/i.test(t.str))
    .map(t => ({ str: t.str, x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: +t.h.toFixed(1), horiz: t.horizontal }));
  // tenta ler a tabela a partir de cada candidato
  const tentativas = [];
  for (const t of textos) {
    const s = t.str.trim();
    if (!/^LEGENDA/i.test(s)) continue;
    const ti = { x: t.x + t.w / 2, y: t.y, texto: s };
    const tb = tbl.lerTabela(ti, fios.resultado, textos, {});
    tentativas.push({ titulo: s, x: Math.round(ti.x), y: Math.round(ti.y),
      resultado: tb ? { linhas: tb.linhas.length, colunas: tb.colunas.length, caixa: tb.caixa.map(Math.round),
        primeiras: tb.linhas.slice(0, 4).map(l => l.celulas) } : null });
  }
  return { titulos: achaLegenda, tentativas, totalFios: fios.resultado.length };
}, arq);
console.log('fios:', r.totalFios);
console.log('--- textos com LEGENDA/TABELA ---');
for (const t of r.titulos) console.log(JSON.stringify(t));
console.log('--- tentativas de leitura ---');
for (const t of r.tentativas) console.log(t.titulo, '@', t.x, t.y, '→', JSON.stringify(t.resultado));
await b.close(); srv.close(); process.exit(0);
