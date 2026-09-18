/* Painel de evidências em três níveis.

   Um item raramente sai de um só ponto do desenho. Aqui ficam todas as
   origens que o sustentam — o rótulo do local, a tag, a linha da legenda, a
   hachura, o trecho do memorial — e cada uma se lê em três alturas:

     1. a prancha completa, que dá o contexto;
     2. a região do local, o recorte em volta;
     3. o zoom no ponto exato de onde o dado saiu.

   As miniaturas são os recortes de verdade, tirados da prancha original. O
   texto da legenda e a cadeia de interpretação continuam à vista, dividindo
   espaço com a imagem que prova a origem — e cada prova diz qual motor a
   leu. */

import { esc, marcaForma, seloConfianca, seloStatus, estado, irPara, emp } from '../app.js';
import { montarVisualizador, recortar } from './viewer.js';
import { MOTIVOS_PENDENCIA } from '../core/model.js';
import { provasDe, fluxo, PAPEIS, NIVEIS, niveisDe, ehMemorial, refDoc } from '../core/provas.js';

const ROTULO_MOTOR = {
  fallback_vetorial: 'leitura vetorial',
  multimodal_gemini: 'IA multimodal',
  legado_vetorial: 'leitura vetorial',
};
const nomeMotor = m => ROTULO_MOTOR[m] || m || '';

let ctx = null;   // { esp, provas, iProva, nivel, visor, chave }

export function fecharGaveta() {
  document.getElementById('gaveta')?.classList.remove('aberta');
  document.body.classList.remove('inspetor');
  document.querySelectorAll('#conteudo tr.selecionada').forEach(t => t.classList.remove('selecionada'));
  const v = document.getElementById('veu'); if (v) v.hidden = true;
  ctx = null;
}

/* A linha da tabela cuja evidência está aberta fica marcada: é o vínculo
   visível entre a tabela e o inspetor ao lado. */
function marcarLinha(id) {
  document.querySelectorAll('#conteudo tr.selecionada').forEach(t => t.classList.remove('selecionada'));
  const b = document.querySelector(`#conteudo [data-acao="verEvidencia"][data-id="${id}"]`);
  b?.closest('tr')?.classList.add('selecionada');
}

