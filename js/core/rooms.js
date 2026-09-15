/* Locais: leitura dos rótulos na prancha e vínculo espacial das tags.

   O vínculo é geodésico — percorre o espaço livre contornando as paredes — e
   não pela simples distância em linha reta, que atravessaria alvenaria.

   A leitura dos rótulos é o começo de tudo: local que não é lido aqui não
   existe no resto do sistema. E numa A0 de arquitetura isso é difícil porque
   o rótulo do ambiente divide o mesmo corpo de letra com todo o resto do
   desenho — cotas (.24, 3.22), níveis (742.21), códigos de esquadria (PM3,
   J12), números de degrau, notas de projeção. Medir só a altura da letra não
   separa nada.

   Por isso a leitura é por EVIDÊNCIAS EM CAMADAS, e cada local sai com o grau
   de certeza que a prancha permitiu:

     alta   o nome tem área cotada logo abaixo. É o padrão de projeto e não
            deixa dúvida.
     media  o nome está no vocabulário de ambientes (COZINHA, B.SERVIÇO,
            GOURMET, PISCINA…), dentro da planta, no corpo de letra dos
            rótulos — mas sem área cotada ao lado.
     baixa  o nome só tem a tipografia a favor: caixa alta, curto, dentro da
            planta, no corpo certo, e nada o reprova. Entra como proposta e
            aparece na fila de revisão.

   O que NÃO entra: número, cota, nível, código de esquadria ou pedra, e
   anotação de elemento construtivo (jardineira, pergolado, projeção, mureta).
   Anotação de duas linhas é remontada antes de julgar — "pergolado com
   fechamento" + "em vidro" é uma frase só, e frase não é nome de ambiente. */

import { isDark } from './pdfdoc.js';
import { lerTipologia, classificarArea } from './areas.js';

/* ================================================================== */
/* VOCABULÁRIOS                                                        */
/* ================================================================== */

/** Área cotada: "13.52 m²", "2,11m2", "81 m²". */
const AREA = /^\d{1,4}(?:[.,]\d{1,2})?\s*m\s*[²2³]$/i;
/* Alguns escritórios escrevem nome e área no mesmo texto: "COZINHA 13.52 m²". */
const NOME_E_AREA = /^(.{2,30}?)[\s\-–—:]+(\d{1,4}(?:[.,]\d{1,2})?\s*m\s*[²2³])$/i;

/* Cotas, níveis e numerações do desenho. É o que mais se parece com rótulo:
   mesmo corpo de letra, dentro da planta, em toda parte. */
const NUMERICO = /^[\d.,\s+\-–x×/ºª°%]+$/;
const NIVEL = /^\d{2,4}[.,]\d{1,3}$|^(?:N|NA|NÍVEL|NIVEL|COTA)\s*[:=.]?\s*[\d.,\-+]*$/i;
const CODIGO = /^[A-Z]{1,3}[\s.-]?\d{1,3}[A-Z]?$/;          // PM3, J12, PA5, SO01, BA02, PI03
const MEDIDA = /^\d+[.,]?\d*\s*(?:m|cm|mm|m[²2³]|%)?\s*[x×]\s*\d/i;

/* Quadros da folha, e não do desenho. */
const MOLDURA = /^(?:LEGENDA|TABELA|QUADRO|NOTAS?|OBSERVA|ESCALA|DATA|FOLHA|PRANCHA|REVIS|ASSUNTO|ARQUIVO|MEMORIAL|PROJETO|CLIENTE|RESPONS|CREA|CAU|ART\b|RRT\b|ÁREA TOTAL|AREA TOTAL|DESCRI[ÇC][ÃA]O|FORNECEDOR|AMBIENTES?$|MATERIAL|C[ÓO]DIGO|DIMENS|PEITORIL|QUANT|TIPOLOGIA|PAVIMENTO\s*$|PLANTA\b|CORTE\b|FACHADA|DETALHE|DET\.|AMPLIA)/i;

/* ------------------------------------------------------------------ */
/* VOCABULÁRIO EDITÁVEL                                                */
/*                                                                     */
/* As duas listas abaixo são o que o sistema sabe sobre o desenho. São  */
/* listas de propósito, e não expressões compiladas à mão: ensinar um   */
/* nome novo é acrescentar uma linha. Cada item é um trecho de padrão   */
/* ancorado no INÍCIO do texto, então "banh" pega BANHO, BANHEIRO e     */
/* B.SERVIÇO não (esse está na lista como "b\\.?\\s?servi").              */
/* ------------------------------------------------------------------ */

