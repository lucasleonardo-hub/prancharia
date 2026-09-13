/* Legendas de materiais. Cada bloco de especificações é encabeçado por uma
   forma geométrica desenhada ao lado do título — é essa forma, lida do
   desenho, que define o significado dos números listados abaixo. Nada aqui
   depende de convenção presumida. */

export { CATEGORIAS } from './vocab.js';

const MAPA = [
  [/RODAP/i, 'Piso'],
  [/PISO|PAVIMENT/i, 'Piso'],
  [/PAREDE|REVEST.*PAREDE/i, 'Paredes'],
  [/TETO|FORRO|GESSO/i, 'Teto'],
  [/LOU[ÇC]A|BACIA|CUBA/i, 'Louças'],
  [/METAL|METAIS|TORNEIRA|REGISTRO/i, 'Metais'],
  [/PEDRA|SOLEIRA|PEITORIL|BAGUETE/i, 'Revestimentos em Pedras Naturais'],
  [/BANCADA|TAMPO/i, 'Bancadas'],
  [/LUMIN|ILUMINA/i, 'Luminárias'],
  [/MARCENARIA|MOBILI/i, 'Mobiliário'],
  [/ESQUADRIA|JANELA|PORTA/i, 'Esquadrias'],
];

export function categoriaDe(titulo) {
  for (const [re, cat] of MAPA) if (re.test(titulo)) return cat;
  return null;
}

const ITEM = /^(\d{1,2})\s*[-–—.]\s*(.+)$/;

/**
 * Lê os blocos de especificação de uma folha.
 * formasSemNumero: candidatos de forma que não continham número (os símbolos
 * da legenda). Devolve { blocos, mapa } onde mapa["quadrado:08"] = item.
 */
export function lerLegendas(formasSemNumero, textos) {
  const blocos = [];
  for (const c of formasSemNumero) {
    let titulo = null, melhor = Infinity;
    for (const t of textos) {
      if (!t.horizontal) continue;
      const dy = Math.abs(t.y - c.cy - c.h * 0.15);
      const dx = t.x - c.cx;
      if (dy > c.h * 0.8 || dx < c.w * 0.25 || dx > 70) continue;
      const s = t.str.trim();
      if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .\/]{2,28}$/.test(s)) continue;
      if (dx + dy < melhor) { melhor = dx + dy; titulo = t; }
    }
    if (!titulo) continue;
    blocos.push({
      forma: c.forma, titulo: titulo.str.trim(), x: titulo.x, y: titulo.y,
      categoria: categoriaDe(titulo.str), itens: [], simbolo: c,
    });
  }
  blocos.sort((a, b) => (a.x - b.x) || (a.y - b.y));

  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    const abaixo = blocos.filter(o => o !== b && Math.abs(o.x - b.x) < 60 && o.y > b.y + 4).map(o => o.y);
    const limite = abaixo.length ? Math.min(...abaixo) - 4 : b.y + 420;
    for (const t of textos) {
      if (!t.horizontal) continue;
      if (t.y <= b.y + 3 || t.y > limite) continue;
      if (t.x < b.x - 30 || t.x > b.x + 760) continue;
      const m = ITEM.exec(t.str.trim());
      if (!m) continue;
      b.itens.push({ numero: m[1].padStart(2, '0'), descricao: m[2].trim(), x: t.x, y: t.y, w: t.w, h: t.h });
    }
    b.itens.sort((p, q) => p.numero.localeCompare(q.numero));
    // um bloco de legenda de verdade tem itens alinhados à esquerda e
    // numerados a partir de 1 — o resto é anotação solta da planta
    if (b.itens.length >= 2) {
      const xs = b.itens.map(i => i.x);
      const alinhado = Math.max(...xs) - Math.min(...xs) < 8;
      const comeca = b.itens[0].numero === '01';
      let cresce = true;
      for (let k = 1; k < b.itens.length; k++) {
        if (Number(b.itens[k].numero) <= Number(b.itens[k - 1].numero)) { cresce = false; break; }
      }
      if (!alinhado || !comeca || !cresce) b.itens = [];
    } else b.itens = [];
  }

  // caixa do bloco inteiro: título + símbolo + todos os itens listados
  for (const b of blocos) {
    if (!b.itens.length) continue;
    const xs = [b.x, b.simbolo ? b.simbolo.cx - b.simbolo.w : b.x, ...b.itens.map(i => i.x), ...b.itens.map(i => i.x + i.w)];
    const ys = [b.y - 14, ...b.itens.map(i => i.y + 4)];
    b.caixa = [Math.min(...xs) - 8, Math.min(...ys) - 6, Math.max(...xs) + 10, Math.max(...ys) + 6];
  }

  const mapa = {}; const colisoes = [];
  for (const b of blocos) for (const it of b.itens) {
    const k = b.forma + ':' + it.numero;
    if (mapa[k] && mapa[k].descricao !== it.descricao) { colisoes.push({ chave: k, a: mapa[k], b: { bloco: b.titulo, descricao: it.descricao } }); continue; }
    mapa[k] = {
      forma: b.forma, numero: it.numero, categoria: b.categoria,
      tituloBloco: b.titulo, descricao: it.descricao,
      ancora: [it.x, it.y - it.h - 2, it.x + it.w, it.y + 3],
      blocoCaixa: b.caixa || null,
      itensBloco: b.itens.map(i => ({ numero: i.numero, descricao: i.descricao })),
    };
  }
  return { blocos: blocos.filter(b => b.itens.length), mapa, colisoes };
}
