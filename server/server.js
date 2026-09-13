/* BFF do Prancharia — a chave do Gemini, o banco dos projetos e as pranchas.

   Este servidor nasceu como ponte para o Gemini e passou a ser também o lugar
   onde os projetos moram. A regra de fronteira não mudou: NENHUMA REGRA DE
   NEGÓCIO DO FRONTEND VIVE AQUI. O engine, o casamento de tags, o saneamento
   das descrições — tudo continua no navegador. O servidor guarda, devolve e
   fala com o modelo.

   O que ele expõe agora, em três famílias:

     DADOS     GET/POST/DELETE /api/companies[/:id]
               GET/POST/DELETE /api/projects[/:id]
               GET/POST        /api/glossary
     ARQUIVOS  POST /api/upload            (multipart; os bytes da prancha)
               GET  /api/files/:id         (de volta, para outra máquina abrir)
     MODELO    POST /api/vision/process-local
               POST /api/vision/process-sheet
               POST /api/text/process-memorial

   SEM AUTENTICAÇÃO, POR DECISÃO. Quem alcança a porta, lê e escreve tudo.
   Isso é aceitável atrás de VPN ou numa rede de escritório, e é inaceitável
   num IP público. O gancho `autenticar` abaixo é o único lugar a mexer no dia
   em que isso mudar — ele já roda em todas as rotas de dados.

   O frontend roda estático no navegador: ele não pode ver a GEMINI_API_KEY.
   Então quem fala com o modelo é este processo, que expõe também:

     POST /api/vision/process-local     — a prancha, por imagem
       { local, imagemLocal, imagemLegenda, vetor, documento, pagina }
     → { ok, motor, modelo, ms, especificacoes: [ ...Especificacao ] }

     POST /api/text/process-memorial    — o memorial, por sentido
       { documento, paginas: [{ pagina, texto }], locais: [{ id, nome, especificacoes }] }
     → { ok, motor, modelo, ms, lotes, atualizacoes: [ ...Atualizacao ] }

   O contrato é estreito de propósito: o frontend manda o que já sabe e recebe
   de volta o que falta. Nenhuma regra de negócio do frontend mora aqui.

   Três garantias que este servidor dá ao frontend:
     1. nunca devolve "N/A" nem preenchimento de cortesia (prompt.sanear);
     2. sempre responde JSON, mesmo quando falha, com `ok: false` e `erro`;
     3. responde 503 quando a chave não está configurada, para o engine cair
        no motor vetorial em vez de travar o processamento da prancha.
*/

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  INSTRUCAO, SCHEMA, contexto, sanear, CATEGORIAS,
  INSTRUCAO_MEMORIAL, SCHEMA_MEMORIAL, contextoMemorial, sanearMemorial, lotesDePaginas,
  INSTRUCAO_QUADRO, SCHEMA_QUADRO, contextoQuadro, sanearQuadro,
  blocoDeEmpresa, assinaturaDeEmpresa,
} from './prompt.js';
import { gerarComCadeia, PROVEDORES_CONFIGURADOS } from './provedores.js';
import { ocrPdf, OCR_CONFIGURADO } from './ocr.js';
import * as banco from './db.js';
import armazenamento, { lerMultipart } from './armazenamento.js';

const PORTA = Number(process.env.PORT || 3000);
/* CHAVE/MODELO continuam existindo só para o /api/health e as mensagens de
   erro citarem o Gemini por nome — quem decide de fato quais provedores
   rodam é provedores.js, lendo suas próprias env vars. */
const CHAVE = (process.env.GEMINI_API_KEY || '').trim();
const MODELO = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const ALGUM_PROVEDOR = PROVEDORES_CONFIGURADOS.gemini || PROVEDORES_CONFIGURADOS.groq || PROVEDORES_CONFIGURADOS.openai;
const SIMULAR = /^(1|true|sim)$/i.test(process.env.SIMULAR || '');
const TEMPO_LIMITE = Number(process.env.GEMINI_TIMEOUT_MS || 90000);
const TEMPO_LIMITE_MEMORIAL = Number(process.env.GEMINI_TIMEOUT_MEMORIAL_MS || 180000);
/* ler um quadro inteiro devolve dezenas de linhas: é a chamada mais demorada */
const TEMPO_LIMITE_QUADRO = Number(process.env.GEMINI_TIMEOUT_QUADRO_MS || 240000);
const ORIGENS_OK = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
/* A0 em PDF vetorial dá 2–4 MB; 64 MB cobre um caderno de pranchas inteiro. */
const LIMITE_UPLOAD = Number(process.env.UPLOAD_MAX_BYTES || 64 * 1024 * 1024);

