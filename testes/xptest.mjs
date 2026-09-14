/* Fidelidade da exportação: as abas saem da árvore e conferem com ela.
   Processa EX01 + EX05 de verdade, monta as abas, compara contagens e
   grava o .xlsx em disco para conferência com openpyxl. */
import {chromium} from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root='/home/claude/prancharia';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.png':'image/png'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/local.html';
  const f=path.join(root,p); if(!fs.existsSync(f)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);});
await new Promise(r=>srv.listen(8119,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1400,height:900}});
const erros=[]; pg.on('pageerror',e=>erros.push('PAGEERROR: '+e.message));
pg.on('console',m=>{ if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404/.test(m.text())) erros.push(m.text().slice(0,200)); });
await pg.goto('http://localhost:8119/local.html');
await pg.waitForSelector('#nav button');

// processa duas pranchas pelo fluxo real da aplicação
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome','Exportação'); await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(150);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs',[root+'/testdata/EX01SUB_TER_E_SUPR00.pdf', root+'/testdata/EX05PISOSUB_E_TERR01.pdf']);
console.log('processando…');
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=2 && !document.querySelector('.progresso')",{timeout:300000});
await pg.waitForTimeout(2500);

const r = await pg.evaluate(async () => {
  const app = await import('./js/app.js');
  const X = await import('./js/core/exporter.js');
  const M = await import('./js/core/model.js');
  const emp = app.emp();
  const falhas = [];
  const ok = (cond, msg) => { if (!cond) falhas.push(msg); };
  const vivo = x => x && x.status !== 'excluido';

  /* ---------- contagens direto na árvore ---------- */
  const locais = (emp.locais || []).filter(vivo);
  const dentro = locais.flatMap(l => (l.especificacoes || []).filter(vivo));
  const semLocal = (emp.especificacoesSemLocal || []).filter(vivo);
  const especs = dentro.concat(semLocal);
  const arvore = {
    locais: locais.length, especificacoes: especs.length, dentro: dentro.length, semLocal: semLocal.length,
    esquadrias: especs.filter(a => a.categoria === 'Esquadrias').length,
    evidencias: especs.reduce((s, a) => s + Math.max(1, (a.evidencias || []).length), 0),
    mc: locais.filter(l => l.areaComum).flatMap(l => (l.especificacoes || []).filter(vivo)).length,
  };

  /* ---------- as abas ---------- */
  const abas = X.pastaDeAbas(emp);
  const aba = n => abas.find(x => x.nome === n);
  const molduraMP = 5;   // linha 1 códigos, 2 nota, 3-4 exemplos, 5 títulos
  const contagens = Object.fromEntries(abas.map(a => [a.nome, a.linhas.length]));

  ok(aba('Copiar').linhas.length - 1 === arvore.especificacoes, `Copiar: ${aba('Copiar').linhas.length - 1} linhas para ${arvore.especificacoes} itens`);
  const mp = aba('MP') || abas.find(a => a.nome.startsWith('MP'));
  const totalMP = abas.filter(a => a.nome.startsWith('MP')).reduce((s, a) => s + (a.linhas.length - molduraMP), 0);
  ok(totalMP === arvore.especificacoes - arvore.mc, `MP: ${totalMP} linhas para ${arvore.especificacoes - arvore.mc} itens de unidade privativa`);
  ok(aba('Locais').linhas.length - 1 === arvore.locais, `Locais: ${aba('Locais').linhas.length - 1} para ${arvore.locais}`);
  ok(aba('Esquadrias').linhas.length - 1 === arvore.esquadrias, `Esquadrias: ${aba('Esquadrias').linhas.length - 1} para ${arvore.esquadrias}`);
  ok(aba('Evidências').linhas.length - 1 === arvore.evidencias, `Evidências: ${aba('Evidências').linhas.length - 1} para ${arvore.evidencias}`);
  ok(aba('Pendências').linhas.length - 1 === X.pendencias(emp).length, `Pendências: ${aba('Pendências').linhas.length - 1} para ${X.pendencias(emp).length}`);

  /* os itens sem local não desaparecem das planilhas. A coluna Local mostra
     o texto que a prancha deu (quando deu), mas o item está lá. */
  const copiar = aba('Copiar').linhas.slice(1);
  const descrSemLocal = new Set(semLocal.map(a => (a.descricao || a.produto || '').slice(0, 40)).filter(Boolean));
  const achadosNaAba = [...descrSemLocal].filter(d => copiar.some(l => (l[4] || '').startsWith(d) || (l[2] || '') === d));
  ok(achadosNaAba.length === descrSemLocal.size,
    `itens sem local presentes na aba Copiar: ${achadosNaAba.length} de ${descrSemLocal.size}`);
  const esqSemLocal = semLocal.filter(a => a.categoria === 'Esquadrias');
  const codsNaAba = esqSemLocal.filter(a => aba('Esquadrias').linhas.some(l => l[0] === a.codigoOrigem));
  ok(codsNaAba.length === esqSemLocal.length,
    `esquadrias sem local na aba Esquadrias: ${codsNaAba.length} de ${esqSemLocal.length}`);

  /* ---------- nunca "N/A" ---------- */
  const proibido = /^\s*(n\/a|na|não se aplica|nao se aplica|-{1,2})\s*$/i;
  const celulasRuins = [];
  for (const a of abas) for (let i = 0; i < a.linhas.length; i++) for (const c of a.linhas[i]) {
    if (typeof c === 'string' && proibido.test(c)) celulasRuins.push(`${a.nome} L${i + 1}: "${c}"`);
  }
  ok(celulasRuins.length === 0, `células com "N/A": ${celulasRuins.slice(0, 4).join(' | ')}`);

  /* ---------- coluna de proveniência ---------- */
  const cabEv = aba('Evidências').linhas[0];
  const iProv = cabEv.indexOf('Motor de IA / Proveniência');
  ok(iProv >= 0, 'coluna Motor de IA / Proveniência existe');
  const motores = {};
  for (const l of aba('Evidências').linhas.slice(1)) { const v = l[iProv] || '(vazio)'; motores[v] = (motores[v] || 0) + 1; }
  ok(!motores['(vazio)'], `toda evidência tem motor declarado: ${JSON.stringify(motores)}`);

  /* ---------- resiliência a prancha escaneada ---------- */
  const local = locais[0];
  const escaneada = M.criarEspecificacao({
    categoria: 'Piso', produto: 'Porcelanato lido por imagem', descricao: '',
    localId: local.id, localNome: local.nome, pavimento: local.pavimento,
    status: 'revisar', confianca: 'media', origemLeitura: 'hachura',
  });
  escaneada.evidencias.push(M.criarEvidencia({
    documentoOrigem: { docId: 'scan1', pagina: 3, nomeDoc: 'PRANCHA-ESCANEADA.pdf' },
    tipo: 'hachura',
    coordenadas: [100.4, 200.6, 180.2, 260.9], regiao: [40, 140, 240, 320],
    texto: '', cadeia: [],                       // scan não tem texto vetorial
    proveniencia: { motor_ia: 'multimodal_gemini', metodo: 'hachura_x_legenda', confianca: 'media' },
  }));
  local.especificacoes.push(escaneada);
  const ev2 = X.abaEvidencias(emp);
  const linhaScan = ev2.find(l => l[5] === 'PRANCHA-ESCANEADA.pdf');
  const c = Object.fromEntries(cabEv.map((n, i) => [n, i]));
  ok(!!linhaScan, 'a linha da prancha escaneada é gerada');
  if (linhaScan) {
    ok(linhaScan[c['Texto de origem']] === '' && linhaScan[c['Cadeia de interpretação']] === '', 'texto e cadeia vazios no scan');
    ok(linhaScan[c['Descrição']] === '', 'descrição vazia quando o documento não diz');
    ok(linhaScan[c['Página']] === 3 && linhaScan[c['Documento']] === 'PRANCHA-ESCANEADA.pdf', 'documento e página apontados');
    ok(linhaScan[c['Motor de IA / Proveniência']] === 'multimodal_gemini', 'motor de IA declarado');
    ok(linhaScan[c['Método de leitura']] === 'hachura_x_legenda', 'método declarado');
    ok(linhaScan[c['Zoom (Nível 3)']] === '100, 201, 180, 261', `coordenadas do Nível 3: "${linhaScan[c['Zoom (Nível 3)']]}"`);
    ok(linhaScan[c['Região (Nível 2)']] === '40, 140, 240, 320', 'coordenadas do Nível 2');
    ok(!linhaScan.some(v => typeof v === 'string' && proibido.test(v)), 'nenhum "N/A" na linha do scan');
  }
  local.especificacoes.pop();   // desfaz a injeção

  /* ---------- bytes do xlsx ---------- */
  const blob = X.exportarXlsx(emp);
  const u = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  ok(u.length > 4096 && u[0] === 0x50 && u[1] === 0x4b, `xlsx com ${u.length} bytes e assinatura ZIP`);
  return { falhas, arvore, contagens, motores, xlsx: btoa(bin) };
});

console.log('ÁRVORE   ', JSON.stringify(r.arvore));
console.log('ABAS     ', JSON.stringify(r.contagens));
console.log('MOTORES  ', JSON.stringify(r.motores));
fs.writeFileSync(root + '/saida-exportacao.xlsx', Buffer.from(r.xlsx, 'base64'));
console.log('xlsx gravado:', Math.round(fs.statSync(root + '/saida-exportacao.xlsx').size / 1024), 'KB');
if (r.falhas.length) { console.log('\nFALHAS:'); for (const f of r.falhas) console.log('  -', f); }
else console.log('\nTODAS AS VERIFICAÇÕES PASSARAM');
console.log('ERROS:', erros.slice(0, 5));
await b.close(); srv.close(); process.exit(r.falhas.length ? 1 : 0);
