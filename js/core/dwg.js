/* Leitura de DWG no navegador — o desenho vira uma "página" igual à do PDF.

   O motor vetorial, o visor e os recortes para a IA só conhecem uma coisa:
   a página do pdf.js — traçados em espaço de prancha (pontos, origem no canto
   superior esquerdo), itens de texto com posição e altura, `getViewport` e
   `render` num canvas. Este módulo abre o DWG com o libredwg compilado para
   WebAssembly (vendor/libredwg, GPL — carregado só quando chega um .dwg) e
   monta um documento com essa mesma interface. Nada muda no motor: a mesma
   leitura de tags, legendas, tabelas, ambientes e paredes roda em cima do
   DWG, e a IA recebe os recortes desenhados a partir dele.

   O que vira página, nesta ordem de preferência:
     1. cada LAYOUT (folha de paper space) com carimbo e moldura próprios: o
        conteúdo do layout mais, por VIEWPORT, o pedaço do model space que ela
        mostra, na escala da viewport — a prancha como seria plotada;
     2. sem layouts úteis, as JANELAS DE PLOTAGEM do model space: o
        projetista que desenha as pranchas lado a lado no model space marca
        cada uma com um retângulo numa camada que não plota (Defpoints) —
        cada retângulo grande dessas camadas vira uma página;
     3. sem janelas, o model space partido pelos VAZIOS: os textos do desenho
        formam ilhas separadas por espaço em branco, e cada ilha é uma página;
     4. um desenho só, sem vazios, vira uma página.
   Nos casos 2 a 4 a escala vem do próprio desenho: a altura mediana dos
   rótulos (sem contar o texto das cotas) é levada a ~7 pt, o tamanho de um
   texto plotado, para os limiares do motor (tag de 5 a 40 pt, texto,
   distâncias) valerem como no PDF.

   A leitura pesada (o WebAssembly e a conversão de 200 mil entidades) roda
   num Web Worker, para a tela não travar; as páginas voltam empacotadas em
   arrays tipados. Em Node (testes) tudo roda em linha.

   Cores: a prancha impressa é preta com as tags em vermelho; no DWG cada
   camada tem sua cor de tela (amarelo, ciano, branco). Para o motor, toda
   cor que não é vermelha vira preto — o mesmo que uma plotagem monocromática
   faz — e o vermelho continua vermelho.

   O que fica de fora: DXF (o build padrão do libredwg-web não o lê),
   imagens raster embutidas, tabelas ACAD_TABLE e multileaders (só a
   geometria simples). Texto em MTEXT tem os códigos de formatação
   removidos; atributos de bloco entram como texto; cotas entram desenhadas
   e marcadas (`cota: true`) para o motor poder ignorá-las como rótulo. */

const MARGEM = 40;                 // pt em volta do desenho
const ALTURA_TEXTO_ALVO = 7;       // pt: altura típica de texto numa prancha plotada
const PT_POR_MM = 72 / 25.4;
const MAIOR_LADO_MAX = 24000, MAIOR_LADO_MIN = 400;
const PROFUNDIDADE_MAX = 8;
const MENOR_TRACO_PT = 0.6;        // abaixo disso não se vê nem se lê: fora
const MENOR_BLOCO_PT = 3;          // bloco de mobiliário miúdo (cabide, tomada): fora

/* ------------------------------------------------------------------ */
/* a biblioteca, carregada sob demanda                                  */
/* ------------------------------------------------------------------ */

let libPromessa = null;
export function biblioteca() {
  if (!libPromessa) {
    libPromessa = import('../../vendor/libredwg/dist/libredwg-web.js')
      .then(async m => ({ m, lib: await m.LibreDwg.create() }))
      .catch(err => { libPromessa = null; throw new Error('o leitor de DWG não carregou: ' + err.message); });
  }
  return libPromessa;
}

/** "AC10xx" nos seis primeiros bytes: é DWG. */
export const ehDwg = (bytes) => !!bytes && bytes.length > 6 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31;

/** Lê os bytes com o libredwg e devolve o banco (objetos JS). */
export async function lerBanco(bytes, aoProgredir = () => {}) {
  aoProgredir('carregando o leitor de DWG');
  const { m, lib } = await biblioteca();
  aoProgredir('lendo o DWG (pode levar um minuto num arquivo grande)');
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dwg = lib.dwg_read_data(dados, m.Dwg_File_Type.DWG);
  if (!dwg) throw new Error('o DWG não pôde ser lido (versão não suportada ou arquivo corrompido)');
  try { return lib.convert(dwg); }
  finally { try { lib.dwg_free(dwg); } catch { /* já liberado */ } }
}

/**
 * Abre um DWG e devolve o documento no formato de página do pdf.js.
 * No navegador a leitura roda num Worker; `aoProgredir(texto)` recebe as
 * etapas.
 */
export async function abrirDwg(bytes, { aoProgredir = () => {} } = {}) {
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    try { return await abrirNoWorker(bytes, aoProgredir); }
    catch (err) {
      /* o worker pode não subir (sandbox, CSP): a leitura em linha é o mesmo
         código, só trava a tela enquanto lê */
      console.warn('[dwg] worker falhou, lendo em linha:', err.message);
    }
  }
  const db = await lerBanco(bytes, aoProgredir);
  aoProgredir('montando as folhas');
  return montarDocumento(db);
}

function abrirNoWorker(bytes, aoProgredir) {
  return new Promise((ok, erro) => {
    const w = new Worker(new URL('./dwg.worker.js', import.meta.url), { type: 'module' });
    const fim = () => { try { w.terminate(); } catch { /* ok */ } };
    w.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.progresso) { aoProgredir(d.progresso); return; }
      if (d.erro) { fim(); erro(new Error(d.erro)); return; }
      if (d.pacote) { fim(); ok(desempacotar(d.pacote)); }
    };
    w.onerror = (e) => { fim(); erro(new Error(e.message || 'falha no worker de DWG')); };
    const copia = new Uint8Array(bytes);   // o buffer é transferido: o chamador fica com o dele
    w.postMessage({ bytes: copia.buffer }, [copia.buffer]);
  });
}

