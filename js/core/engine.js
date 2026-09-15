/* Motor de análise documental.
   Entra um PDF, saem ambientes, tags, tabelas e achados — cada um com a
   evidência que o sustenta. Nenhum campo é preenchido sem origem. */

import { openPdf, walkPaths, readText, isRed, naFilaDeRender } from './pdfdoc.js';
import { coletorDeFormas, montarTags, FORMAS } from './shapes.js';
import { lerAmbientes, lerPavimentos, lerTipologias, atribuirTipologias, criarMascara, vincularTags, janelasDePlanta } from './rooms.js';
import { classificarArea, lerTipologia, partesDoNome, familiaDoNome, mesmoCerne } from './areas.js';
import { temAreasComuns, temNivel } from './tipos.js';
import { coletorDeFios, lerTabela } from './tables.js';
import { lerLegendas, categoriaDe } from './legend.js';
import { lerQuadros, caixasDeQuadros } from './quadros.js';
import {
  novoId, mesmoAmbienteFlex as mesmoAmbiente, normalizar, casarAmbientes,
  criarLocal, criarEspecificacao, criarEvidencia,
  todasEspecificacoes, sincronizar,
} from './model.js';
import { classificar, lerSecaoEsquadria } from './glossario.js';
import { IA, iaLigada, chamarBff, anotarFalha, anotarSucesso } from './ia.js';

const TITULOS = [
  { tipo: 'esquadrias', re: /^(TABELA|QUADRO)\s+DE\s+ESQUADRIAS/i },
  { tipo: 'pedras', re: /^(BAGUETES|SOLEIRAS|PEITORIS|QUADRO\s+DE\s+PEDRAS)/i },
  { tipo: 'legenda_ambientes', re: /^LEGENDA\s+(DE\s+|DOS?\s+)?(PISO|PISOS|PAREDE|PAREDES|TETO|TETOS|FORRO|FORROS|REVESTIMENTO|REVESTIMENTOS|ACABAMENTO|ACABAMENTOS|MATERIAI?S?)\b/i },
];

export async function analisarDocumento(bytes, docMeta, aoProgredir = () => {}) {
  const doc = await openPdf(bytes);
  const folhas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    await aoProgredir(`página ${n} de ${doc.numPages}`, (n - 1) / doc.numPages);
    folhas.push(await analisarFolha(doc, n, docMeta, aoProgredir));
  }
  return { doc, folhas };
}

/* ------------------------------------------------------------------ */
/* PIPELINE HÍBRIDO                                                    */
/*                                                                     */
/* Passo 1 — VETORIAL, SEMPRE (analisarFolha): rooms.js lê os ambientes, */
/*   shapes.js/legend.js leem tags e legendas, tables.js/quadros.js     */
/*   leem as tabelas. É rápido, exato onde há texto e grade, e não      */
/*   depende de rede.                                                   */
/* Passo 2 — EMPACOTAR (consolidar → processarComIAHibrida): o que o    */
/*   vetor já montou vira JSON e vai para a IA junto com os recortes.   */
/* Passo 3 — REVISÃO PELA IA (server/prompt.js): a IA verifica se falta */
/*   algo e preenche lacunas. Cada item volta com `acao`: confirmar,    */
/*   completar ou novo, e com a justificativa de onde saiu — sem ela o  */
/*   servidor descarta. `mesclarLeituras` aplica o resultado por cima   */
/*   da leitura vetorial, que nunca é substituída.                      */
/*                                                                     */
/* `aoProgredir(texto, fracao)` pode devolver uma Promise: o engine     */
/* espera por ela, o que dá ao navegador a chance de pintar a barra.    */
/* ------------------------------------------------------------------ */

/* Um título pode chegar partido em vários pedaços de texto ("LEGENDA" e
   "PISO" separados pelo espaçamento do desenho). Junta o que está na mesma
   linha, à direita, enquanto o vão for pequeno. */
function juntarLinha(inicio, textos) {
  const mesma = textos.filter(o => o.horizontal && Math.abs(o.y - inicio.y) < 3.2
    && o.x >= inicio.x - 0.5 && o.x < inicio.x + 260)
    .sort((a, b) => a.x - b.x);
  let s = '', fim = null;
  for (const o of mesma) {
    if (fim !== null && o.x - fim > 46) break;
    s += (s ? ' ' : '') + o.str.trim();
    fim = o.x + o.w;
  }
  return s.replace(/\s+/g, ' ').trim();
}

export async function analisarFolha(doc, numero, docMeta, aoProgredir = () => {}) {
  const page = await doc.getPage(numero);
  const vp = page.getViewport({ scale: 1 });
  await aoProgredir('lendo traçados', 0.1);

  const formas = coletorDeFormas(isRed);
  const fios = coletorDeFios();
  const mascara = criarMascara(vp.width, vp.height, 0.6);
  await walkPaths(page, p => { formas.visit(p); fios.visit(p); mascara.visit(p); });
  const mask = mascara.finalizar();
  const textos = await readText(page);
  await aoProgredir('lendo tags e legendas', 0.5);

  const tags = montarTags(formas.resultado, textos);
  const usadas = new Set(tags.map(t => Math.round(t.x) + ':' + Math.round(t.y)));
  const semNumero = formas.resultado.filter(c => !usadas.has(Math.round(c.cx) + ':' + Math.round(c.cy)));
  const legendas = lerLegendas(semNumero, textos);

  /* Os quadros primeiro: uma vez que se sabe ONDE estão as tabelas, o leitor
     de rótulos pode ignorar aquela região por completo — a coluna de ambientes
     de um quadro tem o nome certo e a tipografia certa, e não é planta. */
  const quadros = lerQuadros(textos);
  const ambientes = lerAmbientes(textos, caixasDeQuadros(quadros));
  const pavimentos = lerPavimentos(textos);
  const tipologias = lerTipologias(textos);
  const janelas = janelasDePlanta(ambientes.filter(a => a.confianca === 'alta'));

  await aoProgredir('vinculando tags aos ambientes', 0.7);
  const vinculos = ambientes.length
    ? vincularTags(mask, ambientes, tags, [0, 0, vp.width, vp.height])
    : tags.map(t => ({ tag: t, ambiente: null, folga: Infinity }));

  /* Em ambiente pequeno o projetista desenha o bloco de tags do lado de fora,
     e a leitura por dentro das paredes não alcança. Nesses casos o vínculo é
     proposto pela distância até o rótulo mais próximo — e sai marcado como
     proposta, com o segundo colocado à vista, para você confirmar. */
  for (const v of vinculos) {
    if (v.ambiente || !ambientes.length) continue;
    const perto = ambientes
      .map(a => ({ a, d: Math.hypot(a.x - v.tag.x, a.y - v.tag.y) }))
      .sort((p, q) => p.d - q.d);
    if (!perto.length || perto[0].d > 180) continue;
    v.ambiente = perto[0].a;
    v.distancia = perto[0].d;
    v.segundo = perto[1] ? perto[1].a : null;
    v.distancia2 = perto[1] ? perto[1].d : null;
    v.folga = perto[1] ? perto[1].d / Math.max(1, perto[0].d) : Infinity;
    v.porProximidade = true;
  }

  // pavimento (e torre) de cada ambiente: a legenda de planta mais próxima em x
  for (const a of ambientes) {
    let melhor = null, d = Infinity;
    for (const p of pavimentos) { const dd = Math.abs(p.x - a.x); if (dd < d) { d = dd; melhor = p; } }
    a.pavimento = melhor && d < 500 ? melhor.nome : '';
    a.grupo = melhor && d < 500 ? (melhor.grupo || '') : '';
  }
  /* tipologia de cada ambiente: o rótulo "TIPO 1" da unidade em que ele está,
     medido pelo espaço livre — a parede entre dois apartamentos separa os dois */
  atribuirTipologias(mask, ambientes, tipologias, [0, 0, vp.width, vp.height]);

  await aoProgredir('lendo tabelas', 0.85);
  const titulos = [];
  for (const t of textos) {
    if (!t.horizontal) continue;
    const s = juntarLinha(t, textos);
    for (const k of TITULOS) if (k.re.test(s)) { titulos.push({ ...k, texto: s, x: t.x + t.w / 2, y: t.y }); break; }
  }
  const tabelas = [];
  for (const ti of titulos) {
    const abaixo = titulos.filter(o => o !== ti && o.y > ti.y + 16 && Math.abs(o.x - ti.x) < 420).map(o => o.y);
    const limiteY = abaixo.length ? Math.min(...abaixo) - 6 : undefined;
    const tb = lerTabela(ti, fios.resultado, textos, { limiteY });
    if (tb && tb.linhas.length > 1) tabelas.push({ tipo: ti.tipo, titulo: ti.texto, x: ti.x, y: ti.y, ...tb });
  }

  /* Uma tabela, um leitor. O `tables.js` lê pela grade desenhada e conhece o
     tipo (esquadrias, pedras, legenda de ambientes); o `quadros.js` lê sem
     grade e é genérico. Onde os dois alcançam a mesma região, vale o
     específico — senão o mesmo quadro entraria duas vezes na árvore. */
  const cobre = (a, b) => a && b
    && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const quadrosNovos = quadros.filter(q => !tabelas.some(t => cobre(q.caixa, t.caixa)));

  return {
    id: novoId('fl'), documentoId: docMeta.id, pagina: numero,
    largura: vp.width, altura: vp.height,
    page,                       // usada pelo motor de recortes; não é persistida
    ambientes, pavimentos, tipologias, janelas, tags, vinculos, legendas, tabelas, quadros: quadrosNovos,
    contagem: { tracos: 0, tags: tags.length, ambientes: ambientes.length },
  };
}

/* ------------------------------------------------------------------ */
/* MOTOR DE RECORTES                                                   */
/*                                                                     */
/* O rooms.js e o legend.js viraram radar de coordenadas: dizem ONDE   */
/* está o local e ONDE está a legenda. Daqui sai a imagem daquela      */
/* região, que é o que o motor multimodal vai receber.                 */
/* ------------------------------------------------------------------ */

export const OPCOES_RECORTE = {
  /* A janela do local cresce bem mais que antes (ver janelaDoLocal) para
     alcançar esquadria longe do rótulo do ambiente; sem subir a largura de
     saída junto, essa área maior perderia nitidez no texto miúdo. */
  larguraLocal: 1600,      // Nível 2 — a região do local
  larguraDetalhe: 900,     // Nível 3 — o zoom no ponto exato
  larguraLegenda: 1000,
  /* Um quadro de acabamentos tem texto de 7,8 pt numa folha de 3370 pt. Para a
     IA ler a linha, o recorte precisa de resolução: 1800 px na largura do
     quadro dá ~4× o tamanho original, e é o que faz a diferença entre ler
     "CR-703" e chutar. A folha inteira vai em 2600 px, e mesmo assim serve só
     como último recurso — recorte de região lê muito melhor. */
  larguraQuadro: 1800,
  larguraFolha: 2600,
  formato: 'image/jpeg',
  qualidade: 0.82,
};

