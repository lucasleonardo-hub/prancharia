/* Montagem das abas no layout da Planilha de Produtos e Fornecedores:
   linha 1 com os códigos de importação, linha 5 com os títulos e os dados a
   partir da linha 6.

   Tudo aqui lê a árvore: `emp.locais[].especificacoes[]` e, junto,
   `emp.especificacoesSemLocal[]` — o item que ainda não tem local não
   desaparece da planilha, sai com a coluna Local vazia.

   Célula sem respaldo no documento sai vazia. Nunca "N/A". */

import { gerarXlsx, gerarCsv, celula } from './xlsx.js';
import { CONFIANCA, STATUS, MOTIVOS_PENDENCIA, todasEspecificacoes, normalizar } from './model.js';
import { LAYOUT, COLUNAS_COPIA, CATEGORIAS } from './vocab.js';
import { temAreasComuns, tipoDe } from './tipos.js';
import { completarObrigatorias, ehObrigatoria, naturezaDaMarca, rotuloFornecedor } from './ambiente.js';

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

/** Linhas de dados no formato MP/MC (a partir da coluna Local). */
/* ---------- as cores da planilha ----------
   amarelo = dúvida ou informação não encontrada nos documentos: pergunta
   para a construtora; rosa = decisão interna do time: classificação fora do
   vocabulário controlado (categoria, sistema construtivo). A célula vazia
   sem cor é a informação que não existe por natureza (contrapiso sem marca). */
const CATEGORIAS_OK = new Set(CATEGORIAS);
const emDuvida = a => a.confianca === 'baixa' || a.status === 'revisar' || a.status === 'conflito';

/** A–F de uma linha: Local, Categoria, Nome do produto, Sistema, Descrição, Marca. */
function celulasAF(a) {
  const local = nomeDoLocal(a);
  const categoria = a.categoria || '';
  const sistema = a.sistema || '';
  const descricao = montarDescricao(a);
  const obrigatoria = ehObrigatoria(a);
  const natureza = naturezaDaMarca(a);
  let marca = a.marca || '';
  let corMarca = '';
  if (!marca) {
    if (natureza === 'fornecedor') marca = rotuloFornecedor(a);      // "Fornecedor do forro de gesso"
    else if (natureza === 'marca') corMarca = 'amarelo';           // tem marca no mundo, o documento não disse
    /* 'nenhuma': contrapiso, reboco — em branco, sem cor */
  }
  return [
    celula(local, local ? '' : 'amarelo'),
    celula(categoria, CATEGORIAS_OK.has(categoria) ? '' : 'rosa'),
    celula(a.produto || '', a.produto ? '' : 'amarelo'),
    celula(sistema, sistema ? '' : 'rosa'),
    celula(descricao, (!descricao || obrigatoria || emDuvida(a)) ? 'amarelo' : ''),
    celula(marca, obrigatoria ? 'amarelo' : corMarca),
  ];
}

/* G em diante são fórmulas que puxam da aba "Forn." pela Marca (F) —
   nunca valor estático. A coluna k da Forn. (2 = Fornecedor … 11 = Telefone)
   vira PROCV pela marca; sem marca, a célula fica vazia. */
const NOME_FORN = 'Forn.';
const formulaForn = (linha, k) => celula('', '', `IFERROR(VLOOKUP($F${linha},'${NOME_FORN}'!$A:$K,${k},FALSE),"")`);

/** Linhas de dados de MP/MC/SALA COMERCIAL. `primeiraLinha` é o número, no
    Excel, da primeira linha de dados (as fórmulas apontam para a própria
    linha). MC tem ainda NF, data, link, tipo e modelo — que não vêm da
    Forn. e não são preenchidos aqui. */
