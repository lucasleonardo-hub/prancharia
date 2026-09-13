import {
  estado, emp, esc, celula, seloConfianca, seloStatus, marcaForma, aviso, salvar, irPara,
  ROTULO_FORMA, render, store, novoId, gravarGlossario, aprenderRegra, esquecerRegra, regrasAprendidas,
  abrirModal, fecharModal, empreendimentoVazio,
} from '../app.js';
import { TIPOS, TIPO_POR_ID, ORDEM_NIVEIS, tipoDe, niveisDe, temNivel, rotuloNivel, temAreasComuns, cadeiaDe } from '../core/tipos.js';
import { SISTEMAS, NOMES_SISTEMAS, SISTEMA_POR_NOME, COLUNAS_COPIA } from '../core/vocab.js';
import { REGRAS_BASE } from '../core/glossario.js';
import { analisarMemorial, pareceMemorial, cruzarComPranchas, fundirComMemorial } from '../core/memorial.js';
import {
  CATEGORIAS, STATUS, CONFIANCA, MOTIVOS_PENDENCIA, registrarHistorico, normalizar,
  mesmoAmbienteFlex as mesmoAmbiente, semearPavimentos, sincronizar,
  criarLocal, criarEspecificacao, criarEvidencia, novoId as novoIdModelo,
} from '../core/model.js';
import { analisarFolha, consolidar, incorporarEspecificacaoSolta, IA, configurarIA, saudeDaIA, iaLigada } from '../core/engine.js';
import { openPdf } from '../core/pdfdoc.js';
import { pendencias, pastaDeAbas, exportarXlsx, exportarCsv, exportarJson, relatorioAuditoria, tipologiasComDados, tabelaCopia, ordenarEspecificacoes, locaisDe, especificacoesDe } from '../core/exporter.js';
import { auditar, lerXlsx, lerCsv, textoDePdf } from '../core/audit.js';
import { CLASSES, analisarEmpreendimento, analisarArquivos, agrupar, resumo } from '../core/auditoria.js';
import { provasDe, rastreio, fluxo, PAPEIS, NIVEIS, refDoc, nomeDoc, paginaDoc, idDoc, refsDe, motorDe } from '../core/provas.js';
import * as empresaMem from '../core/companyMemory.js';
import { abrirGaveta, irVerNaPrancha, irVerNaPranchaLocal, fecharGaveta } from './drawer.js';
import { montarVisualizador, recortar } from './viewer.js';

const vivo = a => a && a.status !== 'excluido';

/* Leitura da árvore. O Local é o objeto central: os itens de acabamento
   moram dentro dele, e os que ainda não têm local ficam na fila de triagem
   do empreendimento. */
const locaisVivos = e => locaisDe(e);
const itens = e => especificacoesDe(e);
const semLocal = e => (e.especificacoesSemLocal || []).filter(vivo);
const itensDo = (e, localId) => {
  const l = (e.locais || []).find(x => x.id === localId);
  return l ? (l.especificacoes || []).filter(vivo) : [];
};
const acharAchado = id => {
  const e = emp(); if (!e) return null;
  for (const l of (e.locais || [])) { const x = (l.especificacoes || []).find(y => y.id === id); if (x) return x; }
  return (e.especificacoesSemLocal || []).find(y => y.id === id) || null;
};
const acharAmbiente = id => (emp()?.locais || []).find(l => l.id === id) || null;
const ordenarAchados = ordenarEspecificacoes;

/* Triagem humana: tira a Especificação de onde ela está (a fila de órfãos ou
   outro Local) e a coloca dentro do Local certo. É este o gesto de “essa porta
   pertence ao B. SERVIÇO”. */
function moverParaLocal(e, esp, alvo) {
  const fila = e.especificacoesSemLocal || (e.especificacoesSemLocal = []);
  let i = fila.indexOf(esp);
  if (i >= 0) fila.splice(i, 1);
  for (const l of (e.locais || [])) {
    const k = (l.especificacoes || []).indexOf(esp);
    if (k >= 0) l.especificacoes.splice(k, 1);
  }
  if (alvo) {
    alvo.especificacoes = alvo.especificacoes || [];
    alvo.especificacoes.push(esp);
    esp.localId = alvo.id; esp.localNome = alvo.nome;
    esp.pavimento = alvo.pavimento || ''; esp.tipologia = alvo.tipologia || esp.tipologia || '';
  } else {
    fila.push(esp);
    esp.localId = null;
  }
  return esp;
}

function tabela(colunas, linhas, opcoes = {}) {
  if (!linhas.length) return `<div class="vazio"><h3>${esc(opcoes.tituloVazio || 'Nada por aqui ainda')}</h3><p>${esc(opcoes.textoVazio || '')}</p>${opcoes.acaoVazio || ''}</div>`;
  return `<div class="rolagem"><table><thead><tr>${colunas.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.nome)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.join('')}</tbody></table></div>`;
}

const vazioDocs = `<button class="btn primario" data-rota="documentos">Enviar pranchas</button>`;

let _listaSis = null;
const listaSistemas = () => (_listaSis ||= `<datalist id="listaSistemas">${NOMES_SISTEMAS.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`);

function copiarTsv(linhas, rotulo) {
  const txt = linhas.map(l => l.map(c => String(c === null || c === undefined ? '' : c).replace(/\t|\n/g, ' ')).join('\t')).join('\n');
  const fim = () => aviso(`${rotulo} copiado (${linhas.length - 1} linha(s)). Cole direto na planilha.`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(fim, () => fallbackCopia(txt, fim));
  else fallbackCopia(txt, fim);
}
function fallbackCopia(txt, fim) {
  const ta = document.createElement('textarea');
  ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); fim(); } catch { aviso('Não foi possível copiar automaticamente.'); }
  ta.remove();
}

