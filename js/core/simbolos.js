/* O que parece tag e não é, e a linha que liga a tag ao cômodo.

   Duas confusões que a leitura geométrica pura comete numa prancha de
   arquitetura:

   1. SÍMBOLOS DE CORTE E DETALHE. A marcação de corte é um círculo (às vezes
      dividido ao meio) com a letra ou o número do corte, preso a uma linha
      longa que atravessa a planta e termina numa seta ou triângulo
      preenchido; a bolha de detalhe é um círculo com o número do detalhe em
      cima e o número da folha embaixo. Os dois têm um número dentro de um
      círculo — exatamente a assinatura de uma tag de acabamento — e traduzir
      "corte 1" pela legenda de pisos inventa um porcelanato onde há um corte.

   2. LINHA DE CHAMADA. Em ambiente pequeno o projetista desenha o bloco de
      tags do lado de fora e liga cada uma ao lugar com uma linha (reta ou
      quebrada, com seta ou ponto na ponta). A tag está sobre o corredor, mas
      pertence ao banho onde a linha termina. Sem seguir a linha, o vínculo
      cai na proximidade e erra o cômodo.

   Este módulo só olha geometria: segmentos retos coletados na varredura dos
   traçados, as formas candidatas e os textos. Ele não decide sozinho o que é
   acabamento — devolve o que descartou e por quê, para a folha registrar. */

/** Coletor de segmentos retos de qualquer inclinação — o coletor de fios das
    tabelas só guarda horizontais e verticais, e a linha de chamada raramente
    é uma coisa ou outra. Polilinhas curtas (até 8 pontos) bastam: parede,
    chamada e linha de corte cabem aí; a hachura e o texto vetorizado, não. */
export function coletorDeSegmentos({ minComp = 6, maxComp = 900, maxPontos = 8 } = {}) {
  const segs = [];
  return {
    visit(path) {
      if (path.hasCurve) return;
      for (const sp of path.subpaths) {
        if (sp.length < 2 || sp.length > maxPontos) continue;
        for (let i = 1; i < sp.length; i++) {
          const [x0, y0] = sp[i - 1], [x1, y1] = sp[i];
          const len = Math.hypot(x1 - x0, y1 - y0);
          if (len < minComp || len > maxComp) continue;
          segs.push({ x0, y0, x1, y1, len, pontos: sp.length });
        }
      }
    },
    get resultado() { return segs; },
  };
}

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Distância de um ponto ao segmento. */
function distAoSegmento(px, py, s) {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - s.x0) * dx + (py - s.y0) * dy) / l2));
  return dist(px, py, s.x0 + t * dx, s.y0 + t * dy);
}

/**
 * Separa as formas candidatas em tags plausíveis e símbolos de desenho.
 *
 * candidatos: [{ forma, bbox, cx, cy, w, h }]  (coletorDeFormas)
 * textos:     itens de readText()
 * segmentos:  coletorDeSegmentos().resultado
 *
 * Devolve { aceitos, descartados: [{ candidato, motivo }] }.
 */