/* ------------------------------------------------------------------ */
/* cores                                                               */
/* ------------------------------------------------------------------ */

function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map(v => Math.round(v * 255));
}
/** Índice de cor do AutoCAD (ACI) → [r, g, b]. */
export function corAci(i) {
  i = Number(i) || 0;
  const base = [[0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
  if (i >= 0 && i < 10) return base[i];
  if (i >= 250 && i <= 255) return [[51, 51, 51], [91, 91, 91], [132, 132, 132], [173, 173, 173], [214, 214, 214], [255, 255, 255]][i - 250];
  if (i >= 10 && i <= 249) {
    const h = Math.floor((i - 10) / 10) * 15, j = (i - 10) % 10;
    return hsv(h, j % 2 ? 0.5 : 1, [1, 1, 0.8, 0.8, 0.6, 0.6, 0.4, 0.4, 0.3, 0.3][j]);
  }
  return [0, 0, 0];
}
/** Vermelho de verdade? (a cor da tag na plotagem) */
const ehVermelho = ([r, g, b]) => r > 140 && g < 110 && b < 110;

/* ------------------------------------------------------------------ */
/* geometria                                                           */
/* ------------------------------------------------------------------ */

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const T = (x, y) => [1, 0, 0, 1, x, y];
const R = (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const S = (x, y) => [x, 0, 0, y, 0, 0];
const escalaDe = (m) => Math.hypot(m[0], m[1]);
const ID = [1, 0, 0, 1, 0, 0];

/** Pontos de um arco (ângulos em radianos, sentido anti-horário). */
function arco(cx, cy, r, a0, a1, fechado = false) {
  let varre = a1 - a0;
  if (fechado) varre = Math.PI * 2;
  else { while (varre <= 1e-9) varre += Math.PI * 2; while (varre > Math.PI * 2 + 1e-9) varre -= Math.PI * 2; }
  const n = Math.max(4, Math.min(32, Math.ceil(varre / (Math.PI / 8))));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + varre * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
/** Segmento com "bulge" (arco entre dois vértices de polilinha). */
function bulge(p, q, b) {
  if (!b) return [q];
  const th = 4 * Math.atan(b);
  const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy);
  if (d < 1e-9) return [q];
  const r = d / (2 * Math.sin(Math.abs(th) / 2));
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const h = Math.sqrt(Math.max(0, r * r - d * d / 4)) * Math.sign(b);
  const cx = mx - h * dy / d, cy = my + h * dx / d;
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const n = Math.max(2, Math.min(16, Math.ceil(Math.abs(th) / (Math.PI / 8))));
  const out = [];
  for (let i = 1; i <= n; i++) { const a = a0 + th * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

/* ------------------------------------------------------------------ */
/* texto                                                               */
/* ------------------------------------------------------------------ */

/** Tira os códigos de formatação do MTEXT e devolve as linhas. */
export function linhasDeMtext(s) {
  let t = String(s || '');
  t = t.replace(/\\S([^;^]*)\^([^;]*);/g, '$1/$2');            // fração empilhada
  t = t.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/\\[fFHWQTACcpX][^;]*;/g, '');                 // fonte, altura, largura, cor, alinhamento, parágrafo…
  t = t.replace(/\\[LlOoKk]/g, '');                            // sublinhado, tachado (sem ponto e vírgula)
  t = t.replace(/\\~/g, ' ').replace(/[{}]/g, '');
  t = t.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '');
  return t.split(/\\P|\\n|\r?\n/).map(l => l.trim()).filter(Boolean);
}
const limparTexto = s => String(s || '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '').trim();

/* ------------------------------------------------------------------ */
/* coleta das entidades, em unidades do desenho                         */
/* ------------------------------------------------------------------ */

function contexto(db) {
  const blocos = new Map(), blocosPorHandle = new Map();
  for (const b of ((db.tables || {}).BLOCK_RECORD || {}).entries || []) { blocos.set(b.name, b); blocosPorHandle.set(String(b.handle), b); }
  const camadas = new Map();
  for (const l of ((db.tables || {}).LAYER || {}).entries || []) camadas.set(l.name, l);
  const estilos = new Map();
  for (const s of ((db.tables || {}).STYLE || {}).entries || []) estilos.set(s.name, s);
  return { blocos, blocosPorHandle, camadas, estilos, extensao: new Map(), limiteBloco: 0 };
}

const naoPlota = (ctx, nome) => {
  const l = ctx.camadas.get(nome);
  return !!(l && l.plotFlag === 0) || /^defpoints$/i.test(nome || '');
};
const ocultaCamada = (ctx, nome) => {
  const l = ctx.camadas.get(nome);
  return !!(l && (l.off || l.frozen)) || naoPlota(ctx, nome);
};

function corDe(ctx, e, corPai) {
  const ci = Number(e.colorIndex);
  if (ci === 256 || Number.isNaN(ci)) { const l = ctx.camadas.get(e.layer); return l ? corAci(l.colorIndex) : [0, 0, 0]; }
  if (ci === 0) return corPai || [0, 0, 0];
  return corAci(ci);
}

/** Maior lado da geometria de um bloco (unidades do bloco), com cache. */
function extensaoDoBloco(ctx, nome, prof = 0) {
  if (ctx.extensao.has(nome)) return ctx.extensao.get(nome);
  ctx.extensao.set(nome, Infinity);   // contra recursão
  const b = ctx.blocos.get(nome);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } };
  for (const e of (b && b.entities) || []) {
    const ps = pontosDe(e);
    for (const p of ps) v(p[0], p[1]);
    if (e.type === 'INSERT' && prof < 4) {
      const ext = extensaoDoBloco(ctx, e.name, prof + 1);
      const s = Math.max(Math.abs(e.xScale || 1), Math.abs(e.yScale || 1));
      if (Number.isFinite(ext) && e.insertionPoint) { v(e.insertionPoint.x - ext * s, e.insertionPoint.y - ext * s); v(e.insertionPoint.x + ext * s, e.insertionPoint.y + ext * s); }
    }
  }
  const ext = Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 0;
  ctx.extensao.set(nome, ext);
  return ext;
}
/** Alguns pontos representativos de uma entidade (para caixas). */
function pontosDe(e) {
  switch (e.type) {
    case 'LINE': return [[e.startPoint.x, e.startPoint.y], [e.endPoint.x, e.endPoint.y]];
    case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': case 'POLYLINE': return (e.vertices || []).map(v => [v.x, v.y]);
    case 'CIRCLE': case 'ARC': return [[e.center.x - e.radius, e.center.y - e.radius], [e.center.x + e.radius, e.center.y + e.radius]];
    case 'TEXT': return e.startPoint ? [[e.startPoint.x, e.startPoint.y]] : [];
    case 'MTEXT': return e.insertionPoint ? [[e.insertionPoint.x, e.insertionPoint.y]] : [];
    case 'SOLID': case '3DFACE': return [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(p => [p.x, p.y]);
    case 'ELLIPSE': { const a = e.majorAxisEndPoint || { x: 0, y: 0 }; const r = Math.hypot(a.x, a.y); return [[e.center.x - r, e.center.y - r], [e.center.x + r, e.center.y + r]]; }
    default: return [];
  }
}

/**
 * Percorre as entidades (recursivo nos INSERTs) e empurra em `saida`:
 *   paths: { pts: [[x,y]…], curva, fechado, cor, preenche, solido, lw }
 *   textos: { str, x, y, h, w, ang, cota }   (x,y = início da linha de base)
 * `ctx.limiteBloco` (unidades do desenho) descarta blocos menores que isso.
 */
function coletar(ctx, entidades, m, corPai, saida, prof = 0) {
  if (prof > PROFUNDIDADE_MAX) return;
  const push = (pts, o = {}) => { if (pts.length >= 2) saida.paths.push({ pts: pts.map(p => ap(m, p[0], p[1])), curva: false, fechado: false, cor: o.cor, preenche: false, lw: 0.5, ...o }); };
  for (const e of entidades || []) {
    if (!e || e.isVisible === false) continue;
    if (e.layer && ocultaCamada(ctx, e.layer)) continue;
    const cor = corDe(ctx, e, corPai);
    switch (e.type) {
      case 'LINE': push([[e.startPoint.x, e.startPoint.y], [e.endPoint.x, e.endPoint.y]], { cor }); break;
      case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': case 'POLYLINE': {
        const vs = (e.vertices || []).filter(v => v && Number.isFinite(v.x));
        if (vs.length < 2) break;
        const fechado = !!(e.flag & 1);
        const pts = [[vs[0].x, vs[0].y]];
        let curva = false;
        for (let i = 1; i < vs.length; i++) { const b = vs[i - 1].bulge || 0; if (b) curva = true; pts.push(...bulge(pts[pts.length - 1], [vs[i].x, vs[i].y], b)); }
        if (fechado) { const b = vs[vs.length - 1].bulge || 0; if (b) curva = true; pts.push(...bulge(pts[pts.length - 1], [vs[0].x, vs[0].y], b)); }
        push(pts, { cor, curva, fechado });
        break;
      }
      case 'CIRCLE': push(arco(e.center.x, e.center.y, e.radius, 0, 0, true), { cor, curva: true, fechado: true }); break;
      case 'ARC': push(arco(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle), { cor, curva: true }); break;
      case 'ELLIPSE': {
        const a = e.majorAxisEndPoint || { x: 1, y: 0 }, r = e.axisRatio || 1;
        const bx = -a.y * r, by = a.x * r;
        const a0 = e.startAngle || 0, a1 = e.endAngle ?? Math.PI * 2;
        const cheio = Math.abs((a1 - a0) - Math.PI * 2) < 1e-6 || a1 === a0;
        let varre = cheio ? Math.PI * 2 : a1 - a0; while (varre <= 1e-9) varre += Math.PI * 2;
        const n = Math.max(8, Math.min(32, Math.ceil(varre / (Math.PI / 8))));
        const pts = [];
        for (let i = 0; i <= n; i++) { const t = a0 + varre * i / n; pts.push([e.center.x + a.x * Math.cos(t) + bx * Math.sin(t), e.center.y + a.y * Math.cos(t) + by * Math.sin(t)]); }
        push(pts, { cor, curva: true, fechado: cheio });
        break;
      }
      case 'SPLINE': {
        const ps = (e.fitPoints && e.fitPoints.length ? e.fitPoints : e.controlPoints) || [];
        push(ps.map(p => [p.x, p.y]), { cor, curva: true });
        break;
      }
      case 'SOLID': case '3DFACE': case 'TRACE': {
        const c = [e.corner1, e.corner2, e.corner4 || e.corner3, e.corner3].filter(Boolean).map(p => [p.x, p.y]);
        if (c.length >= 3) push([...c, c[0]], { cor, fechado: true, preenche: true, solido: true });
        break;
      }
      case 'HATCH': {
        for (const bp of e.boundaryPaths || []) {
          const pts = [];
          if (bp.vertices && bp.vertices.length) {
            pts.push([bp.vertices[0].x, bp.vertices[0].y]);
            for (let i = 1; i < bp.vertices.length; i++) pts.push(...bulge(pts[pts.length - 1], [bp.vertices[i].x, bp.vertices[i].y], bp.vertices[i - 1].bulge || 0));
          } else {
            for (const ed of bp.edges || []) {
              if (!ed) continue;
              if (ed.type === 1 && ed.start && ed.end) { if (!pts.length) pts.push([ed.start.x, ed.start.y]); pts.push([ed.end.x, ed.end.y]); }
              else if (ed.type === 2 && ed.center) { const a = arco(ed.center.x, ed.center.y, ed.radius, ed.startAngle || 0, ed.endAngle ?? Math.PI * 2, false); pts.push(...(pts.length ? a.slice(1) : a)); }
            }
          }
          if (pts.length >= 3) push([...pts, pts[0]], { cor, fechado: true, preenche: true, solido: !!e.solidFill });
        }
        break;
      }
      case 'TEXT': texto(ctx, e, m, saida); break;
      case 'ATTRIB': if (e.text && !saida.vistos.has(e.handle)) { saida.vistos.add(e.handle); texto(ctx, e.text, m, saida); } break;
      case 'MTEXT': mtext(ctx, e, m, saida); break;
      case 'INSERT': {
        const b = ctx.blocos.get(e.name);
        if (b && b.entities) {
          const sEsc = Math.max(Math.abs(e.xScale || 1), Math.abs(e.yScale || 1)) * escalaDe(m);
          /* bloco miúdo (cabide, tomada, ponto de luz): não se lê, não se vê */
          if (ctx.limiteBloco && extensaoDoBloco(ctx, e.name) * sEsc < ctx.limiteBloco) {
            for (const a of e.attribs || []) if (a && a.text && !saida.vistos.has(a.handle)) { saida.vistos.add(a.handle); texto(ctx, a.text, m, saida); }
            break;
          }
          const ins = e.insertionPoint || { x: 0, y: 0 }, base = b.basePoint || { x: 0, y: 0 };
          const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const local = mul(mul(mul(T(-base.x, -base.y), S(e.xScale || 1, e.yScale || 1)), T(i * (e.columnSpacing || 0), j * (e.rowSpacing || 0))), mul(R(e.rotation || 0), T(ins.x, ins.y)));
            coletar(ctx, b.entities, mul(local, m), cor, saida, prof + 1);
          }
        }
        for (const a of e.attribs || []) if (a && a.text && !saida.vistos.has(a.handle)) { saida.vistos.add(a.handle); texto(ctx, a.text, m, saida); }
        break;
      }
      case 'DIMENSION': {
        /* a cota entra desenhada (linhas, setas, número), mas o texto dela
           não vale como rótulo: a altura segue o DIMSCALE, não o padrão dos
           rótulos, e "2.50" nunca é ambiente */
        const b = e.name ? ctx.blocos.get(e.name) : null;
        if (b && b.entities) {
          const antes = saida.textos.length;
          coletar(ctx, b.entities, m, cor, saida, prof + 1);
          for (let i = antes; i < saida.textos.length; i++) saida.textos[i].cota = true;
        }
        break;
      }
      default: break;   // VIEWPORT, POINT, XLINE, RAY, WIPEOUT, IMAGE, 3DSOLID, LEADER, TABLE…
    }
  }
}

function larguraDe(ctx, str, h, estilo, xScale) {
  const s = ctx.estilos.get(estilo);
  const wf = (s && s.widthFactor) || 1;
  return str.length * h * 0.72 * wf * (xScale || 1);
}

function texto(ctx, t, m, saida) {
  const str = limparTexto(t.text);
  if (!str) return;
  const h = t.textHeight || 2.5;
  const w = larguraDe(ctx, str, h, t.styleName, t.xScale);
  const ha = t.halign || 0, va = t.valign || 0;
  const usaFim = (ha === 1 || ha === 2 || ha === 4 || va !== 0) && t.endPoint && (t.endPoint.x || t.endPoint.y);
  const anc = usaFim ? t.endPoint : t.startPoint;
  if (!anc) return;
  const dx = (ha === 1 || ha === 4) ? -w / 2 : ha === 2 ? -w : 0;
  const dy = va === 2 ? -h / 2 : va === 3 ? -h : 0;
  const ang = t.rotation || 0;
  const c = Math.cos(ang), s = Math.sin(ang);
  const x = anc.x + dx * c - dy * s, y = anc.y + dx * s + dy * c;
  const p = ap(m, x, y);
  saida.textos.push({ str, x: p[0], y: p[1], h: h * escalaDe(m), w: w * escalaDe(m), ang: ang + Math.atan2(m[1], m[0]) });
}

function mtext(ctx, e, m, saida) {
  const linhas = linhasDeMtext(e.text);
  if (!linhas.length) return;
  const h = e.textHeight || 2.5;
  const lh = h * 1.67 * (e.lineSpacing || 1);
  const ang = e.rotation || (e.direction ? Math.atan2(e.direction.y, e.direction.x) : 0);
  const c = Math.cos(ang), s = Math.sin(ang);
  const ap9 = e.attachmentPoint || 1;
  const linhaV = Math.floor((ap9 - 1) / 3), linhaH = (ap9 - 1) % 3;   // 0 topo/esq, 1 meio, 2 base/dir
  const larg = linhas.map(l => larguraDe(ctx, l, h, e.styleName, 1));
  const total = linhas.length * lh;
  const ins = e.insertionPoint || { x: 0, y: 0 };
  linhas.forEach((str, i) => {
    const dx = linhaH === 1 ? -larg[i] / 2 : linhaH === 2 ? -larg[i] : 0;
    const dy = (linhaV === 0 ? -h : linhaV === 1 ? total / 2 - h : total - h) - i * lh;
    const x = ins.x + dx * c - dy * s, y = ins.y + dx * s + dy * c;
    const p = ap(m, x, y);
    saida.textos.push({ str, x: p[0], y: p[1], h: h * escalaDe(m), w: larg[i] * escalaDe(m), ang: ang + Math.atan2(m[1], m[0]) });
  });
}

/* ------------------------------------------------------------------ */
/* páginas                                                             */
/* ------------------------------------------------------------------ */

const novaSaida = () => ({ paths: [], textos: [], vistos: new Set() });
const mediana = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function caixaDe(saida) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of saida.paths) for (const q of p.pts) v(q[0], q[1]);
  for (const t of saida.textos) { v(t.x, t.y); v(t.x + t.w * Math.cos(t.ang), t.y + t.w * Math.sin(t.ang)); }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/** Os rótulos (texto que não é cota) — a base de toda calibração. */
