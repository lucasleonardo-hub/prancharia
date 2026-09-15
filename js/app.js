/* Prancharia — casca da aplicação: estado, rotas e render. */

import * as store from './core/storage.js';
import { empreendimentoVazio, registrarHistorico, novoId, migrar, sincronizar, CONFIANCA, STATUS } from './core/model.js';
import { niveisDe, tipoDe, rotuloNivel, temAreasComuns } from './core/tipos.js';
import { pendencias } from './core/exporter.js';
import { carregarAprendidas, regrasAprendidas, aprender as aprenderRegra, esquecer as esquecerRegra } from './core/glossario.js';
import { VIEWS } from './ui/views.js';
import { fecharGaveta } from './ui/drawer.js';
import { iaLigada } from './core/ia.js';

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
  nuvemPendentes: null,   // { novos, maisNovos }: projetos que existem só neste navegador
};

export const emp = () => estado.emps.find(e => e.id === estado.empId) || null;

/** Menu enxuto, de propósito: o fluxo do levantamento na ordem em que ele
    acontece (documentos → locais → produtos → revisão → exportar), e embaixo
    o que é memória e ajuste. Sem projeto aberto não há menu — só a home. */
export function menuDe(e) {
  if (!e) return [];
  return [
    { grupo: 'Levantamento' },
    { id: 'documentos', nome: 'Documentos', ico: 'arquivo', cont: x => x.documentos.length },
    { id: 'locais', nome: 'Locais', ico: 'planta', cont: x => (x.locais || []).filter(a => a.status !== 'excluido').length },
    { id: 'produtos', nome: 'Produtos', ico: 'caixa' },
    { id: 'pendencias', nome: 'Revisão', ico: 'alerta', cont: x => pendencias(x).length },
    { id: 'planilhas', nome: 'Exportar', ico: 'baixar' },
    { grupo: 'Base' },
    { id: 'glossario', nome: 'Glossário', ico: 'livro' },
    { id: 'config', nome: 'Configurações', ico: 'ajuste' },
  ];
}

/* Telas que não estão no menu mas vivem "dentro" de um item dele: é o que
   mantém o item certo aceso quando a pessoa está numa subtela. */
const PAI_DA_ROTA = { estrutura: 'config', fornecedores: 'produtos', rastro: 'locais', ambientes: 'locais', acabamentos: 'locais', esquadrias: 'locais' };

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
  baixar: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  seta: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
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

const ROTAS_SEM_PROJETO = new Set(['empreendimentos']);

export function render() {
  const e = emp();
  /* Única rota que não depende de projeto aberto: a lista de empreendimentos
     é a casa — tudo o mais vive dentro de um empreendimento aberto. */
  if (!e && !ROTAS_SEM_PROJETO.has(estado.rota)) estado.rota = 'empreendimentos';
  const alvo = document.getElementById('conteudo');
  const view = VIEWS[estado.rota] || (e ? VIEWS.locais : VIEWS.empreendimentos);
  const menu = menuDe(e);
  const rotaAcesa = PAI_DA_ROTA[estado.rota] || estado.rota;
  document.getElementById('nav').innerHTML = menu.map(m => {
    if (m.grupo) return `<div class="grupo">${m.grupo}</div>`;
    let c = '';
    try { c = m.cont ? (m.global ? m.cont() : (e ? m.cont(e) : '')) : ''; } catch { c = ''; }
    const ativo = rotaAcesa === m.id && (!m.param || estado.param === m.param);
    return `<button data-rota="${m.id}" ${m.param ? `data-param="${m.param}"` : ''} ${ativo ? 'aria-current="page"' : ''}>
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES[m.ico] || ICONES.caixa}</svg>
      <span>${m.nome}</span>${c ? `<span class="cont">${c}</span>` : ''}</button>`;
  }).join('');

  const trilha = [`<b>${e ? esc(e.nome) : 'Prancharia'}</b>`];
  if (e) trilha.push('<span class="selo neutro">' + esc(tipoDe(e).nome) + '</span>');
  const item = menu.find(m => m.id === rotaAcesa && (!m.param || estado.param === m.param));
  if (item) trilha.push('<span>/</span>', esc(item.nome));
  document.getElementById('trilha').innerHTML = trilha.join(' ');
  renderEstadoSistema();

  alvo.innerHTML = `<div class="faixa">${view.render(e)}</div>`;
  view.depois?.(e, alvo);
  alvo.scrollTop = 0;
}

