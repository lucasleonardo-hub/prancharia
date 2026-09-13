/* Auditoria Manual × Planilha.
   Compara o que a planilha afirma com o que o manual diz, e devolve as
   divergências — sem decidir por ninguém qual dos dois está certo. */

import { normalizar, mesmoAmbienteFlex as mesmoAmbiente } from './model.js';
import { openPdf } from './pdfdoc.js';

/* ---------- leitura de planilha ---------- */

async function inflarRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const s = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Lê um .xlsx sem biblioteca: descompacta as partes e lê o XML. */
export async function lerXlsx(buf) {
  const u = new Uint8Array(buf); const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1;
  for (let i = u.length - 22; i >= 0 && i > u.length - 66000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido.');
  const nEnt = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const partes = {};
  const dec = new TextDecoder();
  for (let i = 0; i < nEnt; i++) {
    const nLen = dv.getUint16(p + 28, true), eLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
    const nome = dec.decode(u.subarray(p + 46, p + 46 + nLen));
    const lo = dv.getUint32(p + 42, true);
    const metodo = dv.getUint16(lo + 8, true);
    const lnLen = dv.getUint16(lo + 26, true), leLen = dv.getUint16(lo + 28, true);
    const ini = lo + 30 + lnLen + leLen;
    const tam = dv.getUint32(p + 20, true);
    partes[nome] = { metodo, dados: u.subarray(ini, ini + tam) };
    p += 46 + nLen + eLen + cLen;
  }
  const texto = async (n) => {
    const e = partes[n]; if (!e) return '';
    return dec.decode(e.metodo === 8 ? await inflarRaw(e.dados) : e.dados);
  };
  const compart = [];
  const ss = await texto('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    compart.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => desescapar(x[1])).join(''));
  }
  const wb = await texto('xl/workbook.xml');
  const nomes = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map(m => desescapar(m[1]));
  const abas = [];
  for (let i = 0; i < Math.max(1, nomes.length); i++) {
    const xml = await texto(`xl/worksheets/sheet${i + 1}.xml`);
    if (!xml) continue;
    abas.push({ nome: nomes[i] || `Planilha${i + 1}`, linhas: linhasDeXml(xml, compart) });
  }
  return abas;
}

const desescapar = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function linhasDeXml(xml, compart) {
  const linhas = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cm[1] || cm[3] || '', inner = cm[2] || '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      const idx = ref ? colIdx(ref[1]) : cells.length;
      const t = /t="([^"]*)"/.exec(attrs);
      let v = '';
      if (t && t[1] === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => desescapar(x[1])).join('');
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) v = (t && t[1] === 's') ? (compart[+vm[1]] ?? '') : desescapar(vm[1]);
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = v;
    }
    linhas.push(cells);
  }
  return linhas;
}
function colIdx(s) { let n = 0; for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }

export function lerCsv(texto) {
  const limpo = texto.replace(/^﻿/, '');
  const sep = (limpo.split('\n')[0].match(/;/g) || []).length >= (limpo.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return [{ nome: 'CSV', linhas }];
}

export async function textoDePdf(bytes) {
  const doc = await openPdf(bytes);
  const partes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    partes.push({ pagina: i, texto: tc.items.map(t => t.str).join(' ') });
  }
  return partes;
}

/* ---------- comparação ---------- */

const DATA_BOA = /^\d{2}\/\d{2}\/\d{4}$/;
const DATA_QUALQUER = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g;

