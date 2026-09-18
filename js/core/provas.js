/* Provas: as evidências visuais de uma Especificação e a cadeia completa da
   informação.

   Um item de acabamento quase nunca sai de um só ponto da prancha. Ele sai do
   rótulo do local, da tag desenhada dentro dele, da linha da legenda que
   traduz aquela forma e aquele número e, quando existe, do trecho do memorial
   que nomeia a marca. Aqui essas origens são reunidas — cada uma com o seu
   recorte em três níveis, o seu papel e a sua proveniência.

   Este é o único módulo que conhece a forma da Evidência. Quem precisa do
   documento, da página ou de uma caixa pede aqui. */

import { FORMAS } from './shapes.js';

export const PAPEIS = {
  local: { rotulo: 'Local', cor: '#2e7350', desc: 'Rótulo do local lido na planta.' },
  tag: { rotulo: 'Tag na planta', cor: '#d13b2a', desc: 'Forma geométrica e número desenhados dentro do local.' },
  legenda: { rotulo: 'Legenda', cor: '#2f6baf', desc: 'Linha da legenda que traduz aquela forma e número.' },
  tabela: { rotulo: 'Tabela da prancha', cor: '#b4671a', desc: 'Linha da tabela desenhada na prancha.' },
  hachura: { rotulo: 'Hachura', cor: '#7a5cc0', desc: 'Padrão gráfico da área, casado com a amostra da legenda.' },
  memorial: { rotulo: 'Memorial descritivo', cor: '#8c3e96', desc: 'Trecho do memorial que descreve o item.' },
};

export const NIVEIS = [
  { id: 'prancha', ordem: 1, rotulo: 'Prancha completa', desc: 'A folha inteira, com a região marcada.' },
  { id: 'regiao', ordem: 2, rotulo: 'Região do local', desc: 'O entorno do ponto de leitura.' },
  { id: 'zoom', ordem: 3, rotulo: 'Zoom da evidência', desc: 'O ponto exato de onde o dado saiu.' },
];

/* O memorial não tem "prancha": quando a evidência ativa é um trecho de
   texto, os três níveis são a página, o parágrafo e a frase. */
export const NIVEIS_MEMORIAL = [
  { id: 'prancha', ordem: 1, rotulo: 'Página inteira', desc: 'A página do memorial, com o trecho marcado.' },
  { id: 'regiao', ordem: 2, rotulo: 'Parágrafo', desc: 'O parágrafo em volta do trecho.' },
  { id: 'zoom', ordem: 3, rotulo: 'Trecho', desc: 'A frase exata de onde o dado saiu.' },
];
export const niveisDe = papel => (papel === 'memorial' ? NIVEIS_MEMORIAL : NIVEIS);

/* ---------- leitura da Evidência ---------- */

export const docDe = ev => (ev && ev.documentoOrigem) || {};
export const nomeDoc = ev => docDe(ev).nomeDoc || '';
export const paginaDoc = ev => { const p = docDe(ev).pagina; return p === undefined || p === null ? '' : p; };
export const idDoc = ev => docDe(ev).docId || '';
export function refDoc(ev) {
  const n = nomeDoc(ev), p = paginaDoc(ev);
  if (!n) return '';
  return p === '' ? n : `${n} p.${p}`;
}
export const refsDe = alvo => [...new Set((alvo.evidencias || []).map(refDoc).filter(Boolean))].join(' · ');
export const motorDe = ev => ((ev && ev.proveniencia) || {}).motor_ia || '';
export const metodoDe = ev => ((ev && ev.proveniencia) || {}).metodo || '';

export const ehMemorial = ev => !!ev && (ev.tipo === 'texto_memorial' || /memorial/i.test(ev.tituloLegenda || '') || /memorial/i.test(nomeDoc(ev)));

const dilatar = (c, fx, fy) => {
  if (!c || c.length !== 4) return null;
  const w = c[2] - c[0], h = c[3] - c[1];
  const dx = Math.max(24, w * fx), dy = Math.max(18, h * fy);
  return [c[0] - dx, c[1] - dy, c[2] + dx, c[3] + dy];
};