/* O rodapé da barra lateral diz, sem a pessoa precisar procurar, onde os
   dados estão indo (servidor compartilhado ou só este navegador) e qual
   motor vai ler a próxima prancha. São as duas coisas que mudam o resultado
   de tudo o mais — e que antes só apareciam em avisos espalhados. */
export function renderEstadoSistema() {
  const el = document.getElementById('estadoSistema');
  if (!el) return;
  const nuvem = store.naNuvem();
  const efemero = nuvem && store.NUVEM.persistente === false;
  const ia = iaLigada();
  const tNuvem = nuvem ? (efemero ? 'Servidor sem banco' : 'Servidor conectado') : 'Só neste navegador';
  const tIa = ia ? 'IA multimodal' : 'Leitura vetorial';
  el.innerHTML = `
    <button type="button" class="estado-item" data-rota="config" title="${nuvem ? (efemero ? 'Conectado, mas o disco do servidor é efêmero' : 'Gravando no servidor compartilhado') : 'Os dados ficam só neste navegador'}">
      <i class="ponto ${nuvem ? (efemero ? 'atencao' : 'bom') : 'neutro'}"></i><span>${tNuvem}</span></button>
    <button type="button" class="estado-item" data-rota="config" title="${ia ? 'A IA multimodal soma à leitura vetorial' : 'Só a leitura vetorial, sem rede'}">
      <i class="ponto ${ia ? 'accent' : 'neutro'}"></i><span>${tIa}</span></button>`;
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
    estado.filtros = {};
    irPara('locais');
  },
  fecharEmpreendimento() { estado.empId = null; estado.filtros = {}; irPara('empreendimentos'); },
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
export async function hidratar(id, { silencioso = false } = {}) {
  const i = estado.emps.findIndex(e => e.id === id);
  if (i < 0 || !estado.emps[i].resumo) return estado.emps[i] || null;
  try {
    const corpo = await store.carregarEmpreendimento(id);
    /* enquanto a viagem estava em curso alguém pode já ter trocado o esqueleto
       (a hidratação de fundo e o clique em "Abrir" disputam o mesmo projeto);
       o que já está inteiro em memória não é substituído */
    const j = estado.emps.findIndex(e => e.id === id);
    if (corpo && j >= 0 && estado.emps[j].resumo) { delete corpo.resumo; estado.emps[j] = migrar(corpo); }
    return j >= 0 ? estado.emps[j] : null;
  } catch (e) {
    console.warn('[nuvem] não consegui abrir o projeto', id, '-', e.message);
    if (!silencioso) aviso(`Não consegui abrir este projeto: ${e.message}`);
  }
  return estado.emps.find(e => e.id === id) || null;
}

/**
 * A tela de Empreendimentos mostra documentos, locais, itens e pendências de
 * cada projeto — e na nuvem a listagem chega só com o cabeçalho, então os
 * cartões abriam zerados até a pessoa entrar no projeto e voltar. Isto baixa
 * o corpo dos esqueletos em segundo plano, poucos por vez, e redesenha a
 * lista quando termina. Quem falhar fica de fora até a próxima listagem.
 */
let hidratacaoDeFundo = null;
const hidratacaoFalhou = new Set();
export function hidratarTodos() {
  if (hidratacaoDeFundo) return hidratacaoDeFundo;
  const pendentes = () => estado.emps.filter(e => e.resumo && !hidratacaoFalhou.has(e.id)).map(e => e.id);
  if (!pendentes().length) return Promise.resolve();
  hidratacaoDeFundo = (async () => {
    try {
      let fila = pendentes();
      while (fila.length) {
        let mudou = false;
        const operario = async () => {
          while (fila.length) {
            const id = fila.shift();
            const e = await hidratar(id, { silencioso: true });
            if (e && !e.resumo) mudou = true; else hidratacaoFalhou.add(id);
          }
        };
        await Promise.all([operario(), operario(), operario()]);
        if (mudou && estado.rota === 'empreendimentos') {
          /* redesenha sem puxar a lista de volta para o topo */
          const alvo = document.getElementById('conteudo');
          const rolagem = alvo ? alvo.scrollTop : 0;
          render();
          if (alvo) alvo.scrollTop = rolagem;
        }
        fila = pendentes();   // a lista pode ter sido trocada no meio do caminho
      }
    } finally { hidratacaoDeFundo = null; }
  })();
  return hidratacaoDeFundo;
}

