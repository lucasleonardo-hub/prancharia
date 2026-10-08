/* O conector do Claude: um servidor MCP (Model Context Protocol) sobre HTTP.

   O claude.ai aceita "conectores personalizados" que falam MCP pelo
   transporte Streamable HTTP: um endereço só (`POST /mcp`) recebe mensagens
   JSON-RPC — initialize, tools/list, tools/call — e responde JSON. Aqui o
   servidor é sem estado (nenhuma sessão, nenhum stream SSE): cada chamada é
   independente, o que casa com o Render free, que dorme e acorda.

   Autenticação: uma chave fixa ("credencial fixa" na tela do claude.ai),
   enviada em `Authorization: Bearer <chave>`. A chave nasce no banco na
   primeira vez e aparece em Configurações; MCP_TOKEN no ambiente a
   substitui. Quem tem a chave tem acesso TOTAL ao que o site faz — é a
   decisão do produto: o Claude cria empreendimentos, locais e
   especificações, revisa, busca nos documentos e monta a planilha.

   As ferramentas reutilizam o núcleo do site (`js/core`): criar um local ou
   uma especificação aqui é exatamente o que a tela faz, com o mesmo modelo,
   os mesmos ids e o mesmo histórico. Nada de regra duplicada no servidor —
   a regra de fronteira do BFF continua: o engine de leitura fica no
   navegador; este arquivo só opera a árvore já lida. */

import crypto from 'node:crypto';

const VERSOES_MCP = ['2025-06-18', '2025-03-26', '2024-11-05'];
const VERSAO = '1.0.0';
const LIMITE_PADRAO = 100, LIMITE_MAXIMO = 500;
const LOTE_MAXIMO = 20;
const DERIVADOS = new Set(['ambientes', 'achados', 'tags']);

/* ------------------------------------------------------------------ */
/* o núcleo do site                                                     */
/* ------------------------------------------------------------------ */

let nucleo = null, erroNucleo = '';
/** Carrega js/core sob demanda. Sem ele no disco (deploy só da pasta
    server), o conector responde o erro em vez de derrubar o servidor. */
export async function carregarNucleo() {
  if (nucleo || erroNucleo) return nucleo;
  try {
    const base = new URL('../js/core/', import.meta.url);
    const mod = n => import(new URL(n, base).href);
    const [model, exporter, ambiente, tipos, vocab, areas] = await Promise.all([
      mod('model.js'), mod('exporter.js'), mod('ambiente.js'), mod('tipos.js'), mod('vocab.js'), mod('areas.js'),
    ]);
    nucleo = { model, exporter, ambiente, tipos, vocab, areas };
  } catch (e) {
    erroNucleo = e.message || String(e);
    console.error('[mcp] núcleo js/core indisponível:', erroNucleo);
  }
  return nucleo;
}
export async function nucleoDisponivel() { return !!(await carregarNucleo()); }
export const erroDoNucleo = () => erroNucleo;

/* ------------------------------------------------------------------ */
/* a chave                                                              */
/* ------------------------------------------------------------------ */

const novaChave = () => 'pr_' + crypto.randomBytes(24).toString('base64url');

export async function chaveDoConector(banco) {
  const env = (process.env.MCP_TOKEN || '').trim();
  if (env) return { chave: env, origem: 'ambiente' };
  let chave = await banco.lerConfig('mcp_token');
  if (!chave) { chave = novaChave(); await banco.salvarConfig('mcp_token', chave); }
  return { chave, origem: 'banco' };
}

export async function girarChave(banco) {
  if ((process.env.MCP_TOKEN || '').trim()) throw new Error('a chave vem da variável de ambiente MCP_TOKEN: troque-a no painel do servidor');
  const chave = novaChave();
  await banco.salvarConfig('mcp_token', chave);
  return chave;
}

/* compara os hashes, não as strings: o tempo da comparação não depende do
   comprimento nem do conteúdo da chave recebida */
export function chaveConfere(dada, certa) {
  if (!dada || !certa) return false;
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(dada), h(certa));
}

/* ------------------------------------------------------------------ */
/* utilidades sobre a árvore                                            */
/* ------------------------------------------------------------------ */

const vivo = x => x && x.status !== 'excluido';
const limpo = emp => JSON.parse(JSON.stringify(emp, (k, v) => (DERIVADOS.has(k) ? undefined : v)));
const limite = (n, padrao = LIMITE_PADRAO) => Math.max(1, Math.min(LIMITE_MAXIMO, Number(n) || padrao));
const texto = s => String(s === undefined || s === null ? '' : s).trim();
const semAcento = s => texto(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pendente = a => a.status === 'revisar' || a.status === 'conflito' || a.confianca === 'baixa';

/* uma escrita por vez em cada empreendimento: duas chamadas do Claude no
   mesmo projeto entram na fila, e nenhuma grava por cima da outra */
const filas = new Map();
async function comProjeto(ctx, id, fn, { gravar = false, motivo = '' } = {}) {
  const chave = String(id || '');
  if (!chave) throw new Error('empreendimentoId é obrigatório');
  const anterior = filas.get(chave) || Promise.resolve();
  const tarefa = anterior.catch(() => {}).then(async () => {
    /* ler → mudar → gravar com compare-and-set no carimbo lido: se a tela
       gravou entre a leitura e a escrita, o banco recusa e o ciclo recomeça
       sobre a versão nova — a mudança da pessoa nunca é sobrescrita */
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const emp = await ctx.banco.lerProjeto(chave);
      if (!emp) throw new Error(`empreendimento não encontrado: ${chave}`);
      const carimbo = emp.atualizadoEm;
      ctx.nucleo.model.migrar(emp);
      const r = await fn(emp);
      if (!gravar) return r;
      ctx.nucleo.model.sincronizar(emp);
      if (motivo) ctx.nucleo.model.registrarHistorico(emp, { texto: motivo, tipo: 'claude' });
      emp.ultimaEscrita = { por: 'claude', em: new Date().toISOString() };
      const gravado = await ctx.banco.salvarProjeto(limpo(emp), { seCarimbo: carimbo || null });
      if (!gravado.conflito) return r;
    }
    throw new Error('o empreendimento está sendo alterado na tela neste instante; tente de novo');
  });
  filas.set(chave, tarefa);
  try { return await tarefa; } finally { if (filas.get(chave) === tarefa) filas.delete(chave); }
}

function resumoLocal(l) {
  const its = (l.especificacoes || []).filter(vivo);
  return {
    id: l.id, nome: l.nome, pavimento: l.pavimento || '', tipologia: l.tipologia || '',
    areaComum: !!l.areaComum, status: l.status, confianca: l.confianca, origem: l.origem || '',
    itens: its.length, pendencias: its.filter(pendente).length,
  };
}