export function abrirGaveta(esp) {
  const e = emp();
  const g = document.getElementById('gaveta');
  const provas = provasDe(e, esp);
  const cadeia = fluxo(e, esp);
  ctx = { esp, provas, iProva: 0, nivel: 'regiao' };

  const legenda = provas.find(p => p.papel === 'legenda');
  const temMemorial = provas.some(p => p.papel === 'memorial');
  const temPrancha = provas.some(p => p.papel !== 'memorial');
  const motores = [...new Set((esp.evidencias || []).map(ev => (ev.proveniencia || {}).motor_ia).filter(Boolean))];

  g.innerHTML = `
    <header>
      <div style="min-width:0">
        <h2 style="font-size:14px" title="${esc(esp.descricao || esp.produto || '')}">${esc(esp.descricao || esp.produto || 'Item sem descrição')}</h2>
      </div>
      <button class="btn discreto pequeno" data-acao="fecharGaveta" style="margin-left:auto;flex:none" aria-label="Fechar"><i class="ico-fechar" aria-hidden="true"></i><kbd class="so-teclado">Esc</kbd></button>
    </header>
    <div class="corpo">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="selo neutro">${esc(esp.categoria || 'sem categoria')}</span>
        ${marcaForma(esp.forma, esp.numero)}
        ${seloConfianca(esp.confianca)} ${seloStatus(esp.status)}
        ${motores.map(m => `<span class="selo neutro" title="motor que leu esta evidência">${esc(nomeMotor(m))}</span>`).join('')}
        ${(esp.motivos || []).map(m => `<span class="selo atencao">${esc(MOTIVOS_PENDENCIA[m] || m)}</span>`).join('')}
      </div>

      ${esp.status === 'conflito' ? `<div class="aviso-faixa critico"><span class="ico-aviso" aria-hidden="true">!</span><div><b>Conflito documental.</b> Duas fontes descrevem este item de formas diferentes — nenhuma foi descartada.
        <div style="margin-top:6px">${(esp.divergencias || []).map(d => `<div>• ${esc(d.documento)} p.${esc(d.pagina)}: ${esc(d.descricao)}</div>`).join('')}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${(esp.divergencias || []).map((d, i) => `<button class="btn pequeno" data-acao="resolverConflito" data-id="${esp.id}" data-i="${i}" title="Manter o que diz ${esc(d.documento)}">Manter “${esc(d.documento.replace(/.pdf$/i, '').slice(0, 28))}${d.documento.length > 32 ? '…' : ''}”</button>`).join('')}
          <button class="btn pequeno" data-acao="resolverConflito" data-id="${esp.id}" data-i="-1">Manter a descrição atual</button>
        </div></div></div>` : ''}

      <section>
        <div class="cat" style="color:var(--ink-3);margin-bottom:8px">Resultado extraído</div>
        <div class="ficha-dados">
          ${dado('Produto', esp.produto)}
          ${dado('Sistema construtivo', esp.sistema)}
          ${dado('Material', esp.descricao)}
          ${dado('Marca', esp.marca)}
          ${dado('Modelo / linha', esp.modelo)}
          ${dado('Fornecedor', esp.fornecedor)}
        </div>
      </section>

      <section>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div class="cat" style="color:var(--ink-3)">Evidências (${provas.length})</div>
          <span style="margin-left:auto;font-size:11.5px;color:var(--ink-3)" data-fonte-recorte>recortes da prancha original</span>
        </div>
        ${provas.length ? `
        <div class="abas-prova" data-abas>
          ${provas.map((p, i) => `<button class="aba-prova${i === 0 ? ' ativa' : ''}" data-prova="${i}" style="--papel:${PAPEIS[p.papel].cor}">
            <span class="ponto-papel"></span><span>${esc(PAPEIS[p.papel].rotulo)}</span><em>${esc(p.titulo || '')}</em></button>`).join('')}
        </div>

        <div class="niveis-evidencia" data-niveis>
          ${NIVEIS.map(n => `<button class="nivel-cartao${n.id === 'regiao' ? ' ativo' : ''}" data-nivel="${n.id}">
            <span class="nivel-num">${n.ordem}</span>
            <canvas data-mini="${n.id}"></canvas>
            <b data-nivel-rotulo>${esc(n.rotulo)}</b>
          </button>`).join('')}
        </div>

        <div class="recorte vivo"><div data-visor-prova></div>
          <div class="legenda-recorte" data-rodape></div></div>
        <p class="nota-prova" data-nota></p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          <button class="btn pequeno primario" data-acao="verNaPrancha" data-id="${esp.id}" data-prova-foco="0">Ver na prancha</button>
          ${temPrancha ? '<button class="btn pequeno" data-ir-papel="tag">Evidência da prancha</button>' : ''}
          ${legenda ? '<button class="btn pequeno" data-ir-papel="legenda">Evidência da legenda</button>' : ''}
          ${temMemorial ? '<button class="btn pequeno" data-ir-papel="memorial">Evidência do memorial</button>' : ''}
        </div>` : '<p style="color:var(--ink-3);font-size:13px">Item criado manualmente — sem recorte de documento.</p>'}
      </section>

      ${legenda && legenda.itens ? `<section>
        <div class="cat" style="color:var(--ink-3);margin-bottom:8px">Legenda correspondente — ${esc(legenda.titulo)}</div>
        <ul class="lista-legenda">${legenda.itens.map(i => `<li class="${esp.numero === i.numero ? 'usada' : ''}"><span class="pilula">${esc(i.numero)}</span><span>${esc(i.descricao)}</span></li>`).join('')}</ul>
        <p class="nota-prova">A mesma numeração em outra forma geométrica significa outro material.</p>
      </section>` : ''}

      <section>
        <div class="cat" style="color:var(--ink-3);margin-bottom:8px">Cadeia da informação</div>
        <div class="cadeia">
          ${cadeia.map((el, i) => `<div class="elo">
            <div class="marcador"><span class="ponto"${el.papel ? ` style="background:${PAPEIS[el.papel].cor};border-color:${PAPEIS[el.papel].cor}"` : ''}></span>${i < cadeia.length - 1 ? '<span class="fio"></span>' : ''}</div>
            <div class="texto"><div class="rotulo">${esc(el.rotulo)}</div>${esc(el.valor)}</div>
          </div>`).join('')}
        </div>
        <button class="btn pequeno" style="margin-top:10px" data-acao="abrirRastro" data-id="${esp.id}">Rastreabilidade completa</button>
      </section>

      <section>
        <div class="cat" style="color:var(--ink-3);margin-bottom:6px">Origens (${(esp.evidencias || []).length})</div>
        <ul class="lista-limpa">${(esp.evidencias || []).map(ev => `<li><span class="pilula">p.${esc((ev.documentoOrigem || {}).pagina)}</span>
          <div>${esc((ev.documentoOrigem || {}).nomeDoc || '')}
          <div style="color:var(--ink-3);font-size:11.5px">${esc(nomeMotor((ev.proveniencia || {}).motor_ia))}${(ev.proveniencia || {}).metodo ? ' · ' + esc((ev.proveniencia || {}).metodo) : ''}</div></div></li>`).join('')}</ul>
      </section>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primario" data-acao="confirmarAchado" data-id="${esp.id}">Confirmar</button>
        <button class="btn" data-acao="editarAchado" data-id="${esp.id}">Editar</button>
        <button class="btn" data-acao="marcarRevisar" data-id="${esp.id}">Marcar para revisar</button>
        <button class="btn discreto" data-acao="excluirAchado" data-id="${esp.id}">Excluir</button>
      </div>
    </div>`;
  g.classList.add('aberta');
  document.body.classList.add('inspetor');
  marcarLinha(esp.id);
  const veu = document.getElementById('veu'); if (veu) veu.hidden = false;

  g.querySelectorAll('[data-prova]').forEach(b => b.addEventListener('click', () => selecionar(+b.dataset.prova)));
  g.querySelectorAll('[data-nivel]').forEach(b => b.addEventListener('click', () => nivelar(b.dataset.nivel)));
  g.querySelectorAll('[data-ir-papel]').forEach(b => b.addEventListener('click', () => {
    const i = ctx.provas.findIndex(p => p.papel === b.dataset.irPapel);
    if (i >= 0) { selecionar(i); g.querySelector('[data-abas]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }));
  pintar();
}

const dado = (rotulo, valor) => `<div><div class="rotulo">${esc(rotulo)}</div><div class="${valor ? '' : 'vazio-celula'}">${valor ? esc(valor) : ''}</div></div>`;

function selecionar(i) {
  if (!ctx) return;
  ctx.iProva = i;
  const g = document.getElementById('gaveta');
  g.querySelectorAll('[data-prova]').forEach(b => b.classList.toggle('ativa', +b.dataset.prova === i));
  g.querySelector('[data-prova-foco]')?.setAttribute('data-prova-foco', String(i));
  pintar();
}
function nivelar(n) {
  if (!ctx) return;
  ctx.nivel = n;
  const g = document.getElementById('gaveta');
  g.querySelectorAll('[data-nivel]').forEach(b => b.classList.toggle('ativo', b.dataset.nivel === n));
  enquadrar();
}

/* O recorte grande é um visor de verdade: arrasta para andar pelo desenho,
   roda do mouse para ampliar e "Centralizar" para voltar ao ponto. Os três
   níveis são enquadramentos — e as miniaturas mostram os três de uma vez. */
function pintar() {
  if (!ctx) return;
  const g = document.getElementById('gaveta');
  const cx = g.querySelector('[data-visor-prova]');
  const p = ctx.provas[ctx.iProva];
  if (!cx || !p) return;

  vocabulario(g, p);
  const chave = [p.documentoId, p.pagina, ctx.iProva].join('|');
  if (ctx.chave !== chave) {
    ctx.chave = chave;
    ctx.visor = montarVisualizador(cx, {
      documentoId: p.documentoId, pagina: p.pagina, tags: [],
      foco: {
        caixa: (p.realces && p.realces[0] && p.realces[0].caixa) || p.caixaZoom,
        rotulo: PAPEIS[p.papel].rotulo, papel: p.papel,
      },
      altura: 'min(46vh, 380px)', rodaLivre: true, compacto: true, autoFoco: false,
      enquadrarInicial: ctx.nivel === 'prancha' ? null : (ctx.nivel === 'zoom' ? p.caixaZoom : p.caixaRegiao),
    });
    if (ctx.nivel === 'prancha') ctx.visor.ajustar();
    miniaturas(g, p);
    rodape(g, p);
    return;
  }
  enquadrar();
  miniaturas(g, p);
  rodape(g, p);
}

/* A gaveta fala a língua da evidência ativa: recorte de prancha ou trecho
   do memorial. O que muda é só o vocabulário — o visor é o mesmo. */
function vocabulario(g, p) {
  const memorial = p.papel === 'memorial';
  const fonte = g.querySelector('[data-fonte-recorte]');
  if (fonte) fonte.textContent = memorial ? 'trecho do memorial descritivo' : 'recortes da prancha original';
  const ver = g.querySelector('[data-acao="verNaPrancha"]');
  if (ver) ver.textContent = memorial ? 'Ver no memorial' : 'Ver na prancha';
  const niveis = niveisDe(p.papel);
  g.querySelectorAll('[data-nivel]').forEach(b => {
    const n = niveis.find(x => x.id === b.dataset.nivel);
    const r = b.querySelector('[data-nivel-rotulo]');
    if (n && r) r.textContent = n.rotulo;
  });
}

function enquadrar() {
  if (!ctx || !ctx.visor) return;
  const p = ctx.provas[ctx.iProva];
  if (ctx.nivel === 'prancha') ctx.visor.ajustar();
  else if (ctx.nivel === 'regiao') ctx.visor.enquadrar(p.caixaRegiao, 1.15);
  else ctx.visor.enquadrar(p.caixaZoom, 1.05);
  rodape(document.getElementById('gaveta'), p);
}

/** Os três níveis desenhados de uma vez, como escada visual. */
function miniaturas(g, p) {
  const comuns = { documentoId: p.documentoId, pagina: p.pagina };
  const mapa = {
    prancha: { caixa: null, reforcar: true },
    regiao: { caixa: p.caixaRegiao, reforcar: false },
    zoom: { caixa: p.caixaZoom, reforcar: false },
  };
  for (const n of NIVEIS) {
    const cv = g.querySelector(`[data-mini="${n.id}"]`);
    if (!cv) continue;
    recortar(cv, {
      ...comuns, caixa: mapa[n.id].caixa,
      realces: (p.realces || []).map(r => ({ ...r, tracejado: n.id !== 'zoom' })),
      reforcar: mapa[n.id].reforcar, larguraAlvo: 260,
    });
  }
}

function rodape(g, p) {
  const rod = g.querySelector('[data-rodape]');
  const niveis = niveisDe(p.papel);
  const nivel = niveis.find(n => n.id === ctx.nivel) || niveis[1];
  if (rod) rod.innerHTML = `<b>${nivel.ordem}. ${esc(nivel.rotulo)}</b> · ${esc(p.documento || '')} · página ${esc(p.pagina || '—')}`
    + ` · <b>${esc(PAPEIS[p.papel].rotulo)}</b>${p.titulo ? ' · ' + esc(p.titulo) : ''}`
    + `${p.motor ? ` · <span style="color:var(--ink-3)">${esc(nomeMotor(p.motor))}${p.metodo ? ' / ' + esc(p.metodo) : ''}</span>` : ''}`;
  const nota = g.querySelector('[data-nota]');
  if (nota) nota.textContent = p.nota || PAPEIS[p.papel].desc;
}

export function irVerNaPrancha(esp, iProva) {
  const e = emp();
  const provas = provasDe(e, esp);
  const p = provas[Number(iProva) || 0] || provas.find(x => x.papel !== 'memorial') || provas[0];
  if (!p || !p.documentoId) return;
  const leg = provas.find(x => x.papel === 'legenda');
  estado.filtros.foco = {
    documentoId: p.documentoId, pagina: p.pagina,
    // abre o visor já na região do Nível 2, com o ponto exato destacado
    caixa: (p.realces && p.realces[0] && p.realces[0].caixa) || p.caixaZoom,
    regiao: p.caixaRegiao,
    papel: p.papel, rotulo: p.titulo, achadoId: esp.id,
    legenda: leg ? { caixa: leg.realces[0].caixa, bloco: leg.caixaRegiao, titulo: leg.titulo, descricao: esp.descricao, documentoId: leg.documentoId, pagina: leg.pagina } : null,
  };
  fecharGaveta();
  irPara('documentos', p.documentoId);
}

/* O Local também pode ser aberto na prancha por si só: o visor abre na região
   do Nível 2 gravada na evidência do rótulo, com o rótulo destacado. */
export function irVerNaPranchaLocal(local) {
  /* a evidência com posição ganha; senão, a de prancha (abre a folha inteira);
     o memorial só quando não há mais nada */
  const evs = local.evidencias || [];
  const ev = evs.find(x => x.coordenadas)
    || evs.find(x => x.documentoOrigem && x.documentoOrigem.docId && !ehMemorial(x))
    || evs[0];
  if (!ev || !ev.documentoOrigem || !ev.documentoOrigem.docId) return;
  estado.filtros.foco = {
    documentoId: ev.documentoOrigem.docId, pagina: ev.documentoOrigem.pagina,
    caixa: ev.coordenadas || ev.regiao,
    regiao: ev.regiao || null,
    papel: 'local', rotulo: local.nome, achadoId: local.id, legenda: null,
  };
  fecharGaveta();
  irPara('documentos', ev.documentoOrigem.docId);
}

export { refDoc };
