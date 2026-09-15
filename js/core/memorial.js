/* Leitura de memorial descritivo em PDF.

   O memorial é texto corrido: o que se extrai daqui é o que está escrito,
   frase por frase, com a página e o trecho de origem guardados. Quando o
   memorial nomeia marca, linha ou modelo, esse dado entra como uma fonte a
   mais — nunca substitui em silêncio o que a prancha disse. */

import { readText } from './pdfdoc.js';
import { IA, iaLigada, chamarBff, anotarFalha, anotarSucesso } from './ia.js';
import {
  novoId, normalizar, casarAmbientes,
  criarEspecificacao, criarEvidencia, criarLocal,
} from './model.js';
import { classificarArea, marcadorDeGrupo, partesDoNome, pavimentoNoNome, familiaDoNome, mesmoCerne } from './areas.js';
import { especificacoesDe } from './exporter.js';
import { classificar } from './glossario.js';

const ROTULOS = [
  { p: /^(piso|pisos|revestimento de piso|pavimenta[çc][ãa]o)\b/i, cat: 'Piso' },
  { p: /^(rodap[ée]s?)\b/i, cat: 'Piso' },
  { p: /^(parede|paredes|revestimento de parede|revestimentos? de paredes?)\b/i, cat: 'Paredes' },
  { p: /^(pintura|pinturas|textura)\b/i, cat: 'Paredes' },
  { p: /^(teto|tetos|forro|forros)\b/i, cat: 'Teto' },
  { p: /^(bancadas?|tampos?)\b/i, cat: 'Bancadas' },
  { p: /^(soleiras?|peitoris?|pingadeiras?|pedras?\s+naturais?)\b/i, cat: 'Revestimentos em Pedras Naturais' },
  { p: /^(esquadrias?|portas?|janelas?|portais?|marcos?)\b/i, cat: 'Esquadrias' },
  { p: /^(lou[çc]as?|bacia|cuba|lavat[óo]rio|tanque|mict[óo]rio|chuveiro|ducha)\b/i, cat: 'Louças' },
  { p: /^(baguetes?|tentos?|baguete e tento|filetes?)\b/i, cat: 'Revestimentos em Pedras Naturais' },
  { p: /^(acess[óo]rios?|barras? de apoio)\b/i, cat: 'Acessórios' },
  { p: /^(metais|metal|torneiras?|registros?|sif[õo]es?)\b/i, cat: 'Metais' },
  { p: /^(lumin[áa]rias?|ilumina[çc][ãa]o)\b/i, cat: 'Luminárias' },
  { p: /^(marcenaria|mobili[áa]rio|armários?)\b/i, cat: 'Mobiliário' },
];

const CAMPOS = [
  { chave: 'marca', p: /\b(?:marca|fabricante)\s*[:\-–]\s*([^;\n]{2,48})/i },
  { chave: 'fornecedor', p: /\bfornecedor\s*[:\-–]\s*([^;\n]{2,60})/i },
  { chave: 'modelo', p: /\b(?:modelo|refer[êe]ncia|ref\.?)\s*[:\-–]\s*([^;\n]{2,48})/i },
  { chave: 'linha', p: /\blinha\s*[:\-–]\s*([^;\n]{2,48})/i },
];

/* Quando o próprio rótulo do memorial já nomeia o produto, ele vale mais que
   o termo achado no meio da frase. */
const PRODUTO_POR_ROTULO = {
  bancada: 'Bancada', bancadas: 'Bancada', tampo: 'Bancada',
  soleira: 'Soleira', soleiras: 'Soleira', peitoril: 'Peitoril', peitoris: 'Peitoril',
  pingadeira: 'Pingadeira', rodape: 'Rodapé', rodapes: 'Rodapé',
  cuba: 'Cuba', bacia: 'Bacia sanitária', 'bacia sanitaria': 'Bacia sanitária', lavatorio: 'Lavatório',
  tanque: 'Tanque', baguete: 'Baguete', 'baguete e tento': 'Baguete e tento', tento: 'Tento',
  forro: 'Forro de gesso', forros: 'Forro de gesso',
  pintura: 'Pintura', textura: 'Textura', rejunte: 'Rejunte',
  porta: 'Porta', portas: 'Porta', janela: 'Janela', janelas: 'Janela', portais: 'Portal', marcos: 'Marco',
};

