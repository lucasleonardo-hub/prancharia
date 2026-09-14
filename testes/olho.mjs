import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const arq = process.argv[2] || 'EX05PISOSUB_E_TERR01.pdf';
const regioes = JSON.parse(process.argv[3] || '[]'); // [[x0,y0,x1,y1,nome],...]
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8111,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1200,height:800}});
await pg.goto('http://localhost:8111/local.html');
await pg.waitForSelector('#nav button');
const saidas = await pg.evaluate(async ({arq, regioes}) => {
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const bytes = new Uint8Array(await (await fetch('./testdata/' + arq)).arrayBuffer());
  const doc = await pdfdoc.openPdf(bytes);
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const out = { tamanho: [Math.round(base.width), Math.round(base.height)], imagens: [] };
  const desenhar = async (caixa, nome, largura) => {
    const [x0,y0,x1,y1] = caixa;
    const esc = Math.min(4, largura / Math.max(10, x1-x0));
    const cv = document.createElement('canvas');
    cv.width = Math.round((x1-x0)*esc); cv.height = Math.round((y1-y0)*esc);
    const ctx = cv.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
    await page.render({ canvasContext: ctx, viewport: page.getViewport({scale:esc}), transform:[1,0,0,1,-x0*esc,-y0*esc] }).promise;
    out.imagens.push({ nome, dados: cv.toDataURL('image/png').split(',')[1] });
  };
  await desenhar([0,0,base.width,base.height], 'folha', 1500);
  for (const r of regioes) await desenhar(r.slice(0,4), r[4], 1100);
  return out;
}, { arq, regioes });
console.log('tamanho da folha:', saidas.tamanho.join(' x '));
for (const im of saidas.imagens) { fs.writeFileSync(root+'/v_'+im.nome+'.png', Buffer.from(im.dados,'base64')); console.log('escrito v_'+im.nome+'.png'); }
await b.close(); srv.close(); process.exit(0);
