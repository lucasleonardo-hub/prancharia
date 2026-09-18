/* Montagem das abas no layout da Planilha de Produtos e Fornecedores:
   linha 1 com os códigos de importação, linha 5 com os títulos e os dados a
   partir da linha 6.

   Tudo aqui lê a árvore: `emp.locais[].especificacoes[]` e, junto,
   `emp.especificacoesSemLocal[]` — o item que ainda não tem local não
   desaparece da planilha, sai com a coluna Local vazia.

   Célula sem respaldo no documento sai vazia. Nunca "N/A". */

import { gerarXlsx, gerarCsv } from './xlsx.js';
import { CONFIANCA, STATUS, MOTIVOS_PENDENCIA, todasEspecificacoes } from './model.js';
import { LAYOUT, COLUNAS_COPIA, CATEGORIAS } from './vocab.js';
import { temAreasComuns } from './tipos.js';

const vivo = a => a && a.status !== 'excluido';
const rot = (m, k) => (m[k] ? m[k].rotulo : (k || ''));
const ORDEM = Object.fromEntries(CATEGORIAS.map((c, i) => [c, i]));

/* ---------- leitura da árvore ---------- */

/** Locais vivos do empreendimento. */
export function locaisDe(emp) {
  return (emp.locais || []).filter(vivo);
}

/** Especificações vivas, com e sem local. */
export function especificacoesDe(emp, { comSemLocal = true } = {}) {
  const dentro = locaisDe(emp).flatMap(l => (l.especificacoes || []).filter(vivo));
  if (!comSemLocal) return dentro;
  return dentro.concat((emp.especificacoesSemLocal || []).filter(vivo));
}

/** O local de uma especificação, quando ela tem um. */
function localDe(emp, esp) {
  if (!esp.localId) return null;
  return (emp.locais || []).find(l => l.id === esp.localId) || null;
}

const nomeDoLocal = esp => esp.localNome || '';

export function ordenarEspecificacoes(lista) {
  return [...lista].sort((a, b) =>
    (nomeDoLocal(a) || 'zzz').localeCompare(nomeDoLocal(b) || 'zzz') ||
    (ORDEM[a.categoria] ?? 99) - (ORDEM[b.categoria] ?? 99) ||
    (a.produto || '').localeCompare(b.produto || '') ||
    (a.descricao || '').localeCompare(b.descricao || ''));
}
/* As views ainda chamam pelo nome antigo; é a mesma lista de objetos. */
export const ordenarAchados = ordenarEspecificacoes;

/* ---------- dados de fornecedor ---------- */

function fornecedorDe(emp, esp) {
  const m = emp.marcas.find(x => x.nome && esp.marca && x.nome.toLowerCase() === esp.marca.toLowerCase());
  const f = emp.fornecedores.find(x => m && x.marca === m.nome) || (m && m.fornecedorDados) || null;
  return [
    esp.fornecedor || (m ? m.fornecedor : '') || '',
    (f && f.cnpj) || '', (f && f.uf) || '', (f && f.cidade) || '', (f && f.cep) || '',
    (f && f.endereco) || '', (f && f.site) || '', (f && f.vendedor) || '', (f && f.email) || '', (f && f.telefone) || '',
  ];
}

/** Linhas de dados no formato MP/MC (a partir da coluna Local). */
export function linhasPlanilha(emp, especs, comExtras = false) {
  return ordenarEspecificacoes(especs.filter(vivo)).map(a => {
    const base = [
      nomeDoLocal(a), a.categoria || '', a.produto || '', a.sistema || '',
      montarDescricao(a), a.marca || '', ...fornecedorDe(emp, a),
    ];
    return comExtras ? base.concat(['', '', '', a.produto || '', a.modelo || '']) : base;
  });
}

function montarDescricao(a) {
  const partes = [a.descricao || ''];
  /* a planilha não tem coluna de quantidade: mais de uma esquadria do mesmo
     código no local vira "2 un." na frente da descrição, como o usuário
     preenche à mão — a IA transcreve, e é aqui que a contagem vira texto */
  const qtd = Number(String(a.quantidade || '').replace(',', '.'));
  if (a.categoria === 'Esquadrias' && qtd > 1) partes.unshift(`${qtd} un.`);
  if (a.modelo && !(a.descricao || '').includes(a.modelo)) partes.push('Modelo: ' + a.modelo);
  if (a.dimensao && !(a.descricao || '').includes(a.dimensao)) partes.push(a.dimensao);
  if (a.peitoril) partes.push('Peitoril: ' + a.peitoril);
  return partes.filter(Boolean).join(' — ');
}

function moldura(def, dados) {
  const n = def.codigos.length;
  const preencher = l => { const c = l.slice(0, n); while (c.length < n) c.push(''); return c; };
  return [
    preencher(def.codigos),
    preencher(def.nota),
    ...def.exemplos.map(preencher),
    preencher(def.titulos),
    ...dados.map(preencher),
  ];
}