/** Um PDF sem desenho e com muito texto é um memorial, não uma prancha. */
export function pareceMemorial({ tracos, caracteres, paginas }) {
  if (!caracteres) return false;
  const porPagina = caracteres / Math.max(1, paginas);
  return tracos < 1500 && porPagina > 900;
}

/** Memorial digitalizado (escaneado) sem OCR quase não tem texto extraível,
    mesmo tendo dezenas de páginas cheias de conteúdo visual — é o sinal de
    que vale a pena rodar OCR antes de tentar ler. Amostra as primeiras
    páginas em vez do documento inteiro: já entrega a resposta e não paga o
    custo de abrir todas as páginas de um memorial grande. */
export async function precisaDeOcr(doc, amostraPaginas = 3) {
  const n = Math.min(amostraPaginas, doc.numPages);
  let caracteres = 0;
  for (let p = 1; p <= n; p++) {
    const linhas = await lerPagina(await doc.getPage(p));
    caracteres += linhas.reduce((s, l) => s + l.texto.length, 0);
  }
  return caracteres < 40 * n;
}

/**
 * Reconstrói linhas e parágrafos de uma página de texto corrido.
 *
 * Mesma altura não é mesma linha: o cabeçalho lateral do escritório
 * (endereço, telefone, em corpo miúdo) divide o y com o texto do memorial,
 * e colado ao título vira "WCs PNE DO TÉRREO capote valente 830". Um vão
 * horizontal largo, ou uma troca de corpo de letra com vão, abre outra coluna
 * — e cada coluna é uma linha por si.
 */
export async function lerPagina(page) {
  const largura = page.getViewport({ scale: 1 }).width;
  const itens = (await readText(page)).filter(t => t.horizontal);
  itens.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const faixas = [];
  for (const it of itens) {
    const ult = faixas[faixas.length - 1];
    if (ult && Math.abs(it.y - ult.y) < 3.2) ult.partes.push(it);
    else faixas.push({ y: it.y, partes: [it] });
  }
  const linhas = [];
  for (const f of faixas) {
    const partes = f.partes.sort((a, b) => a.x - b.x);
    let seg = null;
    for (const p of partes) {
      const vao = seg ? p.x - seg.x1 : 0;
      const corpoDiferente = seg && Math.abs(p.h - seg.h) > 2 && vao > 4;
      if (!seg || vao > Math.max(14, seg.h * 2.4) || corpoDiferente) {
        seg = { y: f.y, x0: p.x, x1: p.x + p.w, h: p.h, partes: [p] };
        linhas.push(seg);
      } else {
        seg.partes.push(p);
        seg.x1 = Math.max(seg.x1, p.x + p.w);
        seg.h = Math.max(seg.h, p.h);
      }
    }
  }
  return linhas.map(l => ({
    texto: l.partes.map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
    caixa: [l.x0, l.y - l.h - 1, l.x1, l.y + 3],
    y: l.y, altura: l.h, largura,
  })).filter(l => l.texto);
}

/* O cabeçalho lateral do escritório — nome, endereço, telefone numa coluna
   estreita à direita — não é memorial. Uma linha curta que começa no quarto
   final da página é isso, e sai antes da leitura. */
const colunaLateral = l => l.largura && l.caixa[0] > l.largura * 0.72 && (l.caixa[2] - l.caixa[0]) < l.largura * 0.25;

/**
 * Extrai locais e itens de um memorial.
 *
 * O memorial é organizado por títulos — "HALL DE ENTRADA", "DORMITÓRIOS",
 * "COZINHA" — e cada título abre uma seção de "Piso: … / Parede: … / Teto: …".
 * O título é o nome do local; a seção é o que mora dentro dele. Quem já
 * existe na árvore (lido das pranchas) recebe os itens; quem não existe é
 * criado aqui, com a evidência apontando o título na página do memorial. Os
 * marcadores "ÁREAS COMUNS" / "ÁREAS PRIVATIVAS" dizem de que manual cada
 * seção é; sem marcador, o vocabulário do nome decide.
 *
 * ambientesConhecidos: os locais já lidos das pranchas. Cada título é casado
 * com eles por nome e por família — "DORMITÓRIOS" alcança DORM.01 e DORM.02
 * de todas as tipologias, "BANHEIRO" alcança BANHO e BANHO MASTER — e só
 * vira local novo quando nenhum serve.
 *
 * Devolve { especificacoes, secoes, locaisNovos, casados }. Os locais novos
 * NÃO entram na árvore aqui: o chamador os guarda antes de incorporar os
 * itens, que já apontam para eles pelo id.
 */