/**
 * Busca a listagem de novo sem jogar fora o que já está inteiro em memória:
 * o projeto aberto fica sempre, e os demais ficam quando o servidor não tem
 * versão mais nova. O resto vira esqueleto e volta pela hidratação de fundo.
 */
export async function recarregarLista() {
  const antes = new Map(estado.emps.map(e => [e.id, e]));
  estado.emps = (await store.listarEmpreendimentos()).map(p => {
    const a = antes.get(p.id);
    if (p.resumo && a && !a.resumo && (a.id === estado.empId || a.atualizadoEm === p.atualizadoEm)) return a;
    return migrar(p);
  });
  hidratacaoFalhou.clear();
  hidratarTodos();
}

export async function iniciarApp() {
  try { const t = localStorage.getItem('prancharia:tema'); if (t) document.documentElement.setAttribute('data-theme', t); } catch { /* ok */ }
  estado.capacidades = await store.iniciar();
  carregarAprendidas(await store.lerGlossario());
  estado.emps = (await store.listarEmpreendimentos()).map(migrar);
  estado.empId = null;
  lerRota();
  /* recarregar com um projeto no hash tem de abrir esse projeto, não a lista */
  if (estado.empId) await hidratar(estado.empId);
  if (!estado.empId && estado.rota !== 'empreendimentos') estado.rota = 'empreendimentos';
  render();
  hidratarTodos();
  /* o que está só neste navegador sobe para o servidor, sem perguntar, quando
     o servidor não tem nada com aquele id — não há o que sobrescrever */
  if (store.naNuvem()) sincronizarComNuvem();
}

/**
 * Sobe os projetos que existem só neste navegador (nunca sobrescreve) e
 * anota os que existem nos dois lugares com a cópia daqui mais nova — esses
 * ficam para a pessoa decidir no aviso da tela de Empreendimentos.
 */
export async function sincronizarComNuvem() {
  try {
    const feito = await store.enviarLocaisParaNuvem({ soNovos: true });
    if (feito.projetos) {
      await recarregarLista();
      aviso(`${feito.projetos} empreendimento(s) que estavam só neste navegador foram enviados ao servidor`
        + (feito.arquivos ? ` com ${feito.arquivos} PDF(s)` : '') + '.');
    }
    if (feito.falhas.length) console.warn('[nuvem] ao enviar projetos locais:', feito.falhas);
    estado.nuvemPendentes = await store.projetosSoLocais();
  } catch (e) {
    console.warn('[nuvem] sincronização local → servidor falhou:', e.message);
  }
  render();
}

/* O servidor acordou depois de a página ter aberto em modo local (storage.js
   sonda em segundo plano): recarrega a lista de lá e sobe o que ficou aqui. */
window.addEventListener('prancharia:nuvem', async () => {
  aviso('Servidor compartilhado no ar — carregando os empreendimentos de lá.');
  try {
    await recarregarLista();
    if (estado.empId) await hidratar(estado.empId);
  } catch (e) { console.warn('[nuvem] não consegui recarregar a lista:', e.message); }
  render();
  sincronizarComNuvem();
});

export async function gravarGlossario() { await store.salvarGlossario(regrasAprendidas()); }
export { store, novoId, registrarHistorico, aprenderRegra, esquecerRegra, regrasAprendidas, empreendimentoVazio, migrar };

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
  /* um diálogo aberto por `perguntar`/`confirmar` que fecha por qualquer
     outro caminho (Escape) resolve como cancelado */
  const r = _resolverDialogo; _resolverDialogo = null;
  if (r) r(null);
}

/* ---------- diálogos: o substituto de prompt() e confirm() ----------
   Os nativos quebram o visual, não aceitam mais de um campo e não dão
   contexto. Estes dois usam o mesmo modal de sempre e devolvem uma Promise:
   `perguntar` resolve com { id: valor } ou null; `confirmar` com true/false. */
