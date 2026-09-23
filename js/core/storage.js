/* Persistência — agora com dois destinos e uma só porta de entrada.

   NUVEM        o BFF guarda tudo: projetos em SQLite, pranchas em disco (ou
                S3). É o que permite duas pessoas trabalharem no mesmo
                levantamento e abrir a prancha de outra máquina.
   LOCAL        o comportamento antigo: banco do artefato + localStorage +
                IndexedDB. É o que mantém o Prancharia funcionando publicado
                como artefato, onde a rede externa é bloqueada.

   A ESCOLHA É AUTOMÁTICA E ACONTECE UMA VEZ, em `iniciar()`: se o BFF
   responde ao /api/health, o modo é nuvem; se não responde, é local. Nada mais
   no sistema precisa saber em qual modo está rodando — `app.js` e `model.js`
   chamam exatamente as mesmas dez funções de antes, com as mesmas assinaturas.

   O CACHE É SÓ DE LEITURA, e curto. Foi a decisão explícita: sem fila de
   sincronização, sem escrita otimista, sem resolução de conflito. Toda
   gravação vai direto ao servidor e só é considerada feita quando ele
   confirma. Em troca da simplicidade, o sistema não funciona offline — e o
   cache existe apenas para que abrir a mesma tela três vezes não custe três
   viagens. Qualquer gravação o invalida na hora.

   O PDF SOBE UMA VEZ SÓ. `guardarArquivo` manda os bytes por FormData e
   guarda também no IndexedDB: a cópia local serve a quem enviou (leitura
   instantânea, sem trafegar 3 MB de novo) e a do servidor serve a todo mundo.
   `lerArquivo` tenta o local primeiro e busca no servidor quando não acha —
   que é exatamente o caso de quem abre o projeto numa segunda máquina. */

import { IA } from './ia.js';

const DB_NOME = 'prancharia';
const LOCAL_CHAVE = 'prancharia:empreendimentos';
const GLOS_CHAVE = 'prancharia:glossario';
const CFG_CHAVE = 'prancharia.nuvem';
const PEDACO = 110_000;

export const NUVEM = {
  /* por padrão o mesmo endereço do BFF do Gemini: é o mesmo processo */
  base: IA.bff || 'http://localhost:3000',
  ligada: false,
  /* 'auto' tenta a nuvem e cai no local; 'nuvem' e 'local' forçam */
  modo: 'auto',
  empresaId: null,
  cacheMs: 4000,
  timeoutMs: 20000,
  timeoutUploadMs: 180000,
  /* vira true quando alguém configurou o endereço de propósito — daí a sonda
     acontece mesmo fora de localhost */
  escolhido: false,
  ultimoErro: null,
  /* o último /api/health que respondeu, e se o servidor guarda os dados de
     verdade (false = disco efêmero: o que for gravado lá some ao reiniciar) */
  saude: null,
  persistente: null,
  /* quantas vezes a sondagem em segundo plano ainda vai tentar */
  tentativasRestantes: 0,
};

try {
  const salvo = JSON.parse(localStorage.getItem(CFG_CHAVE) || 'null');
  if (salvo && typeof salvo === 'object') Object.assign(NUVEM, salvo);
} catch { /* sem localStorage */ }
try {
  if (typeof window !== 'undefined' && window.PRANCHARIA_NUVEM) {
    Object.assign(NUVEM, window.PRANCHARIA_NUVEM);
    NUVEM.escolhido = true;
  }
} catch { /* sem window */ }

export function configurarNuvem(cfg = {}) {
  Object.assign(NUVEM, cfg);
  if (cfg.base || cfg.modo) NUVEM.escolhido = true;
  invalidarCache();
  try {
    localStorage.setItem(CFG_CHAVE, JSON.stringify(
      { base: NUVEM.base, modo: NUVEM.modo, empresaId: NUVEM.empresaId, cacheMs: NUVEM.cacheMs, escolhido: NUVEM.escolhido }));
  } catch { /* vale só para esta sessão */ }
  return NUVEM;
}

/** A empresa ativa viaja em toda chamada ao BFF — dados e modelo. */
export function definirEmpresaAtiva(id) {
  NUVEM.empresaId = id || null;
  invalidarCache();
  try {
    const c = JSON.parse(localStorage.getItem(CFG_CHAVE) || '{}');
    localStorage.setItem(CFG_CHAVE, JSON.stringify({ ...c, empresaId: NUVEM.empresaId }));
  } catch { /* ok */ }
  return NUVEM.empresaId;
}
export const empresaAtiva = () => NUVEM.empresaId;
export const naNuvem = () => NUVEM.ligada;