export function auditar(planilha, manual, opcoes = {}) {
  const itens = [];
  const nomeA = opcoes.nomeManual || 'Manual';
  const nomeB = opcoes.nomePlanilha || 'Planilha';
  const textoManual = manual.map(p => p.texto).join('\n');
  const normManual = normalizar(textoManual);

  const aba = planilha[0] || { linhas: [] };
  const cab = (aba.linhas[0] || []).map(c => String(c).trim());
  const corpo = aba.linhas.slice(1).filter(l => l.some(c => String(c).trim()));

  const iAmb = acharCol(cab, ['ambiente', 'local']);
  const iDesc = acharCol(cab, ['descri', 'produto', 'material', 'item']);
  const iMarca = acharCol(cab, ['marca', 'fabricante']);
  const iForn = acharCol(cab, ['fornecedor']);
  const iCat = acharCol(cab, ['categoria']);

  // 1. campos obrigatórios vazios
  let vaziosMarca = 0, vaziosForn = 0;
  corpo.forEach((l, n) => {
    if (iDesc >= 0 && !String(l[iDesc] || '').trim()) {
      itens.push({ a: '', b: `${nomeB} linha ${n + 2}`, tipo: 'Informação ausente', descricao: 'Linha sem descrição de produto.', impacto: 'Alto — item não especificável no manual.' });
    }
    if (iMarca >= 0 && !String(l[iMarca] || '').trim()) vaziosMarca++;
    if (iForn >= 0 && !String(l[iForn] || '').trim()) vaziosForn++;
  });
  if (vaziosMarca) itens.push({ a: '', b: nomeB, tipo: 'Informação ausente', descricao: `${vaziosMarca} linha(s) sem marca preenchida.`, impacto: 'Médio — impede a montagem da lista de fornecedores.' });
  if (vaziosForn) itens.push({ a: '', b: nomeB, tipo: 'Informação ausente', descricao: `${vaziosForn} linha(s) sem fornecedor preenchido.`, impacto: 'Médio — assistência técnica sem contato responsável.' });

  // 2. categorias fora do vocabulário
  if (iCat >= 0) {
    const permitidas = ['piso', 'paredes', 'teto', 'loucas', 'metais', 'pedras naturais', 'esquadrias'];
    const fora = new Set();
    corpo.forEach(l => { const v = normalizar(l[iCat]); if (v && !permitidas.includes(v)) fora.add(String(l[iCat]).trim()); });
    if (fora.size) itens.push({ a: '', b: nomeB, tipo: 'Erro de lógica', descricao: `Categoria fora do vocabulário permitido: ${[...fora].join(', ')}.`, impacto: 'Médio — quebra o agrupamento do quadro de acabamentos.' });
  }

  // 3. ambientes da planilha ausentes no manual, e vice-versa
  const ambPlan = [...new Set(corpo.map(l => String(l[iAmb] || '').trim()).filter(Boolean))];
  const ausentes = ambPlan.filter(a => !normManual.includes(normalizar(a)));
  for (const a of ausentes) itens.push({ a: nomeA, b: nomeB, tipo: 'Omissão no manual', descricao: `O ambiente “${a}” consta na planilha e não foi localizado no texto do manual.`, impacto: 'Alto — ambiente sem orientação de uso e manutenção.' });

  const ambManual = extrairAmbientes(textoManual);
  const semPlan = ambManual.filter(a => !ambPlan.some(p => mesmoAmbiente(p, a)));
  for (const a of semPlan.slice(0, 12)) itens.push({ a: nomeA, b: nomeB, tipo: 'Omissão na planilha', descricao: `O manual cita “${a}”, que não aparece na coluna de ambientes da planilha.`, impacto: 'Alto — produto do ambiente pode ficar sem fornecedor.' });

  // 4. nomenclatura diferente para o mesmo ambiente
  for (const p of ambPlan) for (const m of ambManual) {
    if (p === m) continue;
    if (mesmoAmbiente(p, m) && normalizar(p) !== normalizar(m)) {
      itens.push({ a: `${nomeA}: ${m}`, b: `${nomeB}: ${p}`, tipo: 'Nomenclatura diferente', descricao: `O mesmo ambiente aparece escrito de duas formas.`, impacto: 'Médio — dificulta o cruzamento e a conferência.' });
    }
  }

  // 5. datas fora do padrão
  const datas = [...textoManual.matchAll(DATA_QUALQUER)].map(m => m[0]);
  const ruins = [...new Set(datas.filter(d => !DATA_BOA.test(d)))];
  if (ruins.length) itens.push({ a: nomeA, b: '', tipo: 'Data fora do padrão', descricao: `Datas em formato não dd/mm/aaaa: ${ruins.slice(0, 6).join(', ')}${ruins.length > 6 ? '…' : ''}.`, impacto: 'Baixo — inconsistência de formatação.' });

  // 6. produtos citados na planilha e não no manual
  if (iDesc >= 0) {
    const faltando = [];
    for (const l of corpo) {
      const d = String(l[iDesc] || '').trim();
      if (d.length < 6) continue;
      const chave = normalizar(d).split(' ').filter(w => w.length > 4).slice(0, 2).join(' ');
      if (chave && !normManual.includes(chave)) faltando.push(d);
    }
    const unicos = [...new Set(faltando)];
    if (unicos.length) itens.push({ a: nomeA, b: nomeB, tipo: 'Omissão no manual', descricao: `${unicos.length} produto(s) da planilha sem menção no manual. Primeiros: ${unicos.slice(0, 3).join('; ')}.`, impacto: 'Alto — o manual não cobre parte do que foi entregue.' });
  }

  const criticos = itens.filter(i => /Alto/.test(i.impacto)).slice(0, 3)
    .map(i => ({ titulo: i.tipo, detalhe: i.descricao }));
  const alinhamento = itens.length === 0 ? 'total'
    : itens.length <= 4 ? 'alto' : itens.length <= 12 ? 'parcial' : 'baixo';
  const resumo = itens.length === 0
    ? `Manual e planilha estão alinhados nos pontos verificados: ${corpo.length} linhas conferidas, sem divergências de ambiente, categoria, preenchimento ou formato de data.`
    : `Alinhamento ${alinhamento}. Foram conferidas ${corpo.length} linhas da planilha contra ${manual.length} página(s) do manual e identificadas ${itens.length} divergências, sendo ${criticos.length} de impacto alto. As mais frequentes são ${maisFrequente(itens)}.`;

  const acoes = [];
  if (itens.some(i => i.tipo === 'Omissão no manual')) acoes.push('Incluir no manual os ambientes e produtos listados como omissos, com orientação de uso e manutenção.');
  if (itens.some(i => i.tipo === 'Omissão na planilha')) acoes.push('Completar a planilha com os ambientes citados no manual, vinculando produto, marca e fornecedor.');
  if (itens.some(i => i.tipo === 'Nomenclatura diferente')) acoes.push('Padronizar a nomenclatura dos ambientes entre manual e planilha, adotando a grafia da prancha de arquitetura.');
  if (vaziosMarca || vaziosForn) acoes.push('Preencher marca e fornecedor das linhas pendentes antes da emissão.');
  if (itens.some(i => i.tipo === 'Data fora do padrão')) acoes.push('Uniformizar as datas no formato dd/mm/aaaa.');
  if (!acoes.length) acoes.push('Nenhuma ação corretiva necessária nos pontos verificados.');

  return { itens, criticos, resumo, acoes, linhasConferidas: corpo.length, paginasManual: manual.length };
}

function maisFrequente(itens) {
  const c = {}; for (const i of itens) c[i.tipo] = (c[i.tipo] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t, n]) => `${t.toLowerCase()} (${n})`).join(' e ');
}
function acharCol(cab, termos) {
  for (let i = 0; i < cab.length; i++) { const v = normalizar(cab[i]); if (termos.some(t => v.includes(t))) return i; }
  return -1;
}
function extrairAmbientes(texto) {
  const base = ['cozinha', 'sala de estar', 'sala de jantar', 'sala íntima', 'dormitório', 'quarto', 'banho', 'banheiro',
    'lavabo', 'varanda', 'sacada', 'área de serviço', 'área pets', 'circulação', 'closet', 'garagem', 'hall',
    'lavanderia', 'vestiário', 'depósito', 'ducha', 'gourmet', 'jardim', 'escada', 'brinquedoteca', 'piscina', 'clausura'];
  const achados = new Set();
  for (const b of base) {
    const re = new RegExp(b.replace(/[aeiouáéíóúâêôãõç]/g, c => '[' + c + ']') + '(\\s*\\d{1,2})?', 'gi');
    for (const m of texto.matchAll(re)) achados.add(m[0].replace(/\s+/g, ' ').trim());
  }
  return [...achados];
}
