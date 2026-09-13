/* Leitura de memorial descritivo em PDF.

   O memorial é texto corrido: o que se extrai daqui é o que está escrito,
   frase por frase, com a página e o trecho de origem guardados. Quando o
   memorial nomeia marca, linha ou modelo, esse dado entra como uma fonte a
   mais — nunca substitui em silêncio o que a prancha disse. */

import { readText } from './pdfdoc.js';
import { IA, iaLigada, chamarBff, anotarFalha, anotarSucesso } from './ia.js';
import {
  novoId, normalizar, mesmoAmbienteFlex as mesmoAmbiente,
  criarEspecificacao, criarEvidencia,
} from './model.js';
import { especificacoesDe } from './exporter.js';
import { classificar } from './glossario.js';

const ROTULOS = [
  { p: /^(piso|pisos|revestimento de piso|pavimenta[çc][ãa]o)\b/i, cat: 'Piso' },
  { p: /^(rodap[ée]s?)\b/i, cat: 'Piso' },
  { p: /^(parede|paredes|revestimento de parede|revestimentos? de paredes?)\b/i, cat: 'Paredes' },
  { p: /^(pintura|pinturas|textura)\b/i, cat: 'Paredes' },
  { p: /^(teto|tetos|forro|forros)\b/i, cat: 'Teto' },
  { p: /^(bancadas?|tampos?)\b/i, cat: 'Bancadas' },
  { p: /^(soleiras?|peitoris?|pingadeiras?|pedras?\s+naturais?)\b/i, cat: 'Revestimentos em Pedras Naturais' },
  { p: /^(esquadrias?|portas?|janelas?|portais?|marcos?)\b/i, cat: 'Esquadrias' },
  { p: /^(lou[çc]as?|bacia|cuba)\b/i, cat: 'Louças' },
  { p: /^(metais|metal|torneiras?|registros?|sif[õo]es?)\b/i, cat: 'Metais' },
  { p: /^(lumin[áa]rias?|ilumina[çc][ãa]o)\b/i, cat: 'Luminárias' },
  { p: /^(marcenaria|mobili[áa]rio|armários?)\b/i, cat: 'Mobiliário' },
];

const CAMPOS = [
  { chave: 'marca', p: /\b(?:marca|fabricante)\s*[:\-–]\s*([^;\n]{2,48})/i },
  { chave: 'fornecedor', p: /\bfornecedor\s*[:\-–]\s*([^;\n]{2,60})/i },
  { chave: 'modelo', p: /\b(?:modelo|refer[êe]ncia|ref\.?)\s*[:\-–]\s*([^;\n]{2,48})/i },
  { chave: 'linha', p: /\blinha\s*[:\-–]\s*([^;\n]{2,48})/i },
];

/* Quando o próprio rótulo do memorial já nomeia o produto, ele vale mais que
   o termo achado no meio da frase. */
const PRODUTO_POR_ROTULO = {
  bancada: 'Bancada', bancadas: 'Bancada', tampo: 'Bancada',
  soleira: 'Soleira', soleiras: 'Soleira', peitoril: 'Peitoril', peitoris: 'Peitoril',
  pingadeira: 'Pingadeira', rodape: 'Rodapé', rodapes: 'Rodapé',
  cuba: 'Cuba', bacia: 'Bacia sanitária', forro: 'Forro de gesso', forros: 'Forro de gesso',
  pintura: 'Pintura', textura: 'Textura', rejunte: 'Rejunte',
};

/** Um PDF sem desenho e com muito texto é um memorial, não uma prancha. */
export function pareceMemorial({ tracos, caracteres, paginas }) {
  if (!caracteres) return false;
  const porPagina = caracteres / Math.max(1, paginas);
  return tracos < 1500 && porPagina > 900;
}

/** Reconstrói linhas e parágrafos de uma página de texto corrido. */
export async function lerPagina(page) {
  const itens = (await readText(page)).filter(t => t.horizontal);
  itens.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const linhas = [];
  for (const it of itens) {
    const ult = linhas[linhas.length - 1];
    if (ult && Math.abs(it.y - ult.y) < 3.2) {
      ult.partes.push(it);
      ult.x1 = Math.max(ult.x1, it.x + it.w);
      ult.x0 = Math.min(ult.x0, it.x);
    } else {
      linhas.push({ y: it.y, x0: it.x, x1: it.x + it.w, h: it.h, partes: [it] });
    }
  }
  return linhas.map(l => ({
    texto: l.partes.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
    caixa: [l.x0, l.y - l.h - 1, l.x1, l.y + 3],
    y: l.y, altura: l.h,
  })).filter(l => l.texto);
}