let _resolverDialogo = null;

function campoDialogo(c) {
  const id = 'dlg_' + c.id;
  const rotulo = `<label for="${id}">${esc(c.rotulo || c.id)}</label>`;
  let controle;
  if (c.tipo === 'select') {
    controle = `<select id="${id}" data-dlg="${esc(c.id)}">${c.vazio === false ? '' : '<option value=""></option>'}${(c.opcoes || []).map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(v) === String(c.valor ?? '') ? 'selected' : ''}>${esc(t)}</option>`;
    }).join('')}</select>`;
  } else if (c.tipo === 'textarea') {
    controle = `<textarea id="${id}" data-dlg="${esc(c.id)}" rows="${c.linhas || 3}" placeholder="${esc(c.placeholder || '')}">${esc(c.valor || '')}</textarea>`;
  } else {
    controle = `<input id="${id}" data-dlg="${esc(c.id)}" type="${c.tipo || 'text'}" value="${esc(c.valor || '')}" placeholder="${esc(c.placeholder || '')}" ${c.lista ? `list="${esc(c.lista)}"` : ''} autocomplete="off">`;
  }
  return `<div class="campo">${rotulo}${controle}${c.ajuda ? `<p class="ajuda-campo">${esc(c.ajuda)}</p>` : ''}</div>`;
}

export function perguntar({ titulo, texto = '', campos = [], ok = 'Salvar', cancelar = 'Cancelar', extra = '' }) {
  return new Promise((resolve) => {
    _resolverDialogo = resolve;
    abrirModal(`
      <header><h2>${esc(titulo)}</h2>${texto ? `<p>${esc(texto)}</p>` : ''}</header>
      <div class="corpo">${campos.map(campoDialogo).join('')}${extra}</div>
      <footer>
        <button type="button" class="btn discreto" data-dlg-cancelar>${esc(cancelar)}</button>
        <button type="button" class="btn primario" data-dlg-ok>${esc(ok)}</button>
      </footer>`, (m) => {
      m.querySelector('.modal-caixa').classList.add('modal-pergunta');
      const ler = () => Object.fromEntries([...m.querySelectorAll('[data-dlg]')].map(el => [el.dataset.dlg, (el.value || '').trim()]));
      const fim = (valor) => { const r = _resolverDialogo; _resolverDialogo = null; fecharModal(); if (r) r(valor); };
      m.querySelector('[data-dlg-ok]').addEventListener('click', () => fim(ler()));
      m.querySelector('[data-dlg-cancelar]').addEventListener('click', () => fim(null));
      m.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA' && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); fim(ler()); }
      });
      m.addEventListener('click', (ev) => { if (ev.target === m) fim(null); });
      const primeiro = m.querySelector('[data-dlg]');
      if (primeiro) { primeiro.focus(); if (primeiro.select) primeiro.select(); }
    });
  });
}

export function confirmar({ titulo, texto = '', ok = 'Confirmar', cancelar = 'Cancelar', perigo = false }) {
  return new Promise((resolve) => {
    _resolverDialogo = (v) => resolve(!!v);
    abrirModal(`
      <header><h2>${esc(titulo)}</h2>${texto ? `<p>${esc(texto)}</p>` : ''}</header>
      <footer>
        <button type="button" class="btn discreto" data-dlg-cancelar>${esc(cancelar)}</button>
        <button type="button" class="btn ${perigo ? 'perigo' : 'primario'}" data-dlg-ok>${esc(ok)}</button>
      </footer>`, (m) => {
      m.querySelector('.modal-caixa').classList.add('modal-pergunta', 'modal-curto');
      const fim = (v) => { const r = _resolverDialogo; _resolverDialogo = null; fecharModal(); if (r) r(v); };
      m.querySelector('[data-dlg-ok]').addEventListener('click', () => fim(true));
      m.querySelector('[data-dlg-cancelar]').addEventListener('click', () => fim(false));
      m.addEventListener('click', (ev) => { if (ev.target === m) fim(false); });
      m.querySelector('[data-dlg-ok]').focus();
    });
  });
}
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const m = document.getElementById('modal');
  if (m && !m.hidden) fecharModal(); else fecharGaveta();
});
