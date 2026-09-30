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
import { classificarArea, marcadorDeGrupo, partesDoNome, pavimentoNoNome, familiaDoNome, mesmoCerne,
  separarNumeracao, tituloLimpo, tipologiaDoMarcador, ehTituloDeCategoria, restoDoTituloDeCategoria } from './areas.js';
import { especificacoesDe } from './exporter.js';
import { classificar } from './glossario.js';
import { itensEsperados } from './ambiente.js';
import { marcaNaDescricao, temIncerteza } from './marcas.js';

const ROTULOS = [
  { p: /^(piso|pisos|revestimento de piso|pavimenta[çc][ãa]o)\b/i, cat: 'Piso' },
  { p: /^(rodap[ée]s?)\b/i, cat: 'Piso' },
  { p: /^(parede|paredes|revestimento de parede|revestimentos? de paredes?)\b/i, cat: 'Paredes' },
  { p: /^(pintura|pinturas|textura)\b/i, cat: 'Paredes' },
  { p: /^(teto|tetos|forro|forros)\b/i, cat: 'Teto' },
  { p: /^(bancadas?|tampos?)\b/i, cat: 'Bancadas' },
  { p: /^(soleiras?|peitoris?|pingadeiras?|pedras?\s+naturais?)\b/i, cat: 'Revestimentos em Pedras Naturais' },
  { p: /^(esquadrias?|portas?|janelas?|portais?|marcos?)\b/i, cat: 'Esquadrias' },
  { p: /^(guarda[- ]?corpos?|corrim[ãa]os?|gradis?)\b/i, cat: 'Esquadrias' },
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
  'guarda-corpo': 'Guarda-corpo', 'guarda corpo': 'Guarda-corpo', guardacorpo: 'Guarda-corpo',
  'guarda-corpos': 'Guarda-corpo', corrimao: 'Corrimão', corrimaos: 'Corrimão', gradil: 'Gradil',
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
  const uteis = semCabecalhoERodape(linhas, doc.numPages);
  const composicao = lerComposicao(uteis);
  classificarLinhas(uteis);
  /* areasComuns: true, false, ou 'auto' — no automático o memorial só divide
     comum × privativa se ele mesmo tiver os marcadores de seção */
  const modo = opcoes.areasComuns === undefined ? true : opcoes.areasComuns;
  return { ...montarSecoes(uteis, docMeta, ambientesConhecidos || [], { areasComuns: modo }), composicao };
}

/* A composição do memorial de incorporação: "1º Pavimento: Composto dos
   apartamentos 101, 102 e 103, cada um com sala de estar e jantar, lavabo,
   …; apartamentos 104 e 105, cada um com …". É a lista das unidades com os
   seus cômodos — a comparação local a local que a planilha pede para
   decidir quais unidades são a mesma tipologia (a mesma aba MP) e quais
   têm planta própria: a frase igual é a unidade igual. */
const COMPOSICAO = /\b(apartamentos?|aptos?\.?|unidades?|casas?|lojas?|salas?(?:\s+comerciais?)?)\s+(?:n[ºo°]s?\.?\s*)?((?:\d{1,4}\s*(?:,|\be\b|\ba\b|\bao\b|\bat[ée]\b)\s*)*\d{1,4})\s*,?\s*(?:cada\s+um[a]?\s+)?com\s+(.+?)(?=\s*[;.](?:\s|$)|\s+sendo\b|\s*,\s*(?:apartamentos?|aptos?\.?|unidades?|casas?|lojas?|salas?)\s+(?:n[ºo°]s?\.?\s*)?\d|$)/gi;

/**
 * Devolve { unidades: [{ numero, prefixo, comodos: [frases], paginas }],
 * tipologias: [{ nome: 'APTO 101', prefixo, unidades: ['101', …], comodos,
 * paginas }] } — as tipologias são os grupos de unidades com a mesma lista
 * de cômodos. A unidade duplex aparece em dois pavimentos e soma as duas
 * frases. Sem composição no memorial, as duas listas saem vazias.
 */
