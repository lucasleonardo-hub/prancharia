/* Áreas comuns × unidades privativas, e a tipologia da unidade.

   Num condomínio a mesma palavra mora em dois mundos: "CIRCULAÇÃO" é a
   circulação do andar (área comum — Manual do Condomínio) ou a circulação
   dentro do apartamento (privativa — Manual do Proprietário). O que separa
   os dois não é a palavra, é onde ela está: dentro de uma unidade marcada
   "TIPO 1" na prancha, ou depois do título "ÁREAS PRIVATIVAS" no memorial.

   Este módulo guarda o que decide quando o contexto não decide: o
   vocabulário dos nomes que só existem em área comum (portaria, salão de
   festas, casa de máquinas) e dos que só existem dentro de uma unidade
   (dormitório, suíte, área de serviço), o reconhecimento dos rótulos de
   tipologia ("TIPO 1", "TIPO PNE 4", "APTO TIPO A") e dos marcadores de
   seção do memorial. É lido pelo memorial, pelo motor das pranchas e pela
   interface — uma resposta só, nos três lugares. */

import { normalizar } from './model.js';

const daLista = lista => new RegExp('(?:^|\\b)(?:' + lista.join('|') + ')(?:\\b|$)', 'i');

/** Nomes que, sozinhos, dizem área comum. Padrões sobre o texto normalizado
    (minúsculo, sem acento). */
export const VOCAB_COMUM = [
  // portas de entrada e circulação coletiva
  'hall', 'portaria', 'guarita', 'recepcao', 'lobby', 'foyer', 'antecamara',
  'circulacao (?:comum|coletiva|social|de servico|do andar|dos andares|do pavimento)',
  'corredor(?:es)? (?:comum|coletivo|social|de servico|do andar|dos andares)',
  'escada(?:s|ria)?', 'rampa', 'elevador(?:es)?', 'poco', 'pressurizad',
  // lazer e convívio
  'salao', 'festas', 'brinquedoteca', 'espaco (?:gourmet|kids|pet|zen|mulher|beleza|teen|jovem)',
  'copa (?:do |da |de )?(?:salao|festas|gourmet|lazer|funcionarios?)', 'office', 'coworking',
  'ginastica', 'fitness', 'academia', 'cinema', 'spa', 'sauna', 'piscina', 'deck', 'solarium', 'solario',
  'prainha', 'playground', 'quadra', 'churrasq', 'lazer', 'pet place', 'petplace', 'jogos',
  'sala de (?:ginastica|jogos|estudos?|reunioes|leitura|massagem|musica|festas|espera)',
  'lavanderia coletiva', 'refeitorio', 'vestiario', 'dml',
  // sanitários de uso comum
  'wcs? (?:portaria|pne|pcd|pcr|comum|funcionario|vestiario|social|masc|fem|lazer)',
  'banheiros? (?:pne|pcd|pcr|funcionario|comum|social|coletivo|masc|fem|lazer|piscina|portaria)',
  'sanitarios? (?:pne|pcd|pcr|funcionario|comum|social|coletivo|masc|fem)',
  // serviço e técnica do condomínio
  'deposito de lixo', 'depositos de lixo', 'lixo', 'zelador', 'administracao', 'sindico',
  'estacionamento', 'garagem', 'vagas?', 'bicicletario', 'motos', 'calcadas?', 'muros?', 'acessos?', 'portoes?', 'gradil',
  'hidrometro', 'abrigo de gas', 'medicao', 'medidor', 'gerador', 'bombas?', 'barrilete',
  'reservatorio', 'cisterna', 'casa de maquinas', 'areas? tecnicas?', 'area tec', 'cpd',
  'cobertura', 'atico', 'telhado', 'fachada', 'jardim', 'patio', 'paisagismo', 'praca',
  'quiosque', 'gazebo', 'pergolado', 'redario', 'horta', 'pomar',
];