export function abaMP(emp, especs) { return moldura(LAYOUT.MP, linhasPlanilha(emp, especs, false)); }
export function abaMC(emp, especs) { return moldura(LAYOUT.MC, linhasPlanilha(emp, especs, true)); }

export function abaForn(emp) {
  const dados = emp.marcas.map(m => [
    m.nome || '', m.fornecedor || '', m.cnpj || '', m.uf || '', m.cidade || '',
    m.cep || '', m.endereco || '', m.site || '', m.vendedor || '', m.email || '', m.telefone || '',
  ]);
  return moldura(LAYOUT.FORN, dados);
}

/** Quadro enxuto para conferência e cópia. */
export function tabelaCopia(emp, especs) {
  return [COLUNAS_COPIA.slice()].concat(ordenarEspecificacoes(especs.filter(vivo)).map(a =>
    [a.categoria || '', nomeDoLocal(a), a.produto || '', a.sistema || '', montarDescricao(a), a.marca || '']));
}

/* ---------- referência de documento, resiliente a PDF escaneado ---------- */

/* Numa prancha escaneada não há texto vetorial: a evidência é a imagem do
   recorte. O documento e a página continuam existindo, então a linha sai
   normalmente — só as células de texto e de coordenada ficam vazias. */
const docDaEvidencia = ev => {
  const d = (ev && ev.documentoOrigem) || {};
  return { nome: d.nomeDoc || '', pagina: d.pagina ?? '' };
};
const refDeEvidencia = ev => {
  const { nome, pagina } = docDaEvidencia(ev);
  if (!nome) return '';
  return pagina === '' ? nome : `${nome} p.${pagina}`;
};
const refsDe = alvo => [...new Set((alvo.evidencias || []).map(refDeEvidencia).filter(Boolean))].join(' · ');
const caixaTexto = c => (Array.isArray(c) && c.length === 4)
  ? c.map(v => Math.round(v)).join(', ') : '';

export function abaLocais(emp) {
  const linhas = [['Local', 'Tipologia', 'Pavimento', 'Área', 'Itens', 'Manual', 'Origem', 'Status']];
  for (const l of locaisDe(emp)) {
    linhas.push([
      l.nome || '', l.tipologia || '', l.pavimento || '', l.area || '',
      (l.especificacoes || []).filter(vivo).length,
      temAreasComuns(emp) ? (l.areaComum ? 'MC' : 'MP') : '',
      refsDe(l), rot(STATUS, l.status),
    ]);
  }
  return linhas;
}

export function abaEsquadrias(emp) {
  const linhas = [['Código', 'Local', 'Pavimento', 'Sistema Construtivo', 'Dimensão', 'Peitoril', 'Qtd.', 'Descrição', 'Origem', 'Status']];
  const esq = especificacoesDe(emp).filter(a => a.categoria === 'Esquadrias');
  for (const a of ordenarEspecificacoes(esq)) {
    linhas.push([
      a.codigoOrigem || '', nomeDoLocal(a), a.pavimento || '', a.sistema || '',
      a.dimensao || '', a.peitoril || '', a.quantidade || '', a.descricao || '',
      refsDe(a), rot(STATUS, a.status),
    ]);
  }
  return linhas;
}

/**
 * Aba de evidências: uma linha por evidência, com a proveniência à vista.
 * É onde a arquitetura híbrida fica auditável — cada linha diz qual motor
 * leu aquele dado e por qual método.
 */
export function abaEvidencias(emp) {
  const linhas = [['Local', 'Categoria', 'Nome do Produto/Serviço', 'Sistema Construtivo', 'Descrição',
    'Documento', 'Página', 'Tipo de evidência', 'Forma', 'Número', 'Bloco da legenda',
    'Texto de origem', 'Cadeia de interpretação', 'Região (Nível 2)', 'Zoom (Nível 3)',
    'Motor de IA / Proveniência', 'Método de leitura', 'Confiança', 'Status']];
  for (const a of ordenarEspecificacoes(especificacoesDe(emp))) {
    const evs = (a.evidencias || []).filter(Boolean);
    /* Item sem nenhuma evidência ainda aparece: a planilha mostra o que
       existe e deixa em branco o que o documento não sustenta. */
    const lista = evs.length ? evs : [null];
    for (const ev of lista) {
      const { nome, pagina } = docDaEvidencia(ev);
      const prov = (ev && ev.proveniencia) || {};
      linhas.push([
        nomeDoLocal(a), a.categoria || '', a.produto || '', a.sistema || '', a.descricao || '',
        nome, pagina, (ev && ev.tipo) || '', a.forma || '', a.numero || '',
        (ev && ev.tituloLegenda) || '',
        ((ev && ev.texto) || '').slice(0, 300),
        ((ev && ev.cadeia) || []).join(' → '),
        caixaTexto(ev && ev.regiao), caixaTexto(ev && ev.coordenadas),
        prov.motor_ia || '', prov.metodo || '',
        rot(CONFIANCA, a.confianca), rot(STATUS, a.status),
      ]);
    }
  }
  return linhas;
}

