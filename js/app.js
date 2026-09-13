/* Prancharia — casca da aplicação: estado, rotas e render. */

import * as store from './core/storage.js';
import { empreendimentoVazio, registrarHistorico, novoId, migrar, sincronizar, CONFIANCA, STATUS } from './core/model.js';
import { niveisDe, tipoDe, rotuloNivel, temAreasComuns } from './core/tipos.js';
import { pendencias } from './core/exporter.js';
import { carregarAprendidas, regrasAprendidas, aprender as aprenderRegra, esquecer as esquecerRegra,
  ligarMemoriaDeEmpresa, recarregarParaEmpresa } from './core/glossario.js';
import * as empresaMem from './core/companyMemory.js';
import { VIEWS } from './ui/views.js';
import { fecharGaveta } from './ui/drawer.js';

export const estado = {
  emps: [],
  empId: null,
  rota: 'painel',
  param: null,
  pdfs: new Map(),        // documentoId -> { doc, blob, url }
  processando: null,
  filtros: {},
  saudeIA: null,          // null = não consultado, false = servidor fora do ar
  capacidades: { db: false, assets: false },
};

export const emp = () => estado.emps.find(e => e.id === estado.empId) || null;

/** O menu é montado a partir do tipo do empreendimento: só aparece o que
    existe naquele projeto. */
export function menuDe(e) {
  const itens = [
    { grupo: 'Projeto' },
    { id: 'empreendimentos', nome: 'Empreendimentos', ico: 'pasta' },
    { id: 'empresas', nome: 'Empresas', ico: 'tag', global: true,
      cont: () => { const n = empresaMem.empresaAtiva()?.nome || ''; return n.length > 14 ? n.slice(0, 13) + '…' : n; } },
  ];
  if (!e) return itens;
  itens.push(
    { id: 'painel', nome: 'Visão geral', ico: 'painel' },
    { id: 'documentos', nome: 'Documentos', ico: 'arquivo', cont: x => x.documentos.length },
  );
  const niveis = niveisDe(e);
  if (niveis.length) {
    itens.push({ grupo: 'Estrutura' });
    for (const n of niveis) {
      itens.push({
        id: 'estrutura', param: n.nivel, nome: n.plural, ico: n.ico,
        cont: x => (x.estrutura[n.nivel] || []).length,
      });
    }
  }
  itens.push(
    { grupo: 'Levantamento' },
    { id: 'locais', nome: 'Locais', ico: 'planta', cont: x => (x.locais || []).filter(a => a.status !== 'excluido').length },
    { id: 'produtos', nome: 'Produtos', ico: 'caixa' },
    { id: 'fornecedores', nome: 'Marcas e fornecedores', ico: 'tag' },
    { id: 'glossario', nome: 'Glossário', ico: 'livro' },
    { grupo: 'Fechamento' },
    { id: 'pendencias', nome: 'Pendências de revisão', ico: 'alerta', cont: x => pendencias(x).length },
    { id: 'planilhas', nome: 'Planilhas', ico: 'grade' },
    { id: 'historico', nome: 'Histórico', ico: 'relogio' },
    { id: 'config', nome: 'Configurações', ico: 'ajuste' },
  );
  return itens;
}

export const ICONES = {
  painel: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z"/>',
  pasta: '<path d="M3 6h6l2 2h10v11H3z"/>',
  arquivo: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h4"/>',
  camadas: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  planta: '<path d="M3 3h18v18H3z"/><path d="M3 11h8V3M11 11h10M15 11v10"/>',
  janela: '<path d="M4 3h16v18H4z"/><path d="M12 3v18M4 12h16"/>',
  lista: '<path d="M8 5h13M8 12h13M8 19h13M3.5 5h.01M3.5 12h.01M3.5 19h.01"/>',
  caixa: '<path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  grade: '<path d="M3 3h18v18H3z"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  balanca: '<path d="M12 4v16M7 20h10M5 8h14M5 8 2 15h6zM19 8l-3 7h6z"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  predio: '<path d="M4 21V6l7-3v18M11 21h9V10l-9-3"/><path d="M7 10h.01M7 14h.01M15 13h.01M15 17h.01"/>',
  porta: '<path d="M5 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M3 21h18M13.5 12h.01"/>',
  escada: '<path d="M3 21h4v-4h4v-4h4V9h4V5h3"/>',
  busca: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  livro: '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z"/>',
  ajuste: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
};