/* ------------------------------------------------------------------ */
/* transporte                                                          */
/* ------------------------------------------------------------------ */

function comPrazo(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancelar: () => clearTimeout(t) };
}

/**
 * Uma chamada ao BFF. Lança em qualquer falha — quem chama decide, e para as
 * gravações a decisão é sempre: avisa e não finge que salvou.
 */
async function api(rota, { metodo = 'GET', corpo, cru, timeoutMs = NUVEM.timeoutMs } = {}) {
  const prazo = comPrazo(timeoutMs);
  try {
    const cabecalhos = {};
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    if (NUVEM.empresaId) cabecalhos['X-Empresa-Id'] = NUVEM.empresaId;
    const r = await fetch(NUVEM.base + rota, {
      method: metodo, headers: cabecalhos, signal: prazo.signal,
      body: cru !== undefined ? cru : (corpo !== undefined ? JSON.stringify(corpo) : undefined),
    });
    if (r.status === 404 && metodo === 'GET') return null;
    const dados = await r.json().catch(() => null);
    if (!r.ok || (dados && dados.ok === false)) {
      throw new Error((dados && dados.erro) || `servidor respondeu ${r.status}`);
    }
    return dados;
  } catch (err) {
    NUVEM.ultimoErro = { quando: new Date().toISOString(), rota, mensagem: err.message || String(err) };
    if (err.name === 'AbortError') throw new Error(`tempo limite de ${timeoutMs} ms em ${rota}`);
    throw err;
  } finally { prazo.cancelar(); }
}

/* ---------- cache curto, só de leitura ---------- */

const cache = new Map();

function doCache(chave, prazoMs, produzir) {
  const agora = Date.now();
  const c = cache.get(chave);
  if (c && agora - c.quando < prazoMs) return c.valor;
  /* guarda a PROMESSA, não o valor: duas telas pedindo a mesma coisa no mesmo
     quadro fazem uma viagem só. */
  const valor = produzir().catch((e) => { cache.delete(chave); throw e; });
  cache.set(chave, { quando: agora, valor });
  return valor;
}

/** Toda gravação chama isto. Cache errado é pior que cache nenhum. */
export function invalidarCache(prefixo = '') {
  if (!prefixo) return cache.clear();
  for (const k of [...cache.keys()]) if (k.startsWith(prefixo)) cache.delete(k);
}

/* ------------------------------------------------------------------ */
/* início                                                              */
/* ------------------------------------------------------------------ */

let _db = null, _assets = null, _pronto = null;

/* Só vale a pena bater no servidor quando ele pode existir. Publicado como
   artefato em claude.ai sem um backend próprio configurado, `localhost:3000`
   nunca vai responder — sondar ali é esperar por nada e ainda deixar um erro
   vermelho no console de quem abriu. Mas em produção real (frontend na Vercel
   falando com o BFF no Render/Railway) `ia.js` já resolveu `NUVEM.base` para
   a URL pública do backend, mesmo fora do localhost — e aí vale sondar. */
function valeSondar() {
  if (NUVEM.modo === 'nuvem') return true;
  if (NUVEM.modo === 'local') return false;
  if (NUVEM.escolhido) return true;              // endereço configurado à mão
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '' || h.endsWith('.local')) return true;
  } catch { return false; }
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(NUVEM.base || '');
}

