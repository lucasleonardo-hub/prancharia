/* Fusão semântica: memorial × pranchas.

   Processa duas pranchas de verdade, depois o memorial, e confere o que a
   fusão fez na árvore: enriquecimento só em campo vazio, conflito quando o
   material é outro, evidência com página e trecho literal, proveniência
   `multimodal_gemini/fusao_semantica`, e as travas contra alucinação de ID e
   contra atualização sem prova. No fim, o fallback para a heurística. */
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { spawn } from 'child_process';

const root = '/home/claude/prancharia';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/local.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(8129, r));

function subirBff(porta, env = {}) {
  const p = spawn('node', [root + '/server/simulador.mjs', String(porta)],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { const t = d.toString(); if (/memorial|ERR/.test(t)) process.stdout.write('  bff> ' + t.replace(/\n+$/, '\n')); });
  p.stderr.on('data', d => process.stdout.write('  bff! ' + d.toString()));
  return p;
}
const bff = subirBff(3000);
const bffQuebrado = subirBff(3013, { FALHAR: '1' });
await new Promise(r => setTimeout(r, 900));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
const erros = []; const avisos = [];
pg.on('pageerror', e => erros.push('PAGEERROR: ' + e.message));
pg.on('console', m => {
  const t = m.text();
  if (m.type() === 'warning' && /\[IA\]/.test(t)) avisos.push(t.slice(0, 150));
  if (m.type() === 'error' && !/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404|ERR_CONNECTION|502 \(Bad Gateway\)/.test(t)) erros.push(t.slice(0, 200));
});
await pg.goto('http://localhost:8129/local.html');
await pg.waitForSelector('#nav button');

const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };
const nota = (k, v) => console.log(String(k).padEnd(40), v);

/* ---------- prepara: duas pranchas pelo motor vetorial ---------- */
await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  eng.configurarIA({ provedor: 'fallback_vetorial' });
});
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome', 'Fusão semântica'); await pg.click('[data-tipo="casa"]'); await pg.waitForTimeout(150);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs', [root + '/testdata/EX01SUB_TER_E_SUPR00.pdf', root + '/testdata/EX05PISOSUB_E_TERR01.pdf']);
console.log('processando as pranchas…');
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=2 && !document.querySelector('.progresso')", { timeout: 300000 });
await pg.waitForTimeout(2000);

const base = await pg.evaluate(async () => {
  const app = await import('./js/app.js'); const M = await import('./js/core/model.js');
  const e = app.emp(); const todas = M.todasEspecificacoes(e);
  return {
    locais: e.locais.length, especificacoes: todas.length,
    comMarca: todas.filter(x => x.marca).length,
    conflitos: todas.filter(x => x.status === 'conflito').length,
    evidencias: todas.reduce((s, x) => s + x.evidencias.length, 0),
  };
});
nota('antes do memorial', JSON.stringify(base));

/* ---------- a fusão semântica ---------- */
await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  eng.configurarIA({ provedor: 'multimodal_gemini', bff: 'http://localhost:3000', timeoutMemorialMs: 60000 });
});
await pg.setInputFiles('#entradaDocs', [root + '/testdata/MEMORIAL.pdf']);
console.log('fundindo o memorial…');
await pg.waitForFunction("(document.querySelector('#conteudo')?.innerText.match(/processado/g)||[]).length>=3 && !document.querySelector('.progresso')", { timeout: 240000 });
await pg.waitForTimeout(1500);

