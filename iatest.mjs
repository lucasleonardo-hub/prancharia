/* Motor multimodal ligado ao BFF: chamada, mesclagem híbrida, proveniência,
   timeout e fallback gracioso. Sobe o simulador do BFF e processa uma prancha
   real pelo fluxo do engine. */
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
await new Promise(r => srv.listen(8123, r));

/* ---------- sobe o simulador do BFF ---------- */
function subirBff(porta, env = {}) {
  const p = spawn('node', [root + '/server/simulador.mjs', String(porta)],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => process.stdout.write('  bff> ' + d.toString().replace(/\n+$/, '\n')));
  p.stderr.on('data', d => process.stdout.write('  bff! ' + d.toString()));
  return p;
}
const bff = subirBff(3000);
const bffLento = subirBff(3011, { LENTO: '4000' });
const bffQuebrado = subirBff(3012, { FALHAR: '1' });
await new Promise(r => setTimeout(r, 900));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const erros = []; const avisos = [];
pg.on('pageerror', e => erros.push('PAGEERROR: ' + e.message));
pg.on('console', m => {
  const t = m.text();
  if (m.type() === 'warning' && /\[IA\]/.test(t)) avisos.push(t.slice(0, 160));
  if (m.type() === 'error' && !/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404|ERR_CONNECTION|502 \(Bad Gateway\)/.test(t)) erros.push(t.slice(0, 200));
});
await pg.goto('http://localhost:8123/local.html');
await pg.waitForSelector('#nav button');

const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };
const nota = (k, v) => console.log(String(k).padEnd(42), v);

/* ---------- 1. saúde do BFF e configuração ---------- */
const saude = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  eng.configurarIA({ provedor: 'multimodal_gemini', bff: 'http://localhost:3000', timeoutMs: 30000, paralelas: 3, lerQuadrosComIA: false });
  return { saude: await eng.saudeDaIA(), ligada: eng.iaLigada(), cfg: { ...eng.IA } };
});
nota('BFF saudável', JSON.stringify(saude.saude));
nota('IA ligada', saude.ligada);
ok(saude.saude && saude.saude.ok, 'saudeDaIA não respondeu');
ok(saude.ligada === true, 'iaLigada() deveria ser true');

/* ---------- 2. processa a prancha com a IA ligada ---------- */
const r = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const emp = M.empreendimentoVazio('Teste IA', 'casa');
  const bytes = new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer());
  const doc = await pdfdoc.openPdf(bytes);
  const meta = { id: 'doc1', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  const folha = await eng.analisarFolha(doc, 1, meta, () => {});
  const t0 = performance.now();
  await eng.consolidar(emp, folha, meta);
  const ms = Math.round(performance.now() - t0);

  const todas = M.todasEspecificacoes(emp);
  const provs = {};
  for (const e of todas) for (const ev of e.evidencias) {
    const k = `${ev.proveniencia.motor_ia}/${ev.proveniencia.metodo}`;
    provs[k] = (provs[k] || 0) + 1;
  }
  const hachuras = todas.filter(e => e.origemLeitura === 'hachura');
  const comConfirmacao = todas.filter(e => e.evidencias.some(ev => ev.tipo === 'confirmacao_ia'));
  const naNoJson = /"(N\/A|n\/a|não se aplica)"/i.test(JSON.stringify(todas));
  const umaHachura = hachuras[0] || null;
  const umaConfirmada = comConfirmacao[0] || null;
  return {
    ms, chamadas: eng.IA.chamadas, falhas: eng.IA.falhasSeguidas, desligado: eng.IA.desligadoPorFalha,
    locais: emp.locais.length, especificacoes: todas.length, semLocal: emp.especificacoesSemLocal.length,
    provs, hachuras: hachuras.length, comConfirmacao: comConfirmacao.length, naNoJson,
    hachura: umaHachura && {
      categoria: umaHachura.categoria, produto: umaHachura.produto, descricao: umaHachura.descricao,
      dimensao: umaHachura.dimensao, localNome: umaHachura.localNome, confianca: umaHachura.confianca,
      status: umaHachura.status, origemClasse: umaHachura.origemClasse,
      motor: umaHachura.evidencias[0].proveniencia,
      texto: (umaHachura.evidencias[0].texto || '').slice(0, 90),
      temNivel2: !!umaHachura.evidencias[0].regiao, temNivel3: !!umaHachura.evidencias[0].coordenadas,
    },
    confirmada: umaConfirmada && {
      codigoOrigem: umaConfirmada.codigoOrigem, descricao: (umaConfirmada.descricao || '').slice(0, 40),
      evidencias: umaConfirmada.evidencias.length,
      motores: umaConfirmada.evidencias.map(e => e.proveniencia.motor_ia),
    },
  };
});
nota('chamadas ao BFF', r.chamadas);
nota('tempo da folha', r.ms + ' ms');
nota('locais / especificações / sem local', `${r.locais} / ${r.especificacoes} / ${r.semLocal}`);
nota('proveniências', JSON.stringify(r.provs));
nota('achados só de imagem (hachura)', r.hachuras);
nota('itens confirmados pelas duas leituras', r.comConfirmacao);
nota('exemplo de hachura', JSON.stringify(r.hachura));
nota('exemplo de confirmação', JSON.stringify(r.confirmada));