export function lerComposicao(linhas) {
  const partes = [];
  let texto = '';
  const paginas = [...new Set(linhas.map(l => l.pagina))].sort((a, b) => a - b);
  for (const p of paginas) {
    partes.push({ inicio: texto.length, pagina: p });
    texto += linhas.filter(l => l.pagina === p).map(l => l.texto).join(' ') + ' ';
  }
  const paginaEm = idx => { let pg = paginas[0] || 1; for (const p of partes) if (p.inicio <= idx) pg = p.pagina; return pg; };
  const unidades = new Map();
  const re = new RegExp(COMPOSICAO.source, 'gi');
  let m;
  while ((m = re.exec(texto))) {
    const numeros = (m[2].match(/\d{1,4}/g) || []).map(n => n.replace(/^0+(?=\d)/, ''));
    const frase = m[3].replace(/\s+/g, ' ').trim();
    if (!numeros.length || frase.length < 8) continue;
    const prefixo = /^casa/i.test(m[1]) ? 'CASA' : /^loja/i.test(m[1]) ? 'LOJA' : /^sala/i.test(m[1]) ? 'SALA' : 'APTO';
    const pagina = paginaEm(m.index);
    for (const n of numeros) {
      const u = unidades.get(n) || { numero: n, prefixo, comodos: [], paginas: [] };
      if (!u.comodos.includes(frase)) u.comodos.push(frase);
      if (!u.paginas.includes(pagina)) u.paginas.push(pagina);
      unidades.set(n, u);
    }
  }
  const grupos = new Map();
  for (const u of unidades.values()) {
    const k = u.prefixo + '|' + normalizar(u.comodos.join(' + ')).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!grupos.has(k)) grupos.set(k, { prefixo: u.prefixo, unidades: [], comodos: u.comodos.join(' + '), paginas: [] });
    const g = grupos.get(k);
    g.unidades.push(u.numero);
    for (const p of u.paginas) if (!g.paginas.includes(p)) g.paginas.push(p);
  }
  const porNumero = (a, b) => Number(a) - Number(b);
  const tipologias = [...grupos.values()].map(g => {
    g.unidades.sort(porNumero);
    return { ...g, nome: `${g.prefixo} ${g.unidades[0]}` };
  }).sort((a, b) => porNumero(a.unidades[0], b.unidades[0]));
  return { unidades: [...unidades.values()].sort((a, b) => porNumero(a.numero, b.numero)), tipologias };
}

/* Rodapé e cabeçalho da folha — endereço do escritório, telefone, a régua
   de sublinhados — repetem-se no pé (ou no alto) de página em página. Não
   são memorial, e no meio de uma seção separam o título dos seus itens:
   "2.12 – BARRILETE" no fim da página 8 perdia o "Piso: cimentado" do começo
   da 9. Só sai a linha de borda repetida em metade das páginas (três, no
   mínimo); a mesma frase no meio do texto fica. */
