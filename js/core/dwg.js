/* Leitura de DWG no navegador — o desenho vira uma "página" igual à do PDF.

   O motor vetorial, o visor e os recortes para a IA só conhecem uma coisa:
   a página do pdf.js — traçados em espaço de prancha (pontos, origem no canto
   superior esquerdo), itens de texto com posição e altura, `getViewport` e
   `render` num canvas. Este módulo abre o DWG com o libredwg compilado para
   WebAssembly (vendor/libredwg, GPL — carregado só quando chega um .dwg) e
   monta um documento com essa mesma interface. Nada muda no motor: a mesma
   leitura de tags, legendas, tabelas, ambientes e paredes roda em cima do
   DWG, e a IA recebe os recortes desenhados a partir dele.

   O que vira página:
     - cada LAYOUT (folha de paper space) com conteúdo próprio: o carimbo e
       os textos do layout mais, por VIEWPORT, o pedaço do model space que
       ela mostra, na escala da viewport — é a prancha como seria plotada,
       em milímetros de papel convertidos para pontos;
     - sem layouts úteis, o model space inteiro numa página só. A escala vem
       do próprio desenho: a altura mediana dos textos é levada a ~7 pt, o
       tamanho de um texto de prancha plotada, para os limiares do motor
       (tag de 5 a 40 pt, texto, distâncias) valerem como no PDF.

   Cores: a prancha impressa é preta com as tags em vermelho; no DWG cada
   camada tem sua cor de tela (amarelo, ciano, branco). Para o motor, toda
   cor que não é vermelha vira preto — o mesmo que uma plotagem monocromática
   faz — e o vermelho continua vermelho.

   O que fica de fora: DXF (o build padrão do libredwg-web não o lê),
   imagens raster embutidas, tabelas ACAD_TABLE e multileaders (só a
   geometria simples). Texto em MTEXT tem os códigos de formatação
   removidos. */

const MARGEM = 40;                 // pt em volta do desenho
const ALTURA_TEXTO_ALVO = 7;       // pt: altura típica de texto numa prancha plotada
const PT_POR_MM = 72 / 25.4;
const MAIOR_LADO_MAX = 24000, MAIOR_LADO_MIN = 400;
const PROFUNDIDADE_MAX = 8;

/* ------------------------------------------------------------------ */
/* a biblioteca, carregada sob demanda                                  */
/* ------------------------------------------------------------------ */

let libPromessa = null;
function biblioteca() {
  if (!libPromessa) {
    libPromessa = import('../../vendor/libredwg/dist/libredwg-web.js')
      .then(async m => ({ m, lib: await m.LibreDwg.create() }))
      .catch(err => { libPromessa = null; throw new Error('o leitor de DWG não carregou: ' + err.message); });
  }
  return libPromessa;
}

/** "AC10xx" nos seis primeiros bytes: é DWG. */
export const ehDwg = (bytes) => !!bytes && bytes.length > 6 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31;

/**
 * Abre um DWG e devolve o documento no formato de página do pdf.js.
 * `aoProgredir(texto)` recebe as etapas (baixar a biblioteca, ler, montar).
 */
export async function abrirDwg(bytes, { aoProgredir = () => {} } = {}) {
  aoProgredir('carregando o leitor de DWG');
  const { m, lib } = await biblioteca();
  aoProgredir('lendo o DWG');
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dwg = lib.dwg_read_data(dados, m.Dwg_File_Type.DWG);
  if (!dwg) throw new Error('o DWG não pôde ser lido (versão não suportada ou arquivo corrompido)');
  let db;
  try { db = lib.convert(dwg); }
  finally { try { lib.dwg_free(dwg); } catch { /* já liberado */ } }
  aoProgredir('montando as folhas');
  return montarDocumento(db);
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
/** A cor "impressa": vermelho fica vermelho, o resto é preto. */
const corImpressa = ([r, g, b]) => (r > 140 && g < 110 && b < 110) ? '#e00000' : '#000000';

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
  const n = Math.max(4, Math.min(64, Math.ceil(varre / (Math.PI / 12))));
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
  const n = Math.max(2, Math.min(24, Math.ceil(Math.abs(th) / (Math.PI / 12))));
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
  t = t.replace(/\\[fFHWQTACcLlOoKkpX][^;]*;/g, '');            // fonte, altura, largura, cor, alinhamento…
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
  return { blocos, blocosPorHandle, camadas, estilos };
}

