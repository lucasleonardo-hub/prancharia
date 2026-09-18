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

/**
 * Título de seção do memorial que muda o grupo de tudo o que vem depois:
 * "ÁREAS COMUNS", "ÁREAS PRIVATIVAS", "UNIDADES AUTÔNOMAS", "APARTAMENTOS".
 */
export function marcadorDeGrupo(titulo) {
  const n = normalizar(titulo).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (/\b(?:areas?|ambientes?|dependencias?|espacos?)\s+(?:comuns?|condominiais?|coletiv[oa]s?|de uso comum|de lazer)\b/.test(n)
    || /\buso comum\b/.test(n) || /^(?:condominio|areas? sociais?|lazer)$/.test(n)) return 'comum';
  if (/\b(?:areas?|unidades?|dependencias?)\s+(?:privativas?|autonomas?|habitacionais?|residenciais?)\b/.test(n)
    || /^(?:apartamentos?|unidades?|casas?|aptos?|tipologias?)(?:\s+tipo.*)?$/.test(n)
    || /^(?:apartamentos?|unidades?)\s+(?:tipo|padrao|de \d)/.test(n)) return 'privativa';
  return null;
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
  const m = /^(?:(?:APTO|APARTAMENTO|AP|UNIDADE|UNID|CASA|LOJA|SALA|QUARTO)\.?\s+)?(?:TIPO|TIPOLOGIA|TP)\.?\s*[-–:]?\s*(?:(PNE|PCD|PCR|PMR|ACESSIVEL)\s*)?[-–]?\s*(\d{1,3}|[A-Z]{1,2}\d?)(?:\s*[-–]?\s*(PNE|PCD|PCR|PMR|ACESSIVEL))?$/.exec(s);
  if (!m) return null;
  const marca = m[1] || m[3] || '';
  /* "TIPO 03" e "TIPO 3" são a mesma tipologia: o zero à esquerda é grafia da
     prancha (ou da leitura por imagem), não identidade */
  const numero = /^\d+$/.test(m[2]) ? String(Number(m[2])) : m[2];
  return `TIPO ${marca ? marca + ' ' : ''}${numero}`;
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

/**
 * O pavimento que o próprio título do memorial nomeia: "TERRAÇO UNIDADES DO
 * 1º PAVIMENTO" → "1º PAVIMENTO"; "WCs PNE DA ÁREA COMUM DO TÉRREO" →
 * "TÉRREO". O parêntese explicativo ("(TÉRREO NO PROJETO LEGAL)") sai do
 * nome e não entra no pavimento — é outra numeração, a do projeto legal.
 */
export function pavimentoNoNome(nome) {
  const semParentese = String(nome || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const n = normalizar(semParentese);
  const m = PAV.exec(n);
  if (!m) return { nome: semParentese, pavimento: '' };
  /* devolve o trecho como está escrito no título (acentos e maiúsculas):
     normalizar() preserva o comprimento, então o índice serve nos dois */
  const ini = n.indexOf(m[1]);
  const original = semParentese.slice(ini, ini + m[1].length).trim();
  /* o nome fica sem a preposição e o pavimento: "WCs PNE DA ÁREA COMUM" */
  const base = (semParentese.slice(0, m.index) + ' ' + semParentese.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ').replace(/[\s,;:–-]+$/, '').trim();
  return { nome: base || semParentese, pavimento: original.toUpperCase() };
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