const REGUA = /^[\s_\-=.·•*~]{3,}$/;
function semCabecalhoERodape(linhas, numPaginas) {
  const porPagina = new Map();
  for (const l of linhas) { if (!porPagina.has(l.pagina)) porPagina.set(l.pagina, []); porPagina.get(l.pagina).push(l); }
  const paginasDe = new Map();
  for (const [p, ls] of porPagina) {
    for (const l of [...ls.slice(0, 3), ...ls.slice(-3)]) {
      l.borda = true;
      const k = normalizar(l.texto);
      if (k.length < 4) continue;
      if (!paginasDe.has(k)) paginasDe.set(k, new Set());
      paginasDe.get(k).add(p);
    }
  }
  const minimo = Math.max(3, Math.ceil(numPaginas / 2));
  return linhas.filter(l => {
    if (REGUA.test(l.texto)) return false;
    if (!l.borda) return true;
    const s = paginasDe.get(normalizar(l.texto));
    return !(s && s.size >= minimo);
  });
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
      const rotulo = m ? tituloLimpo(m[1]) : '';
      const item = m && classificarArea(rotulo) ? lerItem(m[2]) : null;
      if (item) { l.tipo = 'local'; l.tituloLocal = rotulo; l.item = item; }
    }
  }
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.tipo === 'absorvida' || l.tipo === 'marcador' || l.tipo === 'local') continue;
    const ant = linhas[i - 1].dono || linhas[i - 1];
    if (!ant.item || ant.tipo !== 'item' || ant.pagina !== l.pagina) continue;
    if (Math.abs(l.altura - ant.altura) > 1.5) continue;
    /* a margem da lista é a do primeiro item rotulado; os irmãos recuados
       herdam-na, para o terceiro produto ser medido contra "Louça:" e não
       contra o segundo */
    const margem = ant.item.margem ?? ant.caixa[0];
    const recuo = l.caixa[0] - margem;
    if (recuo > 30) {
      /* linha recuada sob um item rotulado — "Louça: Cuba de semiencaixe…"
         e, abaixo, alinhados com a descrição, "Cuba de apoio…" e "CJ BC+CX…
         ROCA" — é outro produto da mesma lista: não é a continuação da
         frase nem um título, mesmo em caixa alta. Vira item irmão, com o
         rótulo e a categoria do primeiro. */
      if (recuo > 90 || l.texto.length > 160 || /^[-•–●]/.test(l.texto)) continue;
      if (l.tipo === 'item') { l.item.margem = margem; continue; }
      if ((l.tipo === 'texto' || l.tipo === 'titulo') && ant.item.rotulo) {
        l.item = { categoria: ant.item.categoria, rotulo: ant.item.rotulo, descricao: l.texto.trim(), margem };
        l.tipo = 'item';
      }
      continue;
    }
    if (l.tipo !== 'texto' || ant.item.descricao.length > 600) continue;
    /* mesmo corpo de letra e mesma margem: é a frase que continuou. Texto
       miúdo à direita é o cabeçalho da folha. */
    ant.item.descricao = (ant.item.descricao + ' ' + l.texto).replace(/\s+/g, ' ').trim();
    ant.caixa = [Math.min(ant.caixa[0], l.caixa[0]), ant.caixa[1], Math.max(ant.caixa[2], l.caixa[2]), l.caixa[3]];
    l.tipo = 'absorvida'; l.dono = ant;
  }
  let dentroDeGrupo = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.tipo !== 'titulo') continue;
    /* "2.6 – DAS GARAGENS": a numeração e a preposição são do documento; o
       nome é GARAGENS. O número fica guardado para a evidência. */
    const { numero, nome } = separarNumeracao(l.texto);
    l.numero = numero; l.titulo = nome;
    const marcador = marcadorDeGrupo(nome);
    if (marcador) {
      l.tipo = 'marcador'; l.grupo = marcador; dentroDeGrupo = true;
      /* "APTO DE COBERTURA" abre a parte de uma tipologia só; "APARTAMENTO
         TIPO" e "UNIDADES AUTÔNOMAS" valem para todas */
      l.tipologia = marcador === 'privativa' ? tipologiaDoMarcador(nome) : '';
      continue;
    }
    /* "ESQUADRIAS DAS UNIDADES", "PISOS DAS ÁREAS COMUNS": seção sobre um
       produto para um lado inteiro do condomínio, não sobre um lugar. Os
       itens dela são gerais — valem para todos os locais daquele lado. */
    const geral = secaoGeral(nome);
    if (geral) { l.tipo = 'geral'; l.geral = geral; continue; }
    /* "PORCELANATO PORTOBELLO 60X60" em caixa alta, seguido de linhas de
       especificação, tem a forma de um título de local — e é o nome de um
       produto. Produto, material ou código de catálogo nunca vira local:
       a seção só reinicia o contexto. */
    if (ehProduto(nome)) { l.tipo = 'secao'; continue; }
    const seguintes = linhas.slice(i + 1, i + 6).filter(x => x.tipo !== 'absorvida');
    const iItem = seguintes.findIndex(x => x.tipo === 'item');
    const iTitulo = seguintes.findIndex(x => x.tipo === 'titulo' || x.tipo === 'marcador' || x.tipo === 'geral');
    if (iItem >= 0 && iItem <= 1 && (iTitulo < 0 || iItem < iTitulo)) { l.tipo = 'local'; continue; }
    /* "PISCINA" seguido de "Conforme projeto de decoração específico…": é
       um local cujos acabamentos o memorial deixou para outro projeto. O
       local existe; as linhas dele saem vazias, com esse motivo à vista. Só
       dentro da parte de acabamentos (depois de um marcador de grupo): no
       capítulo de sistemas, "GARAGENS — vagas conforme projeto" não é local. */
    const prox = seguintes[0];
    if (dentroDeGrupo && prox && prox.tipo === 'texto' && A_DEFINIR.test(prox.texto)) { l.tipo = 'local'; l.aDefinir = prox.texto.trim(); continue; }
    l.tipo = 'secao';
  }
}

