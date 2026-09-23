import {
  estado, emp, esc, celula, seloConfianca, seloStatus, marcaForma, aviso, salvar, irPara,
  ROTULO_FORMA, render, store, novoId, gravarGlossario, aprenderRegra, esquecerRegra, regrasAprendidas,
  abrirModal, fecharModal, empreendimentoVazio, hidratar, recarregarLista, sincronizarComNuvem,
  perguntar, confirmar, ICONES,
} from '../app.js';
import { importarDoDrive, driveConfigurado, idDoLink } from '../core/drive.js';
import { classificarArea } from '../core/areas.js';
import { OBSIDIAN, configurarObsidian, testarObsidian, enviarParaObsidian, zipDoCofre, notasDoEmpreendimento } from '../core/obsidian.js';
import { TIPOS, TIPO_POR_ID, ORDEM_NIVEIS, tipoDe, niveisDe, temNivel, rotuloNivel, temAreasComuns, cadeiaDe } from '../core/tipos.js';
import { SISTEMAS, NOMES_SISTEMAS, SISTEMA_POR_NOME } from '../core/vocab.js';
import { REGRAS_BASE } from '../core/glossario.js';
import { analisarMemorial, pareceMemorial, cruzarComPranchas, fundirComMemorial, precisaDeOcr } from '../core/memorial.js';
import { ocrPdf, anotarFalha } from '../core/ia.js';
import { identificarDisciplina, textoDoCarimbo, emEscopo, nomeDisciplina, DISCIPLINAS } from '../core/disciplina.js';
import { completarObrigatorias } from '../core/ambiente.js';
import {
  CATEGORIAS, STATUS, CONFIANCA, MOTIVOS_PENDENCIA, registrarHistorico, normalizar,
  semearPavimentos, sincronizar,
  criarLocal, criarEspecificacao, criarEvidencia, novoId as novoIdModelo,
} from '../core/model.js';
import { analisarFolha, consolidar, incorporarEspecificacaoSolta, recorteBase64, IA, configurarIA, saudeDaIA, iaLigada } from '../core/engine.js';
import { openPdf } from '../core/pdfdoc.js';
import { pendencias, pastaDeAbas, exportarXlsx, exportarCsv, exportarJson, relatorioAuditoria, tipologiasComDados, tabelaCopia, ordenarEspecificacoes, locaisDe, especificacoesDe } from '../core/exporter.js';
import { auditar, lerXlsx, lerCsv, textoDePdf } from '../core/audit.js';
import { CLASSES, analisarEmpreendimento, analisarArquivos, agrupar, resumo } from '../core/auditoria.js';
import { provasDe, rastreio, fluxo, PAPEIS, NIVEIS, refDoc, nomeDoc, paginaDoc, idDoc, refsDe, motorDe, ehMemorial } from '../core/provas.js';
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

/* ================= EMPREENDIMENTOS ================= */

/* Quando o servidor compartilhado não respondeu a tempo (ex.: acordando de
   hibernação no plano gratuito do Render), o sistema cai em silêncio para
   armazenamento só deste navegador — e a lista de empreendimentos fica vazia
   sem explicar por quê, como se ninguém tivesse criado nada ainda. Este
   aviso é o que distingue "não há projetos" de "não consegui falar com o
   servidor onde eles moram". Só aparece fora de localhost: em desenvolvimento
   local sem `/server` no ar, rodar sem nuvem é o esperado, não um erro. */
function avisoModoLocal() {
  if (store.naNuvem()) return avisoNuvemLigada();
  let local = false;
  try { local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname); } catch { /* sem window */ }
  if (local) return '';
  return `<div class="aviso-faixa"><span class="ico-aviso" aria-hidden="true">!</span><div><b>Não consegui falar com o servidor compartilhado.</b> O que aparece abaixo é só deste navegador — pode não ser a mesma lista que outra pessoa (ou você, em outro navegador) vê. O sistema continua tentando em segundo plano e liga sozinho quando o servidor acordar; se preferir, <button class="btn pequeno" data-acao="religarNuvem" style="margin-left:4px">tentar agora</button>. O que você criar enquanto isso fica guardado aqui e sobe ao servidor assim que ele responder.</div></div>`;
}

/* Com a nuvem ligada ainda há duas coisas a avisar. A primeira é grave: o
   servidor rodando num disco efêmero (Render free sem Turso) perde TUDO ao
   hibernar — é a causa de "criei aqui e não vejo em outro navegador". A
   segunda é o resto dessa história: projetos que ficaram presos neste
   navegador enquanto o servidor estava fora, com a versão daqui mais nova
   que a de lá. */
function avisoNuvemLigada() {
  const partes = [];
  if (store.NUVEM.persistente === false) {
    partes.push(`<div class="aviso-faixa critico"><span class="ico-aviso" aria-hidden="true">!</span><div><b>O servidor está sem banco persistente.</b> Ele roda num disco efêmero: tudo o que for gravado lá some quando ele reiniciar ou hibernar — é por isso que os empreendimentos não aparecem em outro navegador. Este navegador guarda uma cópia de tudo e reenvia sozinho, mas outra pessoa só verá os dados depois que o servidor tiver um banco de verdade. Configure <code>TURSO_DATABASE_URL</code> no painel do Render (passo a passo no LEIA-ME, seção “Banco persistente”).</div></div>`);
  }
  const p = estado.nuvemPendentes;
  if (p && p.maisNovos && p.maisNovos.length) {
    const nomes = p.maisNovos.slice(0, 4).map(e => esc(e.nome)).join(', ') + (p.maisNovos.length > 4 ? '…' : '');
    partes.push(`<div class="aviso-faixa"><span class="ico-aviso" aria-hidden="true">!</span><div><b>${p.maisNovos.length} empreendimento(s) têm uma versão mais nova neste navegador</b> do que no servidor (${nomes}). Provavelmente você trabalhou enquanto o servidor estava fora do ar. <button class="btn pequeno" data-acao="enviarLocais" style="margin-left:4px">Enviar a versão deste navegador</button> substitui a do servidor.</div></div>`);
  }
  return partes.join('');
}

