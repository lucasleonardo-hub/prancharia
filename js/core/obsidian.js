/* Exportação para o Obsidian — o levantamento vira um cofre de notas Markdown.

   Uma pasta por empreendimento, com:
     <Empreendimento>.md         índice: dados, documentos, locais, pendências
     Locais/<Local>.md           a tabela de especificações do local, com as
                                 evidências apontando para a nota do documento
     Documentos/<Documento>.md   a prancha ou memorial: páginas, locais lidos
     Pendências.md               lista de tarefas (- [ ]) por motivo
     Sem local.md                itens que ainda não foram triados

   Tudo ligado por [[wikilinks]] — no Obsidian o grafo mostra local ↔ prancha
   ↔ pendência. Nada de dado sem evidência: célula vazia continua vazia.

   Dois caminhos para o cofre:
     1. .zip para soltar na pasta do cofre (funciona sempre);
     2. gravação direta pelo plugin "Local REST API" do Obsidian, que expõe
        http://127.0.0.1:27123 (HTTP, precisa ligar "Enable HTTP server" nas
        configurações do plugin) ou https://127.0.0.1:27124. O navegador
        deixa a página https falar com 127.0.0.1 sem bloqueio de conteúdo
        misto. A chave da API fica no localStorage deste navegador. */

import { gerarZip } from './xlsx.js';
import { locaisDe, especificacoesDe, pendencias } from './exporter.js';
import { MOTIVOS_PENDENCIA } from './model.js';
import { nomeDoc, paginaDoc } from './provas.js';

export const OBSIDIAN = {
  base: 'http://127.0.0.1:27123',
  chave: '',
  pasta: 'Prancharia',
};

const CHAVE_CFG = 'prancharia.obsidian';
try {
  const salvo = JSON.parse(localStorage.getItem(CHAVE_CFG) || 'null');
  if (salvo && typeof salvo === 'object') Object.assign(OBSIDIAN, salvo);
} catch { /* sem localStorage */ }