function papelDaEvidencia(ev) {
  if (ev.tipo === 'rotulo') return 'local';
  if (ehMemorial(ev)) return 'memorial';
  if (ev.tipo === 'hachura') return 'hachura';
  if (ev.tipo === 'tabela' || ev.tabelaCoordenadas) return 'tabela';
  return 'tag';
}

/**
 * Todas as evidências de uma especificação, cada uma com os três níveis de
 * leitura: a prancha inteira, a região em volta e o zoom no ponto exato.
 * `caixaZoom` e `caixaRegiao` vêm do que o motor gravou; a dilatação só
 * entra quando a evidência não trouxe a região.
 */
export function provasDe(emp, esp) {
  const provas = [];
  const visto = new Set();
  const push = (p) => {
    const k = [p.papel, p.documentoId, p.pagina, (p.caixaZoom || []).join(',')].join('|');
    if (visto.has(k)) return;
    visto.add(k); p.id = 'pv' + provas.length; provas.push(p);
  };

  // 1) o local, lido do próprio rótulo na planta
  const local = (emp.locais || []).find(l => l.id === esp.localId) || null;
  if (local) {
    const evs = local.evidencias || [];
    const ev = evs.find(x => (esp.evidencias || []).some(y => idDoc(y) === idDoc(x))) || evs[0];
    if (ev && ev.coordenadas) {
      /* o local nomeado pelo memorial tem como rótulo o título de seção do
         memorial — é um trecho de texto, não um rótulo de planta */
      const papelLocal = ehMemorial(ev) ? 'memorial' : 'local';
      push({
        papel: papelLocal, titulo: local.nome,
        documentoId: idDoc(ev), documento: nomeDoc(ev), pagina: paginaDoc(ev),
        caixaZoom: dilatar(ev.coordenadas, 0.5, 1.6),
        caixaRegiao: ev.regiao || dilatar(ev.coordenadas, 5, 6),
        realces: [{ caixa: ev.coordenadas, cor: PAPEIS[papelLocal].cor }],
        texto: ev.texto || local.nome,
        nota: papelLocal === 'memorial' ? 'Título de seção do memorial que nomeou este local.'
          : (local.area ? `Área lida na planta: ${local.area}` : ''),
        motor: motorDe(ev), metodo: metodoDe(ev),
      });
    }
  }

  for (const ev of (esp.evidencias || [])) {
    if (!idDoc(ev)) continue;
    const papel = papelDaEvidencia(ev);
    const alvo = ev.coordenadas || ev.regiao;
    const titulo = papel === 'memorial' ? `Página ${paginaDoc(ev)}`
      : papel === 'tabela' ? (ev.tituloLegenda || 'Tabela')
      : esp.forma ? `${FORMAS[esp.forma]?.rotulo || esp.forma} ${esp.numero}`
      : (esp.codigoOrigem || 'Ponto de leitura');
    push({
      papel, titulo,
      documentoId: idDoc(ev), documento: nomeDoc(ev), pagina: paginaDoc(ev),
      caixaZoom: alvo,
      caixaRegiao: ev.regiao || ev.tabelaCoordenadas
        || dilatar(alvo, papel === 'memorial' ? 0.15 : 7, papel === 'memorial' ? 1.2 : 8),
      realces: [{ caixa: alvo, cor: PAPEIS[papel].cor }],
      texto: ev.texto || '',
      nota: ev.segundoLocal
        ? `Local mais próximo pela geometria. Segundo colocado: ${ev.segundoLocal}${ev.folga ? ` (folga ${ev.folga}×)` : ''}.`
        : (ev.termoLegenda ? `Termo escrito na legenda: “${ev.termoLegenda}”.` : ''),
      motor: motorDe(ev), metodo: metodoDe(ev),
    });

    // a linha da legenda usada para traduzir a tag
    if (ev.legendaCoordenadas) {
      push({
        papel: 'legenda', titulo: ev.tituloLegenda || 'Legenda',
        documentoId: idDoc(ev), documento: nomeDoc(ev), pagina: paginaDoc(ev),
        caixaZoom: dilatar(ev.legendaCoordenadas, 0.08, 1.1),
        caixaRegiao: ev.legendaBloco || dilatar(ev.legendaCoordenadas, 1.2, 7),
        realces: [{ caixa: ev.legendaCoordenadas, cor: PAPEIS.legenda.cor }],
        texto: esp.descricao || '',
        itens: ev.legendaItens || null,
        nota: esp.forma ? 'A mesma numeração em outra forma significa outro material.' : '',
        motor: motorDe(ev), metodo: metodoDe(ev),
      });
    }
  }
  return provas;
}