/** Nomes que, sozinhos, dizem unidade privativa. */
export const VOCAB_PRIVATIVA = [
  'sala', 'estar', 'jantar', 'living', 'dormitorio', 'dormitorios', 'dorm', 'quarto', 'suite',
  'closet', 'banheiro', 'banho', 'lavabo', 'bwc', 'cozinha', 'copa', 'area de servico', 'a\\.?\\s?s\\b',
  'servico', 'terraco', 'varanda', 'sacada', 'despensa', 'home office', 'escritorio', 'lavanderia da unidade',
  'lavanderia privativa', 'circulacao (?:intima|interna|da unidade|do apartamento)',
];

const COMUM = daLista(VOCAB_COMUM);
const PRIVATIVA = daLista(VOCAB_PRIVATIVA);

/**
 * O que o nome diz sozinho: 'comum', 'privativa' ou '' quando a palavra não
 * decide (LAVANDERIA, CIRCULAÇÃO, DEPÓSITO, WC…). A área comum é testada
 * antes de propósito: "SALA DE GINÁSTICA" é comum, e só "SALA" é privativa.
 */
export function classificarArea(nome) {
  const n = normalizar(nome).replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  if (COMUM.test(n)) return 'comum';
  if (PRIVATIVA.test(n)) return 'privativa';
  return '';
}

/* A numeração de seção do memorial — "1.1.4.", "2.1 –", "2-", "VII –",
   "a)" — organiza o documento; não é parte do nome do local. Um número
   solto sem separador ("2 DORMITÓRIOS") fica: pode ser contagem. O
   algarismo romano só sai quando é seguido de separador e espaço, para
   "I.S. GUARITA" não perder o I. */
const NUMERACAO = /^\s*(?:\d{1,3}(?:\.\d{1,3})+\.?|\d{1,3}\.(?=\s)|\d{1,3}(?=\s*[-–—:)])|[IVXLC]{1,6}(?=\s*[-–—:)]\s|\.\s)|[a-zA-Z](?=[.)]\s+[A-Za-zÀ-ÿ]{2}))\s*[-–—:.)]*\s*/;
const PREPOSICAO_INICIAL = /^(?:d[aoe]s?|d')\s+(?=\S)/i;

/**
 * Separa a numeração do título: "2.6 – DAS GARAGENS" → { numero: '2.6',
 * nome: 'GARAGENS' }. A preposição que sobra depois do número ("DAS
 * GARAGENS", "DO APARTAMENTO TIPO") também sai — o memorial escreve o
 * título como frase, a árvore guarda o nome.
 */
export function separarNumeracao(titulo) {
  const t = String(titulo || '').replace(/\s+/g, ' ').trim();
  const m = NUMERACAO.exec(t);
  let nome = m ? t.slice(m[0].length) : t;
  const numero = m ? m[0].replace(/[\s\-–—:.)]+$/, '').trim() : '';
  nome = nome.replace(/[\s:;–—-]+$/, '').trim();
  const semPreposicao = nome.replace(PREPOSICAO_INICIAL, '');
  if (semPreposicao.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3) nome = semPreposicao;
  return { numero, nome: nome || t };
}

/** O nome que o título carrega, sem numeração nem preposição inicial. */
export function tituloLimpo(titulo) {
  return separarNumeracao(titulo).nome;
}

/* Título que começa pelo nome de uma categoria da planilha: "ESQUADRIAS DAS
   UNIDADES", "PISOS E RODAPÉS", "LOUÇAS E METAIS", "PINTURA". É uma seção
   sobre o produto, não sobre um lugar. PORTÃO fica de fora de propósito:
   "PORTÃO DE ENTRADA" é lugar no vocabulário de área comum. */
const CATEGORIA_LIDER = /^(?:esquadrias?|portas?|janelas?|caixilhos?|pisos?|paredes?|tetos?|forros?|pinturas?|loucas?|metais|bancadas?|tampos?|revestimentos?|luminarias?|iluminacao|mobiliario|marcenaria|vidros?|ferragens?|soleiras?|peitoris|rodapes?|guarda.?corpos?|corrimaos?|impermeabilizac\w*|rejuntes?|acessorios|louca e metais|loucas e metais)\b/;

