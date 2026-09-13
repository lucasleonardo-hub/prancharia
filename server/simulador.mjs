/* Simulador do BFF — mesmo contrato, zero dependências.

   Serve para duas coisas:
     1. testar a ligação do frontend antes de ter chave do Gemini ou de rodar
        `npm install` (roda só com o Node instalado);
     2. desenvolver a interface do motor multimodal sem gastar cota.

   Uso:   node simulador.mjs            (porta 3000)
          node simulador.mjs 3001
          LENTO=8000 node simulador.mjs     simula demora, para testar timeout
          FALHAR=1 node simulador.mjs       responde 502, para testar o fallback

   As respostas do GEMINI são as mesmas do server.js em SIMULAR=1: as tags que
   o vetor já mandou, traduzidas pela legenda recebida, mais um achado de
   hachura que só a imagem veria — é ele que prova que o caminho novo está
   funcionando.

   AS ROTAS DE DADOS, NÃO. Empresas, projetos, glossário e upload de prancha
   são REAIS aqui: este arquivo importa o mesmo `db.js` e o mesmo
   `armazenamento.js` que o server.js usa. Só o modelo é de mentira. É o que
   permite rodar o Prancharia inteiro na nuvem sem `npm install` — o que vale
   tanto para testar quanto para uma máquina de escritório sem compilador. */

import http from 'node:http';
import { sanear, sanearMemorial, sanearQuadro, CATEGORIAS, blocoDeEmpresa } from './prompt.js';
import * as banco from './db.js';
import armazenamento, { lerMultipart } from './armazenamento.js';

const PORTA = Number(process.argv[2] || process.env.PORT || 3000);
const LENTO = Number(process.env.LENTO || 0);
const FALHAR = /^(1|true|sim)$/i.test(process.env.FALHAR || '');

const CABECA = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Empresa-Id',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
};
const LIMITE_UPLOAD = Number(process.env.UPLOAD_MAX_BYTES || 64 * 1024 * 1024);

/* --- utilidades das rotas de dados --- */
const enviar = (res, codigo, corpo) => { res.writeHead(codigo, CABECA); res.end(JSON.stringify(corpo)); };
const corpoJson = (req) => new Promise((ok) => {
  const p = []; req.on('data', c => p.push(c));
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(p).toString('utf8') || '{}')); } catch { ok({}); } });
});
const caminho = (req) => new URL(req.url, 'http://x').pathname;
const busca = (req) => new URL(req.url, 'http://x').searchParams;

/** Lê a empresa que a requisição pediu — igual ao server.js, sem lançar. */
async function empresaDaRequisicao(corpo, req) {
  const id = (corpo && (corpo.companyId || corpo.empresaId)) || req.headers['x-empresa-id'] || '';
  if (!id) return null;
  try { return await banco.lerEmpresa(String(id)); } catch { return null; }
}

/**
 * As rotas de dados. Devolve true quando atendeu — o roteador do Gemini abaixo
 * continua exatamente como estava.
 */