export function configurarObsidian(cfg = {}) {
  Object.assign(OBSIDIAN, cfg);
  OBSIDIAN.base = String(OBSIDIAN.base || '').trim().replace(/\/+$/, '') || 'http://127.0.0.1:27123';
  OBSIDIAN.pasta = String(OBSIDIAN.pasta || '').trim().replace(/^\/+|\/+$/g, '') || 'Prancharia';
  try { localStorage.setItem(CHAVE_CFG, JSON.stringify({ base: OBSIDIAN.base, chave: OBSIDIAN.chave, pasta: OBSIDIAN.pasta })); }
  catch { /* vale só para a sessão */ }
  return OBSIDIAN;
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

/** Nome de arquivo/nota válido no Obsidian (sem / \ : * ? " < > | # ^ [ ]). */
export const nomeDeNota = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sem nome';
const celula = v => String(v === null || v === undefined ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const data = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('pt-BR'); };
const vivo = x => x && x.status !== 'excluido';

function frontmatter(obj) {
  const l = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { l.push(`${k}:`); for (const x of v) l.push(`  - ${String(x).replace(/"/g, '\\"')}`); }
    else l.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`);
  }
  l.push('---', '');
  return l.join('\n');
}

function tabela(cabecalho, linhas) {
  if (!linhas.length) return '_nenhum item_\n';
  return [
    '| ' + cabecalho.join(' | ') + ' |',
    '| ' + cabecalho.map(() => '---').join(' | ') + ' |',
    ...linhas.map(l => '| ' + l.map(celula).join(' | ') + ' |'),
  ].join('\n') + '\n';
}

/**
 * As notas de um empreendimento: [{ caminho, texto }], com `caminho` relativo
 * à raiz do cofre (já com a pasta configurada). Pura: não toca rede nem DOM.
 */
export function notasDoEmpreendimento(emp, pastaRaiz = OBSIDIAN.pasta) {
  const raiz = `${pastaRaiz}/${nomeDeNota(emp.nome)}`;
  const nomeEmp = nomeDeNota(emp.nome);
  const link = (sub, nome, rotulo) => `[[${raiz}/${sub ? sub + '/' : ''}${nomeDeNota(nome)}|${rotulo || nome}]]`;
  const linkDoc = (ev) => nomeDoc(ev) ? link('Documentos', nomeDoc(ev), `${nomeDoc(ev)}${paginaDoc(ev) !== '' ? ' p.' + paginaDoc(ev) : ''}`) : '';
  const refs = (esp) => [...new Set((esp.evidencias || []).map(linkDoc).filter(Boolean))].join(', ');

  const locais = locaisDe(emp);
  /* Dois locais com o mesmo nome (em pavimentos diferentes, ou "escada" em
     duas folhas) não podem cair na mesma nota — o segundo sobrescreveria o
     primeiro. Quem repete ganha o pavimento no nome; se ainda repetir, um
     número. O mapa vale para os caminhos E para os links. */
  const nomeDaNotaDoLocal = new Map();
  {
    /* comparação sem maiúsculas: no Windows e no macOS "ESCADA.md" e
       "escada.md" são o mesmo arquivo */
    const chave = s => s.toLocaleLowerCase('pt-BR');
    const usados = new Map();
    for (const l of locais) {
      const base = nomeDeNota(l.nome);
      const repetido = locais.some(o => o !== l && chave(nomeDeNota(o.nome)) === chave(base));
      let nome = repetido && l.pavimento ? `${base} (${nomeDeNota(l.pavimento)})` : base;
      const n = usados.get(chave(nome)) || 0;
      usados.set(chave(nome), n + 1);
      if (n) nome = `${nome} ${n + 1}`;
      nomeDaNotaDoLocal.set(l.id, nome);
    }
  }
  const notaLocal = l => nomeDaNotaDoLocal.get(l.id) || nomeDeNota(l.nome);
  const linkLocal = (l) => `[[${raiz}/Locais/${notaLocal(l)}|${l.nome}]]`;
  const porIdLocal = new Map(locais.map(l => [l.id, l]));
  const semLocal = (emp.especificacoesSemLocal || []).filter(vivo);
  const pend = pendencias(emp);
  const docs = emp.documentos || [];
  const notas = [];

  /* ---- índice ---- */
  const idx = [];
  idx.push(frontmatter({
    tipo: 'empreendimento', prancharia_id: emp.id, tipo_empreendimento: emp.tipo,
    localizacao: emp.localizacao || '', responsavel: emp.responsavel || '',
    criado: emp.criadoEm || '', atualizado: emp.atualizadoEm || '',
    tags: ['prancharia', 'empreendimento'],
  }));
  idx.push(`# ${nomeEmp}\n`);
  if (emp.observacoes) idx.push(`> ${emp.observacoes}\n`);
  idx.push('## Resumo\n');
  idx.push(`- Documentos: ${docs.length}`);
  idx.push(`- Locais: ${locais.length}`);
  idx.push(`- Especificações: ${especificacoesDe(emp).length}`);
  idx.push(`- Pendências: ${pend.length} → ${link('', 'Pendências', 'Pendências')}`);
  if (semLocal.length) idx.push(`- Sem local: ${semLocal.length} → ${link('', 'Sem local', 'Sem local')}`);
  idx.push('', '## Documentos\n');
  idx.push(tabela(['Documento', 'Tipo', 'Páginas', 'Situação', 'Enviado'],
    docs.map(d => [link('Documentos', d.nome, d.nome), d.tipo || '', d.paginas || '', d.processadoEm ? 'processado' : 'aguardando', data(d.enviadoEm)])));
  idx.push('## Locais\n');
  const porPav = new Map();
  for (const l of locais) { const k = l.pavimento || 'Sem pavimento'; if (!porPav.has(k)) porPav.set(k, []); porPav.get(k).push(l); }
  for (const [pav, lista] of porPav) {
    idx.push(`### ${pav}\n`);
    for (const l of lista) idx.push(`- ${linkLocal(l)} — ${(l.especificacoes || []).filter(vivo).length} item(ns)${l.status === 'revisar' ? ' · _a revisar_' : ''}`);
    idx.push('');
  }
  if ((emp.historico || []).length) {
    idx.push('## Histórico recente\n');
    for (const h of emp.historico.slice(0, 20)) idx.push(`- ${data(h.quando)} — ${celula(typeof h === 'string' ? h : h.texto)}`);
    idx.push('');
  }
  notas.push({ caminho: `${raiz}/${nomeEmp}.md`, texto: idx.join('\n') });

  /* ---- locais ---- */
  const cab = ['Categoria', 'Produto', 'Sistema', 'Descrição', 'Marca / modelo', 'Fornecedor', 'Dimensão', 'Confiança', 'Status', 'Evidências'];
  const linhaEsp = e => [e.categoria, e.produto, e.sistema, e.descricao, [e.marca, e.modelo].filter(Boolean).join(' '), e.fornecedor, e.dimensao, e.confianca, e.status, refs(e)];
  for (const l of locais) {
    const especs = (l.especificacoes || []).filter(vivo);
    const t = [];
    t.push(frontmatter({
      tipo: 'local', empreendimento: nomeEmp, pavimento: l.pavimento || '', tipologia: l.tipologia || '',
      area: l.area || '', status: l.status || '', confianca: l.confianca || '', tags: ['prancharia', 'local'],
    }));
    t.push(`# ${notaLocal(l)}\n`);
    t.push(`Empreendimento: ${link('', nomeEmp, nomeEmp)}${l.pavimento ? ` · Pavimento: ${l.pavimento}` : ''}${l.area ? ` · Área: ${l.area}` : ''}\n`);
    const docsDoLocal = [...new Set((l.evidencias || []).map(nomeDoc).filter(Boolean))];
    if (docsDoLocal.length) t.push(`Lido em: ${docsDoLocal.map(d => link('Documentos', d, d)).join(', ')}\n`);
    t.push('## Especificações\n');
    t.push(tabela(cab, especs.map(linhaEsp)));
    const pendDoLocal = pend.filter(p => p.localId === l.id);
    if (pendDoLocal.length) {
      t.push('## Pendências\n');
      for (const p of pendDoLocal) t.push(`- [ ] ${celula(p.categoria || '')} — ${celula(p.descricao || p.produto || p.codigoOrigem || '')} — ${(p.motivos || []).map(m => MOTIVOS_PENDENCIA[m] || m).join('; ')}`);
      t.push('');
    }
    notas.push({ caminho: `${raiz}/Locais/${notaLocal(l)}.md`, texto: t.join('\n') });
  }

  /* ---- documentos ---- */
  for (const d of docs) {
    const t = [];
    t.push(frontmatter({
      tipo: 'documento', empreendimento: nomeEmp, tipo_documento: d.tipo || '', paginas: d.paginas || '',
      revisao: d.revisao || '', enviado: d.enviadoEm || '', processado: d.processadoEm || '',
      tags: ['prancharia', d.tipo === 'memorial' ? 'memorial' : 'prancha'],
    }));
    t.push(`# ${nomeDeNota(d.nome)}\n`);
    t.push(`Empreendimento: ${link('', nomeEmp, nomeEmp)} · ${d.tipo || 'documento'} · ${d.paginas || '?'} página(s) · ${d.processadoEm ? 'processado em ' + data(d.processadoEm) : 'aguardando processamento'}\n`);
    if (d.anexo) t.push(`Arquivo: ${d.anexo}\n`);
    const lidos = locais.filter(l => (l.evidencias || []).some(ev => (ev.documentoOrigem || {}).docId === d.id)
      || (l.especificacoes || []).some(e => (e.evidencias || []).some(ev => (ev.documentoOrigem || {}).docId === d.id)));
    t.push('## Locais lidos neste documento\n');
    if (!lidos.length) t.push('_nenhum_\n');
    for (const l of lidos) t.push(`- ${linkLocal(l)}`);
    t.push('');
    const tabelas = (emp.tabelas || []).filter(x => x.documentoId === d.id);
    if (tabelas.length) {
      t.push('## Tabelas lidas\n');
      for (const tb of tabelas) t.push(`- ${celula(tb.titulo || tb.tipo)} (página ${tb.pagina}, ${(tb.linhas || []).length} linha(s))`);
      t.push('');
    }
    notas.push({ caminho: `${raiz}/Documentos/${nomeDeNota(d.nome)}.md`, texto: t.join('\n') });
  }

  /* ---- pendências ---- */
  const p = [frontmatter({ tipo: 'pendencias', empreendimento: nomeEmp, total: pend.length, tags: ['prancharia', 'pendencias'] })];
  p.push(`# Pendências — ${nomeEmp}\n`);
  const porMotivo = new Map();
  for (const x of pend) {
    const m = (x.motivos && x.motivos[0]) || 'revisar';
    if (!porMotivo.has(m)) porMotivo.set(m, []);
    porMotivo.get(m).push(x);
  }
  if (!pend.length) p.push('_nenhuma pendência_\n');
  for (const [m, lista] of porMotivo) {
    p.push(`## ${MOTIVOS_PENDENCIA[m] || m} (${lista.length})\n`);
    for (const x of lista) {
      const l = porIdLocal.get(x.localId);
      const onde = l ? linkLocal(l) : (x.localNome ? `_${celula(x.localNome)}_` : '_sem local_');
      p.push(`- [ ] ${onde} · ${celula(x.categoria || '')} · ${celula(x.descricao || x.produto || x.codigoOrigem || '')}${refs(x) ? ' · ' + refs(x) : ''}`);
    }
    p.push('');
  }
  notas.push({ caminho: `${raiz}/Pendências.md`, texto: p.join('\n') });

  /* ---- sem local ---- */
  if (semLocal.length) {
    const s = [frontmatter({ tipo: 'sem_local', empreendimento: nomeEmp, total: semLocal.length, tags: ['prancharia'] })];
    s.push(`# Itens sem local — ${nomeEmp}\n`, 'Itens lidos das pranchas que ainda não foram vinculados a um local.\n');
    s.push(tabela(['Local citado', ...cab], semLocal.map(e => [e.localNome || '', ...linhaEsp(e)])));
    notas.push({ caminho: `${raiz}/Sem local.md`, texto: s.join('\n') });
  }

  return notas;
}

/** O cofre inteiro num .zip: solte o conteúdo na pasta do seu cofre. */
export function zipDoCofre(emp) {
  const notas = notasDoEmpreendimento(emp);
  return gerarZip(notas.map(n => ({ nome: n.caminho, dados: n.texto })));
}

/* ------------------------------------------------------------------ */
/* Local REST API                                                      */
/* ------------------------------------------------------------------ */

function comPrazo(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancelar: () => clearTimeout(t) };
}

