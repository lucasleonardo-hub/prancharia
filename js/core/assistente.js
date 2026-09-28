/* O assistente do empreendimento — uma conversa presa ao que existe.

   A pessoa pergunta ("qual o piso da suíte do final 3?", "por que a cozinha
   não tem bancada?", "a planilha está errada, o BANHO 2 não é do apto 201")
   e a IA responde só com o que o Prancharia tem deste empreendimento:

     - o TEXTO de cada documento lido, indexado na hora do processamento
       (`indexarTexto`): as folhas das pranchas e as páginas dos memoriais;
     - o LEVANTAMENTO atual: locais com tipologia e pavimento, itens por
       categoria com a fonte de cada um, pendências;
     - o que está no DRIVE e ainda não foi lido (só a lista de nomes: a IA
       não lê o Drive sozinha — ela aponta o arquivo e a pessoa importa).

   Tudo isso vira um contexto de texto montado aqui e mandado numa chamada
   ao BFF (`/api/chat`). A resposta traz as fontes e, quando cabe, ações
   propostas — reler documentos, recruzar memoriais, importar um arquivo,
   abrir um local — que a tela oferece como botões. A IA propõe; a pessoa
   executa. Sem servidor o assistente não existe: é uma função da IA, como a
   leitura multimodal. */

import { IA, chamarBff, iaLigada } from './ia.js';
import { locaisDe, especificacoesDe, pendencias } from './exporter.js';
import { tipoDe, temAreasComuns } from './tipos.js';
import { nomeDisciplina } from './disciplina.js';
import { criarLocal, criarEspecificacao, criarEvidencia, normalizar, novoId, registrarHistorico } from './model.js';
import { NOMES_SISTEMAS, CATEGORIAS } from './vocab.js';

const LIMITE_TEXTO_MEMORIAL = 160000;   // caracteres por memorial
const LIMITE_TEXTO_PRANCHA = 40000;     // caracteres por prancha (rótulos, códigos, notas)
const LIMITE_LEVANTAMENTO = 200000;     // o levantamento não pode engolir o espaço do texto dos documentos
const LIMITE_CONTEXTO = 550000;

export const assistenteDisponivel = () => iaLigada();

/**
 * O texto de um documento aberto, página a página, para o índice do
 * assistente. DWG: os textos da folha (sem cotas); PDF: os itens de texto
 * da página. Cortado no limite do tipo.
 */
export async function indexarTexto(doc, tipo = 'prancha') {
  const limite = tipo === 'memorial' ? LIMITE_TEXTO_MEMORIAL : LIMITE_TEXTO_PRANCHA;
  const partes = [];
  let total = 0;
  for (let n = 1; n <= doc.numPages && total < limite; n++) {
    const page = await doc.getPage(n);
    let linhas;
    if (page.dwg) {
      linhas = page.textos.filter(t => !t.cota && t.str.trim().length > 1).map(t => t.str.trim());
    } else {
      const tc = await page.getTextContent();
      linhas = [];
      let atual = '';
      for (const it of tc.items) {
        if (!it.str) continue;
        atual += it.str;
        if (it.hasEOL) { linhas.push(atual.trim()); atual = ''; }
      }
      if (atual.trim()) linhas.push(atual.trim());
    }
    const rotulo = page.dwg ? `[folha ${n}: ${page.nome}]` : `[p.${n}]`;
    const texto = `${rotulo}\n${linhas.join('\n')}`;
    partes.push(texto);
    total += texto.length;
  }
  const s = partes.join('\n');
  return s.length > limite ? s.slice(0, limite) + '\n[… texto cortado …]' : s;
}

const fonteDe = (a) => {
  const ev = (a.evidencias || [])[0];
  const d = ev && ev.documentoOrigem;
  return d ? `{${d.nomeDoc || 'doc'}${d.pagina ? ' p.' + d.pagina : ''}}` : '';
};