export function abaPendencias(emp) {
  const linhas = [['Motivo', 'Local', 'Categoria', 'Nome do Produto/Serviço', 'Sistema Construtivo', 'Descrição',
    'Documento', 'Página', 'Motor de IA / Proveniência', 'Confiança', 'Status']];
  for (const a of pendencias(emp)) {
    const ev = (a.evidencias || [])[0] || null;
    const { nome, pagina } = docDaEvidencia(ev);
    linhas.push([
      (a.motivos || []).map(m => MOTIVOS_PENDENCIA[m] || m).join(', '),
      nomeDoLocal(a), a.categoria || '', a.produto || '', a.sistema || '', a.descricao || '',
      nome, pagina, (ev && ev.proveniencia && ev.proveniencia.motor_ia) || '',
      rot(CONFIANCA, a.confianca), rot(STATUS, a.status),
    ]);
  }
  return linhas;
}

export function pendencias(emp) {
  return ordenarEspecificacoes(especificacoesDe(emp)
    .filter(a => a.status === 'revisar' || a.status === 'conflito' || a.confianca === 'baixa' || !a.sistema));
}

export function tipologiasComDados(emp) {
  const nomes = [...new Set(especificacoesDe(emp).map(a => a.tipologia || ''))];
  return nomes.length ? nomes : [''];
}

/**
 * Separa o que vai no Manual do Condomínio do que vai no Manual do
 * Proprietário. Quem manda é o local: item sem local vai para o MP, porque
 * área comum é uma propriedade do espaço.
 */
export function separarPorManual(emp) {
  const mc = [], mp = [];
  for (const l of locaisDe(emp)) {
    const destino = l.areaComum ? mc : mp;
    for (const esp of (l.especificacoes || []).filter(vivo)) destino.push(esp);
  }
  for (const esp of (emp.especificacoesSemLocal || []).filter(vivo)) mp.push(esp);
  return { mc, mp };
}

export function pastaDeAbas(emp) {
  const { mc, mp } = separarPorManual(emp);
  const abas = [{ nome: 'Copiar', linhas: tabelaCopia(emp, especificacoesDe(emp)) }];
  const tips = [...new Set(mp.map(a => a.tipologia || ''))];
  if (tips.length <= 1) abas.push({ nome: 'MP', linhas: abaMP(emp, mp) });
  else for (const t of tips) abas.push({ nome: 'MP - ' + (t || 'sem tipologia'), linhas: abaMP(emp, mp.filter(a => (a.tipologia || '') === t)) });
  if (temAreasComuns(emp)) abas.push({ nome: 'MC', linhas: abaMC(emp, mc) });
  abas.push({ nome: 'Forn.', linhas: abaForn(emp) });
  abas.push({ nome: 'Locais', linhas: abaLocais(emp) });
  abas.push({ nome: 'Esquadrias', linhas: abaEsquadrias(emp) });
  abas.push({ nome: 'Evidências', linhas: abaEvidencias(emp) });
  abas.push({ nome: 'Pendências', linhas: abaPendencias(emp) });
  return abas;
}

export function exportarXlsx(emp) { return gerarXlsx(pastaDeAbas(emp)); }
export function exportarCsv(linhas) { return gerarCsv(linhas); }

/** JSON do projeto: a árvore, sem as listas projetadas. */
export function exportarJson(emp) {
  return JSON.stringify(emp, (k, v) =>
    (k === 'ambientes' || k === 'achados' || k === 'tags') ? undefined : v, 2);
}

export function relatorioAuditoria(emp, aud) {
  const l = [];
  l.push(`AUDITORIA — ${emp.nome}`);
  l.push(new Date().toLocaleString('pt-BR'));
  l.push('');
  l.push('1. RESUMO EXECUTIVO');
  l.push(aud.resumo);
  l.push('');
  l.push('2. TABELA DE INCONSISTÊNCIAS');
  l.push(['#', 'Arquivo 1', 'Arquivo 2', 'Tipo de problema', 'Descrição', 'Impacto/Risco'].join(' | '));
  aud.itens.forEach((i, n) => l.push([n + 1, i.a || '—', i.b || '—', i.tipo, i.descricao, i.impacto].join(' | ')));
  l.push('');
  l.push('3. PONTOS CRÍTICOS');
  aud.criticos.forEach((c, n) => l.push(`${n + 1}. ${c.titulo} — ${c.detalhe}`));
  l.push('');
  l.push('4. PLANO DE AÇÃO RECOMENDADO');
  aud.acoes.forEach((a, n) => l.push(`${n + 1}. ${a}`));
  return l.join('\n');
}
