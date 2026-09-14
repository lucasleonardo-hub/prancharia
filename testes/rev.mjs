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
await new Promise(r=>srv.listen(8101,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1480,height:980}});
const erros=[];
pg.on('console',m=>{ if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404/.test(m.text())) erros.push(m.text().slice(0,220)); });
pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
const txt=async sel=>(await pg.$eval(sel,e=>e.innerText)).replace(/\n/g,' | ');

await pg.goto('http://localhost:8101/local.html');
await pg.waitForSelector('#nav button');
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome','21003 — Alexandre Pompeo');
await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(150);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
console.log('MENU:', await pg.$$eval('#nav button span:not(.cont)',n=>n.map(x=>x.textContent).join(' | ')));

await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[root+'/testdata/EX01SUB_TER_E_SUPR00.pdf', root+'/testdata/EX05PISOSUB_E_TERR01.pdf']);
console.log('processando…');
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=2 && !document.querySelector('.progresso')",{timeout:240000});
await pg.waitForTimeout(2500);

// ---------- coerência da árvore e ausência de legado ----------
const conf = await pg.evaluate(async () => {
  const app = await import('./js/app.js');
  const M = await import('./js/core/model.js');
  const X = await import('./js/core/exporter.js');
  const e = app.emp();
  const vivo = x => x && x.status !== 'excluido';
  const locais = (e.locais || []).filter(vivo);
  const esps = M.todasEspecificacoes(e);
  const dentro = locais.flatMap(l => (l.especificacoes || []).filter(vivo));
  const semLocal = (e.especificacoesSemLocal || []).filter(vivo);
  /* toda especificação com localId aponta para um local que existe, e nenhuma
     mora em dois lugares */
  const ids = new Set(locais.map(l => l.id));
  const apontaFantasma = dentro.filter(x => x.localId && !ids.has(x.localId)).length;
  const duplicadas = esps.length - new Set(esps.map(x => x.id)).size;
  const semLocalComId = semLocal.filter(x => x.localId).length;
  const serial = JSON.stringify(e);
  return {
    locais: locais.length, especificacoes: esps.length,
    dentro: dentro.length, semLocal: semLocal.length,
    rotulos: locais.filter(l => (l.evidencias || []).length).length,
    apontaFantasma, duplicadas, semLocalComId,
    legadoNoObjeto: [e.ambientes, e.achados, e.tags].some(x => x !== undefined),
    legadoNoJson: ['"ambientes"', '"achados"', '"nomeProduto"', '"ambienteId"', '"fontes"', '"tagCaixa"']
      .filter(k => serial.includes(k)),
    categoriasExatas: [...new Set(esps.map(x => x.categoria).filter(Boolean))].length,
    exportaTudo: X.linhasPlanilha(e, X.especificacoesDe(e)).length,
  };
});
console.log('ÁRVORE:', JSON.stringify(conf));

// ---------- ida e volta pelo banco ----------
await pg.reload();
await pg.waitForSelector('#nav button');
await pg.waitForTimeout(1500);
const volta = await pg.evaluate(async () => {
  const app = await import('./js/app.js');
  const M = await import('./js/core/model.js');
  const e = app.estado.emps[0];
  const esps = M.todasEspecificacoes(e);
  const a = esps.find(x => x.forma && x.descricao);
  return {
    locais: e.locais.length, especificacoes: esps.length, semLocal: e.especificacoesSemLocal.length,
    legadoNoObjeto: [e.ambientes, e.achados, e.tags].some(x => x !== undefined),
    rotulos: e.locais.filter(l => l.evidencias.length).length,
    nomesNovos: a ? (!!a.localNome && a.produto !== undefined && a.evidencias.length > 0
      && !!a.evidencias[0].coordenadas && !!a.evidencias[0].documentoOrigem.docId) : null,
    apelidosAusentes: a ? (a.nomeProduto === undefined && a.ambienteNome === undefined && a.fontes === undefined) : null,
    documentos: e.documentos.length, historico: e.historico.length,
  };
});
console.log('IDA E VOLTA:', JSON.stringify(volta));