export async function analisarMemorial(doc, docMeta, ambientesConhecidos, aoProgredir = () => {}, opcoes = {}) {
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    aoProgredir(`memorial — página ${p} de ${doc.numPages}`, (p - 1) / doc.numPages);
    const daPagina = await lerPagina(await doc.getPage(p));
    const corpos = daPagina.map(l => l.altura).sort((a, b) => a - b);
    const corpo = corpos[Math.floor(corpos.length / 2)] || 10;
    for (const l of daPagina) if (l.texto.length >= 3 && !colunaLateral(l)) linhas.push({ ...l, pagina: p, corpo });
  }
  classificarLinhas(linhas);
  /* areasComuns: true, false, ou 'auto' — no automático o memorial só divide
     comum × privativa se ele mesmo tiver os marcadores de seção */
  const modo = opcoes.areasComuns === undefined ? true : opcoes.areasComuns;
  return montarSecoes(linhas, docMeta, ambientesConhecidos || [], { areasComuns: modo });
}

/* Código de norma ou de produto em caixa alta ("NBR 9050", "RVI30790") não é
   título, por mais destacado que esteja. */
const CODIGO_SOLTO = /^[A-Z]{2,5}\s?-?\s?\d{3,}/;

/** Título de seção: caixa alta (ou corpo maior), curto, sem dois-pontos. */
function ehTitulo(l) {
  const t = l.texto.replace(/[:–—-]\s*$/, '').trim();
  if (t.length < 3 || t.length > 72 || t.includes(':')) return false;
  if (l.largura && l.caixa[0] > l.largura * 0.72) return false;
  if (/^[-•–●]/.test(t) || CODIGO_SOLTO.test(t)) return false;
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letras.length < 3) return false;
  const caixaAlta = letras.replace(/[^A-ZÀ-Ý]/g, '').length / letras.length >= 0.8;
  const palavras = t.split(/\s+/).length;
  if (caixaAlta) return palavras <= 12;
  /* corpo maior sem caixa alta: só quando começa em maiúscula e é curto —
     "As especificações dos revestimentos são referenciais…" é frase */
  return l.altura > l.corpo * 1.06 && /^[A-ZÀ-Ý]/.test(t) && palavras <= 6;
}

/**
 * Cada linha vira item ("Piso: …"), título, parágrafo rotulado ("FACHADAS: …",
 * que é texto corrido com rótulo, não acabamento) ou texto. Texto logo abaixo
 * de um item é a continuação da frase e é absorvido por ele. Depois, o título
 * é classificado pelo que o segue: marcador de grupo, local (título seguido
 * de itens) ou seção (título sem itens, que só reinicia o contexto).
 */
function classificarLinhas(linhas) {
  for (const l of linhas) {
    l.item = lerItem(l.texto);
    l.tipo = l.item ? 'item'
      : /^[^:]{2,48}:\s*\S/.test(l.texto) ? 'rotulado'
      : ehTitulo(l) ? 'titulo' : 'texto';
    /* "CALÇADAS: Piso intertravado de concreto…" — o local e o seu único
       item na mesma linha. Só quando o rótulo é nome de área: "ESQUADRIAS DE
       ALUMÍNIO: Serão executadas…" tem a mesma forma e não é local. */
    if (l.tipo === 'rotulado') {
      const m = /^([^:]{2,48}):\s*(.+)$/.exec(l.texto);
      const item = m && classificarArea(m[1]) ? lerItem(m[2]) : null;
      if (item) { l.tipo = 'local'; l.tituloLocal = m[1].trim(); l.item = item; }
    }
  }
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.tipo !== 'texto') continue;
    const ant = linhas[i - 1].dono || linhas[i - 1];
    if (!ant.item || ant.tipo !== 'item' || ant.pagina !== l.pagina || ant.item.descricao.length > 600) continue;
    /* mesmo corpo de letra e mesma margem: é a frase que continuou. Texto
       miúdo à direita é o cabeçalho da folha; texto recuado é outra coisa. */
    if (Math.abs(l.altura - ant.altura) > 1.5 || l.caixa[0] > ant.caixa[0] + 30) continue;
    ant.item.descricao = (ant.item.descricao + ' ' + l.texto).replace(/\s+/g, ' ').trim();
    ant.caixa = [Math.min(ant.caixa[0], l.caixa[0]), ant.caixa[1], Math.max(ant.caixa[2], l.caixa[2]), l.caixa[3]];
    l.tipo = 'absorvida'; l.dono = ant;
  }
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.tipo !== 'titulo') continue;
    const marcador = marcadorDeGrupo(l.texto);
    if (marcador) { l.tipo = 'marcador'; l.grupo = marcador; continue; }
    const seguintes = linhas.slice(i + 1, i + 6).filter(x => x.tipo !== 'absorvida');
    const iItem = seguintes.findIndex(x => x.tipo === 'item');
    const iTitulo = seguintes.findIndex(x => x.tipo === 'titulo' || x.tipo === 'marcador');
    l.tipo = iItem >= 0 && iItem <= 1 && (iTitulo < 0 || iItem < iTitulo) ? 'local' : 'secao';
  }
}

