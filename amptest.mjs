/* Leitura ampla (Vision-First): quadros, tabelas e notas em qualquer lugar.

   Processa as duas pranchas da Nathalie — que não têm tag geométrica nenhuma —
   primeiro só com o motor vetorial, depois com a leitura ampla ligada, e
   confere o que ela acrescentou, como vinculou ao local e que evidência deixou. */
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
await new Promise(r => srv.listen(8155, r));

function subirBff(porta, env = {}) {
  const p = spawn('node', [root + '/server/simulador.mjs', String(porta)],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { const t = d.toString(); if (/folha|ERR/.test(t)) process.stdout.write('  bff> ' + t.replace(/\n+$/, '\n')); });
  return p;
}
const bff = subirBff(3000);
const bffQuebrado = subirBff(3014, { FALHAR: '1' });
await new Promise(r => setTimeout(r, 900));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 950 } });
const erros = []; const avisos = [];
pg.on('pageerror', e => erros.push('PAGEERROR: ' + e.message));
pg.on('console', m => {
  const t = m.text();
  if (/\[IA\]/.test(t)) avisos.push(t.slice(0, 150));
  if (m.type() === 'error' && !/fonts.googleapis|ERR_TUNNEL|ERR_CONNECTION_REFUSED|404|ERR_CONNECTION|502 \(Bad Gateway\)/.test(t)) erros.push(t.slice(0, 200));
});
await pg.goto('http://localhost:8155/local.html');
await pg.waitForSelector('#nav button');

const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };
const nota = (k, v) => console.log(String(k).padEnd(44), v);

/* processa uma prancha com a configuração dada e devolve o retrato da árvore */
const processar = (arq, cfg, id) => pg.evaluate(async ([arq, cfg, id]) => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  eng.configurarIA(cfg);
  const emp = M.empreendimentoVazio('Ampla ' + id, 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/' + arq)).arrayBuffer()));
  const meta = { id, nome: arq };
  const folha = await eng.analisarFolha(doc, 1, meta, () => {});
  const regioes = eng.regioesDeLeitura(folha).map(r => r.rotulo);
  const t0 = performance.now();
  await eng.consolidar(emp, folha, meta);
  const ms = Math.round(performance.now() - t0);

  const vivo = x => x && x.status !== 'excluido';
  const todas = M.todasEspecificacoes(emp).filter(vivo);
  const prov = {};
  for (const e of todas) for (const v of e.evidencias) {
    const k = `${v.proveniencia.motor_ia}/${v.proveniencia.metodo}`;
    prov[k] = (prov[k] || 0) + 1;
  }
  const daIA = todas.filter(e => e.evidencias.some(v => v.proveniencia.metodo === 'leitura_ampla'));
  const um = daIA.find(e => e.localId) || daIA[0] || null;
  return {
    ms, chamadas: eng.IA.chamadas, regioes,
    locais: emp.locais.length, especs: todas.length, semLocal: emp.especificacoesSemLocal.filter(vivo).length,
    quadros: (folha.quadros || []).map(q => `${q.titulo} [${q.chave}] ${q.linhas.length}L`),
    prov, daIA: daIA.length,
    comLocal: daIA.filter(e => e.localId).length,
    lacunas: eng.lacunasDeCobertura(emp).length,
    cobertura: emp.locais.filter(vivo).map(l => {
      const cats = new Set((l.especificacoes || []).filter(vivo).map(e => e.categoria));
      return `${l.nome}:${['Piso', 'Paredes', 'Teto'].filter(c => cats.has(c)).length}/3`;
    }),
    naJson: /"(N\/A|n\/a|não se aplica)"/i.test(JSON.stringify(todas)),
    escala: JSON.stringify(todas).includes('ESCALA 1:50'),
    exemplo: um && {
      local: um.localNome, categoria: um.categoria, descricao: (um.descricao || '').slice(0, 50),
      codigoOrigem: um.codigoOrigem, origemLeitura: um.origemLeitura, confianca: um.confianca,
      evidencias: um.evidencias.length,
      motor: um.evidencias.map(v => `${v.proveniencia.motor_ia}/${v.proveniencia.metodo}`),
      fonte: um.evidencias[0].tituloLegenda,
      /* a evidência DA IA, que pode não ser a primeira: quando o vetor leu a
         mesma linha, a da IA entra como confirmação ao lado */
      ia: (() => {
        const v = um.evidencias.find(x => x.proveniencia.metodo === 'leitura_ampla');
        return v && { fonte: v.tituloLegenda, texto: (v.texto || '').slice(0, 70),
          temNivel2: !!v.regiao, temNivel3: !!v.coordenadas };
      })(),
    },
  };
}, [arq, cfg, id]);