// ---------- fila de triagem: atribuir um órfão a um local ----------
await pg.evaluate(async () => { const app = await import('./js/app.js'); app.estado.empId = app.estado.emps[0].id; app.irPara('pendencias'); });
await pg.waitForSelector('#conteudo');
await pg.waitForTimeout(900);
const temFila = await pg.$('.destaque-triagem');
console.log('FILA de triagem:', temFila ? (await txt('.destaque-triagem > header')) : 'ausente');
if (temFila) {
  const antes = await pg.evaluate(async () => (await import('./js/app.js')).emp().especificacoesSemLocal.filter(x => x.status !== 'excluido').length);
  const id = await pg.$eval('.destaque-triagem tbody tr:first-child [data-alvo-local]', e => e.dataset.alvoLocal);
  const alvo = await pg.$eval(`[data-alvo-local="${id}"] option:nth-child(2)`, e => e.value)
    .catch(() => null) || await pg.$eval(`[data-alvo-local="${id}"] optgroup option`, e => e.value);
  await pg.selectOption(`[data-alvo-local="${id}"]`, alvo);
  await pg.click(`[data-acao="atribuirLocal"][data-id="${id}"]`);
  await pg.waitForTimeout(1200);
  const depois = await pg.evaluate(async () => {
    const app = await import('./js/app.js'); const e = app.emp();
    return { semLocal: e.especificacoesSemLocal.filter(x => x.status !== 'excluido').length,
      dentro: e.locais.flatMap(l => l.especificacoes).filter(x => x.status !== 'excluido').length };
  });
  console.log('TRIAGEM: sem local', antes, '→', depois.semLocal, '| dentro de locais agora', depois.dentro);
}
await pg.evaluate(async () => { const app = await import('./js/app.js'); app.irPara('painel'); });
await pg.waitForSelector('[data-rota="locais"]');

// ---------- LOCAIS como módulo central ----------
await pg.click('[data-rota="locais"]'); await pg.waitForSelector('.abas-modulo');
console.log('ABAS:', await pg.$$eval('.aba-modulo',n=>n.map(x=>x.innerText.replace(/\n/g,' ')).join(' | ')));
await pg.click('[data-acao="escolherLocal"][data-nome="ÁREA PETS"]'); await pg.waitForTimeout(500);
console.log('COPIA colunas:', await pg.$$eval('#conteudo .cartao table',t=>[...t[0].querySelectorAll('th')].map(x=>x.textContent).join(' | ')));
console.log('COPIA linha 1:', await pg.$$eval('#conteudo .cartao table',t=>[...t[0].querySelectorAll('tbody tr')][0].innerText.replace(/\n/g,' ').replace(/\t/g,' | ')));

// ficha do local
await pg.click('button[data-acao="abrirAmbiente"]'); await pg.waitForSelector('.chips-cat');
console.log('FICHA placar:', await txt('.placar'));
console.log('SEÇÕES:', await pg.$$eval('#conteudo .cartao > header h2',n=>n.map(x=>x.textContent).join(' | ')));
console.log('PRODUTOS:', (await pg.$eval('.produtos-local',e=>e.innerText)).replace(/\n/g,' | ').slice(0,600));
await pg.screenshot({path:root+'/r0.png'});