const app = express();
app.use(cors({ origin: ORIGENS_OK.includes('*') ? true : ORIGENS_OK }));
/* recorte de A0 em JPEG 900 px de largura dá ~200 KB; em base64, ~270 KB.
   50 MB cobre com folga o par de imagens e qualquer margem futura. */
app.use(express.json({ limit: '50mb' }));

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Aceita dataURL ou base64 cru e devolve o que o SDK espera. */
function paraInline(fonte, rotulo) {
  if (!fonte || typeof fonte !== 'string') return null;
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/is.exec(fonte.trim());
  const mimeType = m ? m[1] : 'image/jpeg';
  const data = m ? m[2] : fonte.replace(/^data:[^,]*,/, '').trim();
  if (data.length < 64) throw new Error(`${rotulo}: imagem vazia ou truncada`);
  return { inlineData: { mimeType, data } };
}

/** Igual à de cima, mas para qualquer arquivo (aqui, PDF) — devolve Buffer. */
function paraBuffer(fonte, rotulo) {
  if (!fonte || typeof fonte !== 'string') throw new Error(`${rotulo} ausente`);
  const m = /^data:[^;,]+;base64,(.+)$/is.exec(fonte.trim());
  const data = m ? m[1] : fonte.replace(/^data:[^,]*,/, '').trim();
  if (data.length < 64) throw new Error(`${rotulo}: arquivo vazio ou truncado`);
  return Buffer.from(data, 'base64');
}

const agora = () => Number(process.hrtime.bigint() / 1000000n);

/** Log de uma linha por chamada — é o que se lê no terminal durante o teste. */
function registrar(info) {
  const p = [
    new Date().toISOString().slice(11, 19),
    info.ok ? 'ok ' : 'ERR',
    String(info.ms).padStart(6) + 'ms',
    (info.local || '—').slice(0, 26).padEnd(26),
    String(info.itens ?? '-').padStart(3) + ' itens',
  ];
  if (info.tokens) p.push(`${info.tokens} tokens`);
  if (info.erro) p.push('· ' + info.erro);
  console.log(p.join(' | '));
}

/* ------------------------------------------------------------------ */
/* o cliente do modelo                                                 */
/* ------------------------------------------------------------------ */

const INSTRUCAO_DO_MODO = { memorial: INSTRUCAO_MEMORIAL, quadro: INSTRUCAO_QUADRO, visao: INSTRUCAO };
const SCHEMA_DO_MODO = { memorial: SCHEMA_MEMORIAL, quadro: SCHEMA_QUADRO, visao: SCHEMA };
/* Como cada modo embrulha o array quando quem responde é Groq/OpenAI (ver
   provedores.js) — a mesma chave que prompt.js/sanear() já sabe ler. */
const CHAVE_ENVOLTORIA_DO_MODO = { memorial: 'atualizacoes', quadro: 'itens', visao: 'especificacoes' };

/* Lê a empresa pedida pela requisição. Nunca lança: empresa inexistente ou
   banco fora do ar devolvem null, e a chamada segue sem contexto — perder o
   contexto da construtora é um atendimento pior, não um erro de leitura. */
async function empresaDaRequisicao(req) {
  const id = (req.body && (req.body.companyId || req.body.empresaId)) || req.get('X-Empresa-Id') || '';
  if (!id) return null;
  try { return await banco.lerEmpresa(String(id)); }
  catch (e) { console.warn('[empresa] não consegui ler', id, '-', e.message); return null; }
}

/** Uma geração, com tempo limite por tentativa. Tenta Gemini, depois Groq,
    depois OpenAI (ver provedores.js) — devolve { bruto, tokens, modelo, provedor }.

    A EMPRESA ENTRA AQUI, NO SYSTEM INSTRUCTION, e não no texto do usuário. As
    regras da construtora são política permanente da conversa, não dado de uma
    requisição — é exatamente para isso que a instrução de sistema existe, e é
    ali que ela resiste melhor ao que vem depois.

    A chave de cache do Gemini carrega a assinatura das regras: editar as
    regras de uma empresa na tela muda a assinatura e produz um modelo novo na
    chamada seguinte, sem reiniciar o servidor. */