const ocultaCamada = (ctx, nome) => {
  const l = ctx.camadas.get(nome);
  return !!(l && (l.off || l.frozen || l.plotFlag === 0)) || /^defpoints$/i.test(nome || '');
};

function corDe(ctx, e, corPai) {
  const ci = Number(e.colorIndex);
  if (ci === 256 || Number.isNaN(ci)) { const l = ctx.camadas.get(e.layer); return l ? corAci(l.colorIndex) : [0, 0, 0]; }
  if (ci === 0) return corPai || [0, 0, 0];
  return corAci(ci);
}

/**
 * Percorre as entidades (recursivo nos INSERTs) e empurra em `saida`:
 *   paths: { pts: [[x,y]…][], curva, fechado, cor, preenche, lw }
 *   textos: { str, x, y, h, w, ang }   (x,y = início da linha de base)
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
        let a0 = e.startAngle || 0, a1 = e.endAngle ?? Math.PI * 2;
        const cheio = Math.abs((a1 - a0) - Math.PI * 2) < 1e-6 || a1 === a0;
        let varre = cheio ? Math.PI * 2 : a1 - a0; while (varre <= 1e-9) varre += Math.PI * 2;
        const n = Math.max(8, Math.min(64, Math.ceil(varre / (Math.PI / 12))));
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
        if (c.length >= 3) push([...c, c[0]], { cor, fechado: true, preenche: true });
        break;
      }
      case 'HATCH': {
        for (const bp of e.boundaryPaths || []) {
          let pts = [];
          if (bp.vertices && bp.vertices.length) {
            pts.push([bp.vertices[0].x, bp.vertices[0].y]);
            for (let i = 1; i < bp.vertices.length; i++) pts.push(...bulge(pts[pts.length - 1], [bp.vertices[i].x, bp.vertices[i].y], bp.vertices[i - 1].bulge || 0));
          } else {
            for (const ed of bp.edges || []) {
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
           não vale como "texto de prancha" para calibrar a escala: a altura
           da cota segue o DIMSCALE, não o padrão dos rótulos */
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

function caixaDe(saida) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of saida.paths) for (const q of p.pts) v(q[0], q[1]);
  for (const t of saida.textos) { v(t.x, t.y); v(t.x + t.w * Math.cos(t.ang), t.y + t.w * Math.sin(t.ang)); }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

const mediana = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * A caixa do DESENHO, não de tudo o que há no arquivo: um traço perdido a
 * quilômetros da planta (é comum) faria a folha ter metros de vazio e o
 * texto virar pó. Onde há texto, o desenho é a região dos textos com folga;
 * o que fica longe dela é descartado da página.
 */