/* Uma sondagem, com prazo. Devolve o /api/health ou null. */
async function sondar(prazoMs) {
  const prazo = comPrazo(prazoMs);
  try {
    const r = await fetch(NUVEM.base + '/api/health', { signal: prazo.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; }
  finally { prazo.cancelar(); }
}

export async function iniciar() {
  if (_pronto) return _pronto;
  _pronto = (async () => {
    if (valeSondar()) {
      /* O Render free tier hiberna sem uso: a primeira sondagem pode chegar
         num servidor dormindo e estourar antes dele acordar. Uma segunda
         tentativa, mais paciente, resolve — a primeira já serviu de "toque de
         despertar", então a segunda geralmente encontra o servidor de pé.
         Sem isso, quem abre o site com o servidor hibernando cai direto no
         modo local, silenciosamente, e não vê os empreendimentos de ninguém. */
      let s = await sondar(6000);
      if (!s) s = await sondar(25000);
      aplicarSaude(s);
      /* Ainda fora do ar: continua tentando em segundo plano. Quando o
         servidor acordar, a nuvem liga sozinha e a tela é avisada por um
         evento — sem a pessoa precisar recarregar. */
      if (!NUVEM.ligada) revalidarEmSegundoPlano();
    }
    if (NUVEM.ligada) {
      console.info(`[nuvem] ligada em ${NUVEM.base}`);
      return { db: true, assets: true, nuvem: true, base: NUVEM.base };
    }
    if (NUVEM.modo === 'nuvem') console.warn('[nuvem] forçada mas indisponível — nada será gravado no servidor');
    try { _db = await window.claude?.use?.('db') ?? null; } catch { _db = null; }
    try { _assets = await window.claude?.use?.('assets') ?? null; } catch { _assets = null; }
    return { db: !!_db, assets: !!_assets, nuvem: false };
  })();
  return _pronto;
}

/** Lê o /api/health e decide se a nuvem está ligada. */
function aplicarSaude(s) {
  NUVEM.saude = s || null;
  /* health que responde mas sem banco não serve: melhor cair no local do
     que gravar contra um servidor que não persiste. */
  NUVEM.ligada = !!(s && s.ok && s.banco);
  NUVEM.persistente = s && s.ok && s.banco ? (s.persistente !== false) : null;
  if (s && s.ok && !s.banco) console.warn('[nuvem] BFF no ar mas sem banco:', s.erroBanco || 'motivo não informado');
  if (NUVEM.ligada && NUVEM.persistente === false) {
    console.warn('[nuvem] o servidor está num disco EFÊMERO: tudo o que for gravado lá some quando ele reiniciar. Configure TURSO_DATABASE_URL (ver LEIA-ME).');
  }
}

/* Sondagem em segundo plano: a cada 20s, por até 10 minutos. Quando o
   servidor responder, liga a nuvem, limpa o cache e avisa a interface pelo
   evento `prancharia:nuvem` — app.js recarrega a lista e sobe o que estava
   só neste navegador. */
let _revalidando = null;
function revalidarEmSegundoPlano(intervaloMs = 20000, tentativas = 30) {
  if (_revalidando || NUVEM.ligada || NUVEM.modo === 'local') return;
  NUVEM.tentativasRestantes = tentativas;
  _revalidando = (async () => {
    while (NUVEM.tentativasRestantes-- > 0 && !NUVEM.ligada) {
      await new Promise(r => setTimeout(r, intervaloMs));
      if (NUVEM.ligada || NUVEM.modo === 'local') break;
      const s = await sondar(15000);
      if (!s) continue;
      aplicarSaude(s);
      if (NUVEM.ligada) {
        invalidarCache();
        console.info(`[nuvem] o servidor acordou: nuvem ligada em ${NUVEM.base}`);
        try { window.dispatchEvent(new CustomEvent('prancharia:nuvem', { detail: { ligada: true, base: NUVEM.base } })); } catch { /* sem window */ }
      }
    }
    _revalidando = null;
  })();
}

/** Força uma sondagem agora (botão "tentar de novo"). Devolve se ligou. */
export async function religarNuvem() {
  if (NUVEM.ligada) return true;
  const s = await sondar(30000);
  aplicarSaude(s);
  if (NUVEM.ligada) {
    invalidarCache();
    try { window.dispatchEvent(new CustomEvent('prancharia:nuvem', { detail: { ligada: true, base: NUVEM.base } })); } catch { /* ok */ }
  }
  return NUVEM.ligada;
}

export const temBanco = () => NUVEM.ligada || !!_db;
export const temAnexos = () => NUVEM.ligada || !!_assets;

/* ------------------------------------------------------------------ */
/* arquivos                                                            */
/* ------------------------------------------------------------------ */

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NOME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('arquivos')) r.result.createObjectStore('arquivos'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

async function guardarLocalmente(id, blob) {
  try {
    const d = await idb();
    await new Promise((res, rej) => {
      const t = d.transaction('arquivos', 'readwrite');
      t.objectStore('arquivos').put(blob, id); t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    return true;
  } catch { return false; }
}

async function lerLocalmente(id) {
  try {
    const d = await idb();
    return await new Promise((res, rej) => {
      const t = d.transaction('arquivos', 'readonly');
      const q = t.objectStore('arquivos').get(id);
      q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error);
    });
  } catch { return null; }
}

/**
 * Guarda o PDF. Na nuvem sobe por FormData E guarda a cópia local; no modo
 * local, só a cópia local — como sempre foi.
 *
 * O upload é a única gravação que não lança quando falha: o PDF já está no
 * IndexedDB de quem enviou, o processamento não depende do servidor, e
 * derrubar o envio de uma prancha inteira por causa de uma queda de rede seria
 * trocar um problema pequeno (a outra máquina não vê o desenho) por um grande
 * (ninguém processa nada). Quem enviou fica sabendo pelo console e pela
 * ausência do arquivo na lista do projeto.
 */
export async function guardarArquivo(id, blob, meta = {}, { soLocal = false } = {}) {
  const local = await guardarLocalmente(id, blob);
  /* `soLocal`: o arquivo mora no Drive (js/core/drive.js) e o servidor não
     recebe cópia — outra máquina busca no Drive pelo id */
  if (!NUVEM.ligada || soLocal) return local;
  try {
    const fd = new FormData();
    fd.append('arquivoId', id);
    if (meta.projetoId) fd.append('projetoId', meta.projetoId);
    if (meta.nome) fd.append('nome', meta.nome);
    fd.append('arquivo', blob, meta.nome || `${id}.pdf`);
    const r = await api('/api/upload', { metodo: 'POST', cru: fd, timeoutMs: NUVEM.timeoutUploadMs });
    invalidarCache('arquivos:');
    return r?.arquivo || true;
  } catch (e) {
    console.warn(`[nuvem] a prancha "${meta.nome || id}" não subiu: ${e.message}`
      + ' — ela continua nesta máquina, mas outra máquina não vai conseguir abri-la.');
    return local;
  }
}

/** Guarda só nesta máquina (cache do que veio do Drive ou do servidor). */
export const guardarNoNavegador = (id, blob) => guardarLocalmente(id, blob);

/** Local primeiro; servidor quando não achar — é o caso da segunda máquina. */
export async function lerArquivo(id) {
  const local = await lerLocalmente(id);
  if (local) return local;
  if (!NUVEM.ligada) return null;
  try {
    const prazo = comPrazo(NUVEM.timeoutUploadMs);
    const r = await fetch(`${NUVEM.base}/api/files/${encodeURIComponent(id)}`, { signal: prazo.signal });
    prazo.cancelar();
    if (!r.ok) return null;
    const blob = await r.blob();
    /* guarda para a próxima: a prancha só viaja uma vez por máquina */
    guardarLocalmente(id, blob);
    return blob;
  } catch (e) {
    console.warn('[nuvem] não consegui buscar a prancha', id, '-', e.message);
    return null;
  }
}

export async function enviarAnexo(blob, meta = {}) {
  if (NUVEM.ligada) {
    try {
      const fd = new FormData();
      if (meta.projetoId) fd.append('projetoId', meta.projetoId);
      fd.append('arquivo', blob, meta.nome || 'anexo');
      const r = await api('/api/upload', { metodo: 'POST', cru: fd, timeoutMs: NUVEM.timeoutUploadMs });
      return r?.arquivo?.url ? NUVEM.base + r.arquivo.url : null;
    } catch { return null; }
  }
  if (!_assets) return null;
  try { const r = await _assets.upload(blob); return r?.url || (r?.id ? '/_blob/' + r.id : null); }
  catch { return null; }
}

/** Os arquivos que este projeto tem no servidor. Vazio fora da nuvem. */
export async function listarArquivos(projetoId) {
  if (!NUVEM.ligada || !projetoId) return [];
  return doCache(`arquivos:${projetoId}`, NUVEM.cacheMs, async () => {
    try { return (await api(`/api/projects/${encodeURIComponent(projetoId)}/files`))?.arquivos || []; }
    catch { return []; }
  });
}

/* ------------------------------------------------------------------ */
/* empreendimentos                                                     */
/* ------------------------------------------------------------------ */

function fatiar(texto) {
  const partes = [];
  for (let i = 0; i < texto.length; i += PEDACO) partes.push(texto.slice(i, i + PEDACO));
  return partes.length ? partes : [''];
}

/* Depois do corte a árvore é a única verdade e o legado já não existe no
   objeto. O filtro fica como trava: se um objeto antigo entrar em memória por
   qualquer caminho, as listas não voltam para o banco. */
const DERIVADOS = new Set(['ambientes', 'achados', 'tags']);
export function paraTexto(emp) {
  return JSON.stringify(emp, (k, v) => DERIVADOS.has(k) ? undefined : v);
}

export async function salvarEmpreendimento(emp) {
  if (NUVEM.ligada) {
    /* o mesmo filtro do modo local: o derivado não sobe */
    const limpo = JSON.parse(paraTexto(emp));
    if (NUVEM.empresaId && !limpo.empresaId) limpo.empresaId = NUVEM.empresaId;
    await api('/api/projects', { metodo: 'POST', corpo: limpo });
    invalidarCache('projetos');
    invalidarCache(`projeto:${emp.id}`);
    /* CÓPIA LOCAL TAMBÉM (write-through). Se o servidor perder os dados — o
       disco efêmero do Render free faz isso a cada hibernação — este
       navegador ainda tem o projeto, e `enviarLocaisParaNuvem` devolve
       tudo ao servidor. Antes, em modo nuvem, o navegador não guardava
       nada e a perda era definitiva. */
    salvarLocal(emp);
    return true;
  }

  const texto = paraTexto(emp);
  if (_db) {
    try {
      const partes = fatiar(texto);
      await _db.doc('empreendimentos/' + emp.id).set({
        nome: emp.nome, atualizadoEm: new Date().toISOString(), partes: partes.length, bytes: texto.length,
      });
      const col = _db.doc('empreendimentos/' + emp.id).collection('dados');
      for (let i = 0; i < partes.length; i++) await col.doc('p' + i).set({ i, texto: partes[i] });
      salvarLocal(emp);
      return true;
    } catch (e) { console.warn('banco indisponível, usando armazenamento local', e); }
  }
  salvarLocal(emp);
  return false;
}

function salvarLocal(emp) {
  try {
    const todos = JSON.parse(localStorage.getItem(LOCAL_CHAVE) || '{}');
    todos[emp.id] = JSON.parse(paraTexto(emp));
    localStorage.setItem(LOCAL_CHAVE, JSON.stringify(todos));
  } catch { /* cota cheia: os dados do banco continuam valendo */ }
}

/**
 * A lista de empreendimentos.
 *
 * Na nuvem a listagem do servidor devolve só os cabeçalhos — mandar a árvore
 * de todos os projetos na abertura seriam dezenas de MB. Como `app.js` espera
 * objetos que o `migrar()` aceite, cada cabeçalho vira um empreendimento
 * esqueleto, e o corpo chega em `carregarEmpreendimento(id)` quando a pessoa
 * abre o projeto. O `migrar()` preenche todos os campos que faltam.
 */
export async function listarEmpreendimentos() {
  if (NUVEM.ligada) {
    return doCache('projetos', NUVEM.cacheMs, async () => {
      const r = await api('/api/projects'
        + (NUVEM.empresaId ? `?companyId=${encodeURIComponent(NUVEM.empresaId)}` : ''));
      return (r?.projetos || []).map(p => ({
        id: p.id, empresaId: p.empresaId, nome: p.nome, tipo: p.tipo,
        criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm,
        bytes: p.bytes, resumo: true,      // marca de esqueleto: o corpo ainda não veio
        documentos: [], locais: [], especificacoesSemLocal: [],
      }));
    });
  }

  const mapa = new Map();
  try {
    const todos = JSON.parse(localStorage.getItem(LOCAL_CHAVE) || '{}');
    for (const e of Object.values(todos)) mapa.set(e.id, e);
  } catch { /* nada local */ }
  if (_db) {
    try {
      const snap = await _db.collection('empreendimentos').limit(100).get();
      for (const d of snap.docs) {
        if (mapa.has(d.id)) continue;
        const emp = await carregarDoBanco(d.id);
        if (emp) mapa.set(emp.id, emp);
      }
    } catch { /* segue com o local */ }
  }
  return [...mapa.values()].sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

/* ------------------------------------------------------------------ */
/* o que está só neste navegador                                       */
/* ------------------------------------------------------------------ */

/* Dois caminhos deixam projeto preso num navegador: a página abriu em modo
   local (servidor hibernando) e a pessoa trabalhou assim, ou o servidor
   perdeu o banco (disco efêmero). Nos dois casos o localStorage tem a cópia
   e o servidor não — e é isso que "não vejo os empreendimentos em outro
   navegador" significa. As duas funções abaixo medem e resolvem isso. */

function projetosLocais() {
  try { return Object.values(JSON.parse(localStorage.getItem(LOCAL_CHAVE) || '{}')).filter(e => e && e.id); }
  catch { return []; }
}

/**
 * Projetos que existem neste navegador e não no servidor (`novos`), e os que
 * existem nos dois mas a cópia daqui é mais recente (`maisNovos`). Vazio fora
 * da nuvem.
 */
export async function projetosSoLocais() {
  if (!NUVEM.ligada) return { novos: [], maisNovos: [] };
  const locais = projetosLocais();
  if (!locais.length) return { novos: [], maisNovos: [] };
  let remotos = [];
  try { remotos = await listarEmpreendimentos(); } catch { return { novos: [], maisNovos: [] }; }
  const porId = new Map(remotos.map(p => [p.id, p]));
  const novos = [], maisNovos = [];
  for (const e of locais) {
    const r = porId.get(e.id);
    if (!r) { novos.push(e); continue; }
    if (e.atualizadoEm && r.atualizadoEm && e.atualizadoEm > r.atualizadoEm) maisNovos.push(e);
  }
  return { novos, maisNovos };
}

/**
 * Sobe para o servidor o que está só aqui. `soNovos: true` (o padrão, usado
 * na abertura) manda apenas o que o servidor não tem — nunca sobrescreve.
 * Com `soNovos: false` também sobe a cópia local mais recente por cima da do
 * servidor, que é o que o botão do aviso faz depois que a pessoa decidiu.
 * Os PDFs que ainda estão no IndexedDB deste navegador sobem junto.
 */
export async function enviarLocaisParaNuvem({ soNovos = true } = {}) {
  const { novos, maisNovos } = await projetosSoLocais();
  const fila = soNovos ? novos : novos.concat(maisNovos);
  const feito = { projetos: 0, arquivos: 0, falhas: [] };
  for (const e of fila) {
    try {
      await api('/api/projects', { metodo: 'POST', corpo: e });
      feito.projetos++;
      for (const d of (e.documentos || [])) {
        const blob = await lerLocalmente(d.id);
        if (!blob) continue;
        try {
          const fd = new FormData();
          fd.append('arquivoId', d.id); fd.append('projetoId', e.id); fd.append('nome', d.nome || `${d.id}.pdf`);
          fd.append('arquivo', blob, d.nome || `${d.id}.pdf`);
          await api('/api/upload', { metodo: 'POST', cru: fd, timeoutMs: NUVEM.timeoutUploadMs });
          feito.arquivos++;
        } catch (err) { feito.falhas.push(`${d.nome || d.id}: ${err.message}`); }
      }
    } catch (err) { feito.falhas.push(`${e.nome || e.id}: ${err.message}`); }
  }
  if (feito.projetos) { invalidarCache('projetos'); invalidarCache('projeto'); invalidarCache('arquivos:'); }
  return feito;
}

/**
 * O corpo de um projeto. Fora da nuvem devolve null — ali `listarEmpreendimentos`
 * já entrega o objeto inteiro e não há segundo passo.
 */
export async function carregarEmpreendimento(id) {
  if (!NUVEM.ligada) return null;
  return doCache(`projeto:${id}`, NUVEM.cacheMs, async () => {
    const r = await api(`/api/projects/${encodeURIComponent(id)}`);
    return r?.projeto || null;
  });
}

function apagarLocal(id) {
  try {
    const todos = JSON.parse(localStorage.getItem(LOCAL_CHAVE) || '{}');
    delete todos[id]; localStorage.setItem(LOCAL_CHAVE, JSON.stringify(todos));
  } catch { /* ok */ }
}

export async function apagarEmpreendimento(id) {
  if (NUVEM.ligada) {
    await api(`/api/projects/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
    invalidarCache('projeto');
    apagarLocal(id);        // senão a cópia local voltaria como "só neste navegador"
    return;
  }
  apagarLocal(id);
  if (_db) {
    try {
      const snap = await _db.doc('empreendimentos/' + id).collection('dados').limit(60).get();
      for (const d of snap.docs) await _db.doc('empreendimentos/' + id + '/dados/' + d.id).delete();
      await _db.doc('empreendimentos/' + id).delete();
    } catch { /* ok */ }
  }
}

async function carregarDoBanco(id) {
  try {
    const snap = await _db.doc('empreendimentos/' + id).collection('dados').orderBy('i').limit(60).get();
    const texto = snap.docs.map(d => d.data().texto).join('');
    return texto ? JSON.parse(texto) : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* empresas                                                            */
/* ------------------------------------------------------------------ */

/* Só existem na nuvem: é lá que mora a memória técnica da construtora. Fora
   dela as três funções devolvem vazio, e a tela de Empresas diz por quê em
   vez de mostrar uma lista quebrada. */

export async function listarEmpresas() {
  if (!NUVEM.ligada) return [];
  return doCache('empresas', NUVEM.cacheMs, async () => (await api('/api/companies'))?.empresas || []);
}

export async function lerEmpresa(id) {
  if (!NUVEM.ligada || !id) return null;
  return doCache(`empresa:${id}`, NUVEM.cacheMs, async () => (await api(`/api/companies/${encodeURIComponent(id)}`))?.empresa || null);
}

/** O texto exato que o servidor anexa ao System Instruction desta empresa. */
export async function promptDaEmpresa(id) {
  if (!NUVEM.ligada || !id) return null;
  try { return await api(`/api/companies/${encodeURIComponent(id)}/prompt`); }
  catch { return null; }
}

export async function salvarEmpresa(dados) {
  if (!NUVEM.ligada) throw new Error('as empresas só existem com o servidor ligado');
  const r = await api(dados.id ? `/api/companies/${encodeURIComponent(dados.id)}` : '/api/companies',
    { metodo: 'POST', corpo: dados });
  invalidarCache('empresa');
  return r?.empresa || null;
}

export async function apagarEmpresa(id) {
  if (!NUVEM.ligada) throw new Error('as empresas só existem com o servidor ligado');
  await api(`/api/companies/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
  invalidarCache('empresa');
  invalidarCache('projetos');
  return true;
}

/* ------------------------------------------------------------------ */
/* glossário                                                           */
/* ------------------------------------------------------------------ */

/* Na nuvem o glossário tem escopo: o global vale para todos e o da empresa
   vence sobre ele. `lerGlossario()` sem argumento usa a empresa ativa, o que
   deixa `app.js` intacto. */

export async function lerGlossario(empresaId = NUVEM.empresaId) {
  if (NUVEM.ligada) {
    return doCache(`glossario:${empresaId || 'global'}`, NUVEM.cacheMs, async () => {
      try { return (await api('/api/glossary' + (empresaId ? `?companyId=${encodeURIComponent(empresaId)}` : '')))?.regras || []; }
      catch { return []; }
    });
  }
  let local = [];
  try { local = JSON.parse(localStorage.getItem(GLOS_CHAVE) || '[]'); } catch { local = []; }
  if (_db) {
    try {
      const d = await _db.doc('glossario/regras').get();
      if (d.exists) {
        const remoto = d.data().regras || [];
        const mapa = new Map(local.map(r => [(r.exato || '').toLowerCase(), r]));
        for (const r of remoto) if (!mapa.has((r.exato || '').toLowerCase())) mapa.set((r.exato || '').toLowerCase(), r);
        return [...mapa.values()];
      }
    } catch { /* segue com o local */ }
  }
  return local;
}

export async function salvarGlossario(regras, empresaId = NUVEM.empresaId) {
  if (NUVEM.ligada) {
    await api('/api/glossary', { metodo: 'POST', corpo: { regras, companyId: empresaId || null } });
    invalidarCache('glossario');
    return true;
  }
  try { localStorage.setItem(GLOS_CHAVE, JSON.stringify(regras)); } catch { /* cota */ }
  if (_db) {
    try { await _db.doc('glossario/regras').set({ regras, atualizadoEm: new Date().toISOString() }); return true; }
    catch { /* fica local */ }
  }
  return false;
}

/* ------------------------------------------------------------------ */

export async function baixar(nomeArquivo, dados, tipo = 'text/plain') {
  const blob = dados instanceof Blob ? dados : new Blob([dados], { type: tipo });
  try {
    const d = await window.claude?.use?.('downloads');
    if (d) { await d.save({ filename: nomeArquivo, data: blob }); return 'salvo'; }
  } catch (e) {
    if (e && e.code === 'declined') return 'cancelado';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'salvo';
}