/** Anotação de elemento construtivo, projeção e obra — NUNCA é um local.
    É o que mais se confunde com nome de ambiente pequeno, porque aparece em
    caixa baixa no meio do desenho. */
export const VOCAB_ELEMENTOS = [
  // projeções e notas de desenho
  'proj\\.?', 'proje[çc][ãa]o', 'projetad', 'eixo', 'ver ', 'vide', 'idem', 'conforme',
  // paisagismo construído
  'jardineira', 'floreira', 'canteiro', 'vaso', 'grama', 'talude', 'aterro', 'solo',
  // cobertura e vedação
  'pergolad', 'pergola', 'brise', 'clarab[óo]ia', 'domo', 'telha', 'calha', 'rufo',
  'pingadeira', 'al[çc]ap[ãa]o', 'cortineiro', 'forro em', 'forro de', 'laje',
  // limites e proteções
  'muro', 'mureta', 'murete', 'divisa', 'passeio', 'cal[çc]ada', 'guia', 'sarjeta',
  'guarda[\\s-]?corpo', 'corrim[ãa]o', 'gradil', 'alambrado', 'port[ãa]o', 'cerca',
  // estrutura e acabamento bruto
  'viga', 'pilar', 'verga', 'contraverga', 'alvenaria', 'reboco', 'contrapiso', 'impermeabiliza',
  'p[ée] direito', 'p[ée][\\s-]direito',
  // instalações
  'shaft', 'prumada', 'tubula', 'esgoto', '[áa]gua pluvial', 'ralo', 'grelha', 'caixa d',
  'reservat[óo]rio', 'cisterna', 'medidor', 'padr[ãa]o (?:de )?entrada', 'abrigo',
  // mobiliário e equipamento
  'bancada', 'cuba', 'tanque(?! de lavar)', 'coifa', 'forno', 'cooktop', 'geladeira',
  'm[óo]vel', 'm[óo]veis', 'marcenaria', 'armário', 'arm[áa]rio',
  // geometria e vazios
  'vazio', 'v[ãa]o', 'vao', 'abertura', 'nicho', 'rasgo', 'rebaixo', 'desn[íi]vel',
  'degrau', 'espelho(?! d)', 'piso elevado', 'fechamento', 'esquadria',
  // chamada de acabamento: o material especificado no desenho, não um local
  'painel', 'rack', 'piso ', 'revestimento', 'porcelanato', 'cer[âa]mica', 'tijolo',
  'm[áa]rmore', 'granito', 'quartzo', 'dekton', 'silestone', 'travertino', 'pastilha',
  'laminado', 'vin[íi]lico', 'carpete', 'cimento queimado', 'concreto', 'microcimento',
  'papel de parede', 'pintura', 'textura', 'massa', 'grafiato', 'esmalte', 'verniz',
  'rodap[ée]', 'soleira', 'peitoril', 'tabica', 'moldura', 'solidwood', 'viroc',
  'deck em', 'deck de', 'madeira', 'mdf', 'lambri', 'ripado',
  // obra
  'existente', 'a demolir', 'demoli', 'a executar', 'refor[çc]o', 'remover',
  'h\\s*=', 'nv\\s*=', 'i\\s*=', 'decl', 'inclina',
];

/** Nomes de local. É esta lista que permite aceitar um ambiente SEM área
    cotada: PISCINA, DECK, JARDIM e ESCADA não recebem cota de área em
    projeto, mas são locais e têm de sair na planilha. */