/**
 * Os locais da árvore que um título do memorial alcança. Cada parte do título
 * ("SALA ESTAR / JANTAR E CIRCULAÇÃO" são três) é casada por nome, por
 * plural/abreviação (casarAmbientes) e por família (BANHEIRO ↔ BANHO). O grupo
 * filtra: uma seção de áreas comuns nunca cai num cômodo de apartamento, e uma
 * seção privativa nunca cai numa área comum — a palavra "SALA" está nos dois
 * mundos, e é o grupo que separa.
 */
function casarTitulo(nome, pavimento, grupo, arvore) {
  const vivos = arvore.filter(a => a && a.status !== 'excluido');
  const vocab = a => classificarArea(a.nome);
  const deUnidade = a => !!(a.tipologiaId || a.tipologia);
  /* quando as pranchas marcaram as unidades (TIPO 1, TIPO 2…), cômodo de
     unidade é o que tem tipologia — o WC do subsolo não é o BANHEIRO do
     apartamento, mesmo sem a palavra dizer de quem ele é */
  const temTipologias = vivos.some(deUnidade);
  const compativel = a => {
    if (pavimento && a.pavimento && normalizar(a.pavimento) !== normalizar(pavimento)) return false;
    if (grupo === 'comum') return !deUnidade(a) && vocab(a) !== 'privativa'
      && (a.areaComum || a.origem !== 'memorial');
    if (grupo === 'privativa') return !a.areaComum && vocab(a) !== 'comum'
      && (!temTipologias || deUnidade(a) || a.origem === 'memorial');
    return true;
  };
  const candidatos = vivos.filter(compativel);
  const pavs = [...new Set(vivos.map(a => a.pavimento).filter(Boolean))];
  const achados = new Map();
  for (const parte of partesDoNome(nome)) {
    for (const c of casarAmbientes(parte, candidatos, pavs)) {
      if (c.forca !== 'exata') continue;
      achados.set(c.ambiente.id, c.ambiente);
    }
    const fam = familiaDoNome(parte);
    for (const a of candidatos) {
      if ((fam && familiaDoNome(a.nome) === fam) || mesmoCerne(parte, a.nome)) achados.set(a.id, a);
    }
  }
  return [...achados.values()];
}

