/* Cadeia de provedores de IA multimodal: Gemini -> Groq -> OpenAI.

   O motor híbrido do frontend e as rotas deste servidor não sabem qual
   provedor respondeu — só que ALGUÉM respondeu. Quando o primeiro da
   cadeia estoura cota, cai a chave, ou dá qualquer erro, o próximo assume
   a MESMA instrução de sistema e o MESMO par de imagens, e o frontend
   nunca percebe a troca: ele recebe de volta o mesmo formato de sempre.

   Gemini fala com o SDK oficial e usa Structured Output nativo
   (responseSchema) — é o mais confiável dos três para não fugir do
   contrato. Groq e OpenAI falam a mesma API (Chat Completions) e nem todo
   modelo deles garante um schema JSON estrito, então os dois pedem um
   OBJETO (response_format: json_object) com a lista dentro de uma chave
   nomeada — e essa chave já é uma das formas que prompt.js/sanear() aceita
   (ver `especificacoes` / `atualizacoes` / `itens`), então nada mais no
   sistema precisa saber que a resposta não veio do Gemini. */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const GROQ_KEY = (process.env.GROQ_API_KEY || '').trim();
/* Groq roda modelos de visão em rotação trimestral — se este id parar de
   existir, troque só a env var GROQ_MODEL, sem mexer em código. Confira em
   runtime com `curl https://api.groq.com/openai/v1/models` e filtre por
   "input_modalities" contendo "image" (os Llama Vision antigos já foram
   descontinuados; em set/2026 quem tem imagem é a família Qwen). */
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const PROVEDORES_CONFIGURADOS = {
  gemini: !!GEMINI_KEY, groq: !!GROQ_KEY, openai: !!OPENAI_KEY,
};

/* ------------------------------------------------------------------ */
/* utilidades comuns                                                   */
/* ------------------------------------------------------------------ */

function comPrazo(limiteMs) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), limiteMs);
  return { signal: c.signal, cancelar: () => clearTimeout(t) };
}

function comoTimeout(err, limiteMs) {
  const estourou = err.name === 'AbortError' || /abort/i.test(err.message || '');
  return estourou ? new Error(`tempo limite de ${limiteMs} ms estourado`) : err;
}

/** Extrai o primeiro JSON válido do texto — objeto ou array, tolerando lixo
    em volta (cerca de código, frase de abertura do modelo, truncamento). */
function lerJsonSolto(cru) {
  try { return JSON.parse(cru); } catch { /* segue para o resgate */ }
  const cortes = [[cru.indexOf('['), cru.lastIndexOf(']')], [cru.indexOf('{'), cru.lastIndexOf('}')]]
    .filter(([i, j]) => i >= 0 && j > i)
    .sort((a, b) => a[0] - b[0]);
  for (const [i, j] of cortes) {
    try { return JSON.parse(cru.slice(i, j + 1)); } catch { /* tenta o próximo corte */ }
  }
  throw new Error('resposta do modelo não é JSON');
}

/** O array de itens, venha ele solto ou embrulhado num objeto — mesma regra
    de tolerância que prompt.js já aplica no lado do saneamento. */
function extrairArray(obj, chaveEnvoltoria) {
  if (Array.isArray(obj)) return obj;
  if (obj && Array.isArray(obj[chaveEnvoltoria])) return obj[chaveEnvoltoria];
  // o modelo às vezes usa outra chave óbvia — não custa tentar antes de desistir
  for (const k of ['especificacoes', 'atualizacoes', 'itens', 'items', 'resultado', 'result']) {
    if (obj && Array.isArray(obj[k])) return obj[k];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* GEMINI                                                              */
/* ------------------------------------------------------------------ */

let genAI = null;
const modelosGemini = new Map();

function modeloGemini(chaveCache, instrucaoSistema, schema, maxOutputTokens) {
  if (modelosGemini.has(chaveCache)) return modelosGemini.get(chaveCache);
  genAI = genAI || new GoogleGenerativeAI(GEMINI_KEY);
  const m = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: instrucaoSistema,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      /* leitura de documento técnico não é tarefa criativa: temperatura baixa
         reduz invenção, que é exatamente o que R2/M7/Q6 proíbem. */
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens,
    },
  });
  modelosGemini.set(chaveCache, m);
  return m;
}

async function comGemini({ instrucaoSistema, schema, partes, limiteMs, chaveCache, maxOutputTokens }) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY ausente');
  const modelo = modeloGemini(chaveCache, instrucaoSistema, schema, maxOutputTokens);
  const { signal, cancelar } = comPrazo(limiteMs);
  try {
    const r = await modelo.generateContent({ contents: [{ role: 'user', parts: partes }] }, { signal });
    const bruto = lerJsonSolto(r.response.text());
    const tokens = (r.response.usageMetadata || {}).totalTokenCount || 0;
    return { bruto, tokens, modelo: GEMINI_MODEL };
  } catch (err) {
    throw comoTimeout(err, limiteMs);
  } finally { cancelar(); }
}

