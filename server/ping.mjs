/* Confere se o BFF está no ar e se responde no formato que o engine espera.
   Uso:  node ping.mjs  [http://localhost:3000] */

const base = process.argv[2] || process.env.BFF || 'http://localhost:3000';

/* JPEG 8x8 cinza — só para o servidor ter uma imagem válida para validar. */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMEBQYHCAkKCxITFBUWFxgZGiMkJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AJoAAAAAAAAAAAD/2Q==';

const esperado = ['categoria', 'produto', 'descricao', 'codigoOrigem', 'origemLeitura', 'confianca', 'justificativa'];
const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };

try {
  const saude = await (await fetch(base + '/api/health')).json();
  console.log('SAÚDE   ', JSON.stringify(saude));
  ok(saude.ok === true, 'health não respondeu ok');

  const t0 = Date.now();
  const r = await fetch(base + '/api/vision/process-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      local: { nome: 'B.SERVIÇO', pavimento: 'SUBSOLO', area: '2.11m²' },
      documento: 'EX01SUB_TER_E_SUPR00.pdf', pagina: 1,
      imagemLocal: JPEG, imagemLegenda: JPEG,
      vetor: {
        tags: [{ forma: 'quadrado', numero: '01' }, { forma: 'triangulo', numero: '02' }],
        legenda: [
          { forma: 'quadrado', numero: '01', titulo: 'PISOS', categoria: 'Piso', descricao: 'PORCELANATO FLAKES SBE NAT CEUSA (120X120) OU SIMILAR' },
          { forma: 'triangulo', numero: '02', titulo: 'PAREDES', categoria: 'Paredes', descricao: 'PORCELANATO FLAKES SBE NAT CEUSA (120X120) OU SIMILAR' },
        ],
      },
    }),
  });
  const b = await r.json();
  console.log('STATUS  ', r.status, '·', Date.now() - t0, 'ms');
  console.log('CORPO   ', JSON.stringify({ ...b, especificacoes: `[${(b.especificacoes || []).length}]` }));

  if (r.status === 503) {
    console.log('\nO servidor está no ar, mas sem GEMINI_API_KEY.');
    console.log('Para testar a ligação inteira sem gastar cota:  npm run simular');
    process.exit(0);
  }

  ok(r.ok, `status ${r.status}: ${b.erro || ''}`);
  ok(Array.isArray(b.especificacoes), 'especificacoes não é array');
  const proibido = /^\s*(n\/a|na|não se aplica|nao se aplica|-{1,2})\s*$/i;
  for (const e of (b.especificacoes || [])) {
    for (const c of esperado) ok(c in e, `campo ausente: ${c}`);
    for (const [k, v] of Object.entries(e)) ok(!(typeof v === 'string' && proibido.test(v)), `campo "${k}" com "${v}"`);
  }
  for (const e of (b.especificacoes || [])) {
    console.log('  ·', (e.origemLeitura + '').padEnd(8), (e.codigoOrigem || '—').padEnd(14),
      (e.categoria || '—').padEnd(12), (e.descricao || '').slice(0, 44));
    console.log('     ↳', (e.justificativa || '').slice(0, 110));
  }
} catch (err) {
  falhas.push('não foi possível falar com o BFF: ' + err.message);
}

if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log('  -', f); process.exit(1); }
console.log('\nBFF respondendo no contrato esperado pelo engine.');