const rotulosDe = saida => { const r = saida.textos.filter(t => !t.cota && t.h > 0); return r.length >= 3 ? r : saida.textos.filter(t => t.h > 0); };

/**
 * A caixa do DESENHO, não de tudo o que há no arquivo: um traço perdido a
 * quilômetros da planta (é comum) faria a folha ter metros de vazio e o
 * texto virar pó. O miolo é a mediana dos textos com um raio pelo desvio
 * absoluto mediano; o que fica fora é descartado.
 */
function caixaDoDesenho(saida) {
  const tudo = caixaDe(saida);
  if (!tudo || saida.textos.length < 3) return tudo;
  const base = rotulosDe(saida);
  const xs = base.map(t => t.x), ys = base.map(t => t.y);
  const mx = mediana(xs), my = mediana(ys);
  const madX = mediana(xs.map(x => Math.abs(x - mx))), madY = mediana(ys.map(y => Math.abs(y - my)));
  const hMed = mediana(base.map(t => t.h));
  const raio = Math.max(madX, madY) * 4 + hMed * 60;
  const lim = [mx - raio, my - raio, mx + raio, my + raio];
  const dentro = (px, py) => px >= lim[0] && px <= lim[2] && py >= lim[1] && py <= lim[3];
  const antesP = saida.paths.length, antesT = saida.textos.length;
  saida.paths = saida.paths.filter(p => p.pts.some(q => dentro(q[0], q[1])));
  saida.textos = saida.textos.filter(t => dentro(t.x, t.y) && t.h < Math.max(madY * 2, hMed * 40));
  const fora = (antesP - saida.paths.length) + (antesT - saida.textos.length);
  if (fora) console.info(`[dwg] ${fora} elemento(s) longe do desenho descartado(s)`);
  const cx = caixaDe(saida);
  return cx ? [Math.max(cx[0], lim[0]), Math.max(cx[1], lim[1]), Math.min(cx[2], lim[2]), Math.min(cx[3], lim[3])] : tudo;
}

