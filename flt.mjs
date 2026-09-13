import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.png':'image/png'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8105,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1480,height:980}});
const erros=[]; pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
pg.on('console',m=>{ if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404/.test(m.text())) erros.push(m.text().slice(0,200)); });
await pg.goto('http://localhost:8105/local.html');
await pg.waitForSelector('#nav button');
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome','Teste filtro'); await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(120);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[root+'/testdata/EX01SUB_TER_E_SUPR00.pdf']);
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=1 && !document.querySelector('.progresso')",{timeout:240000});
await pg.waitForTimeout(2000);
await pg.click('[data-rota="locais"]'); await pg.waitForSelector('.abas-modulo');
const cartoes=async()=>pg.$$eval('#conteudo .cartao > header h2',n=>n.map(x=>x.textContent).join(' | '));
const ultima=async()=>pg.$$eval('#conteudo .cartao table',t=>({cab:[...t[t.length-1].querySelectorAll('th')].map(x=>x.textContent).join(' | '),linhas:t[t.length-1].querySelectorAll('tbody tr').length}));
console.log('SEM filtro  →', await cartoes(), '|', JSON.stringify(await ultima()));
await pg.waitForTimeout(4200);
await pg.click('[data-acao="escolherLocal"][data-nome="ÁREA PETS"]'); await pg.waitForTimeout(500);
console.log('1 local     →', await cartoes(), '|', JSON.stringify(await ultima()));
console.log('selo:', await pg.$$eval('#conteudo .cartao > header .selo',n=>n.map(x=>x.textContent).join(' / ')));
await pg.click('[data-acao="escolherLocal"][data-nome="COZINHA"]'); await pg.waitForTimeout(500);
console.log('2 locais    →', await cartoes(), '|', JSON.stringify(await ultima()));
await pg.click('.cartao [data-acao="limparLocal"]'); await pg.waitForTimeout(500);
console.log('após limpar →', await cartoes(), '|', JSON.stringify(await ultima()));
await pg.screenshot({path:root+'/f_filtro.png'});
// visor navegável dentro da gaveta
await pg.click('[data-acao="escolherLocal"][data-nome="ÁREA PETS"]'); await pg.waitForTimeout(400);
await pg.click('button[data-acao="abrirAmbiente"]'); await pg.waitForTimeout(500);
await pg.click('button[data-acao="verEvidencia"]'); await pg.waitForSelector('#gaveta.aberta'); await pg.waitForTimeout(1800);
console.log('BARRA visor:', (await pg.$eval('#gaveta .visor-barra',e=>e.innerText)).replace(/\n/g,' | '));
const zoom0=await pg.$eval('#gaveta [data-vis-zoom]',e=>e.textContent);
const box=await pg.$eval('#gaveta .visor',e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),h:Math.round(r.height)};});
await pg.mouse.move(box.x,box.y); await pg.mouse.wheel(0,-300); await pg.waitForTimeout(700);
const zoom1=await pg.$eval('#gaveta [data-vis-zoom]',e=>e.textContent);
// arrasta
// a posição do realce no overlay reflete o estado do visor (x/y), e não é
// zerada quando o quadro termina de pintar como a transform do canvas
const marca=async()=>pg.$eval('#gaveta .visor .marcas rect',r=>r.getAttribute('x')+','+r.getAttribute('y'));
const tr0=await marca();
await pg.mouse.move(box.x,box.y); await pg.mouse.down(); await pg.mouse.move(box.x-140,box.y-60,{steps:8}); await pg.mouse.up(); await pg.waitForTimeout(800);
const tr1=await marca();
await pg.click('#gaveta [data-vis="foco"]'); await pg.waitForTimeout(900);
const tr2=await marca();
console.log('altura visor:', box.h, '| zoom roda:', zoom0, '→', zoom1);
console.log('realce:', tr0, '→', tr1, '| centralizar →', tr2);
console.log('arrastou?', tr0!==tr1, '| centralizou?', tr1!==tr2);
await pg.locator('#gaveta').screenshot({path:root+'/f_gaveta.png'});
console.log('ERROS:', erros);
await b.close(); srv.close(); process.exit(0);