/** O título é de categoria de produto (e não de local)? */
export function ehTituloDeCategoria(titulo) {
  const n = normalizar(tituloLimpo(titulo)).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return !!n && CATEGORIA_LIDER.test(n);
}

/** O que sobra do título de categoria depois do nome da categoria e da
    preposição: "ESQUADRIAS DAS UNIDADES" → "unidades". */
export function restoDoTituloDeCategoria(titulo) {
  const n = normalizar(tituloLimpo(titulo)).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return n.replace(CATEGORIA_LIDER, '').replace(/^\s*(?:e|d[aoe]s?|n[ao]s?|em|para|gerais|geral|internas?|externas?)\s+/, '').trim();
}

/**
 * Título de seção do memorial que muda o grupo de tudo o que vem depois:
 * "ÁREAS COMUNS", "ÁREAS PRIVATIVAS", "UNIDADES AUTÔNOMAS", "APARTAMENTOS",
 * "1 – DAS UNIDADES AUTÔNOMAS", "1.2 DO APTO DE COBERTURA". O título tem de
 * SER o marcador: "ESQUADRIAS DAS ÁREAS COMUNS" fala de esquadrias, e é
 * seção de categoria, não marcador.
 */
export function marcadorDeGrupo(titulo) {
  let n = normalizar(tituloLimpo(titulo)).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || CATEGORIA_LIDER.test(n)) return null;
  /* "ACABAMENTOS DAS ÁREAS COMUNS", "ESPECIFICAÇÃO DE ACABAMENTOS – ÁREAS
     PRIVATIVAS": a palavra de abertura sai, o marcador tem de vir logo em
     seguida. "I.S. FEM/MASC. ÁREA DE LAZER" fala de um sanitário, e o
     marcador no fim do título não o torna marcador. */
  for (let i = 0; i < 2; i++) n = n.replace(/^(?:acabamentos?|especificac(?:ao|oes)|revestimentos?|memorial(?: descritivo)?|descricao|descritivo|caracteristicas|relacao|quadro|lista)\s+(?:d[aoe]s?\s+)?/, '');
  const cauda = '(?:\\s+(?:d[aoe]s?\\s+)?\\w+){0,3}$';
  if (new RegExp('^(?:areas?|ambientes?|dependencias?|espacos?)\\s+(?:comuns?|condominiais?|coletiv[oa]s?|de uso comum|de lazer)' + cauda).test(n)
    || /^(?:condominio|areas? sociais?|lazer|uso comum)$/.test(n)) return 'comum';
  if (new RegExp('^(?:areas?|unidades?|dependencias?)\\s+(?:privativas?|autonomas?|habitacionais?|residenciais?)' + cauda).test(n)
    || /^(?:apartamentos?|unidades?|casas?|aptos?|tipologias?)(?:\s+tipo.*)?$/.test(n)
    || /^(?:apartamentos?|unidades?|aptos?)\s+(?:tipo|padrao|de \d)/.test(n)
    || /^(?:apartamentos?|aptos?|unidades?|casas?)\s+(?:de\s+)?(?:coberturas?|garden|duplex|triplex|studios?|lofts?)\b/.test(n)) return 'privativa';
  return null;
}

/**
 * A tipologia que um marcador privativo nomeia, quando nomeia uma: "APTO DE
 * COBERTURA" → "COBERTURA", "APARTAMENTOS TIPO 2" → "TIPO 2". O marcador
 * genérico ("APARTAMENTO TIPO", "UNIDADES AUTÔNOMAS") devolve '' — vale
 * para todas.
 */