/** O contexto inteiro do empreendimento, em texto. */
export function montarContexto(emp, { drive = [] } = {}) {
  const l = [];
  const t = tipoDe(emp);
  l.push(`EMPREENDIMENTO: ${emp.nome} — tipo ${t ? t.nome : emp.tipo || ''}${emp.localizacao ? ', ' + emp.localizacao : ''}${emp.responsavel ? ', responsável ' + emp.responsavel : ''}`);
  const est = emp.estrutura || {};
  if ((est.tipologia || []).length) l.push('Tipologias: ' + est.tipologia.map(x => x.nome).join(', '));
  if ((est.pavimento || []).length) l.push('Pavimentos: ' + est.pavimento.map(x => x.nome).join(', '));
  l.push(temAreasComuns(emp) ? 'Tem áreas comuns (Manual do Condomínio) e unidades (Manual do Proprietário).' : 'Só unidades privativas (Manual do Proprietário).');

  l.push('', '=== DOCUMENTOS LIDOS ===');
  for (const d of emp.documentos || []) {
    const partes = [
      d.tipo === 'memorial' ? 'memorial' : 'prancha',
      d.formato === 'dwg' ? 'DWG' : 'PDF',
      d.disciplina ? nomeDisciplina(d.disciplina) : '',
      d.lado === 'comum' ? 'áreas comuns' : d.lado === 'privativa' ? 'unidades' : '',
      d.folhas && d.folhas.length ? `${d.folhas.length} folhas: ${d.folhas.join(', ')}` : `${d.paginas || 1} página(s)`,
      d.foraDoEscopo ? 'FORA DO ESCOPO, não lido' : d.processadoEm ? 'lido' : 'ainda não lido',
      d.pasta ? 'pasta ' + d.pasta : '',
    ].filter(Boolean);
    l.push(`- ${d.nome} (${partes.join('; ')})`);
  }
  if (drive.length) {
    l.push('', '=== NO DRIVE, AINDA NÃO LIDOS ===');
    for (const f of drive) l.push(`- ${f.caminho || ''}${f.nome} (${f.disciplina ? nomeDisciplina(f.disciplina) : 'disciplina desconhecida'}${f.escopo === false ? ', fora do escopo' : ''})`);
  }

  l.push('', '=== LEVANTAMENTO ATUAL (locais e itens; {fonte} = documento e página) ===');
  const locais = locaisDe(emp).slice().sort((a, b) => (a.areaComum === b.areaComum ? 0 : a.areaComum ? 1 : -1) || (a.tipologia || '').localeCompare(b.tipologia || '') || a.nome.localeCompare(b.nome, 'pt-BR'));
  for (const loc of locais) {
    const cab = `${loc.nome} [${loc.areaComum ? 'área comum' : 'unidade'}${loc.tipologia ? ' · ' + loc.tipologia : ''}${loc.pavimento ? ' · ' + loc.pavimento : ''}] ${fonteDe(loc)}`;
    l.push('* ' + cab);
    for (const a of (loc.especificacoes || []).filter(x => x.status !== 'excluido')) {
      if (a.origemLeitura === 'obrigatoria') { l.push(`    - ${a.categoria}${a.produto ? ': ' + a.produto : ''} — SEM ESPECIFICAÇÃO NOS DOCUMENTOS (linha obrigatória vazia)`); continue; }
      const desc = [a.produto, a.descricao, a.marca ? 'marca ' + a.marca : '', a.dimensao ? a.dimensao : '', a.peitoril ? 'peitoril ' + a.peitoril : '', a.codigoOrigem ? 'código ' + a.codigoOrigem : ''].filter(Boolean).join(' — ');
      l.push(`    - ${a.categoria || 'sem categoria'}: ${desc} [${a.status}/${a.confianca}] ${fonteDe(a)}`);
    }
  }
  const soltas = (emp.especificacoesSemLocal || []).filter(x => x.status !== 'excluido');
  if (soltas.length) {
    l.push('* ITENS SEM LOCAL (fila de triagem):');
    for (const a of soltas.slice(0, 80)) l.push(`    - ${a.categoria || 'sem categoria'}: ${[a.produto, a.descricao, a.codigoOrigem].filter(Boolean).join(' — ')} ${fonteDe(a)}`);
  }
  const pend = pendencias(emp);
  l.push('', `=== PENDÊNCIAS: ${pend.length} item(ns) a revisar ===`);
  const porMotivo = {};
  for (const a of pend) for (const m of (a.motivos && a.motivos.length ? a.motivos : ['revisar'])) porMotivo[m] = (porMotivo[m] || 0) + 1;
  for (const [m, n] of Object.entries(porMotivo)) l.push(`- ${m}: ${n}`);

  /* o levantamento tem teto próprio: num empreendimento grande ele não pode
     deixar o texto dos documentos de fora sem ninguém saber */
  let cabeca = l.join('\n');
  const omitidos = [];
  if (cabeca.length > LIMITE_LEVANTAMENTO) { cabeca = cabeca.slice(0, LIMITE_LEVANTAMENTO) + '\n[… levantamento cortado por tamanho …]'; omitidos.push('parte do levantamento'); }
  const partes = [cabeca, '', '=== TEXTO DOS DOCUMENTOS ==='];
  let total = cabeca.length;
  const docs = (emp.documentos || []).filter(d => d.textoIndexado).sort((a, b) => (a.tipo === 'memorial' ? -1 : 1) - (b.tipo === 'memorial' ? -1 : 1));
  for (const d of docs) {
    const bloco = `--- ${d.nome} ---\n${d.textoIndexado}`;
    if (total + bloco.length > LIMITE_CONTEXTO) { partes.push(`--- ${d.nome} --- [texto omitido por tamanho]`); omitidos.push(d.nome); continue; }
    partes.push(bloco); total += bloco.length;
  }
  const texto = partes.join('\n');
  montarContexto.ultimosOmitidos = omitidos;
  return texto;
}
/** O que ficou de fora do último contexto montado (para a tela avisar). */
montarContexto.ultimosOmitidos = [];