// ---------- evidências + rastro ----------
await pg.click('button[data-acao="verEvidencia"]'); await pg.waitForSelector('#gaveta.aberta');
await pg.waitForTimeout(1400);
console.log('PROVAS:', await pg.$$eval('.aba-prova',n=>n.map(x=>x.innerText.replace(/\n/g,' ')).join(' | ')));
await pg.click('[data-nivel="prancha"]'); await pg.waitForTimeout(1000);
await pg.click('[data-nivel="zoom"]'); await pg.waitForTimeout(900);
console.log('NIVEIS:', await pg.$$eval('.nivel-cartao',n=>n.map(x=>x.innerText.replace(/\n/g,' ')).join(' | ')));
console.log('MINIATURAS:', await pg.$$eval('.nivel-cartao canvas',n=>n.map(c=>c.width+'x'+c.height).join(' | ')));
await pg.click('[data-prova="2"]'); await pg.waitForTimeout(900);
console.log('RODAPE:', await pg.$eval('[data-rodape]',e=>e.innerText));
await pg.click('[data-acao="abrirRastro"]'); await pg.waitForSelector('.fluxo');
console.log('FLUXO:', await pg.$$eval('.no-fluxo',n=>n.map(x=>x.innerText.replace(/\n/g,': ')).join(' → ')));
await pg.waitForTimeout(1800);
console.log('RECORTES:', await pg.$$eval('.prova-card canvas',n=>n.map(c=>c.width+'x'+c.height).join(' | ')));
await pg.screenshot({path:root+'/r1.png'});

// ---------- ver na prancha com legenda ----------
await pg.click('.prova-card [data-acao="verNaPrancha"]'); await pg.waitForSelector('.visor');
await pg.waitForTimeout(2500);
console.log('VISOR barra:', await txt('.visor-barra'));
console.log('LEGENDA flutuante:', (await pg.$('.visor-legenda')) ? (await txt('.visor-legenda')).slice(0,140) : 'ausente');
await pg.screenshot({path:root+'/r2.png'});

// ---------- pendências de revisão ----------
await pg.click('[data-rota="pendencias"]'); await pg.waitForSelector('.grupo-rev');
console.log('BANNER auditoria:', (await pg.$('.aviso-faixa')) ? await txt('.aviso-faixa') : 'ausente');
console.log('REV placar:', await txt('.placar'));
console.log('GRUPOS:', await pg.$$eval('.grupo-rev header',n=>n.map(x=>x.innerText.replace(/\n/g,' · ')).slice(0,8).join(' | ')));
const alvos=await pg.$$eval('.grupo-rev', ns=>ns.map(n=>n.querySelector('[data-acao="abrirGrupo"]').dataset.id));
let usado=null;
for (const g of alvos) {
  await pg.click(`[data-acao="abrirGrupo"][data-id="${g}"]`); await pg.waitForTimeout(350);
  if (await pg.$('[data-acao="loteAplicar"]')) { usado=g; break; }
  await pg.click(`[data-acao="abrirGrupo"][data-id="${g}"]`); await pg.waitForTimeout(200);
}
console.log('GRUPO em lote:', usado);
if (usado) {
  console.log('BARRA:', await txt('.barra-lote'));
  console.log('AÇÕES individuais:', await pg.$$eval('.grupo-rev.aberto tbody tr:first-child td:last-child button',n=>n.map(x=>x.innerText).join(' | ')));
  // revisão individual
  const n0=await pg.$$eval('.grupo-rev.aberto tbody tr',r=>r.length);
  await pg.click('.grupo-rev.aberto tbody tr:first-child [data-acao="umaManter"]'); await pg.waitForTimeout(900);
  console.log('individual: linhas', n0, '→', await pg.$$eval('.grupo-rev.aberto tbody tr',r=>r.length));
  // revisão em massa
  await pg.click('[data-sel-todos]'); await pg.waitForTimeout(200);
  console.log('CONTADOR:', await pg.$eval('[data-contador]',e=>e.textContent));
  await pg.click('[data-acao="loteManter"]'); await pg.waitForTimeout(900);
  console.log('REV placar depois:', await txt('.placar'));
}
await pg.screenshot({path:root+'/r3.png'});
await pg.click('[data-rota="historico"]'); await pg.waitForTimeout(500);
console.log('HIST:', (await txt('#conteudo table tbody')).slice(0,420));
console.log('ERROS:', erros.slice(0,8));
await b.close(); srv.close(); process.exit(0);