async function gerar(modo, partes, limiteMs = TEMPO_LIMITE, empresa = null) {
  const bloco = blocoDeEmpresa(empresa);
  return gerarComCadeia({
    instrucaoSistema: (INSTRUCAO_DO_MODO[modo] || INSTRUCAO) + bloco,
    schema: SCHEMA_DO_MODO[modo] || SCHEMA,
    chaveEnvoltoria: CHAVE_ENVOLTORIA_DO_MODO[modo] || 'especificacoes',
    chaveCache: modo + '|' + (bloco ? assinaturaDeEmpresa(empresa) : ''),
    /* um quadro de 19 ambientes × 3 categorias são 57 itens: precisa de espaço */
    maxOutputTokens: modo === 'visao' ? 8192 : 16384,
    partes, limiteMs,
  });
}

/** Resposta canned para testar a ligação do frontend sem gastar cota. */
function simulado(vetor, local) {
  const tags = (vetor && vetor.tags) || [];
  const leg = (vetor && vetor.legenda) || [];
  const achaLeg = t => leg.find(x => x.forma === t.forma && String(x.numero) === String(t.numero));
  const out = tags.map(t => {
    const i = achaLeg(t) || {};
    return {
      categoria: CATEGORIAS.includes(i.categoria) ? i.categoria : '',
      produto: '', sistema: '', descricao: i.descricao || '',
      marca: '', modelo: '', fornecedor: '',
      codigoOrigem: `${t.forma} ${t.numero}`, forma: t.forma, numero: String(t.numero),
      dimensao: '', peitoril: '', quantidade: '',
      origemLeitura: 'tag', confianca: i.descricao ? 'alta' : 'baixa',
      justificativa: `[SIMULADO] ${t.forma} ${t.numero} visto no recorte de ${local?.nome || 'local'}`
        + (i.descricao ? ` → ${i.titulo || 'legenda'} → ${i.descricao}` : ' → sem linha de legenda'),
    };
  });
  /* um achado que só a imagem veria: é o que valida o caminho da hachura */
  out.push({
    categoria: 'Piso', produto: 'Porcelanato', sistema: '',
    descricao: 'HACHURA SIMULADA — PADRÃO PAGINADO 120X120',
    marca: '', modelo: '', fornecedor: '',
    codigoOrigem: '', forma: '', numero: '', dimensao: '120X120', peitoril: '', quantidade: '',
    origemLeitura: 'hachura', confianca: 'media',
    justificativa: `[SIMULADO] área de ${local?.nome || 'local'} preenchida com trama paginada → amostra da legenda de pisos`,
  });
  return out;
}

/* Fusão semântica de mentira: casa pelo primeiro item de cada categoria e
   cita o trecho de verdade da página. Serve para validar a injeção no
   frontend sem gastar cota. */
function memorialSimulado(locais, paginas) {
  const texto = paginas.map(p => ({ pagina: p.pagina, linhas: String(p.texto || '').split('\n') }));
  const achaTrecho = (nomeLocal, categoria) => {
    const alvo = { Piso: /^piso/i, Paredes: /^(parede|pintura|textura)/i, Teto: /^(teto|forro)/i,
      Bancadas: /^(bancada|tampo)/i, Esquadrias: /^(esquadria|porta|janela)/i,
      Metais: /^(metais|torneira)/i, 'Revestimentos em Pedras Naturais': /^(soleira|peitoril|pingadeira|pedra)/i }[categoria];
    if (!alvo) return null;
    for (const p of texto) {
      let dentro = false;
      for (const l of p.linhas) {
        const t = l.trim();
        if (!t) continue;
        if (t === t.toUpperCase() && t.length < 46) { dentro = t.replace(/[:–—-]\s*$/, '').toUpperCase() === String(nomeLocal).toUpperCase(); continue; }
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
  /* uma atualização com ID inventado: a trava M2 tem de derrubá-la */
  out.push({ especificacaoId: 'esp_inexistente_999', acao: 'enriquecer', marca: 'Fantasma',
    pagina: 1, trecho: 'trecho qualquer para a trava derrubar', justificativa: '[SIMULADO] alucinação', confianca: 'alta' });
  /* e uma sem trecho: a trava M3 também */
  const primeiro = (locais[0] || {}).especificacoes || [];
  if (primeiro[0]) out.push({ especificacaoId: primeiro[0].id, acao: 'enriquecer', marca: 'Sem prova',
    pagina: 1, trecho: '', justificativa: '[SIMULADO] sem trecho', confianca: 'alta' });
  return out;
}

/* Leitura ampla de mentira: devolve um item por local × Piso/Paredes/Teto, como
   um quadro de acabamentos faria, mais uma esquadria sem local. Valida a
   injeção e o vínculo por nome sem gastar cota. */
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
  /* e o lixo que o saneamento tem de derrubar */
  out.push({ local: '', categoria: '', produto: '', descricao: 'ESCALA 1:50', origemLeitura: 'quadro', confianca: 'alta', justificativa: 'x' });
  out.push({ local: '', categoria: 'Teto', produto: 'N/A', descricao: 'n/a', origemLeitura: 'quadro', confianca: 'alta', justificativa: '-' });
  return out;
}

/* ------------------------------------------------------------------ */
/* endpoints                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/health', async (_req, res) => {
  /* O frontend usa esta rota para decidir se roda na nuvem ou local: ela
     precisa responder mesmo com o banco quebrado, dizendo que quebrou. */
  let bd = null, erroBanco = null;
  try { bd = await banco.estatisticas(); } catch (e) { erroBanco = e.message; }
  res.json({
    ok: true, servico: 'prancharia-bff',
    modelo: MODELO,
    chaveConfigurada: !!CHAVE,
    provedores: PROVEDORES_CONFIGURADOS,
    ocrConfigurado: OCR_CONFIGURADO,
    simulando: SIMULAR,
    timeoutMs: TEMPO_LIMITE,
    timeoutMemorialMs: TEMPO_LIMITE_MEMORIAL,
    banco: bd,
    erroBanco,
    armazenamento: armazenamento.nome,
    autenticacao: 'nenhuma',
    rotas: [
      'GET/POST /api/companies', 'GET/POST /api/projects', 'GET/POST /api/glossary',
      'POST /api/upload', 'GET /api/files/:id',
      'POST /api/vision/process-local', 'POST /api/vision/process-sheet', 'POST /api/text/process-memorial',
      'POST /api/pdf/ocr',
    ],
    categorias: CATEGORIAS.length,
  });
});