/**
 * Pergunta ao assistente. `emp.assistente.mensagens` guarda a conversa.
 * Lança quando o servidor não responde; a tela mostra o erro.
 */
export async function perguntarAoAssistente(emp, pergunta, { drive = [] } = {}) {
  emp.assistente = emp.assistente || { mensagens: [] };
  const historico = emp.assistente.mensagens.slice(-10).map(m => ({ de: m.de, texto: m.texto }));
  const contexto = montarContexto(emp, { drive });
  const omitidos = montarContexto.ultimosOmitidos.slice();
  const r = await chamarBff(IA.rotaChat, { pergunta, historico, contexto }, IA.timeoutChatMs);
  const msg = {
    de: 'ia', texto: r.resposta || '', fontes: r.fontes || [], acoes: r.acoes || [],
    confianca: r.confianca || 'media', quando: new Date().toISOString(),
    contextoChars: contexto.length, modelo: r.modelo || '', omitidos,
  };
  return msg;
}

/* ------------------------------------------------------------------ */
/* O MAPEAMENTO INTEIRO PELA IA                                         */
/* ------------------------------------------------------------------ */

/* O servidor já devolve a categoria da planilha; o dicionário fica só para
   respostas antigas que ainda usem o nome curto. */
const CATEGORIA_PLANILHA = { 'Pedras naturais': 'Revestimentos em Pedras Naturais' };

/**
 * O inventário: só os nomes das tipologias e dos opcionais que as fontes
 * mostram (resposta curta). É o índice que guia o mapeamento das unidades.
 */
export async function inventarioComIA(emp, { drive = [] } = {}) {
  const contexto = montarContexto(emp, { drive });
  const r = await chamarBff(IA.rotaMapeamento, { escopo: 'inventario', contexto, sistemas: [] }, IA.timeoutMapeamentoMs);
  return { entradas: r.entradas || [], contextoChars: contexto.length, omitidos: montarContexto.ultimosOmitidos.slice() };
}

/**
 * Pede à IA o levantamento de um escopo ('comum' = áreas comuns; 'privativa'
 * = UMA tipologia ou UM opcional, dado em `filtro`) sobre o corpus inteiro.
 * Devolve as linhas saneadas pelo servidor (cada uma com documento e trecho).
 * `contexto` pode vir pronto, para as chamadas por tipologia não o remontarem.
 */