function caixaDoDesenho(saida) {
  const tudo = caixaDe(saida);
  if (!tudo || saida.textos.length < 3) return tudo;
  /* o miolo dos textos: mediana e desvio absoluto mediano em x e y. Um
     texto perdido ou um bloco inserido com escala absurda fica fora do raio
     e não puxa a caixa — com cinco textos ou com cinco mil */
  const base = saida.textos.filter(t => !t.cota).length >= 3 ? saida.textos.filter(t => !t.cota) : saida.textos;
  const xs = base.map(t => t.x), ys = base.map(t => t.y);
  const mx = mediana(xs), my = mediana(ys);
  const madX = mediana(xs.map(x => Math.abs(x - mx))), madY = mediana(ys.map(y => Math.abs(y - my)));
  const hMed = mediana(base.map(t => t.h));
  const raio = Math.max(madX, madY) * 4 + hMed * 60;
  const lim = [mx - raio, my - raio, mx + raio, my + raio];
  const h = Math.max(madY * 2, 1);
  const dentro = (px, py) => px >= lim[0] && px <= lim[2] && py >= lim[1] && py <= lim[3];
  const antesP = saida.paths.length, antesT = saida.textos.length;
  saida.paths = saida.paths.filter(p => p.pts.some(q => dentro(q[0], q[1])));
  saida.textos = saida.textos.filter(t => dentro(t.x, t.y) && t.h < Math.max(h * 2, hMed * 40));
  const fora = (antesP - saida.paths.length) + (antesT - saida.textos.length);
  if (fora) console.info(`[dwg] ${fora} elemento(s) longe do desenho descartado(s)`);
  const cx = caixaDe(saida);
  return cx ? [Math.max(cx[0], lim[0]), Math.max(cx[1], lim[1]), Math.min(cx[2], lim[2]), Math.min(cx[3], lim[3])] : tudo;
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
    const cor = corImpressa(p.cor || [0, 0, 0]);
    tracados.push({
      subpaths: [pts], hasCurve: !!p.curva, closed: !!p.fechado,
      stroke: cor, fill: p.preenche ? (p.solido ? cor : '#e8e8e8') : '#000000',
      paintOp: p.preenche ? 'fill' : 'stroke', lineWidth: p.lw || 0.5,
      bbox: [bx0, by0, bx1, by1], preenche: !!p.preenche,
    });
  }
  const textos = [];
  for (const t of saida.textos) {
    const h = t.h * k, w = t.w * k;
    const ux = Math.cos(t.ang), uy = -Math.sin(t.ang);       // y de prancha cresce para baixo
    const x = X(t.x), y = Y(t.y);
    textos.push({
      str: t.str, x, y, w, h, ux, uy,
      cx: x + ux * w / 2 - uy * h * 0.3,
      cy: y + uy * w / 2 + ux * h * -0.3,
      horizontal: Math.abs(ux) > 0.85,
      cota: !!t.cota,   // texto de cota: o motor pode ignorá-lo ao procurar rótulos
    });
  }
  return criarPagina({ nome, numero, largura: W, altura: H, tracados, textos });
}

function criarPagina({ nome, numero, largura, altura, tracados, textos }) {
  const page = {
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
        for (const p of tracados) {
          const b = p.bbox;
          if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
          ctx.beginPath();
          for (const sp of p.subpaths) { ctx.moveTo(sp[0][0], sp[0][1]); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]); }
          if (p.preenche) { ctx.fillStyle = p.fill; ctx.fill(); }
          ctx.strokeStyle = p.stroke; ctx.lineWidth = Math.max(lwMin, p.lineWidth || 0.5);
          ctx.stroke();
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
      return { promise, cancel() { /* desenho síncrono: nada a cancelar */ } };
    },
    cleanup() {},
  };
  return page;
}

/**
 * Monta o documento a partir do banco do libredwg. Puro: não toca no DOM,
 * então roda também em Node, para testes.
 */