const r = await pg.evaluate(async () => {
  const app = await import('./js/app.js'); const M = await import('./js/core/model.js');
  const P = await import('./js/core/provas.js');
  const e = app.emp();
  const todas = M.todasEspecificacoes(e);
  const daPrancha = todas.filter(x => x.origemLeitura !== 'memorial');
  const comFusao = daPrancha.filter(x => x.evidencias.some(v => (v.proveniencia || {}).metodo === 'fusao_semantica'));
  const conflitos = todas.filter(x => x.status === 'conflito');
  const ev0 = comFusao[0] && comFusao[0].evidencias.find(v => (v.proveniencia || {}).metodo === 'fusao_semantica');
  const conf0 = conflitos.find(x => x.evidencias.some(v => (v.proveniencia || {}).metodo === 'fusao_semantica'));
  const evc = conf0 && conf0.evidencias.find(v => (v.proveniencia || {}).metodo === 'fusao_semantica');

  /* a prancha não pode ter sido sobrescrita: toda descrição de item de prancha
     precisa continuar sendo a que a legenda deu */
  const doc = e.documentos.find(d => d.tipo === 'memorial');
  return {
    motorFusao: doc && doc.motorFusao,
    locais: e.locais.length, especificacoes: todas.length,
    comFusao: comFusao.length,
    comMarca: daPrancha.filter(x => x.marca).length,
    conflitos: conflitos.length,
    marcas: [...new Set(daPrancha.filter(x => x.marca).map(x => x.marca))].slice(0, 8),
    /* travas: nenhum id inventado entrou, nenhuma evidência sem trecho */
    evSemTexto: todas.flatMap(x => x.evidencias).filter(v => (v.proveniencia || {}).metodo === 'fusao_semantica' && !v.texto).length,
    fantasma: JSON.stringify(todas).includes('Fantasma'),
    semProva: JSON.stringify(todas).includes('Sem prova'),
    exemplo: comFusao[0] && {
      local: comFusao[0].localNome, categoria: comFusao[0].categoria,
      descricao: (comFusao[0].descricao || '').slice(0, 44), marca: comFusao[0].marca,
      evidencias: comFusao[0].evidencias.length,
      motores: comFusao[0].evidencias.map(v => `${v.proveniencia.motor_ia}/${v.proveniencia.metodo}`),
      ev: ev0 && { tipo: ev0.tipo, pagina: (ev0.documentoOrigem || {}).pagina, doc: (ev0.documentoOrigem || {}).nomeDoc,
        trecho: (ev0.texto || '').slice(0, 80), temCaixa: !!ev0.coordenadas, temRegiao: !!ev0.regiao },
      provas: P.provasDe(e, comFusao[0]).map(p => p.papel),
    },
    conflito: conf0 && {
      local: conf0.localNome, categoria: conf0.categoria, status: conf0.status,
      prancha: (conf0.descricao || '').slice(0, 50),
      divergencias: (conf0.divergencias || []).map(d => `${d.documento} p.${d.pagina}: ${String(d.descricao).slice(0, 50)}`),
      motivos: conf0.motivos,
      trechoEvidencia: evc && (evc.texto || '').slice(0, 70),
    },
  };
});
nota('motor da fusão', r.motorFusao);
nota('locais / especificações', `${r.locais} / ${r.especificacoes}`);
nota('especificações de prancha com fusão', r.comFusao);
nota('com marca (antes → depois)', `${base.comMarca} → ${r.comMarca}`);
nota('conflitos (antes → depois)', `${base.conflitos} → ${r.conflitos}`);
nota('marcas trazidas do memorial', JSON.stringify(r.marcas));
nota('exemplo enriquecido', JSON.stringify(r.exemplo));
nota('exemplo de conflito', JSON.stringify(r.conflito));

ok(r.motorFusao === 'multimodal_gemini', `o documento deveria registrar o motor: ${r.motorFusao}`);
ok(r.comFusao > 0, 'nenhuma especificação de prancha recebeu fusão semântica');
ok(r.comMarca > base.comMarca, `a fusão deveria trazer marcas: ${base.comMarca} → ${r.comMarca}`);
ok(r.exemplo && r.exemplo.ev && r.exemplo.ev.tipo === 'texto_memorial',
  'a evidência da fusão precisa ser do tipo texto_memorial');
ok(r.exemplo && r.exemplo.ev && r.exemplo.ev.pagina >= 1, 'a evidência precisa apontar a página do memorial');
ok(r.exemplo && r.exemplo.ev && r.exemplo.ev.trecho.length > 10, 'a evidência precisa trazer o trecho literal');
ok(r.exemplo && r.exemplo.ev && r.exemplo.ev.temCaixa && r.exemplo.ev.temRegiao,
  'a evidência do memorial precisa das coordenadas dos 3 níveis');