async function rotasDeDados(req, res) {
  const rota = caminho(req), metodo = req.method;
  const m = (re) => re.exec(rota);

  if (metodo === 'GET' && rota === '/api/companies') {
    enviar(res, 200, { ok: true, empresas: await banco.listarEmpresas() }); return true;
  }
  if (metodo === 'GET' && m(/^\/api\/companies\/([^/]+)$/)) {
    const e = await banco.lerEmpresa(decodeURIComponent(m(/^\/api\/companies\/([^/]+)$/)[1]));
    enviar(res, e ? 200 : 404, e ? { ok: true, empresa: e } : { ok: false, erro: 'empresa não encontrada' }); return true;
  }
  if (metodo === 'GET' && m(/^\/api\/companies\/([^/]+)\/prompt$/)) {
    const e = await banco.lerEmpresa(decodeURIComponent(m(/^\/api\/companies\/([^/]+)\/prompt$/)[1]));
    if (!e) { enviar(res, 404, { ok: false, erro: 'empresa não encontrada' }); return true; }
    const bloco = blocoDeEmpresa(e);
    enviar(res, 200, { ok: true, bloco, caracteres: bloco.length }); return true;
  }
  if (metodo === 'POST' && /^\/api\/companies(\/[^/]+)?$/.test(rota)) {
    const corpo = await corpoJson(req);
    const id = rota.split('/')[3];
    const empresa = await banco.salvarEmpresa(id ? { ...corpo, id: decodeURIComponent(id) } : corpo);
    console.log(`ok   empresa "${empresa.nome}" salva (${empresa.fornecedoresHomologados.length} fornecedor(es), ${empresa.vocabulario.length} termo(s))`);
    enviar(res, 200, { ok: true, empresa }); return true;
  }
  if (metodo === 'DELETE' && m(/^\/api\/companies\/([^/]+)$/)) {
    enviar(res, 200, { ok: await banco.apagarEmpresa(decodeURIComponent(m(/^\/api\/companies\/([^/]+)$/)[1])) }); return true;
  }

  if (metodo === 'GET' && m(/^\/api\/projects\/([^/]+)\/files$/)) {
    const id = decodeURIComponent(m(/^\/api\/projects\/([^/]+)\/files$/)[1]);
    enviar(res, 200, { ok: true, arquivos: await banco.listarArquivosDoProjeto(id) }); return true;
  }
  if (metodo === 'GET' && rota === '/api/projects') {
    const q = busca(req);
    enviar(res, 200, { ok: true, projetos: await banco.listarProjetos({
      empresaId: q.get('companyId') || q.get('empresaId') || null,
      limite: Math.min(Number(q.get('limit')) || 200, 500) }) }); return true;
  }
  if (metodo === 'GET' && m(/^\/api\/projects\/([^/]+)$/)) {
    const p = await banco.lerProjeto(decodeURIComponent(m(/^\/api\/projects\/([^/]+)$/)[1]));
    enviar(res, p ? 200 : 404, p ? { ok: true, projeto: p } : { ok: false, erro: 'projeto não encontrado' }); return true;
  }
  if (metodo === 'POST' && rota === '/api/projects') {
    const corpo = await corpoJson(req);
    const emp = corpo.projeto || corpo;
    if (!emp || !emp.id) { enviar(res, 400, { ok: false, erro: 'projeto sem id' }); return true; }
    const r = await banco.salvarProjeto(emp);
    console.log(`ok   projeto "${emp.nome || emp.id}" gravado · ${(r.bytes / 1024).toFixed(0)} KB`);
    enviar(res, 200, { ok: true, ...r }); return true;
  }
  if (metodo === 'DELETE' && m(/^\/api\/projects\/([^/]+)$/)) {
    enviar(res, 200, { ok: await banco.apagarProjeto(decodeURIComponent(m(/^\/api\/projects\/([^/]+)$/)[1])) }); return true;
  }

  if (metodo === 'GET' && rota === '/api/glossary') {
    const id = busca(req).get('companyId') || busca(req).get('empresaId') || null;
    enviar(res, 200, { ok: true, regras: await banco.lerGlossario(id), escopo: id || 'global' }); return true;
  }
  if (metodo === 'POST' && rota === '/api/glossary') {
    const { regras = [], companyId = null, empresaId = null } = await corpoJson(req);
    const alvo = companyId || empresaId || null;
    await banco.salvarGlossario(regras, alvo);
    enviar(res, 200, { ok: true, escopo: alvo || 'global', regras: regras.length }); return true;
  }

  if (metodo === 'POST' && rota === '/api/upload') {
    let pacote;
    try { pacote = await lerMultipart(req, { limiteBytes: LIMITE_UPLOAD }); }
    catch (err) { enviar(res, /limite/.test(err.message) ? 413 : 400, { ok: false, erro: err.message }); return true; }
    const arquivo = pacote.arquivos.find(a => a.campo === 'arquivo' || a.campo === 'file') || pacote.arquivos[0];
    if (!arquivo) { enviar(res, 400, { ok: false, erro: 'nenhum arquivo no formulário' }); return true; }
    const g = await armazenamento.put(arquivo.bytes, { tipo: arquivo.tipo, nome: arquivo.nome });
    const meta = await banco.registrarArquivo({
      id: pacote.campos.arquivoId || undefined, projetoId: pacote.campos.projetoId || null,
      nome: pacote.campos.nome || arquivo.nome, tipo: arquivo.tipo,
      bytes: g.bytes, sha256: g.sha256, chave: g.chave });
    console.log(`ok   upload ${(g.bytes / 1048576).toFixed(2)} MB | ${meta.nome.slice(0, 36)} | ${g.sha256.slice(0, 10)}`);
    enviar(res, 200, { ok: true, arquivo: { ...meta, url: armazenamento.url(g.chave, meta) } }); return true;
  }
  if (metodo === 'GET' && m(/^\/api\/files\/([^/]+)$/)) {
    const meta = await banco.lerArquivoMeta(decodeURIComponent(m(/^\/api\/files\/([^/]+)$/)[1]));
    if (!meta) { enviar(res, 404, { ok: false, erro: 'arquivo não encontrado' }); return true; }
    let bytes;
    try { bytes = await armazenamento.get(meta.chave); }
    catch { enviar(res, 410, { ok: false, erro: 'bytes fora do armazenamento' }); return true; }
    res.writeHead(200, { ...CABECA, 'Content-Type': meta.tipo || 'application/octet-stream',
      'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=86400, immutable' });
    res.end(bytes); return true;
  }
  return false;
}

