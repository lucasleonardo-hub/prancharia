/* Montagem das abas no layout da Planilha de Produtos e Fornecedores:
   linha 1 com os códigos de importação, linha 5 com os títulos e os dados a
   partir da linha 6.

   Tudo aqui lê a árvore: `emp.locais[].especificacoes[]` e, junto,
   `emp.especificacoesSemLocal[]` — o item que ainda não tem local não
   desaparece da planilha, sai com a coluna Local vazia.

   Célula sem respaldo no documento sai vazia. Nunca "N/A". */

import { gerarXlsx, gerarCsv, celula } from './xlsx.js';
import { CONFIANCA, STATUS, MOTIVOS_PENDENCIA, todasEspecificacoes, normalizar } from './model.js';
import { LAYOUT, COLUNAS_COPIA, CATEGORIAS, SISTEMAS } from './vocab.js';
import { temAreasComuns, tipoDe } from './tipos.js';
import { completarObrigatorias, ehObrigatoria, naturezaDaMarca, rotuloFornecedor, marcaDe } from './ambiente.js';
import { temIncerteza } from './marcas.js';
import { unidadeDaTipologia } from './areas.js';

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

/* O local que só o memorial (ou a IA sobre os documentos) conhece — a
   prancha não o desenhou: coluna A em amarelo, para a construtora dizer
   onde ele está. O local do memorial que a prancha adotou (`adotadoEm`) ou
   cujos itens foram copiados para os cômodos da prancha (`propagadoPara`)
   foi achado no projeto. É o cruzamento memorial × projeto na direção
   memorial → projeto. */
export const localSoNoMemorial = l => !!l && ((l.origem === 'memorial' && !l.adotadoEm && !(l.propagadoPara || []).length) || l.origem === 'mapeamento_ia');
/* o local genérico do memorial ("DORMITÓRIOS") cujos itens já foram
   copiados para os cômodos da prancha é molde, não linha da planilha */
const ehMolde = l => !!l && (l.propagadoPara || []).length > 0 && !l.adotadoEm;

/* Os documentos que especificam produto: memorial, caderno de acabamentos,
   projeto de interiores. Com um deles no empreendimento, o produto que só a
   prancha nomeou ("PISO 01 = porcelanato") e que nenhum deles confirma é
   dúvida: C, E e F em amarelo — a direção projeto → memorial do cruzamento. */
const DISCIPLINAS_ESPEC = new Set(['memorial', 'acabamentos', 'interiores']);
export function contextoDaPlanilha(emp) {
  const docs = (emp.documentos || []).filter(d => d && (d.tipo === 'memorial' || DISCIPLINAS_ESPEC.has(d.disciplina)));
  return { temMemorial: docs.length > 0, docsEspec: new Set(docs.map(d => d.id)), locais: new Map((emp.locais || []).map(l => [l.id, l])) };
}
const CONTEXTO_VAZIO = { temMemorial: false, docsEspec: new Set(), locais: new Map() };
const confirmadoNoMemorial = (a, ctx) => a.origemLeitura === 'memorial' || a.origemLeitura === 'manual'
  || (a.evidencias || []).some(ev => ev && (ev.tipo === 'texto_memorial' || (ev.documentoOrigem && ctx.docsEspec.has(ev.documentoOrigem.docId))));