function statusProcessamento(e) {
  if (e.resumo) return { rotulo: 'Carregando…', tom: 'neutro' };
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
      const pend = pendencias(e).length;
      /* esqueleto da nuvem: o corpo ainda está a caminho — reticências, não zero */
      const n = v => e.resumo ? '…' : v;
      return `<article class="cartao-selecao emp ${e.id === estado.empId ? 'atual' : ''}">
        <div class="topo">
          <div style="min-width:0">
            <h3>${esc(e.nome)}</h3>
            <div class="meta">${esc(t.nome)}${e.localizacao ? ' · ' + esc(e.localizacao) : ''}</div>
          </div>
          <span class="selo ${st.tom}" style="margin-left:auto;flex:none">${esc(st.rotulo)}</span>
        </div>
        <dl class="emp-numeros">
          <div><dt>Docs</dt><dd>${n(e.documentos.length)}</dd></div>
          <div><dt>Locais</dt><dd>${n(locaisVivos(e).length)}</dd></div>
          <div><dt>Itens</dt><dd>${n(itens(e).length)}</dd></div>
          <div><dt>Pend.</dt><dd class="${pend ? 'tom-aviso' : ''}">${n(pend)}</dd></div>
        </dl>
        <div class="meta">${niveis.length ? niveis.map(n => esc(n.plural)).join(' · ') + ' · ' : ''}atualizado ${e.atualizadoEm ? new Date(e.atualizadoEm).toLocaleDateString('pt-BR') : '—'}</div>
        <div class="acoes">
          <button class="btn primario pequeno" data-acao="abrirEmpreendimento" data-id="${e.id}">Abrir</button>
          <button class="btn pequeno" data-acao="abrirDocumentos" data-id="${e.id}">Documentos</button>
          <button class="btn pequeno" data-acao="editarEmp" data-id="${e.id}">Editar</button>
          <button class="btn pequeno discreto" data-acao="duplicarEmp" data-id="${e.id}">Duplicar</button>
          <button class="btn pequeno discreto" data-acao="apagarEmp" data-id="${e.id}">Excluir</button>
        </div>
      </article>`;
    }).join('');

    return `<div class="cabeca">
      <div><h1>Empreendimentos</h1>
      <p class="desc">Tudo começa aqui: crie o empreendimento, defina o tipo e só então envie os documentos. O tipo escolhido configura os níveis, o menu e os campos do projeto.</p></div>
      <div class="acoes"><button class="btn primario" data-acao="criarEmp">Criar empreendimento</button></div></div>

      ${avisoModoLocal()}

      ${lista.length ? `<div class="grade-cartoes">${cartoes}</div>`
        : `<div class="cartao"><div class="vazio">
            <h3>Nenhum empreendimento ainda</h3>
            <p>Comece criando o empreendimento e escolhendo o tipo — casa, condomínio de apartamentos, hotel, galpão. A partir daí o sistema monta a estrutura certa para ele.</p>
            <button class="btn primario" data-acao="criarEmp">Criar empreendimento</button>
          </div></div>`}`;
  },
  acoes: {
    criarEmp() { formEmpreendimento(null); },
    recarregarPagina() { location.reload(); },
    async religarNuvem() {
      aviso('Tentando falar com o servidor… se ele estiver hibernando, pode levar até 30s.');
      const ligou = await store.religarNuvem();
      if (!ligou) { aviso('O servidor ainda não respondeu. Vou continuar tentando em segundo plano.'); render(); }
      /* quando liga, o evento `prancharia:nuvem` cuida do resto */
    },
    async enviarLocais() {
      const p = estado.nuvemPendentes;
      const n = p ? (p.novos.length + p.maisNovos.length) : 0;
      if (!n) { aviso('Nada pendente neste navegador.'); return; }
      if (!await confirmar({ titulo: `Enviar ${n} empreendimento(s) ao servidor?`, texto: 'A versão que está no servidor será substituída pela deste navegador.', ok: 'Enviar' })) return;
      aviso('Enviando…');
      const feito = await store.enviarLocaisParaNuvem({ soNovos: false });
      await recarregarLista();
      estado.nuvemPendentes = await store.projetosSoLocais();
      render();
      aviso(`${feito.projetos} empreendimento(s) e ${feito.arquivos} PDF(s) enviados` + (feito.falhas.length ? ` — ${feito.falhas.length} falha(s), veja o console.` : '.'));
      if (feito.falhas.length) console.warn('[nuvem] falhas ao enviar:', feito.falhas);
    },
    editarEmp({ id }) { formEmpreendimento(estado.emps.find(x => x.id === id)); },
    async abrirDocumentos({ id }) {
      await hidratar(id);
      estado.empId = id;
      estado.filtros = {};
      irPara('documentos');
    },
    async salvarEmpNovo(_d, _el) {
      const m = document.getElementById('modal');
      const dados = lerForm(m);
      if (!dados.nome) { aviso('Dê um nome ao empreendimento.'); m.querySelector('#empNome')?.focus(); return; }
      const e = empreendimentoVazio(dados.nome, dados.tipo);
      Object.assign(e, { localizacao: dados.localizacao, responsavel: dados.responsavel, observacoes: dados.observacoes, dados: dados.dados });
      semearEstrutura(e);
      registrarHistorico(e, { texto: `Empreendimento criado como ${tipoDe(e).nome}`, tipo: 'empreendimento' });
      estado.emps.unshift(e); estado.empId = e.id;
      await store.salvarEmpreendimento(e);
      fecharModal(); irPara('locais'); aviso('Empreendimento criado.');
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
      if (!await confirmar({ titulo: `Excluir “${e ? e.nome : 'este empreendimento'}”?`, texto: 'Documentos, locais, especificações e histórico deste empreendimento serão apagados. Não dá para desfazer.', ok: 'Excluir', perigo: true })) return;
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
    const linhas = e.documentos.map(d => {
      const fusao = d.motorFusao === 'multimodal_gemini' ? '<span class="selo bom">fusão semântica</span>'
        : d.tipo === 'memorial' && d.processadoEm ? '<span class="selo neutro">cruzamento por texto</span>' : '';
      const evidencia = (d.disciplinaEvidencia || []).join('\n');
      const seletor = `<select class="sel-disciplina" data-id="${d.id}" aria-label="Disciplina de ${esc(d.nome)}" title="${esc(evidencia || 'Disciplina do documento')}">
        ${d.disciplina ? '' : '<option value="" selected>disciplina?</option>'}
        ${DISCIPLINAS.map(x => `<option value="${x.id}"${x.id === d.disciplina ? ' selected' : ''}>${esc(x.nome)}${x.escopo ? '' : ' · fora do escopo'}</option>`).join('')}
      </select>`;
      const ladoEvidencia = (d.ladoEvidencia || []).join('\n');
      const seletorLado = !temAreasComuns(e) ? '' : `<select class="sel-lado" data-id="${d.id}" aria-label="Lado de ${esc(d.nome)}" title="${esc(ladoEvidencia || 'Áreas comuns ou unidades privativas — desempata o que o nome do cômodo não decide')}">
        <option value=""${!d.lado ? ' selected' : ''}>lado: pelo cômodo</option>
        <option value="comum"${d.lado === 'comum' ? ' selected' : ''}>áreas comuns</option>
        <option value="privativa"${d.lado === 'privativa' ? ' selected' : ''}>unidades privativas</option>
      </select>`;
      const sub = [
        d.tipo === 'memorial' ? 'memorial' : 'prancha',
        d.pasta ? d.pasta.replace(/\/$/, '') : '',
        d.disciplinaOrigem === 'ia' ? 'disciplina pela IA' : d.disciplinaOrigem === 'manual' ? 'disciplina ajustada' : '',
        d.lado && temAreasComuns(e) ? (d.lado === 'comum' ? 'áreas comuns' : 'unidades') + (d.ladoOrigem === 'ia' ? ' (IA)' : d.ladoOrigem === 'manual' ? ' (ajustado)' : '') : '',
        `${d.paginas || 1} pág.`,
        `${(d.bytes / 1048576).toFixed(1)} MB`,
        d.revisao ? 'revisão ' + d.revisao : '',
        d.enviadoEm ? 'enviado ' + new Date(d.enviadoEm).toLocaleDateString('pt-BR') : '',
        d.ocrAplicado ? 'OCR' : '',
      ].filter(Boolean).join(' · ');
      return `<tr>
      <td class="celula-doc"><button class="btn discreto link-doc" data-acao="verDoc" data-id="${d.id}" title="${esc(d.nome)}">${esc(d.nome)}</button>
        <div class="sub">${esc(sub)}</div>
        <div class="sub" style="display:flex;gap:6px;flex-wrap:wrap">${seletor}${seletorLado}</div></td>
      <td class="num">${d.tipo === 'memorial' ? (d.itens || 0) : (d.tags || 0)}</td>
      <td class="num">${d.locaisLidos ?? d.ambientes ?? 0}</td>
      <td><div class="selos">${d.foraDoEscopo
        ? `<span class="selo neutro" title="${esc(evidencia)}">fora do escopo</span>`
        : d.processadoEm ? `<span class="selo bom">processado</span>` : '<span class="selo atencao">aguardando</span>'}${fusao}</div></td>
      <td style="white-space:nowrap;text-align:right">
        ${d.foraDoEscopo ? `<button class="btn pequeno" data-acao="lerMesmoAssim" data-id="${d.id}" title="Lê este documento como se fosse de arquitetura">Ler mesmo assim</button>` : ''}
        <button class="btn pequeno" data-acao="verDoc" data-id="${d.id}">Abrir</button>
        <button class="btn pequeno discreto" data-acao="removerDoc" data-id="${d.id}">Remover</button></td></tr>`;
    }).join('');
    return `
      <div class="cabeca"><div><h1>Documentos</h1><p class="desc">Pranchas, memoriais e cadernos do empreendimento. Pode mandar a pasta inteira do projeto: o sistema identifica a disciplina de cada arquivo e deixa de lado estrutura, instalações e modificações de unidade. Das pranchas de arquitetura lê tags, legendas e tabelas; dos memoriais lê o texto corrido, marca e modelo. Envie as pranchas antes dos memoriais para que os trechos encontrem o local certo.</p></div>
        <div class="acoes">
          <input id="entradaDocs" type="file" accept="application/pdf" multiple hidden>
          <button class="btn" id="importarDrive" type="button" title="${driveConfigurado() ? 'Escolher PDFs ou uma pasta no seu Google Drive' : 'Preencha CLIENT_ID e API_KEY em js/core/drive.js para ligar'}">
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linejoin="round"><path d="M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14z"/><path d="M8.5 3.5 2.5 14M15.5 3.5l-7 12.5M21.5 14h-13"/></svg>
            Google Drive</button>
          <button class="btn" id="importarDriveLink" type="button" title="Colar o link de uma pasta ou PDF do Drive — serve para a pasta compartilhada que o seletor não mostra">Colar link</button>
          ${e.documentos.some(d => !d.processadoEm && !d.foraDoEscopo) ? '<button class="btn" data-acao="processarTudo">Processar pendentes</button>' : ''}
          ${e.documentos.some(d => d.tipo === 'memorial') ? '<button class="btn" data-acao="reprocessarMemoriais">Recruzar memoriais</button>' : ''}
          <label class="btn primario" for="entradaDocs"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES.upload}</svg>Enviar arquivos</label>
        </div></div>
      ${estado.processando ? `<div class="cartao"><div class="corpo">
        <div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-bottom:6px"><span id="progTexto" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(estado.processando.texto)}</span><span class="num" id="progPct" style="flex:none">${Math.round(estado.processando.pct * 100)}%</span></div>
        <div class="progresso"><i id="progBarra" style="--pct:${estado.processando.pct}"></i></div></div></div>`
      : `<label class="zona-solta" for="entradaDocs" id="zonaSolta">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES.upload}</svg>
        <div><b>Arraste os PDFs para cá</b><span>ou clique para escolher. Pranchas de arquitetura e memoriais descritivos, um ou vários de uma vez.</span></div>
      </label>`}
      ${e.documentos.length ? `<div class="cartao">${tabela(
        [{ nome: 'Arquivo' }, { nome: 'Tags / itens', num: 1 }, { nome: 'Locais', num: 1 }, { nome: 'Situação' }, { nome: '' }],
        [linhas])}
      </div>` : ''}
      ${doc ? `<div class="cartao"><header><h2>${esc(doc.nome)}</h2>
        <div class="acoes"><span class="pilula">${doc.paginas || 1} página(s)</span></div></header>
        <div id="visorCaixa"></div></div>` : ''}`;
  },
  depois(e, alvo) {
    const inp = alvo.querySelector('#entradaDocs');
    if (inp) inp.addEventListener('change', ev => receberArquivos([...ev.target.files]));
    const drive = alvo.querySelector('#importarDrive');
    if (drive) drive.addEventListener('click', () => receberDoDrive());
    const driveLink = alvo.querySelector('#importarDriveLink');
    if (driveLink) driveLink.addEventListener('click', () => receberDoDrive({ porLink: true }));
    for (const s of alvo.querySelectorAll('select.sel-disciplina')) {
      s.addEventListener('change', ev => documentos.acoes.mudarDisciplina({ id: s.dataset.id, valor: ev.target.value }));
    }
    for (const s of alvo.querySelectorAll('select.sel-lado')) {
      s.addEventListener('change', ev => documentos.acoes.mudarLado({ id: s.dataset.id, valor: ev.target.value }));
    }
    /* arrastar e soltar em qualquer ponto da tela de Documentos; a faixa é
       recriada a cada render, então os ouvintes não se acumulam */
    const faixa = alvo.firstElementChild;
    const zona = alvo.querySelector('#zonaSolta');
    if (faixa) {
      const liga = (on) => zona?.classList.toggle('sobre', on);
      faixa.addEventListener('dragenter', ev => { ev.preventDefault(); liga(true); });
      faixa.addEventListener('dragover', ev => { ev.preventDefault(); liga(true); });
      faixa.addEventListener('dragleave', ev => { if (!faixa.contains(ev.relatedTarget)) liga(false); });
      faixa.addEventListener('drop', ev => {
        ev.preventDefault(); liga(false);
        if (estado.processando) { aviso('Espere o processamento atual terminar.'); return; }
        const arquivos = [...(ev.dataTransfer?.files || [])];
        if (arquivos.length) receberArquivos(arquivos);
      });
    }
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
      const d = e.documentos.find(x => x.id === id);
      if (!await confirmar({ titulo: 'Remover este documento?', texto: `${d ? d.nome : 'O arquivo'} e os itens que só existem por causa dele saem do levantamento. Itens com outras fontes perdem apenas esta evidência.`, ok: 'Remover', perigo: true })) return;
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
    /* a pessoa sabe mais que o nome da pasta: a troca vale na hora, e um
       documento que entra no escopo volta para a fila de pendentes */
    async mudarDisciplina({ id, valor }) {
      const e = emp();
      const d = e.documentos.find(x => x.id === id);
      if (!d || !valor || valor === d.disciplina) return;
      const antes = d.disciplina ? nomeDisciplina(d.disciplina) : 'não identificada';
      d.disciplina = valor;
      d.disciplinaOrigem = 'manual';
      d.disciplinaConfianca = 'alta';
      d.disciplinaEvidencia = [...(d.disciplinaEvidencia || []).slice(0, 6), `ajustado à mão: ${antes} → ${nomeDisciplina(valor)}`];
      if (!d.processadoEm) {
        d.tipo = valor === 'memorial' ? 'memorial' : 'prancha';
        d.foraDoEscopo = !emEscopo(valor);
      }
      registrarHistorico(e, { texto: `${d.nome}: disciplina alterada de ${antes} para ${nomeDisciplina(valor)}`, tipo: 'documento' });
      await salvar();
      render();
      if (!d.processadoEm && emEscopo(valor)) aviso(`${d.nome} agora entra na leitura — use “Processar pendentes”.`);
    },
    /* o lado vale para a PRÓXIMA leitura: os locais que já existem não
       mudam de manual sozinhos — isso é a triagem de Locais decidir */
    async mudarLado({ id, valor }) {
      const e = emp();
      const d = e.documentos.find(x => x.id === id);
      if (!d || valor === (d.lado || '')) return;
      const nomeLado = v => v === 'comum' ? 'áreas comuns' : v === 'privativa' ? 'unidades privativas' : 'pelo cômodo';
      const antes = nomeLado(d.lado);
      d.lado = valor;
      d.ladoOrigem = 'manual';
      d.ladoConfianca = 'alta';
      d.ladoEvidencia = [...(d.ladoEvidencia || []).slice(0, 6), `ajustado à mão: ${antes} → ${nomeLado(valor)}`];
      registrarHistorico(e, { texto: `${d.nome}: lado alterado de ${antes} para ${nomeLado(valor)}`, tipo: 'documento' });
      await salvar();
      render();
      if (d.processadoEm) aviso(`Lado guardado. Vale para a próxima leitura deste documento; os locais já criados ficam como estão.`);
    },
    async lerMesmoAssim({ id }) {
      const e = emp();
      const d = e.documentos.find(x => x.id === id);
      if (!d) return;
      if (estado.processando) { aviso('Espere o processamento atual terminar.'); return; }
      d.lerMesmoAssim = true;
      d.foraDoEscopo = false;
      await processarDocumento(d);
      const aud = await auditarNoProcessamento(e);
      await salvar();
      render();
      aviso(`${d.nome} lido. ${aud.r.abertas} pendência(s) para revisão.`);
    },
    async processarTudo() {
      const e = emp();
      const fila = e.documentos.filter(x => !x.processadoEm && !x.foraDoEscopo);
      for (let i = 0; i < fila.length; i++) await processarDocumento(fila[i], { i, n: fila.length });
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

/* "Importar do Google Drive": login → Picker → download → o mesmo caminho do
   <input type="file">. A barra de progresso mostra o download; depois cada
   PDF é processado como se tivesse vindo do disco. */
async function receberDoDrive({ porLink = false } = {}) {
  if (estado.processando) { aviso('Espere o processamento atual terminar.'); return; }
  if (!driveConfigurado()) {
    aviso('Google Drive ainda não configurado: preencha CLIENT_ID e API_KEY em js/core/drive.js (passo a passo no LEIA-ME).');
    return;
  }
  /* o Picker não busca por link e não mostra a pasta que outra conta
     compartilhou fora da aba certa: colar o link resolve os dois casos */
  let link = '';
  if (porLink) {
    const r = await perguntar({
      titulo: 'Importar pelo link do Drive',
      texto: 'Cole o link da pasta (ou de um PDF) do Google Drive. A pasta é varrida inteira, subpastas incluídas.',
      campos: [{ id: 'link', rotulo: 'Link', placeholder: 'https://drive.google.com/drive/folders/…', ajuda: 'Precisa ser uma pasta ou arquivo que a sua conta Google consegue abrir.' }],
      ok: 'Importar',
    });
    if (!r || !r.link) return;
    if (!idDoLink(r.link)) { aviso('Não reconheci um link do Google Drive nesse texto.'); return; }
    link = r.link;
  }
  LOTE.i = 0; LOTE.n = 1;
  try {
    const r = await importarDoDrive((texto, pct) => {
      if (!estado.processando) { estado.processando = { texto, pct: 0 }; render(); }
      return atualizarProgresso(texto, pct);
    }, { link });
    estado.processando = null;
    if (r.cancelado) { render(); return; }
    if (r.pulados.length) {
      console.warn('[drive] arquivos não baixados:', r.pulados);
      aviso(`${r.pulados.length} arquivo(s) do Drive não puderam ser baixados — veja o console.`);
    }
    if (!r.arquivos.length) {
      render();
      const s = r.resumo || {};
      aviso(s.itens
        ? `Nenhum PDF: ${s.pastas} pasta(s) varrida(s), ${s.itens} arquivo(s) vistos, nenhum é PDF (ex.: ${(s.outros || []).slice(0, 3).join(', ') || 'tipos não-PDF'}). Detalhes no console.`
        : `Nenhum PDF: a pasta escolhida está vazia ou o Drive não deixou listá-la (${s.pastas || 0} pasta(s) varrida(s)). Detalhes no console.`);
      return;
    }
    aviso(`${r.arquivos.length} PDF(s) baixados do Drive${r.resumo && r.resumo.pastas ? ` (${r.resumo.pastas} pasta(s) varrida(s))` : ''}. Processando…`);
    await receberArquivos(r.arquivos);
  } catch (err) {
    estado.processando = null;
    console.error(err);
    render();
    aviso('Google Drive: ' + err.message);
  }
}

async function receberArquivos(arquivos) {
  const e = emp();
  const validos = arquivos.filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  for (const f of arquivos) if (!validos.includes(f)) aviso('Só PDF por enquanto: ' + f.name);
  let indice = 0;
  for (const f of validos) {
    const lote = { i: indice++, n: validos.length };
    const rev = /[-_ ]R(\d{2})\b/i.exec(f.name) || /(\d{2})Folha/i.exec(f.name);
    const meta = {
      id: novoId('doc'), nome: f.name, bytes: f.size, enviadoEm: new Date().toISOString(),
      revisao: rev ? 'R' + rev[1] : '', paginas: 0, tags: 0, locaisLidos: 0, processadoEm: null, anexo: null,
      /* as pastas de onde veio (Drive, ou pasta arrastada): primeira pista da disciplina */
      pasta: f.caminhoDrive || (f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(0, -1).join('/') + '/' : ''),
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
    await processarDocumento(meta, lote);
  }
  await salvar({ texto: `${validos.length} documento(s) enviado(s)`, tipo: 'documento' });
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
  /* todo ambiente fechado tem piso, paredes e teto; cerâmica tem rejunte. O
     que nenhum documento trouxe vira linha vazia com motivo, nunca some. */
  const ob = completarObrigatorias(e);
  if (ob.criadas || ob.removidas) {
    registrarHistorico(e, { tipo: 'auditoria', texto: `Linhas obrigatórias dos ambientes: ${ob.criadas} criada(s) vazia(s) para preencher, ${ob.removidas} suprida(s) por documento` });
  }
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

/** dataURL (data:application/pdf;base64,...) -> bytes, para reabrir no pdf.js. */
function dataUrlParaBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* A BARRA DE PROGRESSO.

   O bug do "2%": a versão anterior atualizava a largura da barra e o texto,
   mas NUNCA o número ao lado — ele ficava no valor que o render inicial
   escreveu (0.02 → "2%") até o fim, enquanto a barra andava. E a fase cara
   (consolidar: recortes + chamadas à IA) não reportava nada, então a barra
   parava em ~85% da página por minutos.

   Agora:
   - os três pedaços (texto, número, barra) têm id e são atualizados juntos;
   - `LOTE` guarda em que arquivo do lote estamos: o percentual mostrado é o
     do LOTE inteiro — (arquivosProntos + fraçãoDoAtual) / totalDeArquivos —
     e não recomeça do zero a cada PDF;
   - `consolidar` recebe um callback e reporta local a local;
   - a função devolve uma Promise que cede ao navegador de tempos em tempos,
     para a barra ser de fato pintada durante um trecho síncrono longo. */
const LOTE = { i: 0, n: 1 };
let ultimaCedida = 0;

function atualizarProgresso(texto, pctDoc) {
  const dentro = Math.min(1, Math.max(0, Number(pctDoc) || 0));
  const pct = Math.min(1, Math.max(0, (LOTE.i + dentro) / Math.max(1, LOTE.n)));
  const rotulo = LOTE.n > 1 ? `Arquivo ${LOTE.i + 1} de ${LOTE.n} · ${texto}` : texto;
  estado.processando = { texto: rotulo, pct };
  const barra = document.getElementById('progBarra');
  const t = document.getElementById('progTexto');
  const n = document.getElementById('progPct');
  const numero = Math.round(pct * 100) + '%';
  if (barra) barra.style.setProperty('--pct', String(pct));
  if (t) t.textContent = rotulo;
  if (n) n.textContent = numero;
  /* cede ao navegador no máximo a cada ~80 ms: o suficiente para pintar, sem
     custar tempo de processamento */
  const agora = performance.now();
  if (agora - ultimaCedida < 80) return undefined;
  ultimaCedida = agora;
  return new Promise(r => setTimeout(r, 0));
}

async function processarDocumento(meta, lote = null) {
  const e = emp();
  LOTE.i = lote ? lote.i : 0;
  LOTE.n = lote ? lote.n : 1;
  estado.processando = { texto: 'abrindo ' + meta.nome, pct: LOTE.i / LOTE.n };
  render();
  await atualizarProgresso('abrindo ' + meta.nome, 0);
  try {
    const blob = estado.pdfs.get(meta.id)?.blob || await store.lerArquivo(meta.id);
    let doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
    estado.pdfs.set(meta.id, { doc, blob });
    meta.paginas = doc.numPages;
    const pagina1 = await doc.getPage(1);
    if (!meta.tipo) {
      const vp = pagina1.getViewport({ scale: 1 });
      meta.tipo = Math.max(vp.width, vp.height) < 1200 ? 'memorial' : 'prancha';
    }
    /* Que documento é este? Pasta, nome e carimbo primeiro; a IA olha a
       primeira página só quando sobra dúvida. Estrutura, instalações e
       modificação de unidade ficam na lista sem ser lidas — a pessoa muda a
       disciplina ou manda ler mesmo assim. */
    if (!meta.disciplina) {
      await atualizarProgresso(`identificando a disciplina de ${meta.nome}`, 0.01);
      const vp = pagina1.getViewport({ scale: 1 });
      let carimbo = '';
      try {
        const tc = await pagina1.getTextContent();
        /* prancha: só o carimbo (o texto da folha inteira cita todas as
           disciplinas); memorial: a capa inteira, que é onde está o título */
        carimbo = meta.tipo === 'prancha' ? textoDoCarimbo(tc, vp) : tc.items.map(i => i.str).join(' ');
      } catch { /* sem camada de texto */ }
      const d = await identificarDisciplina({
        nome: meta.nome, caminho: meta.pasta || '', carimbo, tipo: meta.tipo, ia: iaLigada(),
        imagem: () => recorteBase64(pagina1, [0, 0, vp.width, vp.height], { largura: 1600, qualidade: 0.6 }),
      });
      meta.disciplina = d.disciplina;
      meta.disciplinaConfianca = d.confianca;
      meta.disciplinaOrigem = d.origem;
      meta.disciplinaEvidencia = d.evidencia.slice(0, 12);
      if (d.titulo) meta.titulo = d.titulo;
      /* o lado (área comum × unidade) que o documento declara: o motor usa
         como desempate, o memorial como grupo inicial */
      if (!meta.ladoOrigem || meta.ladoOrigem !== 'manual') {
        meta.lado = d.lado || '';
        meta.ladoConfianca = d.ladoConfianca || 'baixa';
        meta.ladoOrigem = d.ladoOrigem || '';
        meta.ladoEvidencia = (d.ladoEvidencia || []).slice(0, 8);
      }
      /* a IA viu a folha: o que ela diz do tipo vale mais que o tamanho da página */
      if (d.tipoDocumento === 'prancha' || d.tipoDocumento === 'memorial') meta.tipo = d.tipoDocumento;
      else if (meta.disciplina === 'memorial') meta.tipo = 'memorial';
    }
    if (!emEscopo(meta.disciplina) && !meta.lerMesmoAssim) {
      meta.foraDoEscopo = true;
      registrarHistorico(e, {
        texto: `${meta.nome} identificado como ${nomeDisciplina(meta.disciplina)} (${meta.disciplinaOrigem === 'ia' ? 'pela IA' : 'pelo nome e pelo carimbo'}) — fora do escopo do levantamento, não foi lido`,
        tipo: 'processamento',
      });
      estado.processando = null; await salvar(); render();
      return;
    }
    meta.foraDoEscopo = false;
    if (meta.tipo === 'memorial') {
      /* memorial escaneado (sem camada de texto) quase não tem texto
         extraível: manda pro OCR antes de tentar ler. Só faz sentido com o
         BFF ligado, e uma falha aqui não trava o processamento — o
         documento segue como leu, mesmo sem texto. */
      if (iaLigada() && await precisaDeOcr(doc)) {
        atualizarProgresso('memorial parece escaneado — rodando OCR antes de ler', 0.02);
        try {
          const dataUrlOcr = await ocrPdf(blob, meta.nome);
          doc = await openPdf(dataUrlParaBytes(dataUrlOcr));
          estado.pdfs.set(meta.id, { doc, blob });
          meta.paginas = doc.numPages;
          meta.ocrAplicado = true;
        } catch (err) {
          anotarFalha(err, 'OCR do memorial');
        }
      }
      /* 1) o que o próprio memorial diz, frase por frase — entra como itens
            de origem 'memorial', com a página e o trecho guardados */
      const r = await analisarMemorial(doc, meta, locaisVivos(e),
        (texto, pct) => atualizarProgresso(texto, pct * 0.7), { areasComuns: temAreasComuns(e) ? true : 'auto' });
      /* o memorial dividiu "ÁREAS COMUNS" / "ÁREAS PRIVATIVAS": então é um
         condomínio, seja qual for o tipo do cadastro — liga as áreas comuns */
      if (r.areasComunsAtivadas && !temAreasComuns(e)) e.areasComunsForcado = true;
      /* os títulos do memorial que não existiam nas pranchas viram locais —
         com o lado certo do condomínio (área comum ou unidade privativa) */
      e.locais = e.locais || [];
      for (const l of r.locaisNovos) e.locais.push(l);
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
      const novos = r.locaisNovos.length;
      const comuns = r.locaisNovos.filter(l => l.areaComum).length;
      const dosLocais = `${r.secoes.length} seção(ões) de local: ${novos} local(is) novo(s)`
        + (temAreasComuns(e) && novos ? ` (${comuns} de área comum, ${novos - comuns} de unidade)` : '')
        + (r.casados ? `, ${r.casados} local(is) das pranchas receberam itens` : '');
      registrarHistorico(e, { texto: `${meta.nome} (memorial) lido: ${r.especificacoes.length} trechos · ${dosLocais} · ${comoFoi}`, tipo: 'processamento' });
      estado.processando = null; await salvar(); render();
      if (f.motor === 'multimodal_gemini') {
        aviso(`Memorial lido: ${dosLocais}. Fusão pela IA: ${f.enriquecidas} especificação(ões) enriquecida(s)`
          + `${f.conflitos ? `, ${f.conflitos} conflito(s) para revisar` : ''}.`);
      } else {
        aviso(`Memorial lido: ${dosLocais}.`);
      }
      return;
    }
    e.tagsPorDoc = e.tagsPorDoc || {};
    e.tagsPorDoc[meta.id] = [];
    /* dentro de cada página: a análise vetorial é rápida; a consolidação é
       onde o tempo vai quando a IA está ligada (um recorte + uma chamada por
       local). O peso reflete isso para a barra andar no ritmo real. */
    const pesoAnalise = iaLigada() ? 0.2 : 0.7;
    const paginas = doc.numPages;
    for (let p = 1; p <= paginas; p++) {
      const folha = await analisarFolha(doc, p, meta, (texto, pct) =>
        atualizarProgresso(`${meta.nome} — página ${p} de ${paginas}: ${texto}`, (p - 1 + pct * pesoAnalise) / paginas));
      await consolidar(e, folha, meta, (texto, pct) =>
        atualizarProgresso(`${meta.nome} — página ${p} de ${paginas}: ${texto}`, (p - 1 + pesoAnalise + pct * (1 - pesoAnalise)) / paginas));
      meta.tags += folha.tags.length;
      meta.locaisLidos = locaisVivos(e).length;
      e.tagsPorDoc[meta.id].push(...folha.tags.map(t => ({ x: t.x, y: t.y, forma: t.forma, numero: t.numero, pagina: p })));
    }
    await atualizarProgresso(`${meta.nome} — concluído`, 1);
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

    return `<div class="cabeca"><div>
      <button class="btn discreto pequeno voltar" data-rota="config"><i class="ico-voltar" aria-hidden="true"></i>Configurações</button>
      <h1>${esc(def.plural)}</h1>
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
      const rot = rotuloNivel(e, nivel);
      const r = await perguntar({ titulo: `Adicionar ${rot.toLowerCase()}`, ok: 'Adicionar',
        campos: [{ id: 'nome', rotulo: 'Nome', placeholder: `Ex.: ${rot} 01` }, { id: 'descricao', rotulo: 'Descrição (opcional)' }] });
      if (!r || !r.nome) return;
      e.estrutura[nivel].push({ id: novoId('niv'), nome: r.nome, descricao: r.descricao || '', origem: 'manual' });
      await salvar({ texto: `${rot} criado: ${r.nome}`, tipo: 'estrutura' });
      render();
    },
    async editarNivel({ nivel, id }) {
      const e = emp();
      const it = e.estrutura[nivel].find(x => x.id === id); if (!it) return;
      const r = await perguntar({ titulo: `Editar ${rotuloNivel(e, nivel).toLowerCase()}`,
        campos: [{ id: 'nome', rotulo: 'Nome', valor: it.nome }, { id: 'descricao', rotulo: 'Descrição (opcional)', valor: it.descricao || '' }] });
      if (!r) return;
      const antes = it.nome;
      it.nome = r.nome || antes;
      it.descricao = r.descricao || '';
      await salvar({ texto: `${rotuloNivel(e, nivel)} editado`, tipo: 'estrutura', antes, depois: it.nome });
      render();
    },
    async removerNivel({ nivel, id }) {
      const e = emp();
      const it = e.estrutura[nivel].find(x => x.id === id);
      if (!await confirmar({ titulo: `Remover “${it ? it.nome : ''}”?`, texto: 'Os locais vinculados a este item ficam sem o vínculo.', ok: 'Remover', perigo: true })) return;
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
      const e = emp();
      const pavs = [...new Set([...(e.estrutura.pavimento || []).map(p => p.nome), ...locaisVivos(e).map(a => a.pavimento)].filter(Boolean))];
      const r = await perguntar({ titulo: 'Adicionar local', texto: 'Escreva o nome exatamente como está na prancha — é assim que as tags e o memorial vão encontrá-lo.', ok: 'Adicionar',
        campos: [{ id: 'nome', rotulo: 'Nome do local', placeholder: 'Ex.: SALA DE ESTAR' },
          ...(pavs.length ? [{ id: 'pavimento', rotulo: rotuloNivel(e, 'pavimento'), tipo: 'select', opcoes: pavs }] : [])] });
      if (!r || !r.nome) return;
      e.locais = e.locais || [];
      const novo = criarLocal(r.nome, '', r.pavimento || '');
      const tips = e.estrutura.tipologia || [];
      Object.assign(novo, {
        tipologia: tips.length && !tips.some(t => t.origem === 'prancha') ? tips[0].nome : '',
        areaComum: classificarArea(r.nome) === 'comum',
        origem: 'manual', confianca: 'alta', status: 'confirmado',
      });
      const nome = r.nome;
      e.locais.push(novo);
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
      if (!await confirmar({ titulo: `Excluir o local “${a.nome}”?`, texto: 'As especificações dentro dele saem do levantamento. A exclusão fica registrada no histórico.', ok: 'Excluir', perigo: true })) return;
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
      const r = await perguntar({ titulo: 'Renomear local', campos: [{ id: 'nome', rotulo: 'Nome do local', valor: a.nome }] });
      if (!r) return;
      const antes = a.nome; a.nome = r.nome || antes;
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
  const itensOrd = semVaziosRedundantes(ordenarAchados(itens));
  itens.length = 0; itens.push(...itensOrd);
  /* o rótulo lido na planta ganha do título do memorial: a prancha com
     posição primeiro, depois qualquer prancha, o memorial por último */
  const evsLocal = a.evidencias || [];
  const ev = evsLocal.find(x => x.coordenadas && !ehMemorial(x)) || evsLocal.find(x => idDoc(x) && !ehMemorial(x)) || evsLocal[0];
  const cats = CATEGORIAS.filter(c => itens.some(i => i.categoria === c));
  const esq = itens.filter(i => i.categoria === 'Esquadrias');
  const pend = itens.filter(i => i.status === 'revisar' || i.status === 'conflito' || i.confianca === 'baixa');
  const docs = [...new Set(itens.flatMap(i => (i.evidencias || []).map(nomeDoc)).concat((a.evidencias || []).map(nomeDoc)))].filter(Boolean);
  const doMemorial = itens.filter(i => i.origemLeitura === 'memorial'
    || (i.evidencias || []).some(ehMemorial));
  const faltando = ESSENCIAIS_LOCAL.filter(c => !itens.some(i => i.categoria === c));
  const semCat = itens.filter(i => !i.categoria);
  const grupos = [...cats, ...(semCat.length ? [''] : [])];
  const confirmados = itens.length ? Math.round(itens.filter(x => x.status === 'confirmado' || x.status === 'corrigido').length / itens.length * 100) : 0;

  /* Uma tabela só, agrupada por categoria: era o que "Produtos deste local"
     e "Quadro de acabamentos" mostravam em dobro. A linha de grupo carrega a
     cor da categoria; o item sem categoria ganha o seletor ali mesmo. */
  const linhaItem = i => `<tr>
    <td><b>${i.produto ? esc(i.produto) : (i.codigoOrigem ? `<span class="num">${esc(i.codigoOrigem)}</span>` : '<span class="vazio-celula"></span>')}</b>
      ${!i.categoria ? `<div class="sub"><span class="cat" data-editavel="categoria" data-id="${i.id}">definir categoria</span></div>` : ''}</td>
    <td style="max-width:200px"><span data-editavel="sistema" data-id="${i.id}">${celula(i.sistema)}</span></td>
    <td style="max-width:360px"><span data-editavel="descricao" data-id="${i.id}">${celula(descricaoSemProduto(i))}</span></td>
    <td><span data-editavel="marca" data-id="${i.id}">${celula(fornecedoresCelula(i))}</span></td>
    <td>${origemDoItem(i)}</td>
    <td><div class="selos">${seloConfianca(i.confianca)}${i.status === 'conflito' || i.status === 'revisar' ? seloStatus(i.status) : ''}</div></td>
    <td style="white-space:nowrap;text-align:right"><button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Evidências</button></td>
  </tr>`;
  const linhas = grupos.map(c => {
    const do_ = itens.filter(i => (i.categoria || '') === c);
    return `<tr class="linha-grupo"><td colspan="7"><span class="rotulo-cat${c ? '' : ' apagado'}"><i style="background:var(--${corCat(c)})"></i>${c ? esc(c) : 'Sem categoria'}<b>${do_.length}</b></span></td></tr>`
      + do_.map(linhaItem).join('');
  });

  return `
    <div class="cabeca">
      <div>
        <button class="btn discreto pequeno voltar" data-rota="locais"><i class="ico-voltar" aria-hidden="true"></i>Locais</button>
        <h1>${esc(a.nome)}</h1>
        <p class="desc">${[temAreasComuns(e) ? (a.areaComum ? 'Área comum (Manual do Condomínio)' : 'Unidade privativa (Manual do Proprietário)') : '', a.pavimento, a.tipologia, a.area, a.nomeMemorial && a.nomeMemorial !== a.nome ? `no memorial: ${a.nomeMemorial}` : ''].filter(Boolean).map(esc).join(' · ') || 'sem pavimento ou tipologia definidos'}</p>
      </div>
      <div class="acoes">
        ${temAreasComuns(e) ? `<button class="btn" data-acao="alternarAreaComum" data-id="${a.id}">${a.areaComum ? 'É área comum (MC)' : 'É unidade privativa (MP)'}</button>` : ''}
        <button class="btn" data-acao="renomearAmbiente" data-id="${a.id}">Renomear</button>
        <button class="btn primario" data-acao="confirmarAmbiente" data-id="${a.id}">Confirmar</button>
        <button class="btn discreto" data-acao="excluirAmbiente" data-id="${a.id}">Excluir</button>
      </div>
    </div>
    ${a.confianca === 'baixa' ? '<div class="aviso-faixa"><span class="ico-aviso" aria-hidden="true">!</span><div><b>Local proposto.</b> O rótulo foi lido na prancha sem área cotada ao lado. Confirme antes de exportar.</div></div>' : ''}

    <div class="placar">
      <div><dt>Itens</dt><dd>${itens.length}</dd></div>
      <div><dt>Categorias</dt><dd>${cats.length}<small>de ${CATEGORIAS.length}</small></dd></div>
      <div><dt>Esquadrias</dt><dd>${esq.length}</dd></div>
      <div class="${pend.length ? 'aviso' : ''}"><dt>Pendentes</dt><dd>${pend.length}</dd></div>
      <div><dt>Confirmados</dt><dd>${confirmados}<small>%</small></dd></div>
    </div>

    <div class="cartao"><header><h2>Acabamentos</h2>
      <span class="atalhos" aria-label="Atalhos de teclado"><kbd>↑</kbd><kbd>↓</kbd> linhas · <kbd>Enter</kbd> inspetor · <kbd>Esc</kbd> fecha</span>
      <div class="acoes">
        <button class="btn pequeno" data-acao="adicionarItem" data-amb="${a.id}">Adicionar item</button>
        <button class="btn pequeno" data-acao="copiarPlanilhaLocal" data-amb="${a.id}">Copiar planilha</button></div></header>
      ${itens.length ? tabela([{ nome: 'Produto' }, { nome: 'Sistema' }, { nome: 'Descrição' }, { nome: 'Marca / fornecedor' }, { nome: 'Origem' }, { nome: 'Confiança' }, { nome: '' }], linhas)
        : `<div class="vazio"><h3>Nenhum acabamento vinculado</h3><p>Nenhuma tag, linha de tabela ou trecho de memorial deste projeto apontou para este local.</p></div>`}
      ${faltando.length ? `<div class="faltando">
        <span class="rotulo">Sem leitura para</span>
        ${faltando.map(c => `<span class="chip-cat apagado"><i style="background:var(--${corCat(c)})"></i>${esc(c)}</span>`).join('')}
        <span class="ajuda">Nenhuma tag, hachura, legenda ou trecho de memorial apontou ${faltando.length > 1 ? 'estas categorias' : 'esta categoria'} para este local.</span>
        <button class="btn pequeno" data-rota="pendencias">Revisar</button>
      </div>` : ''}
    </div>${listaSistemas()}

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
      ${niveisDe(e).some(n => !(e.estrutura[n.nivel] || []).length) ? `<p class="ajuda-campo" style="margin-top:10px">Os níveis vazios são cadastrados em <button class="btn discreto pequeno link" data-rota="config">Configurações › Estrutura</button>.</p>` : ''}
    </div></div>` : ''}

    ${esq.length ? `<div class="cartao"><header><h2>Esquadrias deste local</h2>
      <div class="acoes"><span class="selo neutro">${esq.length}</span></div></header>
      ${tabela([{ nome: 'Código', num: 1 }, { nome: 'Dimensão' }, { nome: 'Peitoril' }, { nome: 'Qtd.', num: 1 }, { nome: 'Descrição' }, { nome: 'Situação' }, { nome: '' }],
        [esq.map(i => `<tr>
          <td class="num"><b>${celula(i.codigoOrigem)}</b></td>
          <td>${celula(i.dimensao)}</td><td>${celula(i.peitoril)}</td><td class="num">${celula(i.quantidade)}</td>
          <td style="max-width:420px">${celula(i.descricao.replace(/^[^—]*—\s*[^—]*—\s*/, ''))}</td>
          <td>${seloStatus(i.status)}</td>
          <td style="white-space:nowrap;text-align:right"><button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Evidências</button>
            <button class="btn pequeno discreto" data-acao="verNaPrancha" data-id="${i.id}">Ver na prancha</button></td></tr>`).join('')])}
    </div>` : ''}

    ${pend.length ? `<div class="cartao"><header><h2>Pendências deste local</h2>
      <div class="acoes"><span class="selo atencao">${pend.length}</span>
      <button class="btn pequeno" data-rota="pendencias">Abrir revisão em massa</button></div></header>
      ${tabela([{ nome: 'Categoria' }, { nome: 'Descrição' }, { nome: 'Motivo' }, { nome: 'Confiança' }, { nome: '' }],
        [pend.map(i => `<tr>
          <td>${esc(i.categoria || '—')}</td>
          <td style="max-width:380px">${celula(i.descricao)}</td>
          <td><div class="selos">${(i.motivos || []).map(m => `<span class="selo atencao">${esc(MOTIVOS_PENDENCIA[m] || m)}</span>`).join('') || seloStatus(i.status)}</div></td>
          <td>${seloConfianca(i.confianca)}</td>
          <td style="white-space:nowrap;text-align:right"><button class="btn pequeno" data-acao="verEvidencia" data-id="${i.id}">Evidências</button>
            <button class="btn pequeno" data-acao="confirmarAchado" data-id="${i.id}">Confirmar</button></td></tr>`).join('')])}
    </div>` : ''}

    ${doMemorial.length ? `<div class="cartao"><header><h2>O que o memorial diz sobre este local</h2>
      <div class="acoes"><span class="selo neutro">${doMemorial.length}</span></div></header>
      <div class="corpo"><ul class="lista-limpa">${doMemorial.map(i => {
        const f = (i.evidencias || []).find(ehMemorial) || {};
        return `<li><span class="pilula">p.${esc(paginaDoc(f))}</span><div><b>${esc(i.produto || i.categoria || '')}</b>
          <div style="color:var(--ink-2);font-size:12.5px">${esc((f.texto || i.descricao || '').slice(0, 220))}</div></div></li>`;
      }).join('')}</ul></div>
    </div>` : ''}

    <div class="grade-dupla">
      <div class="cartao"><header><h2>Onde o local foi lido</h2></header>
        <div class="corpo">${ev && ev.coordenadas ? `<div class="recorte">
          <canvas data-mapa-ambiente='${esc(JSON.stringify({ documentoId: idDoc(ev), pagina: paginaDoc(ev), caixa: ev.regiao || janelaCentrada(ev.coordenadas, 400, 250), realces: [{ caixa: ev.coordenadas, cor: "#d13b2a" }] }))}'></canvas>
          <div class="legenda-recorte">${esc(refDoc(ev))}${ehMemorial(ev) ? ' · título de seção do memorial' : (ev.regiao ? ' · região do local (Nível 2)' : '')}</div></div>
          <button class="btn pequeno" data-acao="verNaPranchaLocal" data-id="${a.id}" style="margin-top:10px">${ehMemorial(ev) ? 'Ver no memorial' : 'Ver na prancha'}</button>`
          : ev && ev.documentoOrigem && ev.documentoOrigem.docId && !ehMemorial(ev)
            ? `<p style="color:var(--ink-3);font-size:13px">Rótulo lido por imagem em ${esc(refDoc(ev))}, sem a posição gravada — a prancha abre inteira.</p>
               <button class="btn pequeno" data-acao="verNaPranchaLocal" data-id="${a.id}" style="margin-top:10px">Ver na prancha</button>`
          : ev && ev.documentoOrigem && ev.documentoOrigem.docId
            ? `<p style="color:var(--ink-3);font-size:13px">Local nomeado pelo memorial (${esc(refDoc(ev))}). Quando uma planta com este ambiente for lida, o rótulo passa a apontar para ela.</p>`
          : '<p style="color:var(--ink-3);font-size:13px">Local criado manualmente.</p>'}
        </div></div>
      <div class="cartao"><header><h2>Fontes documentais</h2></header><div class="corpo">
        <ul class="lista-limpa">${(a.evidencias || []).map(x => `<li><span class="pilula">p.${esc(paginaDoc(x))}</span><div class="quebra">${esc(nomeDoc(x))}<div style="color:var(--ink-3);font-size:12px">${esc(x.texto || '')}</div></div></li>`).join('') || '<li style="color:var(--ink-3)">Sem evidência documental.</li>'}</ul>
        ${docs.length ? `<p class="ajuda-campo quebra" style="margin-top:10px">Documentos que alimentam este local: ${docs.map(d => esc(d)).join(' · ')}.</p>` : ''}
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

/* Nesta prancha o mesmo desenho vira duas leituras: a tag geométrica perto do
   ambiente (que aqui só marca "isto é Piso/Parede/Teto", sem legenda com
   material) e a linha correta no MEMORIAL DE ACABAMENTOS por nome de
   ambiente. Sem a legenda para traduzir, a leitura da tag chega vazia — e
   como a informação de verdade já está na outra linha, a vazia não soma
   nada, só duplica a categoria à toa. Ela só fica se for a ÚNICA linha da
   categoria: aí é a lacuna real que precisa aparecer para revisão. */
function semVaziosRedundantes(itens) {
  const porCategoria = new Map();
  for (const i of itens) {
    const k = i.categoria || '';
    if (!porCategoria.has(k)) porCategoria.set(k, []);
    porCategoria.get(k).push(i);
  }
  const informativo = i => !!(i.produto || i.descricao || i.marca || i.modelo);
  const fora = new Set();
  for (const grupo of porCategoria.values()) {
    if (grupo.length < 2 || !grupo.some(informativo)) continue;
    for (const i of grupo) if (!informativo(i)) fora.add(i.id);
  }
  return itens.filter(i => !fora.has(i.id));
}

/* "Fornecedores": marca e fornecedor juntos — são campos independentes (um
   não preenche o outro), mas a planilha enxuta do local mostra os dois numa
   coluna só. */
function fornecedoresCelula(i) {
  return [i.marca, i.fornecedor].filter(Boolean).join(' — ');
}

/* A coluna Descrição não repete o nome do produto: "Porcelanato" já está
   implícito pela categoria/contexto da linha. Se a descrição da prancha
   começa com o próprio nome do produto ("PORCELANATO A DEFINIR" para o
   produto "Porcelanato"), essa repetição é cortada — sem inventar nada,
   só sem repetir o que já apareceria ao lado. */
function descricaoSemProduto(i) {
  const d = (i.descricao || '').trim();
  const p = (i.produto || '').trim();
  if (!d || !p) return d;
  const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s:,;–—-]*', 'i');
  return d.replace(re, '').trim() || d;
}

const ESSENCIAIS_LOCAL = ['Piso', 'Paredes', 'Teto'];

/* De onde o produto veio, em uma etiqueta: a tag desenhada, a linha da
   legenda da prancha, a tabela ou o trecho do memorial. */
function origemDoItem(i) {
  if (i.forma) return marcaForma(i.forma, i.numero);
  const f = (i.evidencias || [])[0] || {};
  const o = i.origemLeitura || '';
  if (o === 'memorial' || ehMemorial(f)) return `<span class="pilula">memorial p.${esc(paginaDoc(f) || '—')}</span>`;
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
  let fechado = false;
  const fim = async (gravar) => {
    /* Esc cancela e tira o campo da página; a remoção dispara blur, que
       chamaria isto de novo sobre um campo já removido */
    if (fechado) return; fechado = true;
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

/* Igual à de cima, mas em vez de editar UM item, edita todos os itens que
   compartilham a mesma descrição normalizada — é o que faz "Produtos" ser
   uma edição global: mudar o nome ou a categoria aqui propaga para cada
   Local que usa este produto, numa tacada só. */
async function editarCampoGrupo(span) {
  const { editavelGrupo: campo, chave } = span.dataset;
  const e = emp();
  const alvos = itens(e).filter(a => normalizar(a.descricao) === chave);
  if (!alvos.length) return;
  const antes = alvos[0][campo] || '';
  let inp;
  if (campo === 'categoria') {
    inp = document.createElement('select');
    inp.innerHTML = '<option value=""></option>' + CATEGORIAS.map(c => `<option ${c === antes ? 'selected' : ''}>${esc(c)}</option>`).join('');
  } else {
    inp = document.createElement('input');
    inp.value = antes;
  }
  inp.style.width = '100%'; inp.style.minWidth = '150px';
  span.replaceWith(inp); inp.focus(); if (inp.select) inp.select();
  let fechado = false;
  const fim = async (gravar) => {
    /* Esc cancela e tira o campo da página; a remoção dispara blur, que
       chamaria isto de novo sobre um campo já removido */
    if (fechado) return; fechado = true;
    const novo = (inp.value || '').trim();
    inp.replaceWith(span);
    if (!gravar || novo === antes) { render(); return; }
    for (const a of alvos) {
      a[campo] = novo;
      a.status = 'corrigido';
      if (a.confianca === 'baixa') a.confianca = 'media';
    }
    if (campo === 'categoria') { aprenderRegra(antes, { categoria: novo }); await gravarGlossario(); }
    await salvar({
      texto: `${campo === 'categoria' ? 'Categoria' : 'Nome'} do produto “${antes}” alterado para “${novo}” em ${alvos.length} local(is)`,
      tipo: 'edicao', antes, depois: novo,
    });
    render(); aviso(`Atualizado em ${alvos.length} item(ns).`);
  };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') fim(true); if (ev.key === 'Escape') fim(false); });
  inp.addEventListener('blur', () => fim(true));
  if (campo === 'categoria') inp.addEventListener('change', () => fim(true));
}

/* ================= PRODUTOS ================= */
/* Edição global: mudar o nome ou a categoria de um produto aqui atualiza
   todos os Locais que o usam, de uma vez — é o que faz esta tela ser o
   lugar certo para corrigir um material que a leitura classificou errado,
   em vez de corrigir local por local. */
const produtos = {
  render(e) {
    if (!e) return '';
    const mapa = new Map();
    for (const a of itens(e)) {
      if (!a.descricao) continue;
      const k = normalizar(a.descricao);
      if (!mapa.has(k)) mapa.set(k, { chave: k, descricao: a.descricao, categoria: a.categoria, marca: a.marca, fornecedor: a.fornecedor, nosLocais: new Set(), itens: [] });
      const m = mapa.get(k);
      m.nosLocais.add(a.localNome || '—'); m.itens.push(a);
      if (!m.marca && a.marca) m.marca = a.marca;
      if (!m.fornecedor && a.fornecedor) m.fornecedor = a.fornecedor;
    }
    const linhas = [...mapa.values()].sort((a, b) => b.nosLocais.size - a.nosLocais.size).map(p => `<tr>
      <td><span class="cat" style="color:var(--${corCat(p.categoria)})" data-editavel-grupo="categoria" data-chave="${esc(p.chave)}">${esc(p.categoria || '—')}</span></td>
      <td style="max-width:480px"><b data-editavel-grupo="descricao" data-chave="${esc(p.chave)}">${esc(p.descricao)}</b></td>
      <td>${celula(p.marca)}</td><td>${celula(p.fornecedor)}</td>
      <td class="num">${p.nosLocais.size}</td>
      <td style="max-width:300px;color:var(--ink-2);font-size:12.5px">${esc([...p.nosLocais].slice(0, 6).join(', '))}${p.nosLocais.size > 6 ? '…' : ''}</td></tr>`).join('');
    return `<div class="cabeca"><div><h1>Produtos</h1><p class="desc">Cada material distinto encontrado, com os locais em que aparece. Clique no nome ou na categoria para editar — a mudança vale para todos os locais que usam este produto. Marca e fornecedor são campos independentes — um não preenche o outro.</p></div>
      <div class="acoes"><button class="btn" data-rota="fornecedores">Marcas e fornecedores${e.marcas.length ? ` <span class="pilula">${e.marcas.length}</span>` : ''}</button></div></div>
      <div class="cartao">${tabela([{ nome: 'Categoria' }, { nome: 'Produto' }, { nome: 'Marca' }, { nome: 'Fornecedor' }, { nome: 'Locais', num: 1 }, { nome: 'Onde' }], linhas ? [linhas] : [],
        { tituloVazio: 'Nenhum produto identificado', textoVazio: 'Processe as pranchas para extrair os materiais.', acaoVazio: vazioDocs })}</div>`;
  },
  depois(e, alvo) {
    for (const span of alvo.querySelectorAll('[data-editavel-grupo]')) span.addEventListener('click', () => editarCampoGrupo(span));
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
    return `<div class="cabeca"><div>
      <button class="btn discreto pequeno voltar" data-rota="produtos"><i class="ico-voltar" aria-hidden="true"></i>Produtos</button>
      <h1>Marcas e fornecedores</h1>
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
      const r = await perguntar({ titulo: 'Adicionar marca', ok: 'Adicionar',
        campos: [{ id: 'nome', rotulo: 'Marca', placeholder: 'Ex.: Portobello' }, { id: 'fornecedor', rotulo: 'Fornecedor (opcional)', placeholder: 'quem entrega' }] });
      if (!r || !r.nome) return;
      emp().marcas.push({ id: novoId('mar'), nome: r.nome, fornecedor: r.fornecedor || '' });
      await salvar({ texto: `Marca cadastrada: ${r.nome}`, tipo: 'marca' });
      render();
    },
    async removerMarca({ id }) {
      const e = emp(); e.marcas = e.marcas.filter(m => m.id !== id);
      await salvar({ texto: 'Marca removida', tipo: 'marca' }); render();
    },
    async editarFornecedorMarca({ id }) {
      const e = emp(); const m = e.marcas.find(x => x.id === id); if (!m) return;
      const r = await perguntar({ titulo: `Fornecedor de ${m.nome}`, texto: 'Vale para todos os itens desta marca.', campos: [{ id: 'fornecedor', rotulo: 'Fornecedor', valor: m.fornecedor || '' }] });
      if (!r) return;
      m.fornecedor = r.fornecedor;
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
    /* a pessoa escolheu o local: as dúvidas de vínculo espacial deixam de existir */
    a.motivos = (a.motivos || []).filter(m => !['tag_sem_ambiente', 'termo_sem_ambiente', 'sem_local', 'lista_aberta',
      'vinculo_por_proximidade', 'vinculo_por_chamada', 'baixa_confianca', 'ambiente_proposto'].includes(m));
    if (a.confianca === 'baixa') a.confianca = 'media';
    orfaosSel.delete(id);
    await salvar({ texto: `Item atribuído ao local “${alvo.nome}” na triagem`, tipo: 'revisao', alvo: a.id, depois: alvo.nome });
    const gavetaAberta = document.getElementById('gaveta')?.classList.contains('aberta');
    render(); aviso(`Atribuído a ${alvo.nome}.`);
    if (gavetaAberta) abrirGaveta(a);
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
    if (!await confirmar({ titulo: `Excluir ${n} item(ns) da fila de triagem?`, texto: 'A exclusão fica registrada no histórico.', ok: 'Excluir', perigo: true })) return;
    for (const id of [...orfaosSel]) { const a = acharAchado(id); if (a) a.status = 'excluido'; }
    orfaosSel.clear();
    await salvar({ texto: `${n} item(ns) excluídos na triagem`, tipo: 'revisao' });
    render(); aviso(`${n} item(ns) excluídos.`);
  },
};

/* Locais é o módulo central do levantamento: tudo o que pertence a um local
   — categorias, acabamentos, esquadrias e evidências — fica dentro dele.
   Sem busca: a interação é escolher o local na grade e abrir a ficha. */
const locais = {
  render(e) {
    if (!e) return '';
    if (estado.param) return fichaAmbiente(e, estado.param);

    if (estado.filtros.mostrarTriagem) {
      return `<div class="cabeca"><div>
          <button class="btn discreto pequeno" data-acao="fecharTriagem" style="margin-bottom:6px"><i class="ico-voltar" aria-hidden="true"></i>Locais</button>
          <h1>Fila de triagem</h1>
          <p class="desc">Especificações lidas dos documentos que nenhuma geometria, rótulo ou termo de legenda amarrou a um local. É aqui que você diz à análise onde cada uma mora.</p></div></div>
        ${cartaoOrfaos(e, { sempre: true })}`;
    }

    const vivos = locaisVivos(e);
    const f = estado.filtros;
    const pavsTodos = [...new Set(vivos.map(a => a.pavimento || ''))];
    const temPend = a => itensDo(e, a.id).some(i => i.status === 'revisar' || i.status === 'conflito' || i.confianca === 'baixa');
    const lista = vivos
      .filter(a => !f.busca || normalizar(a.nome).includes(normalizar(f.busca)))
      .filter(a => !f.pav || (a.pavimento || '') === f.pav)
      .filter(a => !f.soPend || temPend(a) || a.confianca === 'baixa');
    const grade = l => `<div class="grade-cartoes">${l.map(cartaoDoLocal(e)).join('')}</div>`;
    const filtrando = !!(f.busca || f.pav || f.soPend);
    const secoes = secoesDeLocais(e, lista);

    return `<div class="cabeca"><div><h1>Locais</h1>
      <p class="desc">Selecione um local para abrir a ficha completa: acabamentos, esquadrias, pendências e evidências.</p></div>
      <div class="acoes">
        <button class="btn" data-acao="novoAmbiente">Adicionar local</button>
        ${vivos.length ? `<button class="btn primario" data-acao="baixarTudo"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES.baixar}</svg>Baixar XLSX</button>` : ''}
      </div></div>

      ${semLocal(e).length ? `<div class="aviso-faixa"><span class="ico-aviso" aria-hidden="true">!</span><div><b>${semLocal(e).length} especificação(ões) sem local.</b> Nenhuma geometria, rótulo ou termo de legenda as amarrou a um local — a fila de triagem espera a sua decisão.
        <button class="btn pequeno" data-acao="abrirTriagem" style="margin-left:6px">Abrir fila de triagem</button></div></div>` : ''}

      ${vivos.length > 1 ? `<div class="filtros">
        <input type="search" id="buscaLoc" placeholder="Buscar local" value="${esc(f.busca || '')}">
        ${pavsTodos.length > 1 ? `<select id="filtroPavLoc"><option value="">Todos os ${esc(rotuloNivel(e, 'pavimento', true).toLowerCase())}</option>${pavsTodos.map(p => `<option value="${esc(p)}" ${f.pav === p ? 'selected' : ''}>${esc(p || 'Sem pavimento')}</option>`).join('')}</select>` : ''}
        <label class="marca-tudo"><input type="checkbox" id="soPendLoc" ${f.soPend ? 'checked' : ''}> Só com pendências</label>
        <span class="contagem">${lista.length} de ${vivos.length}</span>
        ${filtrando ? '<button class="btn pequeno discreto" data-acao="limparFiltrosLocais">Limpar</button>' : ''}
      </div>` : ''}

      ${!vivos.length ? `<div class="cartao"><div class="vazio"><h3>Nenhum local identificado</h3>
          <p>Processe uma prancha de arquitetura para que os locais sejam lidos dos rótulos.</p>${vazioDocs}</div></div>`
        : !lista.length ? `<div class="cartao"><div class="vazio"><h3>Nenhum local com esse filtro</h3><p>Ajuste a busca ou limpe os filtros.</p></div></div>`
        : secoes.length > 1
          ? secoes.map(s => `<section class="secao-pav">
              <h2 class="titulo-secao">${esc(s.titulo)} <span>${s.itens.length}</span></h2>
              ${grade(s.itens)}
            </section>`).join('')
          : grade(lista)}`;
  },
  depois(e, alvo) {
    if (estado.param) { ambientes.depois?.(e, alvo); return; }
    if (estado.filtros.mostrarTriagem) {
      ligarOrfaos(alvo);
      for (const span of alvo.querySelectorAll('[data-editavel]')) span.addEventListener('click', () => editarCampo(span));
      return;
    }
    const busca = alvo.querySelector('#buscaLoc');
    if (busca) busca.addEventListener('input', ev => {
      estado.filtros.busca = ev.target.value; clearTimeout(estado._t);
      estado._t = setTimeout(() => { render(); const b = document.getElementById('buscaLoc'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 220);
    });
    alvo.querySelector('#filtroPavLoc')?.addEventListener('change', ev => { estado.filtros.pav = ev.target.value; render(); });
    alvo.querySelector('#soPendLoc')?.addEventListener('change', ev => { estado.filtros.soPend = ev.target.checked; render(); });
    for (const card of alvo.querySelectorAll('.cartao-selecao[data-acao]')) {
      card.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); } });
    }
  },
  acoes: {
    ...ACOES_ORFAOS,
    abrirTriagem() { estado.filtros.mostrarTriagem = true; render(); },
    fecharTriagem() { estado.filtros.mostrarTriagem = false; render(); },
    limparFiltrosLocais() { estado.filtros.busca = ''; estado.filtros.pav = ''; estado.filtros.soPend = false; render(); },
    async baixarTudo() {
      const e = emp();
      await store.baixar(arquivoSeguro(e.nome) + '-produtos-e-fornecedores.xlsx', exportarXlsx(e));
      await salvar({ texto: 'Planilha XLSX exportada', tipo: 'exportacao' });
      aviso('Planilha gerada.');
    },
  },
};

/* Como a lista de locais se divide. Num condomínio, primeiro o que é de
   todos (Manual do Condomínio), depois cada tipologia de unidade (Manual do
   Proprietário) — TIPO 1, TIPO 2, TIPO PNE 4 — e por fim o que o memorial
   descreveu para todas as unidades sem dizer de qual tipo. Sem áreas comuns
   (uma casa, um apartamento), a divisão de sempre: por pavimento. */
const ordemNatural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
function secoesDeLocais(e, lista) {
  const porPav = () => {
    const pavs = [...new Set(lista.map(a => a.pavimento || ''))];
    return pavs.map(p => ({ titulo: p || 'Sem pavimento', itens: lista.filter(a => (a.pavimento || '') === p) }));
  };
  if (!temAreasComuns(e)) return porPav();
  const comuns = lista.filter(a => a.areaComum);
  const privativas = lista.filter(a => !a.areaComum);
  const tips = [...new Set(privativas.map(a => a.tipologia || ''))].filter(Boolean).sort(ordemNatural);
  if (!comuns.length && !tips.length) return porPav();
  const porPavDentro = l => [...l].sort((a, b) => ordemNatural(a.pavimento || '', b.pavimento || '') || ordemNatural(a.nome, b.nome));
  const out = [];
  if (comuns.length) out.push({ titulo: 'Áreas comuns · Manual do Condomínio', itens: porPavDentro(comuns) });
  for (const t of tips) out.push({ titulo: `Unidades privativas · ${t}`, itens: porPavDentro(privativas.filter(a => (a.tipologia || '') === t)) });
  const semTip = privativas.filter(a => !a.tipologia);
  if (semTip.length) out.push({ titulo: tips.length ? 'Unidades privativas · todas as tipologias (memorial)' : 'Unidades privativas · Manual do Proprietário', itens: porPavDentro(semTip) });
  return out;
}

/* O cartão do local diz em três linhas o que interessa antes de abrir: o
   nome e a área, quanto já foi lido, e — o mais útil — se Piso, Paredes e
   Teto já têm leitura. Os três pontos coloridos são a prévia da ficha. */
const cartaoDoLocal = e => a => {
  const its = itensDo(e, a.id);
  const cats = CATEGORIAS.filter(c => its.some(i => i.categoria === c)).length;
  const pend = its.filter(i => i.status === 'revisar' || i.status === 'conflito' || i.confianca === 'baixa').length;
  const essenciais = ESSENCIAIS_LOCAL.map(c => ({ c, tem: its.some(i => i.categoria === c) }));
  const plural = (n, s, p) => `<b>${n}</b> ${n === 1 ? s : p}`;
  return `<article class="cartao-selecao local${a.confianca === 'baixa' ? ' proposto' : ''}" data-acao="abrirAmbiente" data-id="${a.id}" role="button" tabindex="0">
    <div class="topo">
      <div style="min-width:0"><h3>${esc(a.nome)}</h3>
        <div class="meta">${[(a.pavimentos && a.pavimentos.length > 1) ? a.pavimentos.join(', ') : a.pavimento, a.area || (a.origem === 'memorial' ? 'lido do memorial' : a.confianca === 'baixa' ? 'rótulo sem área cotada' : 'sem área cotada')].filter(Boolean).map(esc).join(' · ')}</div></div>
      ${seloStatus(a.status)}
    </div>
    <div class="local-resumo">
      <span>${plural(its.length, 'item', 'itens')}</span>
      <span>${plural(cats, 'categoria', 'categorias')}</span>
      ${pend ? `<span class="tom-atencao">${plural(pend, 'pendência', 'pendências')}</span>` : ''}
    </div>
    <div class="essenciais" aria-label="Piso, paredes e teto">${essenciais.map(x => `<span class="ess${x.tem ? ' tem' : ''}" style="--cor:var(--${corCat(x.c)})" title="${esc(x.c)}: ${x.tem ? 'com leitura' : 'sem leitura'}"><i></i>${esc(x.c)}</span>`).join('')}</div>
  </article>`;
};

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
    return `<div class="cabeca"><div><h1>Revisão</h1>
      <p class="desc">O que a leitura não conseguiu decidir sozinha, agrupado por problema e com as fontes à vista. O que é objetivo e comprovado pelo documento a análise já corrigiu; o que depende de interpretação espera aqui. Nada é preenchido por suposição.</p></div>
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
        <div class="campo"><label for="audManual">Manual (PDF)</label><input type="file" id="audManual" accept="application/pdf"></div>
        <div class="campo"><label for="audPlan">Planilha entregue (XLSX ou CSV)</label><input type="file" id="audPlan" accept=".xlsx,.csv,.txt"></div>
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
  if (acao === 'excluido' && !await confirmar({ titulo: `Excluir ${alvos.length} item(ns)?`, texto: 'A exclusão fica registrada no histórico.', ok: 'Excluir', perigo: true })) return;

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
    return `<div class="cabeca"><div><h1>Exportar</h1>
      <p class="desc">A Planilha de Produtos e Fornecedores no layout de importação (linha 1 com os códigos, linha 5 com os títulos, dados a partir da linha 6), mais o cofre do Obsidian e o JSON do projeto. Célula sem evidência sai vazia, nunca com “N/A”.</p></div>
      <div class="acoes">
        <button class="btn" data-acao="copiarAba">Copiar aba</button>
        <button class="btn" data-acao="baixarCsvAba">CSV da aba</button>
        <button class="btn" data-acao="baixarJson">JSON</button>
        <button class="btn" data-acao="abrirObsidian" title="Gera um cofre de notas Markdown com o levantamento inteiro, ligado por [[links]]">Obsidian</button>
        <button class="btn primario" data-acao="baixarXlsx"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES.baixar}</svg>Baixar XLSX</button>
      </div></div>
      ${pend.length ? `<div class="aviso-faixa"><span class="ico-aviso" aria-hidden="true">!</span><div><b>${pend.length} item(ns) pendente(s).</b> Eles entram na exportação com o status e a confiança que têm hoje — a aba Pendências lista cada um. <button class="btn pequeno" data-rota="pendencias" style="margin-left:6px">Revisar agora</button></div></div>` : ''}
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
    abrirObsidian() { modalObsidian(); },
    fecharModal() { fecharModal(); },
    async exportarObsidian(_d, el) { await exportarObsidianInteligente(el); },
    async baixarCofre() {
      const e = emp();
      const notas = notasDoEmpreendimento(e);
      await store.baixar(arquivoSeguro(e.nome) + '-obsidian.zip', zipDoCofre(e), 'application/zip');
      await salvar({ texto: `Cofre Obsidian exportado (${notas.length} notas)`, tipo: 'exportacao' });
      aviso(`${notas.length} nota(s) no .zip. Descompacte dentro da pasta do seu cofre.`);
    },
    async testarObsidian(_d, el) {
      lerCfgObsidian();
      const s = el.closest('.modal-caixa')?.querySelector('#obsStatus');
      if (s) s.textContent = 'testando…';
      const r = await testarObsidian();
      if (s) s.innerHTML = r.ok
        ? `<span class="selo bom">conectado${r.versao ? ' · Obsidian ' + esc(r.versao) : ''}</span>`
        : `<span class="selo atencao">falhou</span> <span style="color:var(--ink-3)">${esc(r.erro)}</span>`;
    },
    async enviarObsidian(_d, el) {
      lerCfgObsidian();
      const e = emp();
      const s = el.closest('.modal-caixa')?.querySelector('#obsStatus');
      if (!OBSIDIAN.chave) { if (s) s.innerHTML = '<span class="selo atencao">cole a chave da API do plugin</span>'; return; }
      const r = await enviarParaObsidian(e, (texto) => { if (s) s.textContent = texto; });
      if (s) s.innerHTML = r.falhas.length
        ? `<span class="selo atencao">${r.enviadas} de ${r.total} gravadas</span> <span style="color:var(--ink-3)">${esc(r.falhas[0])}</span>`
        : `<span class="selo bom">${r.enviadas} nota(s) gravadas em ${esc(r.pasta)}</span>`;
      if (r.enviadas) await salvar({ texto: `Cofre Obsidian atualizado (${r.enviadas} notas)`, tipo: 'exportacao' });
      if (r.falhas.length) console.warn('[obsidian] falhas:', r.falhas);
      else aviso(`${r.enviadas} nota(s) gravadas no Obsidian.`);
    },
  },
};
const arquivoSeguro = s => normalizar(s).replace(/\s+/g, '-').slice(0, 48) || 'empreendimento';

