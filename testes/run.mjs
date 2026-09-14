import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.json':'application/json'};
const srv=http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/local.html';
  const f=path.join(root,p);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r=>srv.listen(8099,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox']});
const pg=await b.newPage();
pg.on('console',m=>{ if(m.type()==='error') console.log('CONSOLE-ERR:',m.text().slice(0,300)); });
const target=process.argv[2]||'/probe.html';
await pg.goto('http://localhost:8099'+target);
await pg.waitForTimeout(4000);
console.log(await pg.$eval('#conteudo',e=>e.textContent.slice(0,900)));
const mk=await pg.evaluate('window.__mask'); if(mk){const fs2=await import('fs'); fs2.writeFileSync('/home/claude/prancharia/mask.png', Buffer.from(mk.split(',')[1],'base64'));}
await b.close(); srv.close(); process.exit(0);