export const VOCAB_AMBIENTES = [
  // social
  'sala', 'living', 'estar', 'jantar', 'almo[çc]o', 'recep[çc][ãa]o', 'hall', 'foy[eê]r',
  'lobby', 'ante[\\s-]?sala', 'varanda', 'sacada', 'terra[çc]o', 'balc[ãa]o', 'mirante',
  'deck', 'prainha', 'sol[áa]rio', 'gourmet', 'churrasqueira', 'churrasq', 'bar',
  'adega', 'lareira', 'cinema', 'home', 'm[úu]sica', 'jogos', 'bilhar',
  // íntimo
  'quarto', 'dormit[óo]rio', 'dorm\\b', 'su[íi]te', 'closet', 'rouparia', 'roupeiro',
  'beb[êe]', 'brinquedoteca',
  // banhos
  'banh(?:o|eiro)', 'b\\.?\\s?banh', 'lavabo', 'bwc', 'w\\.?\\s?c\\b', 'sanit[áa]rio', 'toalete',
  'lav\\b', 'ducha', 'vesti[áa]rio', 'banheira', 'sauna', 'spa\\b', 'hidro',
  // serviço
  'cozinha', 'copa', 'despensa', 'pantry', 'a\\.?\\s?s\\b', '[áa]rea de servi[çc]o',
  'b\\.?\\s?servi', 'q\\.?\\s?servi', 'servi[çc]o', 'lavanderia', 'quaradouro', 'quarador',
  'tanque de lavar', 'dml', 'zelador', 'port(?:aria|eiro)', 'guarita',
  'dep[óo]sito', 'dep\\b', 'dsp\\b', 'almoxarifado', 'estoque', 'arquivo morto',
  'casa de m[áa]quinas', 'cabine', 'medi[çc][ãa]o', 'lixo', 'res[íi]duo', 'reciclagem',
  'compostagem', 'gerador', 'bombas', 'central',
  // circulação e técnica
  'circula[çc][ãa]o', 'circ\\b', 'corredor', 'escada', 'escadaria', 'rampa', 'elevador',
  'po[çc]o', 'antec[âa]mara', 'clausura', 'garagem', 'estacionamento', 'vaga', 'box\\b',
  'bicicletario', 'bicicletário', 'manobra', '[áa]rea t[ée]cnica', '[áa]rea tec',
  'casa de bombas', 'cpd', 'barrilete',
  // externo e coletivo
  'jardim', 'horta', 'pomar', 'p[áa]tio', 'quintal', 'piscina', 'borda', 'espelho d',
  'fonte', 'chafariz', 'playground', 'quadra', 'academia', 'fitness', 'sal[ãa]o',
  'festas', 'reuni[õo]es', 'coworking', 'escrit[óo]rio', 'home office', 'estudo',
  'biblioteca', 'ateli[êe]', 'oficina', 'lavagem', 'pet', 'canil', 'gatil', 'cl[íi]nica',
  'enfermaria', 'ambulat[óo]rio', 'loja', 'quiosque', 'bistr[ôo]', 'caf[ée]',
  'restaurante', 'refeit[óo]rio',
];

/** Nomes que bastam por si, mesmo em caixa baixa: não há outro significado
    para eles numa planta de arquitetura. */
export const VOCAB_INEQUIVOCOS = [
  'piscina', 'deck', 'jardim', 'escada', 'rampa', 'garagem', 'cozinha', 'lavabo',
  'sauna', 'hidro', 'quaradouro', 'clausura', 'adega', 'despensa', 'closet',
  'gourmet', 'churrasqueira', 'brinquedoteca', 'playground', 'prainha',
];

const daLista = lista => new RegExp('^(?:' + lista.join('|') + ')', 'i');

const ELEMENTO = daLista(VOCAB_ELEMENTOS);
const AMBIENTE = daLista(VOCAB_AMBIENTES);
const INEQUIVOCO = daLista(VOCAB_INEQUIVOCOS);

/* Palavras que revelam frase, não nome de ambiente. */
const CONECTIVO = /\b(?:com|sem|sob|sobre|entre|para|pelo|pela|de acordo|conforme|tipo|igual|idem|ver|vide|nota)\b/i;

/* ================================================================== */
/* LEITURA DOS RÓTULOS                                                 */
/* ================================================================== */

const limpo = t => (t.str || '').replace(/\s+/g, ' ').trim();
const centro = t => t.x + t.w / 2;
const palavras = s => s.split(/\s+/).filter(Boolean).length;
const caixaAlta = s => s === s.toUpperCase() && /[A-ZÀ-Ý]/.test(s);

/**
 * Remonta anotação escrita em mais de uma linha.
 *
 * No desenho, "pergolado com fechamento" e "em vidro" são duas linhas da mesma
 * frase; "proj." e "clarabóia" também. Julgar cada linha isolada faz a segunda
 * parecer um nome de ambiente curto. Aqui as linhas empilhadas — mesma altura
 * de letra, x sobreposto, uma logo abaixo da outra — viram um bloco só, e é o
 * bloco que vai a julgamento. O rótulo verdadeiro de ambiente é de uma linha
 * (a área, quando existe, é reconhecida à parte).
 */
