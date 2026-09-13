/* Quadros da prancha — o leitor de tabela genérico.

   Há escritório que não usa tag geométrica nenhuma: o levantamento inteiro
   está numa tabela desenhada na própria prancha. E cada um monta a sua de um
   jeito.

     MEMORIAL DE ACABAMENTOS PISO          QUADRO DE ESQUADRIAS
     Ambiente      Código  Especificação     ID    L x A    Tipo de Abertura  Material  Q.
     ACADEMIA      1       PISO MADEIRA…   Porta
     BANHO FILHOS  1       CERÂMICA…             P01   70×210   Abrir Simples     Madeira   1
                           CR-10 MATE 5X15       P02   70×210   Abrir Simples     Madeira   1
     BANHO                                 Janela
     MASTER        1       PISO TÁBUA…           J01   30×200   1 Fixa            Madeira…  1

   São a mesma coisa: um cabeçalho, colunas, e uma coluna-chave que governa as
   linhas. O que muda é QUAL é a chave — o ambiente, num quadro de acabamentos;
   o código, num quadro de esquadrias. Então o mecanismo é um só, e a chave
   decide a interpretação:

     chave = ambiente  → cada linha é o acabamento daquele local
     chave = código    → cada linha é uma peça de catálogo, e o local (se a
                         tabela tiver a coluna) vem de lá

   A reconstrução é pelo texto e pelas coordenadas, sem depender de linha de
   grade desenhada — que é justamente o que falta nesses quadros e o que faz o
   `tables.js` não os enxergar.

     1. o CABEÇALHO é uma linha de rótulos reconhecíveis na mesma base;
     2. as COLUNAS saem do x de cada rótulo;
     3. o TÍTULO logo acima dá a categoria ("… PISO" → Piso);
     4. as LINHAS são governadas pela coluna-chave: cada valor abre uma faixa,
        e o que cai na faixa pertence àquela linha. É isso que resolve a célula
        de duas linhas e a centralizada no meio da faixa;
     5. uma coluna à esquerda da chave, com menos células que linhas, é um
        GRUPO de células mescladas ("Porta", "Janela") e vale para as linhas
        abaixo dela até o próximo valor.

   Nada é presumido: linha sem chave, ou sem nenhum conteúdo, não vira item. */

import { categoriaDe } from './legend.js';