/* ------------------------------------------------------------------ */
/* GROQ e OPENAI — mesma API (Chat Completions)                        */
/* ------------------------------------------------------------------ */

let clienteGroq = null;
let clienteOpenAI = null;

const groq = () => (clienteGroq ||= new OpenAI({ apiKey: GROQ_KEY, baseURL: 'https://api.groq.com/openai/v1' }));
const openai = () => (clienteOpenAI ||= new OpenAI({ apiKey: OPENAI_KEY }));

/** Converte as partes no formato do Gemini ({text} / {inlineData}) para o
    formato de conteúdo multimodal da Chat Completions API. */
function paraConteudoChat(partes) {
  const content = [];
  for (const p of partes) {
    if (p.text) content.push({ type: 'text', text: p.text });
    else if (p.inlineData) {
      content.push({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
    }
  }
  return content;
}

async function comChatCompletions({ nome, cliente, modelo, chave, instrucaoSistema, chaveEnvoltoria, partes, limiteMs, maxOutputTokens }) {
  if (!chave) throw new Error(`${nome} sem chave configurada`);
  const envoltura = `\n\nIMPORTANTE SOBRE O FORMATO DA RESPOSTA: devolva um OBJETO JSON com uma única chave "${chaveEnvoltoria}", cujo valor é o array pedido — nunca um array solto na raiz. Exemplo: {"${chaveEnvoltoria}": [...]}.`;
  const { signal, cancelar } = comPrazo(limiteMs);
  try {
    const r = await cliente.chat.completions.create({
      model: modelo,
      messages: [
        { role: 'system', content: instrucaoSistema + envoltura },
        { role: 'user', content: paraConteudoChat(partes) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: maxOutputTokens,
    }, { signal });
    const texto = r.choices?.[0]?.message?.content || '';
    const bruto = extrairArray(lerJsonSolto(texto), chaveEnvoltoria);
    const tokens = (r.usage || {}).total_tokens || 0;
    return { bruto, tokens, modelo };
  } catch (err) {
    throw comoTimeout(err, limiteMs);
  } finally { cancelar(); }
}

/* ------------------------------------------------------------------ */
/* A CADEIA                                                             */
/* ------------------------------------------------------------------ */

/**
 * Gera o JSON pedido tentando cada provedor configurado, na ordem
 * Gemini -> Groq -> OpenAI. Para no primeiro que responder; só cai pro
 * próximo em erro (cota, rede, tempo limite, chave ausente/inválida).
 *
 * @param {object} p
 * @param {object} p.schema           SCHEMA do modo — só o Gemini usa (Structured Output nativo)
 * @param {string} p.chaveEnvoltoria  'especificacoes' | 'atualizacoes' | 'itens'
 * @param {string} p.instrucaoSistema INSTRUCAO do modo, já com o bloco da empresa
 * @param {Array}  p.partes           partes no formato Gemini: [{text}|{inlineData:{mimeType,data}}]
 * @param {number} p.limiteMs         tempo limite POR TENTATIVA (cada provedor da cadeia tem o seu)
 * @param {string} p.chaveCache       chave de cache do modelo Gemini (modo + assinatura de empresa)
 * @param {number} p.maxOutputTokens
 * @returns {Promise<{ bruto: any, tokens: number, modelo: string, provedor: 'gemini'|'groq'|'openai' }>}
 */
export async function gerarComCadeia(p) {
  const erros = [];
  let tentativas = 0;

  if (GEMINI_KEY) {
    tentativas++;
    try { return { ...(await comGemini(p)), provedor: 'gemini' }; }
    catch (err) { erros.push(`gemini: ${err.message}`); }
  }
  if (GROQ_KEY) {
    tentativas++;
    try {
      return {
        ...(await comChatCompletions({ ...p, nome: 'groq', cliente: groq(), modelo: GROQ_MODEL, chave: GROQ_KEY })),
        provedor: 'groq',
      };
    } catch (err) { erros.push(`groq: ${err.message}`); }
  }
  if (OPENAI_KEY) {
    tentativas++;
    try {
      return {
        ...(await comChatCompletions({ ...p, nome: 'openai', cliente: openai(), modelo: OPENAI_MODEL, chave: OPENAI_KEY })),
        provedor: 'openai',
      };
    } catch (err) { erros.push(`openai: ${err.message}`); }
  }

  if (!tentativas) throw new Error('nenhum provedor de IA configurado (defina GEMINI_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)');
  throw new Error(`todos os provedores da cadeia falharam — ${erros.join(' | ')}`);
}