function montarSecoes(linhas, docMeta, conhecidos, { areasComuns }) {
  const especificacoes = [], secoes = [], locaisNovos = [];
  const arvore = [...conhecidos];                   // cresce com o que é criado aqui
  const marcadores = linhas.filter(l => l.tipo === 'marcador').map(l => l.grupo);
  const temC = marcadores.includes('comum'), temP = marcadores.includes('privativa');
  const automatico = areasComuns === 'auto';
  if (automatico) areasComuns = temC || temP;
  /* antes do primeiro marcador: um memorial que só marca onde começam as
     privativas está dizendo que tudo antes é comum — e vice-versa */
  let grupo = !areasComuns ? 'privativa' : (temP && !temC) ? 'comum' : (temC && !temP) ? 'privativa' : '';
  let alvos = [];
  let casados = 0;

  for (const l of linhas) {
    if (l.tipo === 'marcador') { grupo = areasComuns ? l.grupo : 'privativa'; alvos = []; continue; }
    if (l.tipo === 'secao') { alvos = []; continue; }
    if (l.tipo === 'local') {
      const titulo = (l.tituloLocal || l.texto).replace(/[:–—-]\s*$/, '').trim();
      const { nome, pavimento } = pavimentoNoNome(titulo);
      const g = areasComuns ? (grupo || classificarArea(nome)) : '';
      alvos = casarTitulo(nome, pavimento, g, arvore);
      if (alvos.length) casados += alvos.length;
      else {
        const novo = criarLocal(nome, '', pavimento);
        novo.origem = 'memorial'; novo.confianca = 'alta'; novo.status = 'identificado';
        novo.areaComum = g === 'comum';
        novo.evidencias.push(criarEvidencia({
          documentoOrigem: { docId: docMeta.id, pagina: l.pagina, nomeDoc: docMeta.nome },
          tipo: 'rotulo',
          coordenadas: l.caixa,
          regiao: [l.caixa[0] - 8, l.caixa[1] - 26, l.caixa[2] + 8, l.caixa[3] + 60],
          tituloLegenda: 'Memorial descritivo',
          texto: titulo,
          cadeia: [nome, 'Memorial descritivo — página ' + l.pagina, 'título de seção',
            g === 'comum' ? 'área comum' : g === 'privativa' ? 'unidade privativa' : 'grupo não informado'],
          proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'titulo_memorial', confianca: 'alta' },
        }));
        locaisNovos.push(novo); arvore.push(novo); alvos = [novo];
      }
      /* o memorial disse de que manual o local é: quem veio da prancha sem
         tipologia (e sem a palavra decidir) herda a resposta */
      if (g) for (const a of alvos) if (!a.tipologiaId && !a.tipologia && !classificarArea(a.nome)) a.areaComum = g === 'comum';
      secoes.push({ pagina: l.pagina, ambiente: nome, pavimento, grupo: g, y: l.y, alvos: alvos.map(a => a.nome) });
      if (!l.item) continue;
    } else if (l.tipo !== 'item') continue;

    const item = l.item;
    const t = l.texto;
    const campos = {};
    for (const c of CAMPOS) { const m = c.p.exec(item.descricao); if (m) campos[c.chave] = limpar(m[1]); }
    const descricaoLimpa = item.descricao
      .replace(/\b(?:marca|fabricante|fornecedor)\s*[:\-–]\s*[^;.]*\.?$/i, '')
      .replace(/[;,\s.]+$/, '').trim();
    const classe = classificar(descricaoLimpa, item.categoria);
    const trecho = `${item.rotulo}: ${descricaoLimpa || item.descricao}`.slice(0, 400);
    const destinos = alvos.length ? alvos : [acharAmbienteNaFrase(t, arvore)].filter(Boolean);
    const confianca = destinos.length ? (campos.marca ? 'alta' : 'media') : 'baixa';

    const montar = (alvo) => {
      const esp = criarEspecificacao({
        categoria: classe?.categoria || item.categoria || '',
        produto: PRODUTO_POR_ROTULO[normalizar(item.rotulo)] || classe?.produto || '',
        sistema: classe?.sistema || '',
        descricao: descricaoLimpa || item.descricao,
        modelo: campos.modelo || campos.linha || '',
        marca: campos.marca || '',
        fornecedor: campos.fornecedor || '',
        origemLeitura: 'memorial',
        confianca,
        status: alvo ? 'identificado' : 'revisar',
        motivos: alvo ? [] : ['incompleto'],
        localId: alvo ? alvo.id : null,
        localNome: alvo ? alvo.nome : '',
        pavimento: alvo ? (alvo.pavimento || '') : '',
        tipologia: alvo ? (alvo.tipologia || '') : '',
      });
      esp.evidencias.push(criarEvidencia({
        documentoOrigem: { docId: docMeta.id, pagina: l.pagina, nomeDoc: docMeta.nome },
        tipo: 'texto_memorial',
        coordenadas: l.caixa,
        regiao: [l.caixa[0] - 8, l.caixa[1] - 26, l.caixa[2] + 8, l.caixa[3] + 26],
        tituloLegenda: 'Memorial descritivo',
        texto: trecho,
        cadeia: [
          alvo ? alvo.nome : 'local não identificado',
          'Memorial descritivo — página ' + l.pagina,
          item.rotulo || 'trecho descritivo',
          descricaoLimpa || item.descricao,
          classe?.categoria || item.categoria || 'categoria não mapeada',
        ],
        proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'memorial_texto', confianca },
      }));
      return esp;
    };
    if (!destinos.length) especificacoes.push(montar(null));
    else for (const alvo of destinos) especificacoes.push(montar(alvo));
  }
  return { especificacoes, secoes, locaisNovos, casados, marcadores, areasComunsAtivadas: automatico && areasComuns };
}