export const SVG_FORMA = {
  circulo: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  triangulo: '<path d="M8 1.6 14.6 13.4H1.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  quadrado: '<rect x="1.9" y="1.9" width="12.2" height="12.2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pentagono: '<path d="M8 1.4 14.6 6.2 12.1 14H3.9L1.4 6.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};
export const ROTULO_FORMA = { circulo: 'Círculo', triangulo: 'Triângulo', quadrado: 'Quadrado', pentagono: 'Pentágono' };

export const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const celula = v => (v === null || v === undefined || v === '') ? '<span class="vazio-celula"></span>' : esc(v);

export function selo(mapa, chave, prefixo = '') {
  const d = mapa[chave];
  if (!d) return '';
  return `<span class="selo ${d.tom}">${prefixo}${d.rotulo}</span>`;
}
export const seloConfianca = c => selo(CONFIANCA, c);
export const seloStatus = s => selo(STATUS, s);

export function marcaForma(forma, numero) {
  if (!forma) return '';
  return `<span class="forma ${forma}" title="${ROTULO_FORMA[forma]} ${numero || ''}"><svg viewBox="0 0 16 16" aria-hidden="true">${SVG_FORMA[forma]}</svg>${esc(numero || '')}</span>`;
}

let tempoToast = null;
export function aviso(texto) {
  document.querySelector('.toast')?.remove();
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = texto; d.setAttribute('role', 'status');
  document.body.appendChild(d);
  clearTimeout(tempoToast);
  tempoToast = setTimeout(() => d.remove(), 3200);
}

export async function salvar(motivo) {
  const e = emp();
  if (!e) return;
  e.atualizadoEm = new Date().toISOString();
  sincronizar(e);              // árvore é a verdade; as listas antigas são a vista
  await store.salvarEmpreendimento(e);
  if (motivo) registrarHistorico(e, motivo);
}

export function irPara(rota, param) {
  location.hash = '#/' + rota + (param ? '/' + encodeURIComponent(param) : '');
}

function lerRota() {
  const [, rota, param] = (location.hash || '#/painel').split('/');
  estado.rota = rota || 'painel';
  estado.param = param ? decodeURIComponent(param) : null;
}

const ROTAS_SEM_PROJETO = new Set(['empreendimentos', 'empresas']);

export function render() {
  const e = emp();
  /* Rotas que não dependem de um projeto aberto. Empresas é a primeira: a
     memória da construtora existe antes e depois de qualquer empreendimento. */
  if (!e && !ROTAS_SEM_PROJETO.has(estado.rota)) estado.rota = 'empreendimentos';
  const alvo = document.getElementById('conteudo');
  const view = VIEWS[estado.rota] || (e ? VIEWS.painel : VIEWS.empreendimentos);
  const menu = menuDe(e);
  document.getElementById('nav').innerHTML = menu.map(m => {
    if (m.grupo) return `<div class="grupo">${m.grupo}</div>`;
    let c = '';
    try { c = m.cont ? (m.global ? m.cont() : (e ? m.cont(e) : '')) : ''; } catch { c = ''; }
    const ativo = estado.rota === m.id && (!m.param || estado.param === m.param);
    return `<button data-rota="${m.id}" ${m.param ? `data-param="${m.param}"` : ''} ${ativo ? 'aria-current="page"' : ''}>
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES[m.ico] || ICONES.caixa}</svg>
      <span>${m.nome}</span>${c ? `<span class="cont">${c}</span>` : ''}</button>`;
  }).join('');

  const trilha = [`<b>${e ? esc(e.nome) : 'Prancharia'}</b>`];
  if (e) trilha.push('<span class="selo neutro">' + esc(tipoDe(e).nome) + '</span>');
  const item = menu.find(m => m.id === estado.rota && (!m.param || estado.param === m.param));
  if (item) trilha.push('<span>/</span>', esc(item.nome));
  document.getElementById('trilha').innerHTML = trilha.join(' ');

  alvo.innerHTML = `<div class="faixa">${view.render(e)}</div>`;
  view.depois?.(e, alvo);
  alvo.scrollTop = 0;
}

/* ---------- eventos globais ---------- */

