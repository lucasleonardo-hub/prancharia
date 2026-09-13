/* Engine pós-corte: injeção na árvore, motor de recortes, stub multimodal
   e proveniência. Roda no navegador contra uma prancha real. */
import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.png':'image/png'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8117,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1400,height:900}});
const erros=[]; pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
pg.on('console',m=>{ if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404/.test(m.text())) erros.push(m.text().slice(0,200)); });
await pg.goto('http://localhost:8117/local.html');
await pg.waitForSelector('#nav button');

const r = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const saida = { passos: [] };
  const nota = (k, v) => saida.passos.push([k, v]);

  const emp = M.empreendimentoVazio('Teste engine', 'casa');
  const bytes = new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer());
  const doc = await pdfdoc.openPdf(bytes);
  const meta = { id: 'doc1', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  const folha = await eng.analisarFolha(doc, 1, meta, () => {});
  nota('folha: tags/ambientes/legendas', `${folha.tags.length}/${folha.ambientes.length}/${folha.legendas.blocos.length}`);
  nota('folha traz a página para o recorte', !!folha.page);

  await eng.consolidar(emp, folha, meta);

  // 1. a árvore foi escrita direto
  nota('locais criados', emp.locais.length);
  nota('especificações na árvore', M.todasEspecificacoes(emp).length);
  nota('itens sem local', emp.especificacoesSemLocal.length);
  nota('locais com evidência de rótulo', emp.locais.filter(l => l.evidencias.length).length);

  // 2. a purga: não existe mais camada de projeção
  nota('purga: emp.ambientes não existe', emp.ambientes === undefined);
  nota('purga: emp.achados não existe', emp.achados === undefined);
  const a = M.todasEspecificacoes(emp).find(x => x.forma && x.descricao);
  nota('especificação só responde pelos nomes novos', a
    ? `localNome ${a.localNome ? 'ok' : '—'} | produto ${a.produto !== undefined ? 'ok' : 'x'} | evidencias ${a.evidencias.length}`
      + ` | regiao ${!!a.evidencias[0].regiao} | coordenadas ${!!a.evidencias[0].coordenadas}`
      + ` | apelidos ${a.nomeProduto === undefined && a.ambienteNome === undefined && a.fontes === undefined ? 'ausentes' : 'AINDA PRESENTES'}`
    : 'nenhum');

  // 3. proveniência do stub
  const provs = {};
  for (const esp of M.todasEspecificacoes(emp)) for (const ev of esp.evidencias) {
    const k = `${ev.proveniencia.motor_ia}/${ev.proveniencia.metodo}`;
    provs[k] = (provs[k] || 0) + 1;
  }
  nota('proveniências', JSON.stringify(provs));

  // 4. regra de ouro: forma + número, e vazio quando não há legenda
  const semLegenda = M.todasEspecificacoes(emp).filter(e => (e.motivos || []).includes('legenda_ausente'));
  nota('sem legenda → campos vazios', semLegenda.length
    ? semLegenda.every(e => !e.descricao && !e.produto && !e.sistema && !/N\/A/i.test(JSON.stringify(e)))
    : 'nenhum caso nesta folha');
  const q08 = M.todasEspecificacoes(emp).find(e => e.forma === 'quadrado' && e.numero === '08');
  const t08 = M.todasEspecificacoes(emp).find(e => e.forma === 'triangulo' && e.numero === '08');
  nota('quadrado 08 ≠ triangulo 08', q08 && t08 ? (q08.descricao !== t08.descricao) : `q08=${!!q08} t08=${!!t08}`);

  // 5. motor de recortes de verdade
  const base = { width: folha.largura, height: folha.altura };
  const local = emp.locais.find(l => l.nome === 'ÁREA PETS') || emp.locais[0];
  const jl = eng.janelaDoLocal(local.poligonoOriginal, base);
  const img2 = await eng.recorteBase64(folha.page, jl, { largura: 900 });
  nota('Nível 2 (região do local)', img2 ? `${img2.slice(0, 22)}… ${Math.round(img2.length / 1024)} KB` : 'falhou');
  const tag = folha.tags.find(t => t.bbox);
  const img3 = await eng.recorteBase64(folha.page, eng.janelaDoDetalhe(tag.bbox, base), { largura: 700 });
  nota('Nível 3 (zoom no detalhe)', img3 ? `${Math.round(img3.length / 1024)} KB` : 'falhou');
  const cl = eng.caixaDasLegendas(folha);
  const imgL = await eng.recorteBase64(folha.page, cl, { largura: 900 });
  nota('recorte da legenda', imgL ? `${Math.round(imgL.length / 1024)} KB` : 'falhou');
  nota('recortes são JPEG válidos', [img2, img3, imgL].every(x => x && x.startsWith('data:image/jpeg;base64,/9j/')));

  // 5b. tag sem linha na legenda: especificação nasce vazia, nunca "N/A"
  const fantasma = { ...tag, numero: '97', forma: 'pentagono', bbox: tag.bbox };
  const vazios = await eng.processarComIAHibrida(null, null, {
    itens: [{ tag: fantasma, vinculo: { ambiente: { __local: local }, folga: 2 } }],
    legendas: folha.legendas, local, docMeta: meta, pagina: 1, base,
  });
  const v0 = vazios[0];
  nota('sem legenda → vazio e não "N/A"',
    v0.descricao === '' && v0.produto === '' && v0.sistema === '' && v0.categoria === ''
    && v0.motivos.includes('legenda_ausente') && !/N\/A|não se aplica/i.test(JSON.stringify(v0)));
  nota('sem legenda → código da forma preservado', v0.codigoOrigem === 'pentagono 97');

  // 6. o stub aceita imagem pronta ou produtor sob demanda
  let pediu = 0;
  const produtor = async () => { pediu++; return img2; };
  const especs = await eng.processarComIAHibrida(produtor, imgL, {
    itens: [{ tag, vinculo: { ambiente: { __local: local }, folga: 2 } }],
    legendas: folha.legendas, local, docMeta: meta, pagina: 1, base,
  });
  nota('stub devolve Especificações', especs.length === 1 && !!especs[0].id && Array.isArray(especs[0].evidencias));
  nota('fallback não renderiza imagem à toa', pediu === 0);
  nota('imagem sob demanda funciona', (await eng.imagem(produtor)) === img2 && pediu === 1);

  // 7. o que vai para o banco
  const gravado = JSON.parse(JSON.stringify(emp));
  nota('banco grava a árvore', Array.isArray(gravado.locais) && gravado.locais.length === emp.locais.length);
  nota('banco não tem as listas antigas', !gravado.ambientes && !gravado.achados);
  nota('banco não duplica nomes antigos', !JSON.stringify(gravado).includes('"nomeProduto"') && !JSON.stringify(gravado).includes('"ambienteId"'));
  return saida;
});
for (const [k, v] of r.passos) console.log(String(k).padEnd(38), v);
console.log('ERROS:', erros.slice(0, 5));
await b.close(); srv.close(); process.exit(0);