export function tipologiaDoMarcador(titulo) {
  const limpo = tituloLimpo(titulo);
  const n = normalizar(limpo).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(?:apartamentos?|aptos?|unidades?|casas?)\s+(?:de\s+)?(cobertura|garden|duplex|triplex|studio|loft)s?$/.exec(n);
  if (m) return m[1].toUpperCase();
  /* "APARTAMENTOS TIPO 2": o plural do marcador é singular para a regra da
     prancha, que lê "APTO TIPO 2" */
  return lerTipologia(limpo.replace(/^(apartamento|apto|unidade|casa)s\b/i, '$1')) || '';
}

/**
 * Um título composto — "SALA ESTAR / JANTAR E CIRCULAÇÃO", "WCs PORTARIA E
 * VESTIÁRIOS" — fala de mais de um local. Separa as partes para casar cada
 * uma com a prancha; o nome inteiro continua sendo o do local do memorial.
 */
export function partesDoNome(nome) {
  const partes = String(nome || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .split(/\s*(?:\/|,|;|\+|\be\/ou\b|\bou\b|\be\b)\s*/i)
    .map(s => s.trim()).filter(s => s.length >= 3);
  return partes.length ? [...new Set(partes)] : [String(nome || '').trim()].filter(Boolean);
}

/**
 * "TIPO 1", "TIPO PNE 4", "APTO TIPO A", "TIPOLOGIA 2", "CASA TIPO B" → o
 * nome canônico da tipologia ("TIPO 1", "TIPO PNE 4", "TIPO A"). Qualquer
 * outro texto devolve null: a regra é estreita de propósito, porque "tipo"
 * também aparece em frases ("piso tipo tábua").
 */
export function lerTipologia(texto) {
  const s = String(texto || '').replace(/\s+/g, ' ').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.length < 5 || s.length > 26) return null;
  /* "APTO 201", "APARTAMENTO 1203", "UNIDADE 304": a unidade é a sua própria
     tipologia até que a comparação local a local prove que outra unidade é
     igual a ela — a composição do memorial ("apartamentos 201, 202 e 203,
     cada um com…") ou a exportação fazem essa comparação. O "final" da
     torre não decide: no Paradiso o 401 tem três suítes e o 201, duas.
     "FINAL 4" escrito na prancha continua sendo a tipologia FINAL 4. */
  const un = /^(?:APTO|APTO\.|APARTAMENTO|AP|AP\.|UNIDADE|UNID|UNID\.)\s*(\d{3,4})$/.exec(s);
  if (un) return `APTO ${un[1].replace(/^0+(?=\d)/, '')}`;
  const fin = /^FINAL\s*[-–:]?\s*(\d{1,2})$/.exec(s);
  if (fin) return `FINAL ${Number(fin[1])}`;
  const m = /^(?:(?:APTO|APARTAMENTO|AP|UNIDADE|UNID|CASA|LOJA|SALA|QUARTO)\.?\s+)?(?:TIPO|TIPOLOGIA|TP)\.?\s*[-–:]?\s*(?:(PNE|PCD|PCR|PMR|ACESSIVEL)\s*)?[-–]?\s*(\d{1,3}|[A-Z]{1,2}\d?)(?:\s*[-–]?\s*(PNE|PCD|PCR|PMR|ACESSIVEL))?$/.exec(s);
  if (!m) return null;
  const marca = m[1] || m[3] || '';
  /* "TIPO 03" e "TIPO 3" são a mesma tipologia: o zero à esquerda é grafia da
     prancha (ou da leitura por imagem), não identidade */
  const numero = /^\d+$/.test(m[2]) ? String(Number(m[2])) : m[2];
  return `TIPO ${marca ? marca + ' ' : ''}${numero}`;
}

/** O número da unidade quando a tipologia É uma unidade ("APTO 201" → "201");
    '' para TIPO 1, FINAL 4, COBERTURA. */
export function unidadeDaTipologia(nome) {
  const m = /^APTO\s+(\d{1,4})$/i.exec(String(nome || '').trim());
  return m ? m[1] : '';
}