ok(r.exemplo && r.exemplo.motores.some(m => m === 'multimodal_gemini/fusao_semantica'),
  'proveniência da fusão errada: ' + JSON.stringify(r.exemplo && r.exemplo.motores));
ok(r.exemplo && r.exemplo.evidencias >= 2, 'a fusão soma uma evidência, não substitui a da prancha');
ok(r.exemplo && r.exemplo.provas.includes('memorial'),
  'o painel de evidências deveria listar a prova do memorial: ' + JSON.stringify(r.exemplo && r.exemplo.provas));
ok(r.evSemTexto === 0, 'evidência de fusão sem trecho não pode existir');
ok(!r.fantasma, 'a trava M2 falhou: ID inventado pela IA entrou na árvore');
ok(!r.semProva, 'a trava M3 falhou: atualização sem trecho entrou na árvore');
ok(r.conflitos > base.conflitos && r.conflito && r.conflito.status === 'conflito'
  && r.conflito.divergencias.length > 0 && (r.conflito.motivos || []).includes('conflito'),
  'o conflito documental não foi registrado como esperado');

/* ---------- a prancha não é sobrescrita ---------- */
const integridade = await pg.evaluate(async () => {
  const app = await import('./js/app.js'); const M = await import('./js/core/model.js');
  const e = app.emp();
  const daPrancha = M.todasEspecificacoes(e).filter(x => x.origemLeitura !== 'memorial' && x.descricao);
  /* a descrição de item de prancha vem da legenda: tem de continuar em
     maiúsculas como a prancha escreve, sem virar frase de memorial */
  const suspeitas = daPrancha.filter(x => /^piso:|^paredes:|^teto:|marca:/i.test(x.descricao));
  return { total: daPrancha.length, suspeitas: suspeitas.map(x => x.descricao.slice(0, 50)).slice(0, 4) };
});
nota('descrições de prancha preservadas', `${integridade.total} itens, ${integridade.suspeitas.length} suspeitas`);
ok(integridade.suspeitas.length === 0, 'descrição da prancha foi sobrescrita pelo memorial: ' + JSON.stringify(integridade.suspeitas));

/* ---------- exportação mostra a fusão ---------- */
const exp = await pg.evaluate(async () => {
  const app = await import('./js/app.js'); const X = await import('./js/core/exporter.js');
  const aba = X.abaEvidencias(app.emp());
  const c = Object.fromEntries(aba[0].map((n, i) => [n, i]));
  const linhas = aba.slice(1).filter(l => l[c['Motor de IA / Proveniência']] === 'multimodal_gemini');
  const metodos = {};
  for (const l of aba.slice(1)) { const m = l[c['Método de leitura']] || '(vazio)'; metodos[m] = (metodos[m] || 0) + 1; }
  const proibido = /^\s*(n\/a|não se aplica|-{1,2})\s*$/i;
  return {
    metodos, multimodais: linhas.length,
    naS: aba.slice(1).flat().filter(v => typeof v === 'string' && proibido.test(v)).length,
    amostra: linhas[0] && [linhas[0][c['Local']], linhas[0][c['Documento']], linhas[0][c['Página']],
      (linhas[0][c['Texto de origem']] || '').slice(0, 50)],
  };
});
nota('métodos na aba Evidências', JSON.stringify(exp.metodos));
nota('linha multimodal na planilha', JSON.stringify(exp.amostra));
ok(exp.metodos['fusao_semantica'] > 0, 'a planilha não mostra o método fusao_semantica');
ok(exp.naS === 0, `apareceu "N/A" na planilha: ${exp.naS} célula(s)`);

/* ---------- a tela mostra a fusão e a gaveta mostra a prova ---------- */
await pg.click('[data-rota="documentos"]'); await pg.waitForTimeout(500);
nota('coluna Fusão na tela', await pg.$eval('#conteudo table', t => [...t.querySelectorAll('th')].map(x => x.textContent).join(' | ')));
const selo = await pg.$$eval('#conteudo table tbody tr', rs => rs.map(r => r.innerText.replace(/\n/g, ' | ')).find(t => /fusão semântica/i.test(t)) || 'ausente');
nota('linha do memorial', selo.slice(0, 150));
ok(/fusão semântica/i.test(selo), 'a tela de documentos não mostra o selo da fusão');