function respostaSimulada(vetor = {}, local = {}) {
  const tags = vetor.tags || [];
  const leg = vetor.legenda || [];
  const acha = t => leg.find(x => x.forma === t.forma && String(x.numero) === String(t.numero));
  const out = tags.map(t => {
    const i = acha(t) || {};
    return {
      categoria: CATEGORIAS.includes(i.categoria) ? i.categoria : '',
      produto: '', sistema: '', descricao: i.descricao || '',
      marca: '', modelo: '', fornecedor: '',
      codigoOrigem: `${t.forma} ${t.numero}`, forma: t.forma, numero: String(t.numero),
      dimensao: '', peitoril: '', quantidade: '',
      origemLeitura: 'tag', confianca: i.descricao ? 'alta' : 'baixa',
      justificativa: `[SIMULADO] ${t.forma} ${t.numero} visto no recorte de ${local.nome || 'local'}`
        + (i.descricao ? ` → ${i.titulo || 'legenda'} → ${i.descricao}` : ' → sem linha de legenda'),
    };
  });
  out.push({
    categoria: 'Piso', produto: 'Porcelanato', sistema: '',
    descricao: 'HACHURA SIMULADA — PADRÃO PAGINADO 120X120',
    marca: '', modelo: '', fornecedor: '',
    codigoOrigem: '', forma: '', numero: '', dimensao: '120X120', peitoril: '', quantidade: '',
    origemLeitura: 'hachura', confianca: 'media',
    justificativa: `[SIMULADO] área de ${local.nome || 'local'} preenchida com trama paginada → amostra da legenda de pisos`,
  });
  /* e uma linha que o saneamento tem de derrubar: prova a trava da R2 */
  out.push({ categoria: 'Teto', produto: 'N/A', descricao: 'n/a', codigoOrigem: '-', origemLeitura: 'tag', confianca: 'alta', justificativa: '-' });
  return out;
}

/* Fusão semântica de mentira: casa a categoria da especificação com a linha
   correspondente da seção daquele local no memorial, citando o trecho real. */
