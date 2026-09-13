/* OCR de memorial escaneado, via iLoveAPI (ferramenta "pdfocr").

   Só entra em ação quando o frontend detecta que um memorial não tem
   camada de texto extraível (ver precisaDeOcr em js/core/memorial.js) — a
   leitura de PRANCHA por imagem não precisa disto, porque ela já lê a
   página como figura de qualquer jeito.

   Fluxo da API (https://developer.ilovepdf.com): /auth com a chave pública
   devolve um token; /start/{tool} reserva um servidor e uma tarefa; upload
   e process rodam NESSE servidor; download traz o PDF pronto — agora com
   texto embutido, pronto para o pdf.js do frontend extrair normalmente. */

const BASE = 'https://api.ilovepdf.com/v1';
const PUBLIC_KEY = (process.env.ILOVEPDF_PUBLIC_KEY || '').trim();

export const OCR_CONFIGURADO = !!PUBLIC_KEY;

async function token() {
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: PUBLIC_KEY }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) {
    throw new Error(`iLovePDF auth falhou (${r.status}): ${(j.error && j.error.message) || JSON.stringify(j)}`);
  }
  return j.token;
}

/** Roda OCR em português num PDF e devolve os bytes do PDF com texto embutido. */
export async function ocrPdf(bytes, nomeArquivo = 'documento.pdf') {
  if (!PUBLIC_KEY) throw new Error('ILOVEPDF_PUBLIC_KEY ausente');
  const tk = await token();
  const auth = { Authorization: `Bearer ${tk}` };

  const start = await fetch(`${BASE}/start/pdfocr`, { headers: auth }).then(r => r.json());
  if (!start.server || !start.task) throw new Error('iLovePDF start falhou: ' + JSON.stringify(start));
  const { server, task } = start;

  const form = new FormData();
  form.append('task', task);
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), nomeArquivo);
  const up = await fetch(`https://${server}/v1/upload`, { method: 'POST', headers: auth, body: form }).then(r => r.json());
  if (!up.server_filename) throw new Error('iLovePDF upload falhou: ' + JSON.stringify(up));

  const proc = await fetch(`https://${server}/v1/process`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task, tool: 'pdfocr',
      files: [{ server_filename: up.server_filename, filename: nomeArquivo }],
      ocr_languages: ['por'],
    }),
  }).then(r => r.json());
  if (proc.status !== 'TaskSuccess') throw new Error('iLovePDF OCR falhou: ' + JSON.stringify(proc));

  const down = await fetch(`https://${server}/v1/download/${task}`, { headers: auth });
  if (!down.ok) throw new Error(`iLovePDF download falhou (${down.status})`);
  return Buffer.from(await down.arrayBuffer());
}
