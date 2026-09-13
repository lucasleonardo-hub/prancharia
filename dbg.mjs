import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8096,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage();
pg.on('console',m=>console.log('['+m.type()+']',m.text().slice(0,400)));
pg.on('pageerror',e=>console.log('PAGEERROR:',e.message,'\n',(e.stack||'').split('\n').slice(0,4).join('\n')));
await pg.goto('http://localhost:8096/local.html');
await pg.waitForTimeout(2500);
console.log('CONTEUDO:', (await pg.$eval('#conteudo',e=>e.textContent)).slice(0,300));
await b.close(); srv.close(); process.exit(0);