app.post('/api/vision/process-local', async (req, res) => {
  const t0 = agora();
  const { local = {}, imagemLocal, imagemLegenda, vetor = {}, documento = '', pagina = null } = req.body || {};

  if (SIMULAR) {
    const especificacoes = sanear(simulado(vetor, local));
    const ms = agora() - t0;
    registrar({ ok: true, ms, local: local.nome, itens: especificacoes.length, erro: 'modo simulado' });
    return res.json({ ok: true, motor: 'multimodal_gemini', modelo: 'simulado', ms, especificacoes });
  }

  if (!ALGUM_PROVEDOR) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: local.nome, erro: 'nenhum provedor de IA configurado' });
    return res.status(503).json({
      ok: false, erro: 'nenhuma chave de IA configurada no servidor (GEMINI_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)',
      dica: 'crie server/.env com pelo menos uma delas, ou rode com SIMULAR=1 para testar a ligação',
      especificacoes: [],
    });
  }

  let partes;
  try {
    const pLocal = paraInline(imagemLocal, 'imagemLocal');
    if (!pLocal) throw new Error('imagemLocal é obrigatória');
    const pLeg = imagemLegenda ? paraInline(imagemLegenda, 'imagemLegenda') : null;
    partes = [
      { text: 'IMAGEM 1 — REGIÃO DO LOCAL:' }, pLocal,
      ...(pLeg ? [{ text: 'IMAGEM 2 — BLOCO DE LEGENDAS DA PRANCHA:' }, pLeg] : [{ text: 'IMAGEM 2 não foi enviada: esta prancha não tem bloco de legendas recortável.' }]),
      { text: contexto({ local, tags: vetor.tags || [], legenda: vetor.legenda || [], codigos: vetor.codigos || [], documento, pagina }) },
    ];
  } catch (err) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: local.nome, erro: err.message });
    return res.status(400).json({ ok: false, erro: err.message, especificacoes: [] });
  }

  try {
    const empresa = await empresaDaRequisicao(req);
    const { bruto, tokens, modelo, provedor } = await gerar('visao', partes, TEMPO_LIMITE, empresa);
    const especificacoes = sanear(bruto);
    const ms = agora() - t0;
    registrar({ ok: true, ms, local: local.nome, itens: especificacoes.length, tokens,
      erro: (provedor !== 'gemini' ? `via ${provedor} · ` : '') + (empresa ? `ctx ${empresa.nome}` : '') });
    res.json({
      ok: true, motor: 'multimodal_gemini', provedor, modelo, ms, tokens: tokens || null,
      empresa: empresa ? { id: empresa.id, nome: empresa.nome } : null,
      descartados: (Array.isArray(bruto) ? bruto.length : 0) - especificacoes.length,
      especificacoes,
    });
  } catch (err) {
    const ms = agora() - t0;
    const msg = err.message || String(err);
    const estourou = /tempo limite/.test(msg);
    registrar({ ok: false, ms, local: local.nome, erro: msg });
    /* 504 no timeout, 502 quando o upstream reclamou: os dois dizem ao engine
       "caia no vetorial", e nenhum aborta o processamento da prancha. */
    res.status(estourou ? 504 : 502).json({ ok: false, erro: msg, motor: 'multimodal_gemini', ms, especificacoes: [] });
  }
});