function limitar(caixa, base) {
  let [x0, y0, x1, y1] = caixa;
  if (x1 - x0 < 40) { const m = (x0 + x1) / 2; x0 = m - 20; x1 = m + 20; }
  if (y1 - y0 < 30) { const m = (y0 + y1) / 2; y0 = m - 15; y1 = m + 15; }
  return [Math.max(0, x0), Math.max(0, y0), Math.min(base.width, x1), Math.min(base.height, y1)];
}

/** Janela de leitura em volta do rótulo do local — Nível 2.

    NÃO existe polígono de parede neste sistema: o que temos é a caixa do
    TEXTO do nome do ambiente. Esquadria fica na parede, quase sempre longe
    de onde o nome está escrito — então a janela precisa alcançar bem mais
    que o texto para não cortar a porta/janela fora da imagem que a IA vê.
    O contrapeso é `outrasCaixas`: os rótulos dos ambientes VIZINHOS nesta
    mesma folha. A janela cresce generosamente, mas encolhe antes de
    engolir o nome de outro local — é isso que preserva a R3 (isolamento
    estrito do local) sem depender de escala ou de detecção de parede. */
export function janelaDoLocal(caixaRotulo, base, opts = {}) {
  if (!caixaRotulo) return [0, 0, base.width, base.height];
  const { folga = 9, outrasCaixas = [] } = Array.isArray(opts) ? { outrasCaixas: opts } : opts;
  const [x0, y0, x1, y1] = caixaRotulo;
  const l = Math.max(520, (x1 - x0) * folga), a = Math.max(420, (y1 - y0) * folga * 1.6);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let [wx0, wy0, wx1, wy1] = [cx - l / 2, cy - a / 2, cx + l / 2, cy + a / 2];

  for (const outra of outrasCaixas) {
    if (!outra) continue;
    const [ox0, oy0, ox1, oy1] = outra;
    const ocx = (ox0 + ox1) / 2, ocy = (oy0 + oy1) / 2;
    if (ocx <= wx0 || ocx >= wx1 || ocy <= wy0 || ocy >= wy1) continue; // fora da janela, não ameaça
    // o rótulo vizinho caiu dentro da janela: encolhe o lado dele até sobrar folga mínima
    if (ocx >= cx) wx1 = Math.min(wx1, Math.max(cx + 60, ocx - 16));
    else wx0 = Math.max(wx0, Math.min(cx - 60, ocx + 16));
    if (ocy >= cy) wy1 = Math.min(wy1, Math.max(cy + 60, ocy - 16));
    else wy0 = Math.max(wy0, Math.min(cy - 60, ocy + 16));
  }
  return limitar([wx0, wy0, wx1, wy1], base);
}

/** Janela fechada no ponto exato de onde o dado saiu — Nível 3. */
export function janelaDoDetalhe(caixa, base) {
  if (!caixa) return null;
  const [x0, y0, x1, y1] = caixa;
  const dx = Math.max(30, (x1 - x0) * 1.6), dy = Math.max(24, (y1 - y0) * 2.2);
  return limitar([x0 - dx, y0 - dy, x1 + dx, y1 + dy], base);
}

/** Caixa que cobre todos os blocos de legenda lidos na folha. */
export function caixaDasLegendas(folha) {
  const caixas = (folha.legendas?.blocos || []).map(b => b.caixa).filter(Boolean);
  if (!caixas.length) return null;
  return [
    Math.min(...caixas.map(c => c[0])) - 10, Math.min(...caixas.map(c => c[1])) - 10,
    Math.max(...caixas.map(c => c[2])) + 10, Math.max(...caixas.map(c => c[3])) + 10,
  ];
}

async function blobParaDataURL(blob) {
  if (typeof FileReader === 'undefined') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return `data:${blob.type};base64,${btoa(bin)}`;
  }
  return await new Promise((ok, erro) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result); fr.onerror = erro;
    fr.readAsDataURL(blob);
  });
}

/**
 * Renderiza uma região da prancha num canvas em memória e devolve o DataURL.
 * É a evidência visual que vai no corpo da requisição do motor multimodal.
 */
export async function recorteBase64(page, caixa, opcoes = {}) {
  if (!page || !caixa) return null;
  const { largura = OPCOES_RECORTE.larguraLocal, formato = OPCOES_RECORTE.formato,
          qualidade = OPCOES_RECORTE.qualidade } = opcoes;
  const base = page.getViewport({ scale: 1 });
  const [x0, y0, x1, y1] = limitar(caixa, base);
  const escala = Math.min(4, Math.max(0.4, largura / Math.max(24, x1 - x0)));
  const w = Math.max(1, Math.round((x1 - x0) * escala));
  const h = Math.max(1, Math.round((y1 - y0) * escala));
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  await naFilaDeRender(async () => {
    try {
      await page.render({
        canvasContext: ctx, viewport: page.getViewport({ scale: escala }),
        transform: [1, 0, 0, 1, -x0 * escala, -y0 * escala],
      }).promise;
    } catch { /* render cancelado */ }
  });
  const blob = await cv.convertToBlob({ type: formato, quality: qualidade });
  return await blobParaDataURL(blob);
}

/* ------------------------------------------------------------------ */
/* ONDE PROCURAR PRODUTO NUMA FOLHA                                     */
/*                                                                     */
/* A leitura ampla precisa saber que pedaços da folha vale mandar para  */
/* a IA. Mandar a A0 inteira desperdiça resolução onde não há dado: o    */
/* texto do quadro tem 7,8 pt em 3370 pt de largura, e reduzido para    */
/* caber numa imagem ele deixa de ser legível. Então a preferência é    */
/* sempre por REGIÃO, e a folha inteira é último recurso.               */
/* ------------------------------------------------------------------ */

const uniao = (caixas) => caixas.length ? [
  Math.min(...caixas.map(c => c[0])), Math.min(...caixas.map(c => c[1])),
  Math.max(...caixas.map(c => c[2])), Math.max(...caixas.map(c => c[3])),
] : null;

const encosta = (a, b, folga = 70) => a && b
  && a[0] - folga < b[2] && a[2] + folga > b[0] && a[1] - folga < b[3] && a[3] + folga > b[1];

/** Junta caixas que se tocam: um quadro partido em blocos vira um recorte só. */
function agruparCaixas(caixas, folga = 70) {
  const restantes = caixas.filter(Boolean).map(c => [...c]);
  const grupos = [];
  while (restantes.length) {
    let atual = restantes.shift();
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (let i = restantes.length - 1; i >= 0; i--) {
        if (!encosta(atual, restantes[i], folga)) continue;
        atual = uniao([atual, restantes[i]]);
        restantes.splice(i, 1);
        mudou = true;
      }
    }
    grupos.push(atual);
  }
  return grupos;
}

/**
 * As regiões da folha que valem uma leitura por imagem, em ordem de valor:
 * os quadros que o leitor genérico achou, as tabelas com grade, os blocos de
 * legenda, e — só quando não há nenhuma dessas — a folha inteira.
 */
export function regioesDeLeitura(folha) {
  const base = { width: folha.largura, height: folha.altura };
  const marcadas = [];
  for (const q of (folha.quadros || [])) if (q.caixa) marcadas.push({ caixa: q.caixa, rotulo: q.titulo || 'quadro da prancha' });
  for (const t of (folha.tabelas || [])) if (t.caixa) marcadas.push({ caixa: t.caixa, rotulo: t.titulo || `tabela de ${t.tipo}` });
  const cl = caixaDasLegendas(folha);
  if (cl) marcadas.push({ caixa: cl, rotulo: 'bloco de legendas' });

  if (!marcadas.length) {
    return [{ caixa: [0, 0, base.width, base.height], rotulo: 'a folha inteira', largura: OPCOES_RECORTE.larguraFolha }];
  }
  /* quadros encostados viram um recorte só, para a IA ver a tabela completa */
  const juntos = agruparCaixas(marcadas.map(m => m.caixa), 90);
  return juntos.map(c => {
    const dentro = marcadas.filter(m => encosta(m.caixa, c, 0)).map(m => m.rotulo);
    return {
      caixa: limitar([c[0] - 14, c[1] - 22, c[2] + 14, c[3] + 14], base),
      rotulo: [...new Set(dentro)].join(' + ') || 'região da prancha',
      largura: OPCOES_RECORTE.larguraQuadro,
    };
  });
}