async function chamar(rota, { metodo = 'GET', corpo, tipo } = {}) {
  const p = comPrazo(15000);
  try {
    const r = await fetch(OBSIDIAN.base + rota, {
      method: metodo, signal: p.signal,
      headers: { Authorization: `Bearer ${OBSIDIAN.chave}`, ...(tipo ? { 'Content-Type': tipo } : {}) },
      body: corpo,
    });
    if (!r.ok) {
      let msg = `Obsidian respondeu ${r.status}`;
      try { const j = await r.json(); msg = j.message || j.errorCode || msg; } catch { /* sem corpo */ }
      throw new Error(msg);
    }
    return r;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('o Obsidian não respondeu em 15 s');
    if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) {
      throw new Error(`não consegui falar com ${OBSIDIAN.base} — o Obsidian está aberto, o plugin Local REST API está instalado e o "Enable HTTP server" está ligado?`);
    }
    throw e;
  } finally { p.cancelar(); }
}

/** Confere se o plugin responde e se a chave vale. */
export async function testarObsidian() {
  try {
    const r = await chamar('/');
    const j = await r.json().catch(() => ({}));
    if (j.authenticated === false) return { ok: false, erro: 'chave da API recusada — copie de novo nas configurações do plugin' };
    return { ok: true, versao: (j.versions && j.versions.obsidian) || '', servico: j.service || 'Obsidian Local REST API' };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/**
 * Grava as notas direto no cofre. Sobrescreve as notas do empreendimento
 * (é uma exportação, não uma fusão); não mexe em nada fora da pasta dele.
 */
export async function enviarParaObsidian(emp, aoProgredir = () => {}) {
  const notas = notasDoEmpreendimento(emp);
  const feito = { enviadas: 0, falhas: [], total: notas.length, pasta: `${OBSIDIAN.pasta}/${nomeDeNota(emp.nome)}` };
  for (let i = 0; i < notas.length; i++) {
    const n = notas[i];
    aoProgredir(`gravando ${n.caminho}`, i / notas.length);
    try {
      await chamar('/vault/' + n.caminho.split('/').map(encodeURIComponent).join('/'), { metodo: 'PUT', corpo: n.texto, tipo: 'text/markdown' });
      feito.enviadas++;
    } catch (e) {
      feito.falhas.push(`${n.caminho}: ${e.message}`);
      if (/não consegui falar|não respondeu|recusada|401|403/.test(e.message)) break;   // não adianta insistir
    }
  }
  aoProgredir('concluído', 1);
  return feito;
}