export function filtrarSimbolosDeDesenho(candidatos, textos, segmentos, { linhaLonga = 120 } = {}) {
  const aceitos = [], descartados = [];
  const triangulos = candidatos.filter(c => c.forma === 'triangulo');
  for (const c of candidatos) {
    const r = Math.max(c.w, c.h) / 2;
    const dentro = textos.filter(t => Math.abs(t.cx - c.cx) <= c.w * 0.55 && Math.abs(t.cy - c.cy) <= c.h * 0.6);
    let motivo = '';

    /* bolha de detalhe ou de corte: dois textos no mesmo círculo (número em
       cima, folha embaixo), ou uma letra em vez de número */
    if (dentro.length >= 2) motivo = 'bolha com dois textos (número e folha)';
    else if (dentro.length === 1 && /^[A-Z]{1,2}$/i.test(dentro[0].str.trim())) motivo = 'letra de corte dentro do círculo';

    if (!motivo && c.forma === 'circulo') {
      for (const s of segmentos) {
        /* corda: segmento inteiro dentro do círculo — é o círculo dividido */
        const d0 = dist(s.x0, s.y0, c.cx, c.cy), d1 = dist(s.x1, s.y1, c.cx, c.cy);
        if (d0 <= r * 1.15 && d1 <= r * 1.15 && s.len >= r * 1.2) { motivo = 'círculo dividido ao meio'; break; }
        /* linha longa presa ao círculo ou passando por ele: linha de corte */
        const encosta = Math.min(d0, d1) <= r * 1.6 || distAoSegmento(c.cx, c.cy, s) <= r * 0.6;
        if (encosta && s.len >= linhaLonga) { motivo = `linha de corte de ${Math.round(s.len)} pt presa ao símbolo`; break; }
      }
    }
    /* seta de corte: triângulo colado ao círculo */
    if (!motivo && c.forma === 'circulo') {
      const seta = triangulos.find(t => t !== c && dist(t.cx, t.cy, c.cx, c.cy) <= r * 2.6);
      if (seta) motivo = 'triângulo (seta de corte) colado ao círculo';
    }
    if (motivo) descartados.push({ candidato: c, motivo }); else aceitos.push(c);
  }
  /* o triângulo colado a um círculo descartado (por qualquer motivo) é a
     seta desse símbolo, não uma tag */
  const setas = new Set();
  for (const d of descartados) {
    if (d.candidato.forma !== 'circulo') continue;
    const c = d.candidato, r = Math.max(c.w, c.h) / 2;
    for (const t of triangulos) if (dist(t.cx, t.cy, c.cx, c.cy) <= r * 2.6) setas.add(t);
  }
  if (setas.size) {
    const restam = aceitos.filter(c => !setas.has(c));
    for (const t of setas) if (aceitos.includes(t)) descartados.push({ candidato: t, motivo: 'seta de corte' });
    return { aceitos: restam, descartados };
  }
  return { aceitos, descartados };
}

/**
 * Segue a linha de chamada de uma tag: o segmento que encosta na borda da
 * forma, e depois os segmentos encadeados ponta a ponta (linha quebrada),
 * até a ponta livre. Devolve { x, y, tracado: [[x,y]…] } ou null.
 *
 * A linha de corte não engana aqui: uma tag com número, aceita pelo filtro
 * acima, não tem linha longa presa — e `maxComp` limita o passo.
 */
export function seguirChamada(tag, segmentos, { maxSaltos = 4, tolerancia = 2.5, maxComp = 400 } = {}) {
  const r = Math.max(tag.w, tag.h) / 2;
  const borda = r * 1.5;
  let melhor = null, dm = Infinity;
  for (const s of segmentos) {
    if (s.len > maxComp) continue;
    const d0 = dist(s.x0, s.y0, tag.x, tag.y), d1 = dist(s.x1, s.y1, tag.x, tag.y);
    const perto = Math.min(d0, d1), longe = Math.max(d0, d1);
    /* encosta na borda e sai para fora — não é um traço dentro da forma */
    if (perto > borda || longe < r * 2) continue;
    if (perto < dm) { dm = perto; melhor = d0 <= d1 ? { s, x: s.x1, y: s.y1, ini: [s.x0, s.y0] } : { s, x: s.x0, y: s.y0, ini: [s.x1, s.y1] }; }
  }
  if (!melhor) return null;
  const tracado = [melhor.ini, [melhor.x, melhor.y]];
  const usados = new Set([melhor.s]);
  let px = melhor.x, py = melhor.y;
  for (let salto = 0; salto < maxSaltos; salto++) {
    let prox = null, dp = Infinity;
    for (const s of segmentos) {
      if (usados.has(s) || s.len > maxComp) continue;
      const d0 = dist(s.x0, s.y0, px, py), d1 = dist(s.x1, s.y1, px, py);
      const d = Math.min(d0, d1);
      if (d > tolerancia || d >= dp) continue;
      dp = d; prox = d0 <= d1 ? { s, x: s.x1, y: s.y1 } : { s, x: s.x0, y: s.y0 };
    }
    if (!prox) break;
    /* uma parede que por acaso encosta na ponta não é continuação: a
       continuação sai da ponta, a parede passa por ela */
    usados.add(prox.s);
    px = prox.x; py = prox.y;
    tracado.push([px, py]);
  }
  return { x: px, y: py, tracado };
}