function blocos(textos, corpo) {
  const ord = [...textos].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const usado = new Set();
  const out = [];
  for (let i = 0; i < ord.length; i++) {
    if (usado.has(i)) continue;
    const base = ord[i];
    const linhas = [base];
    usado.add(i);
    let ultimo = base;
    for (let j = i + 1; j < ord.length; j++) {
      if (usado.has(j)) continue;
      const c = ord[j];
      const dy = c.y - ultimo.y;
      if (dy < 0.5) continue;
      if (dy > Math.max(ultimo.h, corpo || ultimo.h) * 1.75) break;   // já não é a linha seguinte
      if (Math.abs(c.h - ultimo.h) > ultimo.h * 0.25) continue;
      // sobreposição horizontal real, não vizinhança casual
      const sobrepoe = Math.min(c.x + c.w, ultimo.x + ultimo.w) - Math.max(c.x, ultimo.x);
      if (sobrepoe < Math.min(c.w, ultimo.w) * 0.45) continue;
      /* cota, nível, código e numeração pertencem ao desenho, nunca ao rótulo:
         colá-los na frase produziria "JARDIM 738.80" ou "clausura PA4". */
      const sc = limpo(c);
      if (AREA.test(sc) || NIVEL.test(sc) || NUMERICO.test(sc) || CODIGO.test(sc) || MEDIDA.test(sc)) continue;
      linhas.push(c); usado.add(j); ultimo = c;
    }
    out.push({
      itens: linhas,
      frase: linhas.map(limpo).join(' ').replace(/\s+/g, ' ').trim(),
      ancora: base,
    });
  }
  return out;
}

/** O que reprova um texto como nome de local, sem apelação. */
function reprovado(s) {
  if (!s || s.length < 2 || s.length > 34) return true;
  if (AREA.test(s) || NUMERICO.test(s) || NIVEL.test(s) || MEDIDA.test(s)) return true;
  if (CODIGO.test(s)) return true;
  if (MOLDURA.test(s)) return true;
  if (ELEMENTO.test(s)) return true;
  if (!/[A-Za-zÀ-ÿ]{2}/.test(s)) return true;          // precisa de letra de verdade
  if (/^\d/.test(s) && !/^\d+\s*[A-Za-zÀ-ÿ]{3}/.test(s)) return true;
  if (/[()·;]|\.\.\.|=$/.test(s)) return true;
  if (palavras(s) > 4) return true;                     // frase, não rótulo
  return false;
}

/**
 * Grau de certeza de um nome sem área cotada. `null` = não é local.
 *
 * `tipografiaVale` só é verdadeiro quando a folha tem pelo menos um rótulo com
 * área cotada. É uma condição importante: numa prancha de acabamentos, onde
 * ninguém cota área, as chamadas de material ("PAINEL VIROC BRANCO", "PISO
 * TIJOLO CERÂMICA") têm exatamente a mesma tipografia dos rótulos de ambiente.
 * Sem a âncora cotada para calibrar, a tipografia deixa de ser prova e só o
 * vocabulário pode falar.
 */
function grauSemArea(s, dentroDaPlanta, corpoOk, tipografiaVale) {
  if (!dentroDaPlanta) return null;
  if (INEQUIVOCO.test(s)) return 'media';
  if (AMBIENTE.test(s) && palavras(s) <= 4 && !CONECTIVO.test(s)) return 'media';
  if (!tipografiaVale) return null;
  /* sem dicionário, só a tipografia fala: rótulo de ambiente vem em caixa
     alta, curto, no corpo dos demais rótulos. É proposta, nunca certeza. */
  if (corpoOk && caixaAlta(s) && palavras(s) <= 3 && s.length >= 3 && !CONECTIVO.test(s)) return 'baixa';
  return null;
}

/* ------------------------------------------------------------------ */
/* QUADRO NÃO É PLANTA                                                 */
/*                                                                     */
/* A prancha de acabamentos traz um quadro que lista todos os ambientes */
/* uma vez por categoria de material. Aquelas linhas têm o nome certo,  */
/* a tipografia certa e o corpo certo — e não são rótulos de planta.    */
/*                                                                     */
/* O que as denuncia é a geometria: quadro é coluna, planta espalha.    */
/* Medido nas pranchas reais, o maior alinhamento legítimo de rótulos   */
/* numa faixa de 16 pt tem 5 membros, e 4 deles são cotados; o quadro   */
/* de uma prancha de acabamentos alinhou 53, nenhum cotado. O corte em  */
/* 8 fica com folga larga dos dois lados, e nunca descarta um rótulo    */
/* com área cotada — área cotada é prova, e prova não se descarta.      */
/* ------------------------------------------------------------------ */
const LISTA_MINIMA = 8;