/**
 * Extrai itens de um memorial.
 * ambientesConhecidos: os ambientes já lidos das pranchas — servem de âncora
 * para saber a que local cada trecho se refere.
 */
export async function analisarMemorial(doc, docMeta, ambientesConhecidos, aoProgredir = () => {}) {
  const especificacoes = [];
  const secoes = [];
  for (let p = 1; p <= doc.numPages; p++) {
    aoProgredir(`memorial — página ${p} de ${doc.numPages}`, (p - 1) / doc.numPages);
    const page = await doc.getPage(p);
    const linhas = await lerPagina(page);
    const corpos = linhas.map(l => l.altura).sort((a, b) => a - b);
    const corpo = corpos[Math.floor(corpos.length / 2)] || 10;
    let ambienteAtual = null;

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const t = l.texto;
      if (t.length < 3) continue;

      // 1) o trecho nomeia um ambiente conhecido?
      const amb = acharAmbiente(t, ambientesConhecidos, l.altura, corpo);
      if (amb) { ambienteAtual = amb; secoes.push({ pagina: p, ambiente: amb.nome, y: l.y }); }

      // 2) o trecho descreve um acabamento?
      const item = lerItem(t);
      if (!item) continue;

      const alvo = ambienteAtual || acharAmbienteNaFrase(t, ambientesConhecidos);
      const trecho = [linhas[i - 1]?.texto, t, linhas[i + 1]?.texto].filter(Boolean).join(' ');
      const campos = {};
      for (const c of CAMPOS) { const m = c.p.exec(t); if (m) campos[c.chave] = limpar(m[1]); }
      const descricaoLimpa = item.descricao
        .replace(/\b(?:marca|fabricante|fornecedor)\s*[:\-–]\s*[^;.]*\.?$/i, '')
        .replace(/[;,\s.]+$/, '').trim();
      const classe = classificar(descricaoLimpa, item.categoria);

      const esp = criarEspecificacao({
        categoria: classe?.categoria || item.categoria || '',
        produto: PRODUTO_POR_ROTULO[normalizar(item.rotulo)] || classe?.produto || '',
        sistema: classe?.sistema || '',
        descricao: descricaoLimpa || item.descricao,
        modelo: campos.modelo || campos.linha || '',
        marca: campos.marca || '',
        fornecedor: campos.fornecedor || '',
        origemLeitura: 'memorial',
        confianca: alvo ? (campos.marca ? 'alta' : 'media') : 'baixa',
        status: alvo ? 'identificado' : 'revisar',
        motivos: alvo ? [] : ['incompleto'],
        localId: alvo ? alvo.id : null,
        localNome: alvo ? alvo.nome : '',
        pavimento: alvo ? (alvo.pavimento || '') : '',
        tipologia: alvo ? (alvo.tipologia || '') : '',
      });
      esp.evidencias.push(criarEvidencia({
        documentoOrigem: { docId: docMeta.id, pagina: p, nomeDoc: docMeta.nome },
        tipo: 'texto_memorial',
        coordenadas: l.caixa,
        regiao: [l.caixa[0] - 8, l.caixa[1] - 26, l.caixa[2] + 8, l.caixa[3] + 26],
        tituloLegenda: 'Memorial descritivo',
        texto: trecho.slice(0, 400),
        cadeia: [
          alvo ? alvo.nome : 'local não identificado',
          'Memorial descritivo — página ' + p,
          item.rotulo || 'trecho descritivo',
          descricaoLimpa || item.descricao,
          classe?.categoria || item.categoria || 'categoria não mapeada',
        ],
        proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'memorial_texto', confianca: alvo ? (campos.marca ? 'alta' : 'media') : 'baixa' },
      }));
      especificacoes.push(esp);
    }
  }
  return { especificacoes, secoes };
}