ok(r.chamadas === r.locais, `deveria ser uma chamada por local: ${r.chamadas} chamadas para ${r.locais} locais`);
ok(r.provs['multimodal_gemini/leitura_por_imagem'] > 0, 'nenhuma evidência multimodal gravada');
ok(r.provs['fallback_vetorial/forma_numero_legenda'] > 0, 'a leitura vetorial deixou de existir (não deveria)');
ok(r.hachuras > 0, 'nenhum achado exclusivo de imagem');
ok(r.comConfirmacao > 0, 'nenhuma tag confirmada pelas duas leituras');
ok(r.hachura && r.hachura.motor.motor_ia === 'multimodal_gemini' && r.hachura.motor.metodo === 'leitura_por_imagem',
  'proveniência da hachura errada: ' + JSON.stringify(r.hachura && r.hachura.motor));
ok(r.hachura && r.hachura.temNivel2 && r.hachura.temNivel3, 'a evidência da IA precisa dos 3 níveis');
ok(r.hachura && r.hachura.texto.startsWith('[SIMULADO]'), 'a justificativa da IA deveria ser o texto da evidência');
ok(!r.naNoJson, 'apareceu "N/A" na árvore — o saneamento falhou');
ok(r.confirmada && r.confirmada.evidencias >= 2 && r.confirmada.motores.includes('fallback_vetorial')
  && r.confirmada.motores.includes('multimodal_gemini'), 'a confirmação deveria somar as duas evidências');

/* ---------- 3. exportação enxerga o motor ---------- */
const exp = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const X = await import('./js/core/exporter.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  const emp = M.empreendimentoVazio('Teste export IA', 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer()));
  const meta = { id: 'd1', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  await eng.consolidar(emp, await eng.analisarFolha(doc, 1, meta, () => {}), meta);
  const aba = X.abaEvidencias(emp);
  const i = aba[0].indexOf('Motor de IA / Proveniência');
  const cont = {};
  for (const l of aba.slice(1)) { const v = l[i] || '(vazio)'; cont[v] = (cont[v] || 0) + 1; }
  return { motores: cont, linhas: aba.length - 1 };
});
nota('aba Evidências por motor', JSON.stringify(exp.motores));
ok(exp.motores['multimodal_gemini'] > 0, 'a planilha não mostra o motor multimodal');
ok(!exp.motores['(vazio)'], 'evidência sem motor na planilha');

/* ---------- 4. timeout → fallback gracioso ---------- */
const lento = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  eng.configurarIA({ provedor: 'multimodal_gemini', bff: 'http://localhost:3011', timeoutMs: 700, maxFalhas: 99, lerLocaisSemTag: false, lerQuadrosComIA: false });
  const emp = M.empreendimentoVazio('Timeout', 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer()));
  const meta = { id: 'd2', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  await eng.consolidar(emp, await eng.analisarFolha(doc, 1, meta, () => {}), meta);
  const todas = M.todasEspecificacoes(emp);
  const motores = [...new Set(todas.flatMap(e => e.evidencias.map(v => v.proveniencia.motor_ia)))];
  return { especificacoes: todas.length, locais: emp.locais.length, motores, erro: eng.IA.ultimoErro };
});
nota('com timeout: especificações', `${lento.especificacoes} em ${lento.locais} locais`);
nota('com timeout: motores', JSON.stringify(lento.motores));
nota('com timeout: último erro', lento.erro && lento.erro.mensagem);
ok(lento.especificacoes > 100, `o processamento não pode perder itens no timeout: ${lento.especificacoes}`);
ok(lento.motores.length === 1 && lento.motores[0] === 'fallback_vetorial', 'deveria cair inteiro no vetorial');
ok(/tempo limite/.test((lento.erro && lento.erro.mensagem) || ''), 'o erro registrado não é de timeout');