/* ================= OBSIDIAN ================= */
/* Dois caminhos: o .zip (funciona sempre) e a gravação direta pelo plugin
   Local REST API, quando o Obsidian está aberto nesta máquina. */
function lerCfgObsidian() {
  const m = document.getElementById('modal');
  if (!m) return;
  configurarObsidian({
    base: m.querySelector('#obsBase')?.value || OBSIDIAN.base,
    chave: (m.querySelector('#obsChave')?.value || '').trim(),
    pasta: m.querySelector('#obsPasta')?.value || OBSIDIAN.pasta,
  });
}

function modalObsidian() {
  const e = emp(); if (!e) return;
  const notas = notasDoEmpreendimento(e);
  abrirModal(`
    <header><h2>Obsidian</h2>
      <p>O levantamento vira um cofre de notas Markdown: uma nota por local, uma por documento, o índice do empreendimento, as pendências como tarefas — tudo ligado por [[links]]. Célula sem evidência continua vazia.</p></header>
    <div class="corpo">
      <p style="font-size:13px;color:var(--ink-2)">${notas.length} nota(s) em <code>${esc(OBSIDIAN.pasta)}/${esc(e.nome)}/</code>. Um clique: se o Obsidian estiver aberto nesta máquina com o plugin configurado abaixo, as notas são gravadas direto no cofre; se não, o <b>.zip</b> é baixado para você descompactar dentro do cofre.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <button class="btn primario" data-acao="exportarObsidian">Exportar para o Obsidian</button>
        <button class="btn" data-acao="baixarCofre">Só baixar o .zip</button>
        <span id="obsStatus" style="font-size:12.5px"></span>
      </div>
      <h3 style="margin:22px 0 6px;font-size:14px">Gravação direta (opcional)</h3>
      <p style="font-size:13px;color:var(--ink-2)">Uma vez só: no Obsidian, Configurações → Plugins da comunidade → instale <b>Local REST API</b>; nas opções do plugin ligue <b>Enable HTTP server</b> e copie a <b>API key</b> para cá. A chave fica guardada neste navegador.</p>
      <div class="grade2" style="margin-top:10px">
        <div class="campo"><label for="obsBase">Endereço do plugin</label>
          <input id="obsBase" value="${esc(OBSIDIAN.base)}" placeholder="http://127.0.0.1:27123" style="font-family:var(--mono);font-size:12.5px"></div>
        <div class="campo"><label for="obsPasta">Pasta no cofre</label>
          <input id="obsPasta" value="${esc(OBSIDIAN.pasta)}" placeholder="Prancharia"></div>
      </div>
      <div class="campo" style="margin-top:10px"><label for="obsChave">API key do plugin</label>
        <input id="obsChave" type="password" value="${esc(OBSIDIAN.chave)}" placeholder="cole aqui a chave mostrada nas configurações do plugin" autocomplete="off"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <button class="btn pequeno" data-acao="testarObsidian">Testar conexão</button>
        <button class="btn pequeno" data-acao="enviarObsidian">Gravar direto agora</button>
      </div>
    </div>
    <footer><button class="btn discreto" data-acao="fecharModal">Fechar</button></footer>`, async (m) => {
    /* já tem chave guardada: confere a conexão ao abrir, para a pessoa saber
       de antemão qual caminho o botão principal vai tomar */
    if (!OBSIDIAN.chave) { m.querySelector('#obsStatus').innerHTML = '<span class="selo neutro">sem plugin configurado → vai baixar o .zip</span>'; return; }
    const s = m.querySelector('#obsStatus');
    s.textContent = 'verificando o Obsidian…';
    const r = await testarObsidian();
    if (!m.isConnected) return;
    s.innerHTML = r.ok
      ? `<span class="selo bom">Obsidian conectado${r.versao ? ' · ' + esc(r.versao) : ''} → vai gravar direto</span>`
      : `<span class="selo neutro">Obsidian não respondeu → vai baixar o .zip</span>`;
  });
}