/* ================= VISÃO GERAL ================= */
const painel = {
  render(e) {
    if (!e) return '';
    const t = tipoDe(e);
    const niveis = niveisDe(e);
    const pend = pendencias(e);
    const todos = itens(e);
    const conflitos = todos.filter(a => a.status === 'conflito');
    const baixa = todos.filter(a => a.confianca === 'baixa');
    const confirmados = todos.filter(a => a.status === 'confirmado' || a.status === 'corrigido');
    const total = todos.length;
    const pct = total ? Math.round(confirmados.length / total * 100) : 0;

    const cards = [
      { rot: 'Documentos', val: e.documentos.length },
      ...niveis.map(n => ({ rot: n.plural, val: (e.estrutura[n.nivel] || []).length })),
      { rot: 'Locais', val: locaisVivos(e).length },
      { rot: 'Sem local', val: semLocal(e).length, tom: semLocal(e).length ? 'aviso' : '', rota: 'pendencias' },
      { rot: 'Esquadrias', val: todos.filter(a => a.categoria === 'Esquadrias').length },
      { rot: 'Acabamentos', val: total },
      { rot: 'Pendentes', val: pend.length, tom: pend.length ? 'aviso' : '' },
      { rot: 'Conflitos', val: conflitos.length, tom: conflitos.length ? 'alerta' : '' },
      { rot: 'Confirmados', val: pct, sufixo: '%' },
    ];

    return `
      <div class="cabeca">
        <div><h1>${esc(e.nome)}</h1>
        <p class="desc">${esc(t.nome)}${e.localizacao ? ' · ' + esc(e.localizacao) : ''} — ${esc(t.resumo)}</p></div>
        <div class="acoes">
          <button class="btn" data-acao="fecharEmpreendimento">Trocar de empreendimento</button>
          <button class="btn" data-rota="documentos">${e.documentos.length ? 'Documentos' : 'Enviar documentos'}</button>
          <button class="btn primario" data-rota="planilhas">Gerar planilha</button>
        </div>
      </div>

      <div class="cadeia-tipo">${cadeiaDe(e).map((c, i) => `${i ? '<i>›</i>' : ''}<span>${esc(c)}</span>`).join('')}
        ${temAreasComuns(e) ? '<span class="selo neutro" style="margin-left:6px">MC + MP</span>' : '<span class="selo neutro" style="margin-left:6px">só MP</span>'}</div>

      ${!e.documentos.length ? `<div class="cartao"><div class="vazio">
        <h3>Empreendimento criado. Agora os documentos.</h3>
        <p>Envie as pranchas e os memoriais deste empreendimento. Tudo o que for extraído fica vinculado a ele.</p>
        <button class="btn primario" data-rota="documentos">Adicionar documentos</button></div></div>` : ''}

      <dl class="placar">
        ${cards.map(c => `<div class="${c.tom || ''}"><dt>${esc(c.rot)}</dt><dd>${c.val}${c.sufixo ? `<small>${c.sufixo}</small>` : ''}</dd></div>`).join('')}
      </dl>

      ${total ? `<div class="cartao"><header><h2>Distribuição por categoria</h2></header><div class="corpo">
        ${barras(CATEGORIAS.map(c => ({ nome: c, n: todos.filter(a => a.categoria === c).length })), total)}
      </div></div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px">
        <div class="cartao"><header><h2>Confiança</h2><div class="acoes"><button class="btn pequeno" data-rota="pendencias">Pendências</button></div></header>
          <div class="corpo">${barras([
            { nome: 'Alta', n: todos.filter(a => a.confianca === 'alta').length, cor: 'var(--bom)' },
            { nome: 'Média', n: todos.filter(a => a.confianca === 'media').length, cor: 'var(--atencao)' },
            { nome: 'Baixa', n: baixa.length, cor: 'var(--critico)' },
          ], total || 1)}</div></div>
        <div class="cartao"><header><h2>Últimas atividades</h2></header><div class="corpo">
          ${e.historico.length ? `<ul class="lista-limpa">${e.historico.slice(0, 7).map(h => `<li><span class="pilula">${new Date(h.quando).toLocaleDateString('pt-BR')}</span><div>${esc(h.texto)}</div></li>`).join('')}</ul>`
            : '<p style="color:var(--ink-3);font-size:13px">Nenhuma atividade registrada.</p>'}
        </div></div>
      </div>`;
  },
};

function barras(itens, total) {
  const max = Math.max(1, ...itens.map(i => i.n));
  return `<div style="display:flex;flex-direction:column;gap:9px">${itens.filter(i => i.n).map(i => `
    <div style="display:grid;grid-template-columns:140px 1fr 44px;gap:12px;align-items:center;font-size:13px">
      <span>${esc(i.nome)}</span>
      <span style="height:9px;background:var(--surface-3);border-radius:5px;overflow:hidden"><i style="display:block;height:100%;width:${Math.round(i.n / max * 100)}%;background:${i.cor || 'var(--accent)'};border-radius:5px"></i></span>
      <span class="num" style="text-align:right;color:var(--ink-2)">${i.n}</span>
    </div>`).join('') || '<p style="color:var(--ink-3);font-size:13px">Sem dados.</p>'}</div>`;
}

/* ================= EMPREENDIMENTOS ================= */

function statusProcessamento(e) {
  if (!e.documentos.length) return { rotulo: 'Sem documentos', tom: 'neutro' };
  const faltam = e.documentos.filter(d => !d.processadoEm).length;
  if (faltam) return { rotulo: `${faltam} aguardando`, tom: 'atencao' };
  const pend = pendencias(e).length;
  if (pend) return { rotulo: `${pend} em revisão`, tom: 'atencao' };
  return { rotulo: 'Processado', tom: 'bom' };
}

function cartaoTipo(t, selecionado) {
  return `<button type="button" class="tipo" data-tipo="${t.id}" aria-pressed="${selecionado ? 'true' : 'false'}">
    <span class="fam">${esc(t.familia)}</span>
    <b>${esc(t.nome)}</b>
    <small>${esc(t.resumo)}</small>
  </button>`;
}

function camposDoTipo(tipoId, dados = {}) {
  const t = TIPO_POR_ID[tipoId];
  if (!t) return '';
  const cadeia = ['Empreendimento', ...t.niveis.map(n => n.singular), 'Ambiente'];
  return `
    <div class="cadeia-tipo">${cadeia.map((c, i) => `${i ? '<i>›</i>' : ''}<span>${esc(c)}</span>`).join('')}
      ${t.areasComuns ? '<span class="selo neutro" style="margin-left:6px">com áreas comuns</span>' : ''}</div>
    ${t.campos.length ? `<div class="grade2">${t.campos.map(c => `
      <div class="campo"><label for="cmp_${c.chave}">${esc(c.rotulo)}</label>
      <input id="cmp_${c.chave}" type="number" min="0" step="1" data-campo="${c.chave}" value="${esc(dados[c.chave] ?? '')}" placeholder="—"></div>`).join('')}</div>`
      : '<p style="font-size:13px;color:var(--ink-3)">Este tipo não pede mais nenhum dado nesta etapa.</p>'}`;
}

function formEmpreendimento(existente) {
  const editando = !!existente;
  let tipoSel = existente ? existente.tipo : 'casa';
  const dados = { ...(existente?.dados || {}) };

  const html = `
    <header>
      <h2>${editando ? 'Editar empreendimento' : 'Criar empreendimento'}</h2>
      <p>O tipo define quais níveis, campos e módulos o sistema vai usar neste projeto. Dá para mudar depois em Configurações.</p>
    </header>
    <div class="corpo">
      <div class="campo"><label for="empNome">Nome do empreendimento</label>
        <input id="empNome" value="${esc(existente?.nome || '')}" placeholder="Ex.: Residencial Alexandre Pompeo" autocomplete="off"></div>
      <div class="campo"><label>Tipo de empreendimento</label>
        <div class="tipos" id="listaTipos">${TIPOS.map(t => cartaoTipo(t, t.id === tipoSel)).join('')}</div></div>
      <div id="camposTipo" style="display:flex;flex-direction:column;gap:14px">${camposDoTipo(tipoSel, dados)}</div>
      <div class="grade2">
        <div class="campo"><label for="empLocal">Localização</label>
          <input id="empLocal" value="${esc(existente?.localizacao || existente?.endereco || '')}" placeholder="Cidade / UF ou endereço"></div>
        <div class="campo"><label for="empResp">Responsável técnico</label>
          <input id="empResp" value="${esc(existente?.responsavel || '')}" placeholder="Opcional"></div>
      </div>
      <div class="campo"><label for="empObs">Observações</label>
        <textarea id="empObs" rows="2" placeholder="Opcional">${esc(existente?.observacoes || '')}</textarea></div>
    </div>
    <footer>
      <button class="btn discreto" data-acao="fecharModal">Cancelar</button>
      <button class="btn primario" data-acao="${editando ? 'salvarEmpEdicao' : 'salvarEmpNovo'}" ${editando ? `data-id="${existente.id}"` : ''}>
        ${editando ? 'Salvar alterações' : 'Criar e abrir'}</button>
    </footer>`;

  abrirModal(html, (m) => {
    m.querySelector('#listaTipos').addEventListener('click', ev => {
      const b = ev.target.closest('[data-tipo]');
      if (!b) return;
      tipoSel = b.dataset.tipo;
      for (const x of m.querySelectorAll('[data-tipo]')) x.setAttribute('aria-pressed', x.dataset.tipo === tipoSel ? 'true' : 'false');
      for (const inp of m.querySelectorAll('#camposTipo [data-campo]')) dados[inp.dataset.campo] = inp.value;
      m.querySelector('#camposTipo').innerHTML = camposDoTipo(tipoSel, dados);
    });
    m.dataset.tipoEscolhido = tipoSel;
    m.addEventListener('click', () => { m.dataset.tipoEscolhido = tipoSel; });
  });
}

function lerForm(m) {
  const val = id => (m.querySelector('#' + id)?.value || '').trim();
  const dados = {};
  for (const inp of m.querySelectorAll('#camposTipo [data-campo]')) {
    const n = parseInt(inp.value, 10);
    if (Number.isFinite(n) && n > 0) dados[inp.dataset.campo] = n;
  }
  const tipo = m.querySelector('[data-tipo][aria-pressed="true"]')?.dataset.tipo || 'outro';
  return { nome: val('empNome'), tipo, localizacao: val('empLocal'), responsavel: val('empResp'), observacoes: val('empObs'), dados };
}

function semearEstrutura(e) {
  const t = TIPO_POR_ID[e.tipo];
  if (!t) return;
  for (const c of t.campos) {
    if (!c.semente) continue;
    const n = e.dados[c.chave];
    if (!n || e.estrutura[c.semente].length) continue;
    const nivel = t.niveis.find(x => x.nivel === c.semente);
    const base = nivel ? nivel.singular : c.semente;
    for (let i = 1; i <= Math.min(n, 60); i++) {
      e.estrutura[c.semente].push({ id: novoId('niv'), nome: `${base} ${String(i).padStart(2, '0')}`, descricao: '', origem: 'cadastro' });
    }
  }
}

const empreendimentos = {
  render() {
    const lista = estado.emps;
    const cartoes = lista.map(e => {
      const t = tipoDe(e);
      const st = statusProcessamento(e);
      const niveis = niveisDe(e);
      return `<article class="emp-cartao ${e.id === estado.empId ? 'atual' : ''}">
        <div class="topo">
          <div style="min-width:0">
            <h3>${esc(e.nome)}</h3>
            <div class="meta">${esc(t.nome)}${e.localizacao ? ' · ' + esc(e.localizacao) : ''}</div>
          </div>
          <span class="selo ${st.tom}" style="margin-left:auto;flex:none">${esc(st.rotulo)}</span>
        </div>
        ${niveis.length ? `<div class="cadeia-tipo">${['Empreendimento', ...niveis.map(n => n.singular), 'Ambiente']
          .map((c, i) => `${i ? '<i>›</i>' : ''}<span>${esc(c)}</span>`).join('')}</div>` : ''}
        <dl class="emp-numeros">
          <div><dt>Docs</dt><dd>${e.documentos.length}</dd></div>
          <div><dt>Locais</dt><dd>${locaisVivos(e).length}</dd></div>
          <div><dt>Itens</dt><dd>${itens(e).length}</dd></div>
          <div><dt>Pendências</dt><dd>${pendencias(e).length}</dd></div>
        </dl>
        <div class="meta">Atualizado em ${e.atualizadoEm ? new Date(e.atualizadoEm).toLocaleString('pt-BR') : '—'}</div>
        <div class="acoes">
          <button class="btn primario pequeno" data-acao="abrirEmpreendimento" data-id="${e.id}">Abrir</button>
          <button class="btn pequeno" data-acao="editarEmp" data-id="${e.id}">Editar</button>
          <button class="btn pequeno" data-acao="duplicarEmp" data-id="${e.id}">Duplicar</button>
          <button class="btn pequeno discreto" data-acao="apagarEmp" data-id="${e.id}">Excluir</button>
        </div>
      </article>`;
    }).join('');

    return `<div class="cabeca">
      <div><h1>Empreendimentos</h1>
      <p class="desc">Tudo começa aqui: crie o empreendimento, defina o tipo e só então envie os documentos. O tipo escolhido configura os níveis, o menu e os campos do projeto.</p></div>
      <div class="acoes"><button class="btn primario" data-acao="criarEmp">Criar empreendimento</button></div></div>

      ${lista.length ? `<div class="cartoes-emp">${cartoes}</div>`
        : `<div class="cartao"><div class="vazio">
            <h3>Nenhum empreendimento ainda</h3>
            <p>Comece criando o empreendimento e escolhendo o tipo — casa, condomínio de apartamentos, hotel, galpão. A partir daí o sistema monta a estrutura certa para ele.</p>
            <button class="btn primario" data-acao="criarEmp">Criar empreendimento</button>
          </div></div>`}`;
  },
  acoes: {
    criarEmp() { formEmpreendimento(null); },
    editarEmp({ id }) { formEmpreendimento(estado.emps.find(x => x.id === id)); },
    async salvarEmpNovo(_d, _el) {
      const m = document.getElementById('modal');
      const dados = lerForm(m);
      if (!dados.nome) { aviso('Dê um nome ao empreendimento.'); m.querySelector('#empNome')?.focus(); return; }
      const e = empreendimentoVazio(dados.nome, dados.tipo);
      Object.assign(e, { localizacao: dados.localizacao, responsavel: dados.responsavel, observacoes: dados.observacoes, dados: dados.dados });
      /* nasce vinculado à construtora ativa: é o vínculo que faz a memória
         técnica dela valer neste projeto */
      const daCasa = empresaMem.empresaAtiva();
      if (daCasa) e.empresaId = daCasa.id;
      semearEstrutura(e);
      registrarHistorico(e, { texto: `Empreendimento criado como ${tipoDe(e).nome}`
        + (daCasa ? ` para ${daCasa.nome}` : ''), tipo: 'empreendimento' });
      estado.emps.unshift(e); estado.empId = e.id;
      await store.salvarEmpreendimento(e);
      fecharModal(); irPara('painel'); aviso('Empreendimento criado.');
    },
    async salvarEmpEdicao({ id }) {
      const m = document.getElementById('modal');
      const e = estado.emps.find(x => x.id === id); if (!e) return;
      const d = lerForm(m);
      if (!d.nome) { aviso('Dê um nome ao empreendimento.'); return; }
      const antes = `${e.nome} (${tipoDe(e).nome})`;
      const mudouTipo = e.tipo !== d.tipo;
      Object.assign(e, { nome: d.nome, tipo: d.tipo, localizacao: d.localizacao, responsavel: d.responsavel, observacoes: d.observacoes });
      e.dados = { ...e.dados, ...d.dados };
      if (mudouTipo) semearEstrutura(e);
      registrarHistorico(e, { texto: `Cadastro alterado`, tipo: 'empreendimento', antes, depois: `${e.nome} (${tipoDe(e).nome})` });
      const alvo = estado.empId; estado.empId = e.id; await salvar(); estado.empId = alvo || e.id;
      fecharModal(); render(); aviso('Empreendimento atualizado.');
    },
    async duplicarEmp({ id }) {
      const orig = estado.emps.find(x => x.id === id); if (!orig) return;
      const copia = JSON.parse(JSON.stringify(orig));
      copia.id = novoId('emp');
      copia.nome = orig.nome + ' (cópia)';
      copia.criadoEm = copia.atualizadoEm = new Date().toISOString();
      copia.documentos = []; copia.locais = []; copia.especificacoesSemLocal = []; copia.tabelas = []; copia.legendas = [];
      copia.historico = [{ id: novoId('h'), quando: new Date().toISOString(), texto: `Duplicado de ${orig.nome} — estrutura e marcas mantidas, documentos não`, tipo: 'empreendimento' }];
      estado.emps.unshift(copia);
      const alvo = estado.empId; estado.empId = copia.id; await salvar(); estado.empId = alvo;
      render(); aviso('Cópia criada com a estrutura, tipologias e marcas do original.');
    },
    async apagarEmp({ id }) {
      const e = estado.emps.find(x => x.id === id);
      if (!confirm(`Excluir “${e ? e.nome : 'este empreendimento'}” e todos os seus dados?`)) return;
      await store.apagarEmpreendimento(id);
      estado.emps = estado.emps.filter(x => x.id !== id);
      if (estado.empId === id) estado.empId = null;
      render(); aviso('Empreendimento excluído.');
    },
    fecharModal() { fecharModal(); },
  },
};

/* ================= DOCUMENTOS ================= */
const documentos = {
  render(e) {
    if (!e) return '';
    const foco = estado.filtros.foco;
    const sel = estado.param || foco?.documentoId;
    const doc = e.documentos.find(d => d.id === sel);
    const linhas = e.documentos.map(d => `<tr>
      <td><button class="btn discreto" style="padding:0;font-weight:600" data-acao="verDoc" data-id="${d.id}">${esc(d.nome)}</button>
        <div style="color:var(--ink-3);font-size:12px">${esc(d.revisao ? 'revisão ' + d.revisao + ' · ' : '')}${(d.bytes / 1048576).toFixed(1)} MB</div></td>
      <td>${d.tipo === 'memorial' ? '<span class="selo neutro">memorial</span>' : '<span class="selo neutro">prancha</span>'}</td>
      <td class="num">${d.paginas || 1}</td>
      <td class="num">${d.tipo === 'memorial' ? (d.itens || 0) : (d.tags || 0)}</td>
      <td class="num">${d.locaisLidos ?? d.ambientes ?? 0}</td>
      <td>${d.motorFusao === 'multimodal_gemini' ? '<span class="selo bom">fusão semântica</span>'
        : d.tipo === 'memorial' && d.processadoEm ? '<span class="selo neutro">cruzamento por texto</span>' : '<span class="vazio-celula"></span>'}</td>
      <td>${d.processadoEm ? `<span class="selo bom">processado</span>` : '<span class="selo atencao">aguardando</span>'}</td>
      <td>${esc(d.enviadoEm ? new Date(d.enviadoEm).toLocaleString('pt-BR') : '')}</td>
      <td style="white-space:nowrap">
        <button class="btn pequeno" data-acao="verDoc" data-id="${d.id}">Abrir</button>
        <button class="btn pequeno discreto" data-acao="removerDoc" data-id="${d.id}">Remover</button></td></tr>`).join('');
    return `
      <div class="cabeca"><div><h1>Documentos</h1><p class="desc">Pranchas, memoriais e cadernos do empreendimento. Das pranchas o sistema lê tags, legendas e tabelas; dos memoriais lê o texto corrido, marca e modelo. Envie as pranchas antes dos memoriais para que os trechos encontrem o local certo.</p></div>
        <div class="acoes">
          <label class="btn primario" for="entradaDocs">Enviar arquivos</label>
          <input id="entradaDocs" type="file" accept="application/pdf" multiple hidden>
          ${e.documentos.some(d => !d.processadoEm) ? '<button class="btn" data-acao="processarTudo">Processar pendentes</button>' : ''}
          ${e.documentos.some(d => d.tipo === 'memorial') ? '<button class="btn" data-acao="reprocessarMemoriais">Recruzar memoriais</button>' : ''}
        </div></div>
      ${estado.processando ? `<div class="cartao"><div class="corpo">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>${esc(estado.processando.texto)}</span><span class="num">${Math.round(estado.processando.pct * 100)}%</span></div>
        <div class="progresso"><i style="width:${Math.round(estado.processando.pct * 100)}%"></i></div></div></div>` : ''}
      <div class="cartao">${tabela(
        [{ nome: 'Arquivo' }, { nome: 'Tipo' }, { nome: 'Págs.', num: 1 }, { nome: 'Tags / itens', num: 1 }, { nome: 'Locais', num: 1 }, { nome: 'Fusão' }, { nome: 'Situação' }, { nome: 'Enviado' }, { nome: '' }],
        linhas ? [linhas] : [],
        { tituloVazio: 'Nenhum documento enviado', textoVazio: 'Envie as pranchas em PDF. Os arquivos ficam neste navegador e os dados extraídos acompanham o empreendimento.' })}
      </div>
      ${doc ? `<div class="cartao"><header><h2>${esc(doc.nome)}</h2>
        <div class="acoes"><span class="pilula">${doc.paginas || 1} página(s)</span></div></header>
        <div id="visorCaixa"></div></div>` : ''}`;
  },
  depois(e, alvo) {
    const inp = alvo.querySelector('#entradaDocs');
    if (inp) inp.addEventListener('change', ev => receberArquivos([...ev.target.files]));
    const caixa = alvo.querySelector('#visorCaixa');
    if (!caixa) return;
    const sel = estado.param || estado.filtros.foco?.documentoId;
    const foco = estado.filtros.foco;
    const tags = (e.tagsPorDoc?.[sel] || []).map(t => ({ x: t.x, y: t.y, forma: t.forma, numero: t.numero }));
    montarVisualizador(caixa, {
      documentoId: sel,
      pagina: foco?.documentoId === sel ? (foco.pagina || 1) : 1,
      // o foco completo: o ponto lido, o rótulo e a legenda que o traduz
      foco: foco?.documentoId === sel ? foco : null,
      tags,
    });
    estado.filtros.foco = null;
  },
  acoes: {
    verDoc({ id }) { irPara('documentos', id); },
    async removerDoc({ id }) {
      const e = emp();
      if (!confirm('Remover o documento e os itens extraídos dele?')) return;
      e.documentos = e.documentos.filter(d => d.id !== id);
      /* o item que só existia por causa deste documento sai; o que tinha
         outras origens perde apenas a evidência daquele arquivo */
      const daquele = ev => ((ev.documentoOrigem || {}).docId) === id;
      for (const l of (e.locais || [])) {
        l.especificacoes = (l.especificacoes || []).filter(a => !(a.evidencias || []).every(daquele));
        for (const a of l.especificacoes) a.evidencias = (a.evidencias || []).filter(ev => !daquele(ev));
        l.evidencias = (l.evidencias || []).filter(ev => !daquele(ev));
      }
      e.especificacoesSemLocal = (e.especificacoesSemLocal || []).filter(a => !(a.evidencias || []).every(daquele));
      for (const a of e.especificacoesSemLocal) a.evidencias = (a.evidencias || []).filter(ev => !daquele(ev));
      e.locais = (e.locais || []).filter(l => (l.evidencias || []).length || (l.especificacoes || []).length);
      sincronizar(e);
      e.tabelas = e.tabelas.filter(t => t.documentoId !== id);
      e.legendas = e.legendas.filter(t => t.documentoId !== id);
      await salvar({ texto: 'Documento removido', tipo: 'documento' });
      render(); aviso('Documento removido.');
    },
    async processarTudo() {
      const e = emp();
      for (const d of e.documentos.filter(x => !x.processadoEm)) await processarDocumento(d);
      const aud = await auditarNoProcessamento(e);
      await salvar();
      render();
      aviso(`Auditoria concluída: ${aud.n} correção(ões) automática(s), ${aud.r.abertas} pendência(s) para revisão.`);
    },
    async reprocessarMemoriais() {
      const e = emp();
      for (const l of (e.locais || [])) l.especificacoes = (l.especificacoes || []).filter(a => a.origemLeitura !== 'memorial');
      e.especificacoesSemLocal = (e.especificacoesSemLocal || []).filter(a => a.origemLeitura !== 'memorial');
      sincronizar(e);
      for (const d of e.documentos.filter(x => x.tipo === 'memorial')) { d.processadoEm = null; await processarDocumento(d); }
      const aud = await auditarNoProcessamento(e);
      await salvar();
      render();
      aviso(`Memoriais recruzados. ${aud.r.abertas} pendência(s) para revisão.`);
    },
  },
};

async function receberArquivos(arquivos) {
  const e = emp();
  for (const f of arquivos) {
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { aviso('Só PDF por enquanto: ' + f.name); continue; }
    const rev = /[-_ ]R(\d{2})\b/i.exec(f.name) || /(\d{2})Folha/i.exec(f.name);
    const meta = {
      id: novoId('doc'), nome: f.name, bytes: f.size, enviadoEm: new Date().toISOString(),
      revisao: rev ? 'R' + rev[1] : '', paginas: 0, tags: 0, locaisLidos: 0, processadoEm: null, anexo: null,
    };
    const anterior = e.documentos.find(d => raiz(d.nome) === raiz(f.name) && d.revisao !== meta.revisao);
    if (anterior) meta.substitui = anterior.id;
    e.documentos.push(meta);
    estado.pdfs.set(meta.id, { blob: f });
    /* o projeto e o nome viajam junto: é o que liga a prancha ao levantamento
       do lado do servidor, e o que faz a lista de arquivos do projeto existir */
    const guardado = await store.guardarArquivo(meta.id, f, { projetoId: e.id, nome: f.name });
    if (guardado && guardado.url) {
      /* na nuvem o próprio upload já devolve o endereço: chamar `enviarAnexo`
         aqui subiria os mesmos 3 MB uma segunda vez, por nada. */
      meta.anexo = store.NUVEM.base + guardado.url;
    } else {
      store.enviarAnexo(f, { projetoId: e.id, nome: f.name }).then(url => { if (url) { meta.anexo = url; salvar(); } });
    }
    render();
    await processarDocumento(meta);
  }
  await salvar({ texto: `${arquivos.length} documento(s) enviado(s)`, tipo: 'documento' });
  const aud = await auditarNoProcessamento(e);
  await salvar();
  render();
  aviso(aud.n
    ? `${aud.n} correção(ões) aplicada(s) pela auditoria. ${aud.r.abertas} pendência(s) para você revisar.`
    : `Auditoria concluída: ${aud.r.abertas} pendência(s) para revisão.`);
}
const raiz = n => n.replace(/\.pdf$/i, '').replace(/[-_ ]?R?\d{2}$/i, '').trim();

/* Auditoria interna, disparada pelo processamento.

   Só corrige sozinha o que é objetivamente verificável e aditivo: preencher um
   campo vazio com o que o glossário já sabe, ou trocar uma categoria que não
   existe no vocabulário da planilha pela que a própria descrição indica. Nada
   é apagado e nada é adivinhado — tudo o que admite interpretação segue para
   Pendências de revisão, com as fontes à vista. */
const AUTO_SEGURAS = new Set(['sem_sistema', 'sem_categoria', 'categoria_fora']);

async function auditarNoProcessamento(e) {
  e.revisoes = e.revisoes || {};
  let n = 0;
  for (const o of ocorrencias(e, true)) {
    if (e.revisoes[o.id] || !AUTO_SEGURAS.has(o.regra) || !o.sugerido || !o.campo) continue;
    const achado = acharAchado(o.alvoId);
    if (!achado) continue;
    // preenche vazio, ou substitui um valor que a planilha não aceita
    if (achado[o.campo] && o.regra !== 'categoria_fora') continue;
    if (!await aplicarOcorrencia(e, o, 'aplicado', o.sugerido, { aprender: false })) continue;
    e.revisoes[o.id] = { estado: 'auto', quando: new Date().toISOString(), valor: o.sugerido };
    n++;
  }
  const r = resumo(ocorrencias(e, true), e.revisoes);
  registrarHistorico(e, {
    tipo: 'auditoria',
    texto: `Auditoria automática: ${n} correção(ões) aplicada(s) sem intervenção; ${r.abertas} ocorrência(s) para revisão humana `
      + `(${r.erro} erro confirmado, ${r.conflito} conflito, ${r.provavel} provável, ${r.revisar} a revisar, ${r.insuficiente} sem informação no documento)`,
  });
  return { n, r };
}

function atualizarProgresso(texto, pct) {
  estado.processando = { texto, pct };
  const barra = document.querySelector('.progresso i');
  if (barra) {
    barra.style.width = Math.round(pct * 100) + '%';
    const rot = barra.parentElement.previousElementSibling;
    if (rot && rot.firstElementChild) rot.firstElementChild.textContent = texto;
  }
}

async function processarDocumento(meta) {
  const e = emp();
  estado.processando = { texto: 'abrindo ' + meta.nome, pct: 0.02 };
  render();
  try {
    const blob = estado.pdfs.get(meta.id)?.blob || await store.lerArquivo(meta.id);
    const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
    estado.pdfs.set(meta.id, { doc, blob });
    meta.paginas = doc.numPages;
    if (!meta.tipo) {
      const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
      meta.tipo = Math.max(vp.width, vp.height) < 1200 ? 'memorial' : 'prancha';
    }
    if (meta.tipo === 'memorial') {
      /* 1) o que o próprio memorial diz, frase por frase — entra como itens
            de origem 'memorial', com a página e o trecho guardados */
      const r = await analisarMemorial(doc, meta, locaisVivos(e),
        (texto, pct) => atualizarProgresso(texto, pct * 0.7));
      for (const a of r.especificacoes) incorporarEspecificacaoSolta(e, a);
      /* 2) a fusão com as pranchas: casamento semântico pela IA quando ela
            está ligada, heurística de texto quando não */
      const f = await fundirComMemorial(e, doc, meta, r.especificacoes,
        (texto, pct) => atualizarProgresso(texto, 0.7 + pct * 0.3));
      meta.itens = r.especificacoes.length;
      meta.locaisLidos = locaisVivos(e).length;
      meta.motorFusao = f.motor;
      meta.processadoEm = new Date().toISOString();
      const comoFoi = f.motor === 'multimodal_gemini'
        ? `${f.atualizacoes} casamento(s) semântico(s): ${f.enriquecidas} especificação(ões) enriquecida(s) em ${f.campos} campo(s), ${f.conflitos} conflito(s)`
        : `cruzamento por texto: ${f.marcas} marca(s), ${f.conflitos} conflito(s)`
          + (f.erro ? ` — a fusão semântica falhou (${f.erro})` : '');
      registrarHistorico(e, { texto: `${meta.nome} (memorial) lido: ${r.especificacoes.length} trechos · ${comoFoi}`, tipo: 'processamento' });
      estado.processando = null; await salvar(); render();
      if (f.motor === 'multimodal_gemini') {
        aviso(`Memorial fundido pela IA: ${f.enriquecidas} especificação(ões) enriquecida(s)`
          + `${f.conflitos ? `, ${f.conflitos} conflito(s) para revisar` : ''}.`);
      }
      return;
    }
    e.tagsPorDoc = e.tagsPorDoc || {};
    e.tagsPorDoc[meta.id] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const folha = await analisarFolha(doc, p, meta, (texto, pct) =>
        atualizarProgresso(`${meta.nome} — página ${p}: ${texto}`, (p - 1 + pct) / doc.numPages));
      await consolidar(e, folha, meta);
      meta.tags += folha.tags.length;
      meta.locaisLidos = locaisVivos(e).length;
      e.tagsPorDoc[meta.id].push(...folha.tags.map(t => ({ x: t.x, y: t.y, forma: t.forma, numero: t.numero, pagina: p })));
    }
    if (meta.substitui) {
      const ant = e.documentos.find(d => d.id === meta.substitui);
      if (ant) registrarHistorico(e, { texto: `Revisão ${meta.revisao || 'nova'} de ${ant.nome} processada — versão anterior mantida no histórico`, tipo: 'revisao' });
    }
    meta.processadoEm = new Date().toISOString();
    registrarHistorico(e, { texto: `${meta.nome} processado: ${meta.tags} tags, ${locaisVivos(e).length} locais`, tipo: 'processamento' });
  } catch (err) {
    console.error(err);
    aviso('Falha ao ler ' + meta.nome + ': ' + err.message);
    registrarHistorico(e, { texto: `Falha ao processar ${meta.nome}: ${err.message}`, tipo: 'erro' });
  }
  estado.processando = null;
  await salvar();
  render();
}

/* ================= ESTRUTURA (níveis do tipo) ================= */

const PAI_DE = { tipologia: 'grupo', unidade: 'tipologia', pavimento: 'grupo' };

const estrutura = {
  render(e) {
    if (!e) return '';
    const nivel = estado.param || niveisDe(e)[0]?.nivel;
    const def = niveisDe(e).find(n => n.nivel === nivel);
    if (!def) return `<div class="cartao"><div class="vazio"><h3>Nível não usado neste tipo</h3>
      <p>O tipo ${esc(tipoDe(e).nome)} não trabalha com esse nível. Você pode ligá-lo em Configurações.</p>
      <button class="btn" data-rota="config">Abrir configurações</button></div></div>`;

    const itens = e.estrutura[nivel] || [];
    const paiNivel = temNivel(e, PAI_DE[nivel]) ? PAI_DE[nivel] : null;
    const pais = paiNivel ? (e.estrutura[paiNivel] || []) : [];
    const campoAmb = nivel === 'pavimento' ? null : nivel + 'Id';

    const contar = (it) => nivel === 'pavimento'
      ? locaisVivos(e).filter(a => normalizar(a.pavimento) === normalizar(it.nome)).length
      : locaisVivos(e).filter(a => a[campoAmb] === it.id).length;

    const linhas = itens.map(it => `<tr>
      <td><b>${esc(it.nome)}</b>${it.origem === 'prancha' ? ' <span class="selo neutro">da prancha</span>' : ''}</td>
      ${paiNivel ? `<td>${celula((pais.find(p => p.id === it.paiId) || {}).nome)}</td>` : ''}
      <td style="max-width:420px">${celula(it.descricao)}</td>
      <td class="num">${contar(it)}</td>
      <td style="white-space:nowrap">
        <button class="btn pequeno" data-acao="editarNivel" data-nivel="${nivel}" data-id="${it.id}">Editar</button>
        <button class="btn pequeno discreto" data-acao="removerNivel" data-nivel="${nivel}" data-id="${it.id}">Remover</button></td></tr>`).join('');

    return `<div class="cabeca"><div><h1>${esc(def.plural)}</h1>
      <p class="desc">${esc(def.ajuda)} Este nível existe porque o tipo do empreendimento é <b>${esc(tipoDe(e).nome)}</b>.</p></div>
      <div class="acoes">
        ${nivel === 'pavimento' ? '<button class="btn" data-acao="importarPavimentos">Trazer das pranchas</button>' : ''}
        <button class="btn primario" data-acao="novoNivel" data-nivel="${nivel}">Adicionar ${esc(def.singular.toLowerCase())}</button>
      </div></div>

      <div class="cadeia-tipo">${cadeiaDe(e).map((c, i) => `${i ? '<i>›</i>' : ''}<span style="${normalizar(c) === normalizar(def.singular) ? 'color:var(--accent);font-weight:600' : ''}">${esc(c)}</span>`).join('')}</div>

      <div class="cartao">${tabela(
        [{ nome: def.singular }, ...(paiNivel ? [{ nome: rotuloNivel(e, paiNivel) }] : []), { nome: 'Descrição' }, { nome: 'Locais', num: 1 }, { nome: '' }],
        linhas ? [linhas] : [],
        { tituloVazio: `Nenhum ${def.singular.toLowerCase()} cadastrado`,
          textoVazio: nivel === 'pavimento'
            ? 'Os pavimentos aparecem sozinhos quando você processa uma prancha com legenda de planta, ou podem ser criados à mão.'
            : `Cadastre ${def.plural.toLowerCase()} para organizar os locais deste empreendimento.` })}
      </div>`;
  },
  acoes: {
    async novoNivel({ nivel }) {
      const e = emp();
      const nome = prompt(`Nome do novo ${rotuloNivel(e, nivel).toLowerCase()}`);
      if (!nome?.trim()) return;
      e.estrutura[nivel].push({ id: novoId('niv'), nome: nome.trim(), descricao: '', origem: 'manual' });
      await salvar({ texto: `${rotuloNivel(e, nivel)} criado: ${nome.trim()}`, tipo: 'estrutura' });
      render();
    },
    async editarNivel({ nivel, id }) {
      const e = emp();
      const it = e.estrutura[nivel].find(x => x.id === id); if (!it) return;
      const nome = prompt(`Nome do ${rotuloNivel(e, nivel).toLowerCase()}`, it.nome);
      if (nome === null) return;
      const desc = prompt('Descrição (opcional)', it.descricao || '');
      const antes = it.nome;
      it.nome = nome.trim() || antes;
      if (desc !== null) it.descricao = desc.trim();
      await salvar({ texto: `${rotuloNivel(e, nivel)} editado`, tipo: 'estrutura', antes, depois: it.nome });
      render();
    },
    async removerNivel({ nivel, id }) {
      const e = emp();
      const it = e.estrutura[nivel].find(x => x.id === id);
      if (!confirm(`Remover “${it ? it.nome : ''}”? Os locais vinculados ficam sem esse vínculo.`)) return;
      e.estrutura[nivel] = e.estrutura[nivel].filter(x => x.id !== id);
      const campo = nivel + 'Id';
      for (const a of (e.locais || [])) if (a[campo] === id) a[campo] = '';
      await salvar({ texto: `${rotuloNivel(e, nivel)} removido: ${it ? it.nome : ''}`, tipo: 'estrutura' });
      render();
    },
    async importarPavimentos() {
      const e = emp();
      const antes = e.estrutura.pavimento.length;
      semearPavimentos(e);
      await salvar({ texto: `${e.estrutura.pavimento.length - antes} pavimento(s) trazido(s) das pranchas`, tipo: 'estrutura' });
      render(); aviso(`${e.estrutura.pavimento.length - antes} pavimento(s) adicionado(s).`);
    },
  },
};

/* ================= AMBIENTES ================= */
const ambientes = {
  render(e) {
    if (!e) return '';
    if (estado.param) return fichaAmbiente(e, estado.param);
    const f = estado.filtros;
    const lista = locaisVivos(e)
      .filter(a => !f.pav || a.pavimento === f.pav)
      .filter(a => !f.busca || normalizar(a.nome).includes(normalizar(f.busca)));
    const pavs = [...new Set(locaisVivos(e).map(a => a.pavimento).filter(Boolean))];
    const niveis = niveisDe(e).filter(n => n.nivel !== 'pavimento');
    const temPav = temNivel(e, 'pavimento');
    const linhas = lista.map(a => {
      const itens = itensDo(e, a.id);
      return `<tr>
        <td><button class="btn discreto" style="padding:0;font-weight:600" data-acao="abrirAmbiente" data-id="${a.id}">${esc(a.nome)}</button></td>
        ${temPav ? `<td>${celula(a.pavimento)}</td>` : ''}
        ${niveis.map(n => `<td>${celula(nomeNivel(e, n.nivel, a[n.nivel + 'Id']))}</td>`).join('')}
        <td class="num">${celula(a.area)}</td>
        <td class="num">${itens.length}</td>
        <td>${CATEGORIAS.filter(c => itens.some(i => i.categoria === c)).map(c => `<span class="selo neutro">${c}</span>`).join(' ') || '<span class="vazio-celula"></span>'}</td>
        ${temAreasComuns(e) ? `<td>${a.areaComum ? '<span class="selo neutro">MC</span>' : '<span class="selo neutro">MP</span>'}</td>` : ''}
        <td>${seloStatus(a.status)} ${a.confianca === 'baixa' ? '<span class="selo critico">proposto</span>' : ''}</td></tr>`;
    }).join('');
    return `<div class="cabeca"><div><h1>Ambientes</h1><p class="desc">Os nomes são gravados exatamente como aparecem na prancha — maiúsculas, abreviações e numeração inclusive.</p></div>
      <div class="acoes"><button class="btn" data-acao="novoAmbiente">Adicionar ambiente</button></div></div>
      <div class="filtros">
        <input type="search" id="buscaAmb" placeholder="Buscar ambiente" value="${esc(f.busca || '')}">
        ${temNivel(e, 'pavimento') ? `<select id="filtroPav"><option value="">Todos os ${rotuloNivel(e, 'pavimento', true).toLowerCase()}</option>${pavs.map(p => `<option ${f.pav === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
        <span style="color:var(--ink-3);font-size:12.5px">${lista.length} de ${locaisVivos(e).length}</span>
      </div>
      <div class="cartao">${tabela([{ nome: 'Ambiente' },
          ...(temPav ? [{ nome: rotuloNivel(e, 'pavimento') }] : []),
          ...niveis.map(n => ({ nome: n.singular })),
          { nome: 'Área', num: 1 }, { nome: 'Itens', num: 1 }, { nome: 'Categorias' },
          ...(temAreasComuns(e) ? [{ nome: 'Manual' }] : []), { nome: 'Situação' }], linhas ? [linhas] : [],
        { tituloVazio: 'Nenhum local identificado', textoVazio: 'Processe uma prancha de arquitetura para que os locais sejam lidos dos rótulos.', acaoVazio: vazioDocs })}</div>`;
  },
  depois(e, alvo) {
    alvo.querySelector('#buscaAmb')?.addEventListener('input', ev => { estado.filtros.busca = ev.target.value; clearTimeout(estado._t); estado._t = setTimeout(render, 220); });
    alvo.querySelector('#filtroPav')?.addEventListener('change', ev => { estado.filtros.pav = ev.target.value; render(); });
    const cv = alvo.querySelector('[data-mapa-ambiente]');
    if (cv) {
      const d = JSON.parse(cv.dataset.mapaAmbiente);
      recortar(cv, { ...d, larguraAlvo: 760 });
    }
    for (const span of alvo.querySelectorAll('[data-editavel]')) span.addEventListener('click', () => editarCampo(span));
  },
  acoes: {
    abrirAmbiente({ id }) { irPara('locais', id); },
    async novoAmbiente() {
      const nome = prompt('Nome do local, exatamente como está na prancha');
      if (!nome?.trim()) return;
      const e = emp();
      e.locais = e.locais || [];
      e.locais.push(criarLocal({
        nome: nome.trim(), tipologia: (e.estrutura.tipologia[0] || {}).nome || '',
        origem: 'manual', confianca: 'alta', status: 'confirmado',
      }));
      sincronizar(e);
      await salvar({ texto: `Local adicionado manualmente: ${nome.trim()}`, tipo: 'ambiente' });
      render();
    },
    async confirmarAmbiente({ id }) {
      const a = acharAmbiente(id); if (!a) return;
      a.status = 'confirmado'; a.confianca = 'alta';
      await salvar({ texto: `Local confirmado: ${a.nome}`, tipo: 'ambiente' });
      render(); aviso('Local confirmado.');
    },
    async excluirAmbiente({ id }) {
      const a = acharAmbiente(id); if (!a) return;
      if (!confirm(`Excluir o local “${a.nome}”?`)) return;
      a.status = 'excluido';
      await salvar({ texto: `Local excluído: ${a.nome}`, tipo: 'ambiente' });
      irPara('locais');
    },
    async alternarAreaComum({ id }) {
      const a = acharAmbiente(id); if (!a) return;
      a.areaComum = !a.areaComum;
      await salvar({ texto: `${a.nome} passou para ${a.areaComum ? 'áreas comuns (MC)' : 'unidades privativas (MP)'}`, tipo: 'ambiente' });
      render();
    },
    async renomearAmbiente({ id }) {
      const a = acharAmbiente(id); if (!a) return;
      const novo = prompt('Nome do ambiente', a.nome);
      if (novo === null) return;
      const antes = a.nome; a.nome = novo.trim() || antes;
      for (const x of (a.especificacoes || [])) x.localNome = a.nome;
      a.status = 'corrigido';
      await salvar({ texto: `Local renomeado: “${antes}” → “${a.nome}”`, tipo: 'ambiente', antes, depois: a.nome });
      render();
    },
    async mudarNivelAmb({ id, nivel, valor }) {
      const e = emp(); const a = acharAmbiente(id); if (!a) return;
      if (nivel === 'pavimento') {
        const antes = a.pavimento; a.pavimento = valor;
        for (const x of itensDo(e, a.id)) x.pavimento = valor;
        await salvar({ texto: `${rotuloNivel(e, 'pavimento')} de ${a.nome}`, tipo: 'ambiente', antes, depois: valor });
      } else {
        const campo = nivel + 'Id';
        const antes = nomeNivel(e, nivel, a[campo]);
        a[campo] = valor;
        const nome = nomeNivel(e, nivel, valor);
        if (nivel === 'tipologia') {
          a.tipologia = nome;
          for (const x of itensDo(e, a.id)) x.tipologia = nome;
        }
        await salvar({ texto: `${rotuloNivel(e, nivel)} de ${a.nome}`, tipo: 'ambiente', antes, depois: nome });
      }
      render();
    },
  },
};

function fichaAmbiente(e, id) {
  const a = acharAmbiente(id);
  if (!a) return '<div class="vazio"><h3>Local não encontrado</h3></div>';
  const itens = itensDo(e, a.id);
  const itensOrd = ordenarAchados(itens);
  itens.length = 0; itens.push(...itensOrd);
  const ev = (a.evidencias || [])[0];
  const cats = CATEGORIAS.filter(c => itens.some(i => i.categoria === c));
  const esq = itens.filter(i => i.categoria === 'Esquadrias');
  const pend = itens.filter(i => i.status === 'revisar' || i.status === 'conflito' || i.confianca === 'baixa');
  const docs = [...new Set(itens.flatMap(i => (i.evidencias || []).map(nomeDoc)).concat((a.evidencias || []).map(nomeDoc)))].filter(Boolean);
  const doMemorial = itens.filter(i => i.origemLeitura === 'memorial'
    || (i.evidencias || []).some(f => /memorial/i.test(f.tituloLegenda || '') || /memorial/i.test(nomeDoc(f))));
  return `
    <div class="cabeca">
      <div>
        <button class="btn discreto pequeno" data-rota="locais" style="margin-bottom:6px">← Locais</button>
        <h1>${esc(a.nome)}</h1>
        <p class="desc">${[a.pavimento, a.tipologia, a.area].filter(Boolean).map(esc).join(' · ') || 'sem pavimento ou tipologia definidos'}</p>
      </div>
      <div class="acoes">
        ${temAreasComuns(e) ? `<button class="btn" data-acao="alternarAreaComum" data-id="${a.id}">${a.areaComum ? 'É área comum (MC)' : 'É unidade privativa (MP)'}</button>` : ''}
        <button class="btn" data-acao="renomearAmbiente" data-id="${a.id}">Renomear</button>
        <button class="btn" data-acao="confirmarAmbiente" data-id="${a.id}">Confirmar</button>
        <button class="btn discreto" data-acao="excluirAmbiente" data-id="${a.id}">Excluir</button>
      </div>
    </div>
    ${a.confianca === 'baixa' ? '<div class="aviso-faixa"><span>⚠</span><div><b>Local proposto.</b> O rótulo foi lido na prancha sem área cotada ao lado. Confirme antes de exportar.</div></div>' : ''}

    <div class="placar">
      <div><dt>Itens</dt><dd>${itens.length}</dd></div>
      <div><dt>Categorias</dt><dd>${cats.length}</dd></div>
      <div><dt>Esquadrias</dt><dd>${esq.length}</dd></div>
      <div><dt>Pendentes</dt><dd>${pend.length}</dd></div>
      <div><dt>Confirmados</dt><dd>${itens.length ? Math.round(itens.filter(x => x.status === 'confirmado' || x.status === 'corrigido').length / itens.length * 100) : 0}%</dd></div>
    </div>

    <div class="cartao"><header><h2>Categorias de acabamento</h2>
      <div class="acoes"><span class="selo neutro">${cats.length} de ${CATEGORIAS.length}</span></div></header>
      <div class="corpo"><div class="chips-cat">
        ${CATEGORIAS.map(c => { const n = itens.filter(i => i.categoria === c).length;
          return `<span class="chip-cat${n ? '' : ' apagado'}"><i style="background:var(--${corCat(c)})"></i>${esc(c)}<b>${n}</b></span>`; }).join('')}
      </div>
      ${itens.some(i => !i.categoria) ? `<p style="font-size:12.5px;color:var(--atencao);margin-top:10px">${itens.filter(i => !i.categoria).length} item(ns) sem categoria neste local.</p>` : ''}
      </div></div>

    <div class="cartao"><header><h2>Produtos deste local</h2>
      <div class="acoes"><span class="selo neutro">${itens.length} produto(s)</span>
      <button class="btn pequeno primario" data-acao="copiarQuadro" data-amb="${a.id}">Copiar planilha</button></div></header>
      <div class="corpo"><div class="produtos-local">
        ${CATEGORIAS.filter(c => itens.some(i => i.categoria === c)).map(c => `<section>
          <div class="rotulo-cat"><i style="background:var(--${corCat(c)})"></i>${esc(c)}</div>
          ${itens.filter(i => i.categoria === c).map(i => `<div class="produto-linha">
            <div class="produto-nome">
              <b>${esc(i.produto || i.codigoOrigem || i.descricao || 'sem descrição')}</b>
              <div class="produto-desc">${esc(i.produto && i.descricao ? i.descricao : (i.sistema || ''))}</div>
            </div>
            <div class="produto-origem">${origemDoItem(i)}</div>
            <div class="produto-acoes">${seloConfianca(i.confianca)}
              <button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Ver evidência</button></div>
          </div>`).join('')}
        </section>`).join('')}
        ${ESSENCIAIS_LOCAL.filter(c => !itens.some(i => i.categoria === c)).map(c => `<section>
          <div class="rotulo-cat apagado"><i></i>${esc(c)}</div>
          <div class="produto-linha faltando">
            <div class="produto-nome"><b>Nada identificado</b>
              <div class="produto-desc">Nenhuma tag, hachura, linha de legenda ou trecho de memorial deste projeto apontou ${esc(c.toLowerCase())} para este local.</div></div>
            <div class="produto-origem"><span class="selo atencao">a revisar</span></div>
            <div class="produto-acoes"><button class="btn pequeno" data-rota="pendencias">Revisar</button></div>
          </div>
        </section>`).join('')}
      </div></div></div>

    ${niveisDe(e).length ? `<div class="cartao"><header><h2>Onde este local fica</h2></header><div class="corpo">
      <div class="grade2">
        ${niveisDe(e).map(n => n.nivel === 'pavimento'
          ? `<div class="campo"><label>${esc(n.singular)}</label>
             <select data-acao-change="mudarNivelAmb" data-id="${a.id}" data-nivel="pavimento">
               <option value="">—</option>
               ${(e.estrutura.pavimento || []).map(p => `<option ${normalizar(p.nome) === normalizar(a.pavimento) ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
             </select></div>`
          : `<div class="campo"><label>${esc(n.singular)}</label>
             <select data-acao-change="mudarNivelAmb" data-id="${a.id}" data-nivel="${n.nivel}">
               <option value="">—</option>
               ${(e.estrutura[n.nivel] || []).map(x => `<option value="${x.id}" ${a[n.nivel + 'Id'] === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}
             </select></div>`).join('')}
      </div>
      ${niveisDe(e).some(n => !(e.estrutura[n.nivel] || []).length) ? `<p style="font-size:12.5px;color:var(--ink-3);margin-top:10px">Cadastre os níveis no menu lateral para poder vincular.</p>` : ''}
    </div></div>` : ''}

    <div class="cartao"><header><h2>Quadro de acabamentos</h2>
      <div class="acoes">
      <button class="btn pequeno primario" data-acao="copiarQuadro" data-amb="${a.id}">Copiar quadro</button>
      <button class="btn pequeno" data-acao="adicionarItem" data-amb="${a.id}">Adicionar item</button>
      <button class="btn pequeno" data-acao="baixarQuadro" data-amb="${a.id}">Baixar CSV</button></div></header>
      ${tabela([{ nome: 'Categoria' }, { nome: 'Nome do Produto/Serviço' }, { nome: 'Sistema Construtivo' }, { nome: 'Descrição/Modelo/Linha' }, { nome: 'Marca' }, { nome: 'Origem' }, { nome: 'Confiança' }, { nome: '' }],
        itens.length ? [itens.map(i => `<tr>
          <td><span class="cat" style="color:var(--${corCat(i.categoria)})" data-editavel="categoria" data-id="${i.id}">${esc(i.categoria || '—')}</span></td>
          <td><span data-editavel="produto" data-id="${i.id}">${celula(i.produto)}</span></td>
          <td style="max-width:230px"><span data-editavel="sistema" data-id="${i.id}">${celula(i.sistema)}</span></td>
          <td style="max-width:400px">${celula(i.descricao)}</td>
          <td><span data-editavel="marca" data-id="${i.id}">${celula(i.marca)}</span></td>
          <td>${i.forma ? marcaForma(i.forma, i.numero) : `<span class="pilula">${esc((i.evidencias || [])[0]?.tituloLegenda || 'tabela')}</span>`}</td>
          <td>${seloConfianca(i.confianca)}</td>
          <td style="white-space:nowrap"><button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Evidências</button></td>
        </tr>`).join('')] : [],
        { tituloVazio: 'Nenhum acabamento vinculado', textoVazio: 'Nenhuma tag ou linha de tabela deste projeto apontou para este local.' })}
    </div>${listaSistemas()}

    ${esq.length ? `<div class="cartao"><header><h2>Esquadrias deste local</h2>
      <div class="acoes"><span class="selo neutro">${esq.length}</span></div></header>
      ${tabela([{ nome: 'Código', num: 1 }, { nome: 'Dimensão' }, { nome: 'Peitoril' }, { nome: 'Qtd.', num: 1 }, { nome: 'Descrição' }, { nome: 'Situação' }, { nome: '' }],
        [esq.map(i => `<tr>
          <td class="num"><b>${celula(i.codigoOrigem)}</b></td>
          <td>${celula(i.dimensao)}</td><td>${celula(i.peitoril)}</td><td class="num">${celula(i.quantidade)}</td>
          <td style="max-width:420px">${celula(i.descricao.replace(/^[^—]*—\s*[^—]*—\s*/, ''))}</td>
          <td>${seloStatus(i.status)}</td>
          <td style="white-space:nowrap"><button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Evidências</button>
            <button class="btn pequeno discreto" data-acao="verNaPrancha" data-id="${i.id}">Ver na prancha</button></td></tr>`).join('')])}
    </div>` : ''}

    ${pend.length ? `<div class="cartao"><header><h2>Pendências deste local</h2>
      <div class="acoes"><span class="selo atencao">${pend.length}</span>
      <button class="btn pequeno" data-rota="pendencias">Abrir revisão em massa</button></div></header>
      ${tabela([{ nome: 'Categoria' }, { nome: 'Descrição' }, { nome: 'Motivo' }, { nome: 'Confiança' }, { nome: '' }],
        [pend.map(i => `<tr>
          <td>${esc(i.categoria || '—')}</td>
          <td style="max-width:380px">${celula(i.descricao)}</td>
          <td>${(i.motivos || []).map(m => `<span class="selo atencao">${esc(MOTIVOS_PENDENCIA[m] || m)}</span>`).join(' ') || seloStatus(i.status)}</td>
          <td>${seloConfianca(i.confianca)}</td>
          <td style="white-space:nowrap"><button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Evidências</button>
            <button class="btn pequeno" data-acao="confirmarAchado" data-id="${i.id}">Confirmar</button></td></tr>`).join('')])}
    </div>` : ''}

    ${doMemorial.length ? `<div class="cartao"><header><h2>O que o memorial diz sobre este local</h2>
      <div class="acoes"><span class="selo neutro">${doMemorial.length}</span></div></header>
      <div class="corpo"><ul class="lista-limpa">${doMemorial.map(i => {
        const f = (i.evidencias || []).find(x => /memorial/i.test(x.tituloLegenda || '') || /memorial/i.test(nomeDoc(x))) || {};
        return `<li><span class="pilula">p.${esc(paginaDoc(f))}</span><div><b>${esc(i.produto || i.categoria || '')}</b>
          <div style="color:var(--ink-2);font-size:12.5px">${esc((f.texto || i.descricao || '').slice(0, 220))}</div></div></li>`;
      }).join('')}</ul></div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px">
      <div class="cartao"><header><h2>Onde o local foi lido</h2></header>
        <div class="corpo">${ev && ev.coordenadas ? `<div class="recorte">
          <canvas data-mapa-ambiente='${esc(JSON.stringify({ documentoId: idDoc(ev), pagina: paginaDoc(ev), caixa: ev.regiao || janelaCentrada(ev.coordenadas, 400, 250), realces: [{ caixa: ev.coordenadas, cor: "#d13b2a" }] }))}'></canvas>
          <div class="legenda-recorte">${esc(refDoc(ev))}${ev.regiao ? ' · região do local (Nível 2)' : ''}</div></div>
          <button class="btn pequeno" data-acao="verNaPranchaLocal" data-id="${a.id}" style="margin-top:10px">Ver na prancha</button>`
          : '<p style="color:var(--ink-3);font-size:13px">Local criado manualmente.</p>'}
        </div></div>
      <div class="cartao"><header><h2>Fontes documentais</h2></header><div class="corpo">
        <ul class="lista-limpa">${(a.evidencias || []).map(x => `<li><span class="pilula">p.${esc(paginaDoc(x))}</span><div>${esc(nomeDoc(x))}<div style="color:var(--ink-3);font-size:12px">${esc(x.texto || '')}</div></div></li>`).join('') || '<li style="color:var(--ink-3)">Sem evidência documental.</li>'}</ul>
        ${docs.length ? `<p style="font-size:12.5px;color:var(--ink-3);margin-top:10px">Documentos que alimentam este local: ${docs.map(d => esc(d)).join(' · ')}.</p>` : ''}
      </div></div>
    </div>`;
}
function janelaCentrada(c, largura, altura) {
  const cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2;
  return [cx - largura / 2, cy - altura / 2, cx + largura / 2, cy + altura / 2];
}
function nomeNivel(e, nivel, id) {
  if (!id) return '';
  const it = (e.estrutura[nivel] || []).find(x => x.id === id);
  return it ? it.nome : '';
}
const corCat = c => ({ Teto: 'circulo', Paredes: 'triangulo', Piso: 'quadrado', 'Pedras naturais': 'pentagono' }[c] || 'ink-2');

const ESSENCIAIS_LOCAL = ['Piso', 'Paredes', 'Teto'];

/* De onde o produto veio, em uma etiqueta: a tag desenhada, a linha da
   legenda da prancha, a tabela ou o trecho do memorial. */
function origemDoItem(i) {
  if (i.forma) return marcaForma(i.forma, i.numero);
  const f = (i.evidencias || [])[0] || {};
  const o = i.origemLeitura || '';
  if (o === 'memorial' || /memorial/i.test(f.tituloLegenda || '')) return `<span class="pilula">memorial p.${esc(paginaDoc(f) || '—')}</span>`;
  if (o === 'legenda_tabela') return `<span class="pilula">legenda da prancha</span>`;
  if (o === 'tabela') return `<span class="pilula">${esc(f.tituloLegenda || 'tabela da prancha')}</span>`;
  if (o === 'hachura') return `<span class="pilula">hachura da área</span>`;
  if (o === 'manual') return `<span class="pilula">entrada manual</span>`;
  return `<span class="pilula">${esc(nomeDoc(f) || '—')}</span>`;
}

/* ================= ESQUADRIAS ================= */
const esquadrias = {
  render(e) {
    if (!e) return '';
    const lista = itens(e).filter(a => a.categoria === 'Esquadrias');
    const porCod = new Map();
    for (const a of lista) {
      const k = a.codigoOrigem || a.descricao;
      if (!porCod.has(k)) porCod.set(k, { ...a, nosLocais: [] });
      porCod.get(k).nosLocais.push(a.localNome || '—');
    }
    const linhas = [...porCod.values()].map(a => `<tr>
      <td class="num"><b>${celula(a.codigoOrigem)}</b></td>
      <td>${celula(a.dimensao)}</td><td>${celula(a.peitoril)}</td><td class="num">${celula(a.quantidade)}</td>
      <td>${[...new Set(a.nosLocais)].map(x => esc(x)).join(', ')}</td>
      <td style="max-width:430px">${celula(a.descricao.replace(/^[^—]*—\s*[^—]*—\s*/, ''))}</td>
      <td>${seloStatus(a.status)}</td>
      <td style="white-space:nowrap"><button class="btn pequeno" data-acao="verEvidencia" data-id="${a.id}">Evidências</button>
        <button class="btn pequeno discreto" data-acao="verNaPrancha" data-id="${a.id}">Ver na prancha</button></td></tr>`).join('');
    return `<div class="cabeca"><div><h1>Esquadrias</h1><p class="desc">Lidas da tabela desenhada na prancha: código, dimensão de osso, peitoril, quantidade e descrição completa.</p></div></div>
      <div class="cartao">${tabela([{ nome: 'Código', num: 1 }, { nome: 'Dimensão' }, { nome: 'Peitoril' }, { nome: 'Qtd.', num: 1 }, { nome: 'Locais' }, { nome: 'Descrição' }, { nome: 'Status' }, { nome: '' }], linhas ? [linhas] : [],
        { tituloVazio: 'Nenhuma esquadria identificada', textoVazio: 'Processe a prancha que contém a tabela de esquadrias.', acaoVazio: vazioDocs })}</div>`;
  },
};

/* ================= ACABAMENTOS (revisão) ================= */
const acabamentos = {
  render(e) {
    if (!e) return '';
    const f = estado.filtros;
    let lista = itens(e);
    if (f.cat) lista = lista.filter(a => a.categoria === f.cat);
    if (f.conf) lista = lista.filter(a => a.confianca === f.conf);
    if (f.stat) lista = lista.filter(a => a.status === f.stat);
    if (f.amb) lista = lista.filter(a => a.localId === f.amb);
    if (f.doc) lista = lista.filter(a => (a.evidencias || []).some(x => idDoc(x) === f.doc));
    if (f.busca) { const n = normalizar(f.busca); lista = lista.filter(a => normalizar([a.descricao, a.produto, a.localNome, a.marca, a.codigoOrigem].join(' ')).includes(n)); }
    lista = ordenarAchados(lista);
    const linhas = lista.slice(0, 400).map(a => `<tr>
      <td>${a.localId ? `<a href="#" data-acao="abrirAmbiente" data-id="${a.localId}">${esc(a.localNome || '—')}</a>` : '<span class="selo atencao">sem local</span>'}<div style="color:var(--ink-3);font-size:11.5px">${esc(a.pavimento || '')}</div></td>
      <td><span class="cat" style="color:var(--${corCat(a.categoria)})" data-editavel="categoria" data-id="${a.id}">${esc(a.categoria || '—')}</span></td>
      <td><span data-editavel="produto" data-id="${a.id}">${celula(a.produto)}</span></td>
      <td style="max-width:220px"><span data-editavel="sistema" data-id="${a.id}">${celula(a.sistema)}</span></td>
      <td style="max-width:330px"><span data-editavel="descricao" data-id="${a.id}">${celula(a.descricao)}</span></td>
      <td><span data-editavel="marca" data-id="${a.id}">${celula(a.marca)}</span></td>
      <td>${origemDoItem(a)}</td>
      <td>${seloConfianca(a.confianca)}</td>
      <td>${seloStatus(a.status)}</td>
      <td style="white-space:nowrap">
        <button class="btn pequeno" data-acao="verEvidencia" data-id="${a.id}">Evidências</button>
        <button class="btn pequeno discreto" data-acao="confirmarAchado" data-id="${a.id}">✓</button></td></tr>`).join('');
    return `<div class="cabeca"><div><h1>Acabamentos</h1><p class="desc">Tela de revisão. Clique em qualquer descrição, marca ou fornecedor para editar — toda alteração fica registrada no histórico.</p></div>
      <div class="acoes">
        <button class="btn" data-acao="copiarFiltrados">Copiar quadro</button>
        <button class="btn" data-acao="confirmarFiltrados">Confirmar filtrados (${lista.length})</button></div></div>
      <div class="filtros">
        <input type="search" id="buscaAc" placeholder="Buscar descrição, ambiente, marca" value="${esc(f.busca || '')}">
        <select id="fCat"><option value="">Todas as categorias</option>${CATEGORIAS.map(c => `<option ${f.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <select id="fAmb"><option value="">Todos os locais</option>${locaisVivos(e).map(a => `<option value="${a.id}" ${f.amb === a.id ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select>
        <select id="fDoc"><option value="">Todos os documentos</option>${e.documentos.map(d => `<option value="${d.id}" ${f.doc === d.id ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}</select>
        <select id="fConf"><option value="">Qualquer confiança</option>${Object.entries(CONFIANCA).map(([k, v]) => `<option value="${k}" ${f.conf === k ? 'selected' : ''}>${v.rotulo}</option>`).join('')}</select>
        <select id="fStat"><option value="">Qualquer status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.stat === k ? 'selected' : ''}>${v.rotulo}</option>`).join('')}</select>
        <button class="btn pequeno discreto" data-acao="limparFiltros">Limpar</button>
      </div>
      ${listaSistemas()}
      <div class="cartao">${tabela([{ nome: 'Local' }, { nome: 'Categoria' }, { nome: 'Nome do Produto/Serviço' }, { nome: 'Sistema Construtivo' }, { nome: 'Descrição/Modelo/Linha' }, { nome: 'Marca' }, { nome: 'Origem' }, { nome: 'Confiança' }, { nome: 'Status' }, { nome: '' }], linhas ? [linhas] : [],
        { tituloVazio: 'Nenhum item extraído', textoVazio: 'Envie e processe as pranchas para começar.', acaoVazio: vazioDocs })}
        ${lista.length > 400 ? `<div style="padding:10px 14px;color:var(--ink-3);font-size:12.5px">Mostrando 400 de ${lista.length}. Use os filtros para reduzir.</div>` : ''}</div>`;
  },
  depois(e, alvo) {
    alvo.querySelector('#buscaAc')?.addEventListener('input', ev => { estado.filtros.busca = ev.target.value; clearTimeout(estado._t); estado._t = setTimeout(render, 240); });
    const liga = (id, campo) => alvo.querySelector(id)?.addEventListener('change', ev => { estado.filtros[campo] = ev.target.value; render(); });
    liga('#fCat', 'cat'); liga('#fAmb', 'amb'); liga('#fDoc', 'doc'); liga('#fConf', 'conf'); liga('#fStat', 'stat');
    for (const span of alvo.querySelectorAll('[data-editavel]')) span.addEventListener('click', () => editarCampo(span));
  },
  acoes: {
    limparFiltros() { estado.filtros = {}; render(); },
    async confirmarFiltrados() {
      const e = emp(); const f = estado.filtros;
      let n = 0;
      for (const a of itens(e)) {
        if (f.cat && a.categoria !== f.cat) continue;
        if (f.conf && a.confianca !== f.conf) continue;
        if (f.stat && a.status !== f.stat) continue;
        if (f.amb && a.localId !== f.amb) continue;
        if (a.status === 'conflito') continue;
        a.status = 'confirmado'; n++;
      }
      await salvar({ texto: `${n} item(ns) confirmados em lote`, tipo: 'revisao' });
      render(); aviso(`${n} item(ns) confirmados.`);
    },
  },
};

const ROTULO_CAMPO = { categoria: 'Categoria', produto: 'Nome do Produto/Serviço', sistema: 'Sistema Construtivo', descricao: 'Descrição', marca: 'Marca', fornecedor: 'Fornecedor' };

async function editarCampo(span) {
  const { editavel: campo, id } = span.dataset;
  const a = acharAchado(id); if (!a) return;
  const antes = a[campo] || '';
  let inp;
  if (campo === 'categoria') {
    inp = document.createElement('select');
    inp.innerHTML = '<option value=""></option>' + CATEGORIAS.map(c => `<option ${c === antes ? 'selected' : ''}>${esc(c)}</option>`).join('');
  } else {
    inp = document.createElement('input');
    inp.value = antes;
    if (campo === 'sistema') inp.setAttribute('list', 'listaSistemas');
  }
  inp.style.width = '100%'; inp.style.minWidth = '150px'; inp.id = 'edit_' + campo + '_' + id;
  span.replaceWith(inp); inp.focus(); if (inp.select) inp.select();
  const fim = async (gravar) => {
    const novo = (inp.value || '').trim();
    inp.replaceWith(span);
    if (!gravar || novo === antes) { render(); return; }
    a[campo] = novo;
    a.status = 'corrigido';
    if (a.confianca === 'baixa') a.confianca = 'media';
    if (campo === 'sistema') a.motivos = (a.motivos || []).filter(m => m !== 'sem_sistema');
    let extra = '';
    if (['categoria', 'produto', 'sistema'].includes(campo) && a.descricao) {
      aprenderRegra(a.descricao, { categoria: a.categoria, produto: a.produto, sistema: a.sistema });
      await gravarGlossario();
      extra = ' · regra gravada no glossário';
    }
    await salvar({ texto: `${ROTULO_CAMPO[campo] || campo} de “${a.localNome || 'item'}” alterado${extra}`, tipo: 'edicao', antes, depois: novo, alvo: a.id });
    render(); aviso('Alteração registrada' + (extra ? ' e aprendida para os próximos empreendimentos.' : ' no histórico.'));
  };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') fim(true); if (ev.key === 'Escape') fim(false); });
  inp.addEventListener('blur', () => fim(true));
  if (campo === 'categoria') inp.addEventListener('change', () => fim(true));
}

/* ================= PRODUTOS ================= */
const produtos = {
  render(e) {
    if (!e) return '';
    const mapa = new Map();
    for (const a of itens(e)) {
      if (!a.descricao) continue;
      const k = normalizar(a.descricao);
      if (!mapa.has(k)) mapa.set(k, { descricao: a.descricao, categoria: a.categoria, marca: a.marca, fornecedor: a.fornecedor, nosLocais: new Set(), itens: [] });
      const m = mapa.get(k);
      m.nosLocais.add(a.localNome || '—'); m.itens.push(a);
      if (!m.marca && a.marca) m.marca = a.marca;
      if (!m.fornecedor && a.fornecedor) m.fornecedor = a.fornecedor;
    }
    const linhas = [...mapa.values()].sort((a, b) => b.nosLocais.size - a.nosLocais.size).map(p => `<tr>
      <td><span class="cat" style="color:var(--${corCat(p.categoria)})">${esc(p.categoria || '—')}</span></td>
      <td style="max-width:480px"><b>${esc(p.descricao)}</b></td>
      <td>${celula(p.marca)}</td><td>${celula(p.fornecedor)}</td>
      <td class="num">${p.nosLocais.size}</td>
      <td style="max-width:300px;color:var(--ink-2);font-size:12.5px">${esc([...p.nosLocais].slice(0, 6).join(', '))}${p.nosLocais.size > 6 ? '…' : ''}</td></tr>`).join('');
    return `<div class="cabeca"><div><h1>Produtos</h1><p class="desc">Cada material distinto encontrado, com os locais em que aparece. Marca e fornecedor são campos independentes — um não preenche o outro.</p></div></div>
      <div class="cartao">${tabela([{ nome: 'Categoria' }, { nome: 'Produto' }, { nome: 'Marca' }, { nome: 'Fornecedor' }, { nome: 'Locais', num: 1 }, { nome: 'Onde' }], linhas ? [linhas] : [],
        { tituloVazio: 'Nenhum produto identificado', textoVazio: 'Processe as pranchas para extrair os materiais.', acaoVazio: vazioDocs })}</div>`;
  },
};

/* ================= MARCAS E FORNECEDORES ================= */
const PARADAS = new Set(['porcelanato', 'ceramica', 'cerâmica', 'marmore', 'mármore', 'granito', 'pintura', 'tinta', 'forro',
  'gesso', 'acartonado', 'rodape', 'rodapé', 'soleira', 'piso', 'parede', 'teto', 'madeira', 'aluminio', 'alumínio',
  'vidro', 'branca', 'branco', 'definir', 'similar', 'padrao', 'padrão', 'metalica', 'metálica', 'acrilica', 'acrílica',
  'textura', 'revestimento', 'novo', 'nova', 'escopo', 'prever', 'amostra', 'local', 'altura', 'perfil', 'embutido',
  'alvenaria', 'travertino', 'romano', 'quartzo', 'quartzito', 'epoxi', 'epóxi', 'deck', 'pastilha', 'papel', 'modular',
  'hidraulico', 'hidráulico', 'ladrilho', 'cor', 'com', 'para', 'sem', 'nat', 'sbe', 'ou', 'de', 'da', 'do', 'em', 'na', 'no', 'a', 'e']);

const fornecedores = {
  render(e) {
    if (!e) return '';
    const propostas = proporMarcas(e);
    const linhasMarcas = e.marcas.map(m => `<tr>
      <td><b>${esc(m.nome)}</b></td>
      <td class="num">${itens(e).filter(a => a.marca === m.nome).length}</td>
      <td>${celula(m.fornecedor)}</td>
      <td><button class="btn pequeno" data-acao="editarFornecedorMarca" data-id="${m.id}">Definir fornecedor</button>
        <button class="btn pequeno discreto" data-acao="removerMarca" data-id="${m.id}">Remover</button></td></tr>`).join('');
    return `<div class="cabeca"><div><h1>Marcas e fornecedores</h1>
      <p class="desc">Marca é quem fabrica; fornecedor é quem entrega. O sistema nunca deduz um a partir do outro — os dois só são preenchidos com evidência ou por você.</p></div>
      <div class="acoes"><button class="btn" data-acao="novaMarca">Adicionar marca</button></div></div>

      ${propostas.length ? `<div class="cartao"><header><h2>Marcas encontradas nas descrições</h2>
        <div class="acoes"><span class="selo atencao">${propostas.length} propostas</span></div></header>
        <div class="corpo">
          <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Termos que aparecem nas descrições e não pertencem ao vocabulário técnico. Confirme os que forem marca — só então eles entram nas planilhas.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${propostas.map(p => `<button class="btn pequeno" data-acao="confirmarMarca" data-nome="${esc(p.nome)}">${esc(p.nome)} <span class="pilula">${p.n}</span></button>`).join('')}
          </div></div></div>` : ''}

      <div class="cartao"><header><h2>Marcas confirmadas</h2></header>
        ${tabela([{ nome: 'Marca' }, { nome: 'Itens', num: 1 }, { nome: 'Fornecedor' }, { nome: '' }], linhasMarcas ? [linhasMarcas] : [],
          { tituloVazio: 'Nenhuma marca confirmada', textoVazio: 'Confirme acima os termos que forem marca, ou adicione manualmente.' })}</div>`;
  },
  acoes: {
    async confirmarMarca({ nome }) {
      const e = emp();
      if (!e.marcas.some(m => m.nome === nome)) e.marcas.push({ id: novoId('mar'), nome, fornecedor: '' });
      let n = 0;
      for (const a of itens(e)) {
        if (a.marca) continue;
        if (normalizar(a.descricao).includes(normalizar(nome))) { a.marca = nome; n++; }
      }
      await salvar({ texto: `Marca confirmada: ${nome} (aplicada a ${n} item/itens)`, tipo: 'marca' });
      render(); aviso(`${nome} aplicada a ${n} item(ns).`);
    },
    async novaMarca() {
      const nome = prompt('Nome da marca');
      if (!nome?.trim()) return;
      emp().marcas.push({ id: novoId('mar'), nome: nome.trim(), fornecedor: '' });
      await salvar({ texto: `Marca cadastrada: ${nome.trim()}`, tipo: 'marca' });
      render();
    },
    async removerMarca({ id }) {
      const e = emp(); e.marcas = e.marcas.filter(m => m.id !== id);
      await salvar({ texto: 'Marca removida', tipo: 'marca' }); render();
    },
    async editarFornecedorMarca({ id }) {
      const e = emp(); const m = e.marcas.find(x => x.id === id); if (!m) return;
      const v = prompt(`Fornecedor de ${m.nome}`, m.fornecedor || '');
      if (v === null) return;
      m.fornecedor = v.trim();
      let n = 0;
      for (const a of itens(e)) if (a.marca === m.nome) { a.fornecedor = m.fornecedor; n++; }
      await salvar({ texto: `Fornecedor de ${m.nome}: ${m.fornecedor || '—'} (${n} itens)`, tipo: 'fornecedor' });
      render();
    },
  },
};

function proporMarcas(e) {
  const cont = new Map();
  const confirmadas = new Set(e.marcas.map(m => normalizar(m.nome)));
  for (const a of itens(e)) {
    if (!a.descricao || a.categoria === 'Esquadrias') continue;
    for (const bruto of a.descricao.split(/[\s(),.\/]+/)) {
      const t = bruto.trim();
      if (t.length < 3 || t.length > 18) continue;
      if (/\d/.test(t)) continue;
      const n = normalizar(t);
      if (!n || PARADAS.has(n) || confirmadas.has(n)) continue;
      const ehMarca = /^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(t) || /^[A-ZÀ-Ý]{3,}$/.test(t);
      if (!ehMarca) continue;
      cont.set(t, (cont.get(t) || 0) + 1);
    }
  }
  return [...cont].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n).slice(0, 14);
}



/* ================= LOCAIS (busca por ambiente) ================= */

function acharLocais(e, termo) {
  const n = normalizar(termo);
  if (!n) return [];
  const vivos = locaisVivos(e);
  const exatos = vivos.filter(a => mesmoAmbiente(a.nome, termo));
  if (exatos.length) return exatos;
  return vivos.filter(a => normalizar(a.nome).includes(n));
}

/* ================= FILA DE TRIAGEM: ITENS SEM LOCAL =================
   Toda especificação que o motor leu mas não conseguiu amarrar a um Local vive
   em `emp.especificacoesSemLocal[]`. Não é lixo nem erro: é o ponto em que a
   leitura automática para e a pessoa decide — “essa porta pertence ao
   B. SERVIÇO”. Por isso a fila aparece inteira, com a evidência ao lado e um
   seletor de Local em cada linha. */
const orfaosSel = new Set();

function seletorDeLocal(e, id, valor = '') {
  const porPav = new Map();
  for (const l of locaisVivos(e)) {
    const k = l.pavimento || 'sem pavimento';
    if (!porPav.has(k)) porPav.set(k, []);
    porPav.get(k).push(l);
  }
  const grupos = [...porPav.entries()].map(([pav, ls]) => `<optgroup label="${esc(pav)}">${
    ls.map(l => `<option value="${l.id}" ${valor === l.id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</optgroup>`).join('');
  return `<select ${id ? `data-alvo-local="${esc(id)}"` : 'id="alvoLocalLote"'}>
    <option value="">escolher o local…</option>${grupos}</select>`;
}

function cartaoOrfaos(e, opcoes = {}) {
  const fila = semLocal(e);
  if (!fila.length) {
    return opcoes.sempre ? `<div class="cartao"><div class="vazio"><h3>Nada na fila de triagem</h3>
      <p>Todas as especificações lidas estão amarradas a um local.</p></div></div>` : '';
  }
  const porMotivo = new Map();
  for (const a of fila) {
    const k = (a.motivos || [])[0] || 'sem_local';
    if (!porMotivo.has(k)) porMotivo.set(k, 0);
    porMotivo.set(k, porMotivo.get(k) + 1);
  }
  const lista = ordenarAchados(fila);
  const linhas = lista.slice(0, 400).map(a => `<tr>
    <td><input type="checkbox" data-sel-orfao="${esc(a.id)}" ${orfaosSel.has(a.id) ? 'checked' : ''}></td>
    <td>${a.categoria ? `<span class="cat" style="color:var(--${corCat(a.categoria)})" data-editavel="categoria" data-id="${a.id}">${esc(a.categoria)}</span>`
      : '<span class="selo atencao">sem categoria</span>'}</td>
    <td><b>${esc(a.produto || a.descricao || a.codigoOrigem || 'sem descrição')}</b>
      ${a.produto && a.descricao ? `<div style="color:var(--ink-3);font-size:11.5px">${esc(a.descricao.slice(0, 110))}</div>` : ''}</td>
    <td>${a.localNome ? `<span class="pilula" title="texto que a prancha deu, sem local casado">${esc(a.localNome)}</span>` : '<span class="vazio-celula"></span>'}</td>
    <td>${origemDoItem(a)}</td>
    <td>${(a.motivos || []).map(m => `<span class="selo atencao">${esc(MOTIVOS_PENDENCIA[m] || m)}</span>`).join(' ') || seloStatus(a.status)}</td>
    <td>${seletorDeLocal(e, a.id, '')}</td>
    <td style="white-space:nowrap">
      <button class="btn pequeno primario" data-acao="atribuirLocal" data-id="${a.id}">Atribuir</button>
      <button class="btn pequeno" data-acao="verEvidencia" data-id="${a.id}">Evidências</button>
      <button class="btn pequeno discreto" data-acao="excluirAchado" data-id="${a.id}">Excluir</button></td></tr>`).join('');

  return `<div class="cartao destaque-triagem">
    <header>
      <span class="selo atencao">triagem humana</span>
      <h2>${fila.length} especificação(ões) sem local</h2>
      <div class="acoes">
        ${[...porMotivo.entries()].map(([m, n]) => `<span class="selo neutro">${esc(MOTIVOS_PENDENCIA[m] || m)}: ${n}</span>`).join(' ')}
      </div>
    </header>
    <div class="corpo" style="padding-bottom:0">
      <p style="margin:0;color:var(--ink-2);font-size:13px">O motor leu estes itens, mas nenhuma geometria, rótulo ou termo de legenda os amarrou a um local. A leitura automática para aqui: escolha o local de cada um — ou selecione vários e aplique o mesmo local de uma vez. Nada é adivinhado, e nada é descartado: eles continuam saindo na planilha com o que o documento disse.</p>
    </div>
    <div class="barra-lote">
      <label class="marca-tudo"><input type="checkbox" data-sel-orfao-todos> Selecionar todos</label>
      <span class="pilula" data-contador-orfaos>${orfaosSel.size} selecionado(s)</span>
      <span class="sep"></span>
      <label style="font-size:12px;color:var(--ink-3)">Local</label>
      ${seletorDeLocal(e, null)}
      <button class="btn pequeno primario" data-acao="loteAtribuirLocal">Atribuir aos selecionados</button>
      <button class="btn pequeno discreto" data-acao="loteExcluirOrfaos">Excluir selecionados</button>
    </div>
    ${tabela([{ nome: '' }, { nome: 'Categoria' }, { nome: 'Nome do Produto/Serviço' }, { nome: 'Texto da prancha' },
      { nome: 'Origem' }, { nome: 'Por que não casou' }, { nome: 'Atribuir ao local' }, { nome: '' }], linhas ? [linhas] : [])}
    ${lista.length > 400 ? `<div style="padding:10px 14px;color:var(--ink-3);font-size:12.5px">Mostrando 400 de ${lista.length}.</div>` : ''}
  </div>`;
}

/* liga os checkboxes e o seletor da fila — usado pelas duas telas que a mostram */
function ligarOrfaos(alvo) {
  const cont = alvo.querySelector('[data-contador-orfaos]');
  const atualizar = () => { if (cont) cont.textContent = `${orfaosSel.size} selecionado(s)`; };
  for (const cb of alvo.querySelectorAll('[data-sel-orfao]')) {
    cb.addEventListener('change', () => {
      if (cb.checked) orfaosSel.add(cb.dataset.selOrfao); else orfaosSel.delete(cb.dataset.selOrfao);
      atualizar();
    });
  }
  const todos = alvo.querySelector('[data-sel-orfao-todos]');
  if (todos) todos.addEventListener('change', () => {
    for (const cb of alvo.querySelectorAll('[data-sel-orfao]')) {
      cb.checked = todos.checked;
      if (todos.checked) orfaosSel.add(cb.dataset.selOrfao); else orfaosSel.delete(cb.dataset.selOrfao);
    }
    atualizar();
  });
}

const ACOES_ORFAOS = {
  async atribuirLocal({ id }) {
    const e = emp(); const a = acharAchado(id); if (!a) return;
    const sel = document.querySelector(`[data-alvo-local="${id}"]`);
    const alvo = acharAmbiente(sel ? sel.value : '');
    if (!alvo) { aviso('Escolha o local na lista da linha.'); return; }
    moverParaLocal(e, a, alvo);
    a.status = 'corrigido';
    a.motivos = (a.motivos || []).filter(m => !['tag_sem_ambiente', 'termo_sem_ambiente', 'sem_local', 'lista_aberta'].includes(m));
    if (a.confianca === 'baixa') a.confianca = 'media';
    orfaosSel.delete(id);
    await salvar({ texto: `Item atribuído ao local “${alvo.nome}” na triagem`, tipo: 'revisao', alvo: a.id, depois: alvo.nome });
    render(); aviso(`Atribuído a ${alvo.nome}.`);
  },
  async loteAtribuirLocal() {
    const e = emp();
    const sel = document.getElementById('alvoLocalLote');
    const alvo = acharAmbiente(sel ? sel.value : '');
    if (!alvo) { aviso('Escolha o local na barra acima.'); return; }
    if (!orfaosSel.size) { aviso('Selecione ao menos um item.'); return; }
    let n = 0;
    for (const id of [...orfaosSel]) {
      const a = acharAchado(id); if (!a) continue;
      moverParaLocal(e, a, alvo);
      a.status = 'corrigido';
      a.motivos = (a.motivos || []).filter(m => !['tag_sem_ambiente', 'termo_sem_ambiente', 'sem_local', 'lista_aberta'].includes(m));
      if (a.confianca === 'baixa') a.confianca = 'media';
      n++;
    }
    orfaosSel.clear();
    await salvar({ texto: `${n} item(ns) atribuídos ao local “${alvo.nome}” na triagem em massa`, tipo: 'revisao' });
    render(); aviso(`${n} item(ns) em ${alvo.nome}.`);
  },
  async loteExcluirOrfaos() {
    if (!orfaosSel.size) { aviso('Selecione ao menos um item.'); return; }
    const n = orfaosSel.size;
    if (!confirm(`Excluir ${n} item(ns) da fila de triagem?`)) return;
    for (const id of [...orfaosSel]) { const a = acharAchado(id); if (a) a.status = 'excluido'; }
    orfaosSel.clear();
    await salvar({ texto: `${n} item(ns) excluídos na triagem`, tipo: 'revisao' });
    render(); aviso(`${n} item(ns) excluídos.`);
  },
};

const ABAS_LOCAIS = [
  { id: 'locais', rotulo: 'Por local' },
  { id: 'itens', rotulo: 'Todos os acabamentos' },
  { id: 'esquadrias', rotulo: 'Esquadrias' },
  { id: 'semLocal', rotulo: 'Sem local' },
];

/* Locais é o módulo central do levantamento: tudo o que pertence a um local
   — categorias, acabamentos, esquadrias, evidências e pendências — fica
   dentro dele, sem precisar navegar entre telas separadas. */
const locais = {
  render(e) {
    if (!e) return '';
    if (estado.param) return fichaAmbiente(e, estado.param);
    const aba = estado.filtros.abaLocais || 'locais';
    const vivos = locaisVivos(e);
    const conta = { locais: vivos.length, itens: itens(e).length, esquadrias: itens(e).filter(x => x.categoria === 'Esquadrias').length, semLocal: semLocal(e).length };
    const barra = `<div class="abas-modulo">${ABAS_LOCAIS.map(x =>
      `<button class="aba-modulo${x.id === aba ? ' ativa' : ''}" data-acao="trocarAbaLocal" data-id="${x.id}">${x.rotulo}<span class="pilula">${conta[x.id]}</span></button>`).join('')}</div>`;
    if (aba === 'itens') return barra + acabamentos.render(e);
    if (aba === 'esquadrias') return barra + esquadrias.render(e);
    if (aba === 'semLocal') return barra + `<div class="cabeca"><div><h1>Fila de triagem</h1>
      <p class="desc">Especificações lidas dos documentos que nenhuma geometria, rótulo ou termo de legenda amarrou a um local. É aqui que você diz à análise onde cada uma mora.</p></div></div>`
      + cartaoOrfaos(e, { sempre: true });
    return barra + porLocal(e);
  },
  depois(e, alvo) {
    const aba = estado.filtros.abaLocais || 'locais';
    if (estado.param) { ambientes.depois?.(e, alvo); return; }
    if (aba === 'itens') { acabamentos.depois?.(e, alvo); return; }
    if (aba === 'esquadrias') { esquadrias.depois?.(e, alvo); return; }
    if (aba === 'semLocal') {
      ligarOrfaos(alvo);
      for (const span of alvo.querySelectorAll('[data-editavel]')) span.addEventListener('click', () => editarCampo(span));
      return;
    }
    const ta = alvo.querySelector('#buscaLocal');
    if (ta) {
      ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); estado.filtros.local = ta.value; render(); }
      });
      ta.addEventListener('change', () => { estado.filtros.local = ta.value; });
    }
    for (const span of alvo.querySelectorAll('[data-editavel]')) span.addEventListener('click', () => editarCampo(span));
  },
  acoes: {
    ...ACOES_ORFAOS,
    trocarAbaLocal({ id }) { estado.filtros.abaLocais = id; render(); },
    buscarLocal() {
      const ta = document.getElementById('buscaLocal');
      estado.filtros.local = ta ? ta.value : '';
      render();
    },
    limparLocal() { estado.filtros.local = ''; render(); },
    escolherLocal({ nome }) {
      const atual = (estado.filtros.local || '').split(/[\n;,]+/).map(t => t.trim()).filter(Boolean);
      const i = atual.findIndex(t => normalizar(t) === normalizar(nome));
      if (i >= 0) atual.splice(i, 1); else atual.push(nome);
      estado.filtros.local = atual.join('\n');
      render();
    },
    copiarLocais() {
      const { linhas } = linhasDoLocal(emp());
      copiarTsv(linhas, 'Planilha do local');
    },
    async baixarLocais() {
      const e = emp();
      const { linhas, nome } = linhasDoLocal(e);
      await store.baixar(arquivoSeguro(nome) + '-produtos.csv', exportarCsv(linhas), 'text/csv');
    },
  },
};

function porLocal(e) {
  const busca = estado.filtros.local || '';
  const termos = busca.split(/[\n;,]+/).map(t => t.trim()).filter(Boolean);
  const encontrados = [];
  const semResultado = [];
  for (const t of termos) {
    const achados = acharLocais(e, t);
    if (!achados.length) semResultado.push(t);
    for (const a of achados) if (!encontrados.includes(a)) encontrados.push(a);
  }
  const achadosDosLocais = ordenarAchados(itens(e).filter(a => encontrados.some(x => x.id === a.localId)));
  const vivos = locaisVivos(e);
  const pavs = [...new Set(vivos.map(a => a.pavimento || 'sem pavimento'))];
  const ficha = encontrados.length === 1 ? encontrados[0] : null;

  // Categoria e Local lado a lado, nessa ordem: é assim que a planilha recebe.
  const linhas = achadosDosLocais.map(i => `<tr>
    <td><span class="cat" style="color:var(--${corCat(i.categoria)})" data-editavel="categoria" data-id="${i.id}">${esc(i.categoria || '—')}</span></td>
    <td><b>${esc(i.localNome)}</b><div style="color:var(--ink-3);font-size:11.5px">${esc(i.pavimento || '')}</div></td>
    <td><span data-editavel="produto" data-id="${i.id}">${celula(i.produto)}</span></td>
    <td style="max-width:230px"><span data-editavel="sistema" data-id="${i.id}">${celula(i.sistema)}</span></td>
    <td style="max-width:360px"><span data-editavel="descricao" data-id="${i.id}">${celula(i.descricao)}</span></td>
    <td><span data-editavel="marca" data-id="${i.id}">${celula(i.marca)}</span></td>
    <td style="white-space:nowrap">${seloConfianca(i.confianca)}
      <button class="btn pequeno discreto" data-acao="verEvidencia" data-id="${i.id}">Evidências</button></td></tr>`).join('');

  const niveis = niveisDe(e).filter(n => n.nivel !== 'pavimento');
  const temPav = temNivel(e, 'pavimento');
  // com filtro ativo, a lista de baixo mostra só os locais filtrados
  const listados = encontrados.length ? encontrados : vivos;
  const listaGeral = listados.map(a => {
    const its = itensDo(e, a.id);
    return `<tr>
      <td><button class="btn discreto" style="padding:0;font-weight:600" data-acao="abrirAmbiente" data-id="${a.id}">${esc(a.nome)}</button></td>
      ${temPav ? `<td>${celula(a.pavimento)}</td>` : ''}
      ${niveis.map(n => `<td>${celula(nomeNivel(e, n.nivel, a[n.nivel + 'Id']))}</td>`).join('')}
      <td class="num">${celula(a.area)}</td>
      <td class="num">${its.length}</td>
      <td class="num">${its.filter(x => x.categoria === 'Esquadrias').length}</td>
      <td>${CATEGORIAS.filter(c => its.some(i => i.categoria === c)).map(c => `<span class="selo neutro">${c}</span>`).join(' ') || '<span class="vazio-celula"></span>'}</td>
      ${temAreasComuns(e) ? `<td>${a.areaComum ? '<span class="selo neutro">MC</span>' : '<span class="selo neutro">MP</span>'}</td>` : ''}
      <td>${seloStatus(a.status)}</td>
      <td style="white-space:nowrap"><button class="btn pequeno" data-acao="abrirAmbiente" data-id="${a.id}">Abrir</button></td></tr>`;
  }).join('');

  return `<div class="cabeca"><div><h1>Locais</h1>
    <p class="desc">Tudo o que pertence a um local fica dentro dele: categorias, acabamentos, esquadrias, evidências e pendências. Digite ou cole uma lista de locais para receber a planilha pronta, com Categoria e Local lado a lado.</p></div>
    <div class="acoes">
      <button class="btn" data-acao="novoAmbiente">Adicionar local</button>
      ${encontrados.length ? `<button class="btn primario" data-acao="copiarLocais">Copiar planilha</button>
      <button class="btn" data-acao="baixarLocais">Baixar CSV</button>
      ${ficha ? `<button class="btn" data-acao="abrirAmbiente" data-id="${ficha.id}">Abrir local</button>` : ''}` : ''}
    </div></div>

    <div class="cartao"><div class="corpo" style="display:flex;flex-direction:column;gap:12px">
      <div class="campo">
        <label for="buscaLocal">Local</label>
        <textarea id="buscaLocal" rows="2" placeholder="Ex.: ÁREA PETS&#10;COZINHA, BANHO 01" style="resize:vertical;font-family:var(--mono);font-size:13px">${esc(busca)}</textarea>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn pequeno primario" data-acao="buscarLocal">Listar produtos</button>
        ${busca ? '<button class="btn pequeno discreto" data-acao="limparLocal">Limpar</button>' : ''}
        <span style="color:var(--ink-3);font-size:12.5px;margin-left:auto">${vivos.length} locais no empreendimento</span>
      </div>
      <details open>
        <summary style="cursor:pointer;font-family:var(--cond);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)">Escolher da lista</summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          ${pavs.map(p => `<div>
            <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:5px">${esc(p)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${vivos.filter(a => (a.pavimento || 'sem pavimento') === p)
                .map(a => `<button class="btn pequeno ${encontrados.includes(a) ? 'primario' : ''}" data-acao="escolherLocal" data-nome="${esc(a.nome)}">${esc(a.nome)}
                  <span class="pilula" style="background:transparent">${itensDo(e, a.id).length}</span></button>`).join('')}
            </div></div>`).join('')}
        </div>
      </details>
    </div></div>

    ${semLocal(e).length ? `<div class="aviso-faixa"><span>⚠</span><div><b>${semLocal(e).length} especificação(ões) sem local.</b> Elas foram lidas dos documentos mas nenhuma amarração as ligou a um local — a fila de triagem espera a sua decisão.
      <button class="btn pequeno" data-acao="trocarAbaLocal" data-id="semLocal" style="margin-left:6px">Abrir fila de triagem</button></div></div>` : ''}

    ${semResultado.length ? `<div class="aviso-faixa"><span>⚠</span><div>Sem correspondência para ${semResultado.map(t => `<b>${esc(t)}</b>`).join(', ')}. O nome precisa ser o que está na prancha — confira a lista acima.</div></div>` : ''}

    ${ficha ? `<div class="placar">
      <div><dt>Local</dt><dd style="font-size:17px">${esc(ficha.nome)}</dd></div>
      <div><dt>Pavimento</dt><dd style="font-size:17px">${esc(ficha.pavimento || '—')}</dd></div>
      <div><dt>Área</dt><dd style="font-size:17px">${esc(ficha.area || '—')}</dd></div>
      <div><dt>Manual</dt><dd style="font-size:17px">${ficha.areaComum ? 'MC' : 'MP'}</dd></div>
      <div><dt>Produtos</dt><dd>${achadosDosLocais.length}</dd></div>
    </div>` : ''}

    ${encontrados.length ? `${listaSistemas()}<div class="cartao">
      <header><h2>${encontrados.length > 1 ? `${encontrados.length} locais · ${achadosDosLocais.length} produtos` : 'Produtos do local'}</h2>
      <div class="acoes"><span class="selo neutro">${achadosDosLocais.length} linha(s)</span></div></header>
      ${tabela(COLUNAS_COPIA.map(c => ({ nome: c })).concat([{ nome: '' }]), linhas ? [linhas] : [],
        { tituloVazio: 'Nenhum produto neste local', textoVazio: 'Nenhuma tag, tabela ou trecho de memorial apontou para este local.' })}
    </div>` : ''}

    <div class="cartao"><header><h2>${encontrados.length ? (encontrados.length > 1 ? 'Locais filtrados' : 'Local filtrado') : 'Todos os locais'}</h2>
      <div class="acoes">
        <span class="selo neutro">${encontrados.length ? `${listados.length} de ${vivos.length}` : vivos.length}</span>
        ${encontrados.length ? '<button class="btn pequeno" data-acao="limparLocal">Ver todos os locais</button>' : ''}
      </div></header>
      ${tabela([{ nome: 'Local' },
        ...(temPav ? [{ nome: rotuloNivel(e, 'pavimento') }] : []),
        ...niveis.map(n => ({ nome: n.singular })),
        { nome: 'Área', num: 1 }, { nome: 'Itens', num: 1 }, { nome: 'Esquadrias', num: 1 }, { nome: 'Categorias' },
        ...(temAreasComuns(e) ? [{ nome: 'Manual' }] : []), { nome: 'Situação' }, { nome: '' }], listaGeral ? [listaGeral] : [],
        { tituloVazio: 'Nenhum local identificado', textoVazio: 'Processe uma prancha de arquitetura para que os locais sejam lidos dos rótulos.', acaoVazio: vazioDocs })}
    </div>`;
}

function linhasDoLocal(e) {
  const termos = (estado.filtros.local || '').split(/[\n;,]+/).map(t => t.trim()).filter(Boolean);
  const encontrados = [];
  for (const t of termos) for (const a of acharLocais(e, t)) if (!encontrados.includes(a)) encontrados.push(a);
  const achadosDosLocais = ordenarAchados(itens(e).filter(a => encontrados.some(x => x.id === a.localId)));
  const varios = encontrados.length > 1;
  const base = tabelaCopia(e, achadosDosLocais);
  if (!varios) return { linhas: base, nome: encontrados[0]?.nome || 'local' };
  const linhas = [['Local'].concat(base[0])];
  achadosDosLocais.forEach((i, k) => linhas.push([i.localNome || ''].concat(base[k + 1])));
  return { linhas, nome: 'locais' };
}

/* ================= GLOSSÁRIO ================= */
const glossario = {
  render(e) {
    const f = estado.filtros;
    const busca = normalizar(f.glos || '');
    const sis = SISTEMAS.filter(x => !busca || normalizar(x.n + ' ' + (x.d || '')).includes(busca))
      .filter(x => f.glosEscopo === 'p' ? x.p : f.glosEscopo === 'c' ? x.c : true);
    const aprendidas = regrasAprendidas();
    const usados = e ? new Set(itens(e).filter(a => a.sistema).map(a => a.sistema)) : new Set();
    return `<div class="cabeca"><div><h1>Glossário</h1>
      <p class="desc">A memória do processo. Os sistemas construtivos são a lista oficial da Predialize; as regras traduzem o que está escrito no projeto para Categoria, Nome do Produto e Sistema. Cada correção sua vira regra e vale para o próximo empreendimento.</p></div>
      <div class="acoes"><span class="selo neutro">${SISTEMAS.length} sistemas</span>
      <span class="selo ${aprendidas.length ? 'bom' : 'neutro'}">${aprendidas.length} regra(s) aprendida(s)</span></div></div>

    <div class="cartao"><header><h2>Regras aprendidas com você</h2>
      <div class="acoes"><button class="btn pequeno" data-acao="exportarGlossario">Exportar</button>
      <label class="btn pequeno" for="importGlos">Importar</label><input type="file" id="importGlos" accept=".json" hidden></div></header>
      ${tabela([{ nome: 'Quando o texto for' }, { nome: 'Categoria' }, { nome: 'Nome do Produto/Serviço' }, { nome: 'Sistema Construtivo' }, { nome: '' }],
        aprendidas.length ? [aprendidas.map(r => `<tr>
          <td style="max-width:360px">${esc(r.exato)}</td>
          <td>${celula(r.cat)}</td><td>${celula(r.prod)}</td><td>${celula(r.sis)}</td>
          <td><button class="btn pequeno discreto" data-acao="removerRegra" data-exato="${esc(r.exato)}">Remover</button></td></tr>`).join('')] : [],
        { tituloVazio: 'Nenhuma regra aprendida ainda', textoVazio: 'Corrija a categoria, o nome do produto ou o sistema de qualquer item em Acabamentos: a correção é gravada aqui e aplicada nos próximos empreendimentos.' })}
    </div>

    <div class="cartao"><header><h2>Regras do processo</h2><div class="acoes"><span class="selo neutro">${REGRAS_BASE.length}</span></div></header>
      <div class="rolagem" style="max-height:340px;overflow-y:auto"><table>
        <thead><tr><th>Termo reconhecido</th><th>Nome do Produto/Serviço</th><th>Sistema Construtivo</th><th>Categoria</th></tr></thead>
        <tbody>${REGRAS_BASE.map(r => `<tr><td class="num" style="font-size:12px;max-width:300px">${esc(r.p.replace(/\\b/g, ''))}</td>
          <td>${celula(r.prod)}</td><td style="max-width:250px">${celula(r.sis)}</td><td>${celula(r.cat)}</td></tr>`).join('')}</tbody>
      </table></div></div>

    <div class="cartao"><header><h2>Sistemas construtivos</h2></header>
      <div class="corpo" style="padding-bottom:0">
        <div class="filtros">
          <input type="search" id="buscaGlos" placeholder="Buscar sistema ou definição" value="${esc(f.glos || '')}">
          <select id="escopoGlos">
            <option value="">Todos os escopos</option>
            <option value="p" ${f.glosEscopo === 'p' ? 'selected' : ''}>Unidades privativas</option>
            <option value="c" ${f.glosEscopo === 'c' ? 'selected' : ''}>Áreas comuns</option>
          </select>
          <span style="color:var(--ink-3);font-size:12.5px">${sis.length} de ${SISTEMAS.length}</span>
        </div>
      </div>
      ${tabela([{ nome: 'Sistema construtivo' }, { nome: 'Escopo' }, { nome: 'Do que se trata' }, { nome: 'Uso' }],
        [sis.slice(0, 220).map(x => `<tr>
          <td style="max-width:270px"><b>${esc(x.n)}</b></td>
          <td>${x.p ? '<span class="selo neutro">privativas</span> ' : ''}${x.c ? '<span class="selo neutro">comuns</span>' : ''}</td>
          <td style="max-width:560px;color:var(--ink-2);font-size:12.5px">${celula(x.d)}</td>
          <td>${usados.has(x.n) ? '<span class="selo bom">em uso</span>' : ''}</td></tr>`).join('')])}
    </div>`;
  },
  depois(e, alvo) {
    alvo.querySelector('#buscaGlos')?.addEventListener('input', ev => { estado.filtros.glos = ev.target.value; clearTimeout(estado._t); estado._t = setTimeout(render, 240); });
    alvo.querySelector('#escopoGlos')?.addEventListener('change', ev => { estado.filtros.glosEscopo = ev.target.value; render(); });
    alvo.querySelector('#importGlos')?.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const regras = JSON.parse(await f.text());
        if (!Array.isArray(regras)) throw new Error('formato inesperado');
        for (const r of regras) if (r.exato) aprenderRegra(r.exato, { categoria: r.cat, produto: r.prod, sistema: r.sis });
        await gravarGlossario(); render(); aviso(`${regras.length} regra(s) importada(s).`);
      } catch (err) { aviso('Arquivo inválido: ' + err.message); }
    });
  },
  acoes: {
    async removerRegra({ exato }) {
      esquecerRegra(exato); await gravarGlossario(); render(); aviso('Regra removida.');
    },
    async exportarGlossario() {
      await store.baixar('prancharia-glossario.json', JSON.stringify(regrasAprendidas(), null, 2), 'application/json');
    },
  },
};

/* ================= PENDÊNCIAS DE REVISÃO ================= */

/* A análise é recalculada sob demanda e guardada em memória: abrir um grupo
   ou marcar itens não precisa refazer a varredura inteira. */
let _cache = { empId: null, selo: '', ocorrencias: [] };
const selecionados = new Set();

function ocorrencias(e, forcar = false) {
  // ocorrências vindas de arquivos avulsos pertencem ao projeto que as gerou
  if (_cache.empId && _cache.empId !== e.id) estado.ocorrenciasArquivos = [];
  const selo = [itens(e).length, (e.locais || []).length, e.documentos.length, Object.keys(e.revisoes || {}).length, e.atualizadoEm].join('|');
  if (!forcar && _cache.empId === e.id && _cache.selo === selo) return _cache.ocorrencias;
  const lista = analisarEmpreendimento(e).concat(estado.ocorrenciasArquivos || []);
  _cache = { empId: e.id, selo, ocorrencias: lista };
  return lista;
}

const CAMPO_ROTULO = {
  categoria: 'Categoria', sistema: 'Sistema Construtivo', marca: 'Marca', nome: 'Nome do local',
  localId: 'Local', descricao: 'Descrição', produto: 'Nome do Produto/Serviço',
  dimensao: 'Dimensão', quantidade: 'Quantidade',
};

const pendenciasView = {
  render(e) {
    if (!e) return '';
    const ocor = ocorrencias(e);
    const grupos = agrupar(ocor, e.revisoes || {});
    const r = resumo(ocor, e.revisoes || {});
    const verResolvidas = !!estado.filtros.verResolvidas;
    const abertoId = estado.filtros.grupo;
    const aberto = grupos.find(g => g.regra === abertoId);

    const auto = (e.historico || []).find(h => h.tipo === 'auditoria');
    return `<div class="cabeca"><div><h1>Pendências de revisão</h1>
      <p class="desc">A auditoria acontece sozinha durante o processamento: o que é objetivo e comprovado pelo documento a análise já corrige, e o que depende de interpretação chega aqui, agrupado por problema, com as fontes à vista. Nada é preenchido por suposição.</p></div>
      <div class="acoes">
        <button class="btn" data-acao="reanalisar">Reanalisar</button>
        <button class="btn ${verResolvidas ? 'primario' : ''}" data-acao="alternarResolvidas">${verResolvidas ? 'Ocultar resolvidas' : 'Mostrar resolvidas'}</button>
      </div></div>

      <div class="placar">
        ${Object.entries(CLASSES).map(([k, c]) => `<div><dt>${c.rotulo}</dt><dd class="${r[k] ? 'tom-' + c.tom : ''}">${r[k] || 0}</dd></div>`).join('')}
        <div><dt>Resolvidas</dt><dd>${r.resolvidas}</dd></div>
      </div>

      ${auto ? `<div class="aviso-faixa"><span>✓</span><div>${esc(auto.texto)} <span style="color:var(--ink-3)">— ${new Date(auto.quando).toLocaleString('pt-BR')}</span></div></div>` : ''}

      ${cartaoOrfaos(e)}

      ${!r.abertas && !semLocal(e).length ? `<div class="cartao"><div class="vazio"><h3>Nada pendente</h3>
        <p>A análise não encontrou erro, conflito ou dúvida em aberto neste empreendimento.</p></div></div>` : ''}

      ${grupos.filter(g => verResolvidas || g.abertas).map(g => {
        const itens = g.itens.filter(i => verResolvidas || !i.resolvida);
        const estaAberto = g.regra === abertoId;
        // só pré-preenche quando todas as ocorrências sugerem a mesma coisa:
        // um valor tirado de um item e aplicado aos outros seria um chute.
        const sugestoes = [...new Set(itens.map(i => i.sugerido).filter(Boolean))];
        const unanime = sugestoes.length === 1 && itens.every(i => i.sugerido) ? sugestoes[0] : '';
        return `<div class="cartao grupo-rev${estaAberto ? ' aberto' : ''}">
          <header>
            <span class="selo ${CLASSES[g.classe].tom}">${CLASSES[g.classe].rotulo}</span>
            <h2>${esc(g.grupo)}</h2>
            <div class="acoes">
              <span class="selo neutro">${g.abertas} ocorrência(s)</span>
              <button class="btn pequeno ${estaAberto ? '' : 'primario'}" data-acao="abrirGrupo" data-id="${g.regra}">${estaAberto ? 'Fechar' : 'Abrir grupo'}</button>
            </div>
          </header>
          ${!estaAberto ? `<div class="corpo" style="padding-top:0"><p style="color:var(--ink-2);font-size:13px;margin:0">${esc(CLASSES[g.classe].desc)} ${esc(itens[0] ? itens[0].descricao.slice(0, 120) : '')}</p></div>` : `
          <div class="barra-lote">
            <label class="marca-tudo"><input type="checkbox" data-sel-todos> Selecionar todos</label>
            <span class="pilula" data-contador>${selecionados.size} selecionado(s)</span>
            ${g.itens.some(i => (i.acoes || []).includes('aplicar')) && g.itens[0].campo ? `
              <span class="sep"></span>
              <label style="font-size:12px;color:var(--ink-3)">${esc(CAMPO_ROTULO[g.itens[0].campo] || g.itens[0].campo)}</label>
              ${entradaLote(e, g.itens[0].campo, unanime)}
              <button class="btn pequeno primario" data-acao="loteAplicar" data-grupo="${g.regra}">Aplicar mesma correção</button>
              ${!unanime && sugestoes.length > 1 ? `<span class="dica-lote">as sugestões variam entre as ocorrências — o valor digitado vale para todas as selecionadas</span>` : ''}` : ''}
            ${g.itens.some(i => (i.acoes || []).includes('confirmar')) ? `<button class="btn pequeno" data-acao="loteConfirmar" data-grupo="${g.regra}">Confirmar selecionados</button>` : ''}
            <button class="btn pequeno" data-acao="loteManter" data-grupo="${g.regra}">Manter informação atual</button>
            ${g.itens.some(i => (i.acoes || []).includes('excluir')) ? `<button class="btn pequeno discreto" data-acao="loteExcluir" data-grupo="${g.regra}">Excluir selecionados</button>` : ''}
          </div>
          ${tabela([{ nome: '' }, { nome: 'Local' }, { nome: 'O que foi observado' }, { nome: 'Valor atual' }, { nome: 'Sugestão' }, { nome: 'Origem' }, { nome: '' }],
            [itens.slice(0, 300).map(i => `<tr class="${i.resolvida ? 'linha-resolvida' : ''}">
              <td><input type="checkbox" data-sel="${esc(i.id)}" ${selecionados.has(i.id) ? 'checked' : ''} ${i.resolvida ? 'disabled' : ''}></td>
              <td>${celula(i.ambiente)}</td>
              <td style="max-width:420px">${esc(i.descricao)}</td>
              <td>${celula(i.atual)}</td>
              <td>${i.sugerido ? `<span class="selo bom">${esc(i.sugerido)}</span>` : '<span class="vazio-celula"></span>'}</td>
              <td>${refsDe(i) ? `<span class="pilula">${esc(refsDe(i))}</span>` : '<span class="vazio-celula"></span>'}</td>
              <td style="white-space:nowrap">
                ${i.alvo === 'achado' ? `<button class="btn pequeno" data-acao="verEvidencia" data-id="${i.alvoId}">Evidências</button>` : ''}
                ${i.alvo === 'ambiente' ? `<button class="btn pequeno" data-acao="abrirAmbiente" data-id="${i.alvoId}">Abrir local</button>` : ''}
                ${i.resolvida ? `<span class="selo bom">${esc(i.resolvida)}</span>` : `
                  ${(i.acoes || []).includes('aplicar') ? `<button class="btn pequeno primario" data-acao="umaAplicar" data-grupo="${g.regra}" data-oc="${esc(i.id)}">${i.sugerido ? `Aplicar “${esc(i.sugerido)}”` : 'Aplicar valor escolhido'}</button>` : ''}
                  ${(i.acoes || []).includes('confirmar') ? `<button class="btn pequeno" data-acao="umaConfirmar" data-grupo="${g.regra}" data-oc="${esc(i.id)}">Confirmar</button>` : ''}
                  <button class="btn pequeno" data-acao="umaManter" data-grupo="${g.regra}" data-oc="${esc(i.id)}">Manter</button>
                  ${(i.acoes || []).includes('excluir') ? `<button class="btn pequeno discreto" data-acao="umaExcluir" data-grupo="${g.regra}" data-oc="${esc(i.id)}">Excluir</button>` : ''}`}
              </td></tr>`).join('')])}
          ${itens.length > 300 ? `<div style="padding:10px 14px;color:var(--ink-3);font-size:12.5px">Mostrando 300 de ${itens.length}.</div>` : ''}
        `}</div>`;
      }).join('')}

      ${cartaoArquivos(e)}`;
  },
  depois(e, alvo) {
    alvo.querySelector('#audManual')?.addEventListener('change', ev => { estado.filtros.audManual = ev.target.files[0]; });
    alvo.querySelector('#audPlan')?.addEventListener('change', ev => { estado.filtros.audPlan = ev.target.files[0]; });
    const cont = alvo.querySelector('[data-contador]');
    const atualizar = () => { if (cont) cont.textContent = `${selecionados.size} selecionado(s)`; };
    for (const cb of alvo.querySelectorAll('[data-sel]')) {
      cb.addEventListener('change', () => {
        if (cb.checked) selecionados.add(cb.dataset.sel); else selecionados.delete(cb.dataset.sel);
        atualizar();
      });
    }
    ligarOrfaos(alvo);
    for (const span of alvo.querySelectorAll('[data-editavel]')) span.addEventListener('click', () => editarCampo(span));
    const todos = alvo.querySelector('[data-sel-todos]');
    if (todos) todos.addEventListener('change', () => {
      for (const cb of alvo.querySelectorAll('[data-sel]:not([disabled])')) {
        cb.checked = todos.checked;
        if (todos.checked) selecionados.add(cb.dataset.sel); else selecionados.delete(cb.dataset.sel);
      }
      atualizar();
    });
  },
  acoes: {
    ...ACOES_ORFAOS,
    reanalisar() { const e = emp(); ocorrencias(e, true); selecionados.clear(); render(); aviso('Análise refeita.'); },
    alternarResolvidas() { estado.filtros.verResolvidas = !estado.filtros.verResolvidas; render(); },
    abrirGrupo({ id }) {
      estado.filtros.grupo = estado.filtros.grupo === id ? null : id;
      selecionados.clear(); render();
    },
    async loteConfirmar({ grupo }) { await emLote(grupo, 'confirmado'); },
    async loteManter({ grupo }) { await emLote(grupo, 'mantido'); },
    async loteExcluir({ grupo }) { await emLote(grupo, 'excluido'); },
    async loteAplicar({ grupo }) {
      const campo = document.getElementById('valorLote');
      await emLote(grupo, 'aplicado', campo ? campo.value : '');
    },
    async umaConfirmar({ grupo, oc }) { await emLote(grupo, 'confirmado', '', [oc]); },
    async umaManter({ grupo, oc }) { await emLote(grupo, 'mantido', '', [oc]); },
    async umaExcluir({ grupo, oc }) { await emLote(grupo, 'excluido', '', [oc]); },
    async umaAplicar({ grupo, oc }) {
      // vale a sugestão da própria ocorrência; sem ela, o valor escolhido na barra
      const campo = document.getElementById('valorLote');
      await emLote(grupo, 'aplicado', campo ? campo.value : '', [oc], { preferirSugestao: true });
    },
    limparArquivos() { estado.ocorrenciasArquivos = []; ocorrencias(emp(), true); render(); },
    async rodarAuditoria() {
      const e = emp();
      const fm = estado.filtros.audManual, fp = estado.filtros.audPlan;
      const st = document.getElementById('audStatus');
      if (!fm && !fp) { aviso('Escolha ao menos um arquivo.'); return; }
      if (st) st.textContent = 'lendo arquivos…';
      try {
        const manual = fm ? await textoDePdf(new Uint8Array(await fm.arrayBuffer())) : [];
        let planilha = [];
        if (fp) {
          const buf = await fp.arrayBuffer();
          planilha = /\.xlsx$/i.test(fp.name) ? await lerXlsx(buf) : lerCsv(new TextDecoder().decode(buf));
        }
        const nomeManual = fm ? fm.name : 'Manual', nomePlanilha = fp ? fp.name : 'Planilha';
        estado.ocorrenciasArquivos = analisarArquivos(e, { manual, planilha, nomeManual, nomePlanilha });
        if (fm && fp) {
          const rel = auditar(planilha, manual, { nomeManual, nomePlanilha });
          e.auditorias.unshift({ id: novoId('aud'), quando: new Date().toISOString(), manual: nomeManual, planilha: nomePlanilha, ...rel });
        }
        ocorrencias(e, true);
        await salvar({ texto: `Conferência de arquivos: ${estado.ocorrenciasArquivos.length} ocorrência(s)`, tipo: 'revisao' });
        render(); aviso('Conferência concluída.');
      } catch (err) {
        console.error(err);
        const s2 = document.getElementById('audStatus');
        if (s2) s2.textContent = 'falhou: ' + err.message;
      }
    },
    async baixarRelatorio({ id }) {
      const e = emp(); const a = e.auditorias.find(x => x.id === id) || e.auditorias[0];
      await store.baixar(arquivoSeguro(e.nome) + '-auditoria.txt', relatorioAuditoria(e, a), 'text/plain');
    },
  },
};

/* O manual e a planilha já entregues são entrada opcional: quando existem,
   a mesma análise cruza os três e devolve tudo na lista de pendências. */
function cartaoArquivos(e) {
  const arq = (estado.ocorrenciasArquivos || []).length;
  const ult = e.auditorias[0];
  return `<div class="cartao"><header><h2>Conferir com o manual e a planilha entregues</h2>
    <div class="acoes">${arq ? `<span class="selo neutro">${arq} ocorrência(s) dos arquivos</span>` : ''}
      ${ult ? `<button class="btn pequeno" data-acao="baixarRelatorio" data-id="${ult.id}">Baixar relatório</button>` : ''}</div></header>
    <div class="corpo">
      <div class="grade2">
        <div class="campo"><label>Manual (PDF)</label><input type="file" id="audManual" accept="application/pdf"></div>
        <div class="campo"><label>Planilha entregue (XLSX ou CSV)</label><input type="file" id="audPlan" accept=".xlsx,.csv,.txt"></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn primario" data-acao="rodarAuditoria">Conferir arquivos</button>
        ${arq ? '<button class="btn discreto" data-acao="limparArquivos">Descartar conferência</button>' : ''}
        <span id="audStatus" style="color:var(--ink-3);font-size:13px"></span>
      </div>
      <p style="font-size:12.5px;color:var(--ink-3);margin-top:10px">O que for encontrado entra nesta mesma lista, agrupado com as demais pendências.</p>
      ${ult ? `<details style="margin-top:14px"><summary style="cursor:pointer;font-family:var(--cond);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)">Relatório detalhado — ${esc(ult.manual)} × ${esc(ult.planilha)}</summary>
        <div style="margin-top:12px">${relatorioHtml(ult)}</div></details>` : ''}
    </div></div>`;
}

function entradaLote(e, campo, sugerido) {
  if (campo === 'categoria') {
    return `<select id="valorLote">${CATEGORIAS.map(c => `<option ${c === sugerido ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  }
  if (campo === 'localId') {
    return `<select id="valorLote"><option value="">— escolher local —</option>${locaisVivos(e).map(a => `<option value="${a.id}">${esc(a.nome)}${a.pavimento ? ' · ' + esc(a.pavimento) : ''}</option>`).join('')}</select>`;
  }
  if (campo === 'sistema') {
    return `${listaSistemas()}<input id="valorLote" list="listaSistemas" value="${esc(sugerido)}" placeholder="sistema construtivo" style="min-width:230px">`;
  }
  return `<input id="valorLote" value="${esc(sugerido)}" placeholder="novo valor" style="min-width:200px">`;
}

/* Serve às duas revisões: em lote (usa a seleção) e individual (recebe a
   ocorrência pelo id). O caminho é o mesmo, o registro no histórico também. */
async function emLote(regra, acao, valor = '', apenas = null, opcoes = {}) {
  const e = emp();
  e.revisoes = e.revisoes || {};
  const grupo = agrupar(ocorrencias(e), e.revisoes).find(g => g.regra === regra);
  if (!grupo) return;
  const escolhidos = apenas ? new Set(apenas) : selecionados;
  const alvos = grupo.itens.filter(i => escolhidos.has(i.id) && !i.resolvida);
  if (!alvos.length) { aviso('Selecione ao menos uma ocorrência.'); return; }
  if (acao === 'aplicado' && !valor && !alvos.every(o => o.sugerido)) { aviso('Informe o valor a aplicar.'); return; }
  if (acao === 'excluido' && !confirm(`Excluir ${alvos.length} item(ns)? A exclusão fica registrada no histórico.`)) return;

  let n = 0;
  for (const o of alvos) {
    const v = opcoes.preferirSugestao ? (o.sugerido || valor) : valor;
    const aplicado = await aplicarOcorrencia(e, o, acao, v);
    if (!aplicado) continue;
    e.revisoes[o.id] = { estado: acao, quando: new Date().toISOString(), valor: acao === 'aplicado' ? (v || o.sugerido) : '' };
    n++;
  }
  if (!apenas) selecionados.clear();
  await salvar({ texto: `${n} ocorrência(s) de “${grupo.grupo}” — ${ROTULO_LOTE[acao]}`, tipo: 'revisao' });
  ocorrencias(e, true);
  render();
  aviso(`${n} ocorrência(s) resolvida(s).`);
}

const ROTULO_LOTE = { confirmado: 'confirmadas', mantido: 'mantidas como estão', excluido: 'excluídas', aplicado: 'corrigidas' };

async function aplicarOcorrencia(e, o, acao, valor, opcoes = {}) {
  const aprender = opcoes.aprender !== false;
  const achado = o.alvo === 'achado' ? acharAchado(o.alvoId) : null;
  const ambiente = o.alvo === 'ambiente' ? acharAmbiente(o.alvoId) : null;

  if (acao === 'mantido') {
    if (achado && (achado.motivos || []).length && o.regra !== 'conflito') achado.motivos = achado.motivos.filter(m => m !== 'baixa_confianca');
    return true;
  }
  if (acao === 'confirmado') {
    if (achado) {
      achado.status = 'confirmado';
      if (achado.confianca === 'baixa') achado.confianca = 'media';
      achado.motivos = [];
      if (o.regra === 'conflito') { achado.divergencias = []; }
    } else if (ambiente) { ambiente.status = 'confirmado'; ambiente.confianca = 'alta'; }
    return true;
  }
  if (acao === 'excluido') {
    if (achado) achado.status = 'excluido';
    else if (ambiente) ambiente.status = 'excluido';
    else return true;
    return true;
  }
  if (acao === 'aplicado') {
    const novo = valor || o.sugerido;
    if (!novo) return false;
    if (ambiente && o.campo === 'nome') {
      const antes = ambiente.nome;
      ambiente.nome = novo;
      for (const x of itensDo(e, ambiente.id)) x.localNome = novo;
      ambiente.status = 'corrigido';
      registrarHistorico(e, { texto: `Local renomeado: “${antes}” → “${novo}”`, tipo: 'revisao', antes, depois: novo });
      return true;
    }
    if (!achado) return false;
    if (o.campo === 'localId') {
      const alvo = acharAmbiente(novo);
      if (!alvo) return false;
      moverParaLocal(e, achado, alvo);
      achado.motivos = (achado.motivos || []).filter(m => !['tag_sem_ambiente', 'termo_sem_ambiente', 'sem_local', 'baixa_confianca', 'vinculo_por_proximidade'].includes(m));
      achado.status = 'corrigido';
      if (achado.confianca === 'baixa') achado.confianca = 'media';
      return true;
    }
    const antes = achado[o.campo] || '';
    achado[o.campo] = novo;
    achado.status = 'corrigido';
    achado.motivos = (achado.motivos || []).filter(m => !(o.campo === 'sistema' && m === 'sem_sistema'));
    registrarHistorico(e, {
      texto: `${CAMPO_ROTULO[o.campo] || o.campo} — ${aprender ? 'corrigida na revisão' : 'preenchida pela auditoria automática'}`,
      tipo: aprender ? 'revisao' : 'auditoria', antes, depois: novo, alvo: achado.id,
    });
    // a correção feita por você vira regra; a que a própria regra sugeriu, não
    if (aprender && ['categoria', 'sistema', 'produto'].includes(o.campo) && achado.descricao) {
      aprenderRegra(achado.descricao, { categoria: achado.categoria, produto: achado.produto, sistema: achado.sistema });
      await gravarGlossario();
    }
    return true;
  }
  return false;
}

/* ================= PLANILHAS ================= */
const planilhas = {
  render(e) {
    if (!e) return '';
    const abas = pastaDeAbas(e);
    const aba = abas.find(a => a.nome === (estado.filtros.aba || abas[0]?.nome)) || abas[0];
    const pend = pendencias(e);
    return `<div class="cabeca"><div><h1>Planilha de produtos e fornecedores</h1>
      <p class="desc">Mesmo layout da Planilha de Produtos e Fornecedores: linha 1 com os códigos de importação, linha 5 com os títulos, dados a partir da linha 6. Célula sem evidência sai vazia, nunca com “N/A”.</p></div>
      <div class="acoes">
        <button class="btn" data-acao="copiarAba">Copiar aba</button>
        <button class="btn primario" data-acao="baixarXlsx">Baixar XLSX</button>
        <button class="btn" data-acao="baixarCsvAba">Baixar aba em CSV</button>
        <button class="btn" data-acao="baixarJson">Exportar JSON</button>
      </div></div>
      ${pend.length ? `<div class="aviso-faixa"><span>⚠</span><div><b>${pend.length} item(ns) pendente(s).</b> Eles entram na exportação com o status e a confiança que têm hoje — a aba Pendências lista cada um. <button class="btn pequeno" data-rota="pendencias" style="margin-left:6px">Revisar agora</button></div></div>` : ''}
      <div class="filtros">${abas.map(a => `<button class="btn pequeno ${aba.nome === a.nome ? 'primario' : ''}" data-acao="trocarAba" data-nome="${esc(a.nome)}">${esc(a.nome)} <span class="pilula" style="background:transparent">${a.linhas.length - 1}</span></button>`).join('')}</div>
      <div class="cartao"><div class="rolagem"><table>
        <thead><tr>${(aba.linhas[0] || []).map(c => `<th${/^[a-z_]+\.[a-z_.]+$|^memorial_systems$/.test(c) ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${aba.linhas.slice(1, 260).map((l, i) => {
          const moldura = i < 4 && aba.nome !== 'Copiar';
          return `<tr${moldura ? ' style="color:var(--ink-3)"' : ''}>${l.map(c => `<td>${moldura ? esc(c) : celula(c)}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
      </table></div>
      ${aba.linhas.length > 260 ? `<div style="padding:10px 14px;color:var(--ink-3);font-size:12.5px">Pré-visualização de 259 linhas. O arquivo exportado traz todas as ${aba.linhas.length - 1}.</div>` : ''}</div>`;
  },
  acoes: {
    trocarAba({ nome }) { estado.filtros.aba = nome; render(); },
    copiarAba() {
      const e = emp(); const abas = pastaDeAbas(e);
      const aba = abas.find(a => a.nome === (estado.filtros.aba || abas[0].nome)) || abas[0];
      copiarTsv(aba.linhas, `Aba ${aba.nome}`);
    },
    async baixarXlsx() {
      const e = emp();
      await store.baixar(arquivoSeguro(e.nome) + '-produtos-e-fornecedores.xlsx', exportarXlsx(e));
      await salvar({ texto: 'Planilha XLSX exportada', tipo: 'exportacao' });
      aviso('Planilha gerada.');
    },
    async baixarCsvAba() {
      const e = emp();
      const abas = pastaDeAbas(e);
      const aba = abas.find(a => a.nome === (estado.filtros.aba || abas[0].nome)) || abas[0];
      await store.baixar(`${arquivoSeguro(e.nome)}-${arquivoSeguro(aba.nome)}.csv`, exportarCsv(aba.linhas), 'text/csv');
      aviso('CSV gerado.');
    },
    async baixarJson() {
      const e = emp();
      await store.baixar(arquivoSeguro(e.nome) + '.json', exportarJson(e), 'application/json');
      aviso('JSON gerado.');
    },
  },
};
const arquivoSeguro = s => normalizar(s).replace(/\s+/g, '-').slice(0, 48) || 'empreendimento';

/* A auditoria roda por dentro, durante o processamento dos documentos. O que
   sobra para decisão humana aparece em Pendências de revisão; o relatório
   abaixo é só o detalhamento da conferência com o manual e a planilha. */
function relatorioHtml(a) {
  return `<div class="cartao"><header><h2>Relatório — ${esc(a.manual)} × ${esc(a.planilha)}</h2>
    <div class="acoes"><span class="pilula">${new Date(a.quando).toLocaleString('pt-BR')}</span>
    <button class="btn pequeno" data-acao="baixarRelatorio" data-id="${a.id}">Baixar</button></div></header>
    <div class="corpo" style="display:flex;flex-direction:column;gap:18px">
      <section><div class="cat" style="color:var(--ink-3);margin-bottom:6px">1. Resumo executivo</div>
        <p style="font-size:14px;max-width:70ch">${esc(a.resumo)}</p></section>
      <section><div class="cat" style="color:var(--ink-3);margin-bottom:6px">2. Tabela de inconsistências</div>
        ${tabela([{ nome: '#', num: 1 }, { nome: 'Arquivo 1' }, { nome: 'Arquivo 2' }, { nome: 'Tipo de problema' }, { nome: 'Descrição da incoerência' }, { nome: 'Impacto/Risco' }],
          a.itens.length ? [a.itens.map((i, n) => `<tr><td class="num">${n + 1}</td><td>${celula(i.a)}</td><td>${celula(i.b)}</td>
            <td><span class="selo ${/Alto/.test(i.impacto) ? 'critico' : 'atencao'}">${esc(i.tipo)}</span></td>
            <td style="max-width:420px">${esc(i.descricao)}</td><td style="max-width:260px">${esc(i.impacto)}</td></tr>`).join('')] : [],
          { tituloVazio: 'Nenhuma inconsistência', textoVazio: 'Os dois documentos estão alinhados nos pontos verificados.' })}</section>
      ${a.criticos.length ? `<section><div class="cat" style="color:var(--ink-3);margin-bottom:6px">3. Pontos críticos</div>
        <ul class="lista-limpa">${a.criticos.map((c, n) => `<li><span class="pilula">${n + 1}</span><div><b>${esc(c.titulo)}</b><div style="color:var(--ink-2)">${esc(c.detalhe)}</div></div></li>`).join('')}</ul></section>` : ''}
      <section><div class="cat" style="color:var(--ink-3);margin-bottom:6px">4. Plano de ação recomendado</div>
        <ul class="lista-limpa">${a.acoes.map((x, n) => `<li><span class="pilula">${n + 1}</span><div>${esc(x)}</div></li>`).join('')}</ul></section>
    </div></div>`;
}

/* ================= RASTREABILIDADE ================= */
const rastro = {
  render(e) {
    if (!e) return '';
    const a = acharAchado(estado.param);
    if (!a) return `<div class="cabeca"><div><button class="btn discreto pequeno" data-rota="locais">← Locais</button><h1>Item não encontrado</h1></div></div>`;
    const provas = provasDe(e, a);
    const perguntas = rastreio(e, a);
    const cadeia = fluxo(e, a);
    const fontes = (a.evidencias || []).filter(Boolean);
    return `<div class="cabeca">
      <div>
        <button class="btn discreto pequeno" data-acao="voltarDoRastro" data-amb="${esc(a.localId || '')}" style="margin-bottom:6px">← Voltar</button>
        <h1>${esc(a.produto || a.descricao || a.codigoOrigem || 'Item')}</h1>
        <p class="desc">${esc([a.localNome || 'sem local', a.pavimento, a.categoria].filter(Boolean).join(' · '))}</p>
      </div>
      <div class="acoes">
        <button class="btn" data-acao="verEvidencia" data-id="${a.id}">Painel de evidências</button>
        <button class="btn primario" data-acao="verNaPrancha" data-id="${a.id}">Ver na prancha</button>
      </div></div>

      <div class="placar">
        <div><dt>Fontes</dt><dd>${fontes.length}</dd></div>
        <div><dt>Recortes</dt><dd>${provas.length}</dd></div>
        <div><dt>Confiança</dt><dd style="font-size:17px">${esc((CONFIANCA[a.confianca] || {}).rotulo || '—')}</dd></div>
        <div><dt>Situação</dt><dd style="font-size:17px">${esc((STATUS[a.status] || {}).rotulo || '—')}</dd></div>
      </div>

      <div class="cartao"><header><h2>Cadeia completa da informação</h2></header>
        <div class="corpo"><div class="fluxo">
          ${cadeia.map((el, i) => `<div class="no-fluxo"${el.papel ? ` style="--papel:${PAPEIS[el.papel].cor}"` : ''}>
            <div class="rotulo">${esc(el.rotulo)}</div><div class="valor">${esc(el.valor)}</div>
          </div>${i < cadeia.length - 1 ? '<div class="seta-fluxo">↓</div>' : ''}`).join('')}
        </div></div></div>

      <div class="cartao"><header><h2>O que sustenta cada dado</h2></header>
        ${tabela([{ nome: 'Pergunta' }, { nome: 'Resposta' }],
          [perguntas.map(q => `<tr><td style="width:38%;color:var(--ink-2)">${esc(q.pergunta)}</td>
            <td>${q.resposta ? esc(q.resposta) : '<span class="vazio-celula"></span>'}</td></tr>`).join('')])}
      </div>

      <div class="cartao"><header><h2>Evidências visuais (${provas.length})</h2>
        <div class="acoes"><span class="selo neutro">recortes da prancha original</span></div></header>
        <div class="corpo"><div class="grade-provas">
          ${provas.map((p, i) => `<div class="prova-card" style="--papel:${PAPEIS[p.papel].cor}">
            <div class="prova-topo"><span class="ponto-papel"></span><b>${esc(PAPEIS[p.papel].rotulo)}</b>
              <span class="pilula">${esc(p.documento || '')} p.${esc(p.pagina || '—')}</span></div>
            <div class="recorte"><canvas data-prova='${esc(JSON.stringify({ documentoId: p.documentoId, pagina: p.pagina, caixa: p.caixaRegiao, realces: p.realces }))}'></canvas>
              <div class="legenda-recorte">${esc(p.titulo || '')}</div></div>
            <p class="nota-prova">${esc(p.nota || PAPEIS[p.papel].desc)}</p>
            <button class="btn pequeno" data-acao="verNaPrancha" data-id="${a.id}" data-prova-foco="${i}">Ver na prancha</button>
          </div>`).join('') || '<p style="color:var(--ink-3)">Item criado manualmente — sem recorte de documento.</p>'}
        </div></div></div>`;
  },
  depois(e, alvo) {
    for (const cv of alvo.querySelectorAll('[data-prova]')) {
      const d = JSON.parse(cv.dataset.prova);
      recortar(cv, { ...d, larguraAlvo: 460 });
    }
  },
  acoes: {
    voltarDoRastro({ amb }) { if (amb) irPara('locais', amb); else irPara('locais'); },
  },
};

/* ================= HISTÓRICO ================= */
const historico = {
  render(e) {
    if (!e) return '';
    const linhas = e.historico.map(h => `<tr>
      <td class="num">${new Date(h.quando).toLocaleString('pt-BR')}</td>
      <td><span class="selo neutro">${esc(h.tipo || 'evento')}</span></td>
      <td style="max-width:520px">${esc(h.texto)}</td>
      <td>${h.antes !== undefined ? `<span style="color:var(--critico)">${esc(String(h.antes).slice(0, 60) || '—')}</span> → <span style="color:var(--bom)">${esc(String(h.depois).slice(0, 60))}</span>` : '<span class="vazio-celula"></span>'}</td></tr>`).join('');
    return `<div class="cabeca"><div><h1>Histórico</h1><p class="desc">Todo processamento, edição e exportação fica registrado com data, hora e valor anterior.</p></div></div>
      <div class="cartao">${tabela([{ nome: 'Quando', num: 1 }, { nome: 'Tipo' }, { nome: 'Evento' }, { nome: 'Antes → depois' }], linhas ? [linhas] : [],
        { tituloVazio: 'Sem histórico', textoVazio: 'As ações aparecem aqui assim que você processar ou editar algo.' })}</div>`;
  },
};

/* ================= CONFIGURAÇÕES ================= */
const config = {
  render(e) {
    if (!e) return '';
    const c = estado.capacidades;
    const t = tipoDe(e);
    const todosNiveis = [...new Set(TIPOS.flatMap(x => x.niveis.map(n => n.nivel)))]
      .sort((a, b) => ORDEM_NIVEIS.indexOf(a) - ORDEM_NIVEIS.indexOf(b));
    const ativos = new Set(niveisDe(e).map(n => n.nivel));
    return `<div class="cabeca"><div><h1>Configurações</h1><p class="desc">Cadastro, estrutura do tipo e situação do armazenamento.</p></div>
      <div class="acoes"><button class="btn" data-acao="editarEmpAtual">Editar cadastro</button></div></div>

      <div class="cartao"><header><h2>Empreendimento</h2></header><div class="corpo grade2">
        <div class="campo"><label>Nome</label><input id="cfgNome" value="${esc(e.nome)}"></div>
        <div class="campo"><label>Localização</label><input id="cfgEnd" value="${esc(e.localizacao || e.endereco || '')}"></div>
        <div class="campo"><label>Responsável técnico</label><input id="cfgResp" value="${esc(e.responsavel || '')}"></div>
      </div><div class="corpo" style="padding-top:0"><button class="btn primario" data-acao="salvarConfig">Salvar</button></div></div>

      <div class="cartao"><header><h2>Estrutura do empreendimento</h2>
        <div class="acoes"><span class="selo neutro">${esc(t.nome)}</span></div></header>
        <div class="corpo">
          <p style="font-size:13px;color:var(--ink-2);max-width:70ch">${esc(t.resumo)} Os níveis abaixo vêm do tipo escolhido — ligue ou desligue conforme este projeto específico.</p>
          <div class="cadeia-tipo" style="margin:12px 0 16px">${cadeiaDe(e).map((x, i) => `${i ? '<i>›</i>' : ''}<span>${esc(x)}</span>`).join('')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${todosNiveis.map(n => `<button class="btn pequeno ${ativos.has(n) ? 'primario' : ''}" data-acao="alternarNivel" data-nivel="${n}">
              ${esc(rotuloNivel(e, n, true))}${ativos.has(n) ? ` <span class="pilula" style="background:transparent">${(e.estrutura[n] || []).length}</span>` : ''}</button>`).join('')}
          </div>
          <div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn pequeno ${temAreasComuns(e) ? 'primario' : ''}" data-acao="alternarAreasComuns">Áreas comuns (aba MC)</button>
            <span style="font-size:12.5px;color:var(--ink-3)">${temAreasComuns(e) ? 'Locais podem ser marcados como MC; a planilha sai com as duas abas.' : 'Tudo vai para MP — sem aba de áreas comuns.'}</span>
          </div>
        </div></div>

      ${cartaoNuvem()}
      ${cartaoMotor()}

      <div class="cartao"><header><h2>Armazenamento</h2></header><div class="corpo">
        <ul class="lista-limpa">
          <li><span class="selo ${c.db ? 'bom' : 'atencao'}">${c.db ? 'ativo' : 'local'}</span>
            <div><b>Dados do levantamento</b><div style="color:var(--ink-2)">${c.db ? 'Gravados no banco do artefato: seguem disponíveis em qualquer máquina que abra este link.' : 'Gravados apenas neste navegador. Exporte o JSON para não depender dele.'}</div></div></li>
          <li><span class="selo ${c.assets ? 'bom' : 'atencao'}">${c.assets ? 'ativo' : 'local'}</span>
            <div><b>Arquivos PDF</b><div style="color:var(--ink-2)">${c.assets ? 'Enviados como anexos do artefato, além da cópia local — “Ver na prancha” funciona de outra máquina.' : 'Mantidos apenas neste navegador. Em outra máquina será preciso reenviar os PDFs para ver os recortes.'}</div></div></li>
        </ul>
      </div></div>

      <div class="cartao"><header><h2>Vocabulário de categorias</h2></header><div class="corpo">
        <p style="font-size:13px;color:var(--ink-2);margin-bottom:10px">Fixo por definição do processo. Nenhuma categoria nova é criada automaticamente.</p>
        <div style="display:flex;gap:7px;flex-wrap:wrap">${CATEGORIAS.map(c2 => `<span class="selo neutro">${c2}</span>`).join('')}</div>
      </div></div>

      <div class="cartao"><header><h2>Como as tags são lidas</h2></header><div class="corpo">
        <p style="font-size:13px;color:var(--ink-2);max-width:70ch">Forma e número são sempre lidos juntos. Um mesmo número em formas diferentes designa materiais diferentes, e o sistema nunca cruza pelo número isolado.</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px">
          ${Object.keys(ROTULO_FORMA).map(f => marcaForma(f, '01')).join('')}
        </div>
        ${e.legendas.length ? `<div style="margin-top:16px">${e.legendas.slice(0, 2).map(l => `
          <div style="font-size:12.5px;color:var(--ink-3);margin-bottom:6px">${esc(l.documento)} · página ${l.pagina}</div>
          <div class="rolagem"><table><thead><tr><th>Forma</th><th>Bloco</th><th>Categoria</th><th>Itens</th></tr></thead><tbody>
          ${l.blocos.map(b => `<tr><td>${marcaForma(b.forma, '')}</td><td>${esc(b.titulo)}</td><td>${celula(b.categoria)}</td>
            <td style="max-width:520px;font-size:12.5px">${b.itens.map(i => `<span class="pilula">${esc(i.numero)}</span> ${esc(i.descricao)}`).join('<br>')}</td></tr>`).join('')}
          </tbody></table></div>`).join('')}</div>` : ''}
      </div></div>`;
  },
  depois(e, alvo) {
    // endereço e tempo limite do motor valem no `blur`, sem precisar de botão
    /* `change` chega junto com o blur; redesenhar na mesma pilha arranca o
       próprio input que está perdendo o foco. Por isso o render espera um tique. */
    const depoisDoBlur = () => setTimeout(render, 0);
    const bff = alvo.querySelector('#cfgBff');
    if (bff) bff.addEventListener('change', () => {
      const v = bff.value.trim().replace(/\/+$/, '');
      if (v) configurarIA({ bff: v });
      estado.saudeIA = null; depoisDoBlur();
    });
    const to = alvo.querySelector('#cfgTimeout');
    if (to) to.addEventListener('change', () => {
      const n = Number(to.value);
      if (n >= 2000) configurarIA({ timeoutMs: n });
      depoisDoBlur();
    });
  },
  acoes: {
    editarEmpAtual() { VIEWS.empreendimentos.acoes.editarEmp({ id: estado.empId }); },
    async salvarConfig() {
      const e = emp();
      e.nome = document.getElementById('cfgNome').value.trim() || e.nome;
      e.localizacao = document.getElementById('cfgEnd').value.trim();
      e.responsavel = document.getElementById('cfgResp').value.trim();
      await salvar({ texto: 'Dados do empreendimento atualizados', tipo: 'config' });
      render(); aviso('Salvo.');
    },
    async alternarNivel({ nivel }) {
      const e = emp();
      const ativo = temNivel(e, nivel);
      if (ativo) {
        if ((e.estrutura[nivel] || []).length && !confirm(`Desligar ${rotuloNivel(e, nivel, true).toLowerCase()}? Os itens cadastrados ficam guardados, mas somem do menu.`)) return;
        e.niveisDesligados = [...new Set([...(e.niveisDesligados || []), nivel])];
        e.niveisExtras = (e.niveisExtras || []).filter(x => x !== nivel);
      } else {
        e.niveisDesligados = (e.niveisDesligados || []).filter(x => x !== nivel);
        if (!tipoDe(e).niveis.some(n => n.nivel === nivel)) e.niveisExtras = [...new Set([...(e.niveisExtras || []), nivel])];
      }
      await salvar({ texto: `${rotuloNivel(e, nivel, true)} ${ativo ? 'desligado' : 'ligado'}`, tipo: 'config' });
      render();
    },
    async alternarAreasComuns() {
      const e = emp();
      e.areaComunsForcado = undefined;
      e.areasComunsForcado = !temAreasComuns(e);
      await salvar({ texto: `Áreas comuns ${e.areasComunsForcado ? 'ligadas' : 'desligadas'}`, tipo: 'config' });
      render();
    },
  },
};

/* ================= MOTOR DE LEITURA ================= */
/* A leitura vetorial não precisa de nada. A multimodal precisa do BFF no ar —
   e é ele que guarda a chave da API, que nunca chega ao navegador. */
/* O estado da infraestrutura numa frase: onde os dados estão e de quem é a
   memória que a IA está usando. Mora em Configurações, ao lado do motor. */
function cartaoNuvem() {
  const naNuvem = store.naNuvem();
  const r = empresaMem.resumo();
  return `<div class="cartao"><header><h2>Onde os dados moram</h2>
    <div class="acoes"><span class="selo ${naNuvem ? 'bom' : 'neutro'}">${naNuvem ? 'servidor' : 'só nesta máquina'}</span></div></header>
    <div class="corpo">
      <p style="font-size:13px;color:var(--ink-2);max-width:78ch">${naNuvem
        ? `Os projetos e as pranchas estão no servidor em <code>${esc(store.NUVEM.base)}</code>. Outra pessoa da equipe abre o mesmo levantamento, e a prancha abre em qualquer máquina. <b>Não há autenticação:</b> quem alcança esse endereço vê tudo — ele precisa ficar atrás de VPN ou da rede do escritório.`
        : `Tudo está guardado apenas neste navegador. Para trabalhar em equipe, suba o BFF em <code>/server</code> e recarregue: o Prancharia detecta sozinho e passa a gravar lá.`}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
        <span class="selo ${r.ativa ? 'bom' : 'neutro'}">${r.ativa ? esc(r.ativa.nome) : 'sem empresa ativa'}</span>
        ${r.ativa ? `<span style="font-size:12.5px;color:var(--ink-3)">${r.regras} caractere(s) de regra · ${r.fornecedores} marca(s) · ${r.termos} termo(s) no vocabulário</span>` : ''}
        <button class="btn pequeno" data-rota="empresas">${r.ativa ? 'Ver memória da empresa' : 'Escolher empresa'}</button>
      </div>
    </div></div>`;
}

function cartaoMotor() {
  const ligada = iaLigada();
  const s = estado.saudeIA;           // null = não consultado, false = fora do ar
  return `<div class="cartao"><header><h2>Motor de leitura</h2>
    <div class="acoes"><span class="selo ${ligada ? 'bom' : 'neutro'}">${ligada ? 'IA multimodal' : 'leitura vetorial'}</span></div></header>
    <div class="corpo">
      <p style="font-size:13px;color:var(--ink-2);max-width:74ch">A <b>leitura vetorial</b> lê o texto e a geometria do PDF: tags forma+número cruzadas com a legenda, e as tabelas desenhadas. Roda sozinha, sem rede.
      A <b>IA multimodal</b> soma a isso o que só a imagem mostra — hachuras, paginação, especificação escrita no desenho. Ela precisa do servidor local (<code>/server</code>) no ar, porque é ele que guarda a chave da API.</p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
        <button class="btn pequeno ${!ligada ? 'primario' : ''}" data-acao="usarMotor" data-motor="fallback_vetorial">Leitura vetorial</button>
        <button class="btn pequeno ${ligada ? 'primario' : ''}" data-acao="usarMotor" data-motor="multimodal_gemini">IA multimodal</button>
        <span class="sep" style="width:1px;height:20px;background:var(--borda)"></span>
        <button class="btn pequeno" data-acao="testarIA">Testar servidor</button>
        ${s === false ? '<span class="selo atencao">servidor fora do ar</span>'
          : s ? `<span class="selo bom">${esc(s.modelo || 'no ar')}${s.chaveConfigurada ? '' : ' · sem chave'}</span>` : ''}
      </div>

      <div class="grade2" style="margin-top:14px">
        <div class="campo"><label for="cfgBff">Endereço do servidor</label>
          <input id="cfgBff" value="${esc(IA.bff)}" placeholder="http://localhost:3000" style="font-family:var(--mono);font-size:12.5px"></div>
        <div class="campo"><label for="cfgTimeout">Tempo limite por local (ms)</label>
          <input id="cfgTimeout" type="number" min="2000" step="1000" value="${IA.timeoutMs}"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <button class="btn pequeno ${IA.lerLocaisSemTag ? 'primario' : ''}" data-acao="alternarLocaisSemTag">Ler também locais sem tag</button>
        <span style="font-size:12.5px;color:var(--ink-3)">${IA.lerLocaisSemTag
          ? 'É aqui que estão as hachuras que a leitura vetorial não vê — e custa uma chamada por local.'
          : 'Só locais que já têm tag desenhada entram na leitura por imagem.'}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <button class="btn pequeno ${IA.lerQuadrosComIA ? 'primario' : ''}" data-acao="alternarLeituraAmpla">Leitura ampla de quadros e notas</button>
        <span style="font-size:12.5px;color:var(--ink-3)">${IA.lerQuadrosComIA
          ? 'Uma chamada por folha: a IA lê os quadros de acabamento, as tabelas, as legendas e as notas, e vincula cada produto ao local que a tabela declara.'
          : 'A folha é lida só pelos leitores vetoriais.'}</span>
      </div>
      ${IA.desligadoPorFalha ? `<div class="aviso-faixa" style="margin-top:14px"><span>⚠</span><div><b>O motor multimodal se desligou nesta sessão</b> depois de ${IA.maxFalhas} falhas seguidas. O processamento seguiu no motor vetorial — nada foi perdido. Religue no botão acima depois de resolver o servidor.</div></div>` : ''}
      ${IA.ultimoErro ? `<p style="margin-top:12px;font-size:12.5px;color:var(--ink-3)">Último erro: <code>${esc(IA.ultimoErro.mensagem)}</code> — ${new Date(IA.ultimoErro.quando).toLocaleString('pt-BR')}.</p>` : ''}
      ${IA.chamadas ? `<p style="margin-top:6px;font-size:12.5px;color:var(--ink-3)">${IA.chamadas} chamada(s) ao servidor nesta sessão.</p>` : ''}
      <p style="margin-top:12px;font-size:12.5px;color:var(--ink-3)">A página publicada roda em sandbox sem rede externa: lá o sistema fica sempre na leitura vetorial. Para usar a IA, rode o projeto local com o servidor de <code>/server</code>.</p>
    </div></div>`;
}

const ACOES_MOTOR = {
  async usarMotor({ motor }) {
    configurarIA({ provedor: motor });
    if (motor === 'multimodal_gemini') {
      const s = await saudeDaIA();
      estado.saudeIA = s || false;
      render();
      aviso(s ? `IA multimodal ligada — servidor respondendo (${s.modelo || 'modelo não declarado'}).`
        : 'IA multimodal ligada, mas o servidor não respondeu. Cada prancha vai cair na leitura vetorial até ele subir.');
      return;
    }
    render(); aviso('Leitura vetorial. Nenhuma chamada de rede.');
  },
  async testarIA() {
    const s = await saudeDaIA();
    estado.saudeIA = s || false;
    render();
    aviso(s
      ? `Servidor no ar: ${s.modelo || 'modelo não declarado'}${s.chaveConfigurada ? '' : ' — sem GEMINI_API_KEY, vai responder 503'}.`
      : `Sem resposta em ${esc(IA.bff)}. Suba o servidor: cd server && npm start.`);
  },
  async alternarLocaisSemTag() {
    configurarIA({ lerLocaisSemTag: !IA.lerLocaisSemTag });
    render();
  },
  async alternarLeituraAmpla() {
    configurarIA({ lerQuadrosComIA: !IA.lerQuadrosComIA });
    render();
  },
};

/* ================= ações compartilhadas ================= */
const ACOES_COMUNS = {
  ...ACOES_ORFAOS,
  ...ACOES_MOTOR,
  verEvidencia({ id }) { const a = acharAchado(id); if (a) abrirGaveta(a); },
  verNaPrancha({ id, provaFoco }) { const a = acharAchado(id); if (a) irVerNaPrancha(a, provaFoco); },
  verNaPranchaLocal({ id }) { const l = acharAmbiente(id); if (l) irVerNaPranchaLocal(l); },
  abrirRastro({ id }) { fecharGaveta(); irPara('rastro', id); },
  async confirmarAchado({ id }) {
    const a = acharAchado(id); if (!a) return;
    a.status = 'confirmado'; if (a.confianca === 'baixa') a.confianca = 'media';
    a.motivos = [];
    await salvar({ texto: `Item confirmado: ${a.produto || a.descricao || a.codigoOrigem || ''}`, tipo: 'revisao', alvo: a.id });
    fecharGaveta(); render(); aviso('Item confirmado.');
  },
  async marcarRevisar({ id }) {
    const a = acharAchado(id); if (!a) return;
    a.status = 'revisar';
    await salvar({ texto: `Item marcado para revisar`, tipo: 'revisao', alvo: a.id });
    fecharGaveta(); render();
  },
  async excluirAchado({ id }) {
    const a = acharAchado(id); if (!a) return;
    a.status = 'excluido';
    await salvar({ texto: `Item excluído: ${a.descricao || ''}`, tipo: 'revisao', alvo: a.id });
    fecharGaveta(); render(); aviso('Item excluído.');
  },
  async editarAchado({ id }) {
    const a = acharAchado(id); if (!a) return;
    const d = prompt('Descrição/Modelo/Linha', a.descricao || '');
    if (d === null) return;
    const antes = a.descricao; a.descricao = d.trim();
    a.status = 'corrigido';
    await salvar({ texto: 'Descrição editada', tipo: 'edicao', antes, depois: a.descricao, alvo: a.id });
    abrirGaveta(a); render();
  },
  async resolverConflito({ id, i }) {
    const a = acharAchado(id); if (!a) return;
    const idx = Number(i);
    const antes = a.descricao;
    if (idx >= 0) a.descricao = a.divergencias[idx].descricao;
    a.divergencias = []; a.status = 'corrigido';
    a.motivos = (a.motivos || []).filter(m => m !== 'conflito');
    await salvar({ texto: `Conflito resolvido em “${a.localNome || ''}”`, tipo: 'conflito', antes, depois: a.descricao, alvo: a.id });
    abrirGaveta(a); render(); aviso('Decisão registrada.');
  },
  async adicionarItem({ amb }) {
    const e = emp(); const a = acharAmbiente(amb); if (!a) return;
    const cat = prompt('Categoria (' + CATEGORIAS.join(', ') + ')');
    if (!cat || !CATEGORIAS.includes(cat)) { if (cat) aviso('Categoria fora do vocabulário permitido.'); return; }
    const desc = prompt('Descrição/Modelo/Linha');
    if (!desc?.trim()) return;
    const esp = criarEspecificacao({
      categoria: cat, descricao: desc.trim(), produto: desc.trim(),
      localId: a.id, localNome: a.nome, pavimento: a.pavimento, tipologia: a.tipologia || '',
      origemLeitura: 'manual', confianca: 'alta', status: 'confirmado',
    });
    esp.evidencias.push(criarEvidencia({
      tipo: 'manual',
      documentoOrigem: { docId: 'manual', nomeDoc: 'entrada manual', pagina: '' },
      texto: desc.trim(),
      cadeia: [a.nome, 'entrada manual', desc.trim(), cat],
      proveniencia: { motor_ia: 'manual', metodo: 'entrada_manual', confianca: 'alta' },
    }));
    a.especificacoes = a.especificacoes || [];
    a.especificacoes.push(esp);
    sincronizar(e);
    await salvar({ texto: `Item adicionado manualmente em ${a.nome}`, tipo: 'edicao' });
    render();
  },
  copiarQuadro({ amb }) {
    const e = emp(); const a = acharAmbiente(amb);
    copiarTsv(tabelaCopia(e, itensDo(e, amb)), `Quadro de ${a ? a.nome : 'local'}`);
  },
  copiarFiltrados() {
    const e = emp(); const f = estado.filtros;
    let lista = itens(e);
    if (f.cat) lista = lista.filter(a => a.categoria === f.cat);
    if (f.amb) lista = lista.filter(a => a.localId === f.amb);
    if (f.conf) lista = lista.filter(a => a.confianca === f.conf);
    if (f.stat) lista = lista.filter(a => a.status === f.stat);
    copiarTsv(tabelaCopia(e, lista), 'Quadro');
  },
  async baixarQuadro({ amb }) {
    const e = emp(); const a = acharAmbiente(amb);
    const linhas = tabelaCopia(e, itensDo(e, amb));
    await store.baixar(arquivoSeguro(a.nome) + '-quadro-de-acabamentos.csv', exportarCsv(linhas), 'text/csv');
  },
};

// Locais absorveu Ambientes, Acabamentos e Esquadrias: as ações das três
// precisam responder quando a rota é 'locais'.
locais.acoes = Object.assign({}, ambientes.acoes, esquadrias.acoes, acabamentos.acoes, locais.acoes);

for (const v of [painel, empreendimentos, documentos, estrutura, locais, ambientes, esquadrias, acabamentos, produtos, fornecedores, glossario, pendenciasView, planilhas, rastro, historico, config]) {
  v.acoes = Object.assign({}, ACOES_COMUNS, v.acoes || {});
}

document.addEventListener('change', async (ev) => {
  const alvo = ev.target.closest('[data-acao-change]');
  if (!alvo) return;
  const nome = alvo.dataset.acaoChange;
  const view = VIEWS[estado.rota];
  const fn = view?.acoes?.[nome];
  if (fn) await fn({ ...alvo.dataset, valor: alvo.value }, alvo, ev);
});


/* ================= EMPRESAS — a memória técnica da construtora ================= */

/* Duas coisas nesta tela, e a segunda é a que importa:

   1. QUAL EMPRESA ESTÁ ATIVA. A escolha vale para a sessão inteira: ela viaja
      em toda chamada ao servidor, escolhe o escopo do glossário e entra no
      System Instruction do Gemini.

   2. O QUE O MODELO VAI LER. O painel do fim mostra, palavra por palavra, o
      bloco que o servidor anexa à instrução de sistema — buscado do próprio
      servidor, não remontado aqui. Cadastrar regra de IA sem poder ver o texto
      final é pedir para alguém confiar no escuro, e este sistema inteiro é
      construído sobre o contrário disso. */

function empresaEmEdicao() {
  if (!estado.empresaEdit) estado.empresaEdit = empresaMem.empresaVazia();
  return estado.empresaEdit;
}

function linhaFornecedor(f, i) {
  return `<tr data-forn="${i}">
    <td><input data-campo="marca" value="${esc(f.marca || '')}" placeholder="Portobello"></td>
    <td><select data-campo="categoria"><option value="">todas as categorias</option>
      ${CATEGORIAS.map(c => `<option ${f.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
    <td><input data-campo="fornecedor" value="${esc(f.fornecedor || '')}" placeholder="quem entrega"></td>
    <td><input data-campo="observacao" value="${esc(f.observacao || '')}" placeholder="observação"></td>
    <td style="text-align:right"><button class="btn discreto pequeno" data-acao="tirarFornecedor" data-i="${i}" aria-label="Remover">✕</button></td>
  </tr>`;
}

function linhaTermo(v, i) {
  return `<tr data-termo="${i}">
    <td><input data-campo="de" value="${esc(v.de || '')}" placeholder="Varanda"></td>
    <td style="width:28px;text-align:center;color:var(--ink-3)">→</td>
    <td><input data-campo="para" value="${esc(v.para || '')}" placeholder="Terraço"></td>
    <td><input data-campo="nota" value="${esc(v.nota || '')}" placeholder="observação"></td>
    <td style="text-align:right"><button class="btn discreto pequeno" data-acao="tirarTermo" data-i="${i}" aria-label="Remover">✕</button></td>
  </tr>`;
}

const empresas = {
  render() {
    const disponivel = empresaMem.disponivel();
    const lista = empresaMem.empresas();
    const ativa = empresaMem.empresaAtiva();
    const ed = empresaEmEdicao();

    const cabeca = `<div class="cabeca"><div><h1>Empresas</h1>
      <p class="desc">A memória técnica de cada construtora: como ela nomeia os ambientes, que marcas homologa e o que a IA precisa saber antes de ler a primeira prancha. O que está aqui entra na leitura de todos os projetos dessa empresa.</p></div>
      <div class="acoes">${disponivel ? '<button class="btn" data-acao="novaEmpresa">Nova empresa</button>' : ''}</div></div>`;

    if (!disponivel) {
      return cabeca + `<div class="cartao"><div class="vazio">
        <h3>O servidor não está no ar</h3>
        <p>As empresas moram no servidor — é o que permite a mesma memória valer para toda a equipe, em qualquer máquina. Suba o BFF em <code>/server</code> e recarregue esta página.</p>
        <p style="margin-top:10px"><button class="btn" data-rota="config">Abrir configurações</button></p>
      </div></div>`;
    }

    const cartoes = lista.length ? `<div class="cartao"><header><h2>Construtoras</h2>
      <div class="acoes"><span class="selo neutro">${lista.length}</span></div></header>
      <div class="corpo"><div class="tipos">
        ${lista.map(e => `<button type="button" class="tipo" data-acao="ativarEmpresa" data-id="${esc(e.id)}"
            aria-pressed="${ativa && ativa.id === e.id ? 'true' : 'false'}">
          <span class="fam">${e.projetos || 0} projeto(s)</span>
          <b>${esc(e.nome)}</b>
          <small>${(e.regrasIa || '').trim() ? 'regras de IA cadastradas' : 'sem regras de IA'}
            · ${(e.fornecedoresHomologados || []).length} marca(s)
            · ${(e.vocabulario || []).length} termo(s)</small>
        </button>`).join('')}
      </div>
      ${ativa ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
        <button class="btn pequeno" data-acao="editarEmpresa" data-id="${esc(ativa.id)}">Editar ${esc(ativa.nome)}</button>
        <button class="btn pequeno" data-acao="ativarEmpresa" data-id="">Trabalhar sem empresa</button>
        <button class="btn discreto pequeno" data-acao="apagarEmpresa" data-id="${esc(ativa.id)}">Apagar</button>
      </div>` : '<p style="font-size:13px;color:var(--ink-3);margin-top:12px">Nenhuma empresa ativa: a leitura roda sem contexto de construtora, como sempre rodou.</p>'}
      </div></div>` : `<div class="cartao"><div class="vazio">
        <h3>Nenhuma empresa cadastrada</h3>
        <p>Cadastre a primeira construtora para começar a acumular o que ela tem de particular — o nome que dá aos ambientes, as marcas que homologa, o que a IA precisa saber.</p>
        <p style="margin-top:10px"><button class="btn primario" data-acao="novaEmpresa">Nova empresa</button></p>
      </div></div>`;

    const forn = ed.fornecedoresHomologados || [];
    const vocab = ed.vocabulario || [];

    const editor = `<div class="cartao" id="editorEmpresa">
      <header><h2>${ed.id ? 'Editar' : 'Nova'} empresa</h2>
        <div class="acoes"><button class="btn primario pequeno" data-acao="salvarEmpresa">Salvar</button>
        ${ed.id ? '<button class="btn discreto pequeno" data-acao="novaEmpresa">Cancelar</button>' : ''}</div></header>
      <div class="corpo">
        <div class="campo"><label for="empNomeEmpresa">Nome da construtora</label>
          <input id="empNomeEmpresa" value="${esc(ed.nome || '')}" placeholder="Construtora Exemplo"></div>

        <div class="campo" style="margin-top:18px"><label for="empRegras">Regras de IA</label>
          <textarea id="empRegras" rows="5" placeholder="Ex.: Nesta empresa as varandas são chamadas de Terraço. O padrão de piso de área comum é porcelanato 90x90 retificado. Rodapé é sempre do mesmo material do piso, salvo indicação na prancha.">${esc(ed.regrasIa || '')}</textarea>
          <small style="color:var(--ink-3);font-size:12px;display:block;margin-top:6px">Texto livre, em português, escrito para o modelo. Vai para a instrução de sistema do Gemini em toda leitura desta empresa.</small></div>

        <h3 style="margin:22px 0 8px;font-size:14px">Marcas e fornecedores homologados</h3>
        <p style="font-size:12.5px;color:var(--ink-2);max-width:80ch;margin-bottom:10px">Servem para <b>reconhecer e grafar certo</b> uma marca que o documento cita — e para o glossário sugerir o fornecedor junto. Não servem para atribuir marca a item que a prancha deixou sem marca.</p>
        <div class="rolagem"><table id="tabFornecedores"><thead><tr>
          <th>Marca</th><th>Categoria</th><th>Fornecedor</th><th>Observação</th><th></th></tr></thead>
          <tbody>${forn.length ? forn.map(linhaFornecedor).join('')
            : '<tr><td colspan="5" style="color:var(--ink-3)">nenhuma marca homologada</td></tr>'}</tbody></table></div>
        <button class="btn pequeno" data-acao="novoFornecedor" style="margin-top:10px">Adicionar marca</button>

        <h3 style="margin:22px 0 8px;font-size:14px">Vocabulário da casa</h3>
        <p style="font-size:12.5px;color:var(--ink-2);max-width:80ch;margin-bottom:10px">O nome que a prancha usa, à esquerda; o que esta empresa escreve no manual, à direita.</p>
        <div class="rolagem"><table id="tabVocabulario"><thead><tr>
          <th>No documento</th><th></th><th>Nesta empresa</th><th>Observação</th><th></th></tr></thead>
          <tbody>${vocab.length ? vocab.map(linhaTermo).join('')
            : '<tr><td colspan="5" style="color:var(--ink-3)">nenhum termo cadastrado</td></tr>'}</tbody></table></div>
        <button class="btn pequeno" data-acao="novoTermo" style="margin-top:10px">Adicionar termo</button>
      </div></div>`;

    const prova = ativa ? `<div class="cartao"><header><h2>O que a IA vai ler</h2>
      <div class="acoes"><button class="btn pequeno" data-acao="verPromptEmpresa" data-id="${esc(ativa.id)}">Carregar do servidor</button></div></header>
      <div class="corpo">
        <p style="font-size:12.5px;color:var(--ink-2);max-width:80ch">Este é o texto exato que o servidor anexa à instrução de sistema do Gemini quando <b>${esc(ativa.nome)}</b> está ativa. Ele vem do próprio servidor — não é uma reconstrução desta tela.</p>
        <pre id="promptEmpresa" style="margin-top:12px;white-space:pre-wrap;font-family:var(--mono);font-size:11.5px;line-height:1.6;color:var(--ink-2);background:var(--surface-2);padding:16px;border-radius:var(--raio-s);max-height:420px;overflow:auto">${
          estado.promptEmpresa != null ? esc(estado.promptEmpresa) : 'clique em “Carregar do servidor” para ver o texto final.'}</pre>
      </div></div>` : '';

    return cabeca + cartoes + editor + prova;
  },

  acoes: {
    async ativarEmpresa({ id }) {
      await empresaMem.ativar(id || null);
      estado.promptEmpresa = null;
      aviso(id ? `Empresa ativa: ${empresaMem.empresaAtiva()?.nome || id}` : 'Trabalhando sem empresa.');
      render();
    },

    novaEmpresa() { estado.empresaEdit = empresaMem.empresaVazia(); estado.promptEmpresa = null; render(); },

    async editarEmpresa({ id }) {
      const e = empresaMem.empresas().find(x => x.id === id) || await store.lerEmpresa(id);
      /* cópia funda: editar a tabela não pode mexer no objeto do cache */
      estado.empresaEdit = e ? JSON.parse(JSON.stringify(e)) : empresaMem.empresaVazia();
      render();
    },

    novoFornecedor() {
      const ed = empresaEmEdicao();
      colherEditor();
      (ed.fornecedoresHomologados = ed.fornecedoresHomologados || []).push({ marca: '', categoria: '', fornecedor: '', observacao: '' });
      render();
    },
    tirarFornecedor({ i }) {
      colherEditor();
      empresaEmEdicao().fornecedoresHomologados.splice(Number(i), 1);
      render();
    },
    novoTermo() {
      const ed = empresaEmEdicao();
      colherEditor();
      (ed.vocabulario = ed.vocabulario || []).push({ de: '', para: '', nota: '' });
      render();
    },
    tirarTermo({ i }) {
      colherEditor();
      empresaEmEdicao().vocabulario.splice(Number(i), 1);
      render();
    },

    async salvarEmpresa() {
      colherEditor();
      const ed = empresaEmEdicao();
      if (!(ed.nome || '').trim()) return aviso('Dê um nome à empresa antes de salvar.');
      try {
        const salva = await empresaMem.salvar(ed);
        /* empresa recém-criada já entra ativa: é o que a pessoa quer em seguida */
        if (salva && !empresaMem.empresaAtiva()) await empresaMem.ativar(salva.id, { silencioso: true });
        estado.empresaEdit = salva ? JSON.parse(JSON.stringify(salva)) : empresaMem.empresaVazia();
        estado.promptEmpresa = null;
        aviso(`“${salva.nome}” salva.`);
      } catch (e) { aviso(`Não consegui salvar: ${e.message}`); }
      render();
    },

    async apagarEmpresa({ id }) {
      const alvo = empresaMem.empresas().find(x => x.id === id);
      if (!confirm(`Apagar “${alvo?.nome || id}”?\n\nOs projetos dela NÃO são apagados: voltam para “sem empresa” e podem ser reatribuídos.`)) return;
      try { await empresaMem.apagar(id); estado.empresaEdit = empresaMem.empresaVazia(); aviso('Empresa apagada.'); }
      catch (e) { aviso(`Não consegui apagar: ${e.message}`); }
      render();
    },

    async verPromptEmpresa({ id }) {
      const r = await store.promptDaEmpresa(id);
      estado.promptEmpresa = r
        ? (r.bloco || '(esta empresa não tem nada cadastrado: a instrução do Gemini fica idêntica à de sempre)')
        : '(não consegui falar com o servidor)';
      render();
    },
  },
};

/* Os inputs da tabela não disparam evento a cada tecla — colhemos o que está
   nela antes de qualquer re-render, senão o que foi digitado se perde. */
function colherEditor() {
  const ed = empresaEmEdicao();
  const nome = document.getElementById('empNomeEmpresa');
  const regras = document.getElementById('empRegras');
  if (nome) ed.nome = nome.value;
  if (regras) ed.regrasIa = regras.value;

  const lerLinhas = (idTabela, atributo, campos) => {
    const t = document.getElementById(idTabela);
    if (!t) return null;
    const linhas = [...t.querySelectorAll(`tbody tr[${atributo}]`)];
    return linhas.map(tr => {
      const o = {};
      for (const c of campos) o[c] = tr.querySelector(`[data-campo="${c}"]`)?.value?.trim() || '';
      return o;
    });
  };
  const f = lerLinhas('tabFornecedores', 'data-forn', ['marca', 'categoria', 'fornecedor', 'observacao']);
  if (f) ed.fornecedoresHomologados = f;
  const v = lerLinhas('tabVocabulario', 'data-termo', ['de', 'para', 'nota']);
  if (v) ed.vocabulario = v;
  return ed;
}

export const VIEWS = {
  painel, empreendimentos, documentos, estrutura, locais, ambientes, esquadrias,
  acabamentos, produtos, fornecedores, glossario, pendencias: pendenciasView,
  planilhas, rastro, historico, config, empresas,
};
