/* Visualizador de prancha e recortes de evidência.
   Todo recorte sai da prancha original, na posição exata onde a informação
   foi lida — é o que sustenta o "Ver na prancha". */

import { estado } from '../app.js';
import { openPdf, naFilaDeRender } from '../core/pdfdoc.js';
import { lerArquivo } from '../core/storage.js';

const CORES = { circulo: '#2f6baf', triangulo: '#8c3e96', quadrado: '#2e7350', pentagono: '#b4671a' };
const escTxt = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function pdfDe(documentoId) {
  const cache = estado.pdfs.get(documentoId);
  if (cache?.doc) return cache.doc;
  let blob = cache?.blob || await lerArquivo(documentoId);
  if (!blob) {
    const e = estado.emps.find(x => x.documentos.some(d => d.id === documentoId));
    const meta = e?.documentos.find(d => d.id === documentoId);
    if (meta?.anexo) {
      try { blob = await (await fetch(meta.anexo)).blob(); } catch { blob = null; }
    }
  }
  if (!blob) return null;
  const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  estado.pdfs.set(documentoId, { doc, blob });
  return doc;
}

/* Um canvas só aguenta um render por vez: ao trocar de nível de zoom ou de
   prova, o desenho anterior precisa ser cancelado antes do próximo começar. */
const emCurso = new WeakMap();

/* A fila de renders é do núcleo (pdfdoc): recortes de evidência, visor e
   motor de extração disputam a mesma página. */
const naFila = naFilaDeRender;

