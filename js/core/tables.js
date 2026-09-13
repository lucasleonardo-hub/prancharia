/* Leitura de tabelas desenhadas na prancha (esquadrias, soleiras, legenda de
   piso). A grade vem dos próprios fios desenhados, não de palpite sobre
   espaçamento: cada célula é um retângulo real da tabela. */

/** Coletor de fios retos escuros — alimentado pela varredura de traçados. */
export function coletorDeFios(minComp = 18) {
  const fios = [];
  return {
    visit(path) {
      const c = path.stroke || '#000';
      const n = parseInt(c.slice(1), 16);
      if (!Number.isFinite(n)) return;
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      if (r > 150 || g > 150 || b > 150) return;
      for (const sp of path.subpaths) {
        for (let i = 1; i < sp.length; i++) {
          const [x0, y0] = sp[i - 1], [x1, y1] = sp[i];
          const dx = x1 - x0, dy = y1 - y0;
          if (Math.abs(dx) < 0.9 && Math.abs(dy) >= minComp) fios.push({ v: true, x: (x0 + x1) / 2, a: Math.min(y0, y1), b: Math.max(y0, y1) });
          else if (Math.abs(dy) < 0.9 && Math.abs(dx) >= minComp) fios.push({ v: false, y: (y0 + y1) / 2, a: Math.min(x0, x1), b: Math.max(x0, x1) });
        }
      }
    },
    get resultado() { return fios; },
  };
}

function agrupar(vals, tol) {
  const ord = [...vals].sort((a, b) => a - b);
  const grupos = [];
  for (const v of ord) {
    const g = grupos[grupos.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v); else grupos.push([v]);
  }
  return grupos.map(g => g.reduce((s, v) => s + v, 0) / g.length);
}

/**
 * Monta a grade de uma tabela a partir do seu título.
 * Devolve { linhas: [[celulas]], colunasX, linhasY, caixa } ou null.
 */
export function lerTabela(titulo, fios, textos, opcoes = {}) {
  const larguraMax = opcoes.larguraMax || 760;
  const alturaMax = opcoes.alturaMax || 1500;
  const bx0 = titulo.x - larguraMax, bx1 = titulo.x + larguraMax;
  const by0 = titulo.y - 2, by1 = Math.min(titulo.y + alturaMax, opcoes.limiteY ?? Infinity);

  // 1. Os fios horizontais longos logo abaixo do título desenham as linhas.
  const cand = fios.filter(f => !f.v && f.y >= by0 && f.y <= by1 && f.a >= bx0 && f.b <= bx1 && (f.b - f.a) > 70);
  if (cand.length < 3) return null;
  const meds = (arr) => { const o = [...arr].sort((a, b) => a - b); return o[Math.floor(o.length / 2)]; };
  const tx0 = meds(cand.map(f => f.a)), tx1 = meds(cand.map(f => f.b));
  const larguraTab = tx1 - tx0;
  if (larguraTab < 80) return null;
  // A linha tem de ter a MESMA largura da tabela nas duas pontas: é isso que
  // separa quadros encostados um no outro na mesma folha.
  const tol = Math.max(6, larguraTab * 0.06);
  const horiz = cand.filter(f => Math.abs(f.a - tx0) <= tol && Math.abs(f.b - tx1) <= tol);
  if (horiz.length < 3) return null;

  // linhas contíguas: paramos onde houver um salto grande (fim da tabela)
  const ys = agrupar(horiz.map(f => f.y), 2.5).sort((a, b) => a - b);
  const vaos = [];
  for (let i = 1; i < ys.length; i++) vaos.push(ys[i] - ys[i - 1]);
  const vaoTipico = vaos.length ? meds(vaos) : 20;
  const corte = Math.max(vaoTipico * 4, 120);
  const linhasY = [ys[0]];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - linhasY[linhasY.length - 1] > corte) break;   // acabou esta tabela
    linhasY.push(ys[i]);
  }
  if (linhasY.length < 2) return null;
  const y0 = linhasY[0], y1 = linhasY[linhasY.length - 1];
  const alturaTab = y1 - y0;
  if (alturaTab < 16) return null;

  // 2. Fios verticais dentro da caixa desenham as colunas.
  const compV = new Map();
  for (const f of fios) {
    if (!f.v || f.x < tx0 - 4 || f.x > tx1 + 4) continue;
    const ov = Math.min(f.b, y1) - Math.max(f.a, y0);
    if (ov <= 0) continue;
    const k = Math.round(f.x * 2) / 2;
    compV.set(k, (compV.get(k) || 0) + ov);
  }
  let colunas = agrupar([...compV].filter(([, c]) => c > alturaTab * 0.14).map(([x]) => x), 3.5);
  colunas = colunas.filter(x => x >= tx0 - 4 && x <= tx1 + 4);
  if (colunas[0] > tx0 + 4) colunas.unshift(tx0);
  if (colunas[colunas.length - 1] < tx1 - 4) colunas.push(tx1);
  if (colunas.length < 2) return null;

  const dentro = textos.filter(t => t.x >= tx0 - 5 && t.x <= tx1 + 6 && t.y >= y0 - 2 && t.y <= y1 + 4 && t.horizontal);
  const linhas = [];
  for (let r = 0; r < linhasY.length - 1; r++) {
    const ya = linhasY[r], yb = linhasY[r + 1];
    if (yb - ya < 5) continue;
    const cels = new Array(colunas.length - 1).fill(null).map(() => []);
    for (const t of dentro) {
      if (t.y <= ya + 1 || t.y > yb + 2.5) continue;
      const mid = t.x + t.w / 2;
      let c = -1;
      for (let k = 0; k < colunas.length - 1; k++) if (mid >= colunas[k] - 2.5 && mid < colunas[k + 1] + 2.5) { c = k; break; }
      if (c < 0) c = mid < colunas[0] ? 0 : colunas.length - 2;
      cels[c].push(t);
    }
    const texto = cels.map(ts => ts.sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(t => t.str.trim()).join(' ').replace(/\s+/g, ' ').trim());
    if (texto.some(v => v)) linhas.push({ y0: ya, y1: yb, celulas: texto, caixa: [tx0, ya, tx1, yb] });
  }
  // colunas totalmente vazias vêm de fios de tabelas vizinhas
  const usadas = colunas.slice(0, -1).map((_, i) => linhas.some(l => l.celulas[i]));
  if (usadas.some(u => !u)) {
    for (const l of linhas) l.celulas = l.celulas.filter((_, i) => usadas[i]);
    colunas = colunas.filter((_, i) => i === colunas.length - 1 || usadas[i]);
  }
  return { linhas, colunas, linhasY, caixa: [tx0, y0, tx1, y1] };
}

/** Acha o índice da coluna cujo cabeçalho casa com um dos termos. */
export function acharColuna(linhasCabecalho, termos) {
  for (const linha of linhasCabecalho) {
    for (let i = 0; i < linha.celulas.length; i++) {
      const v = linha.celulas[i].toUpperCase();
      if (termos.some(t => v.includes(t))) return i;
    }
  }
  return -1;
}