function semColunasDeQuadro(lista) {
  if (lista.length < LISTA_MINIMA) return lista;
  const fora = new Set();
  for (const chave of [r => r.bboxTexto[0], r => r.x]) {
    const ord = [...lista].sort((a, b) => chave(a) - chave(b));
    let grupo = [ord[0]];
    const fechar = () => {
      const cotados = grupo.filter(r => r.area).length;
      if (grupo.length >= LISTA_MINIMA && cotados <= 1) {
        for (const r of grupo) if (!r.area) fora.add(r);
      }
    };
    for (let i = 1; i < ord.length; i++) {
      if (chave(ord[i]) - chave(grupo[grupo.length - 1]) <= 16) grupo.push(ord[i]);
      else { fechar(); grupo = [ord[i]]; }
    }
    fechar();
  }
  return lista.filter(r => !fora.has(r));
}

/**
 * Rótulos de local de uma folha.
 *
 * Devolve `{ nome, area, x, y, alturaTexto, bboxTexto, origem, confianca }` —
 * o contrato que o engine consome para criar os Locais da árvore.
 */
export function lerAmbientes(textos, caixasProibidas = []) {
  /* Região de tabela já lida pelo `quadros.js` não é planta: a coluna de
     ambientes de um quadro tem o nome certo e a tipografia certa, e ainda assim
     é uma lista. Quando o motor sabe onde as tabelas estão, a exclusão é exata;
     quando não sabe, `semColunasDeQuadro` ainda a pega pela geometria. */
  const proibido = (x, y) => caixasProibidas.some(c => c && x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3]);
  const horizontais = (textos || []).filter(t => t && t.horizontal !== false && limpo(t)
    && !proibido(t.x + t.w / 2, t.y));

  /* ---------- camada 1: nome + área cotada (certeza) ---------- */
  const confirmados = [];
  const consumido = new Set();

  /* 1a. nome e área no mesmo texto */
  for (const t of horizontais) {
    const m = NOME_E_AREA.exec(limpo(t));
    if (!m) continue;
    const nome = m[1].trim();
    if (reprovado(nome)) continue;
    consumido.add(t);
    confirmados.push({
      nome, area: m[2].trim(),
      x: centro(t), y: t.y, alturaTexto: t.h,
      bboxTexto: [t.x, t.y - t.h, t.x + t.w, t.y + 2],
      origem: 'rotulo+area', confianca: 'alta',
    });
  }

  /* 1b. o caso comum: a área numa linha própria, logo abaixo do nome */
  const areas = horizontais.filter(t => !consumido.has(t) && AREA.test(limpo(t)));
  for (const a of areas) {
    let nome = null, melhor = Infinity;
    for (const t of horizontais) {
      if (t === a || consumido.has(t)) continue;
      const dy = a.y - t.y;                          // o nome fica acima da área
      if (dy < 1.5 || dy > 22) continue;
      if (Math.abs(centro(t) - centro(a)) > 72) continue;
      const s = limpo(t);
      if (reprovado(s)) continue;
      const d = dy + Math.abs(centro(t) - centro(a)) * 0.35;
      if (d < melhor) { melhor = d; nome = t; }
    }
    if (!nome) continue;
    consumido.add(nome); consumido.add(a);
    confirmados.push({
      nome: limpo(nome), area: limpo(a),
      x: centro(nome), y: nome.y, alturaTexto: nome.h,
      bboxTexto: [nome.x, nome.y - nome.h, nome.x + nome.w, a.y + 2],
      origem: 'rotulo+area', confianca: 'alta',
    });
  }

  /* ---------- o corpo de letra dos rótulos ---------- */
  let alturas = confirmados.map(r => r.alturaTexto).filter(Boolean).sort((a, b) => a - b);
  let corpo = alturas.length ? alturas[Math.floor(alturas.length / 2)] : 0;

  /* ---------- âncora quando a folha não cota nenhuma área ----------
     Há escritório que não cota área em planta de paginação ou de forro. Sem
     nenhuma certeza para delimitar a planta, a âncora passa a ser o próprio
     vocabulário: nomes de ambiente no corpo de letra dominante da folha. Exige
     pelo menos três, para que a legenda ou o selo — que também têm palavras —
     nunca sirvam de âncora sozinhos. */
  const temAncoraCotada = confirmados.length > 0;
  let ancoras = confirmados;
  if (!confirmados.length) {
    const comLetra = horizontais.filter(t => /[A-Za-zÀ-ÿ]{3}/.test(limpo(t)));
    const freq = new Map();
    for (const t of comLetra) { const k = t.h.toFixed(1); freq.set(k, (freq.get(k) || 0) + 1); }
    const dominante = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    corpo = dominante ? Number(dominante[0]) : 0;
    if (!corpo) return [];
    ancoras = comLetra
      .filter(t => Math.abs(t.h - corpo) <= corpo * 0.14)
      .map(t => ({ t, s: limpo(t) }))
      .filter(({ s }) => !reprovado(s) && AMBIENTE.test(s) && palavras(s) <= 4 && !CONECTIVO.test(s))
      .map(({ t, s }) => ({
        nome: s, area: '',
        x: centro(t), y: t.y, alturaTexto: t.h,
        bboxTexto: [t.x, t.y - t.h, t.x + t.w, t.y + 2],
        origem: 'rotulo', confianca: 'media',
      }));
    if (ancoras.length < 3) return [];
    for (const a of ancoras) confirmados.push(a);
  }

  /* ---------- onde estão as plantas ---------- */
  const janelas = janelasDePlanta(ancoras);
  if (!corpo || !janelas.length) return semColunasDeQuadro(dedup(confirmados));

  const naPlanta = (x, y) => janelas.some(j => x >= j[0] && x <= j[2] && y >= j[1] && y <= j[3]);

  /* ---------- camada 2 e 3: locais sem área cotada ---------- */
  const candidatos = [];
  const jaLido = new Set(confirmados.map(r => Math.round(r.x) + ':' + Math.round(r.y)));
  for (const b of blocos(horizontais.filter(t => !consumido.has(t)), corpo)) {
    if (jaLido.has(Math.round(centro(b.ancora)) + ':' + Math.round(b.ancora.y))) continue;
    const t = b.ancora;
    const s = b.frase;
    /* bloco de várias linhas é anotação: o rótulo do ambiente é de uma linha.
       Julgamos a frase inteira para poder reprová-la por inteiro. */
    if (reprovado(s)) continue;
    if (b.itens.length > 1 && !AMBIENTE.test(s)) continue;

    const corpoOk = Math.abs(t.h - corpo) <= corpo * 0.14;
    const grau = grauSemArea(s, naPlanta(centro(t), t.y), corpoOk, temAncoraCotada);
    if (!grau) continue;

    // não repetir o que a camada 1 já leu, nem outro candidato colado
    if (confirmados.some(r => Math.abs(r.x - centro(t)) < 46 && Math.abs(r.y - t.y) < 18)) continue;
    if (candidatos.some(c => Math.abs(c.x - centro(t)) < 24 && Math.abs(c.y - t.y) < 13)) continue;

    const ult = b.itens[b.itens.length - 1];
    candidatos.push({
      nome: s, area: '',
      x: centro(t), y: t.y, alturaTexto: t.h,
      bboxTexto: [Math.min(...b.itens.map(i => i.x)), t.y - t.h,
        Math.max(...b.itens.map(i => i.x + i.w)), ult.y + 2],
      origem: grau === 'media' ? 'rotulo' : 'rotulo_proposto',
      confianca: grau,
    });
  }

  return semColunasDeQuadro(dedup(confirmados.concat(candidatos)));
}

