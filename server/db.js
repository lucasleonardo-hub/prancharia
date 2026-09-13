/* Banco do Prancharia.

   O BFF deixou de ser só a ponte com o Gemini: agora ele guarda os projetos,
   as empresas e o índice das pranchas. O banco é SQLite — um arquivo só, que
   se copia, se versiona e se leva para outra máquina num anexo de e-mail.

   DUAS IMPLEMENTAÇÕES, UM CONTRATO. `better-sqlite3` é o driver rápido, mas é
   módulo nativo: exige compilador na máquina de quem instala. O Node 22 traz
   `node:sqlite` embutido, com a mesma forma de API. Este arquivo tenta o
   primeiro e cai no segundo, então o servidor sobe mesmo numa máquina onde o
   `npm install` falhou — que foi exatamente o caso ao escrever isto.

   PARÂMETROS SEMPRE POSICIONAIS (`?`). Os dois drivers divergem no nome dos
   parâmetros nomeados; no posicional eles concordam. Não troque por `:nome`.

   O ESQUEMA, EM UMA FRASE: uma `empresa` tem muitos `projetos`; um projeto é
   um documento JSON inteiro (a árvore que o frontend já monta) mais as
   colunas que a listagem precisa ler sem abrir o JSON; `arquivos` é o índice
   das pranchas, cujos bytes moram no Armazenamento (disco hoje, S3 depois);
   `glossario` guarda as regras aprendidas, globais ou de uma empresa só. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PASTA = process.env.DADOS_DIR || path.join(process.cwd(), 'dados');
const ARQUIVO = process.env.DB_FILE || path.join(PASTA, 'prancharia.db');

/* ------------------------------------------------------------------ */
/* abertura: better-sqlite3 quando existir, node:sqlite quando não      */
/* ------------------------------------------------------------------ */

let bd = null;
let motor = 'nenhum';

async function abrir() {
  if (bd) return bd;
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });

  try {
    const { default: Better } = await import('better-sqlite3');
    bd = new Better(ARQUIVO);
    motor = 'better-sqlite3';
  } catch {
    const { DatabaseSync } = await import('node:sqlite');
    bd = new DatabaseSync(ARQUIVO);
    motor = 'node:sqlite';
  }

  /* WAL deixa leitura e escrita concorrerem sem trancar uma à outra: com
     duas pessoas na mesma base isso é a diferença entre funcionar e travar. */
  try { bd.exec('PRAGMA journal_mode = WAL'); } catch { /* alguns sistemas de arquivo de rede recusam WAL */ }
  bd.exec('PRAGMA foreign_keys = ON');
  migrar();
  return bd;
}

export const motorDoBanco = () => motor;
export const caminhoDoBanco = () => ARQUIVO;

/* ------------------------------------------------------------------ */
/* esquema                                                             */
/* ------------------------------------------------------------------ */

/* Idempotente de propósito: roda em toda subida, e subir duas vezes não
   quebra nada. É o que permite atualizar o servidor sem passo manual. */
function migrar() {
  bd.exec(`
    CREATE TABLE IF NOT EXISTS empresas (
      id                        TEXT PRIMARY KEY,
      nome                      TEXT NOT NULL,
      regras_ia                 TEXT NOT NULL DEFAULT '',
      fornecedores_homologados  TEXT NOT NULL DEFAULT '[]',
      vocabulario               TEXT NOT NULL DEFAULT '[]',
      criado_em                 TEXT NOT NULL,
      atualizado_em             TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projetos (
      id             TEXT PRIMARY KEY,
      empresa_id     TEXT REFERENCES empresas(id) ON DELETE SET NULL,
      nome           TEXT NOT NULL DEFAULT '',
      tipo           TEXT NOT NULL DEFAULT 'outro',
      dados_json     TEXT NOT NULL,
      bytes          INTEGER NOT NULL DEFAULT 0,
      criado_em      TEXT NOT NULL,
      atualizado_em  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_projetos_empresa    ON projetos(empresa_id);
    CREATE INDEX IF NOT EXISTS ix_projetos_atualizado ON projetos(atualizado_em DESC);

    CREATE TABLE IF NOT EXISTS arquivos (
      id          TEXT PRIMARY KEY,
      projeto_id  TEXT,
      nome        TEXT NOT NULL DEFAULT '',
      tipo        TEXT NOT NULL DEFAULT 'application/pdf',
      bytes       INTEGER NOT NULL DEFAULT 0,
      sha256      TEXT NOT NULL DEFAULT '',
      chave       TEXT NOT NULL,
      criado_em   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_arquivos_projeto ON arquivos(projeto_id);
    CREATE INDEX IF NOT EXISTS ix_arquivos_sha     ON arquivos(sha256);

    CREATE TABLE IF NOT EXISTS glossario (
      escopo         TEXT PRIMARY KEY,
      regras         TEXT NOT NULL DEFAULT '[]',
      atualizado_em  TEXT NOT NULL
    );
  `);
}

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

const agora = () => new Date().toISOString();
const novoId = (p) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

