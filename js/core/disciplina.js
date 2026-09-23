/* Disciplina do documento — o que a prancha É, antes de decidir se vale lê-la.

   A pasta de um empreendimento traz tudo junto: arquitetura, estrutura,
   hidráulica, elétrica, ar-condicionado, modificações de unidade. Só a
   arquitetura (e o memorial descritivo) interessa ao levantamento de
   acabamentos; mandar uma planta de fôrma para a leitura vetorial e para a IA
   gasta chamadas e deixa lixo na árvore.

   Três fontes, nesta ordem de custo:
     1. o NOME das pastas e do arquivo (grátis, e às vezes errado: a pasta
        "EXECUTIVO" de um projeto real guardava pranchas de fôrma);
     2. o TEXTO da primeira página — numa planta raster só o carimbo tem
        texto, e o carimbo é exatamente onde a disciplina está escrita;
     3. a IA olhando a primeira página em resolução reduzida, só quando as
        duas anteriores não deram certeza e o BFF está ligado.

   Nada aqui decide sozinho o que apagar: um documento fora do escopo fica na
   lista, marcado, e a pessoa pode mudar a disciplina ou mandar ler mesmo
   assim. Sem servidor, as fontes 1 e 2 continuam funcionando. */

import { IA, chamarBff, anotarFalha, anotarSucesso } from './ia.js';

export const DISCIPLINAS = [
  { id: 'arquitetura',  nome: 'Arquitetura',               escopo: true },
  { id: 'acabamentos',  nome: 'Acabamentos',               escopo: true },
  { id: 'interiores',   nome: 'Interiores',                escopo: true },
  { id: 'memorial',     nome: 'Memorial descritivo',       escopo: true },
  { id: 'paisagismo',   nome: 'Paisagismo',                escopo: false },
  { id: 'modificacao',  nome: 'Modificação de unidade',    escopo: false },
  { id: 'estrutura',    nome: 'Estrutura',                 escopo: false },
  { id: 'hidraulica',   nome: 'Hidráulica',                escopo: false },
  { id: 'eletrica',     nome: 'Elétrica',                  escopo: false },
  { id: 'climatizacao', nome: 'Ar-condicionado',           escopo: false },
  { id: 'telecom',      nome: 'Telefonia e dados',         escopo: false },
  { id: 'incendio',     nome: 'Incêndio e gás',            escopo: false },
  { id: 'outra',        nome: 'Outra disciplina',          escopo: false },
  /* sem pista nenhuma o documento é lido, como sempre foi: o custo de pular
     uma prancha de arquitetura é maior que o de ler uma folha à toa */
  { id: 'indefinida',   nome: 'Não identificada',          escopo: true },
];
export const DISCIPLINA_POR_ID = Object.fromEntries(DISCIPLINAS.map(d => [d.id, d]));
const IDS = new Set(DISCIPLINAS.map(d => d.id));

export const disciplinaValida = id => IDS.has(id);
export const emEscopo = id => (DISCIPLINA_POR_ID[id] || DISCIPLINA_POR_ID.indefinida).escopo;
export const nomeDisciplina = id => (DISCIPLINA_POR_ID[id] || DISCIPLINA_POR_ID.indefinida).nome;

/* sem acento e em maiúsculas: "HIDRÁULICO", "Hidraulica" e "hidr." caem na
   mesma regra */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  /* "PLANTA-BAIXA" e "PLANTA_BAIXA" são "PLANTA BAIXA"; a sigla entre hifens vira palavra */
  .replace(/[-_.]+/g, ' ');

/* [disciplina, regex sobre o texto normalizado, peso]
   Peso 3 = título explícito; 2 = palavra da disciplina; 1 = sigla curta ou
   palavra que outras disciplinas também usam. Cada regra conta uma vez por
   fonte, não por ocorrência. */