/** "Unidade 101", "Apto 101", "101" → "101". */
export function numeroDaUnidade(nome) {
  const m = /(\d{1,4})\s*$/.exec(String(nome || '').trim());
  return m ? m[1].replace(/^0+(?=\d)/, '') : '';
}

/**
 * O lado que a folha inteira revela: uma planta cheia de SALA, DORM e SUÍTE é
 * planta de unidade, e nela CIRCULAÇÃO, WC e LAVANDERIA são privativos; uma
 * planta de HALL, ESCADA e SALÃO DE FESTAS é de área comum, e nela DEPÓSITO e
 * WC são comuns. Decide só quando a maioria é clara — senão devolve ''.
 */
export function ladoDaFolha(nomes) {
  let comum = 0, privativa = 0;
  for (const n of nomes || []) {
    const v = classificarArea(n);
    if (v === 'comum') comum++; else if (v === 'privativa') privativa++;
  }
  if (privativa >= 2 && privativa > comum) return 'privativa';
  if (comum >= 2 && comum > privativa) return 'comum';
  return '';
}

const PAV = /\b(?:do|da|no|na|dos|das|de)\s+((?:\d{1,2}\s*[ºo°]?\s*)?(?:pavimento|pav\.?|andar|subsolo|terreo|atico|cobertura|mezanino|sobreloja)(?:\s+(?:tipo|superior|inferior|\d{1,2}))?)\b/i;

/* Parêntese que explica em vez de distinguir: sai do nome. */
const EXPLICATIVO = /projeto|conforme|\bver\b|vide|idem|similar|opcional|legal|aprovad|\bou\b|\bex\.?\b|exceto|antig|n[ºo°]\s*\d/i;
/* Parêntese que é só o pavimento: "(TÉRREO)", "(2º PAVIMENTO)". "(PAVTO.
   TIPO)" não entra: é o andar-tipo, que são muitos — fica no nome. */
const PAV_ENTRE_PARENTESES = /^(?:\d{1,2}\s*[ºo°]?\s*)?(?:pavimento|pav\.?|andar|subsolo|terreo|atico|mezanino|sobreloja|cobertura)(?:\s+(?:superior|inferior|\d{1,2}))?$/;

/**
 * O pavimento que o próprio título do memorial nomeia: "TERRAÇO UNIDADES DO
 * 1º PAVIMENTO" → "1º PAVIMENTO"; "WCs PNE DA ÁREA COMUM DO TÉRREO" →
 * "TÉRREO"; "HALL (TÉRREO)" → "TÉRREO". O parêntese explicativo ("(TÉRREO
 * NO PROJETO LEGAL)") sai do nome e não entra no pavimento — é outra
 * numeração, a do projeto legal. O parêntese curto que distingue dois
 * lugares — "HALL ELEVADORES (GARAGENS)" e "HALL ELEVADORES (PAVTO. TIPO)"
 * — fica no nome: são dois locais do memorial, com acabamentos próprios.
 */
export function pavimentoNoNome(nome) {
  const qualificadores = [];
  let pavDoParentese = '';
  const semParentese = String(nome || '').replace(/\s*\(([^)]*)\)\s*/g, (_, dentro) => {
    const d = dentro.replace(/\s+/g, ' ').trim();
    if (!d || EXPLICATIVO.test(d)) return ' ';
    if (PAV_ENTRE_PARENTESES.test(normalizar(d))) { if (!pavDoParentese) pavDoParentese = d.toUpperCase(); return ' '; }
    if (d.split(' ').length <= 3) qualificadores.push(d);
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  const sufixo = qualificadores.length ? ' (' + qualificadores.join(', ') + ')' : '';
  const n = normalizar(semParentese);
  const m = PAV.exec(n);
  if (!m) return { nome: (semParentese + sufixo).trim(), pavimento: pavDoParentese };
  /* devolve o trecho como está escrito no título (acentos e maiúsculas):
     normalizar() preserva o comprimento, então o índice serve nos dois */
  const ini = n.indexOf(m[1]);
  const original = semParentese.slice(ini, ini + m[1].length).trim();
  /* o nome fica sem a preposição e o pavimento: "WCs PNE DA ÁREA COMUM" */
  const base = (semParentese.slice(0, m.index) + ' ' + semParentese.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ').replace(/[\s,;:–-]+$/, '').trim();
  return { nome: (base || semParentese) + sufixo, pavimento: original.toUpperCase() };
}

const VAZIAS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'no', 'na', 'nos', 'nas', 'em', 'a', 'o', 'as', 'os']);
const cerne = s => normalizar(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !VAZIAS.has(w)).join(' ');

