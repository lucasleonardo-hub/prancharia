import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.png':'image/png'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8107,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1480,height:980}});
const erros=[]; pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
pg.on('console',m=>{ if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404/.test(m.text())) erros.push(m.text().slice(0,200)); });
await pg.goto('http://localhost:8107/local.html');
await pg.waitForSelector('#nav button');
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome','Lupa'); await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(120);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[root+'/testdata/EX01SUB_TER_E_SUPR00.pdf']);
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=1 && !document.querySelector('.progresso')",{timeout:240000});
await pg.waitForTimeout(4500);
await pg.click('[data-rota="locais"]'); await pg.waitForTimeout(400);
await pg.click('[data-acao="escolherLocal"][data-nome="ÁREA PETS"]'); await pg.waitForTimeout(400);
await pg.click('button[data-acao="abrirAmbiente"]'); await pg.waitForTimeout(500);
await pg.click('button[data-acao="verEvidencia"]'); await pg.waitForSelector('#gaveta.aberta'); await pg.waitForTimeout(2200);
const diag=async(rot)=>{
  const d=await pg.$eval('#gaveta .visor canvas',c=>{
    const g=c.getContext('2d');
    const w=c.width,h=c.height;
    let tinta=0, amostras=0;
    // amostra a região visível no centro do visor
    const visor=c.parentElement.getBoundingClientRect();
    const m=/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(c.style.transform)||[0,0,0];
    const ox=-parseFloat(m[1]||0), oy=-parseFloat(m[2]||0);
    const dpr=w/parseFloat(c.style.width||w);
    for(let i=0;i<40;i++) for(let j=0;j<40;j++){
      const x=Math.round((ox+visor.width*i/40)*dpr), y=Math.round((oy+visor.height*j/40)*dpr);
      if(x<0||y<0||x>=w||y>=h) continue;
      const p=g.getImageData(x,y,1,1).data; amostras++;
      if(p[3]>0 && (p[0]<250||p[1]<250||p[2]<250)) tinta++;
    }
    return {w,h,transform:c.style.transform,amostras,tinta,zoom:document.querySelector('#gaveta [data-vis-zoom]').textContent};
  });
  console.log(rot, JSON.stringify(d));
};
await diag('REGIAO 2.2s');
await pg.waitForTimeout(9000);
await diag('REGIAO 11s ');
console.log('FILA:', JSON.stringify(await pg.evaluate(()=>window.__fila)));
console.log('ST:', JSON.stringify(await pg.evaluate(()=>{const s=window.__lupa;return s?{escala:s.escala,x:Math.round(s.x),y:Math.round(s.y),rx:Math.round(s.rx),ry:Math.round(s.ry),rend:s.renderizando,pend:s.pendente,tent:s.tentativas,temPage:!!s.page}:null;})));
await pg.click('#gaveta [data-nivel="zoom"]'); await pg.waitForTimeout(1600); await diag('ZOOM    ');
await pg.click('#gaveta [data-nivel="prancha"]'); await pg.waitForTimeout(1600); await diag('GERAL   ');
await pg.click('#gaveta [data-nivel="regiao"]'); await pg.waitForTimeout(1600); await diag('REGIAO2 ');
await pg.locator('#gaveta').screenshot({path:root+'/f_lupa.png'});
console.log('ERROS:', erros);
await b.close(); srv.close(); process.exit(0);
