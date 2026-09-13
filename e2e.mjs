import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.json':'application/json','.png':'image/png'};
const srv=http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/local.html';
  const f=path.join(root,p);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r=>srv.listen(8099,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1440,height:940}});
const erros=[];
pg.on('console',m=>{ if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404/.test(m.text())) erros.push(m.text().slice(0,220)); });
pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
await pg.goto('http://localhost:8099/local.html');
await pg.waitForSelector('#nav button');
// a entrada agora é Empreendimentos: cria o projeto antes de enviar documentos
await pg.click('[data-acao="criarEmp"]');
await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome','21003 — Alexandre Pompeo');
await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(200);
await pg.fill('#empLocal','Florianópolis / SC');
await pg.click('[data-acao="salvarEmpNovo"]');
await pg.waitForSelector('.placar');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[
 root+'/testdata/EX01SUB_TER_E_SUPR00.pdf',
 root+'/testdata/EX05PISOSUB_E_TERR01.pdf',
 root+'/testdata/EX02COB_E_IMPR00.pdf']);
console.log('processando…');
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=3 && !document.querySelector('.progresso')",{timeout:240000});
await pg.waitForTimeout(600);
console.log('DOCS:', (await pg.$eval('#conteudo table',e=>e.innerText)).slice(0,500).replace(/\n/g,' | '));
await pg.click('[data-rota="locais"]');
await pg.waitForFunction("/Locais/.test(document.querySelector('#trilha')?.innerText||'')",{timeout:15000});
await pg.waitForSelector('#conteudo table');
const nAmb=await pg.$$eval('#conteudo table tbody tr',rs=>rs.length);
console.log('ambientes listados:',nAmb);
console.log('AMB HEAD:', await pg.$$eval('#conteudo table th',n=>n.map(x=>x.textContent).join(' | ')));
// abre ÁREA PETS
const btn=await pg.$('button[data-acao="abrirAmbiente"]:has-text("ÁREA PETS")');
if(!btn){console.log('!! ÁREA PETS não achado');}
else{
  await btn.click(); await pg.waitForSelector('.cabeca h1');
  console.log('FICHA:', await pg.$eval('#conteudo',e=>e.innerText.slice(0,760)));
  const ev=await pg.$('button[data-acao="verEvidencia"]');
  if(ev){await ev.click(); await pg.waitForSelector('#gaveta.aberta'); await pg.waitForTimeout(1800);
    console.log('GAVETA:', await pg.$eval('#gaveta',e=>e.innerText.slice(0,520)));
    const cv=await pg.$eval('#gaveta .visor canvas',c=>({w:c.width,h:c.height}));
    console.log('visor da evidência',cv, await pg.$eval('#gaveta .visor-barra',e=>e.innerText.replace(/\n/g,' | ')));
    await pg.click('[data-acao="fecharGaveta"]');
  }
}
await pg.click('[data-rota="locais"]');
await pg.waitForTimeout(500);
await pg.click('[data-rota="planilhas"]');
await pg.waitForSelector('#conteudo table');
console.log('PLANILHA MC linhas:', await pg.$$eval('#conteudo table tbody tr',r=>r.length));
await pg.click('[data-rota="pendencias"]'); await pg.waitForTimeout(400);
console.log('PEND:', (await pg.$eval('#conteudo',e=>e.innerText)).slice(0,260).replace(/\n/g,' | '));
await pg.click('[data-rota="fornecedores"]'); await pg.waitForTimeout(400);
console.log('MARCAS:', (await pg.$eval('#conteudo',e=>e.innerText)).slice(0,420).replace(/\n/g,' | '));
console.log('ERROS:', erros.slice(0,8));
await b.close(); srv.close(); process.exit(0);