/**
 * Mesmo nome sem as palavras vazias, ou um começando pelo outro: "HALL DE
 * ENTRADA" alcança "HALL"; "SALÃO DE FESTAS" alcança "SALÃO DE FESTAS /
 * ESPAÇO GOURMET"; "COPA DO SALÃO DE FESTAS" é "COPA SALÃO DE FESTAS".
 */
export function mesmoCerne(a, b) {
  const x = cerne(a), y = cerne(b);
  if (!x || !y || Math.min(x.length, y.length) < 4) return false;
  return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ');
}

/* Famílias de ambiente: nomes diferentes para o mesmo cômodo, na prancha e no
   memorial. O regex tem de consumir o nome inteiro (sobra só número ou um
   qualificador conhecido) — "SALA DE GINÁSTICA" não é da família "sala". */
const FAMILIAS = [
  [/^(?:banh(?:o|eiro)s?|b\.?\s?banh\w*|bwc|w\.?\s?c\.?s?|sanit[aá]rios?|toaletes?)/, 'banho'],
  [/^(?:dormit[oó]rios?|dorm\.?|quartos?)/, 'dormitorio'],
  [/^(?:su[ií]tes?)/, 'suite'],
  [/^(?:salas?(?: de)?(?: estar| jantar| tv| de estar| de jantar)?|estar|jantar|living)/, 'sala'],
  [/^(?:[aá]rea de servi[cç]o|a\.?\s?s\.?|servi[cç]o|lavanderia)/, 'servico'],
  [/^(?:cozinhas?|copa[\s/-]*cozinha|cozinha[\s/-]*copa)/, 'cozinha'],
  [/^(?:terra[cç]os?)/, 'terraco'],
  [/^(?:varandas?|sacadas?)/, 'varanda'],
  [/^(?:lavabos?)/, 'lavabo'],
  [/^(?:closets?|rouparias?)/, 'closet'],
  [/^(?:circula[cç][aã]o|circ\.?|corredor(?:es)?)/, 'circulacao'],
  [/^(?:halls?)/, 'hall'],
  [/^(?:garagem|estacionamento|vagas?)/, 'garagem'],
  [/^(?:despensas?|dep[oó]sitos?|dep\.?)/, 'deposito'],
];
const QUALIFICADOR = /^(?:\d{1,3}|master|social|casal|su[ií]te|[ií]ntim[oa]|pne|pcd|pcr|servi[cç]o|empregada|visita|solteiro|unidades?|apto|apartamento)?$/;

/**
 * A família do cômodo, quando o nome é simples o bastante para ter uma:
 * BANHEIRO, BANHO, BANHO MASTER, B.SERVIÇO e WC 02 são "banho"; DORMITÓRIOS,
 * DORM.01 e QUARTO CASAL são "dormitorio". "SALA DE GINÁSTICA" devolve ''.
 */
export function familiaDoNome(nome) {
  const n = normalizar(nome).replace(/[^a-z0-9.\/\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  for (const [re, fam] of FAMILIAS) {
    const m = re.exec(n);
    if (!m) continue;
    const resto = n.slice(m[0].length).replace(/^[\s.\-/]+/, '').trim();
    if (QUALIFICADOR.test(resto)) return fam;
  }
  return '';
}