const A_DEFINIR = /conforme (?:o )?projeto (?:de |da |do )?(?:decora|interiores|arquitet|paisagism|espec[ií]fico de)|acabamentos? (?:conforme|a definir)|\ba definir\b|a ser(?:em)? (?:definid|desenvolvid|detalhad|especificad)/i;

/* Grupo de locais que a seção geral nomeia: "DAS UNIDADES" → privativa,
   "DAS ÁREAS COMUNS" → comum. Sem nome de grupo, a seção vale para o
   empreendimento inteiro e os itens ficam sem local, à espera da triagem. */
const ESCOPO_COMUM = /\b(?:areas? comuns?|condominio|uso comum|areas? condominia\w*|areas? de lazer|areas? sociais|areas? coletivas)\b/;
const ESCOPO_PRIVATIVA = /\b(?:unidades?|apartamentos?|aptos?|areas? privativas?|casas?)\b/;
function secaoGeral(titulo) {
  if (!ehTituloDeCategoria(titulo)) return null;
  const resto = restoDoTituloDeCategoria(titulo);
  const escopo = ESCOPO_COMUM.test(resto) ? 'comum' : ESCOPO_PRIVATIVA.test(resto) ? 'privativa' : '';
  /* "PISO DA GARAGEM" é categoria + lugar, e "FORRO DE GESSO ACARTONADO" é
     nome de produto: nenhum dos dois é seção geral */
  if (!escopo && resto && (classificarArea(resto) || ehProduto(resto))) return null;
  let categoria = '';
  for (const r of ROTULOS) if (r.p.test(titulo)) { categoria = r.cat; break; }
  return { categoria, escopo, titulo };
}

/* Material, produto ou código de catálogo — o que um título de memorial
   pode ser sem ser um local. O vocabulário de local (áreas.js) tem a última
   palavra: "SALA DE ESTAR" nunca cai aqui, mesmo que o glossário conheça
   "estar". */
const MATERIAL = /\b(porcelanato|cer[âa]mic|azulejo|pastilha|ladrilho|granito|m[áa]rmore|quartzo|pedra|pintura|tinta|textura|grafiato|verniz|esmalte|forro|gesso|drywall|rodap[ée]|soleira|peitoril|rejunte|argamassa|contrapiso|reboco|vidro|alum[íi]nio|madeira|acr[íi]lic|pvc|inox|laminado|vin[íi]lic|carpete|metal|lou[çc]a|bacia|cuba|torneira|registro|chuveiro|ducha|lumin[áa]ria|l[âa]mpada|interruptor|tomada|porta|janela|esquadria|fechadura|ma[çc]aneta|bancada|tampo|impermeabiliza|manta|tela|piso|revestimento|papel de parede|cimento|concreto|tijolo|bloco)\b/i;
const CODIGO_CATALOGO = /\b[A-Z]{1,4}[-\s]?\d{2,}[A-Z0-9-]*\b/;
const MEDIDA_NO_NOME = /\d+\s?[xX×]\s?\d+/;
export function ehProduto(titulo) {
  const t = tituloLimpo(String(titulo || ''));
  if (!t || classificarArea(t)) return false;
  if (MEDIDA_NO_NOME.test(t) || CODIGO_CATALOGO.test(t)) return true;
  if (MATERIAL.test(t)) return true;
  const c = classificar(t);
  return !!(c && c.produto);
}