/* ------------------------------------------------------------------ */
/* FUSÃO SEMÂNTICA: memorial descritivo × especificações da prancha    */
/* ------------------------------------------------------------------ */

app.post('/api/text/process-memorial', async (req, res) => {
  const t0 = agora();
  const { documento = '', paginas = [], locais = [] } = req.body || {};
  const ids = new Set();
  for (const l of locais) for (const e of (l.especificacoes || [])) if (e && e.id) ids.add(String(e.id));
  const rotulo = `memorial ${paginas.length}p × ${ids.size} espec`;

  if (!paginas.length || !ids.size) {
    const ms = agora() - t0;
    const erro = !paginas.length ? 'o memorial chegou sem texto' : 'não há especificações de prancha para casar';
    registrar({ ok: false, ms, local: rotulo, erro });
    return res.status(400).json({ ok: false, erro, atualizacoes: [] });
  }

  if (SIMULAR) {
    const { atualizacoes, recusadas } = sanearMemorial(memorialSimulado(locais, paginas), ids);
    const ms = agora() - t0;
    registrar({ ok: true, ms, local: rotulo, itens: atualizacoes.length, erro: 'modo simulado' });
    return res.json({ ok: true, motor: 'multimodal_gemini', modelo: 'simulado', ms, lotes: 1, atualizacoes, recusadas });
  }

  if (!ALGUM_PROVEDOR) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: rotulo, erro: 'nenhum provedor de IA configurado' });
    return res.status(503).json({
      ok: false, erro: 'nenhuma chave de IA configurada no servidor (GEMINI_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)',
      dica: 'crie server/.env com pelo menos uma delas, ou rode com SIMULAR=1',
      atualizacoes: [],
    });
  }

  /* Memorial longo não cabe numa janela só. Os lotes são por página, e a lista
     de especificações vai inteira em todos — o casamento precisa de todas as
     candidatas à vista. */
  const lotes = lotesDePaginas(paginas);
  const bruto = [];
  let tokens = 0;
  let modelo = '', provedor = '';
  const empresa = await empresaDaRequisicao(req);
  try {
    for (let i = 0; i < lotes.length; i++) {
      const parte = contextoMemorial({ locais, paginas: lotes[i], documento });
      const cabeca = lotes.length > 1
        ? `Este é o lote ${i + 1} de ${lotes.length} do memorial. Considere somente as páginas deste lote.\n\n`
        : '';
      const r = await gerar('memorial', [{ text: cabeca + parte }], TEMPO_LIMITE_MEMORIAL, empresa);
      tokens += r.tokens; modelo = r.modelo; provedor = r.provedor;
      if (Array.isArray(r.bruto)) bruto.push(...r.bruto);
      else if (r.bruto && Array.isArray(r.bruto.atualizacoes)) bruto.push(...r.bruto.atualizacoes);
    }
  } catch (err) {
    const ms = agora() - t0;
    const msg = err.message || String(err);
    const estourou = /tempo limite/.test(msg);
    registrar({ ok: false, ms, local: rotulo, erro: msg });
    return res.status(estourou ? 504 : 502).json({ ok: false, erro: msg, motor: 'multimodal_gemini', ms, atualizacoes: [] });
  }

  const { atualizacoes, recusadas } = sanearMemorial(bruto, ids);
  const ms = agora() - t0;
  const conflitos = atualizacoes.filter(a => a.acao === 'conflito').length;
  registrar({ ok: true, ms, local: rotulo, itens: atualizacoes.length, tokens,
    erro: (provedor !== 'gemini' ? `via ${provedor} · ` : '') + (conflitos ? `${conflitos} conflito(s)` : '') });
  res.json({
    ok: true, motor: 'multimodal_gemini', provedor, modelo, ms, tokens: tokens || null,
    empresa: empresa ? { id: empresa.id, nome: empresa.nome } : null,
    lotes: lotes.length, recusadas, atualizacoes,
  });
});

/* ------------------------------------------------------------------ */
/* OCR: memorial escaneado sem camada de texto                        */
/* ------------------------------------------------------------------ */