/** A–F de uma linha: Local, Categoria, Nome do produto, Sistema, Descrição, Marca. */
function celulasAF(a, ctx = CONTEXTO_VAZIO) {
  const local = nomeDoLocal(a);
  const l = a.localId ? ctx.locais.get(a.localId) : null;
  const corLocal = (!local || localSoNoMemorial(l)) ? 'amarelo' : '';
  /* local sem nenhum item: só o nome, e o resto é pergunta (D é do time) */
  if (a.vazio) return [celula(local, corLocal), celula('', 'amarelo'), celula('', 'amarelo'), celula('', 'rosa'), celula('', 'amarelo'), celula('', 'amarelo')];
  const categoria = a.categoria || '';
  const sistema = a.sistema || '';
  const descricao = montarDescricao(a);
  const obrigatoria = ehObrigatoria(a);
  const natureza = naturezaDaMarca(a);
  /* "a definir", "ou similar" na frase: o produto está nomeado, não decidido */
  const incerta = temIncerteza(`${a.descricao || ''} ${a.modelo || ''}`);
  /* produto que só a prancha nomeou, sem memorial nem caderno confirmar */
  const semMemorial = ctx.temMemorial && !obrigatoria && !confirmadoNoMemorial(a, ctx);
  let marca = a.marca || '';
  let corMarca = '';
  if (obrigatoria) {
    marca = ''; corMarca = 'amarelo';                              // ninguém leu o item: marca é pergunta
  } else if (!marca) {
    marca = marcaDe(a);                                            // a marca escrita dentro da descrição
    if (!marca) {
      if (natureza === 'fornecedor') marca = rotuloFornecedor(a);  // "Fornecedor do forro de gesso": nunca amarelo
      else if (natureza === 'marca') corMarca = 'amarelo';         // tem marca no mundo, o documento não disse
      /* 'nenhuma': contrapiso, reboco — em branco, sem cor */
    }
  }
  /* marca de verdade, mas com "ou similar" na frase ou sem o memorial
     confirmar: ainda é dúvida. "Fornecedor de …" nunca é. */
  if (marca && natureza === 'marca' && (incerta || semMemorial)) corMarca = 'amarelo';
  return [
    celula(local, corLocal),
    celula(categoria, CATEGORIAS_OK.has(categoria) ? '' : 'rosa'),
    celula(a.produto || '', (!a.produto || semMemorial) ? 'amarelo' : ''),
    celula(sistema, sistema ? '' : 'rosa'),
    celula(descricao, (!descricao || obrigatoria || emDuvida(a) || incerta || semMemorial) ? 'amarelo' : ''),
    celula(marca, corMarca),
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
  const ctx = contextoDaPlanilha(emp);
  return ordenarEspecificacoes(especs.filter(vivo)).map((a, i) => {
    const r = primeiraLinha + i;
    const base = [...celulasAF(a, ctx), ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(k => formulaForn(r, k))];
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
    if (a.vazio || ehObrigatoria(a)) continue;
    const nome = marcaDe(a) || (naturezaDaMarca(a) === 'fornecedor' ? rotuloFornecedor(a) : '');
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
    [a.categoria || '', nomeDoLocal(a), a.produto || '', a.sistema || '', montarDescricao(a), marcaDe(a) || '']));
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
  const linhas = [['Local', 'Tipologia', 'Unidades', 'Pavimento', 'Área', 'Itens', 'Manual', 'Origem', 'Status']];
  const todos = locaisDe(emp).filter(l => (comum === null || !!l.areaComum === comum) && !ehMolde(l));
  const ordenados = [...todos].sort((a, b) => (a.tipologia || '').localeCompare(b.tipologia || '') || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  for (const l of ordenados) {
    const n = (l.especificacoes || []).filter(vivo).length;
    const unidades = l.tipologia ? unidadesDaTipologia(emp, l.tipologia) : [];
    linhas.push([
      /* achado só no memorial, não no projeto: amarelo, como na coluna A das abas de produto */
      celula(l.nome || '', (!l.nome || localSoNoMemorial(l)) ? 'amarelo' : ''), l.tipologia || '', unidades.length ? listar(unidades) : '', l.pavimento || '', l.area || '',
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
const acharTip = (emp, tip) => ((emp.estrutura || {}).tipologia || []).find(x => normalizar(x.nome) === normalizar(tip)) || null;
const listar = xs => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + ' e ' + xs[xs.length - 1];
const porNumero = (a, b) => (Number(a) || 0) - (Number(b) || 0) || String(a).localeCompare(String(b));

/** Os números das unidades cadastradas numa tipologia ("101", "201"…), em ordem. */
export function unidadesDaTipologia(emp, tip) {
  const t = acharTip(emp, tip);
  if (!t) return [];
  const nomes = ((emp.estrutura || {}).unidade || []).filter(u => u.paiId === t.id)
    .map(u => String(u.nome || '').replace(/^\s*(unidade|apto\.?|apartamento|casa|lote|loja|sala)\s*/i, '').trim()).filter(Boolean);
  return [...new Set(nomes)].sort(porNumero);
}

export function nomeAbaTipologia(emp, tip, base = 'MP') {
  if (!tip) return base;
  const unidades = unidadesDaTipologia(emp, tip);
  if (unidades.length) return `Unidade ${listar(unidades)}`;
  /* a unidade personalizada ("OPCIONAL - APTO 104") e a tipologia que É uma
     unidade ("APTO 201") têm aba com o número dela, pela regra da planilha */
  const t = acharTip(emp, tip);
  const m = /(?:APTO|APARTAMENTO|UNIDADE|CASA|LOTE|SALA)\.?\s*(\d{1,4})/i.exec(tip);
  if (m && ((t && t.opcional) || unidadeDaTipologia(tip))) return `Unidade ${m[1]}`;
  return `${base} - ${tip}`;
}

/* Unidades iguais compartilham a aba: duas tipologias que SÃO unidades
   ("APTO 201" e "APTO 301") com os mesmos locais e os mesmos produtos são a
   mesma planta — "Unidade 201 e 301". Tipologia com nome próprio (TIPO 1,
   COBERTURA) e opcional ficam separadas mesmo que se pareçam com outra: o
   projeto as nomeou de propósito. É a comparação local a local que a
   planilha pede, feita sobre o que foi lido. */
function assinatura(itens) {
  const locais = [...new Set(itens.map(a => normalizar(a.localNome || '')))].sort();
  const produtos = [...new Set(itens.filter(a => !ehObrigatoria(a) && !a.vazio)
    .map(a => [normalizar(a.localNome || ''), a.categoria || '', normalizar(a.produto || ''), normalizar(a.descricao || ''), a.codigoOrigem || ''].join('|')))].sort();
  return JSON.stringify([locais, produtos]);
}
export function gruposDeTipologias(emp, mp) {
  const tips = [...new Set(mp.map(a => a.tipologia || ''))];
  const grupos = [], porAssinatura = new Map();
  for (const t of tips) {
    const itens = mp.filter(a => (a.tipologia || '') === t);
    const tipo = acharTip(emp, t);
    const k = unidadeDaTipologia(t) && !(tipo && tipo.opcional) ? assinatura(itens) : null;
    if (k && porAssinatura.has(k)) { porAssinatura.get(k).tipologias.push(t); continue; }
    const g = { tipologias: [t], itens };
    grupos.push(g);
    if (k) porAssinatura.set(k, g);
  }
  return grupos;
}
function nomeDoGrupo(emp, g, base) {
  if (g.tipologias.length === 1) return g.tipologias[0] ? nomeAbaTipologia(emp, g.tipologias[0], base) : `${base} - sem tipologia`;
  const unidades = [...new Set(g.tipologias.flatMap(t => { const u = unidadesDaTipologia(emp, t); return u.length ? u : [unidadeDaTipologia(t)]; }))].filter(Boolean).sort(porNumero);
  return `Unidade ${listar(unidades)}`;
}

/**
 * Os itens de uma tipologia para a aba MP. Uma tipologia que é OPCIONAL de
 * outra (unidade personalizada) recebe a base inteira mais o que o opcional
 * muda: onde o opcional tem item para o mesmo local e a mesma categoria, a
 * linha da base sai ("adicionar e remover padrão"); senão a base fica.
 */
export function itensDaTipologia(emp, mp, tip) {
  const proprios = mp.filter(a => (a.tipologia || '') === tip);
  const t = ((emp.estrutura || {}).tipologia || []).find(x => normalizar(x.nome) === normalizar(tip));
  if (!t || !t.opcional || !t.base) return proprios;
  const daBase = mp.filter(a => normalizar(a.tipologia || '') === normalizar(t.base));
  const cobre = new Set(proprios.filter(a => a.origemLeitura !== 'obrigatoria').map(a => normalizar(a.localNome) + '|' + a.categoria));
  const herdados = daBase.filter(a => !cobre.has(normalizar(a.localNome) + '|' + a.categoria));
  return proprios.concat(herdados);
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
  /* o que a IA propôs no mapeamento fica em revisão até uma pessoa
     confirmar, mesmo que a auditoria automática tenha completado um campo */
  return ordenarEspecificacoes(especificacoesDe(emp)
    .filter(a => a.status === 'revisar' || a.status === 'conflito' || a.confianca === 'baixa' || !a.sistema
      || ((a.motivos || []).includes('mapeamento_ia') && a.status !== 'confirmado')));
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
    if (ehMolde(l)) continue;
    const destino = l.areaComum ? mc : mp;
    const itens = (l.especificacoes || []).filter(vivo);
    /* todo local lido aparece na coluna A, mesmo sem nenhum item: a linha
       sai com o nome e o resto em amarelo — nenhum local fica de fora */
    if (!itens.length) { destino.push(linhaVazia(l)); continue; }
    for (const esp of itens) destino.push(esp);
  }
  for (const esp of (emp.especificacoesSemLocal || []).filter(vivo)) mp.push(esp);
  return { mc, mp };
}
const linhaVazia = l => ({
  id: 'vazio_' + l.id, vazio: true, localId: l.id, localNome: l.nome, pavimento: l.pavimento || '', tipologia: l.tipologia || '',
  categoria: '', produto: '', descricao: '', marca: '', sistema: '', modelo: '', quantidade: '',
  status: 'revisar', confianca: 'baixa', motivos: [], evidencias: [], origemLeitura: 'ambiente',
});

/**
 * Personalizações: o que cada unidade personalizada (tipologia OPCIONAL de
 * uma base) muda em relação ao padrão — "Adicionar e remover padrão" quando
 * o item substitui o da base no mesmo local e categoria, "Adicionar e manter
 * padrão" quando só acrescenta. A coluna D, sem título, é a ação, como na
 * planilha; a garantia não vem de documento e sai em amarelo.
 */
export function abaPersonalizacoes(emp, mp) {
  const linhas = [['Local', 'Categoria', 'Nome do Produto/Serviço', '', 'Sistema Construtivo', 'Descrição/Modelo/Linha', 'Marca', 'Garantia']];
  const ctx = contextoDaPlanilha(emp);
  for (const t of ((emp.estrutura || {}).tipologia || []).filter(x => x.opcional)) {
    const proprios = mp.filter(a => normalizar(a.tipologia || '') === normalizar(t.nome) && !ehObrigatoria(a) && !a.vazio);
    if (!proprios.length) continue;
    const daBase = mp.filter(a => t.base && normalizar(a.tipologia || '') === normalizar(t.base) && !ehObrigatoria(a) && !a.vazio);
    linhas.push([`${nomeAbaTipologia(emp, t.nome)}${t.base ? ` — opcional de ${t.base}` : ''}`, '', '', '', '', '', '', '']);
    for (const a of ordenarEspecificacoes(proprios)) {
      const substitui = daBase.some(b => normalizar(b.localNome || '') === normalizar(a.localNome || '') && b.categoria === a.categoria);
      const [A, B, C, D, E, F] = celulasAF(a, ctx);
      linhas.push([A, B, C, substitui ? 'Adicionar e remover padrão' : 'Adicionar e manter padrão', D, E, F, celula('', 'amarelo')]);
    }
  }
  return linhas;
}

/**
 * Sistemas Áreas Comuns / Sistemas Unidades Privativas: o checklist dos
 * sistemas construtivos da lista mestra daquele lado, marcando os que o
 * levantamento usou e onde. Sistema usado que não é da lista do lado sai no
 * fim, em rosa — é decisão do time.
 */
export function abaSistemas(emp, itens, comum) {
  const linhas = [['Sistema Construtivo', 'Presente', 'Locais', 'Itens']];
  const usados = new Map();
  for (const a of itens) {
    if (!a.sistema) continue;
    const k = normalizar(a.sistema);
    if (!usados.has(k)) usados.set(k, { nome: a.sistema, locais: new Set(), n: 0 });
    const u = usados.get(k); u.n++; if (a.localNome) u.locais.add(a.localNome);
  }
  const doLado = SISTEMAS.filter(s => comum ? s.c : s.p);
  for (const s of doLado) {
    const u = usados.get(normalizar(s.n));
    linhas.push([s.n, u ? 'X' : '', u ? [...u.locais].sort().join(', ') : '', u ? u.n : '']);
  }
  for (const u of usados.values()) {
    if (doLado.some(s => normalizar(s.n) === normalizar(u.nome))) continue;
    linhas.push([celula(u.nome, 'rosa'), 'X', [...u.locais].sort().join(', '), u.n]);
  }
  return linhas;
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
  const grupos = gruposDeTipologias(emp, mp);
  if (grupos.length <= 1) {
    /* uma tipologia só (ou unidades todas iguais): "Unidade 101, 102 e 103"
       quando as unidades estão cadastradas; senão a aba é simplesmente MP
       (ou SALA COMERCIAL) */
    const g = grupos[0];
    const nome = g && g.tipologias[0] ? nomeDoGrupo(emp, g, base) : base;
    abas.push({ nome: nome.startsWith(base + ' - ') ? base : nome, linhas: abaMP(emp, g && g.tipologias.length > 1 ? g.itens : mp) });
  } else {
    for (const g of grupos) {
      const t = g.tipologias[0];
      abas.push({ nome: nomeDoGrupo(emp, g, base), linhas: abaMP(emp, g.tipologias.length > 1 ? g.itens : itensDaTipologia(emp, mp, t)) });
    }
  }
  if (temAreasComuns(emp)) abas.push({ nome: 'MC', linhas: abaMC(emp, mc) });
  const pers = abaPersonalizacoes(emp, mp);
  if (pers.length > 1) abas.push({ nome: 'Personalizações', linhas: pers });
  abas.push({ nome: NOME_FORN, linhas: abaForn(emp, especificacoesDe(emp)), ocultar: [0] });
  if (temAreasComuns(emp)) abas.push({ nome: 'Sistemas Áreas Comuns', linhas: abaSistemas(emp, mc, true) });
  abas.push({ nome: 'Sistemas Unidades Privativas', linhas: abaSistemas(emp, mp, false) });
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