/* ---------- 5. servidor quebrado → desliga depois de N falhas ---------- */
const quebrado = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  eng.configurarIA({ provedor: 'multimodal_gemini', bff: 'http://localhost:3012', timeoutMs: 8000, maxFalhas: 3, paralelas: 1, lerLocaisSemTag: false, lerQuadrosComIA: false });
  const antes = eng.IA.chamadas;
  const emp = M.empreendimentoVazio('Quebrado', 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer()));
  const meta = { id: 'd3', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  await eng.consolidar(emp, await eng.analisarFolha(doc, 1, meta, () => {}), meta);
  return {
    especificacoes: M.todasEspecificacoes(emp).length, locais: emp.locais.length,
    chamadas: eng.IA.chamadas - antes, desligado: eng.IA.desligadoPorFalha, erro: eng.IA.ultimoErro,
  };
});
nota('BFF quebrado: especificações', `${quebrado.especificacoes} em ${quebrado.locais} locais`);
nota('BFF quebrado: chamadas antes de desistir', quebrado.chamadas);
nota('BFF quebrado: desligou o motor', quebrado.desligado);
ok(quebrado.especificacoes > 100, 'o processamento não pode perder itens com o BFF fora');
ok(quebrado.desligado === true, 'o motor deveria se desligar depois das falhas seguidas');
ok(quebrado.chamadas <= 4, `não deveria insistir em todos os locais: ${quebrado.chamadas} chamadas`);

/* ---------- 6. servidor inexistente ---------- */
const morto = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  eng.configurarIA({ provedor: 'multimodal_gemini', bff: 'http://localhost:3999', timeoutMs: 4000, maxFalhas: 2, paralelas: 1, lerLocaisSemTag: false, lerQuadrosComIA: false });
  const emp = M.empreendimentoVazio('Sem servidor', 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer()));
  const meta = { id: 'd4', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  await eng.consolidar(emp, await eng.analisarFolha(doc, 1, meta, () => {}), meta);
  return { especificacoes: M.todasEspecificacoes(emp).length, saude: await eng.saudeDaIA(), erro: eng.IA.ultimoErro };
});
nota('sem servidor: especificações', morto.especificacoes);
nota('sem servidor: saudeDaIA', JSON.stringify(morto.saude));
ok(morto.especificacoes > 100, 'o processamento não pode parar sem o BFF');
ok(morto.saude === null, 'saudeDaIA deveria devolver null sem servidor');

/* ---------- 7. volta ao vetorial: nada muda ---------- */
const puro = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  eng.configurarIA({ provedor: 'fallback_vetorial' });
  const antes = eng.IA.chamadas;
  const emp = M.empreendimentoVazio('Vetorial', 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer()));
  const meta = { id: 'd5', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  await eng.consolidar(emp, await eng.analisarFolha(doc, 1, meta, () => {}), meta);
  const todas = M.todasEspecificacoes(emp);
  return {
    locais: emp.locais.length, especificacoes: todas.length, semLocal: emp.especificacoesSemLocal.length,
    chamadas: eng.IA.chamadas - antes,
    motores: [...new Set(todas.flatMap(e => e.evidencias.map(v => v.proveniencia.motor_ia)))],
  };
});
nota('vetorial puro', JSON.stringify(puro));
ok(puro.chamadas === 0, 'com o provedor no vetorial não se chama o BFF');
ok(puro.locais === 37 && puro.especificacoes === 148 && puro.semLocal === 14,
  `a linha de base vetorial mudou: ${puro.locais}/${puro.especificacoes}/${puro.semLocal}`);

console.log('\nAVISOS DE FALLBACK (amostra):');
for (const a of [...new Set(avisos)].slice(0, 4)) console.log('  ·', a);
if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log('  -', f); }
else console.log('\nTODAS AS VERIFICAÇÕES PASSARAM');
console.log('ERROS DE PÁGINA:', erros.slice(0, 4));

await b.close(); srv.close();
for (const p of [bff, bffLento, bffQuebrado]) p.kill();
process.exit(falhas.length ? 1 : 0);