function resumoEspec(a, { completo = false } = {}) {
  const r = {
    id: a.id, localId: a.localId || null, local: a.localNome || '', tipologia: a.tipologia || '',
    categoria: a.categoria || '', produto: a.produto || '', sistema: a.sistema || '',
    descricao: a.descricao || '', marca: a.marca || '', modelo: a.modelo || '', fornecedor: a.fornecedor || '',
    codigoOrigem: a.codigoOrigem || '', quantidade: a.quantidade || '',
    status: a.status, confianca: a.confianca, motivos: a.motivos || [], origemLeitura: a.origemLeitura || '',
  };
  if (completo) {
    r.evidencias = (a.evidencias || []).filter(Boolean).map(ev => ({
      documento: (ev.documentoOrigem || {}).nomeDoc || '', pagina: (ev.documentoOrigem || {}).pagina ?? '',
      tipo: ev.tipo || '', texto: texto(ev.texto).slice(0, 300), cadeia: ev.cadeia || [],
      motor: (ev.proveniencia || {}).motor_ia || '',
    }));
    if ((a.divergencias || []).length) r.divergencias = a.divergencias;
  }
  return r;
}

/* o local pelo id, ou pelo nome (e tipologia, quando o nome se repete) */
function acharLocal(ctx, emp, { localId, local, tipologia } = {}) {
  const { normalizar } = ctx.nucleo.model;
  const vivos = (emp.locais || []).filter(vivo);
  if (localId) {
    const l = vivos.find(x => x.id === localId);
    if (!l) throw new Error(`local não encontrado: ${localId}`);
    return l;
  }
  const nome = normalizar(local || '');
  if (!nome) throw new Error('informe localId ou local (nome)');
  let cands = vivos.filter(x => normalizar(x.nome) === nome);
  if (!cands.length) cands = vivos.filter(x => normalizar(x.nome).includes(nome));
  if (tipologia) cands = cands.filter(x => normalizar(x.tipologia || '') === normalizar(tipologia));
  if (!cands.length) throw new Error(`nenhum local chamado "${local}"${tipologia ? ` na tipologia ${tipologia}` : ''}`);
  if (cands.length > 1) {
    throw new Error(`"${local}" existe em ${cands.length} locais — informe localId ou tipologia: ` + cands.map(c => `${c.id} (${c.nome}${c.tipologia ? ' · ' + c.tipologia : ''}${c.pavimento ? ' · ' + c.pavimento : ''})`).join('; '));
  }
  return cands[0];
}

function acharEspec(emp, id) {
  for (const l of (emp.locais || [])) for (const a of (l.especificacoes || [])) if (a.id === id && vivo(a)) return { esp: a, local: l };
  for (const a of (emp.especificacoesSemLocal || [])) if (a.id === id && vivo(a)) return { esp: a, local: null };
  throw new Error(`especificação não encontrada: ${id}`);
}

const CAMPOS_ESPEC = ['categoria', 'produto', 'sistema', 'descricao', 'marca', 'modelo', 'fornecedor', 'dimensao', 'quantidade', 'codigoOrigem', 'status', 'confianca'];
const STATUS_OK = new Set(['identificado', 'revisar', 'confirmado', 'conflito', 'corrigido']);
const CONFIANCA_OK = new Set(['alta', 'media', 'baixa']);

function validarCamposEspec(ctx, campos) {
  const { CATEGORIAS, NOMES_SISTEMAS } = ctx.nucleo.vocab;
  const saida = {};
  for (const k of Object.keys(campos || {})) {
    if (!CAMPOS_ESPEC.includes(k)) throw new Error(`campo desconhecido: ${k} (aceitos: ${CAMPOS_ESPEC.join(', ')})`);
    saida[k] = texto(campos[k]);
  }
  if (saida.categoria !== undefined && saida.categoria && !CATEGORIAS.includes(saida.categoria)) {
    throw new Error(`categoria fora do vocabulário: "${saida.categoria}". Use uma de: ${CATEGORIAS.join(', ')}`);
  }
  if (saida.sistema !== undefined && saida.sistema && !NOMES_SISTEMAS.includes(saida.sistema)) {
    const parecidos = NOMES_SISTEMAS.filter(n => semAcento(n).includes(semAcento(saida.sistema).split(' ')[0])).slice(0, 8);
    throw new Error(`sistema construtivo fora da lista mestra: "${saida.sistema}". ${parecidos.length ? 'Parecidos: ' + parecidos.join(' | ') : 'Use a ferramenta listar_sistemas.'}`);
  }
  if (saida.status !== undefined && !STATUS_OK.has(saida.status)) throw new Error(`status inválido: ${saida.status} (${[...STATUS_OK].join(', ')})`);
  if (saida.confianca !== undefined && !CONFIANCA_OK.has(saida.confianca)) throw new Error(`confiança inválida: ${saida.confianca} (alta, media, baixa)`);
  return saida;
}

/* a evidência de uma escrita do Claude: a fonte (documento, página, trecho)
   quando ele a tem, a justificativa quando não — sem uma das duas, não entra */
function evidenciaDoClaude(ctx, emp, { fonte, justificativa, cadeia, confianca = 'media' }) {
  const { criarEvidencia } = ctx.nucleo.model;
  const f = fonte && typeof fonte === 'object' ? fonte : null;
  const trecho = texto(f && f.trecho);
  const just = texto(justificativa);
  if (!trecho && !just) throw new Error('informe fonte {documentoId|documento, pagina, trecho} ou justificativa: nada entra sem respaldo');
  let doc = null;
  if (f) {
    doc = (emp.documentos || []).find(d => d.id === f.documentoId)
      || (emp.documentos || []).find(d => f.documento && semAcento(d.nome) === semAcento(f.documento))
      || (emp.documentos || []).find(d => f.documento && semAcento(d.nome).includes(semAcento(f.documento)))
      || null;
  }
  return criarEvidencia({
    documentoOrigem: doc ? { docId: doc.id, pagina: f.pagina ?? '', nomeDoc: doc.nome } : (f && f.documento ? { docId: null, pagina: f.pagina ?? '', nomeDoc: f.documento } : null),
    tipo: trecho ? 'texto_memorial' : 'manual',
    texto: trecho || just,
    tituloLegenda: 'Claude (conector)',
    cadeia: [...(cadeia || []), doc ? `${doc.nome}${f.pagina ? ' p.' + f.pagina : ''}` : 'informado pelo Claude', trecho || just],
    proveniencia: { motor_ia: 'claude_mcp', metodo: trecho ? 'fonte_citada' : 'justificativa', confianca },
  });
}

/* a página do trecho: o último marcador "[p.N]" ou "[folha N: …]" antes da
   posição — dois lastIndexOf, não uma varredura por candidato */