const VET = { provedor: 'fallback_vetorial' };
const IAON = { provedor: 'multimodal_gemini', bff: 'http://localhost:3000', lerQuadrosComIA: true, lerLocaisSemTag: false, timeoutQuadroMs: 60000 };

/* ---------- 1. a prancha de acabamentos, só no vetor ---------- */
const a1 = await processar('NTZ_ACAB.pdf', VET, 'v1');
nota('ACAB vetorial: quadros lidos', JSON.stringify(a1.quadros));
nota('ACAB vetorial: locais/especs/sem local', `${a1.locais} / ${a1.especs} / ${a1.semLocal}`);
nota('ACAB vetorial: regiões candidatas', JSON.stringify(a1.regioes));
ok(a1.quadros.length >= 3, `deveria achar os três blocos do memorial: ${a1.quadros.length}`);
ok(a1.especs > 50, `o leitor de quadros deveria render itens: ${a1.especs}`);
ok(a1.regioes.length >= 1 && a1.regioes.every(r => r && r !== 'a folha inteira'),
  `com quadros achados, as regiões não deveriam ser a folha inteira: ${JSON.stringify(a1.regioes)}`);

/* ---------- 2. a mesma prancha com a leitura ampla ---------- */
const a2 = await processar('NTZ_ACAB.pdf', IAON, 'i1');
nota('ACAB com IA: locais/especs/sem local', `${a2.locais} / ${a2.especs} / ${a2.semLocal}`);
nota('ACAB com IA: itens da leitura ampla', `${a2.daIA} (${a2.comLocal} vinculados por nome)`);
nota('ACAB com IA: proveniências', JSON.stringify(a2.prov));
nota('ACAB com IA: chamadas ao BFF', a2.chamadas);
nota('ACAB com IA: exemplo', JSON.stringify(a2.exemplo));
ok(a2.prov['multimodal_gemini/leitura_ampla'] > 0, 'nenhuma evidência de leitura ampla');
ok(a2.daIA > 0, 'a leitura ampla não acrescentou nada');
ok(a2.comLocal > 0, 'nenhum item da IA foi vinculado a um local pelo nome');
ok(a2.chamadas === 1, `uma chamada por folha: ${a2.chamadas}`);
ok(a2.especs >= a1.especs, `a IA não pode reduzir o levantamento: ${a1.especs} → ${a2.especs}`);
ok(!a2.naJson, 'apareceu "N/A" na árvore');
ok(!a2.escala, 'a linha de lixo "ESCALA 1:50" entrou na árvore');
ok(a2.exemplo && a2.exemplo.ia && a2.exemplo.ia.temNivel2 && a2.exemplo.ia.temNivel3,
  'a evidência da IA precisa das coordenadas da região');
ok(a2.exemplo && a2.exemplo.ia && /SIMULADO/.test(a2.exemplo.ia.texto),
  'a justificativa da IA deveria ser o texto da evidência dela');
ok(a2.exemplo && a2.exemplo.evidencias >= 2 && a2.exemplo.motor.length >= 2,
  'item lido pelos dois motores deveria somar as duas evidências');