const limpo = t => (t.str || '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/* RÓTULOS DE COLUNA                                                   */
/*                                                                     */
/* Lista editável: ensinar uma coluna nova ao sistema é acrescentar uma */
/* linha aqui. `chave: true` marca as que podem governar as linhas.     */
/* ------------------------------------------------------------------ */

export const ROTULOS_COLUNA = [
  { campo: 'local', chave: true, p: /^(?:ambientes?|locais?|local|c[oô]modos?|setor(?:es)?|depend[êe]ncia)/i },
  { campo: 'codigo', chave: true, p: /^(?:c[óo]d(?:igo)?|cod\.?|id\b|ident|ref(?:\.|er[êe]ncia)?|item|tag|n[ºo°]\.?|sigla)/i },
  { campo: 'especificacao', p: /^(?:especifica|descri|material|materiais|acabamento|produto|revestimento|composi)/i },
  { campo: 'tipo', p: /^(?:tipo|abertura|tipologia|sistema|fun[çc][ãa]o|modelo de)/i },
  { campo: 'dimensao', p: /^(?:dimens|formato|medida|tamanho|l\s*[x×]\s*a|a\s*[x×]\s*l|larg|vão|vao)/i },
  { campo: 'peitoril', p: /^(?:peitoril|peit\.?|soleira\s*\(|h\s*peit)/i },
  { campo: 'quantidade', p: /^(?:quant|qtd\.?|qte|q\.?$|un\.?$|pe[çc]as?|[áa]rea total|m[²2]$)/i },
  { campo: 'marca', p: /^(?:marca|fabricante|fornec)/i },
  { campo: 'modelo', p: /^(?:modelo|linha|cor|padr[ãa]o|refer[êe]ncia comercial)/i },
  { campo: 'observacao', p: /^(?:obs\.?|observa|nota|coment)/i },
];

const campoDe = (rotulo) => {
  const r = (rotulo || '').trim();
  if (!r) return null;
  for (const c of ROTULOS_COLUNA) if (c.p.test(r)) return c;
  return null;
};

/** Campos que fazem um cabeçalho valer a pena: sem nenhum deles não há dado. */
const CONTEUDO = new Set(['especificacao', 'tipo', 'dimensao', 'marca', 'modelo', 'quantidade', 'peitoril']);

/* ------------------------------------------------------------------ */

/**
 * Todos os quadros de uma folha.
 *
 * Devolve `[{ titulo, categoria, chave, colunas, caixa, linhas }]`, onde cada
 * linha traz só os campos que aquele quadro tinha, mais `grupo` e `caixa`.
 */
export function lerQuadros(textos) {
  const horiz = (textos || []).filter(t => t && t.horizontal !== false && limpo(t));
  const candidatos = [];

  /* ---------- 1. cabeçalhos ---------- */
  for (const t0 of horiz) {
    const c0 = campoDe(limpo(t0));
    if (!c0) continue;
    const faixa = t0.h * 0.6;
    /* mesma base, à direita, mesma altura de letra — cabeçalho é uma linha só */
    const celulas = [{ t: t0, campo: c0.campo, rotulo: limpo(t0) }];
    for (const t of horiz) {
      if (t === t0 || t.x <= t0.x) continue;
      if (Math.abs(t.y - t0.y) > faixa) continue;
      if (Math.abs(t.h - t0.h) > t0.h * 0.12) continue;
      const c = campoDe(limpo(t));
      if (!c) continue;
      celulas.push({ t, campo: c.campo, rotulo: limpo(t) });
    }
    if (celulas.length < 2) continue;
    celulas.sort((a, b) => a.t.x - b.t.x);
    if (!celulas.some(c => CONTEUDO.has(c.campo))) continue;
    if (!celulas.some(c => c.campo === 'local' || c.campo === 'codigo')) continue;
    candidatos.push({ base: t0, celulas });
  }

  /* o mesmo cabeçalho aparece uma vez por célula reconhecida: fica o que tem
     mais colunas e começa mais à esquerda */
  candidatos.sort((a, b) => (b.celulas.length - a.celulas.length) || (a.base.x - b.base.x));
  const cabecalhos = [];
  for (const c of candidatos) {
    if (cabecalhos.some(o => Math.abs(o.base.y - c.base.y) < c.base.h * 1.2
      && Math.abs(o.base.x - c.base.x) < 600)) continue;
    cabecalhos.push(c);
  }

  const quadros = [];
  for (const cab of cabecalhos) {
    const q = montarQuadro(horiz, cab, cabecalhos);
    if (q) quadros.push(q);
  }
  return quadros.sort((a, b) => a.caixa[1] - b.caixa[1]);
}

function montarQuadro(horiz, cab, todosCabecalhos) {
  const base = cab.base;
  const h = base.h;

  /* ---------- rótulo que quebra em duas linhas ---------- */
  /* "Especificação" / "Parede" é uma coluna só. A continuação tem de ter a
     MESMA altura de letra do cabeçalho — é o que impede engolir a primeira
     linha de dados, que vem num corpo menor. */
  const colunas = cab.celulas.map(c => ({ x: c.t.x, campo: c.campo, rotulo: c.rotulo }));
  /* A continuação nunca está à esquerda da primeira coluna: ali fica a coluna
     de grupo ("Porta", "Janela"), que tem a mesma altura de letra do cabeçalho
     e seria confundida com a segunda linha de um rótulo. */
  const xPrimeira = Math.min(...colunas.map(c => c.x));
  for (const col of colunas) {
    const cont = horiz.find(t => t.y > base.y + h * 0.6 && t.y <= base.y + h * 2.1
      && Math.abs(t.h - h) <= h * 0.12
      && t.x >= xPrimeira - 6
      && Math.abs(t.x - col.x) < 90 && !campoDe(limpo(t)));
    if (cont) col.rotulo += ' ' + limpo(cont);
  }

  /* ---------- título ---------- */
  const xMax = colunas[colunas.length - 1].x + 420;
  const tit = horiz
    .filter(t => t.y < base.y - h * 0.4 && base.y - t.y <= h * 3.4
      && t.x >= base.x - 60 && t.x <= xMax && t.h >= h * 0.9)
    .sort((a, b) => (base.y - a.y) - (base.y - b.y))[0] || null;
  const titulo = tit ? limpo(tit) : '';

  /* ---------- corpo ---------- */
  const chave = colunas.find(c => c.campo === 'local') || colunas.find(c => c.campo === 'codigo');
  if (!chave) return null;
  const iChave = colunas.indexOf(chave);

  /* onde o quadro acaba: o próximo cabeçalho abaixo, dentro da mesma faixa de x */
  const seguinte = todosCabecalhos
    .filter(o => o !== cab && o.base.y > base.y + h * 2 && Math.abs(o.base.x - base.x) < 600)
    .sort((a, b) => a.base.y - b.base.y)[0];
  const yFim = seguinte ? seguinte.base.y - seguinte.base.h * 2 : Infinity;

  const x0 = Math.min(base.x, ...colunas.map(c => c.x)) - 120;   // folga para a coluna de grupo
  const x1 = xMax;
  const corpo = horiz.filter(t => t.y > base.y + h * 1.1 && t.y < yFim
    && t.x >= x0 && t.x <= x1 && !campoDe(limpo(t)));
  /* só o que está a partir da primeira coluna: a coluna de grupo fica fora do
     cálculo das fronteiras, senão desloca a âncora da coluna-chave */
  const xMinCol = Math.min(...colunas.map(c => c.x));
  const corpoBruto = corpo.filter(t => t.x >= xMinCol - 14);

  /* ---------- as fronteiras das colunas saem dos DADOS ----------
     O x do cabeçalho é só a semente. Escritório nenhum alinha o rótulo com a
     célula: nesta prancha o rótulo "Especificação Piso" está em x3203 e o texto
     da especificação começa em x3174 — à esquerda do próprio cabeçalho.
     Atribuir "à primeira coluna à esquerda do texto" jogaria a especificação na
     coluna de código, e a linha sairia sem conteúdo nenhum. Por isso cada texto
     vai para a coluna MAIS PRÓXIMA, e a âncora de cada coluna é então
     recalculada pela borda esquerda típica das suas próprias células. */
  const maisProxima = (x, ancoras) => {
    let k = 0, d = Infinity;
    for (let j = 0; j < ancoras.length; j++) {
      const dj = Math.abs(x - ancoras[j]);
      if (dj < d) { d = dj; k = j; }
    }
    return k;
  };
  let ancoras = colunas.map(c => c.x);
  for (let volta = 0; volta < 2; volta++) {
    const porCol = colunas.map(() => []);
    for (const t of corpoBruto) porCol[maisProxima(t.x, ancoras)].push(t.x);
    ancoras = ancoras.map((a, j) => {
      if (porCol[j].length < 2) return a;
      const o = porCol[j].sort((x, y) => x - y);
      return o[Math.floor(o.length * 0.25)];
    });
  }
  colunas.forEach((c, j) => { c.xDados = ancoras[j]; });

  let cabecas = corpoBruto.filter(t => maisProxima(t.x, ancoras) === iChave).sort((a, b) => a.y - b.y);
  if (cabecas.length < 2) return null;

  /* passo típico entre linhas, e corte num salto grande (fim da tabela) */
  const passos = [];
  for (let i = 1; i < cabecas.length; i++) passos.push(cabecas[i].y - cabecas[i - 1].y);
  const ord = [...passos].sort((a, b) => a - b);
  const passo = ord[Math.floor(ord.length / 2)] || h * 2;
  const corte = cabecas.findIndex((c, i) => i > 0 && c.y - cabecas[i - 1].y > passo * 4);
  if (corte > 1) cabecas = cabecas.slice(0, corte);

  /* ---------- célula de chave que quebra em duas linhas ----------
     "BANHO" / "MASTER" é um nome só; "P01" / "P02" são duas linhas. A distância
     não distingue os dois casos: nesta prancha o nome quebrado tem 9 pt de
     intervalo e as linhas apertadas do quadro de esquadrias também.
     O que distingue é o CONTEÚDO. Um nome quebrado tem conteúdo em apenas uma
     das duas linhas — o código e a especificação ficam no meio da faixa. Duas
     linhas de verdade têm conteúdo cada uma. Então só se juntam duas células de
     chave vizinhas quando pelo menos uma delas não tem conteúdo próprio. */
  const alturas = cabecas.map(c => c.h).sort((a, b) => a - b);
  const hCorpo = alturas[Math.floor(alturas.length / 2)] || h;
  /* Quem define as linhas é o CONTEÚDO, não a chave.
     Tentar agrupar pela coluna-chave leva a um limiar impossível: "BANHO" /
     "MASTER" é um nome quebrado com 9 pt de intervalo, e no quadro de
     esquadrias 9 pt é o intervalo entre duas linhas de verdade. Nenhum corte
     fixo acerta os dois.
     A coluna de conteúdo não tem esse problema: ali cada linha tem uma célula,
     e quando ela quebra, a continuação fica MUITO mais perto do que o passo
     entre linhas. Então as faixas saem do conteúdo, e cada célula de chave se
     pendura na faixa de que está mais perto — dois pedaços de um nome quebrado
     caem na mesma faixa e se juntam sozinhos. */
  const conteudo = corpoBruto.filter(t => {
    const campo = colunas[maisProxima(t.x, ancoras)].campo;
    return campo !== chave.campo && CONTEUDO.has(campo);
  }).sort((a, b) => a.y - b.y);
  if (conteudo.length < 2) return null;

  const gapsC = [];
  for (let i = 1; i < conteudo.length; i++) {
    const g = conteudo[i].y - conteudo[i - 1].y;
    if (g > 0.5) gapsC.push(g);
  }
  const ordC = [...gapsC].sort((a, b) => a - b);
  const passoC = ordC[Math.floor(ordC.length / 2)] || hCorpo * 2;
  /* continuação de célula fica claramente abaixo do passo entre linhas */
  const limiarQuebra = Math.max(hCorpo * 1.05, passoC * 0.62);

  const faixas = [];
  for (const t of conteudo) {
    const ult = faixas[faixas.length - 1];
    if (ult && t.y - ult[ult.length - 1].y < limiarQuebra) ult.push(t);
    else faixas.push([t]);
  }
  if (faixas.length < 2) return null;
  const centros = faixas.map(f => f.reduce((s, t) => s + t.y, 0) / f.length);

  /* a borda entre duas linhas é o meio do caminho entre os centros das faixas —
     é isso que faz "BANHO" e "MASTER" caírem na mesma linha, e cada P01/P02 na
     sua, sem limiar nenhum */
  const bordas = centros.map((c, i) => ({
    de: i === 0 ? c - passoC : (centros[i - 1] + c) / 2,
    ate: i + 1 < centros.length ? (c + centros[i + 1]) / 2 : c + passoC,
  }));
  if (bordas.length < 2) return null;

  /* ---------- coluna de grupo (células mescladas à esquerda) ---------- */
  const aEsquerda = corpo.filter(t => t.x < xMinCol - 14).sort((a, b) => a.y - b.y);
  const temGrupo = aEsquerda.length && aEsquerda.length < centros.length * 0.7;

  /* ---------- as linhas ---------- */
  const linhas = [];
  for (let i = 0; i < bordas.length; i++) {
    const { de, ate } = bordas[i];
    const dentro = corpoBruto.filter(t => t.y >= de && t.y < ate);
    if (!dentro.length) continue;

    const linha = {};
    const usadas = [];
    for (const t of dentro.sort((a, b) => (a.y - b.y) || (a.x - b.x))) {
      const campo = colunas[maisProxima(t.x, ancoras)].campo;
      const antes = linha[campo];
      /* "ESCRITÓRIO/" + "HÓSP." é "ESCRITÓRIO/HÓSP.", sem espaço — a barra e o
         hífen no fim da linha indicam palavra partida, não duas palavras. */
      const cola = antes && /[/\-–]$/.test(antes) ? '' : ' ';
      linha[campo] = antes ? antes + cola + limpo(t) : limpo(t);
      usadas.push(t);
    }
    if (!linha[chave.campo]) continue;
    if (!Object.keys(linha).some(k => CONTEUDO.has(k))) continue;   // linha sem conteúdo

    if (temGrupo) {
      const acima = aEsquerda.filter(t => t.y <= centros[i] + hCorpo * 0.8);
      if (acima.length) linha.grupo = limpo(acima[acima.length - 1]);
    }
    linha.caixa = [
      Math.min(...usadas.map(t => t.x)), Math.min(...usadas.map(t => t.y - t.h)),
      Math.max(...usadas.map(t => t.x + t.w)), Math.max(...usadas.map(t => t.y + 2)),
    ];
    linhas.push(linha);
  }
  if (linhas.length < 2) return null;

  const cx = linhas.map(l => l.caixa);
  return {
    titulo,
    categoria: categoriaDe(titulo) || categoriaDe(colunas.map(c => c.rotulo).join(' ')) || '',
    chave: chave.campo,
    colunas: colunas.map(c => ({ rotulo: c.rotulo, campo: c.campo, x: Math.round(c.xDados ?? c.x) })),
    caixa: [
      Math.min(tit ? tit.x : base.x, ...cx.map(c => c[0])) - 4,
      (tit ? tit.y - tit.h : base.y - h) - 4,
      Math.max(...cx.map(c => c[2])) + 4,
      Math.max(...cx.map(c => c[3])) + 4,
    ],
    linhas,
  };
}

/** As caixas dos quadros lidos — para o resto do sistema saber que aquela
    região da folha é tabela, e não desenho. */
export const caixasDeQuadros = quadros => quadros.map(q => q.caixa).filter(Boolean);
