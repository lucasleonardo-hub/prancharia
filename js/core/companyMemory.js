/* A memória técnica da construtora.

   Uma construtora tem vícios de projeto que a prancha nunca declara: chama
   varanda de terraço, especifica sempre a mesma linha de porcelanato, compra
   de uma lista curta de fornecedores. Esse conhecimento hoje mora na cabeça de
   quem já fez dez manuais para ela, e se perde a cada troca de pessoa. Este
   módulo é onde ele passa a morar.

   TRÊS COISAS, COM TRÊS ALCANCES DIFERENTES:

     regrasIa                 texto livre que vai para o System Instruction do
                              Gemini. Alcance: a leitura de imagem e a fusão.
     vocabulario              de → para de nomes de local. Alcance: o nome dos
                              locais, na leitura e na conferência.
     fornecedoresHomologados  marcas e quem as entrega. Alcance: reconhecer e
                              grafar corretamente a marca que o documento cita.

   A TRAVA QUE VALE PARA OS TRÊS: nada aqui preenche campo que o documento
   deixou vazio. A empresa comprar só Portobello não autoriza o sistema a
   escrever Portobello onde a prancha não diz marca. A regra E0 do prompt diz
   isso ao modelo; `sugerirMarca` abaixo diz o mesmo ao código, devolvendo
   sugestão — algo que a pessoa confirma — e nunca um valor aplicado sozinho.

   O ESTADO VIVE AQUI, e uma empresa só está ativa por vez. `storage.js` cuida
   de mandar o id em toda chamada; este módulo cuida do que fazer com ele. */

import * as store from './storage.js';
import { normalizar } from './model.js';

let ativa = null;           // a empresa carregada, inteira
let lista = [];             // o cabeçalho de todas, para os seletores
const ouvintes = new Set();

/** Avisa a UI. `views.js` se inscreve uma vez e re-renderiza. */
export function aoMudar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function avisar() { for (const f of ouvintes) { try { f(ativa); } catch { /* um ouvinte quebrado não derruba os outros */ } } }

export const empresaAtiva = () => ativa;
export const empresas = () => lista;
export const temEmpresas = () => lista.length > 0;
/* Fora da nuvem não há memória de empresa: a tela diz isso em vez de mostrar
   uma lista vazia sem explicação. */
export const disponivel = () => store.naNuvem();

export function empresaVazia(nome = '') {
  return { nome, regrasIa: '', fornecedoresHomologados: [], vocabulario: [] };
}

/* ------------------------------------------------------------------ */
/* carga                                                               */
/* ------------------------------------------------------------------ */

/** Lê a lista e reativa a empresa que estava ativa na sessão anterior. */
export async function iniciarEmpresas() {
  if (!disponivel()) { lista = []; ativa = null; return { lista, ativa }; }
  try { lista = await store.listarEmpresas(); }
  catch (e) { console.warn('[empresa] não consegui listar:', e.message); lista = []; }
  const guardada = store.empresaAtiva();
  if (guardada && lista.some(e => e.id === guardada)) await ativar(guardada, { silencioso: true });
  else if (guardada) store.definirEmpresaAtiva(null);
  return { lista, ativa };
}

/**
 * Troca a empresa ativa. Recarrega o glossário no escopo novo — é o que faz
 * "TABICA" ser classificada do jeito da Alfa quando a Alfa está ativa, e do
 * jeito global quando ninguém está.
 */
export async function ativar(id, { silencioso = false } = {}) {
  if (!disponivel()) return null;
  store.definirEmpresaAtiva(id || null);
  ativa = id ? await store.lerEmpresa(id).catch(() => null) : null;
  if (id && !ativa) store.definirEmpresaAtiva(null);     // id órfão não fica pendurado
  if (!silencioso) avisar();
  return ativa;
}

export async function recarregar() {
  if (!disponivel()) return null;
  store.invalidarCache('empresa');
  lista = await store.listarEmpresas().catch(() => lista);
  if (ativa) ativa = await store.lerEmpresa(ativa.id).catch(() => ativa);
  avisar();
  return ativa;
}

/** Cria ou atualiza. Só os campos enviados mudam, do lado do servidor também. */
export async function salvar(dados) {
  if (!disponivel()) throw new Error('as empresas só existem com o servidor ligado');
  const salva = await store.salvarEmpresa(dados);
  lista = await store.listarEmpresas().catch(() => lista);
  if (salva && ativa && salva.id === ativa.id) ativa = salva;
  avisar();
  return salva;
}