/**
 * Janelas de plotagem: retângulos grandes em camadas que não plotam
 * (Defpoints). É como o projetista marca as pranchas desenhadas lado a lado
 * no model space. `hMed` (altura mediana dos rótulos) dá a escala mínima.
 */
function janelasDePlotagem(ctx, entidades, hMed) {
  const minimo = Math.max(hMed * 60, 1);
  const janelas = [];
  for (const e of entidades || []) {
    if ((e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE2D') || !e.layer || !naoPlota(ctx, e.layer)) continue;
    const vs = (e.vertices || []).filter(v => v && Number.isFinite(v.x));
    if (vs.length < 4 || vs.length > 5) continue;
    const xs = vs.map(v => v.x), ys = vs.map(v => v.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 - x0 < minimo || y1 - y0 < minimo) continue;
    /* retângulo de verdade: todo vértice num canto */
    if (!vs.every(v => (Math.abs(v.x - x0) < 1e-6 || Math.abs(v.x - x1) < 1e-6) && (Math.abs(v.y - y0) < 1e-6 || Math.abs(v.y - y1) < 1e-6))) continue;
    janelas.push([x0, y0, x1, y1]);
  }
  /* janela dentro de janela (a margem interna da folha): fica a maior */
  const contem = (a, b) => a[0] <= b[0] + 1 && a[1] <= b[1] + 1 && a[2] >= b[2] - 1 && a[3] >= b[3] - 1;
  return janelas.filter(j => !janelas.some(o => o !== j && contem(o, j) && (o[2] - o[0]) * (o[3] - o[1]) > (j[2] - j[0]) * (j[3] - j[1])))
    .sort((a, b) => (b[3] - a[3]) || (a[0] - b[0]));   // de cima para baixo, da esquerda para a direita
}

/**
 * Ilhas de texto: uma grade grossa marcada onde há rótulo, componentes
 * conexos = pranchas separadas por vazio. Devolve caixas em unidades do
 * desenho, ou [] quando o desenho é um bloco só.
 */
function ilhasDeTexto(saida, hMed) {
  const base = rotulosDe(saida);
  if (base.length < 40) return [];
  const celula = Math.max(hMed * 25, 1);
  const cx = t => Math.floor(t.x / celula), cy = t => Math.floor(t.y / celula);
  const ocupadas = new Map();
  for (const t of base) { const k = cx(t) + ',' + cy(t); ocupadas.set(k, (ocupadas.get(k) || 0) + 1); }
  const visto = new Set(); const ilhas = [];
  for (const k of ocupadas.keys()) {
    if (visto.has(k)) continue;
    const fila = [k]; visto.add(k);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    while (fila.length) {
      const c = fila.pop(); const [i, j] = c.split(',').map(Number);
      n += ocupadas.get(c);
      x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
        const v = (i + di) + ',' + (j + dj);
        if (ocupadas.has(v) && !visto.has(v)) { visto.add(v); fila.push(v); }
      }
    }
    if (n >= 20) ilhas.push([x0 * celula, y0 * celula, (x1 + 1) * celula, (y1 + 1) * celula]);
  }
  return ilhas.length > 1 ? ilhas.sort((a, b) => (b[3] - a[3]) || (a[0] - b[0])) : [];
}

/** O recorte de uma coleta por uma janela (unidades do desenho). */
function recortar(saida, j, folga = 0) {
  const x0 = j[0] - folga, y0 = j[1] - folga, x1 = j[2] + folga, y1 = j[3] + folga;
  const s = novaSaida();
  for (const p of saida.paths) {
    let dentro = false;
    for (const q of p.pts) if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) { dentro = true; break; }
    if (dentro) s.paths.push(p);
  }
  for (const t of saida.textos) if (t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) s.textos.push(t);
  return s;
}