/** Desenha um recorte da prancha com os realces pedidos. */
export async function recortar(canvas, { documentoId, pagina, caixa, realces = [], larguraAlvo = 520, reforcar = false }) {
  const anterior = emCurso.get(canvas);
  if (anterior) {
    try { anterior.tarefa?.cancel(); } catch { /* já terminou */ }
    try { await anterior.promessa; } catch { /* cancelado */ }
  }
  const marca = {};
  emCurso.set(canvas, marca);
  const doc = await pdfDe(documentoId);
  if (emCurso.get(canvas) !== marca) return false;
  const ctx = canvas.getContext('2d');
  if (!doc) { semPrancha(canvas); return false; }
  const page = await doc.getPage(pagina || 1);
  const base = page.getViewport({ scale: 1 });
  let [x0, y0, x1, y1] = caixa && caixa.length === 4 ? caixa : [0, 0, base.width, base.height];
  if (x1 - x0 < 40) { const m = (x0 + x1) / 2; x0 = m - 20; x1 = m + 20; }
  if (y1 - y0 < 30) { const m = (y0 + y1) / 2; y0 = m - 15; y1 = m + 15; }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(base.width, x1); y1 = Math.min(base.height, y1);
  const escala = Math.min(6, Math.max(1, larguraAlvo / Math.max(24, x1 - x0)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round((x1 - x0) * escala), h = Math.round((y1 - y0) * escala);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.aspectRatio = `${w} / ${h}`;
  const vp = page.getViewport({ scale: escala * dpr });
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
  let ok = true;
  marca.promessa = naFila(async () => {
    const tarefa = page.render({
      canvasContext: ctx, viewport: vp,
      transform: [1, 0, 0, 1, -x0 * escala * dpr, -y0 * escala * dpr],
    });
    marca.tarefa = tarefa;
    try { await tarefa.promise; } catch { ok = false; }
  });
  await marca.promessa;
  if (!ok || emCurso.get(canvas) !== marca) return false;
  for (const r of realces) {
    if (!r.caixa) continue;
    const rx = (r.caixa[0] - x0) * escala * dpr, ry = (r.caixa[1] - y0) * escala * dpr;
    const rw = (r.caixa[2] - r.caixa[0]) * escala * dpr, rh = (r.caixa[3] - r.caixa[1]) * escala * dpr;
    if (reforcar) {
      // na visão geral o ponto é minúsculo: escurece o resto e marca com alça
      const m = Math.max(18 * dpr, Math.min(canvas.width, canvas.height) * 0.035);
      ctx.save();
      ctx.fillStyle = 'rgba(17,19,23,.34)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(rx - m, ry - m, rw + m * 2, rh + m * 2);
      ctx.fill('evenodd');
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = r.cor || '#d13b2a';
      ctx.lineWidth = Math.max(2, 3 * dpr);
      ctx.strokeRect(rx - m, ry - m, rw + m * 2, rh + m * 2);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.strokeStyle = r.cor || '#d13b2a';
    ctx.lineWidth = Math.max(1.5, 2 * dpr);
    ctx.setLineDash(r.tracejado ? [6 * dpr, 4 * dpr] : []);
    ctx.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4);
    ctx.restore();
  }
  return true;
}

function semPrancha(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = 520; canvas.height = 150; canvas.style.aspectRatio = '520 / 150';
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--surface-3') || '#eee';
  ctx.fillRect(0, 0, 520, 150);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink-3') || '#777';
  ctx.font = '15px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Prancha não disponível neste navegador.', 260, 70);
  ctx.font = '13px system-ui';
  ctx.fillText('Reenvie o arquivo em Documentos para ver o recorte.', 260, 94);
}

/* ---------- visualizador completo ---------- */

export function montarVisualizador(caixa, { documentoId, pagina = 1, foco = null, tags = [], altura = null, rodaLivre = false, compacto = false, autoFoco = true, enquadrarInicial = null }) {
  // foco pode ser só uma caixa (uso antigo) ou o ponto completo, com legenda
  const alvo = Array.isArray(foco) ? { caixa: foco } : (foco || null);
  const ponto = alvo && alvo.caixa ? alvo.caixa : null;
  const leg = alvo && alvo.legenda && alvo.legenda.pagina === pagina ? alvo.legenda : null;
  caixa.innerHTML = `
    <div class="visor-barra${compacto ? ' compacta' : ''}">
      <button class="btn pequeno" data-vis="menos">−</button>
      <span class="pilula" data-vis-zoom>100%</span>
      <button class="btn pequeno" data-vis="mais">+</button>
      <button class="btn pequeno" data-vis="ajustar">Prancha inteira</button>
      ${ponto ? `<button class="btn pequeno primario" data-vis="foco">Centralizar${alvo.rotulo && !compacto ? ' · ' + alvo.rotulo : ''}</button>` : ''}
      ${leg ? '<button class="btn pequeno" data-vis="legenda">Ir à legenda</button>' : ''}
      <span class="pilula" data-vis-pag>página ${pagina}</span>
      <span style="margin-left:auto;color:var(--ink-3);font-size:12px">arraste para mover · ${rodaLivre ? 'roda do mouse' : 'roda do mouse com Ctrl'} para ampliar</span>
    </div>
    <div class="visor${compacto ? ' compacto' : ''}" data-visor${altura ? ` style="height:${altura}"` : ''}><canvas></canvas><svg class="marcas" data-marcas></svg>
      ${leg ? `<div class="visor-legenda">
        <div class="cat">${escTxt(leg.titulo || 'Legenda')}</div>
        <canvas data-legenda-mini></canvas>
        <p>${escTxt(leg.descricao || '')}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn pequeno" data-vis="legenda">Ver no desenho</button>
          <button class="btn pequeno" data-vis="foco">Voltar ao ponto</button>
        </div></div>` : ''}
    </div>`;
  if (leg) {
    const mini = caixa.querySelector('[data-legenda-mini]');
    // janela larga e baixa: a linha usada com as vizinhas, não o bloco inteiro
    const bl = leg.bloco || leg.caixa;
    const janela = [Math.min(bl[0], leg.caixa[0]), leg.caixa[1] - 26, Math.max(bl[2], leg.caixa[2]), leg.caixa[3] + 26];
    if (mini) recortar(mini, { documentoId, pagina: leg.pagina, caixa: janela, realces: [{ caixa: leg.caixa, cor: '#2f6baf' }], larguraAlvo: 300 });
  }
  const visor = caixa.querySelector('[data-visor]');
  const canvas = visor.querySelector('canvas');
  const marcas = visor.querySelector('[data-marcas]');
  const zoomTxt = caixa.querySelector('[data-vis-zoom]');
  // rx/ry guardam o deslocamento do último quadro pintado: a diferença em
  // relação a x/y move o canvas por CSS enquanto o novo quadro não chega
  const st = { escala: 0.3, x: 0, y: 0, rx: 0, ry: 0, base: null, page: null, renderizando: false, pendente: false };

  async function preparar() {
    const doc = await pdfDe(documentoId);
    if (!doc) { visor.innerHTML = '<div class="vazio"><h3>Prancha indisponível</h3><p>O arquivo não está neste navegador. Reenvie-o em Documentos para visualizar.</p></div>'; return; }
    st.page = await doc.getPage(pagina);
    st.base = st.page.getViewport({ scale: 1 });
    // um enquadramento só, já no primeiro quadro: dois renders encavalados
    // na mesma página do PDF travam um ao outro
    if (enquadrarInicial) enquadrar(enquadrarInicial, 1.15, 6);
    else ajustar();
    if (ponto && autoFoco && !enquadrarInicial) setTimeout(irAoFoco, 60);
  }
  function ajustar() {
    if (!st.base) return;
    const r = visor.getBoundingClientRect();
    st.escala = Math.min(r.width / st.base.width, r.height / st.base.height) * 0.98;
    st.x = (r.width - st.base.width * st.escala) / 2;
    st.y = (r.height - st.base.height * st.escala) / 2;
    desenhar();
  }
  function enquadrar(c, fator = 3, maxEscala = 6) {
    if (!st.base || !c) return;
    const r = visor.getBoundingClientRect();
    st.escala = Math.min(maxEscala, Math.max(0.1, r.width / Math.max(60, (c[2] - c[0]) * fator)));
    st.x = r.width / 2 - ((c[0] + c[2]) / 2) * st.escala;
    st.y = r.height / 2 - ((c[1] + c[3]) / 2) * st.escala;
    desenhar();
  }
  function irAoFoco() { enquadrar(ponto, 3); }
  function irALegenda() { if (leg) enquadrar(leg.bloco || leg.caixa, 1.25, 2.4); }
  /* Desenha só a janela visível. Uma prancha A0 a 450% daria um canvas de
     15 000 px — o navegador desiste e entrega vazio. Pintando apenas o que
     cabe na tela, o custo não depende do zoom. */
  function desenhar() {
    if (!st.page) return;
    zoomTxt.textContent = Math.round(st.escala * 100) + '%';
    canvas.style.transform = `translate(${st.x - st.rx}px, ${st.y - st.ry}px)`;
    sobrepor();
    st.pendente = true;
    bombear();
  }
  async function bombear() {
    if (st.renderizando) return;
    st.renderizando = true;
    // repinta enquanto houver estado novo: o último quadro é sempre o atual
    while (st.pendente) { st.pendente = false; await quadro(); }
    st.renderizando = false;
    // se o quadro não acompanhou o estado, insiste algumas vezes
    if ((st.rx !== st.x || st.ry !== st.y) && (st.remendos = (st.remendos || 0) + 1) <= 3) {
      setTimeout(() => { if (st.rx !== st.x || st.ry !== st.y) desenhar(); }, 260);
    }
  }
  async function quadro() {
    const r = visor.getBoundingClientRect();
    // a gaveta pode ainda estar entrando: sem medida não há o que pintar,
    // então o estado é rearmado e tentado de novo em seguida
    if (!st.page || r.width < 2 || r.height < 2) {
      if (st.tentativas === undefined) st.tentativas = 0;
      if (st.tentativas++ < 14) { st.pendente = true; await new Promise(ok => setTimeout(ok, 110)); }
      return;
    }
    st.tentativas = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const larg = Math.round(r.width), alt = Math.round(r.height);
    const rx = st.x, ry = st.y, escala = st.escala;
    canvas.width = Math.round(larg * dpr); canvas.height = Math.round(alt * dpr);
    canvas.style.width = larg + 'px'; canvas.style.height = alt + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(rx * dpr, ry * dpr, st.base.width * escala * dpr, st.base.height * escala * dpr);
    ctx.restore();
    const vp = st.page.getViewport({ scale: escala * dpr });
    if (!st.pintouUmaVez) visor.classList.add('carregando');
    await naFila(async () => {
      try {
        await st.page.render({
          canvasContext: ctx, viewport: vp,
          transform: [1, 0, 0, 1, rx * dpr, ry * dpr],
        }).promise;
      } catch { /* cancelado */ }
    });
    st.rx = rx; st.ry = ry;
    st.pintouUmaVez = true;
    visor.classList.remove('carregando');
    canvas.style.transform = `translate(${st.x - st.rx}px, ${st.y - st.ry}px)`;
  }
  function sobrepor() {
    const r = visor.getBoundingClientRect();
    marcas.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    marcas.setAttribute('width', r.width); marcas.setAttribute('height', r.height);
    const px = (x, y) => [st.x + x * st.escala, st.y + y * st.escala];
    let s = '';
    for (const t of tags) {
      const [cx, cy] = px(t.x, t.y);
      if (cx < -30 || cy < -30 || cx > r.width + 30 || cy > r.height + 30) continue;
      const raio = Math.max(5, 11 * st.escala);
      s += `<circle cx="${cx}" cy="${cy}" r="${raio}" fill="none" stroke="${CORES[t.forma] || '#888'}" stroke-width="2"/>`;
      if (st.escala > 0.55) s += `<text x="${cx + raio + 3}" y="${cy + 4}" font-family="IBM Plex Mono, monospace" font-size="${Math.min(15, 11 * st.escala)}" fill="${CORES[t.forma] || '#888'}" stroke="#fff" stroke-width="3" paint-order="stroke">${t.numero}</text>`;
    }
    const caixaMarcada = (c, cor, rotulo) => {
      const [ax, ay] = px(c[0], c[1]); const [bx, by] = px(c[2], c[3]);
      let t = `<rect x="${ax - 4}" y="${ay - 4}" width="${Math.max(6, bx - ax + 8)}" height="${Math.max(6, by - ay + 8)}" fill="none" stroke="${cor}" stroke-width="2.5" stroke-dasharray="7 5"/>`;
      if (rotulo && st.escala > 0.2) t += `<text x="${ax - 4}" y="${ay - 10}" font-family="Plus Jakarta Sans, system-ui, sans-serif" font-size="13" fill="${cor}" stroke="#fff" stroke-width="3.5" paint-order="stroke">${rotulo}</text>`;
      return t;
    };
    if (leg) s += caixaMarcada(leg.bloco || leg.caixa, '#2f6baf', 'legenda');
    if (ponto) s += caixaMarcada(ponto, '#d13b2a', alvo.rotulo || '');
    marcas.innerHTML = s;
  }

  let arrastando = false, ox = 0, oy = 0;
  visor.addEventListener('pointerdown', e => { arrastando = true; ox = e.clientX - st.x; oy = e.clientY - st.y; visor.setPointerCapture(e.pointerId); });
  visor.addEventListener('pointermove', e => { if (!arrastando) return; st.x = e.clientX - ox; st.y = e.clientY - oy; canvas.style.transform = `translate(${st.x - st.rx}px, ${st.y - st.ry}px)`; sobrepor(); });
  visor.addEventListener('pointerup', e => { if (!arrastando) return; arrastando = false; visor.releasePointerCapture(e.pointerId); desenhar(); });
  visor.addEventListener('wheel', e => {
    if (!rodaLivre && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = visor.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nova = Math.min(6, Math.max(0.06, st.escala * k));
    st.x = mx - (mx - st.x) * (nova / st.escala); st.y = my - (my - st.y) * (nova / st.escala);
    st.escala = nova; desenhar();
  }, { passive: false });
  caixa.addEventListener('click', e => {
    const b = e.target.closest('[data-vis]');
    if (!b) return;
    const r = visor.getBoundingClientRect();
    if (b.dataset.vis === 'mais' || b.dataset.vis === 'menos') {
      const k = b.dataset.vis === 'mais' ? 1.3 : 1 / 1.3;
      const nova = Math.min(6, Math.max(0.06, st.escala * k));
      st.x = r.width / 2 - (r.width / 2 - st.x) * (nova / st.escala);
      st.y = r.height / 2 - (r.height / 2 - st.y) * (nova / st.escala);
      st.escala = nova; desenhar();
    } else if (b.dataset.vis === 'ajustar') ajustar();
    else if (b.dataset.vis === 'foco') irAoFoco();
    else if (b.dataset.vis === 'legenda') irALegenda();
  });
  const pronto = preparar();
  return {
    ajustar, irAoFoco, irALegenda,
    /** Enquadra uma caixa qualquer (usado pelos níveis de leitura). */
    async enquadrar(c, fator = 1.15, maxEscala = 6) {
      await pronto;
      if (!c) { ajustar(); return; }
      enquadrar(c, fator, maxEscala);
    },
  };
}