export async function apagar(id) {
  if (!disponivel()) throw new Error('as empresas só existem com o servidor ligado');
  await store.apagarEmpresa(id);
  if (ativa && ativa.id === id) await ativar(null, { silencioso: true });
  lista = await store.listarEmpresas().catch(() => lista);
  avisar();
  return true;
}

/* ------------------------------------------------------------------ */
/* vocabulário: o nome que a casa usa                                  */
/* ------------------------------------------------------------------ */

/**
 * O nome do local na língua da empresa. "Varanda" vira "Terraço" quando a
 * empresa ativa diz que sim. Sem empresa, ou sem termo cadastrado, devolve o
 * que entrou — esta função nunca inventa nome.
 */
export function nomeDaCasa(nome) {
  const n = normalizar(nome);
  if (!n || !ativa) return nome;
  for (const v of (ativa.vocabulario || [])) {
    if (v && v.de && v.para && normalizar(v.de) === n) return v.para;
  }
  return nome;
}

/** Todos os apelidos de um local segundo a empresa — serve à busca. */
export function apelidosDe(nome) {
  const n = normalizar(nome);
  const fora = new Set();
  if (!n || !ativa) return [];
  for (const v of (ativa.vocabulario || [])) {
    if (!v || !v.de || !v.para) continue;
    if (normalizar(v.de) === n) fora.add(v.para);
    if (normalizar(v.para) === n) fora.add(v.de);
  }
  return [...fora];
}

/* ------------------------------------------------------------------ */
/* fornecedores: reconhecer, não atribuir                              */
/* ------------------------------------------------------------------ */

/**
 * A marca homologada que aparece DENTRO desta descrição.
 *
 * Repare no que a função NÃO faz: ela não devolve a marca preferida da empresa
 * quando a descrição não cita marca nenhuma. Só devolve quando o texto do
 * documento realmente contém o nome — e aí o valor dela é padronizar a grafia
 * ("PORTOBELO", "portobello" → "Portobello") e trazer junto o fornecedor.
 */
export function marcaHomologadaEm(descricao, categoria = '') {
  if (!ativa || !descricao) return null;
  const n = normalizar(descricao);
  let melhor = null;
  for (const f of (ativa.fornecedoresHomologados || [])) {
    const marca = f && f.marca;
    if (!marca) continue;
    const m = normalizar(marca);
    if (!m || m.length < 3) continue;
    /* limite de palavra: "CRT" não pode casar dentro de "CONCRETO" */
    if (!new RegExp(`(^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(n)) continue;
    if (f.categoria && categoria && normalizar(f.categoria) !== normalizar(categoria)) continue;
    /* o nome mais longo ganha: "Portobello Shop" vence "Portobello" */
    if (!melhor || m.length > normalizar(melhor.marca).length) melhor = f;
  }
  return melhor ? { marca: melhor.marca, fornecedor: melhor.fornecedor || '', origem: 'homologado pela empresa' } : null;
}

/**
 * Sugestão para a fila de revisão — nunca aplicada sozinha. Devolve o que a
 * pessoa veria e confirmaria: "a descrição cita Portobello; a empresa
 * homologa essa marca com a Cerâmica Sul como fornecedora".
 */
export function sugerirMarca(esp) {
  if (!esp || !ativa) return null;
  if (esp.marca) return null;                       // já tem: não se mexe
  const achada = marcaHomologadaEm(esp.descricao || '', esp.categoria || '');
  if (!achada) return null;
  return {
    campo: achada.fornecedor && !esp.fornecedor ? 'marca+fornecedor' : 'marca',
    marca: achada.marca,
    fornecedor: esp.fornecedor ? '' : (achada.fornecedor || ''),
    porque: `"${achada.marca}" aparece na descrição e está homologada em ${ativa.nome}`
      + (achada.fornecedor ? `, fornecida por ${achada.fornecedor}.` : '.'),
  };
}

/** As marcas homologadas, para o autocompletar das telas de marca. */
export function marcasHomologadas() {
  if (!ativa) return [];
  return (ativa.fornecedoresHomologados || [])
    .map(f => f && f.marca).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/* ------------------------------------------------------------------ */
/* resumo para a interface                                             */
/* ------------------------------------------------------------------ */

export function resumo() {
  if (!disponivel()) return { disponivel: false, motivo: 'servidor desligado' };
  if (!ativa) return { disponivel: true, ativa: null, empresas: lista.length };
  return {
    disponivel: true,
    ativa: { id: ativa.id, nome: ativa.nome },
    empresas: lista.length,
    regras: (ativa.regrasIa || '').trim().length,
    fornecedores: (ativa.fornecedoresHomologados || []).length,
    termos: (ativa.vocabulario || []).length,
  };
}