/** Nome de uma janela: o maior texto dentro dela ("2º PAVIMENTO"), senão a ordem. */
function nomeDaJanela(saida, ordem) {
  const cand = saida.textos.filter(t => !t.cota && /[A-Za-zÀ-ÿ]{3}/.test(t.str)).sort((a, b) => b.h - a.h)[0];
  const nome = cand ? cand.str.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return nome || `Folha ${ordem}`;
}

/**
 * Converte a coleta (unidades do desenho, y para cima) numa página em
 * espaço de prancha (pontos, y para baixo), com a escala `k` e a caixa
 * `[x0,y0,x1,y1]` do desenho.
 */
function montarPagina({ nome, numero, saida, k, caixa }) {
  const [x0, y0, x1, y1] = caixa;
  const W = (x1 - x0) * k + 2 * MARGEM, H = (y1 - y0) * k + 2 * MARGEM;
  const X = x => (x - x0) * k + MARGEM, Y = y => (y1 - y) * k + MARGEM;
  const tracados = [];
  for (const p of saida.paths) {
    const pts = p.pts.map(q => [X(q[0]), Y(q[1])]);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const q of pts) { if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0]; if (q[1] < by0) by0 = q[1]; if (q[1] > by1) by1 = q[1]; }
    if (Math.max(bx1 - bx0, by1 - by0) < MENOR_TRACO_PT) continue;
    tracados.push(tracado(pts, [bx0, by0, bx1, by1], !!p.curva, !!p.fechado, ehVermelho(p.cor || [0, 0, 0]), !!p.preenche, !!p.solido, p.lw || 0.5));
  }
  const textos = [];
  for (const t of saida.textos) {
    const h = t.h * k, w = t.w * k;
    if (h < 0.4) continue;
    textos.push(item(t.str, X(t.x), Y(t.y), w, h, t.ang, !!t.cota));
  }
  return criarPagina({ nome, numero, largura: W, altura: H, tracados, textos });
}