export async function mapearComIA(emp, escopo, { drive = [], filtro = null, contexto = null } = {}) {
  const ctx = contexto || montarContexto(emp, { drive });
  const r = await chamarBff(IA.rotaMapeamento, { escopo, contexto: ctx, sistemas: NOMES_SISTEMAS, filtro }, IA.timeoutMapeamentoMs);
  return { linhas: r.linhas || [], recusadas: r.recusadas || {}, contextoChars: ctx.length, omitidos: montarContexto.ultimosOmitidos.slice(), modelo: r.modelo || '' };
}

/** O nome que um opcional recebe como tipologia própria na estrutura. */
export const nomeDoOpcional = (opcional) => /^(OPCIONAL|PERSONALIZA)/i.test(opcional) ? opcional : `OPCIONAL - ${opcional}`;

/**
 * Registra tipologias e opcionais do inventário na estrutura. O opcional vira
 * uma tipologia própria (a unidade personalizada tem aba própria na
 * planilha, pela regra da Predialize) que sabe qual é a sua base: a
 * exportação monta a aba dele juntando a base com o que ele muda.
 */
export function incorporarInventario(emp, entradas) {
  emp.estrutura = emp.estrutura || { grupo: [], tipologia: [], unidade: [], pavimento: [] };
  emp.estrutura.tipologia = emp.estrutura.tipologia || [];
  let novas = 0;
  const acha = nome => emp.estrutura.tipologia.find(t => normalizar(t.nome) === normalizar(nome));
  for (const e of entradas) {
    const nome = e.tipo === 'opcional' ? nomeDoOpcional(e.nome) : e.nome;
    let t = acha(nome);
    if (!t) { t = { id: novoId('niv'), nome, descricao: e.descricao || '', origem: 'mapeamento_ia' }; emp.estrutura.tipologia.push(t); novas++; }
    if (e.tipo === 'opcional') { t.opcional = true; if (e.base) t.base = e.base; }
    if (!t.descricao && e.descricao) t.descricao = e.descricao;
    if (e.fonte) t.fonte = e.fonte;
  }
  return novas;
}

/**
 * Incorpora as linhas do mapeamento na árvore: local existente (mesmo nome,
 * mesma tipologia, mesmo lado) ou local novo; item novo, a revisar, com a
 * evidência apontando o documento, a página e o trecho. Nada substitui o
 * que a leitura vetorial já leu: linha igual a item existente é pulada.
 * Linha de opcional entra na tipologia própria do opcional, com a base
 * anotada na estrutura.
 */