export function linhasPlanilha(emp, especs, comExtras = false, primeiraLinha = 6) {
  return ordenarEspecificacoes(especs.filter(vivo)).map((a, i) => {
    const r = primeiraLinha + i;
    const base = [...celulasAF(a), ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(k => formulaForn(r, k))];
    return comExtras ? base.concat(['', '', '', '', '']) : base;
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

/** As linhas de cabeçalho do layout (códigos de importação, nota, exemplos,
    títulos) — os dados começam logo depois. */
const cabecalho = def => [def.codigos, def.nota, ...def.exemplos, def.titulos];
const primeiraLinhaDeDados = def => cabecalho(def).length + 1;

function moldura(def, dados) {
  const n = def.codigos.length;
  const preencher = l => { const c = l.slice(0, n); while (c.length < n) c.push(''); return c; };
  return [...cabecalho(def).map(preencher), ...dados.map(preencher)];
}

export function abaMP(emp, especs) { return moldura(LAYOUT.MP, linhasPlanilha(emp, especs, false, primeiraLinhaDeDados(LAYOUT.MP))); }
export function abaMC(emp, especs) { return moldura(LAYOUT.MC, linhasPlanilha(emp, especs, true, primeiraLinhaDeDados(LAYOUT.MC))); }

/**
 * A aba Forn.: toda marca usada nas abas de produto existe aqui, inclusive
 * as "Fornecedor do forro de gesso" que a coluna F recebe quando o produto
 * não tem marca própria. Dado de fornecedor que falta sai em amarelo; a
 * linha 1 (chaves de importação) fica oculta.
 */
export function abaForn(emp, especs = []) {
  const marcas = new Map();
  for (const m of (emp.marcas || [])) if (m.nome) marcas.set(m.nome.toLowerCase(), { ...m });
  for (const a of especs.filter(vivo)) {
    const nome = a.marca || (naturezaDaMarca(a) === 'fornecedor' ? rotuloFornecedor(a) : '');
    if (!nome) continue;
    const k = nome.toLowerCase();
    if (!marcas.has(k)) marcas.set(k, { nome, fornecedor: a.fornecedor || '' });
    else if (a.fornecedor && !marcas.get(k).fornecedor) marcas.get(k).fornecedor = a.fornecedor;
  }
  const falta = v => celula(v || '', v ? '' : 'amarelo');
  const dados = [...marcas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(m => {
    const f = (emp.fornecedores || []).find(x => x.marca === m.nome) || m.fornecedorDados || m;
    return [
      m.nome || '', falta(m.fornecedor || f.fornecedor), falta(f.cnpj), falta(f.uf), falta(f.cidade),
      falta(f.cep), falta(f.endereco), falta(f.site), falta(f.vendedor), falta(f.email), falta(f.telefone),
    ];
  });
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

/**
 * O checklist de locais de um manual (MC Locais / MP Locais): TODO local
 * lido nos documentos aparece, com ou sem item — nenhum fica de fora.
 * `comum` = true lista as áreas comuns; false, as unidades. Sem áreas
 * comuns no tipo, tudo é MP.
 */
export function abaLocais(emp, comum = null) {
  const linhas = [['Local', 'Tipologia', 'Pavimento', 'Área', 'Itens', 'Manual', 'Origem', 'Status']];
  const todos = locaisDe(emp).filter(l => comum === null || !!l.areaComum === comum);
  const ordenados = [...todos].sort((a, b) => (a.tipologia || '').localeCompare(b.tipologia || '') || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  for (const l of ordenados) {
    const n = (l.especificacoes || []).filter(vivo).length;
    linhas.push([
      celula(l.nome || '', l.nome ? '' : 'amarelo'), l.tipologia || '', l.pavimento || '', l.area || '',
      n,
      temAreasComuns(emp) ? (l.areaComum ? 'MC' : 'MP') : 'MP',
      refsDe(l), rot(STATUS, l.status),
    ]);
  }
  return linhas;
}

/**
 * O nome da aba MP de uma tipologia, como a planilha pede: "Unidade 2, 3, 4
 * e 5" quando as unidades da tipologia estão cadastradas na estrutura;
 * senão o nome da tipologia ("MP - TIPO 1").
 */
export function nomeAbaTipologia(emp, tip, base = 'MP') {
  if (!tip) return base;
  const t = ((emp.estrutura || {}).tipologia || []).find(x => normalizar(x.nome) === normalizar(tip));
  const unidades = t ? ((emp.estrutura || {}).unidade || []).filter(u => u.paiId === t.id).map(u => String(u.nome || '').replace(/^\s*(unidade|apto\.?|apartamento|casa|lote|loja|sala)\s*/i, '').trim()).filter(Boolean) : [];
  if (!unidades.length) return `${base} - ${tip}`;
  const nome = unidades.length === 1 ? unidades[0] : unidades.slice(0, -1).join(', ') + ' e ' + unidades[unidades.length - 1];
  return `Unidade ${nome}`;
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
  /* a planilha sai com as linhas obrigatórias dos ambientes (piso, paredes,
     teto de todo ambiente fechado; rejunte de todo cerâmico) mesmo vazias —
     é a única mutação da árvore que a exportação faz, e é idempotente */
  completarObrigatorias(emp);
  const { mc, mp } = separarPorManual(emp);
  /* o manual da unidade privativa tem nome próprio no empreendimento
     comercial: é o Manual do Espaço Comercial */
  const comercial = (tipoDe(emp) || {}).id === 'comercial';
  const base = comercial ? 'SALA COMERCIAL' : 'MP';
  const abas = [{ nome: 'Copiar', linhas: tabelaCopia(emp, especificacoesDe(emp)) }];
  const tips = [...new Set(mp.map(a => a.tipologia || ''))];
  if (tips.length <= 1) {
    /* uma tipologia só: "Unidade 101, 102 e 103" quando as unidades estão
       cadastradas; senão a aba é simplesmente MP (ou SALA COMERCIAL) */
    const nome = tips[0] ? nomeAbaTipologia(emp, tips[0], base) : base;
    abas.push({ nome: nome.startsWith(base + ' - ') ? base : nome, linhas: abaMP(emp, mp) });
  }
  else for (const t of tips) abas.push({ nome: t ? nomeAbaTipologia(emp, t, base) : `${base} - sem tipologia`, linhas: abaMP(emp, mp.filter(a => (a.tipologia || '') === t)) });
  if (temAreasComuns(emp)) abas.push({ nome: 'MC', linhas: abaMC(emp, mc) });
  abas.push({ nome: NOME_FORN, linhas: abaForn(emp, especificacoesDe(emp)), ocultar: [0] });
  if (temAreasComuns(emp)) abas.push({ nome: 'MC Locais', linhas: abaLocais(emp, true) });
  abas.push({ nome: `${base} Locais`, linhas: abaLocais(emp, temAreasComuns(emp) ? false : null) });
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