/* os dois "átomos" da página, no contrato que o motor lê */
function tracado(pts, bbox, curva, fechado, vermelho, preenche, solido, lw) {
  const cor = vermelho ? '#e00000' : '#000000';
  return {
    subpaths: [pts], hasCurve: curva, closed: fechado,
    stroke: cor, fill: preenche ? (solido ? cor : '#e8e8e8') : '#000000',
    paintOp: preenche ? 'fill' : 'stroke', lineWidth: lw,
    bbox, preenche,
  };
}
function item(str, x, y, w, h, ang, cota) {
  const ux = Math.cos(ang), uy = -Math.sin(ang);       // y de prancha cresce para baixo
  return {
    str, x, y, w, h, ux, uy,
    cx: x + ux * w / 2 - uy * h * 0.3,
    cy: y + uy * w / 2 + ux * h * -0.3,
    horizontal: Math.abs(ux) > 0.85,
    cota,
  };
}

function criarPagina({ nome, numero, largura, altura, tracados, textos }) {
  return {
    dwg: true, nome, pageNumber: numero, rotate: 0,
    largura, altura, tracados, textos,
    getViewport({ scale = 1 } = {}) {
      return { width: largura * scale, height: altura * scale, scale, rotation: 0, transform: [scale, 0, 0, -scale, 0, altura * scale] };
    },
    /* o mesmo contrato do pdf.js: itens em espaço de usuário (y para cima) */
    async getTextContent() {
      return {
        items: textos.map(t => ({ str: t.str, width: t.w, height: t.h, hasEOL: false, transform: [t.h * t.ux, -t.h * t.uy, t.h * t.uy, t.h * t.ux, t.x, altura - t.y] })),
        styles: {},
      };
    },
    render({ canvasContext: ctx, viewport, transform }) {
      const s = (viewport && viewport.scale) || 1;
      const t = transform || [1, 0, 0, 1, 0, 0];
      const promise = (async () => {
        const cw = ctx.canvas ? ctx.canvas.width : Infinity, ch = ctx.canvas ? ctx.canvas.height : Infinity;
        /* o que está fora do canvas não é desenhado: uma folha de 200 mil
           traçados em zoom alto pinta só o pedaço à vista */
        const vx0 = (0 - t[4]) / s - 2, vy0 = (0 - t[5]) / s - 2, vx1 = (cw - t[4]) / s + 2, vy1 = (ch - t[5]) / s + 2;
        ctx.save();
        ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
        ctx.transform(s, 0, 0, s, 0, 0);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const lwMin = 0.7 / s;
        let n = 0;
        for (const p of tracados) {
          const b = p.bbox;
          if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
          ctx.beginPath();
          for (const sp of p.subpaths) { ctx.moveTo(sp[0][0], sp[0][1]); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]); }
          if (p.preenche) { ctx.fillStyle = p.fill; ctx.fill(); }
          ctx.strokeStyle = p.stroke; ctx.lineWidth = Math.max(lwMin, p.lineWidth || 0.5);
          ctx.stroke();
          if (++n % 4000 === 0) await new Promise(r => setTimeout(r, 0));   // cede à tela
        }
        ctx.fillStyle = '#000000';
        for (const tx of textos) {
          if (tx.x > vx1 || tx.x + tx.w < vx0 - tx.w || tx.y < vy0 - tx.h || tx.y > vy1 + tx.h) continue;
          ctx.save();
          ctx.translate(tx.x, tx.y);
          ctx.rotate(Math.atan2(tx.uy, tx.ux));
          ctx.font = `${Math.max(0.5, tx.h)}px Arial, Helvetica, sans-serif`;
          ctx.fillText(tx.str, 0, 0);
          ctx.restore();
        }
        ctx.restore();
      })();
      return { promise, cancel() { /* o desenho cede à tela, mas não cancela */ } };
    },
    cleanup() {},
  };
}

function documentoDe(paginas) {
  return {
    dwg: true,
    numPages: paginas.length,
    paginas: paginas.map(p => ({ nome: p.nome, largura: Math.round(p.largura), altura: Math.round(p.altura), tracados: p.tracados.length, textos: p.textos.length })),
    async getPage(n) { const p = paginas[n - 1]; if (!p) throw new Error(`página ${n} não existe`); return p; },
    async destroy() { paginas.length = 0; },
  };
}

/**
 * Monta as páginas a partir do banco do libredwg. Puro: não toca no DOM,
 * então roda no Worker e em Node (testes). Devolve o documento.
 */
