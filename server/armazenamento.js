/* Onde os bytes das pranchas moram.

   A decisão de projeto aqui é uma só: NENHUMA ROTA CONHECE O DISCO. Todas
   falam com este contrato de quatro métodos, e trocar disco por S3 é
   reescrever este arquivo — nada mais.

     put(bytes, { nome, tipo })  → { chave, bytes, sha256 }
     get(chave)                  → Buffer
     url(chave, meta)            → string (o que o navegador vai buscar)
     remover(chave)              → boolean

   NOMES DE ARQUIVO NÃO SÃO CONFIÁVEIS. O nome que o navegador manda entra no
   banco como rótulo e em lugar nenhum mais: a chave no disco é derivada do
   SHA-256 do conteúdo. Isso resolve três coisas de uma vez — travessia de
   diretório fica impossível, "EX01 (1).pdf" não vira arquivo novo, e a mesma
   prancha enviada por duas pessoas ocupa um lugar só.

   Sharding em dois níveis (ab/cd/abcdef…) porque uma pasta com 50 mil PDFs de
   A0 é lenta de listar em qualquer sistema de arquivos. */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const RAIZ = process.env.PRANCHAS_DIR
  || path.join(process.env.DADOS_DIR || path.join(process.cwd(), 'dados'), 'pranchas');

const EXTENSAO = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/* ------------------------------------------------------------------ */
/* implementação em disco                                              */
/* ------------------------------------------------------------------ */