/** Locais sem alguma categoria essencial — é o que orienta a busca da IA. */
export function lacunasDeCobertura(emp, essenciais = ['Piso', 'Paredes', 'Teto']) {
  const vivo = x => x && x.status !== 'excluido';
  const out = [];
  for (const l of (emp.locais || []).filter(vivo)) {
    const tem = new Set((l.especificacoes || []).filter(vivo).map(e => e.categoria));
    const falta = essenciais.filter(c => !tem.has(c));
    if (falta.length) out.push(`${l.nome}: falta ${falta.join(', ')}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* CLIENTE MULTIMODAL                                                  */
/* ------------------------------------------------------------------ */

/* A configuração e o transporte moram em ia.js — é o mesmo canal que o
   memorial usa. Reexportados aqui porque `engine.configurarIA(...)` é a API
   documentada no LEIA-ME. */
export { IA, configurarIA, iaLigada, saudeDaIA } from './ia.js';

/**
 * O motor híbrido. Recebe a imagem do local, a imagem da legenda e o que o
 * vetor conseguiu ler, e devolve Especificações prontas.
 *
 * A leitura vetorial é a espinha: ela lê o texto real da legenda e por isso
 * nunca é descartada. A IA multimodal entra por cima, trazendo o que só a
 * imagem mostra — hachura, paginação, especificação escrita no desenho. Os
 * dois resultados são mesclados por `mesclarLeituras`.
 *
 * As imagens podem chegar prontas (string) ou como produtor sob demanda
 * (função): com o provedor no vetorial nenhuma é consumida, e nada é
 * renderizado à toa.
 */
export async function processarComIAHibrida(base64Local, base64Legenda, dadosVetoriais) {
  const vetorial = leituraVetorial(dadosVetoriais);
  if (!iaLigada()) return vetorial;
  /* sem recorte não há o que a IA olhe — é o caso do grupo de tags que não caiu
     em nenhum local. Não é falha do servidor: não conta para o disjuntor. */
  if (!base64Local) return vetorial;

  try {
    /* passo 2: a leitura vetorial deste local vai junto, já montada, para a
       IA revisar em vez de refazer */
    const daIA = await lerComMultimodal(base64Local, base64Legenda, dadosVetoriais, vetorial);
    anotarSucesso();
    if (!daIA.length) return vetorial;
    return mesclarLeituras(vetorial, daIA, dadosVetoriais);
  } catch (err) {
    anotarFalha(err, 'leitura multimodal do local');
    return vetorial;   // nunca aborta o processamento da prancha
  }
}

/* Categorias que todo ambiente costuma ter especificadas. Quando o vetor não
   trouxe nenhuma linha de uma delas, é lacuna — e é para lá que a IA olha. */
const ESSENCIAIS = ['Piso', 'Paredes', 'Teto'];

/** O pacote vetorial de um local, no formato que o prompt do servidor lê:
    uma linha por especificação já montada, só com os campos preenchidos. */
export function pacoteVetorialDoLocal(vetorial = [], local = null) {
  const CAMPOS = ['categoria', 'produto', 'sistema', 'descricao', 'marca', 'modelo', 'fornecedor',
    'codigoOrigem', 'forma', 'numero', 'dimensao', 'peitoril', 'quantidade', 'origemLeitura', 'confianca', 'motivos'];
  const especificacoes = vetorial.slice(0, 80).map(e => {
    const o = {};
    for (const k of CAMPOS) {
      const v = e[k];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      o[k] = v;
    }
    return o;
  });
  /* as lacunas contam também o que outras folhas já deram a este local: a
     IA não precisa procurar piso num ambiente cujo piso a prancha anterior
     já especificou */
  const vivo = x => x && x.status !== 'excluido';
  const tem = new Set([
    ...vetorial.map(e => e.categoria),
    ...((local && local.especificacoes) || []).filter(vivo).map(e => e.categoria),
  ].filter(Boolean));
  const lacunas = ESSENCIAIS.filter(c => !tem.has(c));
  return { especificacoes, lacunas };
}

/** A chamada ao BFF e o mapeamento da resposta para Especificação/Evidência.
    `vetorial` é a leitura já montada deste local (passo 1), que vai no corpo
    como dado estruturado para a IA verificar e completar. */
async function lerComMultimodal(base64Local, base64Legenda, dados, vetorial = []) {
  const { itens = [], legendas = {}, local = null, docMeta = {}, pagina = 1, tipologia = '', base = null, codigos = [], ambientesDaFolha = [] } = dados;

  const imagemLocal = await imagem(base64Local);
  if (!imagemLocal) throw new Error('sem recorte do local para enviar');
  const imagemLegenda = await imagem(base64Legenda);

  const { especificacoes, lacunas } = pacoteVetorialDoLocal(vetorial, local);
  const corpo = await chamarBff(IA.rota, {
    local: local ? { nome: local.nome, pavimento: local.pavimento || '', area: local.area || '' } : {},
    documento: docMeta.nome || '', pagina,
    imagemLocal, imagemLegenda,
    vetor: {
      tags: itens.map(({ tag, vinculo }) => ({
        forma: tag.forma, numero: tag.numero,
        vinculo: !vinculo || !vinculo.ambiente ? 'sem ambiente'
          : vinculo.porProximidade ? 'vínculo proposto por proximidade' : 'dentro do ambiente',
      })),
      legenda: linhasDaLegenda(legendas),
      codigos,
      /* passo 2: o que o vetor já montou, para a IA revisar em vez de refazer */
      especificacoes,
      lacunas,
      ambientes: ambientesDaFolha,
    },
  });

  const linhas = Array.isArray(corpo.especificacoes) ? corpo.especificacoes : [];
  const caixaLocal = local ? (local.poligonoOriginal || null) : null;
  return linhas.map(r => {
    const conf = ['alta', 'media', 'baixa'].includes(r.confianca) ? r.confianca : 'baixa';
    const motivos = [];
    if (!local) motivos.push('tag_sem_ambiente');
    if (!r.descricao) motivos.push('legenda_ausente');
    if (conf === 'baixa') motivos.push('leitura_incerta');

    const esp = criarEspecificacao({
      categoria: r.categoria || '', produto: r.produto || '', sistema: r.sistema || '',
      descricao: r.descricao || '', marca: r.marca || '', modelo: r.modelo || '',
      fornecedor: r.fornecedor || '',
      codigoOrigem: r.codigoOrigem || '', forma: r.forma || '', numero: r.numero || '',
      dimensao: r.dimensao || '', peitoril: r.peitoril || '', quantidade: r.quantidade || '',
      origemLeitura: r.origemLeitura || 'hachura', origemClasse: 'ia_multimodal',
      confianca: conf, status: conf === 'alta' ? 'identificado' : 'revisar',
      motivos,
      localId: local ? local.id : null,
      localNome: local ? local.nome : '',
      pavimento: local ? (local.pavimento || '') : '',
      tipologia,
    });
    /* o que a IA declarou sobre este item em relação ao vetor — só a
       mesclagem usa; não é persistido */
    esp.__acao = ['confirmar', 'completar', 'novo'].includes(r.acao) ? r.acao : 'novo';
    esp.evidencias.push(criarEvidencia({
      documentoOrigem: { docId: docMeta.id, pagina, nomeDoc: docMeta.nome },
      tipo: r.origemLeitura === 'hachura' || r.origemLeitura === 'paginacao' ? 'hachura' : 'tag',
      /* a IA lê a imagem, não o vetor: o ponto exato que ela viu é o recorte
         que recebeu. Nível 3 e Nível 2 são a janela do local. */
      coordenadas: caixaLocal ? janelaDoLocal(caixaLocal, base) : null,
      regiao: caixaLocal ? janelaDoLocal(caixaLocal, base) : null,
      localCoordenadas: caixaLocal,
      tituloLegenda: '',
      texto: r.justificativa || '',
      cadeia: [
        local ? local.nome : 'local não identificado',
        r.codigoOrigem || ROTULO_ORIGEM[r.origemLeitura] || 'evidência gráfica',
        r.justificativa || '',
        r.descricao || '',
        r.categoria || 'categoria não mapeada',
      ].filter(Boolean),
      proveniencia: {
        motor_ia: 'multimodal_gemini',
        metodo: 'leitura_por_imagem',
        confianca: conf,
        modelo: corpo.modelo || '',
      },
    }));
    return esp;
  });
}

const ROTULO_ORIGEM = {
  hachura: 'hachura da área', paginacao: 'paginação do piso',
  texto_prancha: 'especificação escrita na prancha', tag: 'tag desenhada',
  tabela: 'tabela da prancha', legenda_tabela: 'legenda da prancha',
};

/** As linhas de legenda que o vetor leu, no formato que o BFF espera. */
function linhasDaLegenda(legendas) {
  const mapa = legendas && legendas.mapa;
  if (!mapa) return [];
  return Object.entries(mapa).slice(0, 160).map(([k, i]) => {
    const [forma, numero] = k.split(':');
    return { forma, numero, titulo: i.tituloBloco || '', categoria: i.categoria || '', descricao: i.descricao || '' };
  });
}

/**
 * A mesclagem híbrida. O que o vetor leu do texto da legenda manda; o que a IA
 * viu na imagem completa.
 *
 *  - item da IA que casa com um do vetor por forma+número: não vira linha nova.
 *    A evidência multimodal é anexada à Especificação do vetor (a rastreabilidade
 *    passa a mostrar as duas leituras) e só os campos vazios são preenchidos.
 *  - item da IA que não casa com nada: é achado novo — a hachura, a paginação,
 *    o texto escrito no desenho — e entra como Especificação própria.
 */
/* "Descrição" que é só dígito é o número da própria tag vazando pro campo
   errado — nenhuma prancha escreve "1" como especificação de acabamento.
   O servidor já aplica essa trava na resposta da IA; aqui ela protege
   também a leitura vetorial pura (parser de legenda) e a mesclagem, não
   importa de onde o número solto tentou entrar. */
const SO_DIGITOS = /^\d+$/;
const semNumeroSolto = v => SO_DIGITOS.test((v || '').trim()) ? '' : v;

function mesclarLeituras(vetorial, daIA, dados = {}) {
  const porTag = new Map();
  for (const e of vetorial) if (e.forma && e.numero) porTag.set(`${e.forma}:${e.numero}`, e);
  const porDesc = new Map();
  for (const e of vetorial) { const k = enxuto(e.descricao); if (k) porDesc.set(k + '|' + (e.categoria || ''), e); }

  const novas = [];
  let confirmacoesSoltas = 0;
  for (const ia of daIA) {
    const acao = ia.__acao || 'novo';
    delete ia.__acao;
    const alvo = (ia.forma && ia.numero && porTag.get(`${ia.forma}:${ia.numero}`))
      || (ia.codigoOrigem ? vetorial.find(e => e.codigoOrigem && e.codigoOrigem.toLowerCase() === ia.codigoOrigem.toLowerCase()) : null)
      || (ia.descricao ? porDesc.get(enxuto(ia.descricao) + '|' + (ia.categoria || '')) : null);

    /* "confirmar" sem nada para confirmar: a IA disse que concorda com um
       item que o vetor não tem. Sem evidência própria (o servidor dispensa a
       justificativa da confirmação), esse item não pode virar linha — é a
       Regra de Ouro. Conta e segue. */
    if (!alvo && acao === 'confirmar') { confirmacoesSoltas++; continue; }

    if (alvo) {
      // confirmação: a mesma informação por dois caminhos
      for (const campo of ['produto', 'sistema', 'marca', 'modelo', 'fornecedor', 'dimensao', 'peitoril', 'quantidade']) {
        if (!alvo[campo] && ia[campo]) alvo[campo] = ia[campo];
      }
      if (!alvo.categoria && ia.categoria) alvo.categoria = ia.categoria;
      if (!alvo.descricao && ia.descricao) alvo.descricao = semNumeroSolto(ia.descricao);
      const ev = ia.evidencias[0];
      if (ev) { ev.tipo = 'confirmacao_ia'; alvo.evidencias.push(ev); }
      if (alvo.confianca === 'baixa' && ia.confianca === 'alta'
        && !(alvo.motivos || []).includes('tag_sem_ambiente')) {
        alvo.confianca = 'media';
        alvo.motivos = (alvo.motivos || []).filter(m => m !== 'legenda_ausente');
      }
      continue;
    }
    novas.push(ia);   // só a imagem viu: hachura, paginação, texto no desenho
  }
  if (confirmacoesSoltas) {
    console.info(`[IA] ${confirmacoesSoltas} confirmação(ões) sem item correspondente no vetor foram ignoradas (sem evidência própria).`);
  }
  return vetorial.concat(novas);
}

/** Resolve a imagem venha ela pronta ou como produtor sob demanda. */
export async function imagem(fonte) {
  if (!fonte) return null;
  return typeof fonte === 'function' ? await fonte() : fonte;
}

/* A leitura que já funcionava: forma + número na legenda da própria prancha.
   Números iguais em formas diferentes continuam sendo materiais diferentes —
   a chave do mapa é forma + ':' + número, nunca só o número. */
function leituraVetorial({ itens = [], legendas = {}, local = null, docMeta = {}, pagina = 1, tipologia = '', base = null }) {
  const especs = [];
  for (const { tag, vinculo } of itens) {
    const v = vinculo || {};
    const item = legendas.mapa ? legendas.mapa[tag.forma + ':' + tag.numero] : null;
    const folgaOk = v.folga === undefined || v.folga === Infinity ? !!local : v.folga >= 1.35;
    let confianca = 'media';
    const motivos = [];
    if (!item) { confianca = 'baixa'; motivos.push('legenda_ausente'); }
    if (!local) { confianca = 'baixa'; motivos.push('tag_sem_ambiente'); }
    else if (v.porProximidade) { confianca = 'baixa'; motivos.push('vinculo_por_proximidade'); }
    else if (!folgaOk) { confianca = 'baixa'; motivos.push('baixa_confianca'); }
    else if (local.confianca === 'baixa') { confianca = 'baixa'; motivos.push('ambiente_proposto'); }

    const classe = item ? classificar(item.descricao, item.categoria) : null;
    if (item && !classe?.sistema) motivos.push('sem_sistema');

    /* Sem legenda, a especificação nasce vazia: nunca "N/A". */
    const esp = criarEspecificacao({
      categoria: classe?.categoria || (item ? item.categoria : '') || '',
      produto: classe?.produto || '',
      sistema: classe?.sistema || '',
      descricao: item ? semNumeroSolto(item.descricao) || '' : '',
      codigoOrigem: `${tag.forma} ${tag.numero}`.trim(),
      forma: tag.forma, numero: tag.numero,
      origemLeitura: 'tag',
      origemClasse: classe ? classe.origem : '',
      confianca, status: confianca === 'baixa' ? 'revisar' : 'identificado',
      motivos,
      localId: local ? local.id : null,
      localNome: local ? local.nome : '',
      pavimento: local ? (local.pavimento || '') : '',
      tipologia,
    });
    esp.evidencias.push(criarEvidencia({
      documentoOrigem: { docId: docMeta.id, pagina, nomeDoc: docMeta.nome },
      tipo: 'tag',
      coordenadas: tag.bbox,
      regiao: base ? janelaDoDetalhe(tag.bbox, base) : [tag.x - 60, tag.y - 46, tag.x + 60, tag.y + 46],
      legendaCoordenadas: item ? item.ancora : null,
      legendaBloco: item ? (item.blocoCaixa || null) : null,
      legendaItens: item ? (item.itensBloco || null) : null,
      localCoordenadas: local ? (local.poligonoOriginal || null) : null,
      tituloLegenda: item ? item.tituloBloco : '',
      texto: `${FORMAS[tag.forma].rotulo} ${tag.numero}`,
      cadeia: [
        local ? local.nome : 'ambiente não identificado',
        `${FORMAS[tag.forma].rotulo} ${tag.numero}`,
        item ? item.tituloBloco : 'legenda não encontrada',
        item ? item.descricao : '—',
        item ? (item.categoria || 'categoria não mapeada') : '—',
      ],
      segundoLocal: v.segundo ? v.segundo.nome : '',
      folga: v.folga === Infinity ? null : (v.folga ? Number(v.folga.toFixed(2)) : null),
      proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'forma_numero_legenda', confianca },
    }));
    especs.push(esp);
  }
  return especs;
}

/* Executa as tarefas com no máximo `n` em voo, preservando a ordem do
   resultado. Sem isto, 43 locais × uma chamada de rede cada viram uma espera
   longa demais; com n=3 a prancha fecha em um terço do tempo. */
async function emParalelo(tarefas, n = 1, aoConcluir = null) {
  let feitas = 0;
  const terminou = async () => { feitas++; if (aoConcluir) await aoConcluir(feitas, tarefas.length); };
  if (n <= 1) {
    const out = [];
    for (const t of tarefas) { out.push(await t()); await terminou(); }
    return out;
  }
  const out = new Array(tarefas.length);
  let i = 0;
  const trabalhador = async () => {
    while (i < tarefas.length) { const k = i++; out[k] = await tarefas[k](); await terminou(); }
  };
  await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, trabalhador));
  return out;
}

/* ------------------------------------------------------------------ */
/* CONSOLIDAÇÃO: a folha alimenta a árvore de Locais                   */
/* ------------------------------------------------------------------ */

function chaveAmb(nome, pav) { return normalizar(nome) + '|' + normalizar(pav || ''); }

/** Chave de merge: o mesmo item visto de novo cai na mesma chave. */
function chaveDaEspec(esp) {
  return [esp.localId || 'sem-local', esp.categoria || '?',
    esp.codigoOrigem || esp.produto || (esp.forma ? esp.forma + esp.numero : esp.descricao)].join('|');
}

/* Duas fontes descrevendo o mesmo material raramente escrevem igual: uma põe
   "OU SIMILAR", a outra "(seguir especificação do piso)". Conflito é quando o
   material é outro — não quando a redação é outra. */
const enxuto = s => normalizar(s)
  .replace(/\b(ou similar|similar|a definir|a especificar|conforme projeto|seguir especificacao do piso|seguir especificacao|altura a definir|cor a definir)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

function equivalente(a, b) {
  const na = enxuto(a), nb = enxuto(b);
  if (!na || !nb) return na === nb;
  if (na === nb) return true;
  const curto = na.length <= nb.length ? na : nb;
  const longo = na.length <= nb.length ? nb : na;
  if (longo.startsWith(curto) && longo.length - curto.length <= 28) return true;
  const ta = [...new Set(curto.split(' ').filter(w => w.length > 2))];
  if (!ta.length) return false;
  const tb = new Set(longo.split(' ').filter(w => w.length > 2));
  return ta.filter(w => tb.has(w)).length / ta.length >= 0.85;
}

const mesmaEvidencia = (a, b) =>
  (a.documentoOrigem || {}).docId === (b.documentoOrigem || {}).docId
  && (a.documentoOrigem || {}).pagina === (b.documentoOrigem || {}).pagina
  && a.texto === b.texto;

/**
 * Une uma especificação ao acervo. Mesma chave = mesma informação vista de
 * novo: as fontes se somam. Descrição diferente na mesma chave vira conflito
 * documental, nunca sobrescrita silenciosa.
 */
export function incorporarEspecificacao(emp, indice, nova) {
  const chave = chaveDaEspec(nova);
  let atual = indice.get(chave);
  // um trecho de memorial sem código encontra o item que a prancha já criou
  if (!atual && !nova.codigoOrigem && nova.produto) {
    atual = todasEspecificacoes(emp).find(x => x.status !== 'excluido'
      && x.localId === nova.localId && x.categoria === nova.categoria && x.produto === nova.produto);
  }
  if (!atual) {
    nova.chave = chave;
    indice.set(chave, nova);
    guardar(emp, nova);
    return nova;
  }
  for (const campo of ['produto', 'sistema', 'marca', 'modelo', 'fornecedor', 'dimensao', 'peitoril', 'quantidade', 'codigoOrigem']) {
    if (!atual[campo] && nova[campo]) atual[campo] = nova[campo];
  }
  for (const ev of nova.evidencias) {
    if (!atual.evidencias.some(x => mesmaEvidencia(x, ev))) atual.evidencias.push(ev);
  }
  const igual = equivalente(atual.descricao, nova.descricao);
  /* Genérica é a descrição que o documento deixou em aberto — "A DEFINIR",
     "conforme projeto", ou vazia. "OU SIMILAR" NÃO é genérica: o material está
     especificado, e o "similar" é só permissão de equivalente comercial. Se
     outra fonte descreve material diferente, isso é conflito, não detalhamento
     — e o texto que a legenda escreveu continua sendo o da prancha. */
  const genericaAtual = !atual.descricao
    || /\ba\s+(definir|especificar)\b|\bconforme projeto\b|\bà\s+definir\b/i.test(atual.descricao);
  if (!igual && genericaAtual && (nova.descricao || '').length > (atual.descricao || '').length) {
    // uma fonte detalhou o que a outra deixou em aberto: complementa, não conflita
    atual.detalhadoDe = atual.descricao;
    atual.descricao = nova.descricao;
    const re = classificar(nova.descricao, atual.categoria);
    if (re) { if (re.produto) atual.produto = re.produto; if (re.sistema) atual.sistema = re.sistema; }
    if (nova.confianca === 'alta') { atual.confianca = 'alta'; atual.status = 'identificado'; }
    atual.motivos = (atual.motivos || []).filter(m => m !== 'sem_sistema' && m !== 'legenda_ausente');
    return atual;
  }
  if (igual) {
    if ((nova.descricao || '').length > (atual.descricao || '').length) atual.descricao = nova.descricao;
    if (atual.confianca !== 'alta' && nova.confianca === 'alta') { atual.confianca = 'alta'; atual.status = 'identificado'; atual.motivos = []; }
  } else {
    const f = nova.evidencias[0] || {};
    const d = f.documentoOrigem || {};
    atual.status = 'conflito';
    atual.divergencias.push({ documento: d.nomeDoc || '', pagina: d.pagina, descricao: nova.descricao });
    if (!atual.motivos.includes('conflito')) atual.motivos.push('conflito');
  }
  return atual;
}

/** Coloca a especificação no seu Local, ou na fila dos que não têm local. */
function guardar(emp, esp) {
  const local = esp.localId ? emp.locais.find(l => l.id === esp.localId) : null;
  if (local) local.especificacoes.push(esp);
  else { esp.localId = null; emp.especificacoesSemLocal.push(esp); }
}

function indiceDeChaves(emp) {
  const m = new Map();
  for (const esp of todasEspecificacoes(emp)) if (esp.chave) m.set(esp.chave, esp);
  return m;
}

/**
 * Identidade de um local na árvore.
 *   - área comum: nome + pavimento — o HALL do térreo e o HALL do 1º são dois lugares;
 *   - cômodo de unidade: nome + tipologia — o DORM.01 do TIPO 1 é UM local, esteja
 *     a unidade no térreo ou no 12º (o pavimento vira uma lista, `pavimentos`);
 *   - cômodo de unidade sem tipologia lida: só o nome — as plantas dos andares
 *     repetidas não podem virar um DORM.01 por andar.
 */
function chaveLocal(nome, pav, tip, comum) {
  if (comum === false || tip) return normalizar(nome) + '|' + (tip ? 't:' + normalizar(tip) : '');
  return chaveAmb(nome, pav) + '|';
}
const chaveDoLocal = l => chaveLocal(l.nome, l.pavimento, l.tipologia, !!l.areaComum);

/** O lado do condomínio que um rótulo de prancha revela: true, false ou undefined. */
function ladoDoRotulo(emp, a, folha) {
  if (a.tipologia) return false;
  const vocab = classificarArea(a.nome);
  if (vocab === 'comum') return true;
  if (vocab === 'privativa') return false;
  if (folha && (folha.tipologias || []).length) return true;   // folha com unidades marcadas: fora delas é comum
  return temAreasComuns(emp) ? undefined : false;
}

/** Um item da estrutura (torre, tipologia…) pelo nome — criado se não existir. */
function garantirNivel(emp, nivel, nome) {
  emp.estrutura = emp.estrutura || { grupo: [], tipologia: [], unidade: [], pavimento: [] };
  emp.estrutura[nivel] = emp.estrutura[nivel] || [];
  let it = emp.estrutura[nivel].find(x => normalizar(x.nome) === normalizar(nome));
  if (!it) { it = { id: novoId('niv'), nome, descricao: '', origem: 'prancha' }; emp.estrutura[nivel].push(it); }
  return it;
}

/**
 * O local que o memorial criou e que este rótulo da prancha alcança: mesmo
 * nome (ou parte do título composto), mesma família (BANHEIRO ↔ BANHO) e o
 * mesmo lado do condomínio — área comum com área comum, unidade com unidade.
 * `comum` é o que a prancha sabe do rótulo: true, false ou undefined.
 */
function localDoMemorialPara(emp, a, comum) {
  const pavOk = l => !l.pavimento || !a.pavimento || normalizar(l.pavimento) === normalizar(a.pavimento);
  const ladoOk = l => comum === undefined || !!l.areaComum === comum;
  const fam = familiaDoNome(a.nome);
  for (const l of emp.locais) {
    if (l.status === 'excluido' || l.origem !== 'memorial' || !pavOk(l) || !ladoOk(l)) continue;
    if (partesDoNome(l.nomeMemorial || l.nome).some(p => mesmoCerne(p, a.nome) || (fam && familiaDoNome(p) === fam))) return l;
  }
  return null;
}

/**
 * As especificações que o memorial deu a um local genérico ("DORMITÓRIOS")
 * são copiadas para o cômodo concreto da prancha ("DORM.01" do TIPO 2),
 * com a evidência do memorial junto. É a leitura cruzada: a prancha diz que
 * o cômodo existe e onde; o memorial diz do que ele é feito.
 */
function propagarDoMemorial(de, para) {
  let n = 0;
  for (const esp of (de.especificacoes || [])) {
    if (esp.status === 'excluido' || esp.origemLeitura !== 'memorial') continue;
    const c = JSON.parse(JSON.stringify(esp));
    c.id = novoId('esp'); c.localId = para.id; c.localNome = para.nome;
    c.pavimento = para.pavimento || ''; c.tipologia = para.tipologia || '';
    c.propagadoDe = de.id;
    for (const ev of (c.evidencias || [])) {
      ev.id = novoId('evd');
      if (Array.isArray(ev.cadeia) && ev.cadeia.length) ev.cadeia[0] = para.nome;
    }
    c.chave = chaveDaEspec(c);
    para.especificacoes.push(c); n++;
  }
  return n;
}

/**
 * Cria ou reencontra o Local de um rótulo lido na folha (pelo texto ou pela
 * IA). Regras:
 *   - área comum é um lugar só: o local que o memorial criou vira este
 *     local — ganha o nome da prancha, o pavimento, a área e o rótulo;
 *   - cômodo de unidade existe uma vez por tipologia: nasce um local por
 *     tipologia, e as especificações do memorial entram copiadas nele;
 *   - "TIPO 1" vira uma tipologia na estrutura; "TORRE 1" vira uma torre.
 */
function obterOuCriarLocal(emp, a, docMeta, folha, porChave = null) {
  emp.locais = emp.locais || [];
  const mapa = porChave || new Map(emp.locais.map(l => [chaveDoLocal(l), l]));
  const tip = a.tipologia || '';
  const comum = ladoDoRotulo(emp, a, folha);
  const k = chaveLocal(a.nome, a.pavimento, tip, comum);
  let local = mapa.get(k);
  let criado = false, propagadas = 0;
  if (local && a.pavimento && normalizar(local.pavimento || '') !== normalizar(a.pavimento)) {
    /* o mesmo cômodo da mesma tipologia em outro andar: um local, vários pavimentos */
    local.pavimentos = local.pavimentos || (local.pavimento ? [local.pavimento] : []);
    if (!local.pavimentos.some(p => normalizar(p) === normalizar(a.pavimento))) local.pavimentos.push(a.pavimento);
    if (!local.pavimento) local.pavimento = a.pavimento;
  }
  if (!local) {
    const doMemorial = localDoMemorialPara(emp, a, comum);
    if (doMemorial && !tip && !doMemorial.adotadoEm) {
      local = doMemorial;
      local.nomeMemorial = local.nome;
      local.nome = a.nome;
      local.pavimento = a.pavimento || local.pavimento || '';
      local.area = a.area || local.area || '';
      local.adotadoEm = docMeta.id;
      local.origem = a.origem || local.origem;
      if (comum !== undefined) local.areaComum = comum;
      for (const esp of local.especificacoes || []) { esp.localNome = local.nome; esp.pavimento = local.pavimento; }
      mapa.set(k, local);
    } else {
      local = criarLocal(a.nome, a.area, a.pavimento || '', a.bboxTexto || null);
      local.origem = a.origem || '';
      local.confianca = a.confianca || 'alta';
      local.status = a.confianca === 'alta' ? 'identificado' : 'revisar';
      local.statusAuditoria = 'pendente';
      local.areaComum = !!comum;
      emp.locais.push(local); mapa.set(k, local); criado = true;
    }
    if (tip) {
      const niv = garantirNivel(emp, 'tipologia', tip);
      local.tipologia = tip; local.tipologiaId = niv.id;
      /* a planta marcou unidades: o empreendimento tem tipologias e tem áreas
         comuns, seja qual for o tipo escolhido no cadastro */
      if (!temNivel(emp, 'tipologia')) emp.niveisExtras = [...new Set([...(emp.niveisExtras || []), 'tipologia'])];
      if (!temAreasComuns(emp)) emp.areasComunsForcado = true;
    } else if (!local.areaComum && !local.tipologia) {
      /* sem tipologia lida: a tipologia cadastrada à mão vale para todos,
         mas uma tipologia que veio de prancha só vale para quem está nela */
      const tips = emp.estrutura?.tipologia || [];
      if (tips.length && !tips.some(t => t.origem === 'prancha')) local.tipologia = tips[0].nome;
    }
    if (a.grupo) local.grupoId = garantirNivel(emp, 'grupo', a.grupo).id;
    if (criado && doMemorial) propagadas = propagarDoMemorial(doMemorial, local);
  }
  if (!local.poligonoOriginal && a.bboxTexto) local.poligonoOriginal = a.bboxTexto;
  if (folha) {
    const outrasCaixasRotulo = (folha.ambientes || [])
      .filter(o => o !== a && o.bboxTexto)
      .map(o => o.bboxTexto);
    const porIA = a.origem === 'rotulo_ia';
    const rotulo = criarEvidencia({
      documentoOrigem: { docId: docMeta.id, pagina: folha.pagina, nomeDoc: docMeta.nome },
      tipo: 'rotulo',
      coordenadas: a.bboxTexto || null,
      regiao: a.bboxTexto
        ? janelaDoLocal(a.bboxTexto, { width: folha.largura, height: folha.altura }, { outrasCaixas: outrasCaixasRotulo })
        : null,
      texto: a.nome + (a.area ? '  ' + a.area : '') + (tip ? '  (' + tip + ')' : ''),
      proveniencia: porIA
        ? { motor_ia: 'multimodal_gemini', metodo: 'leitura_planta', confianca: a.confianca || 'media' }
        : { motor_ia: 'fallback_vetorial', metodo: 'leitura_rotulo', confianca: a.confianca || 'alta' },
    });
    if (!local.evidencias.some(e => mesmaEvidencia(e, rotulo))) local.evidencias.push(rotulo);
  }
  return { local, criado, propagadas };
}

/** Cria ou reencontra o Local de cada rótulo lido na folha. */
function casarLocais(emp, folha, docMeta) {
  const porChave = new Map(emp.locais.map(l => [chaveDoLocal(l), l]));
  const criados = [];
  for (const a of folha.ambientes) {
    const { local, criado } = obterOuCriarLocal(emp, a, docMeta, folha, porChave);
    if (criado) criados.push(local);
    a.__id = local.id;
    a.__local = local;
  }
  return criados;
}

/** Linhas cruas do QUADRO DE ESQUADRIAS / QUADRO DE PEDRAS desta folha, para
    a IA cruzar o código que ela leu no desenho ("P08", "J10", "PA3") — essas
    tabelas não têm coluna de ambiente, então o vetorial nunca sabe de quem é
    a linha, mas a IA sabe: ela está olhando o local exato. */
function codigosDeTabelas(folha) {
  const linhas = [];
  for (const tb of (folha.tabelas || [])) {
    if (tb.tipo !== 'esquadrias' && tb.tipo !== 'pedras') continue;
    if (tb.titulo) linhas.push(`[${tb.titulo}]`);
    for (const l of tb.linhas) {
      const texto = (l.celulas || []).filter(Boolean).join(' | ');
      if (texto) linhas.push(texto);
    }
  }
  return linhas;
}

/**
 * Orquestra uma folha: radar de coordenadas → recortes → motor híbrido →
 * árvore de Locais. Termina projetando as listas antigas para o exporter e as
 * views continuarem funcionando.
 */
export async function consolidar(emp, folha, docMeta, aoProgredir = () => {}) {
  emp.locais = emp.locais || [];
  emp.especificacoesSemLocal = emp.especificacoesSemLocal || [];

  await aoProgredir('casando ambientes com a árvore', 0.02);
  const criados = casarLocais(emp, folha, docMeta);
  const indice = indiceDeChaves(emp);
  const registrados = [];
  const base = { width: folha.largura, height: folha.altura };
  const tipologia = (emp.estrutura?.tipologia?.[0]?.nome) || '';

  // recortes sob demanda: o fallback não os consome, a IA vai consumir
  const caixaLeg = caixaDasLegendas(folha);
  const imgLegenda = caixaLeg
    ? () => recorteBase64(folha.page, caixaLeg, { largura: OPCOES_RECORTE.larguraLegenda })
    : null;

  // 1) tags geométricas: uma chamada do motor híbrido por local
  const porLocal = new Map();
  const vinculoDe = new Map(folha.vinculos.map(v => [v.tag, v]));
  for (const tag of folha.tags) {
    const v = vinculoDe.get(tag) || {};
    const local = v.ambiente ? v.ambiente.__local : null;
    const k = local ? local.id : '';
    if (!porLocal.has(k)) porLocal.set(k, { local, itens: [] });
    porLocal.get(k).itens.push({ tag, vinculo: v });
  }
  /* Com o motor multimodal ligado, também os locais SEM nenhuma tag entram na
     fila: é exatamente lá que vivem as hachuras e paginações que a leitura
     vetorial nunca viu — o caso do B.SERVIÇO que só mostrava a porta. */
  if (iaLigada() && IA.lerLocaisSemTag) {
    for (const l of (folha.ambientes || [])) {
      const local = l.__local;
      if (!local || porLocal.has(local.id)) continue;
      porLocal.set(local.id, { local, itens: [] });
    }
  }

  // caixa do rótulo de cada ambiente desta folha, para nenhuma janela de
  // local engolir o nome do vizinho (ver janelaDoLocal)
  const caixasDaFolha = (folha.ambientes || [])
    .filter(a => a.bboxTexto)
    .map(a => ({ id: a.__local ? a.__local.id : null, caixa: a.bboxTexto }));

  const codigosDaFolha = codigosDeTabelas(folha);
  const ambientesDaFolha = (folha.ambientes || []).map(a => a.nome).filter(Boolean);

  const tarefas = [...porLocal.values()].map(({ local, itens }) => async () => {
    const outrasCaixas = local
      ? caixasDaFolha.filter(c => c.id !== local.id).map(c => c.caixa)
      : [];
    const imgLocal = local && local.poligonoOriginal
      ? () => recorteBase64(folha.page, janelaDoLocal(local.poligonoOriginal, base, { outrasCaixas }), { largura: OPCOES_RECORTE.larguraLocal })
      : null;
    return processarComIAHibrida(imgLocal, imgLegenda, {
      itens, legendas: folha.legendas, local, docMeta, pagina: folha.pagina,
      tipologia: local ? (local.tipologia || '') : tipologia, base,
      codigos: codigosDaFolha, ambientesDaFolha,
      recorteDetalhe: (caixa) => recorteBase64(folha.page, janelaDoDetalhe(caixa, base), { largura: OPCOES_RECORTE.larguraDetalhe }),
    });
  });
  /* o vetorial é síncrono e não ganha nada com paralelismo; a chamada de rede
     ganha muito. A incorporação continua em ordem, uma de cada vez.

     A barra: com a IA ligada esta é a fase cara (um recorte + uma chamada por
     local), e ocupa 2%→80% do consolidar; sem IA ela é instantânea e o resto
     (tabelas, quadros) é o que resta. */
  const comIA = iaLigada();
  const fimLocais = comIA ? 0.8 : 0.5;
  await aoProgredir(comIA ? `IA revisando ${tarefas.length} local(is)` : `montando ${tarefas.length} local(is)`, 0.04);
  const lotes = await emParalelo(tarefas, comIA ? Math.max(1, IA.paralelas) : 1,
    (feitas, total) => aoProgredir(
      comIA ? `IA revisou ${feitas} de ${total} locais` : `local ${feitas} de ${total}`,
      0.04 + (fimLocais - 0.04) * (feitas / Math.max(1, total))));
  for (const especs of lotes) {
    for (const esp of especs) {
      const r = incorporarEspecificacao(emp, indice, esp);
      if (!registrados.includes(r)) registrados.push(r);
    }
  }

  // 2) tabelas desenhadas na prancha
  await aoProgredir('incorporando tabelas e quadros', fimLocais + 0.03);
  for (const tb of folha.tabelas) {
    const linhas = tb.tipo === 'esquadrias' ? deEsquadrias(emp, tb, folha, docMeta)
                 : tb.tipo === 'pedras' ? dePedras(emp, tb, folha, docMeta)
                 : tb.tipo === 'legenda_ambientes' ? deLegendaAmbientes(emp, tb, folha, docMeta) : [];
    for (const esp of linhas) {
      const r = incorporarEspecificacao(emp, indice, esp);
      if (!registrados.includes(r)) registrados.push(r);
    }
  }

  /* 2b) quadros por ambiente e catálogos por código, lidos sem grade */
  for (const q of (folha.quadros || [])) {
    for (const esp of deQuadro(emp, q, folha, docMeta)) {
      const r = incorporarEspecificacao(emp, indice, esp);
      if (!registrados.includes(r)) registrados.push(r);
    }
  }

  /* 2c) LEITURA AMPLA — a IA olha os quadros e a folha, e completa o que a
         leitura vetorial não alcançou.
         Roda depois dos leitores vetoriais de propósito: assim a IA recebe o
         que já foi lido e as lacunas por local, e o trabalho dela é COMPLETAR,
         não repetir. O vínculo aqui é pelo NOME que a própria tabela declara —
         mais forte que o geométrico, porque está escrito. */
  if (iaLigada() && IA.lerQuadrosComIA) {
    await aoProgredir('IA revisando quadros, tabelas e notas da folha', fimLocais + 0.08);
    const antes = registrados.length;
    for (const esp of await leituraAmpla(emp, folha, docMeta)) {
      const r = incorporarEspecificacao(emp, indice, esp);
      if (!registrados.includes(r)) registrados.push(r);
    }
    if (registrados.length > antes) {
      console.info(`[IA] leitura ampla acrescentou ${registrados.length - antes} item(ns) nesta folha.`);
    }
  }

  await aoProgredir('gravando o acervo da folha', 0.97);
  // 3) acervo de legendas e tabelas da folha
  folha.tabelas.forEach(t => emp.tabelas.push({
    documentoId: docMeta.id, documento: docMeta.nome, pagina: folha.pagina,
    tipo: t.tipo, titulo: t.titulo, caixa: t.caixa, linhas: t.linhas.map(l => l.celulas),
  }));
  if (folha.legendas.blocos.length) emp.legendas.push({
    documentoId: docMeta.id, documento: docMeta.nome, pagina: folha.pagina,
    caixa: caixaLeg,
    blocos: folha.legendas.blocos.map(b => ({ forma: b.forma, titulo: b.titulo, categoria: b.categoria, caixa: b.caixa || null, itens: b.itens.map(i => ({ numero: i.numero, descricao: i.descricao })) })),
  });

  // 4) projeção inversa: as listas antigas viram vista da árvore
  sincronizar(emp);
  await aoProgredir('folha concluída', 1);
  return { criados, achados: registrados };
}

function cabecalho(tb) { return tb.linhas[0] ? tb.linhas[0].celulas.map(c => c.toUpperCase()) : []; }
function idxCol(tb, termos) {
  const h = cabecalho(tb);
  for (let i = 0; i < h.length; i++) if (termos.some(t => h[i].includes(t))) return i;
  return -1;
}

/* Lê da árvore, não da projeção: os locais desta folha acabaram de ser
   criados e as listas antigas só são refeitas no fim da consolidação. */
function acharAmbientes(emp, texto, pavimentoDica) {
  if (!texto) return [];
  const partes = texto.split(/\s*(?:,| e |\/|;)\s*/).map(s => s.trim()).filter(Boolean);
  const achados = [];
  for (const p of partes) {
    const [nome, pav] = p.split(/\s*[-–]\s*/);
    for (const a of emp.locais) {
      if (!mesmoAmbiente(a.nome, nome)) continue;
      if (pav && a.pavimento && !normalizar(a.pavimento).startsWith(normalizar(pav).slice(0, 4))) continue;
      achados.push(a);
    }
  }
  return [...new Set(achados)];
}

/* ---------------------------------------------------------------- */
/* Legenda com coluna de ambientes                                   */
/*                                                                   */
/* É a tabela que a prancha de piso ou de forro traz no canto: uma    */
/* linha por material, com a amostra da hachura, o fornecedor e — o   */
/* que mais importa — a lista de ambientes onde aquele material vai.  */
/* É evidência escrita, não dedução: o que sai daqui vem com a linha  */
/* da tabela e a página como origem.                                  */

const FORCA = {
  exata: { confianca: 'alta', status: 'identificado', motivos: [] },
  familia: { confianca: 'media', status: 'revisar', motivos: ['vinculo_por_familia'] },
  pavimento: { confianca: 'media', status: 'revisar', motivos: ['vinculo_por_familia'] },
  geral: { confianca: 'media', status: 'revisar', motivos: ['vinculo_geral'] },
};

/* As tabelas desenhadas na prancha entram na árvore na forma nova: cada linha
   vira uma Especificação com a sua Evidência, sem passar por nenhum formato
   intermediário. `base.ev` já é a evidência: `regiao` é o Nível 2 (a tabela
   inteira) e `coordenadas` o Nível 3 (a linha exata de onde o dado saiu). */
function espDeLinha(base, alvo, ajuste = {}) {
  const esp = criarEspecificacao({
    categoria: base.categoria || '', produto: base.produto || '', sistema: base.sistema || '',
    descricao: base.descricao || '', marca: base.marca || '', modelo: base.modelo || '',
    fornecedor: base.fornecedor || '', codigoOrigem: base.codigoOrigem || '',
    dimensao: base.dimensao || '', peitoril: base.peitoril || '', quantidade: base.quantidade || '',
    origemLeitura: base.origemLeitura || 'tabela', origemClasse: base.origemClasse || '',
    localId: alvo ? alvo.id : null,
    localNome: alvo ? alvo.nome : (ajuste.localNome || ''),
    pavimento: alvo ? (alvo.pavimento || '') : '',
    tipologia: alvo ? (alvo.tipologia || '') : (ajuste.tipologia || ''),
    confianca: ajuste.confianca || 'media',
    status: ajuste.status || 'revisar',
    motivos: ajuste.motivos || [],
  });
  esp.evidencias.push(criarEvidencia({
    ...base.ev, ...(ajuste.ev || {}), cadeia: ajuste.cadeia || [],
    proveniencia: { motor_ia: 'fallback_vetorial', metodo: base.metodo || 'tabela_desenhada', confianca: esp.confianca },
  }));
  return esp;
}

/* ------------------------------------------------------------------ */
/* LEITURA AMPLA POR IMAGEM                                            */
/*                                                                     */
/* Manda as regiões da folha que podem conter produto — quadros,        */
/* tabelas, legendas, e a folha inteira quando não há nenhuma dessas —  */
/* e recebe produtos com o nome do local que a tabela declara.          */
/*                                                                     */
/* O vínculo é por NOME, casado com `casarAmbientes`, o mesmo casador   */
/* que já resolve "B.SERVIÇO" = "B SERVIÇO" e "BANHO 02" = "banho 2".   */
/* Item cujo nome não casa com nenhum local vai para a fila de triagem  */
/* com o texto que a prancha deu — nunca é descartado, nunca é forçado  */
/* para o local mais parecido.                                         */
/* ------------------------------------------------------------------ */

async function leituraAmpla(emp, folha, docMeta) {
  const regioes = regioesDeLeitura(folha);
  if (!regioes.length) return [];

  /* o que a leitura vetorial já tirou DESTA folha, para a IA completar em vez
     de repetir */
  const daFolha = todasEspecificacoes(emp).filter(e => (e.evidencias || [])
    .some(v => (v.documentoOrigem || {}).docId === docMeta.id
      && (v.documentoOrigem || {}).pagina === folha.pagina));
  const jaLidos = daFolha.slice(0, 200).map(e => [
    e.localNome || 'sem local', e.categoria || 'sem categoria',
    (e.descricao || e.produto || e.codigoOrigem || '').slice(0, 70),
  ].join(' · '));

  const vivo = x => x && x.status !== 'excluido';
  const nomes = (emp.locais || []).filter(vivo).map(l => l.nome);
  const regioesEnviadas = [];        // na ordem das imagens: IMAGEM 1 é regioesEnviadas[0]

  let corpo;
  try {
    const imagens = [];
    for (const r of regioes.slice(0, IA.maxRegioesPorFolha)) {
      const b64 = await recorteBase64(folha.page, r.caixa, { largura: r.largura });
      if (b64) { imagens.push({ rotulo: r.rotulo, base64: b64 }); regioesEnviadas.push(r); }
    }
    if (!imagens.length) return [];
    corpo = await chamarBff(IA.rotaFolha, {
      documento: docMeta.nome || '', pagina: folha.pagina,
      imagens, locais: nomes, jaLidos,
      lacunas: lacunasDeCobertura(emp),
      /* passo 2 do pipeline: o pacote estruturado do que o vetor leu nesta
         folha — ambientes, legendas e tabelas linha a linha — para a IA
         verificar o que falta em vez de reler tudo */
      vetor: pacoteVetorialDaFolha(folha),
    }, IA.timeoutQuadroMs);
    anotarSucesso();
  } catch (err) {
    anotarFalha(err, 'leitura ampla da folha');
    return [];                       // a folha continua com o que o vetor leu
  }

  const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  if (!itens.length) return [];

  /* A caixa que a IA devolve é relativa à imagem (0–1000 em cada eixo); aqui
     ela volta para as coordenadas da página, para o rótulo ter "Ver na
     prancha" mesmo numa planta que é só imagem. */
  const caixaNaPagina = (it) => {
    const c = Array.isArray(it.caixa) && it.caixa.length === 4 ? it.caixa.map(Number) : null;
    const r = regioesEnviadas[Math.max(0, (Number(it.imagem) || 1) - 1)] || regioesEnviadas[0];
    if (!c || c.some(v => !Number.isFinite(v)) || !r || !r.caixa) return null;
    const [rx0, ry0, rx1, ry1] = r.caixa;
    const sx = (rx1 - rx0) / 1000, sy = (ry1 - ry0) / 1000;
    const x0 = rx0 + Math.min(c[0], c[2]) * sx, x1 = rx0 + Math.max(c[0], c[2]) * sx;
    const y0 = ry0 + Math.min(c[1], c[3]) * sy, y1 = ry0 + Math.max(c[1], c[3]) * sy;
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    return [x0, y0, x1, y1];
  };
  /* Uma planta tem poucas tipologias. Dezenas delas numa folha só é a IA
     lendo número de apartamento como tipo — e aí nenhuma vale: os cômodos
     entram sem tipologia, um por nome, em vez de um por apartamento. */
  const tipsDaFolha = new Set(itens.filter(i => i.origemLeitura === 'planta').map(i => lerTipologia(i.tipologia || '')).filter(Boolean));
  const tipologiasSuspeitas = tipsDaFolha.size > 16;
  if (tipologiasSuspeitas) console.warn(`[IA] ${tipsDaFolha.size} tipologias numa folha só — descartadas (parecem números de apartamento).`);

  const pavs = [...new Set((emp.locais || []).filter(vivo).map(l => l.pavimento).filter(Boolean))];
  const vivos = (emp.locais || []).filter(vivo);
  const regiaoDe = (fonte) => {
    const r = regioes.find(x => fonte && normalizar(x.rotulo).includes(normalizar(fonte).slice(0, 14)));
    return (r || regioes[0]).caixa;
  };

  const out = [];
  for (const it of itens) {
    /* planta lida por imagem: a IA devolve um item por rótulo de ambiente,
       com a tipologia da unidade ("TIPO 1") quando a planta marca as
       unidades. O local nasce aqui mesmo, com ou sem produto junto. */
    if (it.origemLeitura === 'planta') {
      if (!it.local) continue;
      const pavsFolha = folha.pavimentos || [];
      const unica = pavsFolha.length === 1 ? pavsFolha[0] : null;
      const amb = {
        nome: it.local, area: '', bboxTexto: caixaNaPagina(it), origem: 'rotulo_ia',
        pavimento: it.pavimento || (unica ? unica.nome : ''),
        grupo: unica ? (unica.grupo || '') : '',
        tipologia: tipologiasSuspeitas ? '' : (lerTipologia(it.tipologia || '') || ''),
        confianca: ['alta', 'media'].includes(it.confianca) ? it.confianca : 'baixa',
      };
      const { local } = obterOuCriarLocal(emp, amb, docMeta, folha);
      if (!(it.descricao || it.produto || it.codigoOrigem)) continue;
      it.__local = local;
    }
    const descricao = it.descricao || it.produto || '';
    if (!descricao && !it.codigoOrigem) continue;
    const classe = classificar([it.produto, descricao].filter(Boolean).join(' '), it.categoria);
    const conf = ['alta', 'media', 'baixa'].includes(it.confianca) ? it.confianca : 'baixa';
    const caixa = regiaoDe(it.fonte);

    const base = {
      origemLeitura: it.origemLeitura || 'tabela',
      metodo: 'leitura_ampla',
      categoria: it.categoria || classe?.categoria || '',
      produto: it.produto || classe?.produto || '',
      sistema: it.sistema || classe?.sistema || '',
      descricao,
      marca: it.marca || '', modelo: it.modelo || '', fornecedor: it.fornecedor || '',
      codigoOrigem: it.codigoOrigem || '',
      dimensao: it.dimensao || '', peitoril: it.peitoril || '', quantidade: it.quantidade || '',
      origemClasse: 'ia_leitura_ampla',
      ev: {
        documentoOrigem: { docId: docMeta.id, nomeDoc: docMeta.nome, pagina: folha.pagina },
        tipo: 'tabela',
        coordenadas: caixa, regiao: caixa, tabelaCoordenadas: caixa,
        tituloLegenda: it.fonte || 'leitura por imagem',
        texto: it.justificativa || descricao,
      },
    };
    const cadeia = (nome) => [
      nome || 'local não informado',
      it.fonte || 'leitura por imagem da prancha',
      it.codigoOrigem || (it.forma ? `${it.forma} ${it.numero}` : 'linha do quadro'),
      descricao,
      base.categoria || 'categoria não mapeada',
    ];

    /* o vínculo pelo nome escrito na tabela (ou o local que a planta acabou de dar) */
    const casos = it.__local ? [] : (it.local ? casarAmbientes(it.local, (emp.locais || []).filter(vivo), pavs) : []);
    const alvos = it.__local ? [it.__local] : casos.filter(c => c.forca !== 'geral').map(c => c.ambiente);

    if (!alvos.length) {
      out.push(espDeLinhaIA(base, null, {
        localNome: it.local || '',
        confianca: it.local ? 'baixa' : conf,
        status: 'revisar',
        motivos: [it.local ? 'termo_sem_ambiente' : 'incompleto'],
        cadeia: cadeia(it.local),
        conf,
      }));
    } else for (const a of alvos) {
      out.push(espDeLinhaIA(base, a, {
        confianca: conf, status: conf === 'alta' ? 'identificado' : 'revisar',
        motivos: conf === 'baixa' ? ['leitura_incerta'] : [],
        cadeia: cadeia(a.nome),
        conf,
      }));
    }
  }
  return out;
}

/** O que rooms.js, legend.js, tables.js e quadros.js leram desta folha, em
    JSON compacto, para a rota de leitura ampla. */
export function pacoteVetorialDaFolha(folha) {
  const ambientes = (folha.ambientes || []).map(a => a.nome).filter(Boolean).slice(0, 150);
  const legendas = ((folha.legendas && folha.legendas.blocos) || []).slice(0, 12).map(b => ({
    forma: b.forma || '', titulo: b.titulo || '', categoria: b.categoria || '',
    itens: (b.itens || []).slice(0, 60).map(i => ({ numero: i.numero, descricao: i.descricao })),
  }));
  const tabelas = [];
  for (const t of (folha.tabelas || []).slice(0, 8)) {
    tabelas.push({ tipo: t.tipo, titulo: t.titulo || '', linhas: t.linhas.slice(0, 60).map(l => l.celulas) });
  }
  for (const q of (folha.quadros || []).slice(0, 8)) {
    tabelas.push({
      tipo: q.chave === 'codigo' ? 'quadro_por_codigo' : 'quadro_por_ambiente',
      titulo: q.titulo || '',
      linhas: (q.linhas || []).slice(0, 60).map(l => [l.local, l.grupo, l.codigo, l.dimensao, l.tipo, l.especificacao, l.modelo, l.quantidade].filter(Boolean)),
    });
  }
  return { ambientes, legendas, tabelas };
}

/* Igual ao `espDeLinha`, mas a proveniência é da IA. */
function espDeLinhaIA(base, alvo, ajuste = {}) {
  const esp = espDeLinha(base, alvo, ajuste);
  const ev = esp.evidencias[0];
  if (ev) {
    ev.proveniencia = {
      motor_ia: 'multimodal_gemini', metodo: 'leitura_ampla',
      confianca: ajuste.conf || esp.confianca,
    };
  }
  return esp;
}

/* ------------------------------------------------------------------ */
/* QUADROS LIDOS SEM GRADE                                             */
/*                                                                     */
/* O `quadros.js` devolve a tabela já estruturada, venha ela com a      */
/* chave no ambiente (memorial de acabamentos) ou no código (quadro de  */
/* esquadrias). Aqui cada linha vira Especificação.                     */
/*                                                                     */
/* A linha que nomeia um ambiente e casa com um Local entra nele. A que */
/* não casa — ou a de catálogo, que não nomeia ambiente nenhum — vai    */
/* para a fila de triagem com o texto que a prancha deu. Nada é         */
/* descartado e nada é adivinhado.                                      */
/* ------------------------------------------------------------------ */

function deQuadro(emp, q, folha, docMeta) {
  const out = [];
  const porCodigo = q.chave === 'codigo';

  for (const l of q.linhas) {
    /* a descrição é o que a tabela escreveu, na ordem em que escreveu */
    const partes = porCodigo
      ? [l.codigo, l.dimensao ? l.dimensao.replace(/\s+/g, '') : '', l.tipo, l.especificacao, l.modelo]
      : [l.especificacao, l.modelo];
    const descricao = partes.filter(Boolean).join(' — ').trim();
    if (!descricao) continue;                       // linha sem conteúdo não vira item

    const classe = classificar([l.grupo, descricao].filter(Boolean).join(' '), q.categoria);
    const categoria = q.categoria || classe?.categoria || '';
    const produto = (l.grupo && !porCodigo ? '' : l.grupo) || classe?.produto || '';
    const alvos = l.local ? acharAmbientes(emp, l.local) : [];

    const base = {
      origemLeitura: 'tabela', categoria,
      metodo: porCodigo ? 'quadro_por_codigo' : 'quadro_por_ambiente',
      produto, sistema: classe?.sistema || '',
      descricao,
      codigoOrigem: l.codigo || '',
      dimensao: l.dimensao || '', peitoril: l.peitoril || '',
      quantidade: l.quantidade || '',
      marca: l.marca || '', modelo: porCodigo ? '' : (l.modelo || ''), fornecedor: '',
      origemClasse: classe ? classe.origem : '',
      ev: {
        documentoOrigem: { docId: docMeta.id, nomeDoc: docMeta.nome, pagina: folha.pagina },
        tipo: 'tabela',
        coordenadas: l.caixa, regiao: q.caixa || l.caixa,
        tabelaCoordenadas: q.caixa || null,
        tituloLegenda: q.titulo || '',
        texto: [l.grupo, l.local, l.codigo, l.dimensao, l.tipo, l.especificacao, l.quantidade]
          .filter(Boolean).join(' | '),
      },
    };
    const cadeia = (nomeLocal) => [
      nomeLocal || 'local não informado',
      q.titulo || 'quadro da prancha',
      l.grupo ? `${l.grupo}${l.codigo ? ' ' + l.codigo : ''}` : (l.codigo || 'linha do quadro'),
      descricao,
      categoria || 'categoria não mapeada',
    ];

    if (!alvos.length) {
      out.push(espDeLinha(base, null, {
        localNome: l.local || '',
        tipologia: (emp.estrutura?.tipologia?.[0]?.nome) || '',
        confianca: 'baixa', status: 'revisar',
        motivos: [l.local ? 'termo_sem_ambiente' : 'incompleto'],
        cadeia: cadeia(l.local),
        ev: { metodoQuadro: q.chave },
      }));
    } else for (const a of alvos) {
      out.push(espDeLinha(base, a, {
        confianca: 'alta', status: 'identificado', motivos: [],
        cadeia: cadeia(a.nome),
        ev: { metodoQuadro: q.chave },
      }));
    }
  }
  return out;
}

function deLegendaAmbientes(emp, tb, folha, docMeta) {
  const iDesc = primeiraCol(tb, [['DESCRI', 'MATERIAL', 'ESPECIFICA', 'ACABAMENTO'], 0]);
  const iAmb = idxCol(tb, ['AMBIENT', 'LOCAL', 'APLICA']);
  const iForn = idxCol(tb, ['FORNECEDOR', 'MARCA']);
  const iArea = idxCol(tb, ['ÁREA', 'AREA']);
  if (iDesc < 0 || iAmb < 0) return [];
  const categoria = categoriaDe(tb.titulo) || '';
  const pavs = [...new Set(emp.locais.filter(a => a.status !== 'excluido').map(a => a.pavimento).filter(Boolean))];
  const vivos = emp.locais.filter(a => a.status !== 'excluido');
  const out = [];

  for (let r = 1; r < tb.linhas.length; r++) {
    const c = tb.linhas[r].celulas;
    const desc = (c[iDesc] || '').trim();
    const alvoTexto = (c[iAmb] || '').trim();
    if (desc.length < 4 || /^descri/i.test(desc)) continue;
    const fornecedor = iForn >= 0 ? limparForn(c[iForn]) : '';
    const area = iArea >= 0 ? (c[iArea] || '').trim() : '';
    const aberto = /\betc\b|\.\.\./i.test(alvoTexto);      // lista não exaustiva
    const classe = classificar(desc, categoria);
    const base = {
      origemLeitura: 'legenda_tabela',
      categoria: classe?.categoria || categoria,
      produto: classe?.produto || '',
      sistema: classe?.sistema || '',
      descricao: desc, codigoOrigem: '', marca: '', modelo: '',
      fornecedor,
      origemClasse: classe ? classe.origem : '',
      ev: {
        documentoOrigem: { docId: docMeta.id, nomeDoc: docMeta.nome, pagina: folha.pagina },
        tipo: 'tabela',
        coordenadas: tb.linhas[r].caixa, regiao: tb.caixa || tb.linhas[r].caixa,
        tabelaCoordenadas: tb.caixa || null,
        tituloLegenda: tb.titulo,
        texto: c.filter(Boolean).join(' | '),
      },
    };

    const termos = alvoTexto.split(/\s*(?:,|;|\/| e )\s*/).map(t => t.trim())
      .filter(t => t && !/^etc\.?$/i.test(t));
    const vistos = new Set();
    let casouAlgo = false;

    for (const termo of termos) {
      const casos = casarAmbientes(termo, vivos, pavs);
      if (!casos.length) {
        // termo escrito na legenda que não corresponde a nenhum ambiente lido
        out.push(espDeLinha(base, null, {
          localNome: termo, confianca: 'baixa', status: 'revisar', motivos: ['termo_sem_ambiente'],
          cadeia: [termo + ' (termo da legenda)', tb.titulo, desc, base.categoria || 'categoria não mapeada'],
        }));
        continue;
      }
      casouAlgo = true;
      // "Geral" é catálogo, não distribuição: vira uma linha só, sem local,
      // para você decidir onde entra — em vez de 43 rodapés repetidos
      if (casos[0].forca === 'geral') {
        out.push(espDeLinha(base, null, {
          localNome: termo, confianca: 'media', status: 'revisar', motivos: ['vinculo_geral'],
          cadeia: [`${termo} — vale para os locais que você indicar`, tb.titulo, desc, base.categoria || 'categoria não mapeada'],
          ev: { termoLegenda: termo, forcaVinculo: 'geral' },
        }));
        continue;
      }
      for (const { ambiente, forca } of casos) {
        if (vistos.has(ambiente.id)) continue;
        vistos.add(ambiente.id);
        const f = FORCA[forca] || FORCA.familia;
        const frouxo = aberto && forca !== 'exata';
        out.push(espDeLinha(base, ambiente, {
          confianca: frouxo ? 'baixa' : f.confianca,
          status: forca === 'exata' && !frouxo ? 'identificado' : 'revisar',
          motivos: [...f.motivos, ...(frouxo ? ['lista_aberta'] : [])],
          cadeia: [ambiente.nome, tb.titulo, `coluna de ambientes: ${alvoTexto}`, desc, base.categoria || 'categoria não mapeada'],
          ev: { termoLegenda: termo, forcaVinculo: forca, areaLegenda: area },
        }));
      }
    }
    if (!termos.length && !casouAlgo) {
      out.push(espDeLinha(base, null, {
        confianca: 'baixa', status: 'revisar', motivos: ['incompleto'],
        cadeia: ['local não informado', tb.titulo, desc, base.categoria || 'categoria não mapeada'],
      }));
    }
  }
  return out;
}

function primeiraCol(tb, [termos, padrao]) {
  const i = idxCol(tb, termos);
  return i >= 0 ? i : padrao;
}
const limparForn = v => {
  const s = (v || '').trim();
  return /^[-–—]?$/.test(s) || /^(a\s*definir|à\s*definir|indefinido)$/i.test(s) ? '' : s;
};

function deEsquadrias(emp, tb, folha, docMeta) {
  const iCod = idxCol(tb, ['NUM', 'CÓD', 'COD', 'LOCAL ']) >= 0 ? idxCol(tb, ['NUM', 'CÓD', 'COD']) : 0;
  const iDim = idxCol(tb, ['DIM']);
  const iPeit = idxCol(tb, ['PEIT']);
  const iDesc = idxCol(tb, ['DESCRI']);
  const iLoc = idxCol(tb, ['LOCAL', 'AMBIENT']);
  const iQtd = idxCol(tb, ['QTD', 'QUANT']);
  const out = [];
  let secao = null;
  for (let r = 1; r < tb.linhas.length; r++) {
    const c = tb.linhas[r].celulas;
    const cod = (c[iCod] || '').trim();
    const desc = (c[iDesc] || '').trim();
    const soUm = c.filter(Boolean).length === 1;
    if (soUm) { const s2 = lerSecaoEsquadria(c.find(Boolean)); if (s2) secao = { ...s2, texto: c.find(Boolean) }; continue; }
    if (!desc || !cod) continue;
    const locTexto = (c[iLoc] || '').trim();
    const alvos = acharAmbientes(emp, locTexto);
    const partes = [cod, (c[iDim] || '').trim() ? `${c[iDim]} m` : '', desc].filter(Boolean);
    const classe = classificar([secao?.texto, desc].filter(Boolean).join(' '), 'Esquadrias');
    const base = {
      origemLeitura: 'tabela', categoria: 'Esquadrias',
      produto: secao?.tipo || classe?.produto || '',
      sistema: secao?.sis || classe?.sistema || '',
      descricao: partes.join(' — '),
      codigoOrigem: cod, dimensao: (c[iDim] || '').trim(), peitoril: (c[iPeit] || '').trim().replace(/^-$/, ''),
      quantidade: (c[iQtd] || '').trim(), marca: '', fornecedor: '',
      ev: {
        documentoOrigem: { docId: docMeta.id, nomeDoc: docMeta.nome, pagina: folha.pagina },
        tipo: 'tabela',
        coordenadas: tb.linhas[r].caixa, regiao: tb.caixa || tb.linhas[r].caixa,
        tabelaCoordenadas: tb.caixa || null,
        texto: c.filter(Boolean).join(' | '), tituloLegenda: tb.titulo,
      },
    };
    if (!alvos.length) {
      out.push(espDeLinha(base, null, {
        localNome: locTexto, tipologia: (emp.estrutura?.tipologia?.[0]?.nome) || '',
        confianca: 'baixa', status: 'revisar', motivos: ['incompleto'],
        cadeia: [locTexto || 'local não informado', tb.titulo, cod, desc, 'Esquadrias'],
      }));
    } else for (const a of alvos) {
      out.push(espDeLinha(base, a, {
        confianca: 'alta', status: 'identificado', motivos: [],
        cadeia: [a.nome, tb.titulo, cod, desc, 'Esquadrias'],
      }));
    }
  }
  return out;
}

function dePedras(emp, tb, folha, docMeta) {
  const iCod = idxCol(tb, ['CÓD', 'COD']);
  const iDim = idxCol(tb, ['DIM']);
  const iDesc = idxCol(tb, ['DESCRI']);
  const iLoc = idxCol(tb, ['LOCALIZ', 'AMBIENT', 'LOCAL']);
  const iQtd = idxCol(tb, ['QUANT', 'QTD']);
  const out = [];
  for (let r = 1; r < tb.linhas.length; r++) {
    const c = tb.linhas[r].celulas;
    const desc = (c[iDesc] || '').trim();
    const cod = (c[iCod] || '').trim();
    if (!desc) continue;
    const locTexto = (c[iLoc] || '').trim();
    const alvos = acharAmbientes(emp, locTexto);
    const dim = (c[iDim] || '').trim();
    const classe = classificar(desc, 'Revestimentos em Pedras Naturais');
    const base = {
      origemLeitura: 'tabela', categoria: classe?.categoria || 'Revestimentos em Pedras Naturais',
      produto: classe?.produto || '',
      sistema: classe?.sistema || '',
      descricao: [cod, desc, dim ? `${dim} cm` : ''].filter(Boolean).join(' — '),
      codigoOrigem: cod, dimensao: dim, quantidade: (c[iQtd] || '').trim(), marca: '', fornecedor: '',
      ev: {
        documentoOrigem: { docId: docMeta.id, nomeDoc: docMeta.nome, pagina: folha.pagina },
        tipo: 'tabela',
        coordenadas: tb.linhas[r].caixa, regiao: tb.caixa || tb.linhas[r].caixa,
        tabelaCoordenadas: tb.caixa || null,
        texto: c.filter(Boolean).join(' | '), tituloLegenda: tb.titulo,
      },
    };
    if (!alvos.length) {
      out.push(espDeLinha(base, null, {
        localNome: locTexto, tipologia: (emp.estrutura?.tipologia?.[0]?.nome) || '',
        confianca: 'baixa', status: 'revisar', motivos: ['incompleto'],
        cadeia: [locTexto || 'local não informado', tb.titulo, cod || '—', desc, 'Revestimentos em Pedras Naturais'],
      }));
    } else for (const a of alvos) {
      out.push(espDeLinha(base, a, {
        confianca: 'alta', status: 'identificado', motivos: [],
        cadeia: [a.nome, tb.titulo, cod || '—', desc, 'Revestimentos em Pedras Naturais'],
      }));
    }
  }
  return out;
}

/** Incorpora um achado avulso (memorial, entrada manual) ao acervo. */
/**
 * Incorpora uma Especificação avulsa — a que vem do memorial, ou a criada à
 * mão na interface. Mesma regra de merge das pranchas.
 */
export function incorporarEspecificacaoSolta(emp, esp) {
  emp.locais = emp.locais || [];
  emp.especificacoesSemLocal = emp.especificacoesSemLocal || [];
  const r = incorporarEspecificacao(emp, indiceDeChaves(emp), esp);
  sincronizar(emp);
  return r;
}

export { FORMAS };