function limpar(s) {
  // corta no próximo rótulo do tipo "Paredes:" para não colar duas frases
  return (s || '')
    .split(/\s+[A-ZÀ-Ý][A-Za-zà-ÿ]{2,}\s*:/)[0]
    .replace(/["“”']/g, '').replace(/\s+/g, ' ').replace(/[,;.]+$/, '').trim();
}

function acharAmbiente(texto, ambientes, altura, corpo) {
  const t = texto.replace(/[:–—-]\s*$/, '').trim();
  if (t.length > 46) return null;
  const destaque = altura > corpo * 1.06 || t === t.toUpperCase() || /[:–—-]\s*$/.test(texto);
  if (!destaque) return null;
  for (const a of ambientes) if (mesmoAmbiente(a.nome, t)) return a;
  return null;
}

function acharAmbienteNaFrase(texto, ambientes) {
  const n = normalizar(texto);
  let melhor = null;
  for (const a of ambientes) {
    const na = normalizar(a.nome);
    if (na.length >= 4 && n.includes(na) && (!melhor || na.length > normalizar(melhor.nome).length)) melhor = a;
  }
  return melhor;
}

function lerItem(texto) {
  const limpo = texto.replace(/^[-•–●\s]+/, '').trim();
  if (limpo.length < 8) return null;
  const sep = limpo.match(/^([^:]{3,42}):\s*(.+)$/);
  if (sep) {
    const rotulo = sep[1].trim();
    for (const r of ROTULOS) if (r.p.test(rotulo)) return { categoria: r.cat, rotulo, descricao: sep[2].trim() };
    return null;
  }
  for (const r of ROTULOS) {
    if (!r.p.test(limpo)) continue;
    if (limpo.length < 18 || limpo.length > 320) return null;
    return { categoria: r.cat, rotulo: limpo.split(/\s+/).slice(0, 2).join(' '), descricao: limpo };
  }
  return null;
}

/* ================================================================== */
/* FUSÃO SEMÂNTICA                                                     */
/*                                                                     */
/* A prancha diz "Piso 01" e a legenda traduz para "PORCELANATO A       */
/* DEFINIR". O memorial escreve, dez páginas depois, "Piso: porcelanato */
/* Flakes SBE NAT 120x120, marca Ceusa". É o mesmo produto, e nenhuma   */
/* substring liga os dois: só o sentido liga.                          */
/*                                                                     */
/* Por isso a heurística de `cruzarComPranchas` continua existindo como */
/* rede — ela acerta quando as palavras coincidem — mas quem faz o      */
/* casamento de verdade é a IA, pelo BFF, e cada atualização só é       */
/* aceita com o trecho literal do memorial em mãos: sem prova, não      */
/* entra.                                                              */
/* ================================================================== */

/** O texto do memorial, página por página, com as linhas para achar a caixa. */
export async function textoDoMemorial(doc, aoProgredir = () => {}) {
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    aoProgredir(`memorial — lendo página ${p} de ${doc.numPages}`, (p - 1) / doc.numPages);
    const linhas = await lerPagina(await doc.getPage(p));
    paginas.push({ pagina: p, texto: linhas.map(l => l.texto).join('\n'), linhas });
  }
  return paginas;
}

/** O que o BFF precisa saber da árvore: só o que ajuda a casar. */
function resumoDaArvore(emp) {
  const vivo = x => x && x.status !== 'excluido';
  return (emp.locais || []).filter(vivo).map(l => ({
    id: l.id, nome: l.nome, pavimento: l.pavimento || '',
    especificacoes: (l.especificacoes || []).filter(vivo)
      /* item que já veio do próprio memorial não entra: casá-lo consigo mesmo
         não acrescenta nada */
      .filter(e => e.origemLeitura !== 'memorial')
      .map(e => ({
        id: e.id, categoria: e.categoria || '', produto: e.produto || '',
        sistema: e.sistema || '', descricao: e.descricao || '',
        codigoOrigem: e.codigoOrigem || '', marca: e.marca || '',
        modelo: e.modelo || '', fornecedor: e.fornecedor || '',
      })),
  })).filter(l => l.especificacoes.length);
}

/* Acha onde o trecho está na página, para a evidência ter as coordenadas dos
   três níveis. Sem isto, o "Ver na prancha" do memorial não teria para onde
   ir. Casa por normalização: o modelo copia o texto, mas os espaços variam. */
function caixaDoTrecho(linhas, trecho) {
  if (!linhas || !linhas.length || !trecho) return null;
  const alvo = normalizar(trecho);
  if (alvo.length < 8) return null;
  const casadas = [];
  for (const l of linhas) {
    const n = normalizar(l.texto);
    if (n.length < 6) continue;
    if (alvo.includes(n) || n.includes(alvo.slice(0, Math.min(60, alvo.length)))) casadas.push(l);
  }
  if (!casadas.length) return null;
  const c = casadas.map(l => l.caixa);
  return [
    Math.min(...c.map(x => x[0])), Math.min(...c.map(x => x[1])),
    Math.max(...c.map(x => x[2])), Math.max(...c.map(x => x[3])),
  ];
}

const porId = (emp) => {
  const m = new Map();
  for (const l of (emp.locais || [])) for (const e of (l.especificacoes || [])) m.set(e.id, { esp: e, local: l });
  for (const e of (emp.especificacoesSemLocal || [])) m.set(e.id, { esp: e, local: null });
  return m;
};

const CAMPOS_ENRIQUECIVEIS = ['produto', 'sistema', 'marca', 'modelo', 'fornecedor'];

/**
 * Aplica as atualizações que a IA devolveu.
 *
 * Regra de ouro: toda alteração ganha uma Evidência nova do tipo
 * `texto_memorial`, apontando a página e o trecho exato que a sustenta, com
 * proveniência `{ motor_ia: 'multimodal_gemini', metodo: 'fusao_semantica' }`.
 * A prancha nunca é sobrescrita: campo já preenchido fica como está, e
 * material diferente vira conflito em vez de correção.
 */
export function aplicarFusao(emp, atualizacoes, docMeta, paginas = []) {
  const mapa = porId(emp);
  const linhasPor = new Map(paginas.map(p => [p.pagina, p.linhas || []]));
  const r = { enriquecidas: 0, campos: 0, conflitos: 0, ignoradas: 0, marcas: 0 };

  for (const a of atualizacoes) {
    const alvo = mapa.get(a.especificacaoId);
    if (!alvo || !a.trecho) { r.ignoradas++; continue; }
    const esp = alvo.esp;
    const caixa = caixaDoTrecho(linhasPor.get(a.pagina), a.trecho);

    const ev = criarEvidencia({
      documentoOrigem: { docId: docMeta.id, pagina: a.pagina, nomeDoc: docMeta.nome },
      tipo: 'texto_memorial',
      coordenadas: caixa,
      regiao: caixa ? [caixa[0] - 10, caixa[1] - 34, caixa[2] + 10, caixa[3] + 34] : null,
      tituloLegenda: 'Memorial descritivo',
      texto: a.trecho,
      cadeia: [
        alvo.local ? alvo.local.nome : (esp.localNome || 'local não identificado'),
        `Memorial descritivo — página ${a.pagina}`,
        a.justificativa || 'casamento semântico',
        a.trecho,
        esp.categoria || 'categoria não mapeada',
      ].filter(Boolean),
      proveniencia: { motor_ia: 'multimodal_gemini', metodo: 'fusao_semantica', confianca: a.confianca || 'media' },
    });

    if (a.acao === 'conflito') {
      esp.status = 'conflito';
      esp.divergencias = esp.divergencias || [];
      esp.divergencias.push({
        documento: docMeta.nome, pagina: a.pagina,
        descricao: a.conflitoMemorial || a.trecho,
      });
      if (!(esp.motivos || []).includes('conflito')) (esp.motivos = esp.motivos || []).push('conflito');
      ev.texto = a.trecho;
      ev.cadeia = [ev.cadeia[0], `Memorial descritivo — página ${a.pagina}`,
        `A prancha diz "${a.conflitoPrancha || esp.descricao || '—'}"`,
        `O memorial diz "${a.conflitoMemorial || a.trecho}"`,
        'conflito documental — nenhuma fonte foi descartada'];
      esp.evidencias.push(ev);
      r.conflitos++;
      continue;
    }

    // enriquecimento: só o que estava vazio
    let mudou = 0;
    for (const campo of CAMPOS_ENRIQUECIVEIS) {
      if (!esp[campo] && a[campo]) { esp[campo] = a[campo]; mudou++; if (campo === 'marca') r.marcas++; }
    }
    if (!esp.descricao && a.descricaoMemorial) { esp.descricao = a.descricaoMemorial; mudou++; }
    if (!mudou) { r.ignoradas++; continue; }

    esp.evidencias.push(ev);
    if (esp.confianca === 'baixa' && a.confianca === 'alta') esp.confianca = 'media';
    if (esp.status === 'revisar' && a.confianca === 'alta' && esp.marca) esp.status = 'identificado';
    r.enriquecidas++; r.campos += mudou;
  }
  return r;
}

/**
 * A fusão inteira: lê o texto, pergunta ao BFF, aplica. Devolve o relatório e
 * o motor que efetivamente trabalhou.
 *
 * Se a IA estiver desligada, falhar ou estourar o tempo, cai na heurística de
 * `cruzarComPranchas` — o processamento do memorial nunca é abortado.
 */
export async function fundirComMemorial(emp, doc, docMeta, especsMemorial = [], aoProgredir = () => {}) {
  if (!iaLigada()) {
    return { motor: 'fallback_vetorial', ...cruzarComPranchas(emp, especsMemorial), atualizacoes: 0 };
  }
  const locais = resumoDaArvore(emp);
  if (!locais.length) {
    return { motor: 'fallback_vetorial', ...cruzarComPranchas(emp, especsMemorial), atualizacoes: 0,
      aviso: 'não havia especificação de prancha para casar' };
  }
  try {
    aoProgredir('memorial — casamento semântico com as pranchas', 0.75);
    const paginas = await textoDoMemorial(doc, aoProgredir);
    const corpo = {
      documento: docMeta.nome || '',
      paginas: paginas.map(p => ({ pagina: p.pagina, texto: p.texto })),
      locais,
    };
    const resposta = await chamarBff(IA.rotaMemorial, corpo, IA.timeoutMemorialMs);
    anotarSucesso();
    const atualizacoes = Array.isArray(resposta.atualizacoes) ? resposta.atualizacoes : [];
    const r = aplicarFusao(emp, atualizacoes, docMeta, paginas);
    return { motor: 'multimodal_gemini', ...r, atualizacoes: atualizacoes.length,
      lotes: resposta.lotes || 1, recusadas: resposta.recusadas || null };
  } catch (err) {
    anotarFalha(err, 'fusão semântica do memorial');
    return { motor: 'fallback_vetorial', ...cruzarComPranchas(emp, especsMemorial), atualizacoes: 0,
      erro: err.message || String(err) };
  }
}

/**
 * A rede: cruzamento por heurística de texto. Preenche marca e modelo onde
 * estavam vazios e marca conflito onde as duas fontes divergem. É o que roda
 * quando a fusão semântica não está disponível.
 */
export function cruzarComPranchas(emp, especsMemorial) {
  const relatorio = { marcas: 0, conflitos: 0 };
  const daPrancha = especificacoesDe(emp).filter(a => a.origemLeitura !== 'memorial');
  for (const m of especsMemorial) {
    if (!m.localId || (!m.marca && !m.modelo)) continue;
    const ev = (m.evidencias || [])[0] || {};
    const doc = (ev.documentoOrigem || {});
    const tokens = new Set(normalizar(m.descricao).split(' ').filter(w => w.length > 4));
    for (const a of daPrancha) {
      if (a === m) continue;
      if (a.localId !== m.localId || a.categoria !== m.categoria) continue;
      const na = normalizar(a.descricao);
      const comuns = [...tokens].filter(t => na.includes(t)).length;
      const mesmoProduto = m.produto && a.produto === m.produto;
      if (!mesmoProduto && comuns < 2) continue;
      if (m.marca) {
        if (!a.marca) {
          a.marca = m.marca; relatorio.marcas++;
          /* a marca entra como uma evidência a mais: quem preencheu o campo
             fica escrito, com a página do memorial */
          a.evidencias.push(criarEvidencia({
            documentoOrigem: { docId: doc.docId, pagina: doc.pagina, nomeDoc: doc.nomeDoc },
            tipo: 'texto_memorial',
            coordenadas: ev.coordenadas || null, regiao: ev.regiao || null,
            tituloLegenda: 'Memorial descritivo',
            texto: `Marca informada no memorial: ${m.marca}`,
            cadeia: [a.localNome, 'Memorial descritivo — página ' + doc.pagina, 'Marca', m.marca],
            proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'cruzamento_memorial', confianca: 'alta' },
          }));
        } else if (normalizar(a.marca) !== normalizar(m.marca)) {
          a.status = 'conflito';
          a.divergencias.push({ documento: doc.nomeDoc || '', pagina: doc.pagina, descricao: `Marca ${m.marca} (prancha indica ${a.marca})` });
          if (!a.motivos.includes('conflito')) a.motivos.push('conflito');
          relatorio.conflitos++;
        }
      }
      if (m.modelo && !a.modelo) a.modelo = m.modelo;
      if (m.fornecedor && !a.fornecedor) a.fornecedor = m.fornecedor;
    }
  }
  return relatorio;
}