export function montarDocumento(db, aoProgredir = () => {}) {
  const ctx = contexto(db);
  const modelo = ctx.blocos.get('*Model_Space');
  const entidadesModelo = (db.entities && db.entities.length) ? db.entities : ((modelo && modelo.entities) || []);
  const paginas = [];
  const unidadePapel = Number(db.header && db.header.INSUNITS) === 1 ? 72 : PT_POR_MM;

  /* 1) layouts de paper space com conteúdo próprio */
  const layouts = ((db.objects || {}).LAYOUT || []).filter(l => l && !/^model$/i.test(l.layoutName || l.name || ''));
  layouts.sort((a, b) => (a.tabOrder || 0) - (b.tabOrder || 0));
  for (const l of layouts) {
    const bloco = ctx.blocosPorHandle.get(String(l.paperSpaceTableId)) || ctx.blocos.get(l.blockRecordName);
    const ents = (bloco && bloco.entities) || [];
    /* a viewport "geral" (id 1) é o próprio papel, não uma janela; e uma
       folha de verdade tem carimbo e moldura desenhados no paper space —
       layout só com viewports é o padrão vazio que todo DWG traz. Uma folha
       cheia de viewports miúdas (menos de 60 mm) é um resumo, não uma prancha
       que se leia. */
    const viewports = ents.filter(e => e.type === 'VIEWPORT' && Number(e.viewportId) !== 1
      && (e.viewHeight || 0) > 0 && (e.width || 0) > 0 && (e.width || 0) < 5000 && (e.height || 0) < 5000);
    const proprias = ents.filter(e => e.type !== 'VIEWPORT');
    if (!proprias.length) continue;
    /* legibilidade: na escala da viewport, que altura o rótulo típico do
       model space teria no papel? Abaixo de 1 mm é miniatura (folha-resumo
       em 1:500), não uma prancha que se leia — e o model space é que vale */
    if (viewports.length) {
      if (!ctx.hMedModelo) {
        const st = novaSaida(); coletarTextos(ctx, entidadesModelo, ID, st);
        ctx.hMedModelo = mediana(rotulosDe(st).map(t => t.h)) || 0;
      }
      const mmNoPapel = viewports.map(v => ctx.hMedModelo * (v.height / v.viewHeight));
      if (ctx.hMedModelo && mediana(mmNoPapel) < 1) { console.info(`[dwg] layout "${l.layoutName}" é miniatura (texto de ${mediana(mmNoPapel).toFixed(2)} mm): ignorado`); continue; }
    }
    const saida = novaSaida();
    coletar(ctx, proprias, ID, null, saida);
    for (const vp of viewports) {
      const vc = vp.viewportCenter || { x: 0, y: 0 }, dc = vp.displayCenter || { x: 0, y: 0 };
      const s = (vp.height || 1) / vp.viewHeight;
      const m = mul(mul(mul(T(-dc.x, -dc.y), S(s, s)), R(vp.viewTwistAngle || 0)), T(vc.x, vc.y));
      const parcial = novaSaida();
      ctx.limiteBloco = MENOR_BLOCO_PT / (unidadePapel * s);
      coletar(ctx, entidadesModelo, m, null, parcial);
      ctx.limiteBloco = 0;
      const rec = recortar(parcial, [vc.x - vp.width / 2, vc.y - vp.height / 2, vc.x + vp.width / 2, vc.y + vp.height / 2]);
      saida.paths.push(...rec.paths); saida.textos.push(...rec.textos);
      saida.paths.push({ pts: [[vc.x - vp.width / 2, vc.y - vp.height / 2], [vc.x + vp.width / 2, vc.y - vp.height / 2], [vc.x + vp.width / 2, vc.y + vp.height / 2], [vc.x - vp.width / 2, vc.y + vp.height / 2], [vc.x - vp.width / 2, vc.y - vp.height / 2]], curva: false, fechado: true, cor: [0, 0, 0], preenche: false, lw: 0.3 });
    }
    const caixaEnt = caixaDe(saida);
    if (!caixaEnt) continue;
    const lim = l.minLimit && l.maxLimit && Number.isFinite(l.minLimit.x) && (l.maxLimit.x - l.minLimit.x) > 10 && (l.maxLimit.x - l.minLimit.x) < 5000
      ? [l.minLimit.x, l.minLimit.y, l.maxLimit.x, l.maxLimit.y] : null;
    const caixa = lim && caixaEnt[0] >= lim[0] - 50 && caixaEnt[2] <= lim[2] + 50 ? lim : caixaEnt;
    paginas.push(montarPagina({ nome: l.layoutName || l.name || 'Layout', numero: paginas.length + 1, saida, k: unidadePapel, caixa }));
    aoProgredir(`folha ${paginas.length}: ${l.layoutName || 'layout'}`);
  }
  if (paginas.length) return documentoDe(paginas);

  /* 2) o model space: escala pelos rótulos, janelas de plotagem ou ilhas */
  aoProgredir('montando o model space');
  const tudo = novaSaida();
  /* primeiro só os textos, para calibrar a escala e o corte de blocos miúdos */
  const soTexto = novaSaida();
  coletarTextos(ctx, entidadesModelo, ID, soTexto);
  const hMed = mediana(rotulosDe(soTexto).map(t => t.h)) || 0;
  const k0 = hMed ? ALTURA_TEXTO_ALVO / hMed : 0;
  ctx.limiteBloco = k0 ? MENOR_BLOCO_PT / k0 : 0;
  coletar(ctx, entidadesModelo, ID, null, tudo);
  ctx.limiteBloco = 0;
  aoProgredir(`${tudo.paths.length} traçados e ${tudo.textos.length} textos lidos`);

  let janelas = hMed ? janelasDePlotagem(ctx, entidadesModelo, hMed) : [];
  let origem = 'janelas de plotagem';
  if (janelas.length < 2) { janelas = ilhasDeTexto(tudo, hMed || 1); origem = 'ilhas de texto'; }
  if (janelas.length >= 2) {
    console.info(`[dwg] ${janelas.length} página(s) pelas ${origem}`);
    janelas.forEach((j, i) => {
      const parte = recortar(tudo, j, hMed * 2);
      if (!parte.textos.length && parte.paths.length < 50) return;
      const rot = rotulosDe(parte);
      const hLocal = rot.length >= 10 ? mediana(rot.map(t => t.h)) : hMed;
      const maior = Math.max(j[2] - j[0], j[3] - j[1]) || 1;
      let k = hLocal ? ALTURA_TEXTO_ALVO / hLocal : 3370 / maior;
      k = Math.min(MAIOR_LADO_MAX / maior, Math.max(MAIOR_LADO_MIN / maior, k));
      paginas.push(montarPagina({ nome: nomeDaJanela(parte, i + 1), numero: paginas.length + 1, saida: parte, k, caixa: j }));
      aoProgredir(`folha ${paginas.length} de ${janelas.length}`);
    });
  }
  if (!paginas.length) {
    const caixa = caixaDoDesenho(tudo);
    if (!caixa) throw new Error('o DWG não tem geometria nem texto legível');
    const maior = Math.max(caixa[2] - caixa[0], caixa[3] - caixa[1]) || 1;
    const alturas = rotulosDe(tudo).map(t => t.h);
    let k = alturas.length ? ALTURA_TEXTO_ALVO / mediana(alturas) : 3370 / maior;
    k = Math.min(MAIOR_LADO_MAX / maior, Math.max(MAIOR_LADO_MIN / maior, k));
    paginas.push(montarPagina({ nome: 'Model', numero: 1, saida: tudo, k, caixa }));
  }
  return documentoDe(paginas);
}

