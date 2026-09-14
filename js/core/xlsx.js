/* Gravador de XLSX próprio — um .xlsx é um ZIP de XML.
   Sem dependência externa: o que sai daqui é sempre o que está na tela. */

const enc = new TextEncoder();
let TAB = null;
function crcTab() {
  if (TAB) return TAB;
  TAB = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TAB[n] = c >>> 0; }
  return TAB;
}
function crc32(buf) {
  const t = crcTab(); let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(entradas) {
  const locais = [], centrais = []; let off = 0;
  for (const e of entradas) {
    const nome = enc.encode(e.nome);
    const dados = typeof e.dados === 'string' ? enc.encode(e.dados) : e.dados;
    const crc = crc32(dados);
    const lh = new Uint8Array(30 + nome.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, dados.length, true); dv.setUint32(22, dados.length, true);
    dv.setUint16(26, nome.length, true); dv.setUint16(28, 0, true);
    lh.set(nome, 30);
    locais.push(lh, dados);
    const ch = new Uint8Array(46 + nome.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, dados.length, true); cv.setUint32(24, dados.length, true);
    cv.setUint16(28, nome.length, true); cv.setUint32(42, off, true);
    ch.set(nome, 46);
    centrais.push(ch);
    off += lh.length + dados.length;
  }
  const cdTam = centrais.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entradas.length, true); ev.setUint16(10, entradas.length, true);
  ev.setUint32(12, cdTam, true); ev.setUint32(16, off, true);
  const total = off + cdTam + 22;
  const saida = new Uint8Array(total); let p = 0;
  for (const b of locais) { saida.set(b, p); p += b.length; }
  for (const b of centrais) { saida.set(b, p); p += b.length; }
  saida.set(eocd, p);
  return saida;
}

/** ZIP genérico (sem compressão), para quem precisa de uma pasta de arquivos
    de texto num download só — a exportação para o Obsidian usa isto.
    `entradas`: [{ nome: 'pasta/arquivo.md', dados: string | Uint8Array }]. */
export function gerarZip(entradas) {
  return new Blob([zip(entradas)], { type: 'application/zip' });
}

const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(CTRL, '');
const col = n => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

function planilhaXml(linhas) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetFormatPr defaultRowHeight="15"/>'];
  const larguras = [];
  linhas.forEach(l => l.forEach((c, i) => { larguras[i] = Math.min(60, Math.max(larguras[i] || 9, String(c === null || c === undefined ? '' : c).length + 2)); }));
  if (larguras.length) out.push('<cols>' + larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  out.push('<sheetData>');
  linhas.forEach((linha, r) => {
    out.push(`<row r="${r + 1}">`);
    linha.forEach((v, c) => {
      if (v === '' || v === null || v === undefined) return;
      const ref = col(c) + (r + 1);
      const estilo = r === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) out.push(`<c r="${ref}"${estilo}><v>${v}</v></c>`);
      else out.push(`<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
    });
    out.push('</row>');
  });
  out.push('</sheetData>');
  if (linhas.length > 1 && larguras.length) out.push(`<autoFilter ref="A1:${col(larguras.length - 1)}${linhas.length}"/>`);
  out.push('</worksheet>');
  return out.join('');
}

const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3E4396"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';

/** abas: [{nome, linhas:[[...]]}] */
export function gerarXlsx(abas) {
  const nomes = []; const usados = new Set();
  for (const a of abas) {
    let n = (a.nome || 'Planilha').replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Planilha';
    let i = 2; while (usados.has(n.toLowerCase())) n = (n.slice(0, 28) + ' ' + i++).slice(0, 31);
    usados.add(n.toLowerCase()); nomes.push(n);
  }
  const entradas = [
    { nome: '[Content_Types].xml', dados: CT + abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { nome: '_rels/.rels', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: 'xl/workbook.xml', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { nome: 'xl/_rels/workbook.xml.rels', dados: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nome: 'xl/styles.xml', dados: ESTILOS },
  ];
  abas.forEach((a, i) => entradas.push({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: planilhaXml(a.linhas) }));
  return new Blob([zip(entradas)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function gerarCsv(linhas) {
  const BOM = '﻿';
  return BOM + linhas.map(l => l.map(v => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
}