const REGRAS = [
  ['memorial',     /MEMORIAL DESCRITIVO|MEMORIAL DE (ESPECIFICACOES|VENDAS?|INCORPORACAO)|CADERNO DE ESPECIFICACOES|ESPECIFICACOES TECNICAS/, 3],
  ['memorial',     /\bMEMORIAL\b(?! DE (CALCULO|ACABAMENTO))/, 2],
  ['arquitetura',  /PROJETO ARQUITETONICO|ARQUITETURA|ARQUITETONIC|PLANTA BAIXA|PLANTA DE (LAYOUT|COBERTURA)/, 3],
  ['arquitetura',  /ARQUITET|\bARQ\b|ESQUADRIA|FACHADA|LAYOUT|\bFORRO\b/, 2],
  ['arquitetura',  /\bCORTES?\b|\bDETALHAMENTO\b|\bPISOS?\b/, 1],
  /* o PDF "de acabamento": caderno, tabela, quadro, paginação, planta de piso
     e forro. É arquitetura no sentido largo, mas é o documento que o
     levantamento mais quer, e a pessoa quer vê-lo nomeado assim */
  ['acabamentos',  /CADERNO DE ACABAMENTO|TABELA DE ACABAMENTO|PLANTA DE ACABAMENTO|QUADRO DE ACABAMENTO|MEMORIAL DE ACABAMENTO|ESPECIFICACAO DE ACABAMENTO|ACABAMENTOS?\b|PAGINACAO|PLANTA DE (PISO|FORRO)|REVESTIMENTOS?\b/, 3],
  ['acabamentos',  /\bACAB\b|\bPAG\b|\bREV\b(?! ?\d)/, 2],
  ['interiores',   /DESIGN DE INTERIOR|INTERIORES|MARCENARIA|MOBILIARIO|DECORAC/, 2],
  ['interiores',   /\bINT\b/, 1],
  ['estrutura',    /PROJETO ESTRUTURAL|CALCULO ESTRUTURAL|PLANTA DE FORMA|\bFORMAS\b|ARMACAO|FUNDAC|CONCRETO ARMADO|ESTRUTURA METALICA/, 3],
  ['estrutura',    /ESTRUTUR|\bEST\b|\bFOR\b|\bFUN\b|\bARM\b|\bSAPATA|\bESTACA|\bBLOCO DE COROAMENTO/, 2],
  ['estrutura',    /\bPILAR|\bVIGA|\bLAJE/, 1],
  ['hidraulica',   /HIDROSSANITARI|HIDRAULIC|AGUA FRIA|AGUA QUENTE|ESGOTO|AGUAS PLUVIAIS|DRENAGEM|BARRILETE|RESERVATORIO/, 3],
  ['hidraulica',   /\bHIDR|\bHID\b|\bHD\b|SANITARI|PLUVIA|\bESG\b/, 2],
  ['eletrica',     /PROJETO ELETRICO|ELETRICA|LUMINOTECNIC|\bSPDA\b|QUADRO DE CARGAS|FOTOVOLTAIC|SUBESTAC/, 3],
  ['eletrica',     /ELETRIC|\bELE\b|ILUMINACAO/, 2],
  ['eletrica',     /\bEL\b|TOMADAS|INTERRUPTOR/, 1],
  ['climatizacao', /AR[- ]CONDICIONADO|CLIMATIZAC|\bHVAC\b|VENTILACAO MECANICA|EXAUSTAO/, 3],
  ['climatizacao', /\bAC\b|\bVRF\b|\bSPLIT\b|VENTILAC/, 2],
  ['telecom',      /TELEFONI|TELECOM|CABEAMENTO ESTRUTURADO|\bCFTV\b|INTERFON|AUTOMACAO|SEGURANCA ELETRONICA/, 3],
  ['telecom',      /\bTEL\b|\bDADOS\b|\bREDE\b|\bAUDIO\b|\bVIDEO\b|\bLOGICA\b/, 1],
  ['incendio',     /INCENDIO|\bPPCI\b|\bPCI\b|SPRINKLER|HIDRANTE|BOMBEIRO/, 3],
  ['incendio',     /\bGLP\b|\bGAS\b|\bGN\b|ALARME/, 2],
  ['paisagismo',   /PAISAGIS|VEGETAC|JARDIM/, 2],
  ['paisagismo',   /\bPAI\b/, 1],
  ['modificacao',  /MODIFICAC|PERSONALIZAC|CUSTOMIZAC|REFORMA DO APARTAMENTO/, 3],
  ['modificacao',  /\bAPTO?\.? ?\d{2,4}\b|\bAPARTAMENTO \d{2,4}\b|\bUNIDADE \d{2,4}\b|\bREFORMA\b/, 2],
  ['modificacao',  /\bCROQUI\b/, 1],
  ['outra',        /TOPOGRAF|TERRAPLEN|IMPERMEABILIZAC|ACESSIBILIDADE|SONDAGEM|ORCAMENTO|CRONOGRAMA|\bTOP\b|\bIMP\b/, 2],
];

