/* Configuração e transporte do motor de IA.

   A chave da API nunca chega ao navegador: quem fala com o modelo é o BFF em
   `/server`. Este módulo é o único lugar do frontend que conhece o endereço
   desse servidor, o tempo limite e o disjuntor — pranchas (engine.js) e
   memorial (memorial.js) passam os dois por aqui.

   Regra que vale para tudo o que sai daqui: uma falha da IA nunca aborta o
   processamento de um documento. O chamador recebe o erro e segue no motor
   vetorial. */

/* Em desenvolvimento (localhost, ou a página aberta direto do disco) o BFF é
   o processo local na porta 3000. Em produção — qualquer outro domínio, como
   o *.vercel.app do frontend — é a URL pública do backend hospedado.
   TROQUE A LINHA ABAIXO pela URL real do seu backend depois do deploy no
   Render/Railway, e publique o frontend de novo (git push ou `vercel --prod`). */
const BFF_PRODUCAO = 'https://prancharia-bff.onrender.com';

function bffPadrao() {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '' || h.endsWith('.local')) {
      return 'http://localhost:3000';
    }
  } catch { /* sem window: mantém o padrão local */ }
  return BFF_PRODUCAO;
}

/**
 *   provedor  'fallback_vetorial'  só a leitura vetorial (padrão)
 *             'multimodal_gemini'  chama o BFF e mescla com a vetorial
 */
export const IA = {
  provedor: 'fallback_vetorial',
  bff: bffPadrao(),
  rota: '/api/vision/process-local',
  rotaFolha: '/api/vision/process-sheet',
  rotaMemorial: '/api/text/process-memorial',
  timeoutMs: 60000,
  /* a leitura ampla devolve dezenas de linhas de uma vez: é a chamada mais
     demorada, e a mais rentável — um quadro de acabamentos traz o levantamento
     inteiro de uma prancha numa só ida */
  timeoutQuadroMs: 240000,
  /* o memorial vai inteiro numa chamada (ou em lotes, do lado do servidor):
     é uma espera só, e bem maior que a de um recorte */
  timeoutMemorialMs: 180000,
  /* depois de tantas falhas seguidas o motor para de tentar nesta sessão: uma
     prancha com 43 locais não pode esperar 43 timeouts. */
  maxFalhas: 3,
  /* com o multimodal ligado, também chama a IA nos locais SEM nenhuma tag —
     é onde vivem as hachuras que a leitura vetorial nunca viu. */
  lerLocaisSemTag: true,
  /* LEITURA AMPLA: a IA olha os quadros, as tabelas, as legendas e as notas da
     folha e devolve produtos com o local que a própria tabela declara. É o que
     resolve a prancha que não usa tag geométrica nenhuma. */
  lerQuadrosComIA: true,
  maxRegioesPorFolha: 6,
  paralelas: 3,
  falhasSeguidas: 0,
  chamadas: 0,
  ultimoErro: null,
  desligadoPorFalha: false,
};

const CHAVE_CONFIG = 'prancharia.ia';
const DURAVEIS = ['provedor', 'bff', 'rota', 'rotaFolha', 'rotaMemorial',
  'timeoutMs', 'timeoutQuadroMs', 'timeoutMemorialMs',
  'lerLocaisSemTag', 'lerQuadrosComIA', 'maxRegioesPorFolha', 'paralelas'];

try {
  const salvo = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || 'null');
  if (salvo && typeof salvo === 'object') Object.assign(IA, salvo);
} catch { /* sandbox sem localStorage, ou json inválido: fica no padrão */ }
try {
  if (typeof window !== 'undefined' && window.PRANCHARIA_IA) Object.assign(IA, window.PRANCHARIA_IA);
} catch { /* sem window */ }

/** Troca a configuração do motor e guarda o que é durável. */
export function configurarIA(cfg = {}) {
  Object.assign(IA, cfg);
  if (cfg.provedor) { IA.falhasSeguidas = 0; IA.desligadoPorFalha = false; IA.ultimoErro = null; }
  try {
    localStorage.setItem(CHAVE_CONFIG, JSON.stringify(Object.fromEntries(DURAVEIS.map(k => [k, IA[k]]))));
  } catch { /* sem localStorage: vale só para esta sessão */ }
  return IA;
}

export const iaLigada = () => IA.provedor === 'multimodal_gemini' && !IA.desligadoPorFalha;

export function comPrazo(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancelar: () => clearTimeout(t) };
}

/** Pergunta ao BFF se ele está no ar. Não lança: devolve null quando não está. */
export async function saudeDaIA() {
  const p = comPrazo(6000);
  try {
    const r = await fetch(IA.bff + '/api/health', { signal: p.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { p.cancelar(); }
}

/** Registra a falha e arma o disjuntor quando ela se repete. */
export function anotarFalha(err, contexto = 'leitura') {
  IA.falhasSeguidas++;
  IA.ultimoErro = { quando: new Date().toISOString(), mensagem: err.message || String(err) };
  console.warn(`[IA] ${contexto} falhou (${IA.falhasSeguidas}/${IA.maxFalhas}): ${IA.ultimoErro.mensagem}`
    + ' — seguindo com a leitura vetorial.');
  if (IA.falhasSeguidas >= IA.maxFalhas) {
    IA.desligadoPorFalha = true;
    console.warn('[IA] motor multimodal desligado nesta sessão depois de'
      + ` ${IA.falhasSeguidas} falhas seguidas. O processamento continua no motor vetorial.`);
  }
}

export function anotarSucesso() { IA.falhasSeguidas = 0; }

/**
 * Uma chamada ao BFF, com tempo limite. Lança em qualquer falha — quem chama
 * decide o que fazer, e a resposta certa é sempre seguir sem a IA.
 */
export async function chamarBff(rota, corpo, timeoutMs = IA.timeoutMs) {
  const prazo = comPrazo(timeoutMs);
  try {
    IA.chamadas++;
    const r = await fetch(IA.bff + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: prazo.signal,
      body: JSON.stringify(corpo),
    });
    const texto = await r.text();
    let dados;
    try { dados = JSON.parse(texto); } catch { throw new Error(`resposta não-JSON do BFF (${r.status})`); }
    if (!r.ok || dados.ok === false) throw new Error(dados.erro || `BFF respondeu ${r.status}`);
    return dados;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`tempo limite de ${timeoutMs} ms estourado`);
    throw err;
  } finally {
    prazo.cancelar();
  }
}