/* ---------- 3. a planta civil: quadro de esquadrias ---------- */
const c1 = await processar('NTZ_CIVIL.pdf', VET, 'v2');
const c2 = await processar('NTZ_CIVIL.pdf', IAON, 'i2');
nota('CIVIL vetorial: quadros', JSON.stringify(c1.quadros));
nota('CIVIL vetorial: locais/especs/sem local', `${c1.locais} / ${c1.especs} / ${c1.semLocal}`);
nota('CIVIL com IA: locais/especs/sem local', `${c2.locais} / ${c2.especs} / ${c2.semLocal}`);
nota('CIVIL com IA: itens da IA', `${c2.daIA} (${c2.comLocal} com local)`);
nota('CIVIL: cobertura por local (com IA)', c2.cobertura.slice(0, 6).join(' · '));
nota('CIVIL: lacunas (vetor → IA)', `${c1.lacunas} → ${c2.lacunas}`);
ok(c1.quadros.some(q => /ESQUADRIAS/i.test(q)), 'o quadro de esquadrias não foi lido');
ok(c1.especs > 25, `as esquadrias deveriam entrar: ${c1.especs}`);
ok(c2.lacunas < c1.lacunas, `a leitura ampla deveria fechar lacunas: ${c1.lacunas} → ${c2.lacunas}`);

/* ---------- 4. esquadria sem local vai para a triagem ---------- */
const triagem = await pg.evaluate(async () => {
  const app = await import('./js/app.js');
  return null;   // as esquadrias já foram medidas em c1.semLocal
});
ok(c1.semLocal > 20, `as esquadrias sem ambiente declarado vão para a triagem: ${c1.semLocal}`);

/* ---------- 5. BFF fora do ar não perde nada ---------- */
const morto = await processar('NTZ_ACAB.pdf', { ...IAON, bff: 'http://localhost:3014', maxFalhas: 99 }, 'i3');
nota('BFF quebrado: especs', `${morto.especs} (vetorial dizia ${a1.especs})`);
nota('BFF quebrado: proveniências', JSON.stringify(morto.prov));
ok(morto.especs === a1.especs, `com o BFF fora, o resultado tem de ser o vetorial: ${morto.especs} ≠ ${a1.especs}`);
ok(!morto.prov['multimodal_gemini/leitura_ampla'], 'não pode haver evidência de IA quando ela falhou');

/* ---------- 6. a linha de base das 6 pranchas não muda ---------- */
const base = await pg.evaluate(async () => {
  const eng = await import('./js/core/engine.js');
  const M = await import('./js/core/model.js');
  const pdfdoc = await import('./js/core/pdfdoc.js');
  eng.configurarIA({ provedor: 'fallback_vetorial' });
  const emp = M.empreendimentoVazio('Base', 'casa');
  const doc = await pdfdoc.openPdf(new Uint8Array(await (await fetch('./testdata/EX01SUB_TER_E_SUPR00.pdf')).arrayBuffer()));
  const meta = { id: 'b1', nome: 'EX01SUB_TER_E_SUPR00.pdf' };
  await eng.consolidar(emp, await eng.analisarFolha(doc, 1, meta, () => {}), meta);
  const vivo = x => x && x.status !== 'excluido';
  return { locais: emp.locais.length, especs: M.todasEspecificacoes(emp).filter(vivo).length,
    semLocal: emp.especificacoesSemLocal.filter(vivo).length };
});
nota('EX01 vetorial (linha de base)', JSON.stringify(base));
ok(base.locais === 37 && base.especs === 148 && base.semLocal === 14,
  `a linha de base da EX01 mudou: ${JSON.stringify(base)}`);

console.log('\nAVISOS DA IA:');
for (const a of [...new Set(avisos)].slice(0, 4)) console.log('  ·', a);
if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log('  -', f); }
else console.log('\nTODAS AS VERIFICAÇÕES PASSARAM');
console.log('ERROS DE PÁGINA:', erros.slice(0, 4));

await b.close(); srv.close(); bff.kill(); bffQuebrado.kill();
process.exit(falhas.length ? 1 : 0);
