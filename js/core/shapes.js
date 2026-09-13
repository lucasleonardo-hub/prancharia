/* Leitura de tags geométricas: FORMA + NÚMERO.
   Regra crítica do sistema — um número nunca é interpretado sem sua forma. */

export const FORMAS = {
  circulo:   { id: 'circulo',   rotulo: 'Círculo',   simbolo: '●' },
  triangulo: { id: 'triangulo', rotulo: 'Triângulo', simbolo: '▲' },
  quadrado:  { id: 'quadrado',  rotulo: 'Quadrado',  simbolo: '■' },
  pentagono: { id: 'pentagono', rotulo: 'Pentágono', simbolo: '⬟' },
};

/** Classifica um traçado fechado pequeno. Devolve null se não for uma forma de tag. */
export function classificar(path) {
  const [x0, y0, x1, y1] = path.bbox;
  const w = x1 - x0, h = y1 - y0;
  if (w < 5 || h < 5 || w > 40 || h > 40) return null;
  if (Math.min(w, h) / Math.max(w, h) < 0.55) return null;

  let pts = null;
  for (const sp of path.subpaths) if (!pts || sp.length > pts.length) pts = sp;
  if (!pts || pts.length < 3) return null;

  if (path.hasCurve) return 'circulo';

  const uq = [];
  for (const p of pts) {
    const last = uq[uq.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) uq.push(p);
  }
  if (uq.length > 1 && Math.hypot(uq[0][0] - uq[uq.length - 1][0], uq[0][1] - uq[uq.length - 1][1]) < 0.5) uq.pop();

  if (uq.length === 3) return 'triangulo';
  if (uq.length === 4) return 'quadrado';
  if (uq.length === 5) return 'pentagono';
  return null;
}

const NUM = /^\d{1,2}$/;

/**
 * Junta formas candidatas com o número escrito dentro delas.
 * candidatos: [{forma, bbox, cx, cy, w, h}] ; textos: itens de readText()
 */
export function montarTags(candidatos, textos) {
  const numeros = textos.filter(t => NUM.test(t.str.trim()));
  const brutos = [];
  for (const c of candidatos) {
    let achado = null, melhor = Infinity;
    for (const t of numeros) {
      const dx = t.cx - c.cx, dy = t.cy - c.cy;
      if (Math.abs(dx) > c.w * 0.45 || Math.abs(dy) > c.h * 0.5) continue;
      const d = Math.hypot(dx, dy);
      if (d < melhor) { melhor = d; achado = t; }
    }
    if (!achado) continue;
    brutos.push({ forma: c.forma, numero: achado.str.trim().padStart(2, '0'), x: c.cx, y: c.cy, w: c.w, h: c.h, bbox: c.bbox });
  }
  if (brutos.length < 4) return brutos;

  // As tags de um mesmo projeto têm um tamanho característico; descartamos
  // símbolos de outra natureza que tenham passado pelo filtro.
  const larguras = brutos.map(t => t.w).sort((a, b) => a - b);
  const mediana = larguras[Math.floor(larguras.length / 2)];
  return brutos.filter(t => Math.abs(t.w - mediana) <= mediana * 0.3 && Math.abs(t.h - mediana) <= mediana * 0.38);
}

/** Coleta formas candidatas durante a varredura dos traçados. */
export function coletorDeFormas(aceitaCor) {
  const out = [];
  return {
    visit(path) {
      if (!aceitaCor(path.stroke) && !aceitaCor(path.fill)) return;
      const forma = classificar(path);
      if (!forma) return;
      const [x0, y0, x1, y1] = path.bbox;
      out.push({ forma, bbox: path.bbox, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 });
    },
    get resultado() { return out; },
  };
}