const gaveta = await pg.evaluate(async () => {
  const app = await import('./js/app.js'); const M = await import('./js/core/model.js');
  const d = await import('./js/ui/drawer.js');
  const esp = M.todasEspecificacoes(app.emp())
    .find(x => x.evidencias.some(v => (v.proveniencia || {}).metodo === 'fusao_semantica'));
  d.abrirGaveta(esp);
  await new Promise(r => setTimeout(r, 900));
  const g = document.getElementById('gaveta');
  return {
    abas: [...g.querySelectorAll('.aba-prova')].map(x => x.innerText.replace(/\n/g, ' ')),
    origens: [...g.querySelectorAll('section:last-of-type li')].map(x => x.innerText.replace(/\n/g, ' · ')).slice(0, 4),
    temIA: /IA multimodal/i.test(g.innerText),
  };
});
nota('abas de prova na gaveta', JSON.stringify(gaveta.abas));
nota('origens na gaveta', JSON.stringify(gaveta.origens));
ok(gaveta.abas.some(a => /memorial/i.test(a)), 'a gaveta não mostra a prova do memorial');
ok(gaveta.temIA, 'a gaveta não mostra que o motor foi a IA multimodal');
await pg.screenshot({ path: root + '/fusao.png', fullPage: false });

/* ---------- fallback: BFF fora do ar cai na heurística ---------- */
const queda = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const mem = await import('./js/core/memorial.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const app = await import('./js/app.js');
  eng.configurarIA({ provedor: 'multimodal_gemini', bff: 'http://localhost:3013', maxFalhas: 99 });
  const e = app.emp();
  const antes = M.todasEspecificacoes(e).length;
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/MEMORIAL.pdf')).arrayBuffer()));
  const meta = { id: 'mem2', nome: 'MEMORIAL.pdf' };
  const r = await mem.analisarMemorial(doc, meta, e.locais, () => {});
  const f = await mem.fundirComMemorial(e, doc, meta, r.especificacoes, () => {});
  return { motor: f.motor, erro: f.erro, marcas: f.marcas, conflitos: f.conflitos,
    especificacoes: M.todasEspecificacoes(e).length, antes, trechos: r.especificacoes.length };
});
nota('BFF fora: motor usado', queda.motor);
nota('BFF fora: erro registrado', queda.erro);
nota('BFF fora: a heurística trabalhou', JSON.stringify({ marcas: queda.marcas, conflitos: queda.conflitos }));
ok(queda.motor === 'fallback_vetorial', 'deveria cair na heurística');
ok(queda.trechos > 0, 'a leitura do memorial não pode parar quando o BFF cai');
ok(typeof queda.marcas === 'number', 'a heurística deveria devolver o relatório de sempre');

/* ---------- motor desligado: nem tenta ---------- */
const desligado = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const mem = await import('./js/core/memorial.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const app = await import('./js/app.js');
  eng.configurarIA({ provedor: 'fallback_vetorial' });
  const chamadas = eng.IA.chamadas;
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/MEMORIAL.pdf')).arrayBuffer()));
  const meta = { id: 'mem3', nome: 'MEMORIAL.pdf' };
  const f = await mem.fundirComMemorial(app.emp(), doc, meta, [], () => {});
  return { motor: f.motor, novasChamadas: eng.IA.chamadas - chamadas };
});
nota('vetorial: motor / chamadas', `${desligado.motor} / ${desligado.novasChamadas}`);
ok(desligado.motor === 'fallback_vetorial' && desligado.novasChamadas === 0,
  'com o provedor no vetorial não se chama o BFF');

console.log('\nAVISOS DE FALLBACK:');
for (const a of [...new Set(avisos)].slice(0, 3)) console.log('  ·', a);
if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log('  -', f); }
else console.log('\nTODAS AS VERIFICAÇÕES PASSARAM');
console.log('ERROS DE PÁGINA:', erros.slice(0, 4));

await b.close(); srv.close(); bff.kill(); bffQuebrado.kill();
process.exit(falhas.length ? 1 : 0);