/**
 * Os locais da árvore que um título do memorial alcança. Cada parte do título
 * ("SALA ESTAR / JANTAR E CIRCULAÇÃO" são três) é casada por nome, por
 * plural/abreviação (casarAmbientes) e por família (BANHEIRO ↔ BANHO). O grupo
 * filtra: uma seção de áreas comuns nunca cai num cômodo de apartamento, e uma
 * seção privativa nunca cai numa área comum — a palavra "SALA" está nos dois
 * mundos, e é o grupo que separa.
 */
function casarTitulo(nome, pavimento, grupo, arvore, tipologia = '') {
  const vivos = arvore.filter(a => a && a.status !== 'excluido');
  const vocab = a => classificarArea(a.nome);
  const deUnidade = a => !!(a.tipologiaId || a.tipologia);
  /* quando as pranchas marcaram as unidades (TIPO 1, TIPO 2…), cômodo de
     unidade é o que tem tipologia — o WC do subsolo não é o BANHEIRO do
     apartamento, mesmo sem a palavra dizer de quem ele é */
  const temTipologias = vivos.some(deUnidade);
  const compativel = a => {
    if (pavimento && a.pavimento && normalizar(a.pavimento) !== normalizar(pavimento)) return false;
    /* seção de uma tipologia só ("APTO DE COBERTURA"): só os cômodos dela */
    if (tipologia && normalizar(a.tipologia || '') !== normalizar(tipologia)) return false;
    /* dois títulos diferentes do memorial são dois locais: "HALL ELEVADORES
       (GARAGENS)" não recebe os itens de "HALL ELEVADORES (PAVTO. TIPO)" */
    if (a.origem === 'memorial' && normalizar(a.nome) !== normalizar(nome)) return false;
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

const rotuloDoEscopo = escopo => escopo === 'comum' ? 'todas as áreas comuns'
  : escopo === 'privativa' ? 'todos os cômodos das unidades' : 'todo o empreendimento';

/* O rótulo de seção geral que a regra de ambiente (ambiente.js) sabe
   distribuir: porta em todo cômodo fechado que tem porta, rodapé em todo
   cômodo seco. "Portas: porta pronta branca" em "ESQUADRIAS DAS UNIDADES"
   vira a linha de porta de cada cômodo das unidades — a revisar, com a
   seção geral como fonte. Janelas, portões e vidros não têm regra que diga
   em que cômodo estão: ficam sem local, para a triagem. */
const ESPERADO_POR_ROTULO = { porta: 'Porta', portas: 'Porta', rodape: 'Rodapé', rodapes: 'Rodapé' };
function destinosGerais(geral, item, arvore, jaLidas) {
  const produto = ESPERADO_POR_ROTULO[normalizar(item.rotulo).replace(/[^a-z]/g, '')];
  if (!produto || !geral.escopo) return [];
  /* a seção do próprio local vence a geral: "ESCADAS — Porta: corta-fogo"
     não recebe a porta pronta branca das unidades */
  const temDoLocal = a => jaLidas.some(e => e.localId === a.id && e.produto === produto);
  return arvore.filter(a => a && a.status !== 'excluido'
    && (a.areaComum ? 'comum' : 'privativa') === geral.escopo
    && itensEsperados(a.nome).some(x => x.produto === produto)
    && !temDoLocal(a));
}

function montarSecoes(linhas, docMeta, conhecidos, { areasComuns }) {
  const especificacoes = [], secoes = [], locaisNovos = [], gerais = [];
  const arvore = [...conhecidos];                   // cresce com o que é criado aqui
  const marcadores = linhas.filter(l => l.tipo === 'marcador').map(l => l.grupo);
  const temC = marcadores.includes('comum'), temP = marcadores.includes('privativa');
  /* o lado que o próprio documento declara (nome, pasta, carimbo ou IA —
     js/core/disciplina.js): "MEMORIAL DESCRITIVO ÁREAS COMUNS.pdf" sem os
     marcadores dentro é um memorial de área comum do começo ao fim */
  const ladoDoc = docMeta && (docMeta.lado === 'comum' || docMeta.lado === 'privativa') ? docMeta.lado : '';
  const automatico = areasComuns === 'auto';
  if (automatico) areasComuns = temC || temP || ladoDoc === 'comum';
  /* antes do primeiro marcador: um memorial que só marca onde começam as
     privativas está dizendo que tudo antes é comum — e vice-versa */
  let grupo = !areasComuns ? 'privativa' : (temP && !temC) ? 'comum' : (temC && !temP) ? 'privativa' : ladoDoc;
  let alvos = [];
  let tipologia = '';       // a tipologia que o marcador privativo abriu ("COBERTURA"); '' = todas
  let geral = null;         // a seção geral de categoria em curso ("ESQUADRIAS DAS UNIDADES")
  let casados = 0;

  for (const l of linhas) {
    if (l.tipo === 'marcador') {
      grupo = areasComuns ? l.grupo : 'privativa';
      tipologia = grupo === 'privativa' ? (l.tipologia || '') : '';
      alvos = []; geral = null;
      continue;
    }
    if (l.tipo === 'secao') { alvos = []; geral = null; continue; }
    if (l.tipo === 'geral') {
      /* só conta como seção geral quando traz itens: "5.3 – VIDRO" seguido
         de texto corrido é só um título que reinicia o contexto */
      alvos = []; geral = { ...l.geral, pagina: l.pagina, registrada: false };
      continue;
    }
    if (l.tipo === 'local') {
      geral = null;
      const titulo = l.tituloLocal || l.titulo || tituloLimpo(l.texto);
      const { nome, pavimento } = pavimentoNoNome(titulo);
      const g = areasComuns ? (grupo || classificarArea(nome)) : '';
      const tip = g === 'privativa' ? tipologia : '';
      alvos = casarTitulo(nome, pavimento, g, arvore, tip);
      if (alvos.length) casados += alvos.length;
      else {
        const novo = criarLocal(nome, '', pavimento);
        novo.origem = 'memorial'; novo.confianca = 'alta'; novo.status = 'identificado';
        novo.areaComum = g === 'comum';
        if (tip) novo.tipologia = tip;
        const lado = g === 'comum' ? 'área comum' : g === 'privativa' ? 'unidade privativa' : 'grupo não informado';
        novo.evidencias.push(criarEvidencia({
          documentoOrigem: { docId: docMeta.id, pagina: l.pagina, nomeDoc: docMeta.nome },
          tipo: 'rotulo',
          coordenadas: l.caixa,
          regiao: [l.caixa[0] - 8, l.caixa[1] - 26, l.caixa[2] + 8, l.caixa[3] + 60],
          tituloLegenda: 'Memorial descritivo',
          texto: l.texto.trim(),
          cadeia: [nome, 'Memorial descritivo — página ' + l.pagina,
            l.numero ? `título da seção ${l.numero}: “${l.texto.trim()}”` : 'título de seção',
            lado + (tip ? ' · ' + tip : ''),
            ...(l.aDefinir ? [`acabamentos não especificados no memorial: “${l.aDefinir}”`] : [])],
          proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'titulo_memorial', confianca: 'alta' },
        }));
        locaisNovos.push(novo); arvore.push(novo); alvos = [novo];
      }
      /* o memorial disse de que manual o local é: quem veio da prancha sem
         tipologia (e sem a palavra decidir) herda a resposta */
      if (g) for (const a of alvos) if (!a.tipologiaId && !a.tipologia && !classificarArea(a.nome)) a.areaComum = g === 'comum';
      secoes.push({ pagina: l.pagina, ambiente: nome, pavimento, grupo: g, tipologia: tip, y: l.y, alvos: alvos.map(a => a.nome), aDefinir: l.aDefinir || '' });
      if (!l.item) continue;
    } else if (l.tipo !== 'item') continue;

    const item = l.item;
    const t = l.texto;
    const campos = {};
    for (const c of CAMPOS) { const m = c.p.exec(item.descricao); if (m) campos[c.chave] = limpar(m[1]); }
    const descricaoLimpa = item.descricao
      .replace(/\b(?:marca|fabricante|fornecedor)\s*[:\-–]\s*[^;.]*\.?$/i, '')
      .replace(/[;,\s.]+$/, '').trim();
    /* "Porcelanato ONYX … – Portobello ou similar": a marca está na frase,
       sem o rótulo "marca:". Reconhecida, entra no campo — a frase continua
       sendo a evidência. Com duas marcas ("Deca ou Docol") não se escolhe. */
    if (!campos.marca) { const { marca } = marcaNaDescricao(descricaoLimpa); if (marca) campos.marca = marca; }
    const classe = classificar(descricaoLimpa, item.categoria);
    const trecho = `${item.rotulo}: ${descricaoLimpa || item.descricao}`.slice(0, 400);
    /* item de seção geral: vai para cada local do lado que a regra de
       ambiente diz ter aquele produto (porta, rodapé), sempre a revisar; o
       que a regra não sabe distribuir fica sem local, com o motivo escrito */
    const emGeral = !!geral && !alvos.length;
    if (emGeral && !geral.registrada) {
      geral.registrada = true;
      gerais.push({ pagina: geral.pagina, titulo: geral.titulo, categoria: geral.categoria, escopo: geral.escopo });
    }
    const destinos = alvos.length ? alvos
      : emGeral ? destinosGerais(geral, item, arvore, especificacoes)
      : [acharAmbienteNaFrase(t, arvore)].filter(Boolean);
    const confianca = emGeral ? 'media' : destinos.length ? (campos.marca && !temIncerteza(item.descricao) ? 'alta' : 'media') : 'baixa';

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
        status: alvo && !emGeral ? 'identificado' : 'revisar',
        motivos: emGeral ? ['secao_geral'] : alvo ? [] : ['incompleto'],
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
          alvo ? alvo.nome : emGeral ? rotuloDoEscopo(geral.escopo) : 'local não identificado',
          'Memorial descritivo — página ' + l.pagina,
          emGeral ? `seção geral “${geral.titulo}” · ${item.rotulo || 'trecho descritivo'}` : (item.rotulo || 'trecho descritivo'),
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
  return { especificacoes, secoes, gerais, locaisNovos, casados, marcadores, areasComunsAtivadas: automatico && areasComuns };
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

/* "Cuba de Apoio T3 CÓD: A32722N000 – ROCA": o dois-pontos é do código, não
   de um rótulo. A linha inteira é a descrição. */
const PSEUDO_ROTULO = /\b(?:c[óo]d(?:igo)?|ref(?:er[êe]ncia)?|modelo|cor|tam(?:anho)?|dim(?:ens[ãa]o)?|medidas?)\.?$/i;

function lerItem(texto) {
  const limpo = texto.replace(/^[-•–●\s]+/, '').trim();
  if (limpo.length < 8) return null;
  const sep = limpo.match(/^([^:]{3,42}):\s*(.+)$/);
  if (sep && !PSEUDO_ROTULO.test(sep[1].trim())) {
    const rotulo = sep[1].trim();
    for (const r of ROTULOS) if (r.p.test(rotulo)) return { categoria: r.cat, rotulo, descricao: sep[2].trim() };
    return null;
  }
  /* sem rótulo, a linha inteira só é item quando começa como frase de
     especificação ("Bancada em granito…"); "parede são previsíveis…", em
     minúscula, é o meio de um parágrafo */
  if (!/^[A-ZÀ-Ý]/.test(limpo)) return null;
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