function memorialSimulado(locais, paginas) {
  const texto = paginas.map(p => ({ pagina: p.pagina, linhas: String(p.texto || '').split('\n') }));
  const PADRAO = {
    Piso: /^piso/i, Paredes: /^(parede|pintura|textura)/i, Teto: /^(teto|forro)/i,
    Bancadas: /^(bancada|tampo)/i, Esquadrias: /^(esquadria|porta|janela)/i,
    Metais: /^(metais|torneira)/i,
    'Revestimentos em Pedras Naturais': /^(soleira|peitoril|pingadeira|pedra)/i,
  };
  const achaTrecho = (nomeLocal, categoria) => {
    const alvo = PADRAO[categoria];
    if (!alvo) return null;
    for (const p of texto) {
      let dentro = false;
      for (const l of p.linhas) {
        const t = l.trim();
        if (!t) continue;
        if (t === t.toUpperCase() && t.length < 46) {
          dentro = t.replace(/[:–—-]\s*$/, '').toUpperCase() === String(nomeLocal).toUpperCase();
          continue;
        }
        if (dentro && alvo.test(t)) return { pagina: p.pagina, trecho: t };
      }
    }
    return null;
  };
  const out = [];
  for (const loc of locais) {
    for (const e of (loc.especificacoes || [])) {
      const f = achaTrecho(loc.nome, e.categoria);
      if (!f) continue;
      const marca = /marca\s*:\s*([^;.]+)/i.exec(f.trecho);
      const conflito = /madeira/i.test(f.trecho) && /porcelanato|cer[âa]mic/i.test(e.descricao || '');
      out.push({
        especificacaoId: e.id,
        acao: conflito ? 'conflito' : 'enriquecer',
        produto: '', sistema: '',
        marca: conflito ? '' : (marca ? marca[1].trim() : ''),
        modelo: '', fornecedor: '', descricaoMemorial: '',
        conflitoPrancha: conflito ? (e.descricao || '') : '',
        conflitoMemorial: conflito ? f.trecho : '',
        pagina: f.pagina, trecho: f.trecho,
        justificativa: `[SIMULADO] seção ${loc.nome} do memorial, linha de ${e.categoria}`,
        confianca: marca ? 'alta' : 'media',
      });
    }
  }
  /* uma alucinação de ID e uma atualização sem trecho: as travas M2 e M3 têm
     de derrubar as duas */
  out.push({ especificacaoId: 'esp_inexistente_999', acao: 'enriquecer', marca: 'Fantasma',
    pagina: 1, trecho: 'trecho qualquer para a trava derrubar', justificativa: '[SIMULADO] alucinação', confianca: 'alta' });
  const primeiro = (locais[0] || {}).especificacoes || [];
  if (primeiro[0]) out.push({ especificacaoId: primeiro[0].id, acao: 'enriquecer', marca: 'Sem prova',
    pagina: 1, trecho: '', justificativa: '[SIMULADO] sem trecho', confianca: 'alta' });
  return out;
}

/* Leitura ampla de mentira: um item por local × Piso/Paredes/Teto, como um
   quadro de acabamentos faria, mais uma esquadria sem local e duas linhas de
   lixo que o saneamento tem de derrubar. */
function quadroSimulado(locais, imagens) {
  const fonte = (imagens[0] && imagens[0].rotulo) || 'quadro simulado';
  const out = [];
  for (const nome of locais.slice(0, 40)) {
    for (const [cat, desc, cod] of [
      ['Piso', 'PORCELANATO SIMULADO 90X90', '1'],
      ['Paredes', 'TEXTURA SIMULADA TECIDO NOBRE', '2'],
      ['Teto', 'FORRO DE GESSO SIMULADO COM TABICA', '3'],
    ]) {
      out.push({
        local: nome, categoria: cat, produto: '', sistema: '', descricao: desc,
        marca: '', modelo: '', fornecedor: '', codigoOrigem: cod, forma: '', numero: '',
        dimensao: '', peitoril: '', quantidade: '', origemLeitura: 'quadro', fonte,
        confianca: 'alta',
        justificativa: `[SIMULADO] ${fonte}, linha ${nome}, coluna Especificação ${cat}`,
      });
    }
  }
  out.push({
    local: '', categoria: 'Esquadrias', produto: 'Porta', sistema: '',
    descricao: 'P99 — 90×210 — Abrir Simples — Madeira', marca: '', modelo: '', fornecedor: '',
    codigoOrigem: 'P99', forma: '', numero: '', dimensao: '90×210', peitoril: '', quantidade: '1',
    origemLeitura: 'quadro', fonte: 'QUADRO DE ESQUADRIAS', confianca: 'alta',
    justificativa: '[SIMULADO] quadro de esquadrias, linha P99',
  });
  out.push({ local: '', categoria: '', produto: '', descricao: 'ESCALA 1:50', origemLeitura: 'quadro', confianca: 'alta', justificativa: 'x' });
  out.push({ local: '', categoria: 'Teto', produto: 'N/A', descricao: 'n/a', origemLeitura: 'quadro', confianca: 'alta', justificativa: '-' });
  return out;
}