/** O botão principal: grava direto se der; senão, baixa o .zip. Nunca deixa a
    pessoa sem o cofre. */
async function exportarObsidianInteligente(el) {
  lerCfgObsidian();
  const e = emp(); if (!e) return;
  const s = el.closest('.modal-caixa')?.querySelector('#obsStatus');
  const dizer = (html) => { if (s) s.innerHTML = html; };
  if (OBSIDIAN.chave) {
    dizer('verificando o Obsidian…');
    const t = await testarObsidian();
    if (t.ok) {
      const r = await enviarParaObsidian(e, (texto) => dizer(esc(texto)));
      if (r.enviadas && !r.falhas.length) {
        dizer(`<span class="selo bom">${r.enviadas} nota(s) gravadas em ${esc(r.pasta)}</span>`);
        await salvar({ texto: `Cofre Obsidian atualizado (${r.enviadas} notas)`, tipo: 'exportacao' });
        aviso(`${r.enviadas} nota(s) gravadas no Obsidian.`);
        return;
      }
      console.warn('[obsidian] falhas:', r.falhas);
      dizer(`<span class="selo atencao">${r.enviadas} de ${r.total} gravadas — ${esc(r.falhas[0] || 'falha')}</span> baixando o .zip como garantia…`);
    } else {
      dizer(`<span class="selo neutro">Obsidian não respondeu (${esc(t.erro)})</span> baixando o .zip…`);
    }
  } else {
    dizer('<span class="selo neutro">sem plugin configurado</span> baixando o .zip…');
  }
  const notas = notasDoEmpreendimento(e);
  await store.baixar(arquivoSeguro(e.nome) + '-obsidian.zip', zipDoCofre(e), 'application/zip');
  await salvar({ texto: `Cofre Obsidian exportado (${notas.length} notas)`, tipo: 'exportacao' });
  dizer((s?.innerHTML || '') + ` <span class="selo bom">.zip com ${notas.length} nota(s) baixado</span>`);
  aviso(`${notas.length} nota(s) no .zip. Descompacte dentro da pasta do seu cofre.`);
}

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
    if (!a) return `<div class="cabeca"><div><button class="btn discreto pequeno" data-rota="locais"><i class="ico-voltar" aria-hidden="true"></i>Locais</button><h1>Item não encontrado</h1></div></div>`;
    const provas = provasDe(e, a);
    const perguntas = rastreio(e, a);
    const cadeia = fluxo(e, a);
    const fontes = (a.evidencias || []).filter(Boolean);
    return `<div class="cabeca">
      <div>
        <button class="btn discreto pequeno" data-acao="voltarDoRastro" data-amb="${esc(a.localId || '')}" style="margin-bottom:6px"><i class="ico-voltar" aria-hidden="true"></i>Voltar</button>
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

/* ================= CONFIGURAÇÕES ================= */
const config = {
  render(e) {
    if (!e) return '';
    const t = tipoDe(e);
    const todosNiveis = [...new Set(TIPOS.flatMap(x => x.niveis.map(n => n.nivel)))]
      .sort((a, b) => ORDEM_NIVEIS.indexOf(a) - ORDEM_NIVEIS.indexOf(b));
    const ativos = new Set(niveisDe(e).map(n => n.nivel));
    /* De propósito, só duas coisas moram aqui: a estrutura do tipo (não tem
       outro lugar para viver — cadastro geral é editado no cartão do
       empreendimento, na tela de Empreendimentos) e o motor de leitura. */
    return `<div class="cabeca"><div><h1>Configurações</h1><p class="desc">Estrutura do tipo de empreendimento, motor de leitura e onde os dados moram.</p></div>
      <div class="acoes"><button class="btn" data-acao="editarEmp" data-id="${e.id}">Editar cadastro</button></div></div>

      <div class="cartao"><header><h2>Estrutura do empreendimento</h2>
        <div class="acoes"><span class="selo neutro">${esc(t.nome)}</span></div></header>
        <div class="corpo">
          <p style="font-size:13px;color:var(--ink-2);max-width:70ch">${esc(t.resumo)} Os níveis abaixo vêm do tipo escolhido — ligue ou desligue conforme este projeto específico, e cadastre os itens de cada um.</p>
          <div class="cadeia-tipo" style="margin:12px 0 16px">${cadeiaDe(e).map((x, i) => `${i ? '<i>›</i>' : ''}<span>${esc(x)}</span>`).join('')}</div>
          <div class="lista-niveis">
            ${todosNiveis.map(n => {
              const ativo = ativos.has(n); const qtd = (e.estrutura[n] || []).length;
              return `<div class="nivel-linha${ativo ? '' : ' apagado'}">
                <div><b>${esc(rotuloNivel(e, n, true))}</b><div class="meta">${ativo ? (qtd ? `${qtd} cadastrado(s)` : 'nenhum cadastrado ainda') : 'desligado neste projeto'}</div></div>
                <div class="acoes">
                  ${ativo ? `<button class="btn pequeno" data-rota="estrutura" data-param="${n}">Gerenciar</button>` : ''}
                  <button class="btn pequeno discreto" data-acao="alternarNivel" data-nivel="${n}">${ativo ? 'Desligar' : 'Ligar'}</button>
                </div></div>`;
            }).join('')}
          </div>
          <div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn pequeno ${temAreasComuns(e) ? 'primario' : ''}" data-acao="alternarAreasComuns">Áreas comuns (aba MC)</button>
            <span style="font-size:12.5px;color:var(--ink-3)">${temAreasComuns(e) ? 'Locais podem ser marcados como MC; a planilha sai com as duas abas.' : 'Tudo vai para MP — sem aba de áreas comuns.'}</span>
          </div>
        </div></div>

      ${cartaoMotor()}

      ${cartaoDados()}`;
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
    async alternarNivel({ nivel }) {
      const e = emp();
      const ativo = temNivel(e, nivel);
      if (ativo) {
        if ((e.estrutura[nivel] || []).length && !await confirmar({ titulo: `Desligar ${rotuloNivel(e, nivel, true).toLowerCase()}?`, texto: 'Os itens cadastrados ficam guardados, mas o nível some das fichas e da planilha.', ok: 'Desligar' })) return;
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
    editarEmp({ id }) { formEmpreendimento(estado.emps.find(x => x.id === id)); },
    async salvarEmpEdicao(d, el) { await empreendimentos.acoes.salvarEmpEdicao(d, el); },
    fecharModal() { fecharModal(); },
    async religarNuvem() { await empreendimentos.acoes.religarNuvem(); },
    async baixarBackup() {
      aviso('Gerando o backup no servidor…');
      try {
        const r = await fetch(store.NUVEM.base + '/api/backup');
        if (!r.ok) throw new Error(`servidor respondeu ${r.status}`);
        const texto = await r.text();
        const data = new Date().toISOString().slice(0, 10);
        await store.baixar(`prancharia-backup-${data}.json`, texto, 'application/json');
        aviso('Backup baixado. Guarde o arquivo: ele traz todos os empreendimentos, o glossário e as empresas.');
      } catch (err) { aviso('Não consegui gerar o backup: ' + err.message); }
    },
  },
};

/* Onde os dados moram. É a resposta à pergunta que mais confunde quem abre o
   Prancharia em outro navegador: "cadê meus empreendimentos?" */
function cartaoDados() {
  const nuvem = store.naNuvem();
  const efemero = nuvem && store.NUVEM.persistente === false;
  const s = store.NUVEM.saude || {};
  return `<div class="cartao"><header><h2>Dados</h2>
    <div class="acoes"><span class="selo ${nuvem ? (efemero ? 'atencao' : 'bom') : 'neutro'}">${nuvem ? (efemero ? 'servidor sem banco persistente' : 'servidor compartilhado') : 'só neste navegador'}</span></div></header>
    <div class="corpo">
      ${nuvem
        ? `<p style="font-size:13px;color:var(--ink-2);max-width:74ch">Os empreendimentos e as pranchas estão gravados em <code>${esc(store.NUVEM.base)}</code>${s.banco ? ` (${esc(s.banco.motor || 'banco')}, ${s.banco.projetos ?? '?'} projeto(s))` : ''}. Quem abrir o Prancharia em outro navegador vê a mesma lista.${efemero ? ' <b>Atenção:</b> o disco desse servidor é efêmero — configure o Turso (ver LEIA-ME) antes de confiar nele.' : ''}</p>
           <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
             <button class="btn" data-acao="baixarBackup"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONES.baixar}</svg>Baixar backup do servidor</button>
             <span style="font-size:12.5px;color:var(--ink-3)">Um JSON com todos os empreendimentos, empresas e o glossário — sem os PDFs.</span>
           </div>`
        : `<p style="font-size:13px;color:var(--ink-2);max-width:74ch">Este navegador é o único lugar onde os dados estão. Para compartilhar com a equipe, suba o servidor de <code>/server</code> (ou aponte para o hospedado em Motor de leitura › Endereço do servidor): o Prancharia detecta sozinho e envia o que está aqui.</p>
           <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
             <button class="btn" data-acao="religarNuvem">Tentar conectar agora</button>
             <button class="btn" data-rota="planilhas">Exportar JSON deste empreendimento</button>
           </div>`}
    </div></div>`;
}

/* ================= MOTOR DE LEITURA ================= */
/* A leitura vetorial não precisa de nada. A multimodal precisa do BFF no ar —
   e é ele que guarda a chave da API, que nunca chega ao navegador. */
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
      ${IA.desligadoPorFalha ? `<div class="aviso-faixa" style="margin-top:14px"><span class="ico-aviso" aria-hidden="true">!</span><div><b>O motor multimodal se desligou nesta sessão</b> depois de ${IA.maxFalhas} falhas seguidas. O processamento seguiu no motor vetorial — nada foi perdido. Religue no botão acima depois de resolver o servidor.</div></div>` : ''}
      ${IA.ultimoErro ? `<p style="margin-top:12px;font-size:12.5px;color:var(--ink-3)">Último erro: <code>${esc(IA.ultimoErro.mensagem)}</code> — ${new Date(IA.ultimoErro.quando).toLocaleString('pt-BR')}.</p>` : ''}
      ${IA.chamadas ? `<p style="margin-top:6px;font-size:12.5px;color:var(--ink-3)">${IA.chamadas} chamada(s) ao servidor nesta sessão.</p>` : ''}
      <p style="margin-top:12px;font-size:12.5px;color:var(--ink-3)">A página publicada roda em sandbox sem rede externa: lá o sistema fica sempre na leitura vetorial. Para usar a IA, rode o projeto local com o servidor de <code>/server</code>.</p>
    </div></div>`;
}

