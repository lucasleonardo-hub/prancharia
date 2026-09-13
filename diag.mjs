import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.png':'image/png'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8109,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1480,height:980}});
const erros=[]; pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
await pg.goto('http://localhost:8109/local.html');
await pg.waitForSelector('#nav button');
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome','Diagnóstico'); await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(120);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
await pg.click('[data-rota="documentos"]');
const pdfs=fs.readdirSync(root+'/testdata').filter(n=>/^EX.*\.pdf$/.test(n)).map(n=>root+'/testdata/'+n);
await pg.setInputFiles('#entradaDocs',pdfs);
console.log('processando', pdfs.length, 'pranchas…');
await pg.waitForFunction(`(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=${pdfs.length} && !document.querySelector('.progresso')`,{timeout:900000});
await pg.waitForTimeout(4000);
const dados = await pg.evaluate(async () => {
  const m = await import('./js/app.js');
  const X = await import('./js/core/exporter.js');
  const e = m.emp();
  const vivo = x => x.status !== 'excluido';
  const docs = {};
  for (const d of e.documentos) docs[d.id] = d.nome;
  const nomeDoc = ev => ((ev && ev.documentoOrigem) || {}).nomeDoc || '';
  const idEv = ev => ((ev && ev.documentoOrigem) || {}).docId || '';
  const porAmb = {};
  for (const a of (e.locais || []).filter(vivo)) {
    porAmb[a.nome] = {
      pavimento: a.pavimento, area: a.area,
      rotuloEm: [...new Set((a.evidencias||[]).map(x => docs[idEv(x)] || nomeDoc(x)))],
      itens: (a.especificacoes || []).filter(vivo).map(x => ({
        cat: x.categoria, prod: x.produto, desc: (x.descricao||'').slice(0,60),
        forma: x.forma ? x.forma + ' ' + x.numero : (x.codigoOrigem || x.origemLeitura),
        motor: [...new Set((x.evidencias||[]).map(ev => (ev.proveniencia||{}).motor_ia).filter(Boolean))],
        de: [...new Set((x.evidencias||[]).map(f => docs[idEv(f)] || nomeDoc(f)))],
      })),
    };
  }
  const orfas = (e.especificacoesSemLocal || []).filter(vivo).map(x => ({
    cat: x.categoria, desc: (x.descricao||'').slice(0,50), textoLocal: x.localNome || '',
    forma: x.forma ? x.forma + ' ' + x.numero : (x.codigoOrigem || x.origemLeitura),
    de: [...new Set((x.evidencias||[]).map(f => docs[idEv(f)] || nomeDoc(f)))],
    motivos: x.motivos,
  }));
  const todas = X.especificacoesDe(e);
  const porDoc = e.documentos.map(d => ({
    nome: d.nome, tipo: d.tipo, tags: d.tags, locais: d.locaisLidos ?? 0,
    especificacoes: todas.filter(x => vivo(x) && (x.evidencias||[]).some(f => idEv(f) === d.id)).length,
    legendas: (e.legendas||[]).filter(l => l.documentoId === d.id).flatMap(l => l.blocos.map(bl => bl.forma + ':' + bl.titulo + '(' + bl.itens.length + ')')),
    tabelas: (e.tabelas||[]).filter(t => t.documentoId === d.id).map(t => t.tipo + ':' + t.titulo),
  }));
  const abas = X.pastaDeAbas(e);
  const exp = Object.fromEntries(abas.map(a => [a.nome, a.linhas.length]));
  return { porDoc, porAmb, orfas, exp,
    totais: { locais: (e.locais||[]).filter(vivo).length, especificacoes: todas.length,
      dentro: (e.locais||[]).flatMap(l => (l.especificacoes||[]).filter(vivo)).length,
      semLocal: (e.especificacoesSemLocal||[]).filter(vivo).length,
      legado: [e.ambientes, e.achados, e.tags].some(x => x !== undefined) } };
});
fs.writeFileSync(root+'/diag.json', JSON.stringify(dados,null,1));
console.log('TOTAIS', JSON.stringify(dados.totais));
console.log('ABAS  ', JSON.stringify(dados.exp));
for (const d of dados.porDoc) console.log('DOC', d.nome, '| tipo', d.tipo, '| tags', d.tags, '| locais', d.locais, '| especs', d.especificacoes, '| legendas', d.legendas.join(', ') || '—', '| tabelas', d.tabelas.join(', ') || '—');
for (const nome of ['B.SERVIÇO','Q.SERVIÇO','GARAGEM','LAVANDERIA','ÁREA PETS','COZINHA']) {
  const a = dados.porAmb[nome];
  if (!a) { console.log('AMB', nome, '→ não encontrado'); continue; }
  console.log('AMB', nome, '|', a.pavimento, a.area, '| rótulo em:', a.rotuloEm.join(', '));
  for (const i of a.itens) console.log('   ', i.cat, '|', i.prod, '|', i.forma, '|', i.desc, '| de', i.de.join(','), '| motor', (i.motor||[]).join(','));
}
console.log('ÓRFÃS:', dados.orfas.length);
for (const o of dados.orfas.slice(0,14)) console.log('   ', o.forma, '|', o.cat, '|', o.desc, '| texto do local:', o.textoLocal || '—', '| de', o.de.join(','), '|', (o.motivos||[]).join(','));
console.log('ERROS:', erros);
await b.close(); srv.close(); process.exit(0);