const servidor = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CABECA); return res.end(); }

  if (req.method === 'GET' && req.url.startsWith('/api/health')) {
    return banco.estatisticas().then(
      (bd) => enviar(res, 200, { ok: true, servico: 'prancharia-bff', modelo: 'simulado',
        chaveConfigurada: false, simulando: true, lentoMs: LENTO, falhando: FALHAR,
        banco: bd, armazenamento: armazenamento.nome, autenticacao: 'nenhuma' }),
      (e) => enviar(res, 200, { ok: true, servico: 'prancharia-bff', modelo: 'simulado',
        chaveConfigurada: false, simulando: true, banco: null, erroBanco: e.message }));
  }

  /* Dados e arquivos primeiro: são rotas reais. Só o que sobrar é do modelo. */
  if (/^\/api\/(companies|projects|glossary|upload|files)\b/.test(req.url)) {
    rotasDeDados(req, res).then((atendeu) => {
      if (!atendeu) enviar(res, 404, { ok: false, erro: 'endpoint inexistente' });
    }).catch((err) => {
      console.error('ERR ', req.method, req.url, '-', err.message);
      if (!res.headersSent) enviar(res, 500, { ok: false, erro: err.message });
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/vision/process-local')) {
    const pedacos = [];
    req.on('data', c => pedacos.push(c));
    req.on('end', async () => {
      const t0 = Date.now();
      let corpo = {};
      try { corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}'); } catch { /* corpo inválido */ }
      const { local = {}, vetor = {}, imagemLocal } = corpo;
      if (LENTO) await new Promise(r => setTimeout(r, LENTO));

      if (FALHAR) {
        res.writeHead(502, CABECA);
        console.log(`ERR  ${local.nome || '—'} · falha simulada`);
        return res.end(JSON.stringify({ ok: false, erro: 'falha simulada', especificacoes: [] }));
      }
      if (!imagemLocal) {
        res.writeHead(400, CABECA);
        console.log(`ERR  ${local.nome || '—'} · sem imagemLocal`);
        return res.end(JSON.stringify({ ok: false, erro: 'imagemLocal é obrigatória', especificacoes: [] }));
      }

      const especificacoes = sanear(respostaSimulada(vetor, local));
      const kb = Math.round(String(imagemLocal).length / 1024);
      /* o contexto da empresa é carregado de verdade, para provar que o
         caminho todo funciona — só a chamada ao modelo é que é de mentira */
      const empresa = await empresaDaRequisicao(corpo, req);
      const bloco = blocoDeEmpresa(empresa);
      console.log(`ok   ${String(Date.now() - t0).padStart(5)}ms | ${(local.nome || '—').slice(0, 24).padEnd(24)} | `
        + `${String(especificacoes.length).padStart(2)} itens | recorte ${kb} KB`
        + (empresa ? ` | ctx ${empresa.nome} (+${bloco.length}c)` : ''));
      res.writeHead(200, CABECA);
      res.end(JSON.stringify({ ok: true, motor: 'multimodal_gemini', modelo: 'simulado', ms: Date.now() - t0,
        empresa: empresa ? { id: empresa.id, nome: empresa.nome, contextoChars: bloco.length } : null,
        especificacoes }));
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/vision/process-sheet')) {
    const pedacos = [];
    req.on('data', c => pedacos.push(c));
    req.on('end', async () => {
      const t0 = Date.now();
      let corpo = {};
      try { corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}'); } catch { /* corpo inválido */ }
      const { imagens = [], locais = [] } = corpo;
      if (LENTO) await new Promise(r => setTimeout(r, LENTO));
      if (FALHAR) {
        res.writeHead(502, CABECA);
        console.log('ERR  folha · falha simulada');
        return res.end(JSON.stringify({ ok: false, erro: 'falha simulada', itens: [] }));
      }
      if (!imagens.length) {
        res.writeHead(400, CABECA);
        console.log('ERR  folha · nenhuma imagem');
        return res.end(JSON.stringify({ ok: false, erro: 'nenhuma imagem enviada', itens: [] }));
      }
      const { itens, recusadas } = sanearQuadro(quadroSimulado(locais, imagens));
      const kb = Math.round(imagens.reduce((s, i) => s + String(i.base64 || '').length, 0) / 1024);
      console.log(`ok   ${String(Date.now() - t0).padStart(5)}ms | folha ${imagens.length} img × ${locais.length} locais | `
        + `${itens.length} itens | ${kb} KB | recusadas ${JSON.stringify(recusadas)}`);
      res.writeHead(200, CABECA);
      res.end(JSON.stringify({ ok: true, motor: 'multimodal_gemini', modelo: 'simulado', ms: Date.now() - t0, recusadas, itens }));
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/text/process-memorial')) {
    const pedacos = [];
    req.on('data', c => pedacos.push(c));
    req.on('end', async () => {
      const t0 = Date.now();
      let corpo = {};
      try { corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}'); } catch { /* corpo inválido */ }
      const { locais = [], paginas = [] } = corpo;
      if (LENTO) await new Promise(r => setTimeout(r, LENTO));

      const ids = new Set();
      for (const l of locais) for (const e of (l.especificacoes || [])) if (e && e.id) ids.add(String(e.id));

      if (FALHAR) {
        res.writeHead(502, CABECA);
        console.log('ERR  memorial · falha simulada');
        return res.end(JSON.stringify({ ok: false, erro: 'falha simulada', atualizacoes: [] }));
      }
      if (!paginas.length || !ids.size) {
        res.writeHead(400, CABECA);
        const erro = !paginas.length ? 'o memorial chegou sem texto' : 'não há especificações de prancha para casar';
        console.log('ERR  memorial ·', erro);
        return res.end(JSON.stringify({ ok: false, erro, atualizacoes: [] }));
      }

      const { atualizacoes, recusadas } = sanearMemorial(memorialSimulado(locais, paginas), ids);
      console.log(`ok   ${String(Date.now() - t0).padStart(5)}ms | memorial ${paginas.length}p × ${ids.size} espec | `
        + `${atualizacoes.length} atualizações (${atualizacoes.filter(a => a.acao === 'conflito').length} conflito) | `
        + `recusadas ${JSON.stringify(recusadas)}`);
      res.writeHead(200, CABECA);
      res.end(JSON.stringify({ ok: true, motor: 'multimodal_gemini', modelo: 'simulado', ms: Date.now() - t0, lotes: 1, recusadas, atualizacoes }));
    });
    return;
  }

  res.writeHead(404, CABECA);
  res.end(JSON.stringify({ ok: false, erro: 'endpoint inexistente' }));
});

const est = await banco.iniciarBanco().then(() => banco.estatisticas()).catch(() => null);

servidor.listen(PORTA, () => {
  console.log('');
  console.log(`  Simulador do BFF em http://localhost:${PORTA}  (nenhuma chamada real ao Gemini)`);
  console.log(`  dados e arquivos REAIS · ${est ? est.motor + ' · ' + est.arquivo : 'banco indisponível'}`);
  if (est) console.log(`  ${est.empresas} empresa(s), ${est.projetos} projeto(s), ${est.arquivos} arquivo(s)`);
  if (LENTO) console.log(`  atrasando ${LENTO} ms por chamada`);
  if (FALHAR) console.log('  respondendo 502 em todas as chamadas');
  console.log('');
});