app.post('/api/pdf/ocr', async (req, res) => {
  const t0 = agora();
  const { arquivo, nome = 'documento.pdf' } = req.body || {};

  if (!OCR_CONFIGURADO) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: nome, erro: 'ILOVEPDF_PUBLIC_KEY ausente' });
    return res.status(503).json({
      ok: false, erro: 'ILOVEPDF_PUBLIC_KEY não configurada no servidor',
      dica: 'crie server/.env com ILOVEPDF_PUBLIC_KEY=...',
      arquivoOcr: null,
    });
  }

  try {
    const bytes = paraBuffer(arquivo, 'arquivo');
    const saida = await ocrPdf(bytes, nome);
    const ms = agora() - t0;
    registrar({ ok: true, ms, local: nome, erro: `${Math.round(saida.length / 1024)} KB` });
    res.json({ ok: true, ms, arquivoOcr: `data:application/pdf;base64,${saida.toString('base64')}` });
  } catch (err) {
    const ms = agora() - t0;
    const msg = err.message || String(err);
    registrar({ ok: false, ms, local: nome, erro: msg });
    res.status(502).json({ ok: false, erro: msg, arquivoOcr: null });
  }
});

/* ------------------------------------------------------------------ */
/* LEITURA AMPLA: quadros, tabelas e notas em qualquer lugar da folha   */
/* ------------------------------------------------------------------ */

app.post('/api/vision/process-sheet', async (req, res) => {
  const t0 = agora();
  const {
    documento = '', pagina = null,
    imagens = [],            // [{ rotulo, base64 }] — recortes dos quadros, ou a folha
    locais = [],             // nomes dos locais que já existem na árvore
    jaLidos = [],            // o que a leitura vetorial já tirou desta folha
    lacunas = [],            // locais sem categoria essencial
  } = req.body || {};

  const rotulo = `folha ${imagens.length} img × ${locais.length} locais`;

  if (!imagens.length) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: rotulo, erro: 'nenhuma imagem enviada' });
    return res.status(400).json({ ok: false, erro: 'nenhuma imagem enviada', itens: [] });
  }

  if (SIMULAR) {
    const { itens, recusadas } = sanearQuadro(quadroSimulado(locais, imagens));
    const ms = agora() - t0;
    registrar({ ok: true, ms, local: rotulo, itens: itens.length, erro: 'modo simulado' });
    return res.json({ ok: true, motor: 'multimodal_gemini', modelo: 'simulado', ms, recusadas, itens });
  }

  if (!ALGUM_PROVEDOR) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: rotulo, erro: 'nenhum provedor de IA configurado' });
    return res.status(503).json({
      ok: false, erro: 'nenhuma chave de IA configurada no servidor (GEMINI_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)',
      dica: 'crie server/.env com pelo menos uma delas, ou rode com SIMULAR=1',
      itens: [],
    });
  }

  let partes;
  try {
    partes = [];
    imagens.forEach((im, i) => {
      const p = paraInline(im && (im.base64 || im.imagem || im), `imagens[${i}]`);
      if (!p) throw new Error(`imagens[${i}] vazia`);
      partes.push({ text: `IMAGEM ${i + 1} — ${(im && im.rotulo) || 'região da prancha'}:` }, p);
    });
    partes.push({ text: contextoQuadro({
      documento, pagina, locais, jaLidos, lacunas,
      regioes: imagens.map(im => (im && im.rotulo) || 'região da prancha'),
    }) });
  } catch (err) {
    const ms = agora() - t0;
    registrar({ ok: false, ms, local: rotulo, erro: err.message });
    return res.status(400).json({ ok: false, erro: err.message, itens: [] });
  }

  try {
    const empresa = await empresaDaRequisicao(req);
    const { bruto, tokens, modelo, provedor } = await gerar('quadro', partes, TEMPO_LIMITE_QUADRO, empresa);
    const { itens, recusadas } = sanearQuadro(bruto);
    const ms = agora() - t0;
    const comLocal = itens.filter(i => i.local).length;
    registrar({ ok: true, ms, local: rotulo, itens: itens.length, tokens,
      erro: `${comLocal} com local declarado` + (provedor !== 'gemini' ? ` · via ${provedor}` : '') + (empresa ? ` · ctx ${empresa.nome}` : '') });
    res.json({
      ok: true, motor: 'multimodal_gemini', provedor, modelo, ms, tokens: tokens || null,
      empresa: empresa ? { id: empresa.id, nome: empresa.nome } : null,
      recusadas, itens,
    });
  } catch (err) {
    const ms = agora() - t0;
    const msg = err.message || String(err);
    const estourou = /tempo limite/.test(msg);
    registrar({ ok: false, ms, local: rotulo, erro: msg });
    res.status(estourou ? 504 : 502).json({ ok: false, erro: msg, motor: 'multimodal_gemini', ms, itens: [] });
  }
});