/** Só os textos (rótulos, atributos, MTEXT), sem geometria — para calibrar. */
function coletarTextos(ctx, entidades, m, saida, prof = 0) {
  if (prof > PROFUNDIDADE_MAX) return;
  for (const e of entidades || []) {
    if (!e || e.isVisible === false || (e.layer && ocultaCamada(ctx, e.layer))) continue;
    if (e.type === 'TEXT') texto(ctx, e, m, saida);
    else if (e.type === 'MTEXT') mtext(ctx, e, m, saida);
    else if (e.type === 'ATTRIB' && e.text) texto(ctx, e.text, m, saida);
    else if (e.type === 'INSERT') {
      const b = ctx.blocos.get(e.name);
      if (b && b.entities) {
        const ins = e.insertionPoint || { x: 0, y: 0 }, base = b.basePoint || { x: 0, y: 0 };
        const local = mul(mul(T(-base.x, -base.y), S(e.xScale || 1, e.yScale || 1)), mul(R(e.rotation || 0), T(ins.x, ins.y)));
        coletarTextos(ctx, b.entities, mul(local, m), saida, prof + 1);
      }
      for (const a of e.attribs || []) if (a && a.text) texto(ctx, a.text, m, saida);
    }
    /* cotas (DIMENSION) ficam de fora de propósito: não são rótulos */
  }
}

/* ------------------------------------------------------------------ */
/* empacotar / desempacotar — a travessia do Worker                     */
/* ------------------------------------------------------------------ */

/** Páginas → arrays tipados transferíveis. */
export function empacotar(doc, paginas) {
  const out = { paginas: [] }, buffers = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = paginas[n - 1];
    let nPts = 0; for (const t of p.tracados) nPts += t.subpaths[0].length;
    const coords = new Float32Array(nPts * 2);
    const inicio = new Uint32Array(p.tracados.length + 1);
    const flags = new Uint8Array(p.tracados.length);
    const lw = new Float32Array(p.tracados.length);
    let c = 0;
    p.tracados.forEach((t, i) => {
      inicio[i] = c / 2;
      for (const q of t.subpaths[0]) { coords[c++] = q[0]; coords[c++] = q[1]; }
      flags[i] = (t.hasCurve ? 1 : 0) | (t.closed ? 2 : 0) | (t.stroke !== '#000000' ? 4 : 0) | (t.preenche ? 8 : 0) | (t.fill === t.stroke && t.preenche ? 16 : 0);
      lw[i] = t.lineWidth || 0.5;
    });
    inicio[p.tracados.length] = c / 2;
    out.paginas.push({ nome: p.nome, largura: p.largura, altura: p.altura, coords, inicio, flags, lw, textos: p.textos.map(t => [t.str, t.x, t.y, t.w, t.h, Math.atan2(-t.uy, t.ux), t.cota ? 1 : 0]) });
    buffers.push(coords.buffer, inicio.buffer, flags.buffer, lw.buffer);
  }
  return { pacote: out, buffers };
}

/** Arrays tipados → documento com páginas. */
export function desempacotar(pacote) {
  const paginas = pacote.paginas.map((p, n) => {
    const tracados = [];
    for (let i = 0; i + 1 < p.inicio.length; i++) {
      const a = p.inicio[i], b = p.inicio[i + 1];
      const pts = new Array(b - a);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let j = a; j < b; j++) { const x = p.coords[2 * j], y = p.coords[2 * j + 1]; pts[j - a] = [x, y]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const f = p.flags[i];
      tracados.push(tracado(pts, [bx0, by0, bx1, by1], !!(f & 1), !!(f & 2), !!(f & 4), !!(f & 8), !!(f & 16), p.lw[i]));
    }
    const textos = p.textos.map(([str, x, y, w, h, ang, cota]) => item(str, x, y, w, h, ang, !!cota));
    return criarPagina({ nome: p.nome, numero: n + 1, largura: p.largura, altura: p.altura, tracados, textos });
  });
  return documentoDe(paginas);
}

/** Monta e empacota num passo (o que o Worker faz). */
export async function lerEEmpacotar(bytes, aoProgredir = () => {}) {
  const db = await lerBanco(bytes, aoProgredir);
  aoProgredir('montando as folhas');
  const paginas = [];
  const doc = montarDocumento(db, aoProgredir);
  for (let n = 1; n <= doc.numPages; n++) paginas.push(await doc.getPage(n));
  return empacotar(doc, paginas);
}