/* quanto vale cada fonte: a pasta é a intenção de quem organizou o projeto,
   o arquivo costuma trazer a sigla da disciplina, o carimbo é a prova */
const PESO_FONTE = { pasta: 3, arquivo: 2, carimbo: 2 };

/**
 * O texto do carimbo de uma prancha: os itens de texto do pdf.js que caem no
 * canto inferior direito ou na faixa direita da folha — onde o carimbo mora.
 *
 * Não serve o texto da página inteira: uma prancha de arquitetura vetorial
 * fala de "elétrica", "interfone", "marcenaria" e "jardim" na legenda de
 * acabamentos, e o texto todo empata todas as disciplinas. O carimbo diz
 * uma só.
 *
 * @param {{ items: Array<{ str: string, transform: number[] }> }} textContent  de page.getTextContent()
 * @param {{ width: number, height: number }} viewport                            de page.getViewport({ scale: 1 })
 */
export function textoDoCarimbo(textContent, viewport) {
  const W = viewport.width, H = viewport.height;
  const itens = (textContent && textContent.items) || [];
  const noCarimbo = it => {
    const t = it.transform || [];
    const x = t[4], y = t[5];
    if (!(x >= 0 && y >= 0)) return false;
    return (x > 0.72 * W && y < 0.30 * H) || x > 0.88 * W;
  };
  return itens.filter(noCarimbo).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Classifica pelo nome (pastas + arquivo) e, se houver, pelo texto da página.
 *
 * @param {object} p
 * @param {string} p.nome     nome do arquivo
 * @param {string} p.caminho  pastas de onde veio ("PARADISO/HIDRÁULICO/"), ou ''
 * @param {string} p.carimbo  texto extraído da primeira página, ou ''
 * @param {string} p.tipo     'prancha' | 'memorial' quando já se sabe pelo tamanho da página
 * @returns {{ disciplina: string, confianca: 'alta'|'media'|'baixa', evidencia: string[], pontos: object }}
 */
export function classificarPorNome({ nome = '', caminho = '', carimbo = '', tipo = '' } = {}) {
  const fontes = {
    pasta: norm(caminho),
    arquivo: norm(nome).replace(/\.PDF$/, ''),
    /* só o começo: o carimbo e os títulos vêm antes do texto miúdo, e uma
       página de memorial tem milhares de caracteres que não dizem nada */
    carimbo: norm(carimbo).slice(0, 6000),
  };
  const pontos = {};
  const evidencia = [];
  for (const [fonte, texto] of Object.entries(fontes)) {
    if (!texto) continue;
    /* por fonte, cada disciplina vale a sua regra mais forte — "ELÉTRICA"
       casa a regra do título e a da palavra, e não pode contar duas vezes */
    const melhor = {};
    for (const [disc, re, peso] of REGRAS) {
      const m = re.exec(texto);
      if (!m) continue;
      if (!melhor[disc] || peso > melhor[disc].peso) melhor[disc] = { peso, trecho: m[0].trim() };
    }
    for (const [disc, { peso, trecho }] of Object.entries(melhor)) {
      pontos[disc] = (pontos[disc] || 0) + peso * PESO_FONTE[fonte];
      evidencia.push(`${fonte}: «${trecho}» → ${nomeDisciplina(disc)}`);
    }
  }
  const ordem = Object.entries(pontos).sort((a, b) => b[1] - a[1]);
  let disciplina = 'indefinida';
  let confianca = 'baixa';
  if (ordem.length) {
    const [top, p1] = ordem[0];
    const p2 = ordem[1] ? ordem[1][1] : 0;
    if (p1 > p2) {
      disciplina = top;
      confianca = p1 >= 6 && p1 >= 2 * p2 ? 'alta' : p1 >= 3 ? 'media' : 'baixa';
    } else {
      evidencia.push(`empate entre ${nomeDisciplina(top)} e ${nomeDisciplina(ordem[1][0])}`);
    }
  }
  /* o tamanho da página desempata o que o nome confunde: uma folha grande
     chamada "memorial de acabamentos" é uma prancha de arquitetura; um
     documento de texto sobre arquitetura é o memorial */
  if (tipo === 'prancha' && disciplina === 'memorial') disciplina = 'arquitetura';
  if (tipo === 'memorial' && (disciplina === 'arquitetura' || disciplina === 'interiores' || disciplina === 'indefinida')) disciplina = 'memorial';
  return { disciplina, confianca, evidencia, pontos };
}

/* ------------------------------------------------------------------ */
/* O LADO: área comum ou unidade privativa                              */
/* ------------------------------------------------------------------ */

/* Um PDF de acabamento costuma dizer no nome, na pasta ou no carimbo de que
   manual ele é: "ÁREAS COMUNS", "PAVIMENTO TIPO", "APTO TIPO 1". O motor das
   pranchas já decide o lado pelo nome do cômodo e pela maioria da folha; o
   lado do documento entra como desempate para os nomes que sozinhos não
   dizem nada (CIRCULAÇÃO, WC, DEPÓSITO) — e como grupo inicial do memorial
   que não traz os marcadores "ÁREAS COMUNS" / "ÁREAS PRIVATIVAS". */
const REGRAS_LADO = [
  ['comum',     /AREAS? COMUNS?|AREA COMUM|USO COMUM|MANUAL DO CONDOMINIO|\bCONDOMINIO\b/, 3],
  ['comum',     /\bLAZER\b|SALAO DE FESTAS|\bPORTARIA\b|\bGUARITA\b|\bGARAGEM\b|\bSUBSOLO\b|\bPILOTIS\b|\bHALL\b|\bPISCINA\b|\bPLAYGROUND\b|\bACADEMIA\b|\bCHURRASQ|\bCOBERTURA COLETIVA\b|\bAREAS? EXTERNAS?\b/, 2],
  ['comum',     /\bTERREO\b/, 1],
  ['privativa', /AREAS? PRIVATIVAS?|UNIDADES? (AUTONOMAS?|PRIVATIVAS?|HABITACIONA)|MANUAL DO PROPRIETARIO|PAV(IMENTO)? TIPO|\bTIPO \d|\bTIPO PNE\b|\bTIPOLOGIA/, 3],
  ['privativa', /\bAPTOS?\b|\bAPARTAMENTOS?\b|\bUNIDADES?\b|\bCASAS?\b|\bLOTES?\b|\bSUITE|\bDORMITORIO/, 2],
  ['privativa', /\bTIPO\b/, 1],
];

/**
 * O lado que pastas, nome e carimbo revelam: 'comum', 'privativa' ou ''.
 * Mesma mecânica da disciplina: melhor regra por fonte, fontes somadas.
 */
export function ladoDoDocumento({ nome = '', caminho = '', carimbo = '' } = {}) {
  const fontes = { pasta: norm(caminho), arquivo: norm(nome).replace(/\.PDF$/, ''), carimbo: norm(carimbo).slice(0, 6000) };
  const pontos = { comum: 0, privativa: 0 };
  const evidencia = [];
  for (const [fonte, texto] of Object.entries(fontes)) {
    if (!texto) continue;
    const melhor = {};
    for (const [lado, re, peso] of REGRAS_LADO) {
      const m = re.exec(texto);
      if (m && (!melhor[lado] || peso > melhor[lado].peso)) melhor[lado] = { peso, trecho: m[0].trim() };
    }
    for (const [lado, { peso, trecho }] of Object.entries(melhor)) {
      pontos[lado] += peso * PESO_FONTE[fonte];
      evidencia.push(`${fonte}: «${trecho}» → ${lado === 'comum' ? 'área comum' : 'unidade privativa'}`);
    }
  }
  const [p1, p2] = [pontos.comum, pontos.privativa];
  if (p1 === p2) return { lado: '', confianca: 'baixa', evidencia };
  const lado = p1 > p2 ? 'comum' : 'privativa';
  const top = Math.max(p1, p2), outro = Math.min(p1, p2);
  return { lado, confianca: top >= 6 && top >= 2 * outro ? 'alta' : top >= 3 ? 'media' : 'baixa', evidencia };
}

/**
 * Pergunta à IA, mandando a primeira página em resolução baixa e o que a
 * heurística já achou. Devolve null quando a IA não respondeu com evidência
 * (sem justificativa não entra — a mesma regra de todo o resto).
 *
 * `imagem` é uma função assíncrona que renderiza a página só se chegar aqui:
 * quando a heurística já tem certeza, ninguém paga pelo render.
 */
export async function classificarComIA({ nome = '', caminho = '', texto = '', imagem, heuristica = null } = {}) {
  const dataUrl = typeof imagem === 'function' ? await imagem() : imagem;
  if (!dataUrl) return null;
  const r = await chamarBff(IA.rotaDisciplina, {
    documento: nome, caminho, texto: String(texto || '').slice(0, 4000), imagem: dataUrl,
    heuristica: heuristica ? {
      disciplina: heuristica.disciplina, confianca: heuristica.confianca, evidencia: heuristica.evidencia.slice(0, 8),
      lado: heuristica.lado || '', ladoEvidencia: (heuristica.ladoEvidencia || []).slice(0, 6),
    } : null,
  }, IA.timeoutMs);
  if (!r || !r.disciplina || !disciplinaValida(r.disciplina) || !r.justificativa) return null;
  return {
    disciplina: r.disciplina,
    tipoDocumento: ['prancha', 'memorial', 'outro'].includes(r.tipoDocumento) ? r.tipoDocumento : '',
    lado: r.lado === 'comum' || r.lado === 'privativa' ? r.lado : '',
    titulo: String(r.titulo || ''),
    confianca: ['alta', 'media', 'baixa'].includes(r.confianca) ? r.confianca : 'baixa',
    justificativa: String(r.justificativa),
  };
}

/**
 * O caminho completo: nome → carimbo → IA (quando ligada e ainda há dúvida).
 * Nunca lança: uma falha da IA vira nota na evidência e a heurística vale.
 *
 * @returns {{ disciplina, confianca, evidencia: string[], origem: 'heuristica'|'ia', tipoDocumento: string, titulo: string }}
 */
export async function identificarDisciplina({ nome, caminho = '', carimbo = '', tipo = '', ia = false, imagem = null } = {}) {
  const h = classificarPorNome({ nome, caminho, carimbo, tipo });
  const l = ladoDoDocumento({ nome, caminho, carimbo });
  const base = {
    ...h, origem: 'heuristica', tipoDocumento: '', titulo: '',
    lado: l.lado, ladoConfianca: l.confianca, ladoEvidencia: l.evidencia, ladoOrigem: l.lado ? 'heuristica' : '',
  };
  /* a IA entra quando a disciplina ou o lado ficou em dúvida — o lado só
     importa nos documentos que vão ser lidos */
  const ladoEmDuvida = emEscopo(h.disciplina) && (!l.lado || l.confianca === 'baixa');
  if (!ia || !imagem || (h.confianca === 'alta' && !ladoEmDuvida)) return base;
  try {
    const r = await classificarComIA({ nome, caminho, texto: carimbo, imagem, heuristica: { ...h, lado: l.lado, ladoEvidencia: l.evidencia } });
    if (!r) { base.evidencia.push('IA: sem resposta com evidência — vale a heurística'); return base; }
    anotarSucesso();
    return {
      disciplina: r.disciplina, confianca: r.confianca,
      evidencia: [...h.evidencia, `IA: ${r.justificativa}`],
      origem: 'ia', tipoDocumento: r.tipoDocumento, titulo: r.titulo,
      lado: r.lado || l.lado,
      ladoConfianca: r.lado ? r.confianca : l.confianca,
      ladoEvidencia: r.lado ? [...l.evidencia, `IA: ${r.justificativa}`] : l.evidencia,
      ladoOrigem: r.lado ? 'ia' : (l.lado ? 'heuristica' : ''),
    };
  } catch (err) {
    anotarFalha(err, 'disciplina do documento');
    base.evidencia.push(`IA falhou (${err.message}) — vale a heurística`);
    return base;
  }
}