/* ================================================================== */
/* DADOS: empresas, projetos, glossário                                */
/* ================================================================== */

/* O único lugar a mexer no dia em que houver login. Hoje deixa tudo passar,
   por decisão explícita: o servidor vive atrás de VPN ou rede de escritório.
   Quando isso mudar, valide aqui e responda 401 — as rotas abaixo já chamam. */
function autenticar(_req, _res, proximo) { proximo(); }

/* Rota assíncrona que nunca derruba o processo por promessa rejeitada.
   Sem isto, um erro do banco dentro de um `async` vira unhandledRejection e
   o Node 22 encerra o servidor — no meio do processamento de alguém. */
const rota = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[rota]', req.method, req.path, '-', err.message);
  if (!res.headersSent) res.status(500).json({ ok: false, erro: err.message || 'erro interno' });
});

app.use('/api/companies', autenticar);
app.use('/api/projects', autenticar);
app.use('/api/glossary', autenticar);
app.use('/api/upload', autenticar);
app.use('/api/files', autenticar);

/* ---------- empresas ---------- */

app.get('/api/companies', rota(async (_req, res) => {
  res.json({ ok: true, empresas: await banco.listarEmpresas() });
}));

app.get('/api/companies/:id', rota(async (req, res) => {
  const e = await banco.lerEmpresa(req.params.id);
  if (!e) return res.status(404).json({ ok: false, erro: 'empresa não encontrada' });
  res.json({ ok: true, empresa: e });
}));

/* POST cria ou atualiza. Só os campos enviados mudam — a tela de regras salva
   uma seção de cada vez e não pode zerar as outras por omissão. */
app.post('/api/companies', rota(async (req, res) => {
  const empresa = await banco.salvarEmpresa(req.body || {});
  res.json({ ok: true, empresa });
}));

app.post('/api/companies/:id', rota(async (req, res) => {
  const empresa = await banco.salvarEmpresa({ ...(req.body || {}), id: req.params.id });
  res.json({ ok: true, empresa });
}));

/* O texto exato que será anexado ao System Instruction. Existe para a tela
   poder MOSTRAR isso à pessoa — reimplementar o bloco no frontend garantiria
   que um dia os dois divergiriam, e a pessoa estaria auditando uma ficção. */
app.get('/api/companies/:id/prompt', rota(async (req, res) => {
  const e = await banco.lerEmpresa(req.params.id);
  if (!e) return res.status(404).json({ ok: false, erro: 'empresa não encontrada' });
  const bloco = blocoDeEmpresa(e);
  res.json({ ok: true, bloco, caracteres: bloco.length, assinatura: assinaturaDeEmpresa(e) });
}));

app.delete('/api/companies/:id', rota(async (req, res) => {
  res.json({ ok: await banco.apagarEmpresa(req.params.id) });
}));

/* ---------- projetos ---------- */

/* A listagem devolve só o cabeçalho de cada projeto. Mandar a árvore inteira
   de todos os projetos na abertura do app seriam dezenas de MB — o frontend
   pede o corpo do projeto que a pessoa realmente abrir. */
app.get('/api/projects', rota(async (req, res) => {
  res.json({ ok: true, projetos: await banco.listarProjetos({
    empresaId: req.query.companyId || req.query.empresaId || null,
    limite: Math.min(Number(req.query.limit) || 200, 500),
  }) });
}));

app.get('/api/projects/:id', rota(async (req, res) => {
  const p = await banco.lerProjeto(req.params.id);
  if (!p) return res.status(404).json({ ok: false, erro: 'projeto não encontrado' });
  res.json({ ok: true, projeto: p });
}));

app.post('/api/projects', rota(async (req, res) => {
  const corpo = req.body || {};
  const emp = corpo.projeto || corpo;
  if (!emp || !emp.id) return res.status(400).json({ ok: false, erro: 'projeto sem id' });
  res.json({ ok: true, ...(await banco.salvarProjeto(emp)) });
}));

app.delete('/api/projects/:id', rota(async (req, res) => {
  res.json({ ok: await banco.apagarProjeto(req.params.id) });
}));

/* ---------- glossário ---------- */

app.get('/api/glossary', rota(async (req, res) => {
  const empresaId = req.query.companyId || req.query.empresaId || null;
  res.json({ ok: true, regras: await banco.lerGlossario(empresaId), escopo: empresaId || 'global' });
}));

app.post('/api/glossary', rota(async (req, res) => {
  const { regras = [], companyId = null, empresaId = null } = req.body || {};
  const alvo = companyId || empresaId || null;
  await banco.salvarGlossario(regras, alvo);
  res.json({ ok: true, escopo: alvo || 'global', regras: regras.length });
}));