/* Mesmo nome no mesmo ponto entra uma vez. Nome repetido em pontos distintos
   é legítimo — "JARDIM" aparece duas vezes na folha porque são dois jardins, e
   quem resolve isso é o casamento por nome+pavimento no engine. */
function dedup(lista) {
  const vistos = new Set();
  return lista.filter(r => {
    const k = r.nome.toUpperCase() + '|' + Math.round(r.x / 6) + '|' + Math.round(r.y / 6);
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}

/** Agrupa os locais confirmados em colunas (uma planta por coluna). */
export function janelasDePlanta(ambientes, folga = 130) {
  if (!ambientes.length) return [];
  const ord = [...ambientes].sort((a, b) => a.x - b.x);
  const grupos = [[ord[0]]];
  for (let i = 1; i < ord.length; i++) {
    const g = grupos[grupos.length - 1];
    if (ord[i].x - g[g.length - 1].x > 320) grupos.push([ord[i]]); else g.push(ord[i]);
  }
  return grupos.map(g => {
    const xs = g.map(a => a.x), ys = g.map(a => a.y);
    return [Math.min(...xs) - folga, Math.min(...ys) - folga * 2.2,
            Math.max(...xs) + folga, Math.max(...ys) + folga * 2.2];
  });
}

/* O que é nome de pavimento ("TÉRREO", "1º SUBSOLO", "PAVIMENTO TIPO",
   "COBERTURA") e o que é nome de torre ou bloco ("TORRE 1", "BLOCO B"). */
const PAV_NOME = /^(?:(?:\d{1,2}\s*[ºo°]?\s*)?(?:SUBSOLO|T[ÉE]RREO|PAVIMENTO|PAV\.?|ANDAR|COBERTURA|[ÁA]TICO|MEZANINO|SOBRELOJA|PILOTIS|GARAGEM|TIPO)\b[A-ZÀ-Ýa-zà-ÿ0-9 .ºª]{0,24}|(?:PAVIMENTO|PAV\.?|ANDAR)\s+[A-ZÀ-Ý0-9][A-ZÀ-Ýa-zà-ÿ0-9 .ºª]{0,24})$/i;
const GRUPO_NOME = /^(?:TORRE|BLOCO|EDIF[ÍI]CIO|ED\.?|QUADRA|M[ÓO]DULO|SETOR)\s*[A-Z0-9]{1,4}$/i;

/**
 * Legendas de planta da folha: "PLANTA BAIXA - TÉRREO", "PLANTA 1º SUBSOLO",
 * "PLANTA TÉRREO - TORRE 1". Devolve o pavimento e, quando a legenda o
 * nomeia, o grupo (torre, bloco). Sem traço também vale: o carimbo escreve
 * "PLANTA 1º SUBSOLO" e isso é o pavimento.
 */
export function lerPavimentos(textos) {
  const out = [];
  for (const t of textos) {
    const s = limpo(t);
    if (s.length > 90 || (!/PLANTA/i.test(s) && !/^PAVIMENTO\b/i.test(s))) continue;
    const segmentos = s.split(/\s*[-–|]\s*/)
      .map(x => x.replace(/^(?:PLANTA(?:\s+BAIXA)?|BAIXA)\s*(?:D[OAE]S?\s+)?/i, '').trim()).filter(Boolean);
    let nome = '', grupo = '';
    for (const seg of segmentos) {
      if (!grupo && GRUPO_NOME.test(seg)) { grupo = seg; continue; }
      if (!nome && seg.length >= 3 && seg.length <= 40 && PAV_NOME.test(seg)) nome = seg;
    }
    if (!nome) {
      /* a regra antiga: o que vem depois do traço é o pavimento */
      const m = s.match(/^(.*?)[-–]\s*([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ .ºª0-9]{2,28})$/);
      if (m) nome = m[2].trim();
    }
    if (!nome || nome.length < 3) continue;
    out.push({ nome, grupo, x: centro(t), y: t.y });
  }
  return out;
}

/** Rótulos de tipologia de unidade na folha: "TIPO 1", "TIPO PNE 4", "APTO TIPO A". */
export function lerTipologias(textos) {
  const out = [];
  for (const t of textos || []) {
    if (!t || t.horizontal === false) continue;
    const nome = lerTipologia(limpo(t));
    if (!nome) continue;
    out.push({ nome, x: centro(t), y: t.y, bbox: [t.x, t.y - t.h, t.x + t.w, t.y + 2] });
  }
  return out;
}

/**
 * Dá a cada ambiente a tipologia da unidade em que ele está. A medida é a
 * mesma do vínculo das tags — distância pelo espaço livre, contornando as
 * paredes — porque a parede entre dois apartamentos é exatamente o que
 * separa "DORM.01 do TIPO 1" de "DORM.01 do TIPO 2". Ambiente com dois
 * rótulos quase à mesma distância está entre unidades (circulação, hall) e
 * fica sem tipologia; nome de área comum nunca recebe uma.
 */
export function atribuirTipologias(mask, ambientes, tipologias, janela) {
  for (const a of ambientes) a.tipologia = a.tipologia || '';
  if (!tipologias.length || !ambientes.length || !mask) return;
  const alvos = ambientes.map(a => ({ x: a.x, y: a.y }));
  const vinculos = vincularTags(mask, tipologias, alvos, janela);
  const limite = (janela[2] - janela[0]) * 0.3;
  vinculos.forEach((v, i) => {
    const a = ambientes[i];
    const vocab = classificarArea(a.nome);
    if (!v.ambiente || v.distancia === null || v.distancia > limite || vocab === 'comum') return;
    if (v.segundo && v.folga < 1.3 && vocab !== 'privativa') return;
    a.tipologia = v.ambiente.nome;
    a.tipologiaFolga = v.folga;
  });
}

/* ---------- máscara de paredes ---------- */

/**
 * Rasteriza os traçados escuros (alvenaria, esquadrias, mobiliário fixo)
 * numa máscara binária. 1 = espaço livre, 0 = obstáculo.
 */
export function criarMascara(largura, altura, escala) {
  const w = Math.max(1, Math.round(largura * escala));
  const h = Math.max(1, Math.round(altura * escala));
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  return {
    w, h, escala, ctx,
    visit(path) {
      const escuro = isDark(path.stroke) || isDark(path.fill);
      if (!escuro) return;
      ctx.lineWidth = Math.max(1, (path.lineWidth || 0.5) * escala);
      ctx.beginPath();
      for (const sp of path.subpaths) {
        ctx.moveTo(sp[0][0] * escala, sp[0][1] * escala);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0] * escala, sp[i][1] * escala);
      }
      ctx.stroke();
    },
    finalizar() {
      const d = ctx.getImageData(0, 0, w, h).data;
      const livre = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < livre.length; i++, j += 4) livre[i] = d[j] > 140 ? 1 : 0;
      return { livre, w, h, escala };
    },
  };
}