function marcadorDePagina(textoIndexado, posicao) {
  const p = textoIndexado.lastIndexOf('[p.', posicao);
  const f = textoIndexado.lastIndexOf('[folha ', posicao);
  const i = Math.max(p, f);
  if (i < 0) return null;
  const m = /^\[(?:p\.(\d+)|folha (\d+):)/.exec(textoIndexado.slice(i, i + 24));
  return m ? Number(m[1] || m[2]) : null;
}

/* o texto normalizado para a busca (minúsculo, sem acento) e, para cada
   posição dele, a posição no texto original — acento decomposto e caixa
   mudam o comprimento, e o trecho e a página têm de sair do original */
function normalizarComMapa(t) {
  let saida = '';
  const mapa = [];
  for (let i = 0; i < t.length; i++) {
    const n = t[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (let k = 0; k < n.length; k++) { saida += n[k]; mapa.push(i); }
  }
  return { texto: saida, mapa };
}

/* ------------------------------------------------------------------ */
/* as ferramentas                                                       */
/* ------------------------------------------------------------------ */

const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = description => ({ type: 'integer', description });
const bool = description => ({ type: 'boolean', description });
const ID_EMP = str('id do empreendimento (de listar_empreendimentos)');
const leitura = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const escrita = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destrutiva = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

export const FERRAMENTAS = [
  {
    name: 'listar_empreendimentos', title: 'Listar empreendimentos',
    description: 'Lista os empreendimentos cadastrados no Prancharia (id, nome, tipo, última atualização). Comece por aqui para descobrir o id.',
    inputSchema: obj({ empresaId: str('filtra por empresa (opcional)') }), annotations: leitura,
    async executar(a, ctx) {
      const lista = await ctx.banco.listarProjetos({ empresaId: a.empresaId || null, limite: 500 });
      return { total: lista.length, empreendimentos: lista };
    },
  },
  {
    name: 'abrir_empreendimento', title: 'Abrir empreendimento',
    description: 'O retrato de um empreendimento: cadastro, estrutura (tipologias e unidades), contagens, documentos, lista de locais com itens e pendências, últimas entradas do histórico.',
    inputSchema: obj({ empreendimentoId: ID_EMP }, ['empreendimentoId']), annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { especificacoesDe, pendencias } = ctx.nucleo.exporter;
      const { tipoDe, temAreasComuns } = ctx.nucleo.tipos;
      const locais = (emp.locais || []).filter(vivo);
      const est = emp.estrutura || {};
      const tipologias = (est.tipologia || []).map(t => ({
        id: t.id, nome: t.nome, descricao: t.descricao || '', opcional: !!t.opcional, base: t.base || '', origem: t.origem || '',
        unidades: (est.unidade || []).filter(u => u.paiId === t.id).map(u => u.nome),
      }));
      return {
        id: emp.id, nome: emp.nome, tipo: emp.tipo, tipoRotulo: (tipoDe(emp) || {}).nome || emp.tipo, empresaId: emp.empresaId || null,
        endereco: emp.endereco || '', responsavel: emp.responsavel || '', observacoes: emp.observacoes || '',
        criadoEm: emp.criadoEm, atualizadoEm: emp.atualizadoEm, temAreasComuns: temAreasComuns(emp),
        contagens: {
          documentos: (emp.documentos || []).length, locais: locais.length,
          locaisComuns: locais.filter(l => l.areaComum).length, locaisPrivativos: locais.filter(l => !l.areaComum).length,
          especificacoes: especificacoesDe(emp).length, semLocal: (emp.especificacoesSemLocal || []).filter(vivo).length,
          pendencias: pendencias(emp).length,
        },
        tipologias,
        documentos: (emp.documentos || []).map(d => ({ id: d.id, nome: d.nome, tipo: d.tipo || '', disciplina: d.disciplina || '', lado: d.lado || '', paginas: d.paginas || '', processado: !!d.processadoEm, textoIndexado: (d.textoIndexado || '').length })),
        locais: locais.map(resumoLocal),
        historico: (emp.historico || []).slice(0, 10).map(h => ({ quando: h.quando, tipo: h.tipo, texto: h.texto })),
      };
    }),
  },
  {
    name: 'criar_empreendimento', title: 'Criar empreendimento',
    description: 'Cria um empreendimento novo. Tipos: casa, apartamento, studio, cond_apartamentos, cond_casas, hotel, escola, hospital, galpao, industrial, comercial, retrofit, infraestrutura, outro.',
    inputSchema: obj({ nome: str('nome do empreendimento'), tipo: str('tipo (padrão: outro)'), empresaId: str('empresa dona (opcional)'), endereco: str('endereço (opcional)'), responsavel: str('responsável (opcional)'), observacoes: str('observações (opcional)') }, ['nome']),
    annotations: escrita,
    async executar(a, ctx) {
      const { criarEmpreendimento, registrarHistorico } = ctx.nucleo.model;
      const { TIPOS } = ctx.nucleo.tipos;
      const tipo = texto(a.tipo) || 'outro';
      if (!TIPOS.some(t => t.id === tipo)) throw new Error(`tipo desconhecido: ${tipo}. Use: ${TIPOS.map(t => t.id).join(', ')}`);
      const nome = texto(a.nome);
      if (!nome) throw new Error('nome é obrigatório');
      const emp = criarEmpreendimento(a.empresaId || null, nome, tipo);
      emp.endereco = texto(a.endereco); emp.responsavel = texto(a.responsavel); emp.observacoes = texto(a.observacoes);
      registrarHistorico(emp, { texto: 'Empreendimento criado pelo Claude (conector)', tipo: 'claude' });
      emp.ultimaEscrita = { por: 'claude', em: new Date().toISOString() };
      const g = await ctx.banco.salvarProjeto(limpo(emp));
      return { id: emp.id, nome: emp.nome, tipo: emp.tipo, atualizadoEm: g.atualizadoEm };
    },
  },
  {
    name: 'editar_empreendimento', title: 'Editar empreendimento',
    description: 'Altera o cadastro: nome, tipo, endereço, responsável, observações.',
    inputSchema: obj({ empreendimentoId: ID_EMP, nome: str('novo nome'), tipo: str('novo tipo'), endereco: str('endereço'), responsavel: str('responsável'), observacoes: str('observações') }, ['empreendimentoId']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { TIPOS } = ctx.nucleo.tipos;
      const mudou = [];
      for (const k of ['nome', 'tipo', 'endereco', 'responsavel', 'observacoes']) {
        if (a[k] === undefined) continue;
        const v = texto(a[k]);
        if (k === 'tipo' && !TIPOS.some(t => t.id === v)) throw new Error(`tipo desconhecido: ${v}`);
        if (k === 'nome' && !v) throw new Error('nome não pode ficar vazio');
        if (emp[k] !== v) { mudou.push(`${k}: "${emp[k] || ''}" → "${v}"`); emp[k] = v; }
      }
      return { id: emp.id, alterado: mudou };
    }, { gravar: true, motivo: `Cadastro alterado pelo Claude (conector): ${['nome', 'tipo', 'endereco', 'responsavel', 'observacoes'].filter(k => a[k] !== undefined).join(', ')}` }),
  },
  {
    name: 'excluir_empreendimento', title: 'Excluir empreendimento',
    description: 'Apaga um empreendimento inteiro do servidor. Irreversível: exige confirmar=true e deve ser pedido explicitamente pela pessoa.',
    inputSchema: obj({ empreendimentoId: ID_EMP, confirmar: bool('tem de ser true') }, ['empreendimentoId', 'confirmar']),
    annotations: destrutiva,
    async executar(a, ctx) {
      if (a.confirmar !== true) throw new Error('exclusão não confirmada: passe confirmar=true depois de a pessoa confirmar');
      const ok = await ctx.banco.apagarProjeto(String(a.empreendimentoId || ''));
      if (!ok) throw new Error(`empreendimento não encontrado: ${a.empreendimentoId}`);
      return { excluido: a.empreendimentoId };
    },
  },
  {
    name: 'listar_locais', title: 'Listar locais',
    description: 'Os locais (ambientes) do empreendimento, com contagem de itens e pendências. Filtre por nome, lado (áreas comuns × unidades), tipologia ou só os que têm pendência.',
    inputSchema: obj({ empreendimentoId: ID_EMP, nome: str('parte do nome (opcional)'), areaComum: bool('true = só áreas comuns (MC); false = só unidades (MP)'), tipologia: str('nome da tipologia (opcional)'), comPendencias: bool('só locais com pendência'), limite: num('máximo de locais (padrão 100, máximo 500)') }, ['empreendimentoId']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { normalizar } = ctx.nucleo.model;
      let lista = (emp.locais || []).filter(vivo);
      if (a.nome) lista = lista.filter(l => normalizar(l.nome).includes(normalizar(a.nome)));
      if (typeof a.areaComum === 'boolean') lista = lista.filter(l => !!l.areaComum === a.areaComum);
      if (a.tipologia) lista = lista.filter(l => normalizar(l.tipologia || '') === normalizar(a.tipologia));
      const r = lista.map(resumoLocal);
      const filtrados = a.comPendencias ? r.filter(l => l.pendencias > 0) : r;
      return { total: filtrados.length, locais: filtrados.slice(0, limite(a.limite)) };
    }),
  },
  {
    name: 'ficha_do_local', title: 'Ficha do local',
    description: 'Tudo de um local: dados, cada especificação (categoria, produto, sistema, descrição, marca, status, motivos de pendência) e as evidências (documento, página, trecho).',
    inputSchema: obj({ empreendimentoId: ID_EMP, localId: str('id do local'), local: str('nome do local, quando não souber o id'), tipologia: str('desempata o nome repetido entre tipologias') }, ['empreendimentoId']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const l = acharLocal(ctx, emp, a);
      return {
        ...resumoLocal(l), area: l.area || '', pavimentos: l.pavimentos || [], nomeMemorial: l.nomeMemorial || '',
        evidencias: (l.evidencias || []).filter(Boolean).map(ev => ({ documento: (ev.documentoOrigem || {}).nomeDoc || '', pagina: (ev.documentoOrigem || {}).pagina ?? '', tipo: ev.tipo, texto: texto(ev.texto).slice(0, 200) })),
        especificacoes: (l.especificacoes || []).filter(vivo).map(x => resumoEspec(x, { completo: true })),
      };
    }),
  },
  {
    name: 'criar_local', title: 'Criar local',
    description: 'Cria um local (ambiente). O nome deve seguir o projeto (a grafia da prancha). areaComum decide se vai para o Manual do Condomínio (true) ou do Proprietário (false); sem informar, o vocabulário decide.',
    inputSchema: obj({ empreendimentoId: ID_EMP, nome: str('nome do local, como está no projeto'), pavimento: str('pavimento (opcional)'), tipologia: str('tipologia da unidade (opcional)'), areaComum: bool('área comum? (opcional)'), fonte: obj({ documentoId: str('id do documento'), documento: str('nome do documento'), pagina: num('página'), trecho: str('rótulo ou trecho literal') }), justificativa: str('de onde veio este local (documento, página) — obrigatória quando não há fonte') }, ['empreendimentoId', 'nome']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { criarLocal, normalizar, novoId } = ctx.nucleo.model;
      const { classificarArea } = ctx.nucleo.areas;
      const nome = texto(a.nome);
      if (!nome) throw new Error('nome é obrigatório');
      const tip = texto(a.tipologia);
      const repetido = (emp.locais || []).filter(vivo).find(l => normalizar(l.nome) === normalizar(nome) && normalizar(l.tipologia || '') === normalizar(tip) && normalizar(l.pavimento || '') === normalizar(texto(a.pavimento)));
      if (repetido) throw new Error(`já existe este local: ${repetido.id} (${repetido.nome})`);
      const novo = criarLocal(nome, '', texto(a.pavimento));
      novo.origem = 'claude'; novo.confianca = 'alta'; novo.status = 'identificado';
      novo.areaComum = typeof a.areaComum === 'boolean' ? a.areaComum : classificarArea(nome) === 'comum';
      if (tip) {
        emp.estrutura.tipologia = emp.estrutura.tipologia || [];
        let t = emp.estrutura.tipologia.find(x => normalizar(x.nome) === normalizar(tip));
        if (!t) { t = { id: novoId('niv'), nome: tip, descricao: '', origem: 'claude' }; emp.estrutura.tipologia.push(t); }
        novo.tipologia = t.nome; novo.tipologiaId = t.id;
      }
      novo.evidencias.push(evidenciaDoClaude(ctx, emp, { fonte: a.fonte, justificativa: a.justificativa, cadeia: [nome, 'local criado pelo Claude'], confianca: 'alta' }));
      emp.locais.push(novo);
      return resumoLocal(novo);
    }, { gravar: true, motivo: `Local criado pelo Claude (conector): ${texto(a.nome)}` }),
  },
  {
    name: 'editar_local', title: 'Editar local',
    description: 'Renomeia ou reclassifica um local: nome, pavimento, tipologia, área comum, status (identificado, revisar, confirmado).',
    inputSchema: obj({ empreendimentoId: ID_EMP, localId: str('id do local'), nome: str('novo nome'), pavimento: str('pavimento'), tipologia: str('tipologia'), areaComum: bool('área comum?'), status: str('identificado | revisar | confirmado') }, ['empreendimentoId', 'localId']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const l = acharLocal(ctx, emp, { localId: a.localId });
      const mudou = [];
      if (a.nome !== undefined && texto(a.nome) && texto(a.nome) !== l.nome) { mudou.push(`nome: ${l.nome} → ${texto(a.nome)}`); l.nome = texto(a.nome); }
      if (a.pavimento !== undefined) { mudou.push(`pavimento: ${l.pavimento || ''} → ${texto(a.pavimento)}`); l.pavimento = texto(a.pavimento); }
      if (a.tipologia !== undefined) { mudou.push(`tipologia: ${l.tipologia || ''} → ${texto(a.tipologia)}`); l.tipologia = texto(a.tipologia); l.tipologiaId = null; }
      if (typeof a.areaComum === 'boolean') { mudou.push(`areaComum: ${!!l.areaComum} → ${a.areaComum}`); l.areaComum = a.areaComum; }
      if (a.status !== undefined) { if (!['identificado', 'revisar', 'confirmado'].includes(a.status)) throw new Error('status inválido'); mudou.push(`status: ${l.status} → ${a.status}`); l.status = a.status; if (a.status === 'confirmado') l.confianca = 'alta'; }
      return { ...resumoLocal(l), alterado: mudou };
    }, { gravar: true, motivo: `Local alterado pelo Claude (conector): ${a.localId}` }),
  },
  {
    name: 'excluir_local', title: 'Excluir local',
    description: 'Marca um local como excluído (os itens dele saem da planilha). Exige confirmar=true.',
    inputSchema: obj({ empreendimentoId: ID_EMP, localId: str('id do local'), confirmar: bool('tem de ser true') }, ['empreendimentoId', 'localId', 'confirmar']),
    annotations: destrutiva,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      if (a.confirmar !== true) throw new Error('exclusão não confirmada');
      const l = acharLocal(ctx, emp, { localId: a.localId });
      l.status = 'excluido';
      return { excluido: l.id, nome: l.nome };
    }, { gravar: true, motivo: `Local excluído pelo Claude (conector): ${a.localId}` }),
  },
  {
    name: 'listar_especificacoes', title: 'Listar especificações',
    description: 'As linhas do levantamento (o que vira a planilha). Filtre por local, categoria, status, texto livre ou só as sem local.',
    inputSchema: obj({ empreendimentoId: ID_EMP, localId: str('só deste local'), categoria: str('Piso, Paredes, Teto, Esquadrias, Louças, Metais…'), status: str('identificado | revisar | confirmado | conflito'), texto: str('busca em produto, descrição, marca, sistema'), semLocal: bool('só as que ainda não têm local'), limite: num('máximo de linhas (padrão 100, máximo 500)') }, ['empreendimentoId']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { especificacoesDe, ordenarEspecificacoes } = ctx.nucleo.exporter;
      let lista = a.semLocal ? (emp.especificacoesSemLocal || []).filter(vivo) : especificacoesDe(emp);
      if (a.localId) lista = lista.filter(x => x.localId === a.localId);
      if (a.categoria) lista = lista.filter(x => semAcento(x.categoria) === semAcento(a.categoria));
      if (a.status) lista = lista.filter(x => x.status === a.status);
      if (a.texto) { const t = semAcento(a.texto); lista = lista.filter(x => semAcento(`${x.produto} ${x.descricao} ${x.marca} ${x.sistema} ${x.codigoOrigem}`).includes(t)); }
      return { total: lista.length, especificacoes: ordenarEspecificacoes(lista).slice(0, limite(a.limite)).map(x => resumoEspec(x)) };
    }),
  },
  {
    name: 'criar_especificacao', title: 'Criar especificação',
    description: 'Cria uma linha de produto num local. Categoria da lista da planilha; sistema construtivo da lista mestra (listar_sistemas). Exige a fonte (documento, página, trecho) ou uma justificativa — nada entra sem respaldo. Entra "a revisar" salvo confirmado=true.',
    inputSchema: obj({
      empreendimentoId: ID_EMP, localId: str('id do local (ou use local = nome)'), local: str('nome do local'), tipologia: str('desempata o nome do local'),
      categoria: str('categoria da planilha'), produto: str('nome do produto/serviço (ex.: Porcelanato, Bacia sanitária)'), sistema: str('sistema construtivo da lista mestra'),
      descricao: str('descrição/modelo/linha, como o documento escreve'), marca: str('marca'), modelo: str('modelo'), fornecedor: str('fornecedor'), codigoOrigem: str('código na prancha (PM1, J04…)'), quantidade: str('quantidade, quando houver'),
      fonte: obj({ documentoId: str('id do documento'), documento: str('nome do documento, se não souber o id'), pagina: num('página'), trecho: str('o trecho literal que sustenta a linha') }),
      justificativa: str('quando não há trecho: por que esta linha existe'), confirmado: bool('true = entra confirmada (só com fonte literal)'),
    }, ['empreendimentoId', 'categoria']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { criarEspecificacao } = ctx.nucleo.model;
      const l = (a.localId || a.local) ? acharLocal(ctx, emp, a) : null;
      const campos = validarCamposEspec(ctx, Object.fromEntries(['categoria', 'produto', 'sistema', 'descricao', 'marca', 'modelo', 'fornecedor', 'codigoOrigem', 'quantidade'].filter(k => a[k] !== undefined).map(k => [k, a[k]])));
      if (!campos.categoria) throw new Error('categoria é obrigatória');
      if (!campos.produto && !campos.descricao) throw new Error('informe produto ou descrição');
      const temFonte = !!(a.fonte && texto(a.fonte.trecho));
      const confirmado = a.confirmado === true && temFonte;
      const esp = criarEspecificacao({
        ...campos, origemLeitura: 'claude',
        confianca: temFonte ? 'alta' : 'media', status: confirmado ? 'confirmado' : 'revisar', motivos: confirmado ? [] : ['claude'],
        localId: l ? l.id : null, localNome: l ? l.nome : '', pavimento: l ? (l.pavimento || '') : '', tipologia: l ? (l.tipologia || '') : '',
      });
      esp.evidencias.push(evidenciaDoClaude(ctx, emp, { fonte: a.fonte, justificativa: a.justificativa, cadeia: [l ? l.nome : 'sem local'], confianca: temFonte ? 'alta' : 'media' }));
      if (l) { l.especificacoes = l.especificacoes || []; l.especificacoes.push(esp); }
      else { emp.especificacoesSemLocal = emp.especificacoesSemLocal || []; emp.especificacoesSemLocal.push(esp); }
      return resumoEspec(esp, { completo: true });
    }, { gravar: true, motivo: `Especificação criada pelo Claude (conector): ${texto(a.categoria)} · ${texto(a.produto) || texto(a.descricao)}${a.local || a.localId ? ' em ' + (a.local || a.localId) : ''}` }),
  },
  {
    name: 'editar_especificacao', title: 'Editar especificação',
    description: 'Altera campos de uma linha (categoria, produto, sistema, descricao, marca, modelo, fornecedor, dimensao, quantidade, codigoOrigem, status, confianca). Exige a fonte (documento, página, trecho) ou uma justificativa: é o que vira evidência da mudança.',
    inputSchema: obj({ empreendimentoId: ID_EMP, especificacaoId: str('id da linha'), campos: { type: 'object', description: 'os campos a alterar e os novos valores', additionalProperties: true }, fonte: obj({ documentoId: str('id do documento'), documento: str('nome do documento'), pagina: num('página'), trecho: str('trecho literal') }), justificativa: str('por que a alteração') }, ['empreendimentoId', 'especificacaoId', 'campos']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { esp, local } = acharEspec(emp, a.especificacaoId);
      const campos = validarCamposEspec(ctx, a.campos);
      const mudou = [];
      for (const [k, v] of Object.entries(campos)) { if (esp[k] !== v) { mudou.push(`${k}: "${esp[k] || ''}" → "${v}"`); esp[k] = v; } }
      if (!mudou.length) return { ...resumoEspec(esp), alterado: [] };
      /* a mudança precisa do seu respaldo: a fonte ou a justificativa — a
         própria diferença não é evidência de nada */
      esp.evidencias.push(evidenciaDoClaude(ctx, emp, { fonte: a.fonte, justificativa: a.justificativa, cadeia: [local ? local.nome : esp.localNome || 'sem local', `alteração pelo Claude: ${mudou.join('; ')}`], confianca: a.fonte && a.fonte.trecho ? 'alta' : 'media' }));
      if (campos.status === 'confirmado') { esp.confianca = 'alta'; esp.motivos = []; }
      return { ...resumoEspec(esp), alterado: mudou };
    }, { gravar: true, motivo: `Especificação alterada pelo Claude (conector): ${a.especificacaoId}` }),
  },
  {
    name: 'confirmar_especificacao', title: 'Confirmar especificação',
    description: 'Marca a linha como confirmada (confiança alta, sem pendências). Só depois de conferir a fonte.',
    inputSchema: obj({ empreendimentoId: ID_EMP, especificacaoId: str('id da linha') }, ['empreendimentoId', 'especificacaoId']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { esp } = acharEspec(emp, a.especificacaoId);
      esp.status = 'confirmado'; esp.confianca = 'alta'; esp.motivos = [];
      return resumoEspec(esp);
    }, { gravar: true, motivo: `Especificação confirmada pelo Claude (conector): ${a.especificacaoId}` }),
  },
  {
    name: 'mover_especificacao', title: 'Mover especificação',
    description: 'Leva a linha para outro local (ou dá local a uma linha sem local).',
    inputSchema: obj({ empreendimentoId: ID_EMP, especificacaoId: str('id da linha'), localId: str('id do local de destino'), local: str('nome do local de destino'), tipologia: str('desempata o nome') }, ['empreendimentoId', 'especificacaoId']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { esp } = acharEspec(emp, a.especificacaoId);
      const destino = acharLocal(ctx, emp, a);
      esp.localId = destino.id; esp.localNome = destino.nome; esp.pavimento = destino.pavimento || ''; esp.tipologia = destino.tipologia || '';
      esp.motivos = (esp.motivos || []).filter(m => !/^vinculo|tag_sem_ambiente|incompleto|termo_sem_ambiente|lista_aberta/.test(m));
      return resumoEspec(esp);
    }, { gravar: true, motivo: `Especificação movida pelo Claude (conector): ${a.especificacaoId} → ${a.local || a.localId}` }),
  },
  {
    name: 'excluir_especificacao', title: 'Excluir especificação',
    description: 'Marca uma linha como excluída. Exige confirmar=true.',
    inputSchema: obj({ empreendimentoId: ID_EMP, especificacaoId: str('id da linha'), confirmar: bool('tem de ser true') }, ['empreendimentoId', 'especificacaoId', 'confirmar']),
    annotations: destrutiva,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      if (a.confirmar !== true) throw new Error('exclusão não confirmada');
      const { esp } = acharEspec(emp, a.especificacaoId);
      esp.status = 'excluido';
      return { excluido: esp.id, categoria: esp.categoria, produto: esp.produto, local: esp.localNome };
    }, { gravar: true, motivo: `Especificação excluída pelo Claude (conector): ${a.especificacaoId}` }),
  },
  {
    name: 'listar_pendencias', title: 'Listar pendências',
    description: 'As linhas que precisam de decisão humana, com o motivo e o que fazer com cada uma.',
    inputSchema: obj({ empreendimentoId: ID_EMP, limite: num('máximo (padrão 100, máximo 500)') }, ['empreendimentoId']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { pendencias } = ctx.nucleo.exporter;
      const { MOTIVOS_PENDENCIA, ACOES_PENDENCIA } = ctx.nucleo.model;
      const lista = pendencias(emp);
      return {
        total: lista.length,
        pendencias: lista.slice(0, limite(a.limite)).map(x => ({
          ...resumoEspec(x),
          motivosExplicados: (x.motivos || []).map(m => ({ motivo: m, texto: MOTIVOS_PENDENCIA[m] || m, oQueFazer: (ACOES_PENDENCIA[m] || {}).fazer || '' })),
          ...(x.sistema ? {} : { semSistema: 'sistema construtivo em branco (rosa na planilha)' }),
        })),
      };
    }),
  },
  {
    name: 'listar_documentos', title: 'Listar documentos',
    description: 'Os documentos do empreendimento (pranchas, memoriais, cadernos), com disciplina, lado, páginas e se o texto está indexado para busca.',
    inputSchema: obj({ empreendimentoId: ID_EMP }, ['empreendimentoId']), annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => ({
      documentos: (emp.documentos || []).map(d => ({ id: d.id, nome: d.nome, tipo: d.tipo || '', formato: d.formato || '', disciplina: d.disciplina || '', lado: d.lado || '', paginas: d.paginas || '', processadoEm: d.processadoEm || '', foraDoEscopo: !!d.foraDoEscopo, caracteresIndexados: (d.textoIndexado || '').length, caminhoDrive: d.caminhoDrive || '' })),
    })),
  },
  {
    name: 'ler_documento', title: 'Ler documento',
    description: 'O texto indexado de um documento (marcadores [p.N] por página), em fatias de até 20 mil caracteres. Use inicio para continuar.',
    inputSchema: obj({ empreendimentoId: ID_EMP, documentoId: str('id do documento'), documento: str('nome do documento, se não souber o id'), inicio: num('posição inicial (padrão 0)'), tamanho: num('caracteres (padrão 8000, máximo 20000)') }, ['empreendimentoId']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const d = (emp.documentos || []).find(x => x.id === a.documentoId) || (emp.documentos || []).find(x => a.documento && semAcento(x.nome).includes(semAcento(a.documento)));
      if (!d) throw new Error('documento não encontrado');
      const t = d.textoIndexado || '';
      if (!t) return { id: d.id, nome: d.nome, aviso: 'este documento não tem texto indexado (não foi processado no site, ou é só imagem)', total: 0, texto: '' };
      const ini = Math.max(0, Number(a.inicio) || 0);
      const tam = Math.max(200, Math.min(20000, Number(a.tamanho) || 8000));
      return { id: d.id, nome: d.nome, total: t.length, inicio: ini, fim: Math.min(t.length, ini + tam), texto: t.slice(ini, ini + tam), temMais: ini + tam < t.length };
    }),
  },
  {
    name: 'buscar_nos_documentos', title: 'Buscar nos documentos',
    description: 'Procura um termo no texto de todos os documentos indexados e devolve os trechos com documento e página. Use antes de afirmar o que um documento diz.',
    inputSchema: obj({ empreendimentoId: ID_EMP, termo: str('palavra ou expressão'), limite: num('máximo de trechos (padrão 30)') }, ['empreendimentoId', 'termo']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const termo = semAcento(a.termo);
      if (termo.length < 2) throw new Error('termo curto demais');
      const max = Math.max(1, Math.min(200, Number(a.limite) || 30));
      const achados = [];
      for (const d of (emp.documentos || [])) {
        const t = d.textoIndexado || '';
        if (!t) continue;
        const { texto: n, mapa } = normalizarComMapa(t);
        let i = n.indexOf(termo);
        while (i >= 0 && achados.length < max) {
          const ini = mapa[i], fim = mapa[Math.min(mapa.length - 1, i + termo.length - 1)] + 1;
          achados.push({ documento: d.nome, documentoId: d.id, pagina: marcadorDePagina(t, ini), posicao: ini, trecho: t.slice(Math.max(0, ini - 160), fim + 160).replace(/\s+/g, ' ').trim() });
          i = n.indexOf(termo, i + termo.length);
        }
        if (achados.length >= max) break;
      }
      return { termo: a.termo, total: achados.length, trechos: achados, semIndice: (emp.documentos || []).filter(d => !d.textoIndexado).map(d => d.nome) };
    }),
  },
  {
    name: 'historico', title: 'Histórico',
    description: 'As últimas entradas do histórico do empreendimento (leituras, revisões, alterações do Claude).',
    inputSchema: obj({ empreendimentoId: ID_EMP, limite: num('máximo (padrão 50)') }, ['empreendimentoId']), annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => ({ historico: (emp.historico || []).slice(0, limite(a.limite, 50)).map(h => ({ quando: h.quando, tipo: h.tipo, texto: h.texto, antes: h.antes, depois: h.depois })) })),
  },
  {
    name: 'definir_tipologias', title: 'Definir tipologias e unidades',
    description: 'Cadastra ou atualiza tipologias de unidade e as unidades de cada uma (é o que nomeia as abas MP: "Unidade 101, 201 e 301"). Uma tipologia opcional de outra (personalização) leva opcional=true e base.',
    inputSchema: obj({ empreendimentoId: ID_EMP, tipologias: { type: 'array', description: 'lista de tipologias', items: obj({ nome: str('nome, ex.: APTO 201 ou TIPO 1'), descricao: str('descrição'), unidades: { type: 'array', items: { type: 'string' }, description: 'números das unidades, ex.: ["201","301"]' }, opcional: bool('é personalização de uma base?'), base: str('tipologia base, quando opcional') }, ['nome']) } }, ['empreendimentoId', 'tipologias']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { normalizar, novoId } = ctx.nucleo.model;
      const est = emp.estrutura;
      est.tipologia = est.tipologia || []; est.unidade = est.unidade || [];
      const feitas = [];
      for (const t of (a.tipologias || [])) {
        const nome = texto(t.nome); if (!nome) continue;
        let tip = est.tipologia.find(x => normalizar(x.nome) === normalizar(nome));
        if (!tip) { tip = { id: novoId('niv'), nome, descricao: '', origem: 'claude' }; est.tipologia.push(tip); }
        if (t.descricao !== undefined) tip.descricao = texto(t.descricao);
        if (typeof t.opcional === 'boolean') tip.opcional = t.opcional;
        if (t.base !== undefined) tip.base = texto(t.base);
        for (const u of (t.unidades || [])) {
          const n = texto(u).replace(/^(unidade|apto\.?|apartamento)\s*/i, '');
          if (!n) continue;
          const existente = est.unidade.find(x => texto(x.nome).replace(/^(unidade|apto\.?|apartamento)\s*/i, '') === n);
          if (existente) existente.paiId = tip.id; else est.unidade.push({ id: novoId('niv'), nome: `Unidade ${n}`, paiId: tip.id, origem: 'claude' });
        }
        feitas.push({ id: tip.id, nome: tip.nome, unidades: est.unidade.filter(u => u.paiId === tip.id).map(u => u.nome) });
      }
      for (const niv of ['tipologia', 'unidade']) if (!ctx.nucleo.tipos.temNivel(emp, niv)) emp.niveisExtras = [...new Set([...(emp.niveisExtras || []), niv])];
      return { tipologias: feitas };
    }, { gravar: true, motivo: `Tipologias definidas pelo Claude (conector): ${(a.tipologias || []).map(t => t.nome).join(', ')}` }),
  },
  {
    name: 'listar_marcas', title: 'Listar marcas e fornecedores',
    description: 'As marcas usadas no levantamento e os dados de fornecedor cadastrados (o que vira a aba Forn.).',
    inputSchema: obj({ empreendimentoId: ID_EMP }, ['empreendimentoId']), annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { especificacoesDe } = ctx.nucleo.exporter;
      const { marcaDe, naturezaDaMarca, rotuloFornecedor } = ctx.nucleo.ambiente;
      const usadas = new Map();
      for (const x of especificacoesDe(emp)) {
        const m = marcaDe(x) || (naturezaDaMarca(x) === 'fornecedor' ? rotuloFornecedor(x) : '');
        if (m) usadas.set(m, (usadas.get(m) || 0) + 1);
      }
      return { marcasUsadas: [...usadas].map(([nome, itens]) => ({ nome, itens })), fornecedores: emp.marcas || [] };
    }),
  },
  {
    name: 'salvar_fornecedor', title: 'Salvar fornecedor de uma marca',
    description: 'Cadastra ou atualiza os dados de fornecedor de uma marca (preenche a aba Forn.: fornecedor, CNPJ, UF, cidade, CEP, endereço, site, vendedor, e-mail, telefone).',
    inputSchema: obj({ empreendimentoId: ID_EMP, marca: str('a marca, exatamente como aparece na coluna F'), fornecedor: str('nome fantasia'), cnpj: str('CNPJ'), uf: str('UF'), cidade: str('cidade'), cep: str('CEP'), endereco: str('logradouro, nº'), site: str('site'), vendedor: str('nome do vendedor'), email: str('e-mail'), telefone: str('telefone') }, ['empreendimentoId', 'marca']),
    annotations: escrita,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      emp.marcas = emp.marcas || [];
      const nome = texto(a.marca); if (!nome) throw new Error('marca é obrigatória');
      let m = emp.marcas.find(x => semAcento(x.nome) === semAcento(nome));
      if (!m) { m = { nome }; emp.marcas.push(m); }
      for (const k of ['fornecedor', 'cnpj', 'uf', 'cidade', 'cep', 'endereco', 'site', 'vendedor', 'email', 'telefone']) if (a[k] !== undefined) m[k] = texto(a[k]);
      return m;
    }, { gravar: true, motivo: `Fornecedor salvo pelo Claude (conector): ${texto(a.marca)}` }),
  },
  {
    name: 'planilha', title: 'Planilha de Produtos e Fornecedores',
    description: 'Monta a planilha como o site exporta e devolve as linhas de uma aba (ou a lista de abas). Células marcadas [amarelo] são pergunta para a construtora; [rosa], decisão do time; ƒ é fórmula. Para baixar o XLSX, a pessoa usa o botão Exportar no site.',
    inputSchema: obj({ empreendimentoId: ID_EMP, aba: str('nome da aba (sem informar, lista as abas)'), inicio: num('primeira linha de dados (padrão 0)'), limite: num('linhas (padrão 60, máximo 400)') }, ['empreendimentoId']),
    annotations: leitura,
    executar: (a, ctx) => comProjeto(ctx, a.empreendimentoId, emp => {
      const { pastaDeAbas } = ctx.nucleo.exporter;
      const abas = pastaDeAbas(emp);   // completa as linhas obrigatórias na cópia carregada; nada é gravado
      if (!a.aba) return { abas: abas.map(x => ({ nome: x.nome, linhas: x.linhas.length - (x.cabecalho || 1) })) };
      const aba = abas.find(x => semAcento(x.nome) === semAcento(a.aba)) || abas.find(x => semAcento(x.nome).includes(semAcento(a.aba)));
      if (!aba) throw new Error(`aba não encontrada: ${a.aba}. Abas: ${abas.map(x => x.nome).join(' | ')}`);
      const cab = aba.cabecalho || 1;
      const cel = c => { const o = (c && typeof c === 'object' && !Array.isArray(c)) ? c : { v: c, cor: '', f: '' }; if (o.f) return 'ƒ'; const v = texto(o.v); return o.cor ? `${v} [${o.cor}]` : v; };
      const ini = Math.max(0, Number(a.inicio) || 0);
      const n = Math.max(1, Math.min(400, Number(a.limite) || 60));
      const dados = aba.linhas.slice(cab);
      return { aba: aba.nome, titulos: aba.linhas[cab - 1].map(cel), total: dados.length, inicio: ini, linhas: dados.slice(ini, ini + n).map(l => l.map(cel)), temMais: ini + n < dados.length };
    }),
  },
  {
    name: 'listar_sistemas', title: 'Lista mestra de sistemas construtivos',
    description: 'Os sistemas construtivos oficiais (coluna Sistema Construtivo), com filtro por texto. Só esses nomes são aceitos.',
    inputSchema: obj({ texto: str('filtro (opcional)'), lado: str('comum | privativa (opcional)') }), annotations: leitura,
    async executar(a, ctx) {
      const { SISTEMAS, CATEGORIAS } = ctx.nucleo.vocab;
      let lista = SISTEMAS;
      if (a.lado === 'comum') lista = lista.filter(s => s.c); else if (a.lado === 'privativa') lista = lista.filter(s => s.p);
      if (a.texto) lista = lista.filter(s => semAcento(s.n).includes(semAcento(a.texto)));
      return { categorias: CATEGORIAS, sistemas: lista.map(s => s.n) };
    },
  },
  {
    name: 'glossario', title: 'Glossário da empresa',
    description: 'As regras aprendidas de classificação (descrição → categoria/produto/sistema) da empresa.',
    inputSchema: obj({ empresaId: str('empresa (opcional)') }), annotations: leitura,
    async executar(a, ctx) { return { regras: await ctx.banco.lerGlossario(a.empresaId || null) }; },
  },
];