/* ================================================================== */
/* ARQUIVOS: a prancha sai da máquina de quem enviou                   */
/* ================================================================== */

/* multipart/form-data. O campo do arquivo é `arquivo` (ou `file`); os campos
   de texto aceitos são `arquivoId`, `projetoId` e `nome`.

   O `arquivoId` é o mesmo id que o frontend já usa para achar o PDF no
   IndexedDB. Mandá-lo daqui é o que faz "Ver na prancha" continuar
   funcionando em outra máquina: o id do documento no JSON do projeto é a
   chave para buscar os bytes de volta. */
app.post('/api/upload', rota(async (req, res) => {
  let pacote;
  try {
    pacote = await lerMultipart(req, { limiteBytes: LIMITE_UPLOAD });
  } catch (err) {
    return res.status(/limite/.test(err.message) ? 413 : 400).json({ ok: false, erro: err.message });
  }

  const arquivo = pacote.arquivos.find(a => a.campo === 'arquivo' || a.campo === 'file') || pacote.arquivos[0];
  if (!arquivo) return res.status(400).json({ ok: false, erro: 'nenhum arquivo no formulário' });

  const guardado = await armazenamento.put(arquivo.bytes, { tipo: arquivo.tipo, nome: arquivo.nome });
  const meta = await banco.registrarArquivo({
    id: pacote.campos.arquivoId || undefined,
    projetoId: pacote.campos.projetoId || null,
    nome: pacote.campos.nome || arquivo.nome,
    tipo: arquivo.tipo,
    bytes: guardado.bytes,
    sha256: guardado.sha256,
    chave: guardado.chave,
  });

  console.log(`${new Date().toISOString().slice(11, 19)} | up  | ${String(guardado.bytes).padStart(9)}B `
    + `| ${meta.nome.slice(0, 40).padEnd(40)} | ${guardado.sha256.slice(0, 10)}`);

  res.json({ ok: true, arquivo: { ...meta, url: armazenamento.url(guardado.chave, meta) } });
}));

app.get('/api/files/:id', rota(async (req, res) => {
  const meta = await banco.lerArquivoMeta(req.params.id);
  if (!meta) return res.status(404).json({ ok: false, erro: 'arquivo não encontrado' });
  let bytes;
  try { bytes = await armazenamento.get(meta.chave); }
  catch { return res.status(410).json({ ok: false, erro: 'os bytes deste arquivo não estão mais no armazenamento' }); }
  res.setHeader('Content-Type', meta.tipo || 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes.length));
  /* inline: o pdf.js do navegador busca por fetch, não é download de usuário */
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.nome || 'arquivo')}"`);
  /* o conteúdo é imutável por construção — a chave é o hash dele */
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.end(bytes);
}));

app.get('/api/projects/:id/files', rota(async (req, res) => {
  res.json({ ok: true, arquivos: await banco.listarArquivosDoProjeto(req.params.id) });
}));

app.use((_req, res) => res.status(404).json({ ok: false, erro: 'endpoint inexistente' }));

/* O banco abre ANTES de a porta aceitar conexão: subir e só então descobrir
   que o disco é somente-leitura é pior do que não subir. */
const est = await banco.iniciarBanco().then(() => banco.estatisticas());

app.listen(PORTA, () => {
  console.log('');
  console.log(`  Prancharia BFF ouvindo em http://localhost:${PORTA}`);
  console.log(`  modelo ............. ${SIMULAR ? 'SIMULADO (nenhuma chamada real)' : MODELO}`);
  console.log(`  GEMINI_API_KEY ..... ${CHAVE ? 'configurada' : 'AUSENTE — o frontend vai cair no motor vetorial'}`);
  console.log(`  banco .............. ${est.motor} · ${est.arquivo}`);
  console.log(`  conteúdo ........... ${est.empresas} empresa(s), ${est.projetos} projeto(s), ${est.arquivos} arquivo(s)`);
  console.log(`  pranchas em ........ ${armazenamento.nome} (${armazenamento.raiz || 's3'})`);
  console.log(`  autenticação ....... NENHUMA — não exponha esta porta na internet`);
  console.log('');
  console.log(`  dados .............. GET/POST /api/companies · /api/projects · /api/glossary`);
  console.log(`  arquivos ........... POST /api/upload · GET /api/files/:id`);
  console.log(`  modelo ............. POST /api/vision/process-local · process-sheet · /api/text/process-memorial`);
  console.log(`  saúde .............. GET  /api/health`);
  console.log('');
});
