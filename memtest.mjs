import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8094,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1500,height:1000}});
const err=[]; pg.on('pageerror',e=>err.push(e.message));
await pg.goto('http://localhost:8094/local.html');
await pg.waitForSelector('#nav button');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[root+'/testdata/EX01SUB_TER_E_SUPR00.pdf']);
await pg.waitForFunction("document.querySelectorAll('table tbody tr').length>=1 && !document.querySelector('.progresso')",{timeout:200000});
await pg.setInputFiles('#entradaDocs',[root+'/testdata/MEMORIAL.pdf']);
await pg.waitForFunction("document.querySelectorAll('table tbody tr').length>=2 && !document.querySelector('.progresso')",{timeout:120000});
console.log('DOCS:\n'+await pg.$eval('#conteudo table',e=>e.innerText));
await pg.click('[data-rota="ambientes"]'); await pg.waitForSelector('#conteudo table');
for(const nome of ['ÁREA PETS','COZINHA']){
  const btn=await pg.$(`button[data-acao="abrirAmbiente"]:has-text("${nome}")`);
  if(!btn){console.log(nome,'não encontrado');continue;}
  await btn.click(); await pg.waitForTimeout(700);
  console.log('=== '+nome+' ===\n'+await pg.$eval('#conteudo table',e=>e.innerText));
  await pg.click('[data-rota="ambientes"]'); await pg.waitForSelector('#conteudo table');
}
console.log('ERROS:',err.slice(0,5));
await b.close(); srv.close(); process.exit(0);