export function incorporarMapeamento(emp, linhas, escopo) {
  emp.locais = emp.locais || [];
  emp.estrutura = emp.estrutura || { grupo: [], tipologia: [], unidade: [], pavimento: [] };
  emp.estrutura.tipologia = emp.estrutura.tipologia || [];
  const comum = escopo === 'comum';
  const docPorNome = new Map((emp.documentos || []).map(d => [normalizar(d.nome), d]));
  const achaDoc = nome => {
    const n = normalizar(nome);
    if (docPorNome.has(n)) return docPorNome.get(n);
    for (const [k, d] of docPorNome) if (k.includes(n) || n.includes(k.replace(/\.(pdf|dwg)$/, ''))) return d;
    return null;
  };
  const r = { itens: 0, locaisNovos: 0, tipologiasNovas: 0, repetidas: 0 };
  const vivo = x => x && x.status !== 'excluido';
  for (const li of linhas) {
    const tipologia = comum ? '' : (li.opcional ? nomeDoOpcional(li.opcional) : (li.tipologia || ''));
    if (tipologia) {
      let t = emp.estrutura.tipologia.find(x => normalizar(x.nome) === normalizar(tipologia));
      if (!t) { t = { id: novoId('niv'), nome: tipologia, descricao: '', origem: 'mapeamento_ia' }; emp.estrutura.tipologia.push(t); r.tipologiasNovas++; }
      if (li.opcional) { t.opcional = true; if (li.tipologia && !t.base) t.base = li.tipologia; }
    }
    let local = emp.locais.find(l => vivo(l) && normalizar(l.nome) === normalizar(li.local) && !!l.areaComum === comum && normalizar(l.tipologia || '') === normalizar(tipologia));
    if (!local) {
      local = criarLocal(li.local, '', '');
      local.origem = 'mapeamento_ia'; local.confianca = 'media'; local.status = 'revisar';
      local.areaComum = comum; local.tipologia = tipologia;
      const doc = achaDoc(li.documento);
      local.evidencias.push(criarEvidencia({
        documentoOrigem: { docId: doc ? doc.id : null, pagina: li.pagina || '', nomeDoc: li.documento },
        tipo: doc && doc.tipo === 'memorial' ? 'texto_memorial' : 'rotulo',
        texto: li.trecho, tituloLegenda: 'Mapeamento pela IA',
        cadeia: [li.local, `${li.documento}${li.pagina ? ' p.' + li.pagina : ''}`, 'local proposto pelo mapeamento da IA', comum ? 'área comum' : 'unidade' + (tipologia ? ' · ' + tipologia : '')],
        proveniencia: { motor_ia: 'multimodal_gemini', metodo: 'mapeamento_ia', confianca: 'media' },
      }));
      emp.locais.push(local);
      r.locaisNovos++;
    }
    local.especificacoes = local.especificacoes || [];
    const categoria = CATEGORIA_PLANILHA[li.categoria] || li.categoria;
    const repetida = local.especificacoes.some(a => vivo(a) && a.origemLeitura !== 'obrigatoria'
      && a.categoria === categoria && normalizar(a.produto) === normalizar(li.produto) && normalizar(a.descricao) === normalizar(li.descricao));
    if (repetida) { r.repetidas++; continue; }
    const doc = achaDoc(li.documento);
    const esp = criarEspecificacao({
      categoria: CATEGORIAS.includes(categoria) ? categoria : '',
      produto: li.produto, sistema: li.sistema || '', descricao: li.descricao || '',
      marca: li.marca || '', fornecedor: li.fornecedor || '', quantidade: li.quantidade || '',
      codigoOrigem: (li.categoria === 'Esquadrias' && /\b[A-Z]{1,3}\d{1,3}[A-Z]?\b/.test(li.produto)) ? (li.produto.match(/\b[A-Z]{1,3}\d{1,3}[A-Z]?\b/) || [''])[0] : '',
      origemLeitura: 'mapeamento_ia',
      confianca: li.confianca || 'baixa', status: 'revisar', motivos: ['mapeamento_ia'],
      localId: local.id, localNome: local.nome, pavimento: local.pavimento || '', tipologia,
    });
    esp.evidencias.push(criarEvidencia({
      documentoOrigem: { docId: doc ? doc.id : null, pagina: li.pagina || '', nomeDoc: li.documento },
      tipo: doc && doc.tipo === 'memorial' ? 'texto_memorial' : 'tabela',
      texto: li.trecho, tituloLegenda: 'Mapeamento pela IA',
      cadeia: [local.nome, `${li.documento}${li.pagina ? ' p.' + li.pagina : ''}`, li.trecho, `${categoria}: ${li.produto}${li.descricao ? ' — ' + li.descricao : ''}`],
      proveniencia: { motor_ia: 'multimodal_gemini', metodo: 'mapeamento_ia', confianca: li.confianca || 'baixa' },
    }));
    local.especificacoes.push(esp);
    r.itens++;
  }
  registrarHistorico(emp, { tipo: 'processamento', texto: `Mapeamento pela IA (${comum ? 'áreas comuns' : 'unidades'}): ${r.itens} item(ns) em ${r.locaisNovos} local(is) novo(s)${r.tipologiasNovas ? `, ${r.tipologiasNovas} tipologia(s) nova(s)` : ''}${r.repetidas ? `, ${r.repetidas} já existiam` : ''}` });
  return r;
}