export const discoLocal = {
  nome: 'disco',
  raiz: RAIZ,

  async put(bytes, { tipo = 'application/pdf' } = {}) {
    const hash = sha256(bytes);
    const ext = EXTENSAO[tipo] || '.bin';
    const chave = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${ext}`;
    const destino = path.join(RAIZ, chave);
    await fsp.mkdir(path.dirname(destino), { recursive: true });
    /* já existe = já é o mesmo conteúdo, por definição do hash: não reescreve */
    try { await fsp.access(destino); }
    catch { await fsp.writeFile(destino, bytes); }
    return { chave, bytes: bytes.length, sha256: hash };
  },

  async get(chave) {
    return fsp.readFile(caminhoSeguro(chave));
  },

  /* No disco não há URL assinada: o navegador busca pelo próprio BFF, que é
     quem sabe traduzir id → chave. No S3 este método devolveria a URL
     pré-assinada e o download nem passaria pelo servidor. */
  url(_chave, meta = {}) {
    return meta.id ? `/api/files/${encodeURIComponent(meta.id)}` : null;
  },

  async remover(chave) {
    try { await fsp.unlink(caminhoSeguro(chave)); return true; } catch { return false; }
  },

  async espaco() {
    let n = 0, bytes = 0;
    const andar = async (dir) => {
      let itens = [];
      try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const it of itens) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) await andar(p);
        else { n++; bytes += (await fsp.stat(p)).size; }
      }
    };
    await andar(RAIZ);
    return { arquivos: n, bytes };
  },
};

/* A chave vem do banco, mas o banco pode ter sido editado à mão. Trava. */
function caminhoSeguro(chave) {
  const destino = path.resolve(RAIZ, String(chave));
  const raiz = path.resolve(RAIZ);
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
    throw new Error('chave de arquivo fora do armazenamento');
  }
  return destino;
}

/* ------------------------------------------------------------------ */
/* o dia do S3                                                         */
/* ------------------------------------------------------------------ */

/* Deixado escrito, não ligado. Para migrar: instale @aws-sdk/client-s3 e
   @aws-sdk/s3-request-presigner, descomente, e troque a linha do `export
   default` no fim do arquivo. As rotas não mudam.

export function s3({ bucket, regiao, prefixo = 'pranchas/' }) {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const cli = new S3Client({ region: regiao });
  return {
    nome: 's3',
    async put(bytes, { tipo = 'application/pdf' } = {}) {
      const hash = sha256(bytes);
      const chave = `${prefixo}${hash.slice(0,2)}/${hash}${EXTENSAO[tipo] || '.bin'}`;
      await cli.send(new PutObjectCommand({ Bucket: bucket, Key: chave, Body: bytes, ContentType: tipo }));
      return { chave, bytes: bytes.length, sha256: hash };
    },
    async get(chave) {
      const r = await cli.send(new GetObjectCommand({ Bucket: bucket, Key: chave }));
      return Buffer.from(await r.Body.transformToByteArray());
    },
    // aqui o download deixa de passar pelo servidor: o navegador vai direto ao bucket
    async url(chave) {
      return getSignedUrl(cli, new GetObjectCommand({ Bucket: bucket, Key: chave }), { expiresIn: 3600 });
    },
    async remover(chave) {
      await cli.send(new DeleteObjectCommand({ Bucket: bucket, Key: chave })); return true;
    },
  };
}
*/

/* ------------------------------------------------------------------ */
/* multipart/form-data sem multer                                      */
/* ------------------------------------------------------------------ */

/* O multer é a escolha óbvia e está no package.json. Mas ele é uma dependência
   a mais para instalar numa máquina onde o npm pode falhar, e o que precisamos
   dele é um campo de arquivo por requisição. Isto são 60 linhas que fazem
   exatamente isso, trabalhando sobre Buffer — sem regex sobre o corpo binário,
   que é o erro clássico que corrompe PDF.

   Limite de tamanho aplicado enquanto lê, não depois: um A0 tem 2–4 MB, e um
   upload de 2 GB não pode virar 2 GB de RAM antes de ser recusado. */

export function lerMultipart(req, { limiteBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const tipo = req.headers['content-type'] || '';
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(tipo);
    if (!m) return reject(new Error('content-type não é multipart/form-data com boundary'));
    const limite = Buffer.from('--' + (m[1] || m[2]).trim());

    const pedacos = [];
    let total = 0, morto = false;
    req.on('data', (c) => {
      if (morto) return;
      total += c.length;
      if (total > limiteBytes) {
        morto = true;
        reject(new Error(`upload acima do limite de ${Math.round(limiteBytes / 1048576)} MB`));
        req.destroy();
        return;
      }
      pedacos.push(c);
    });
    req.on('error', (e) => { if (!morto) { morto = true; reject(e); } });
    req.on('end', () => {
      if (morto) return;
      try { resolve(fatiar(Buffer.concat(pedacos), limite)); }
      catch (e) { reject(e); }
    });
  });
}

function fatiar(corpo, limite) {
  const campos = {};
  const arquivos = [];
  let i = corpo.indexOf(limite);
  while (i >= 0) {
    const inicio = i + limite.length;
    if (corpo.slice(inicio, inicio + 2).toString() === '--') break;   // limite final
    const prox = corpo.indexOf(limite, inicio);
    if (prox < 0) break;
    /* a parte vai do fim do CRLF do limite até o CRLF que antecede o próximo */
    const parte = corpo.slice(inicio + 2, prox - 2);
    const corte = parte.indexOf('\r\n\r\n');
    if (corte > 0) {
      const cabecalhos = parte.slice(0, corte).toString('utf8');
      const conteudo = parte.slice(corte + 4);
      const nomeCampo = /name="([^"]*)"/i.exec(cabecalhos)?.[1] || '';
      const nomeArquivo = /filename="([^"]*)"/i.exec(cabecalhos)?.[1];
      if (nomeArquivo !== undefined) {
        arquivos.push({
          campo: nomeCampo,
          /* só o basename: "../../etc/passwd" vira "passwd" antes de existir */
          nome: path.basename(String(nomeArquivo).replace(/\\/g, '/')) || 'arquivo',
          tipo: (/content-type:\s*([^\r\n]+)/i.exec(cabecalhos)?.[1] || 'application/octet-stream').trim(),
          bytes: conteudo,
        });
      } else {
        campos[nomeCampo] = conteudo.toString('utf8');
      }
    }
    i = prox;
  }
  return { campos, arquivos };
}

/* ------------------------------------------------------------------ */
/* implementação no banco (tabela `blobs` do db.js)                    */
/* ------------------------------------------------------------------ */

/* Para quando o disco não é confiável — o caso do Render no plano gratuito,
   onde /server/dados some a cada hibernação. Com o banco no Turso, os bytes
   da prancha vão para o mesmo lugar que o projeto, e a "outra máquina"
   consegue abrir a prancha depois de o servidor ter reiniciado.

   Mesma chave sharded do disco, para o índice em `arquivos` não saber qual
   dos dois está por trás. */

export const noBanco = {
  nome: 'banco',
  raiz: null,

  async put(bytes, { tipo = 'application/pdf' } = {}) {
    const banco = await import('./db.js');
    const hash = sha256(bytes);
    const ext = EXTENSAO[tipo] || '.bin';
    const chave = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${ext}`;
    await banco.guardarBlob(chave, bytes, tipo);
    return { chave, bytes: bytes.length, sha256: hash };
  },

  async get(chave) {
    const banco = await import('./db.js');
    const b = await banco.lerBlob(chave);
    if (!b) throw new Error('blob não encontrado');
    return b;
  },

  url(_chave, meta = {}) {
    return meta.id ? `/api/files/${encodeURIComponent(meta.id)}` : null;
  },

  async remover(chave) {
    const banco = await import('./db.js');
    return banco.apagarBlob(chave);
  },

  async espaco() {
    const banco = await import('./db.js');
    return banco.espacoBlobs();
  },
};

/* ------------------------------------------------------------------ */
/* qual dos dois                                                       */
/* ------------------------------------------------------------------ */

/* ARMAZENAMENTO=disco|banco decide à mão. Sem isso: banco quando há Turso
   configurado (se o banco precisou sair do disco, os arquivos também
   precisam), disco em qualquer outro caso — que é o comportamento de sempre
   numa máquina de escritório. Trocar por `s3({ ... })` no dia da migração:
   nenhuma rota muda. */
const escolha = (process.env.ARMAZENAMENTO || '').trim().toLowerCase();
const armazenamento = escolha === 'banco' ? noBanco
  : escolha === 'disco' ? discoLocal
  : (process.env.TURSO_DATABASE_URL ? noBanco : discoLocal);

export default armazenamento;
