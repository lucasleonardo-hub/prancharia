import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8098,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage();
await pg.goto('http://localhost:8098/local.html');
await pg.waitForSelector('#nav button');
const b64=await pg.evaluate(async ()=>{
  const {gerarXlsx}=await import('./js/core/xlsx.js');
  const blob=gerarXlsx([
    {nome:'MC',linhas:[['Ambiente','Tipologia','Pavimento'],['ÁREA PETS','','TÉRREO'],['COZINHA','','TÉRREO']]},
    {nome:'MP',linhas:[['Ambiente','Categoria','Descrição','Marca'],['ÁREA PETS','Piso','PORCELANATO A DEFINIR',''],['ÁREA PETS','Paredes','TEXTURA Mr. LIME BETON AREIA DE RIO','']]},
  ]);
  const buf=new Uint8Array(await blob.arrayBuffer());
  let s=''; for(const x of buf) s+=String.fromCharCode(x);
  return btoa(s);
});
fs.writeFileSync('/tmp/teste.xlsx',Buffer.from(b64,'base64'));
console.log('bytes',fs.statSync('/tmp/teste.xlsx').size);
await b.close(); srv.close(); process.exit(0);