function limpar(s) {
  // corta no próximo rótulo do tipo "Paredes:" para não colar duas frases
  return (s || '')
    .split(/\s+[A-ZÀ-Ý][A-Za-zà-ÿ]{2,}\s*:/)[0]
    .replace(/["“”']/g, '').replace(/\s+/g, ' ').replace(/[,;.]+$/, '').trim();
}

function acharAmbienteNaFrase(texto, ambientes) {
  const n = normalizar(texto);
  let melhor = null;
  for (const a of ambientes) {
    const na = normalizar(a.nome);
    if (na.length >= 4 && n.includes(na) && (!melhor || na.length > normalizar(melhor.nome).length)) melhor = a;
  }
  return melhor;
}

function lerItem(texto) {
  const limpo = texto.replace(/^[-•–●\s]+/, '').trim();
  if (limpo.length < 8) return null;
  const sep = limpo.match(/^([^:]{3,42}):\s*(.+)$/);
  if (sep) {
    const rotulo = sep[1].trim();
    for (const r of ROTULOS) if (r.p.test(rotulo)) return { categoria: r.cat, rotulo, descricao: sep[2].trim() };
    return null;
  }
  for (const r of ROTULOS) {
    if (!r.p.test(limpo)) continue;
    if (limpo.length < 18 || limpo.length > 320) return null;
    return { categoria: r.cat, rotulo: limpo.split(/\s+/).slice(0, 2).join(' '), descricao: limpo };
  }
  return null;
}

/* ================================================================== */
/* FUSÃO SEMÂNTICA                                                     */
/*                                                                     */
/* A prancha diz "Piso 01" e a legenda traduz para "PORCELANATO A       */
/* DEFINIR". O memorial escreve, dez páginas depois, "Piso: porcelanato */
/* Flakes SBE NAT 120x120, marca Ceusa". É o mesmo produto, e nenhuma   */
/* substring liga os dois: só o sentido liga.                          */
/*                                                                     */
/* Por isso a heurística de `cruzarComPranchas` continua existindo como */
/* rede — ela acerta quando as palavras coincidem — mas quem faz o      */
/* casamento de verdade é a IA, pelo BFF, e cada atualização só é       */
/* aceita com o trecho literal do memorial em mãos: sem prova, não      */
/* entra.                                                              */
/* ================================================================== */

/** O texto do memorial, página por página, com as linhas para achar a caixa. */
export async function textoDoMemorial(doc, aoProgredir = () => {}) {
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    aoProgredir(`memorial — lendo página ${p} de ${doc.numPages}`, (p - 1) / doc.numPages);
    const linhas = await lerPagina(await doc.getPage(p));
    paginas.push({ pagina: p, texto: linhas.map(l => l.texto).join('\n'), linhas });
  }
  return paginas;
}

/** O que o BFF precisa saber da árvore: só o que ajuda a casar. */
function resumoDaArvore(emp) {
  const vivo = x => x && x.status !== 'excluido';
  return (emp.locais || []).filter(vivo).map(l => ({
    id: l.id, nome: l.nome, pavimento: l.pavimento || '',
    especificacoes: (l.especificacoes || []).filter(vivo)
      /* item que já veio do próprio memorial não entra: casá-lo consigo mesmo
         não acrescenta nada */
      .filter(e => e.origemLeitura !== 'memorial')
      .map(e => ({
        id: e.id, categoria: e.categoria || '', produto: e.produto || '',
        sistema: e.sistema || '', descricao: e.descricao || '',
        codigoOrigem: e.codigoOrigem || '', marca: e.marca || '',
        modelo: e.modelo || '', fornecedor: e.fornecedor || '',
      })),
  })).filter(l => l.especificacoes.length);
}

/* Acha onde o trecho está na página, para a evidência ter as coordenadas dos
   três níveis. Sem isto, o "Ver na prancha" do memorial não teria para onde
   ir. Casa por normalização: o modelo copia o texto, mas os espaços variam. */
function caixaDoTrecho(linhas, trecho) {
  if (!linhas || !linhas.length || !trecho) return null;
  const alvo = normalizar(trecho);
  if (alvo.length < 8) return null;
  const casadas = [];
  for (const l of linhas) {
    const n = normalizar(l.texto);
    if (n.length < 6) continue;
    if (alvo.includes(n) || n.includes(alvo.slice(0, Math.min(60, alvo.length)))) casadas.push(l);
  }
  if (!casadas.length) return null;
  const c = casadas.map(l => l.caixa);
  return [
    Math.min(...c.map(x => x[0])), Math.min(...c.map(x => x[1])),
    Math.max(...c.map(x => x[2])), Math.max(...c.map(x => x[3])),
  ];
}

const porId = (emp) => {
  const m = new Map();
  for (const l of (emp.locais || [])) for (const e of (l.especificacoes || [])) m.set(e.id, { esp: e, local: l });
  for (const e of (emp.especificacoesSemLocal || [])) m.set(e.id, { esp: e, local: null });
  return m;
};

const CAMPOS_ENRIQUECIVEIS = ['produto', 'sistema', 'marca', 'modelo', 'fornecedor'];

/**
 * Aplica as atualizações que a IA devolveu.
 *
 * Regra de ouro: toda alteração ganha uma Evidência nova do tipo
 * `texto_memorial`, apontando a página e o trecho exato que a sustenta, com
 * proveniência `{ motor_ia: 'multimodal_gemini', metodo: 'fusao_semantica' }`.
 * A prancha nunca é sobrescrita: campo já preenchido fica como está, e
 * material diferente vira conflito em vez de correção.
 */
export function aplicarFusao(emp, atualizacoes, docMeta, paginas = []) {
  const mapa = porId(emp);
  const linhasPor = new Map(paginas.map(p => [p.pagina, p.linhas || []]));
  const r = { enriquecidas: 0, campos: 0, conflitos: 0, ignoradas: 0, marcas: 0 };

  for (const a of atualizacoes) {
    const alvo = mapa.get(a.especificacaoId);
    if (!alvo || !a.trecho) { r.ignoradas++; continue; }
    const esp = alvo.esp;
    const caixa = caixaDoTrecho(linhasPor.get(a.pagina), a.trecho);

    const ev = criarEvidencia({
      documentoOrigem: { docId: docMeta.id, pagina: a.pagina, nomeDoc: docMeta.nome },
      tipo: 'texto_memorial',
      coordenadas: caixa,
      regiao: caixa ? [caixa[0] - 10, caixa[1] - 34, caixa[2] + 10, caixa[3] + 34] : null,
      tituloLegenda: 'Memorial descritivo',
      texto: a.trecho,
      cadeia: [
        alvo.local ? alvo.local.nome : (esp.localNome || 'local não identificado'),
        `Memorial descritivo — página ${a.pagina}`,
        a.justificativa || 'casamento semântico',
        a.trecho,
        esp.categoria || 'categoria não mapeada',
      ].filter(Boolean),
      proveniencia: { motor_ia: 'multimodal_gemini', metodo: 'fusao_semantica', confianca: a.confianca || 'media' },
    });

    if (a.acao === 'conflito') {
      esp.status = 'conflito';
      esp.divergencias = esp.divergencias || [];
      esp.divergencias.push({
        documento: docMeta.nome, pagina: a.pagina,
        descricao: a.conflitoMemorial || a.trecho,
      });
      if (!(esp.motivos || []).includes('conflito')) (esp.motivos = esp.motivos || []).push('conflito');
      ev.texto = a.trecho;
      ev.cadeia = [ev.cadeia[0], `Memorial descritivo — página ${a.pagina}`,
        `A prancha diz "${a.conflitoPrancha || esp.descricao || '—'}"`,
        `O memorial diz "${a.conflitoMemorial || a.trecho}"`,
        'conflito documental — nenhuma fonte foi descartada'];
      esp.evidencias.push(ev);
      r.conflitos++;
      continue;
    }

    // enriquecimento: só o que estava vazio
    let mudou = 0;
    for (const campo of CAMPOS_ENRIQUECIVEIS) {
      if (!esp[campo] && a[campo]) { esp[campo] = a[campo]; mudou++; if (campo === 'marca') r.marcas++; }
    }
    if (!esp.descricao && a.descricaoMemorial) { esp.descricao = a.descricaoMemorial; mudou++; }
    if (!mudou) { r.ignoradas++; continue; }

    esp.evidencias.push(ev);
    if (esp.confianca === 'baixa' && a.confianca === 'alta') esp.confianca = 'media';
    if (esp.status === 'revisar' && a.confianca === 'alta' && esp.marca) esp.status = 'identificado';
    r.enriquecidas++; r.campos += mudou;
  }
  return r;
}

/**
 * A fusão inteira: lê o texto, pergunta ao BFF, aplica. Devolve o relatório e
 * o motor que efetivamente trabalhou.
 *
 * Se a IA estiver desligada, falhar ou estourar o tempo, cai na heurística de
 * `cruzarComPranchas` — o processamento do memorial nunca é abortado.
 */
export async function fundirComMemorial(emp, doc, docMeta, especsMemorial = [], aoProgredir = () => {}) {
  if (!iaLigada()) {
    return { motor: 'fallback_vetorial', ...cruzarComPranchas(emp, especsMemorial), atualizacoes: 0 };
  }
  const locais = resumoDaArvore(emp);
  if (!locais.length) {
    return { motor: 'fallback_vetorial', ...cruzarComPranchas(emp, especsMemorial), atualizacoes: 0,
      aviso: 'não havia especificação de prancha para casar' };
  }
  try {
    aoProgredir('memorial — casamento semântico com as pranchas', 0.75);
    const paginas = await textoDoMemorial(doc, aoProgredir);
    const corpo = {
      documento: docMeta.nome || '',
      paginas: paginas.map(p => ({ pagina: p.pagina, texto: p.texto })),
      locais,
    };
    const resposta = await chamarBff(IA.rotaMemorial, corpo, IA.timeoutMemorialMs);
    anotarSucesso();
    const atualizacoes = Array.isArray(resposta.atualizacoes) ? resposta.atualizacoes : [];
    const r = aplicarFusao(emp, atualizacoes, docMeta, paginas);
    return { motor: 'multimodal_gemini', ...r, atualizacoes: atualizacoes.length,
      lotes: resposta.lotes || 1, recusadas: resposta.recusadas || null };
  } catch (err) {
    anotarFalha(err, 'fusão semântica do memorial');
    return { motor: 'fallback_vetorial', ...cruzarComPranchas(emp, especsMemorial), atualizacoes: 0,
      erro: err.message || String(err) };
  }
}

/**
 * A rede: cruzamento por heurística de texto. Preenche marca e modelo onde
 * estavam vazios e marca conflito onde as duas fontes divergem. É o que roda
 * quando a fusão semântica não está disponível.
 */
export function cruzarComPranchas(emp, especsMemorial) {
  const relatorio = { marcas: 0, conflitos: 0 };
  const daPrancha = especificacoesDe(emp).filter(a => a.origemLeitura !== 'memorial');
  for (const m of especsMemorial) {
    if (!m.localId || (!m.marca && !m.modelo)) continue;
    const ev = (m.evidencias || [])[0] || {};
    const doc = (ev.documentoOrigem || {});
    const tokens = new Set(normalizar(m.descricao).split(' ').filter(w => w.length > 4));
    for (const a of daPrancha) {
      if (a === m) continue;
      if (a.localId !== m.localId || a.categoria !== m.categoria) continue;
      const na = normalizar(a.descricao);
      const comuns = [...tokens].filter(t => na.includes(t)).length;
      const mesmoProduto = m.produto && a.produto === m.produto;
      if (!mesmoProduto && comuns < 2) continue;
      if (m.marca) {
        if (!a.marca) {
          a.marca = m.marca; relatorio.marcas++;
          /* a marca entra como uma evidência a mais: quem preencheu o campo
             fica escrito, com a página do memorial */
          a.evidencias.push(criarEvidencia({
            documentoOrigem: { docId: doc.docId, pagina: doc.pagina, nomeDoc: doc.nomeDoc },
            tipo: 'texto_memorial',
            coordenadas: ev.coordenadas || null, regiao: ev.regiao || null,
            tituloLegenda: 'Memorial descritivo',
            texto: `Marca informada no memorial: ${m.marca}`,
            cadeia: [a.localNome, 'Memorial descritivo — página ' + doc.pagina, 'Marca', m.marca],
            proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'cruzamento_memorial', confianca: 'alta' },
          }));
        } else if (normalizar(a.marca) !== normalizar(m.marca)) {
          a.status = 'conflito';
          a.divergencias.push({ documento: doc.nomeDoc || '', pagina: doc.pagina, descricao: `Marca ${m.marca} (prancha indica ${a.marca})` });
          if (!a.motivos.includes('conflito')) a.motivos.push('conflito');
          relatorio.conflitos++;
        }
      }
      if (m.modelo && !a.modelo) a.modelo = m.modelo;
      if (m.fornecedor && !a.fornecedor) a.fornecedor = m.fornecedor;
    }
  }
  return relatorio;
}