export function definicoes() {
  return FERRAMENTAS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

const INSTRUCOES = `Você está ligado ao Prancharia, o sistema da Predialize que lê pranchas e memoriais e monta a Planilha de Produtos e Fornecedores (abas MC = áreas comuns/Manual do Condomínio, MP = unidades/Manual do Proprietário, uma aba por tipologia nomeada pelas unidades).
Modelo: empreendimento → documentos (pranchas, memoriais, cadernos) → locais (ambientes; areaComum=true vai para a MC) → especificações (categoria, produto, sistema construtivo da lista mestra, descrição, marca), cada uma com evidências (documento, página, trecho).
Regras: nada entra sem respaldo — ao criar ou alterar, cite a fonte (documento, página, trecho literal) ou justifique. O nome do local segue o projeto, nunca o memorial. Antes de afirmar o que um documento diz, use buscar_nos_documentos ou ler_documento. Pendência = linha com status "revisar", "conflito" ou confiança baixa; na planilha, célula amarela é pergunta para a construtora e rosa é decisão do time. Exclusões exigem confirmar=true e devem ser pedidas pela pessoa. Responda em português do Brasil. Comece por listar_empreendimentos para achar o id.`;

/* ------------------------------------------------------------------ */
/* o protocolo                                                          */
/* ------------------------------------------------------------------ */

const resultado = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const erro = (id, code, message, data) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message, ...(data ? { data } : {}) } });
const comoTexto = r => (typeof r === 'string' ? r : JSON.stringify(r, null, 1));