/* Servidor de teste no Render free tier hiberna após inatividade: o primeiro
   pedido depois de um tempo parado acorda a instância, e isso pode levar
   20-30s. Sem aviso nenhum nesse meio-tempo a tela parece travada — e sem
   dizer que é normal, "fora do ar" parece um erro definitivo quando é só a
   instância acordando. */
const ACOES_MOTOR = {
  async usarMotor({ motor }) {
    configurarIA({ provedor: motor });
    if (motor === 'multimodal_gemini') {
      aviso('Testando o servidor… se ele estiver hibernando (plano gratuito), pode levar até 30s para acordar.');
      const s = await saudeDaIA();
      estado.saudeIA = s || false;
      render();
      aviso(s ? `IA multimodal ligada — servidor respondendo (${s.modelo || 'modelo não declarado'}).`
        : 'IA multimodal ligada, mas o servidor não respondeu em 30s. Cada prancha vai cair na leitura vetorial até ele subir — clique em "Testar servidor" de novo daqui a pouco.');
      return;
    }
    render(); aviso('Leitura vetorial. Nenhuma chamada de rede.');
  },
  async testarIA() {
    aviso('Testando o servidor… se ele estiver hibernando (plano gratuito), pode levar até 30s para acordar.');
    const s = await saudeDaIA();
    estado.saudeIA = s || false;
    render();
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(IA.bff);
    aviso(s
      ? `Servidor no ar: ${s.modelo || 'modelo não declarado'}${s.chaveConfigurada ? '' : ' — sem GEMINI_API_KEY, vai responder 503'}.`
      : local
        ? `Sem resposta em ${esc(IA.bff)}. Suba o servidor: cd server && npm start.`
        : `Sem resposta em ${esc(IA.bff)} depois de 30s. Se ele estava hibernando, clique em "Testar servidor" de novo — o primeiro pedido já deve tê-lo acordado.`);
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

/* Revisar é um gesto humano sobre o item: confirmado por uma pessoa, ele
   sobe para confiança alta e perde as pendências. O estado da leitura fica
   guardado para a revisão poder ser desfeita sem perder o que o motor viu. */
function revisar(a, marcar) {
  if (marcar) {
    if (a.status !== 'confirmado') {
      a.leitura = { confianca: a.confianca, motivos: [...(a.motivos || [])], status: a.status };
    }
    a.status = 'confirmado';
    a.confianca = 'alta';
    a.motivos = [];
    a.revisadoEm = new Date().toISOString();
  } else {
    const l = a.leitura || {};
    a.status = 'revisar';
    a.confianca = l.confianca || a.confianca;
    a.motivos = l.motivos ? [...l.motivos] : (a.motivos || []);
    a.revisadoEm = null;
  }
}

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
    revisar(a, true);
    await salvar({ texto: `Item confirmado: ${a.produto || a.descricao || a.codigoOrigem || ''}`, tipo: 'revisao', alvo: a.id });
    fecharGaveta(); render(); aviso('Item confirmado: confiança alta.');
  },
  async marcarRevisar({ id }) {
    const a = acharAchado(id); if (!a) return;
    revisar(a, false);
    await salvar({ texto: `Item marcado para revisar`, tipo: 'revisao', alvo: a.id });
    fecharGaveta(); render();
  },
  /* o check "Revisado" do inspetor: marca e desmarca sem fechar a gaveta */
  async alternarRevisado({ id }) {
    const a = acharAchado(id); if (!a) return;
    const marcar = a.status !== 'confirmado';
    revisar(a, marcar);
    await salvar({ texto: marcar ? `Item revisado: ${a.produto || a.descricao || a.codigoOrigem || ''}` : 'Revisão desfeita: item volta ao estado da leitura', tipo: 'revisao', alvo: a.id });
    render();
    abrirGaveta(a);
  },
  async excluirAchado({ id }) {
    const a = acharAchado(id); if (!a) return;
    a.status = 'excluido';
    await salvar({ texto: `Item excluído: ${a.descricao || ''}`, tipo: 'revisao', alvo: a.id });
    fecharGaveta(); render(); aviso('Item excluído.');
  },
  async editarAchado({ id }) {
    const a = acharAchado(id); if (!a) return;
    const r = await perguntar({ titulo: 'Editar item', texto: `${a.localNome || 'sem local'}${a.categoria ? ' · ' + a.categoria : ''}. Toda alteração fica no histórico; categoria, produto e sistema viram regra do glossário.`,
      extra: listaSistemas(),
      campos: [
        { id: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS, valor: a.categoria || '' },
        { id: 'produto', rotulo: 'Nome do produto/serviço', valor: a.produto || '' },
        { id: 'sistema', rotulo: 'Sistema construtivo', valor: a.sistema || '', lista: 'listaSistemas' },
        { id: 'descricao', rotulo: 'Descrição / modelo / linha', tipo: 'textarea', valor: a.descricao || '', linhas: 2 },
        { id: 'marca', rotulo: 'Marca', valor: a.marca || '' },
        { id: 'fornecedor', rotulo: 'Fornecedor', valor: a.fornecedor || '' },
      ] });
    if (!r) return;
    const mudados = ['categoria', 'produto', 'sistema', 'descricao', 'marca', 'fornecedor'].filter(k => (r[k] || '') !== (a[k] || ''));
    if (!mudados.length) { abrirGaveta(a); return; }
    const antes = mudados.map(k => `${ROTULO_CAMPO[k] || k}: ${a[k] || '—'}`).join(' · ');
    for (const k of mudados) a[k] = r[k];
    a.status = 'corrigido';
    if (a.confianca === 'baixa') a.confianca = 'media';
    if (r.sistema) a.motivos = (a.motivos || []).filter(m => m !== 'sem_sistema');
    let extra = '';
    if (mudados.some(k => ['categoria', 'produto', 'sistema'].includes(k)) && a.descricao) {
      aprenderRegra(a.descricao, { categoria: a.categoria, produto: a.produto, sistema: a.sistema });
      await gravarGlossario();
      extra = ' · regra gravada no glossário';
    }
    await salvar({ texto: `Item editado (${mudados.map(k => ROTULO_CAMPO[k] || k).join(', ')})${extra}`, tipo: 'edicao', antes, depois: mudados.map(k => `${ROTULO_CAMPO[k] || k}: ${a[k] || '—'}`).join(' · '), alvo: a.id });
    render(); abrirGaveta(a);
    aviso('Alteração registrada' + (extra ? ' e aprendida para os próximos empreendimentos.' : '.'));
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
    const r = await perguntar({ titulo: `Adicionar item em ${a.nome}`, texto: 'Entrada manual: o item nasce confirmado, com a evidência “entrada manual”.', ok: 'Adicionar',
      extra: listaSistemas(),
      campos: [
        { id: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS, vazio: false, valor: 'Piso' },
        { id: 'produto', rotulo: 'Nome do produto/serviço', placeholder: 'Ex.: Porcelanato' },
        { id: 'descricao', rotulo: 'Descrição / modelo / linha', tipo: 'textarea', linhas: 2, placeholder: 'Ex.: Porcelanato Flakes SBE NAT 120x120' },
        { id: 'sistema', rotulo: 'Sistema construtivo (opcional)', lista: 'listaSistemas' },
        { id: 'marca', rotulo: 'Marca (opcional)' },
      ] });
    if (!r) return;
    const cat = r.categoria;
    const desc = r.descricao || r.produto;
    if (!CATEGORIAS.includes(cat)) { aviso('Categoria fora do vocabulário permitido.'); return; }
    if (!desc) { aviso('Descreva o item.'); return; }
    const esp = criarEspecificacao({
      categoria: cat, descricao: desc, produto: r.produto || desc, sistema: r.sistema || '', marca: r.marca || '',
      localId: a.id, localNome: a.nome, pavimento: a.pavimento, tipologia: a.tipologia || '',
      origemLeitura: 'manual', confianca: 'alta', status: 'confirmado',
    });
    esp.evidencias.push(criarEvidencia({
      tipo: 'manual',
      documentoOrigem: { docId: 'manual', nomeDoc: 'entrada manual', pagina: '' },
      texto: desc,
      cadeia: [a.nome, 'entrada manual', desc, cat],
      proveniencia: { motor_ia: 'manual', metodo: 'entrada_manual', confianca: 'alta' },
    }));
    a.especificacoes = a.especificacoes || [];
    a.especificacoes.push(esp);
    sincronizar(e);
    await salvar({ texto: `Item adicionado manualmente em ${a.nome}`, tipo: 'edicao' });
    render();
  },
  /* A planilha copiável do local: Local, Categoria, Sistema, Descrição,
     Fornecedores e Evidências — exatamente as colunas da tela, prontas para
     colar no Google Sheets ou Excel (Evidências vai como texto: documento e
     página, já que célula de planilha não tem botão). */
  copiarPlanilhaLocal({ amb }) {
    const e = emp(); const a = acharAmbiente(amb); if (!a) return;
    const its = semVaziosRedundantes(ordenarAchados(itensDo(e, amb)));
    const linhas = [['Local', 'Categoria', 'Produto', 'Sistema', 'Descrição', 'Fornecedores', 'Evidências']];
    for (const i of its) linhas.push([a.nome, i.categoria || '', i.produto || '', i.sistema || '', descricaoSemProduto(i), fornecedoresCelula(i), refsDe(i) || '']);
    copiarTsv(linhas, `Planilha de ${a.nome}`);
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
};

// Locais absorveu Ambientes, Acabamentos e Esquadrias: as ações das três
// precisam responder quando a rota é 'locais'.
locais.acoes = Object.assign({}, ambientes.acoes, esquadrias.acoes, acabamentos.acoes, locais.acoes);

for (const v of [empreendimentos, documentos, estrutura, locais, ambientes, esquadrias, acabamentos, produtos, fornecedores, glossario, pendenciasView, planilhas, rastro, config]) {
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


export const VIEWS = {
  empreendimentos, documentos, estrutura, locais, ambientes, esquadrias,
  acabamentos, produtos, fornecedores, glossario, pendencias: pendenciasView,
  planilhas, rastro, config,
};