/** A pergunta que cada campo responde — é o que sustenta a rastreabilidade. */
export function rastreio(emp, esp) {
  const evs = (esp.evidencias || []).filter(Boolean);
  const pranchas = evs.filter(ev => !ehMemorial(ev));
  const memoriais = evs.filter(ehMemorial);
  const local = (emp.locais || []).find(l => l.id === esp.localId) || null;
  const legenda = evs.find(ev => ev.legendaCoordenadas);
  const motores = [...new Set(evs.map(motorDe).filter(Boolean))];
  const linhas = [
    ['O que foi encontrado', esp.descricao],
    ['Produto', esp.produto],
    ['Sistema construtivo', esp.sistema],
    ['Categoria', esp.categoria],
    ['Local', local ? local.nome + (local.pavimento ? ` · ${local.pavimento}` : '') : esp.localNome],
    ['Documento', [...new Set(evs.map(nomeDoc))].filter(Boolean).join(' · ')],
    ['Página', [...new Set(evs.map(ev => 'p. ' + paginaDoc(ev)))].join(' · ')],
    ['Tag', esp.forma ? `${FORMAS[esp.forma]?.rotulo || esp.forma} ${esp.numero}` : ''],
    ['Forma', esp.forma ? (FORMAS[esp.forma]?.rotulo || esp.forma) : ''],
    ['Número', esp.numero || esp.codigoOrigem || ''],
    ['Legenda', legenda ? (legenda.tituloLegenda || '') : ''],
    ['Material', esp.descricao],
    ['Marca', esp.marca],
    ['Fornecedor', esp.fornecedor],
    ['Modelo / linha', esp.modelo],
    ['Motor que leu', motores.join(' · ')],
    ['Houve cruzamento com outro documento?',
      evs.length > 1
        ? `Sim — ${evs.length} evidências${memoriais.length && pranchas.length ? ' (prancha e memorial)' : ''}.`
        : 'Não — fonte única.'],
  ];
  return linhas.map(([pergunta, resposta]) => ({ pergunta, resposta: (resposta || '').toString().trim() }));
}

/** A cadeia vertical, do que a planilha mostra até a origem de cada dado. */
export function fluxo(emp, esp) {
  const evs = (esp.evidencias || []).filter(Boolean);
  const prancha = evs.find(ev => !ehMemorial(ev) && ev.tipo !== 'rotulo');
  const memorial = evs.find(ehMemorial);
  const local = (emp.locais || []).find(l => l.id === esp.localId) || null;
  const legenda = evs.find(ev => ev.legendaCoordenadas);
  const elos = [
    { rotulo: 'Planilha', valor: 'Linha exportada em ' + (esp.categoria || 'sem categoria'), papel: null },
    { rotulo: 'Produto', valor: esp.produto || esp.descricao, papel: null },
    { rotulo: 'Local', valor: local ? local.nome : esp.localNome, papel: 'local' },
    { rotulo: 'Prancha', valor: prancha ? refDoc(prancha) : '', papel: 'tag' },
    { rotulo: 'Tag', valor: esp.forma ? `${FORMAS[esp.forma]?.rotulo || esp.forma} ${esp.numero}` : (esp.codigoOrigem || ''), papel: 'tag' },
    { rotulo: 'Legenda', valor: legenda ? (legenda.tituloLegenda || '') : '', papel: 'legenda' },
    { rotulo: 'Material', valor: esp.descricao, papel: 'legenda' },
    { rotulo: 'Memorial', valor: memorial ? refDoc(memorial) : '', papel: 'memorial' },
    { rotulo: 'Marca', valor: esp.marca, papel: memorial ? 'memorial' : null },
  ];
  return elos.filter(e => e.valor);
}