/** Distância geodésica a partir de um ponto, limitada a uma janela. */
function bfs(mask, sx, sy, janela, dist) {
  const { livre, w } = mask;
  const [jx0, jy0, jx1, jy1] = janela;
  dist.fill(65535);
  const fila = new Int32Array((jx1 - jx0 + 1) * (jy1 - jy0 + 1));
  let cab = 0, cau = 0;
  // a partir de uma semente é preciso achar espaço livre perto do rótulo
  let semente = -1;
  for (let r = 0; r <= 12 && semente < 0; r++) {
    for (let dy = -r; dy <= r && semente < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < jx0 || x > jx1 || y < jy0 || y > jy1) continue;
      if (livre[y * w + x]) { semente = y * w + x; break; }
    }
  }
  if (semente < 0) return false;
  dist[semente] = 0; fila[cau++] = semente;
  while (cab < cau) {
    const i = fila[cab++];
    const d = dist[i] + 1;
    const x = i % w, y = (i / w) | 0;
    if (x > jx0 && livre[i - 1] && dist[i - 1] > d) { dist[i - 1] = d; fila[cau++] = i - 1; }
    if (x < jx1 && livre[i + 1] && dist[i + 1] > d) { dist[i + 1] = d; fila[cau++] = i + 1; }
    if (y > jy0 && livre[i - w] && dist[i - w] > d) { dist[i - w] = d; fila[cau++] = i - w; }
    if (y < jy1 && livre[i + w] && dist[i + w] > d) { dist[i + w] = d; fila[cau++] = i + w; }
  }
  return true;
}