document.addEventListener('click', async (ev) => {
  /* Gaveta do menu no celular: abaixo de 720px ela cobre o próprio botão que a
     abriu, então sem isto não havia como fechá-la a não ser navegando. */
  const lateral = document.getElementById('lateral');
  if (lateral?.classList.contains('aberta')
      && !ev.target.closest('#lateral') && !ev.target.closest('[data-acao="menu"]')) {
    lateral.classList.remove('aberta');
  }
  const nav = ev.target.closest('[data-rota]');
  if (nav) { irPara(nav.dataset.rota, nav.dataset.param); document.getElementById('lateral').classList.remove('aberta'); return; }
  const acao = ev.target.closest('[data-acao]');
  if (!acao) return;
  const { acao: nome, ...dados } = acao.dataset;
  const view = VIEWS[estado.rota];
  if (ACOES[nome]) { ev.preventDefault(); await ACOES[nome](dados, acao, ev); return; }
  if (view?.acoes?.[nome]) { ev.preventDefault(); await view.acoes[nome](dados, acao, ev); }
});

export const ACOES = {
  async abrirEmpreendimento({ id }) {
    /* Na nuvem a lista traz só o cabeçalho de cada projeto — a árvore fica no
       servidor até alguém abrir de fato. Este é o segundo passo. */
    await hidratar(id);
    estado.empId = id;
    irPara('painel');
  },
  fecharEmpreendimento() { estado.empId = null; irPara('empreendimentos'); },
  fecharGaveta() { fecharGaveta(); },
  menu() { document.getElementById('lateral').classList.toggle('aberta'); },
  tema() {
    const atual = document.documentElement.getAttribute('data-theme');
    const novo = atual === 'dark' ? 'light' : atual === 'light' ? '' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    if (novo) document.documentElement.setAttribute('data-theme', novo);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('prancharia:tema', novo); } catch { /* ok */ }
  },
};

window.addEventListener('hashchange', () => { lerRota(); fecharGaveta(); render(); });

/**
 * Troca o esqueleto vindo da listagem pelo projeto inteiro. Sem efeito fora da
 * nuvem (lá a listagem já traz tudo) e sem efeito no que já foi hidratado.
 */
export async function hidratar(id) {
  const i = estado.emps.findIndex(e => e.id === id);
  if (i < 0 || !estado.emps[i].resumo) return estado.emps[i] || null;
  try {
    const corpo = await store.carregarEmpreendimento(id);
    if (corpo) { delete corpo.resumo; estado.emps[i] = migrar(corpo); }
  } catch (e) {
    console.warn('[nuvem] não consegui abrir o projeto', id, '-', e.message);
    aviso(`Não consegui abrir este projeto: ${e.message}`);
  }
  return estado.emps[i];
}

export async function iniciarApp() {
  try { const t = localStorage.getItem('prancharia:tema'); if (t) document.documentElement.setAttribute('data-theme', t); } catch { /* ok */ }
  estado.capacidades = await store.iniciar();
  /* a memória da construtora antes do glossário: as regras aprendidas são
     lidas no escopo da empresa que já estava ativa na sessão anterior */
  ligarMemoriaDeEmpresa(empresaMem);
  await empresaMem.iniciarEmpresas();
  carregarAprendidas(await store.lerGlossario());
  /* trocar de construtora troca o glossário junto */
  empresaMem.aoMudar(() => { recarregarParaEmpresa(() => store.lerGlossario()).then(render); });
  estado.emps = (await store.listarEmpreendimentos()).map(migrar);
  estado.empId = null;
  lerRota();
  /* recarregar com um projeto no hash tem de abrir esse projeto, não a lista */
  if (estado.empId) await hidratar(estado.empId);
  if (!estado.empId && estado.rota !== 'empreendimentos') estado.rota = 'empreendimentos';
  render();
}

export async function gravarGlossario() { await store.salvarGlossario(regrasAprendidas()); }
export { store, novoId, registrarHistorico, aprenderRegra, esquecerRegra, regrasAprendidas, empreendimentoVazio, migrar, empresaMem };

/* ---------- modal ---------- */
export function abrirModal(html, aoMontar) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-caixa" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  aoMontar?.(m);
  const primeiro = m.querySelector('input, select, textarea, button');
  primeiro?.focus();
}
export function fecharModal() {
  const m = document.getElementById('modal');
  if (!m) return;
  m.hidden = true; m.innerHTML = '';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const m = document.getElementById('modal');
  if (m && !m.hidden) fecharModal(); else fecharGaveta();
});