/** Trata uma mensagem JSON-RPC; devolve a resposta, ou null para notificação. */
export async function tratarMensagem(msg, ctx) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return erro(msg && msg.id, -32600, 'requisição JSON-RPC inválida');
  const id = msg.id;
  const notificacao = id === undefined || id === null;
  const params = msg.params || {};
  try {
    switch (msg.method) {
      case 'initialize': {
        const pedida = String(params.protocolVersion || '');
        return resultado(id, {
          protocolVersion: VERSOES_MCP.includes(pedida) ? pedida : VERSOES_MCP[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'prancharia', title: 'Prancharia', version: VERSAO },
          instructions: INSTRUCOES,
        });
      }
      case 'ping': return resultado(id, {});
      case 'tools/list': return resultado(id, { tools: definicoes() });
      case 'tools/call': {
        const nome = String(params.name || '');
        const f = FERRAMENTAS.find(x => x.name === nome);
        if (!f) return erro(id, -32602, `ferramenta desconhecida: ${nome}`);
        if (!ctx.nucleo) return erro(id, -32603, `núcleo do site indisponível no servidor: ${erroNucleo || 'js/core não encontrado'}`);
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        try {
          const r = await f.executar(args, ctx);
          const estruturado = r && typeof r === 'object' && !Array.isArray(r) ? r : { resultado: r };
          return resultado(id, { content: [{ type: 'text', text: comoTexto(r) }], structuredContent: estruturado, isError: false });
        } catch (e) {
          return resultado(id, { content: [{ type: 'text', text: `Erro: ${e.message || e}` }], isError: true });
        }
      }
      case 'resources/list': return resultado(id, { resources: [] });
      case 'resources/templates/list': return resultado(id, { resourceTemplates: [] });
      case 'prompts/list': return resultado(id, { prompts: [] });
      default:
        if (notificacao) return null;
        return erro(id, -32601, `método não suportado: ${msg.method}`);
    }
  } catch (e) {
    return erro(id, -32603, e.message || 'erro interno');
  }
}