/** JSON que nunca lança: coluna corrompida vira o padrão, não um 500. */
function json(texto, padrao) {
  try { const v = JSON.parse(texto); return v ?? padrao; } catch { return padrao; }
}

const umaEmpresa = (r) => r && ({
  id: r.id,
  nome: r.nome,
  regrasIa: r.regras_ia || '',
  fornecedoresHomologados: json(r.fornecedores_homologados, []),
  vocabulario: json(r.vocabulario, []),
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});

/* ------------------------------------------------------------------ */
/* empresas                                                            */
/* ------------------------------------------------------------------ */

export async function listarEmpresas() {
  const d = await abrir();
  const linhas = d.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM projetos p WHERE p.empresa_id = e.id) AS projetos
      FROM empresas e ORDER BY e.nome COLLATE NOCASE
  `).all();
  return linhas.map(r => ({ ...umaEmpresa(r), projetos: Number(r.projetos) || 0 }));
}

export async function lerEmpresa(id) {
  if (!id) return null;
  const d = await abrir();
  return umaEmpresa(d.prepare('SELECT * FROM empresas WHERE id = ?').get(String(id))) || null;
}

/**
 * Grava uma empresa. Sem `id`, cria; com `id` conhecido, atualiza apenas os
 * campos enviados — a tela de regras salva só o que mexeu, e um PATCH parcial
 * não pode apagar os fornecedores homologados por omissão.
 */
export async function salvarEmpresa(dados = {}) {
  const d = await abrir();
  const t = agora();
  const existente = dados.id ? await lerEmpresa(dados.id) : null;

  const novo = {
    id: existente?.id || dados.id || novoId('empresa'),
    nome: String(dados.nome ?? existente?.nome ?? '').trim() || 'Empresa sem nome',
    regrasIa: dados.regrasIa ?? existente?.regrasIa ?? '',
    fornecedoresHomologados: dados.fornecedoresHomologados ?? existente?.fornecedoresHomologados ?? [],
    vocabulario: dados.vocabulario ?? existente?.vocabulario ?? [],
    criadoEm: existente?.criadoEm || t,
    atualizadoEm: t,
  };

  d.prepare(`
    INSERT INTO empresas (id, nome, regras_ia, fornecedores_homologados, vocabulario, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      nome = excluded.nome, regras_ia = excluded.regras_ia,
      fornecedores_homologados = excluded.fornecedores_homologados,
      vocabulario = excluded.vocabulario, atualizado_em = excluded.atualizado_em
  `).run(novo.id, novo.nome, String(novo.regrasIa),
    JSON.stringify(novo.fornecedoresHomologados), JSON.stringify(novo.vocabulario),
    novo.criadoEm, novo.atualizadoEm);

  return novo;
}

export async function apagarEmpresa(id) {
  const d = await abrir();
  /* ON DELETE SET NULL: apagar a construtora não apaga o levantamento dos
     projetos dela. Eles voltam para "sem empresa" e podem ser reatribuídos. */
  const r = d.prepare('DELETE FROM empresas WHERE id = ?').run(String(id));
  return Number(r.changes) > 0;
}

/* ------------------------------------------------------------------ */
/* projetos                                                            */
/* ------------------------------------------------------------------ */

/** A listagem não abre o JSON: ela lê só as colunas do cabeçalho. */
export async function listarProjetos({ empresaId = null, limite = 200 } = {}) {
  const d = await abrir();
  const sql = `SELECT id, empresa_id, nome, tipo, bytes, criado_em, atualizado_em
                 FROM projetos ${empresaId ? 'WHERE empresa_id = ?' : ''}
                ORDER BY atualizado_em DESC LIMIT ?`;
  const linhas = empresaId
    ? d.prepare(sql).all(String(empresaId), Number(limite))
    : d.prepare(sql).all(Number(limite));
  return linhas.map(r => ({
    id: r.id, empresaId: r.empresa_id, nome: r.nome, tipo: r.tipo,
    bytes: Number(r.bytes) || 0, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
  }));
}

export async function lerProjeto(id) {
  const d = await abrir();
  const r = d.prepare('SELECT * FROM projetos WHERE id = ?').get(String(id));
  if (!r) return null;
  const emp = json(r.dados_json, null);
  if (!emp) return null;
  /* as colunas mandam: se alguém reatribuiu a empresa por SQL, o JSON obedece */
  emp.id = r.id;
  emp.empresaId = r.empresa_id;
  emp.atualizadoEm = r.atualizado_em;
  return emp;
}

/**
 * Grava o empreendimento inteiro. O frontend manda a árvore completa — é uma
 * escrita grande e pouco frequente, que é exatamente o padrão de uso: dezenas
 * de leituras para cada gravação.
 */
export async function salvarProjeto(emp = {}) {
  if (!emp || !emp.id) throw new Error('projeto sem id');
  const d = await abrir();
  const t = agora();
  const texto = JSON.stringify(emp);
  const anterior = d.prepare('SELECT criado_em FROM projetos WHERE id = ?').get(String(emp.id));

  d.prepare(`
    INSERT INTO projetos (id, empresa_id, nome, tipo, dados_json, bytes, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      empresa_id = excluded.empresa_id, nome = excluded.nome, tipo = excluded.tipo,
      dados_json = excluded.dados_json, bytes = excluded.bytes, atualizado_em = excluded.atualizado_em
  `).run(String(emp.id), emp.empresaId ? String(emp.empresaId) : null,
    String(emp.nome || ''), String(emp.tipo || 'outro'), texto, texto.length,
    anterior?.criado_em || emp.criadoEm || t, t);

  return { id: emp.id, bytes: texto.length, atualizadoEm: t };
}

export async function apagarProjeto(id) {
  const d = await abrir();
  const r = d.prepare('DELETE FROM projetos WHERE id = ?').run(String(id));
  return Number(r.changes) > 0;
}

/* ------------------------------------------------------------------ */
/* arquivos (índice; os bytes moram no Armazenamento)                  */
/* ------------------------------------------------------------------ */

export async function registrarArquivo(meta = {}) {
  const d = await abrir();
  const linha = {
    id: meta.id || novoId('arq'),
    projetoId: meta.projetoId || null,
    nome: meta.nome || '',
    tipo: meta.tipo || 'application/pdf',
    bytes: Number(meta.bytes) || 0,
    sha256: meta.sha256 || '',
    chave: meta.chave,
    criadoEm: agora(),
  };
  d.prepare(`
    INSERT INTO arquivos (id, projeto_id, nome, tipo, bytes, sha256, chave, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      projeto_id = excluded.projeto_id, nome = excluded.nome, tipo = excluded.tipo,
      bytes = excluded.bytes, sha256 = excluded.sha256, chave = excluded.chave
  `).run(linha.id, linha.projetoId, linha.nome, linha.tipo, linha.bytes, linha.sha256, linha.chave, linha.criadoEm);
  return linha;
}

export async function lerArquivoMeta(id) {
  const d = await abrir();
  const r = d.prepare('SELECT * FROM arquivos WHERE id = ?').get(String(id));
  return r ? { id: r.id, projetoId: r.projeto_id, nome: r.nome, tipo: r.tipo,
    bytes: Number(r.bytes), sha256: r.sha256, chave: r.chave, criadoEm: r.criado_em } : null;
}

/** Mesma prancha enviada duas vezes é um arquivo só no disco. */
export async function acharPorHash(sha256) {
  if (!sha256) return null;
  const d = await abrir();
  const r = d.prepare('SELECT * FROM arquivos WHERE sha256 = ? LIMIT 1').get(String(sha256));
  return r ? { id: r.id, chave: r.chave, nome: r.nome, tipo: r.tipo, bytes: Number(r.bytes) } : null;
}

export async function listarArquivosDoProjeto(projetoId) {
  const d = await abrir();
  return d.prepare('SELECT id, nome, tipo, bytes, criado_em FROM arquivos WHERE projeto_id = ? ORDER BY criado_em')
    .all(String(projetoId))
    .map(r => ({ id: r.id, nome: r.nome, tipo: r.tipo, bytes: Number(r.bytes), criadoEm: r.criado_em }));
}

/* ------------------------------------------------------------------ */
/* glossário                                                           */
/* ------------------------------------------------------------------ */

const escopoDe = (empresaId) => (empresaId ? `empresa:${empresaId}` : 'global');

/**
 * O global vale para todo mundo; o da empresa vence em cima dele quando o
 * mesmo termo aparece nos dois. É o que permite a uma construtora classificar
 * "TABICA" do jeito dela sem forçar isso nas outras.
 */
export async function lerGlossario(empresaId = null) {
  const d = await abrir();
  const pega = (esc) => json(d.prepare('SELECT regras FROM glossario WHERE escopo = ?').get(esc)?.regras, []);
  const global = pega('global');
  if (!empresaId) return global;
  const daEmpresa = pega(escopoDe(empresaId));
  const mapa = new Map(global.map(r => [String(r.exato || '').toLowerCase(), r]));
  for (const r of daEmpresa) mapa.set(String(r.exato || '').toLowerCase(), r);
  return [...mapa.values()];
}

export async function salvarGlossario(regras = [], empresaId = null) {
  const d = await abrir();
  d.prepare(`
    INSERT INTO glossario (escopo, regras, atualizado_em) VALUES (?, ?, ?)
    ON CONFLICT(escopo) DO UPDATE SET regras = excluded.regras, atualizado_em = excluded.atualizado_em
  `).run(escopoDe(empresaId), JSON.stringify(Array.isArray(regras) ? regras : []), agora());
  return true;
}

/* ------------------------------------------------------------------ */

export async function estatisticas() {
  const d = await abrir();
  const n = (sql) => Number(d.prepare(sql).get()?.n) || 0;
  return {
    motor, arquivo: ARQUIVO,
    empresas: n('SELECT COUNT(*) n FROM empresas'),
    projetos: n('SELECT COUNT(*) n FROM projetos'),
    arquivos: n('SELECT COUNT(*) n FROM arquivos'),
    bytesProjetos: n('SELECT COALESCE(SUM(bytes),0) n FROM projetos'),
  };
}

export { abrir as iniciarBanco, PASTA as PASTA_DADOS };