/**
 * Liga cada tag ao local cujo espaço interno realmente a contém.
 * Devolve, por tag, o local vencedor, o segundo colocado e a folga entre
 * os dois — é essa folga que vira o nível de confiança.
 */
export function vincularTags(mask, ambientes, tags, janela) {
  const { w, h, escala } = mask;
  const jx0 = Math.max(0, Math.floor(janela[0] * escala)), jy0 = Math.max(0, Math.floor(janela[1] * escala));
  const jx1 = Math.min(w - 1, Math.ceil(janela[2] * escala)), jy1 = Math.min(h - 1, Math.ceil(janela[3] * escala));
  const dist = new Uint16Array(w * h);
  const melhores = tags.map(() => ({ d1: Infinity, a1: null, d2: Infinity, a2: null }));

  for (const amb of ambientes) {
    const sx = Math.round(amb.x * escala), sy = Math.round((amb.y + 4) * escala);
    if (sx < jx0 || sx > jx1 || sy < jy0 || sy > jy1) continue;
    if (!bfs(mask, sx, sy, [jx0, jy0, jx1, jy1], dist)) continue;
    tags.forEach((t, i) => {
      const tx = Math.round(t.x * escala), ty = Math.round(t.y * escala);
      if (tx < jx0 || tx > jx1 || ty < jy0 || ty > jy1) return;
      let d = 65535;
      for (let r = 0; r <= 8 && d === 65535; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x < jx0 || x > jx1 || y < jy0 || y > jy1) continue;
          const v = dist[y * w + x];
          if (v < d) d = v;
        }
      }
      if (d === 65535) return;
      const m = melhores[i];
      if (d < m.d1) { m.d2 = m.d1; m.a2 = m.a1; m.d1 = d; m.a1 = amb; }
      else if (d < m.d2) { m.d2 = d; m.a2 = amb; }
    });
  }
  return melhores.map((m, i) => ({
    tag: tags[i],
    ambiente: m.a1, distancia: m.d1 === Infinity ? null : m.d1 / escala,
    segundo: m.a2, distancia2: m.d2 === Infinity ? null : m.d2 / escala,
    folga: (m.d1 === Infinity || m.d2 === Infinity) ? Infinity : m.d2 / Math.max(1, m.d1),
  }));
}
