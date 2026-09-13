import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8095,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1500,height:1000},deviceScaleFactor:1.35});
const err=[];
pg.on('pageerror',e=>err.push(e.message));
pg.on('console',m=>{if(m.type()==='error'&&!/fonts|TUNNEL|404/.test(m.text()))err.push(m.text().slice(0,200));});
await pg.goto('http://localhost:8095/local.html');
await pg.waitForSelector('#nav button');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[root+'/testdata/EX01SUB_TER_E_SUPR00.pdf',root+'/testdata/EX05PISOSUB_E_TERR01.pdf',root+'/testdata/EX02COB_E_IMPR00.pdf']);
await pg.waitForFunction("document.querySelectorAll('table tbody tr').length>=3 && !document.querySelector('.progresso')",{timeout:240000});
// quadro da Área Pets
await pg.click('[data-rota="ambientes"]'); await pg.waitForSelector('#conteudo table');
await (await pg.$('button[data-acao="abrirAmbiente"]:has-text("ÁREA PETS")')).click();
await pg.waitForTimeout(900);
console.log('QUADRO ÁREA PETS:\n'+await pg.$eval('#conteudo table',e=>e.innerText));
await pg.screenshot({path:root+'/v1.png'});
// planilha MP
await pg.click('[data-rota="planilhas"]'); await pg.waitForSelector('#conteudo table');
const abas=await pg.$$eval('[data-acao="trocarAba"]',bs=>bs.map(b=>b.textContent.trim()));
console.log('ABAS:',abas.join(' · '));
const mp=await pg.$('[data-acao="trocarAba"][data-nome="MP"]');
if(mp){await mp.click(); await pg.waitForTimeout(500);
 console.log('MP (primeiras linhas):\n'+(await pg.$eval('#conteudo table',e=>e.innerText)).split('\n').slice(0,8).join('\n'));}
await pg.screenshot({path:root+'/v2.png'});
// glossário
await pg.click('[data-rota="glossario"]'); await pg.waitForTimeout(700);
console.log('GLOSSARIO:',(await pg.$eval('#conteudo',e=>e.innerText)).slice(0,300).replace(/\n/g,' | '));
await pg.screenshot({path:root+'/v3.png'});
// xlsx válido?
const b64=await pg.evaluate(async()=>{const m=await import('./js/core/exporter.js');const a=await import('./js/app.js');
  const blob=m.exportarXlsx(a.estado.emps.find(x=>x.id===a.estado.empId));
  const u=new Uint8Array(await blob.arrayBuffer());let s='';for(const x of u)s+=String.fromCharCode(x);return btoa(s);});
fs.writeFileSync('/tmp/saida.xlsx',Buffer.from(b64,'base64'));
console.log('xlsx bytes',fs.statSync('/tmp/saida.xlsx').size);
console.log('ERROS:',err.slice(0,6));
await b.close(); srv.close(); process.exit(0);