/**
 * Monta o endpoint MCP no Express: POST /mcp, chave só no cabeçalho
 * Authorization. GET responde 405 (sem stream de servidor); DELETE responde
 * 200 (não há sessão a encerrar).
 */
export function montarMcp(app, { banco, origens = ['*'], tokenValido = async () => false, urlPublica = null }) {
  const origemOk = req => {
    const o = req.headers.origin;
    if (!o) return true;                                   // chamada de servidor (claude.ai), não de navegador
    return origens.includes('*') || origens.includes(o);
  };
  /* só pelo cabeçalho: chave no caminho ou na query iria parar nos logs de
     acesso do Render e de qualquer proxy no meio. Vale a chave fixa ou um
     token emitido pelo login OAuth (server/oauth.js). */
  const autorizado = async (req) => {
    const { chave } = await chaveDoConector(banco);
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    const dada = texto(m ? m[1] : '');
    if (!dada) return false;
    return chaveConfere(dada, chave) || (await tokenValido(dada));
  };
  /* o 401 diz onde estão os metadados do recurso: é por aí que o claude.ai
     descobre o servidor de autorização */
  const desafio = req => `Bearer realm="prancharia"${urlPublica ? `, resource_metadata="${urlPublica(req)}/.well-known/oauth-protected-resource"` : ''}`;
  const post = async (req, res) => {
    try {
      if (!origemOk(req)) return res.status(403).json(erro(null, -32000, 'origem não permitida'));
      if (!(await autorizado(req))) return res.status(401).set('WWW-Authenticate', desafio(req)).json(erro(null, -32001, 'chave do conector ausente ou inválida'));
      const corpo = req.body;
      const ctx = { banco, nucleo: await carregarNucleo() };
      if (Array.isArray(corpo)) {
        /* lote pequeno: um POST com milhares de tools/call travaria o único
           processo do Render free */
        if (corpo.length > LOTE_MAXIMO) return res.status(400).json(erro(null, -32600, `lote com mais de ${LOTE_MAXIMO} mensagens`));
        const respostas = (await Promise.all(corpo.map(m => tratarMensagem(m, ctx)))).filter(Boolean);
        if (!respostas.length) return res.status(202).end();
        return res.status(200).json(respostas);
      }
      const r = await tratarMensagem(corpo, ctx);
      if (r === null) return res.status(202).end();
      return res.status(200).json(r);
    } catch (e) {
      console.error('[mcp]', e.message);
      if (!res.headersSent) res.status(500).json(erro(null, -32603, 'erro interno'));
    }
  };
  const get = (_req, res) => res.status(405).set('Allow', 'POST, DELETE').json(erro(null, -32000, 'este servidor não abre stream; use POST'));
  const del = (_req, res) => res.status(200).end();
  app.post('/mcp', post); app.get('/mcp', get); app.delete('/mcp', del);
}