export function montarDocumento(db) {
  const ctx = contexto(db);
  const modelo = ctx.blocos.get('*Model_Space');
  const entidadesModelo = (db.entities && db.entities.length) ? db.entities : ((modelo && modelo.entities) || []);
  const paginas = [];

  /* 1) layouts de paper space com conteúdo próprio */
  const layouts = ((db.objects || {}).LAYOUT || []).filter(l => l && !/^model$/i.test(l.layoutName || l.name || ''));
  layouts.sort((a, b) => (a.tabOrder || 0) - (b.tabOrder || 0));
  for (const l of layouts) {
    const bloco = ctx.blocosPorHandle.get(String(l.paperSpaceTableId)) || ctx.blocos.get(l.blockRecordName);
    const ents = (bloco && bloco.entities) || [];
    /* a viewport "geral" (id 1) é o próprio papel, não uma janela; e uma
       folha de verdade tem carimbo e moldura desenhados no paper space —
       layout só com viewports é o padrão vazio que todo DWG traz */
    const viewports = ents.filter(e => e.type === 'VIEWPORT' && Number(e.viewportId) !== 1
      && (e.viewHeight || 0) > 0 && (e.width || 0) > 0 && (e.width || 0) < 5000 && (e.height || 0) < 5000);
    const proprias = ents.filter(e => e.type !== 'VIEWPORT');
    if (!proprias.length) continue;
    const saida = novaSaida();
    coletar(ctx, proprias, ID, null, saida);
    for (const vp of viewports) {
      const vc = vp.viewportCenter || { x: 0, y: 0 }, dc = vp.displayCenter || { x: 0, y: 0 };
      const s = (vp.height || 1) / vp.viewHeight;
      const m = mul(mul(mul(T(-dc.x, -dc.y), S(s, s)), R(vp.viewTwistAngle || 0)), T(vc.x, vc.y));
      const parcial = novaSaida();
      coletar(ctx, entidadesModelo, m, null, parcial);
      /* só o que cabe na janela da viewport */
      const rx0 = vc.x - vp.width / 2, rx1 = vc.x + vp.width / 2, ry0 = vc.y - vp.height / 2, ry1 = vc.y + vp.height / 2;
      const dentro = (xs, ys) => Math.max(...xs) >= rx0 && Math.min(...xs) <= rx1 && Math.max(...ys) >= ry0 && Math.min(...ys) <= ry1;
      for (const p of parcial.paths) if (dentro(p.pts.map(q => q[0]), p.pts.map(q => q[1]))) saida.paths.push(p);
      for (const t of parcial.textos) if (t.x >= rx0 - t.w && t.x <= rx1 && t.y >= ry0 - t.h && t.y <= ry1 + t.h) saida.textos.push(t);
      /* a moldura da viewport, como plotada */
      saida.paths.push({ pts: [[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1], [rx0, ry0]], curva: false, fechado: true, cor: [0, 0, 0], preenche: false, lw: 0.3 });
    }
    const caixaEnt = caixaDe(saida);
    if (!caixaEnt) continue;
    const lim = l.minLimit && l.maxLimit && Number.isFinite(l.minLimit.x) && (l.maxLimit.x - l.minLimit.x) > 10 && (l.maxLimit.x - l.minLimit.x) < 5000
      ? [l.minLimit.x, l.minLimit.y, l.maxLimit.x, l.maxLimit.y] : null;
    const caixa = lim && caixaEnt[0] >= lim[0] - 50 && caixaEnt[2] <= lim[2] + 50 ? lim : caixaEnt;
    const k = Number(db.header && db.header.INSUNITS) === 1 ? 72 : PT_POR_MM;
    paginas.push(montarPagina({ nome: l.layoutName || l.name || 'Layout', numero: paginas.length + 1, saida, k, caixa }));
  }

  /* 2) sem layouts úteis: o model space inteiro */
  if (!paginas.length) {
    const saida = novaSaida();
    coletar(ctx, entidadesModelo, ID, null, saida);
    const caixa = caixaDoDesenho(saida);
    if (!caixa) throw new Error('o DWG não tem geometria nem texto legível');
    const maior = Math.max(caixa[2] - caixa[0], caixa[3] - caixa[1]) || 1;
    const rotulos = saida.textos.filter(t => !t.cota && t.h > 0);
    const alturas = (rotulos.length >= 3 ? rotulos : saida.textos).map(t => t.h).filter(h => h > 0);
    let k = alturas.length ? ALTURA_TEXTO_ALVO / mediana(alturas) : 3370 / maior;
    k = Math.min(MAIOR_LADO_MAX / maior, Math.max(MAIOR_LADO_MIN / maior, k));
    paginas.push(montarPagina({ nome: 'Model', numero: 1, saida, k, caixa }));
  }

  return {
    dwg: true,
    numPages: paginas.length,
    paginas: paginas.map(p => ({ nome: p.nome, largura: Math.round(p.largura), altura: Math.round(p.altura), tracados: p.tracados.length, textos: p.textos.length })),
    async getPage(n) { const p = paginas[n - 1]; if (!p) throw new Error(`página ${n} não existe`); return p; },
    async destroy() { paginas.length = 0; },
  };
}
