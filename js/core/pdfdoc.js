/* Camada de acesso ao PDF. Único ponto do sistema que fala com o pdf.js.
   Converte tudo para o "espaço de prancha": mesmas coordenadas que o leitor vê
   (origem no canto superior esquerdo da folha já rotacionada, em pontos PDF). */
import * as pdfjsLib from '../../vendor/pdf.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.js', import.meta.url).href;

export const OPS = pdfjsLib.OPS;

export async function openPdf(source) {
  const params = source instanceof Uint8Array ? { data: source } : { url: source };
  return pdfjsLib.getDocument({ ...params, isEvalSupported: false }).promise;
}

/** Matriz que leva do espaço de usuário do PDF para o espaço de prancha. */
export function sheetTransform(page) {
  const vp = page.getViewport({ scale: 1 });
  return { m: vp.transform, width: vp.width, height: vp.height, rotate: page.rotate };
}

export function applyM(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/* Códigos internos das sub-operações de constructPath no pdf.js */
const P_MOVE = 0, P_LINE = 1, P_CUBIC = 2, P_QUAD = 3, P_CLOSE = 4;

/**
 * Percorre a lista de operadores da página entregando cada traçado já
 * convertido para o espaço de prancha. Não acumula os 200 mil traçados de
 * uma prancha A0 em memória: o visitante decide o que guardar.
 *
 * visit({ subpaths, hasCurve, closed, stroke, fill, paintOp, lineWidth, bbox })
 */
export async function walkPaths(page, visit) {
  const ol = await page.getOperatorList();
  const base = page.getViewport({ scale: 1 }).transform;
  let ctm = base.slice();
  const stack = [];
  let stroke = '#000000', fill = '#000000', lineWidth = 1;
  const fn = ol.fnArray, ar = ol.argsArray;

  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    if (op === OPS.save) { stack.push([ctm, stroke, fill, lineWidth]); continue; }
    if (op === OPS.restore) { const s = stack.pop(); if (s) [ctm, stroke, fill, lineWidth] = s; continue; }
    if (op === OPS.transform) { ctm = mul(ar[i], ctm); continue; }
    if (op === OPS.setStrokeRGBColor) { stroke = normColor(ar[i][0]); continue; }
    if (op === OPS.setFillRGBColor) { fill = normColor(ar[i][0]); continue; }
    if (op === OPS.setStrokeGray) { stroke = grayHex(ar[i][0]); continue; }
    if (op === OPS.setFillGray) { fill = grayHex(ar[i][0]); continue; }
    if (op === OPS.setLineWidth) { lineWidth = ar[i][0]; continue; }
    if (op !== OPS.constructPath) continue;

    const [paintOp, paths] = ar[i];
    const subpaths = [];
    let hasCurve = false, closed = false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const flat of paths) {
      const pts = [];
      let j = 0;
      while (j < flat.length) {
        const c = flat[j++];
        if (c === P_MOVE || c === P_LINE) { pts.push(applyM(ctm, flat[j++], flat[j++])); }
        else if (c === P_CUBIC) { hasCurve = true; j += 4; pts.push(applyM(ctm, flat[j++], flat[j++])); }
        else if (c === P_QUAD) { hasCurve = true; j += 2; pts.push(applyM(ctm, flat[j++], flat[j++])); }
        else if (c === P_CLOSE) { closed = true; if (pts.length) pts.push(pts[0]); }
        else break;
      }
      if (pts.length < 2) continue;
      for (const p of pts) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      subpaths.push(pts);
    }
    if (!subpaths.length) continue;
    const sx = Math.hypot(ctm[0], ctm[1]);
    visit({
      subpaths, hasCurve, closed, stroke, fill, paintOp,
      lineWidth: lineWidth * sx,
      bbox: [minX, minY, maxX, maxY],
    });
  }
}

function normColor(c) {
  if (typeof c === 'string') return c.toLowerCase();
  if (c && c.length >= 3) return '#' + [c[0], c[1], c[2]].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return '#000000';
}
function grayHex(g) {
  const v = Math.round((g ?? 0) * 255).toString(16).padStart(2, '0');
  return '#' + v + v + v;
}

/** Itens de texto no espaço de prancha, com caixa aproximada. */
export async function readText(page) {
  const tc = await page.getTextContent({ disableNormalization: false });
  const m = page.getViewport({ scale: 1 }).transform;
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    const [x, y] = applyM(m, t[4], t[5]);
    // direção de avanço do texto, já no espaço de prancha
    const dx = m[0] * t[0] + m[2] * t[1], dy = m[1] * t[0] + m[3] * t[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const w = it.width, h = it.height || 8;
    out.push({
      str: it.str, x, y, w, h, ux, uy,
      cx: x + ux * w / 2 - uy * h * 0.3,
      cy: y + uy * w / 2 + ux * h * -0.3,
      horizontal: Math.abs(ux) > 0.85,
    });
  }
  return out;
}

export function isDark(hex) {
  if (!hex || hex[0] !== '#') return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r < 90 && g < 90 && b < 90;
}
export function isRed(hex) {
  if (!hex || hex[0] !== '#') return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r > 140 && g < 110 && b < 110;
}

/* Uma página do PDF não aceita dois renders ao mesmo tempo: dois pedidos
   concorrentes (um recorte de evidência e o visor, por exemplo) travam um ao
   outro e nenhum termina. Todo render passa por esta fila, um por vez. */
let _fila = Promise.resolve();
export function naFilaDeRender(tarefa) {
  const proximo = _fila.then(tarefa, tarefa);
  _fila = proximo.then(() => {}, () => {});
  return proximo;
}
