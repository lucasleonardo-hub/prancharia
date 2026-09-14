/* Importação do Google Drive — Google Picker + Drive API v3, tudo no navegador.

   O fluxo:
     1. carrega os dois scripts do Google sob demanda (só quando a pessoa
        clica em "Importar do Google Drive" — a página não paga por eles
        antes disso);
     2. pede o token OAuth com o Google Identity Services (popup de login);
     3. abre o Picker para escolher vários PDFs e/ou uma pasta;
     4. pasta vira lista de PDFs (recursivo) pela Drive API;
     5. cada PDF é baixado com o token e vira um `File` — exatamente o que o
        <input type="file"> entregaria, então `receberArquivos()` em views.js
        trata os dois caminhos do mesmo jeito.

   Nada do Drive passa pelo BFF: o token fica na aba, os bytes vão do Google
   direto para a memória do navegador, e daí seguem o caminho de sempre
   (IndexedDB + upload para o servidor do Prancharia, quando houver).

   ┌─────────────────────────────────────────────────────────────────────┐
   │  ONDE COLOCAR AS SUAS CREDENCIAIS DO GOOGLE CLOUD CONSOLE            │
   │                                                                      │
   │  Preencha CLIENT_ID e API_KEY abaixo (ver o tutorial no LEIA-ME).    │
   │  Alternativas, sem editar o código:                                  │
   │    - no HTML, antes do módulo:                                       │
   │        window.PRANCHARIA_GOOGLE = { CLIENT_ID: '...', API_KEY: '...' }│
   │    - ou no console do navegador (fica gravado no localStorage):      │
   │        const d = await import('./js/core/drive.js');                 │
   │        d.configurarGoogle({ CLIENT_ID: '...', API_KEY: '...' });     │
   └─────────────────────────────────────────────────────────────────────┘ */

export const GOOGLE = {
  /* "ID do cliente OAuth 2.0" — projeto Google Cloud `projetalize`, cliente
     "Prancharia Web" (origens: localhost:8000, localhost:5500, prancharia.vercel.app).
     É um identificador público; o que protege é a lista de origens. */
  CLIENT_ID: '38901993498-kq48nqekhvrgt26rvnui3u2rh0dcqp02.apps.googleusercontent.com',
  /* "Chave de API" — chave "Prancharia Picker", restrita à Google Picker API e
     aos mesmos três sites. Chave de navegador: pública por natureza. */
  API_KEY: 'AIzaSyDgvEGF8q3-k-isxNrUBtdaXTZ98FJK8es',
  /* Opcional: o "Número do projeto" do Google Cloud. Melhora o Picker
     (mostra os arquivos que o app já abriu) e é exigido para alguns
     escopos. Pode ficar vazio. */
  APP_ID: '',
  /* `drive.readonly` é o que permite LISTAR o conteúdo de uma pasta. Com o
     escopo mais estreito (`drive.file`) o Picker até seleciona a pasta, mas a
     Drive API não deixa enumerar os PDFs dentro dela. */
  SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
  /* Quantos níveis de subpasta seguir ao importar uma pasta. */
  PROFUNDIDADE_MAXIMA: 4,
};

const CHAVE_CFG = 'prancharia.google';
try {
  const salvo = JSON.parse(localStorage.getItem(CHAVE_CFG) || 'null');
  if (salvo && typeof salvo === 'object') Object.assign(GOOGLE, salvo);
} catch { /* sem localStorage */ }
try {
  if (typeof window !== 'undefined' && window.PRANCHARIA_GOOGLE) Object.assign(GOOGLE, window.PRANCHARIA_GOOGLE);
} catch { /* sem window */ }

/** Guarda CLIENT_ID / API_KEY / APP_ID sem editar o arquivo. */
export function configurarGoogle(cfg = {}) {
  Object.assign(GOOGLE, cfg);
  try {
    localStorage.setItem(CHAVE_CFG, JSON.stringify({ CLIENT_ID: GOOGLE.CLIENT_ID, API_KEY: GOOGLE.API_KEY, APP_ID: GOOGLE.APP_ID }));
  } catch { /* vale só para esta sessão */ }
  token = null;
  return GOOGLE;
}

export const driveConfigurado = () => !!(GOOGLE.CLIENT_ID && GOOGLE.API_KEY);

/* ------------------------------------------------------------------ */
/* scripts do Google, carregados uma vez                               */
/* ------------------------------------------------------------------ */

const scripts = new Map();
function carregarScript(src) {
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = () => ok();
    s.onerror = () => { scripts.delete(src); erro(new Error(`não consegui carregar ${src} — a página está num sandbox sem acesso ao Google?`)); };
    document.head.appendChild(s);
  });
  scripts.set(src, p);
  return p;
}

let pickerPronto = null;
async function prepararGoogle() {
  if (!driveConfigurado()) {
    throw new Error('Google Drive não configurado: preencha CLIENT_ID e API_KEY em js/core/drive.js (ou chame configurarGoogle).');
  }
  await Promise.all([
    carregarScript('https://apis.google.com/js/api.js'),
    carregarScript('https://accounts.google.com/gsi/client'),
  ]);
  if (!pickerPronto) {
    pickerPronto = new Promise((ok, erro) => {
      window.gapi.load('picker', { callback: ok, onerror: () => erro(new Error('o Google Picker não carregou')) });
    });
  }
  await pickerPronto;
}

/* ------------------------------------------------------------------ */
/* OAuth: o token de acesso vive na aba, e só nela                     */
/* ------------------------------------------------------------------ */

let token = null;
let tokenExpira = 0;

async function obterToken() {
  if (token && Date.now() < tokenExpira - 60_000) return token;
  return new Promise((ok, erro) => {
    const cliente = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE.CLIENT_ID,
      scope: GOOGLE.SCOPES,
      callback: (r) => {
        if (!r || r.error) { erro(new Error(r?.error_description || r?.error || 'login recusado')); return; }
        token = r.access_token;
        tokenExpira = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        ok(token);
      },
      error_callback: (e) => erro(new Error(e?.type === 'popup_closed' ? 'login cancelado' : (e?.message || e?.type || 'falha no login do Google'))),
    });
    cliente.requestAccessToken({ prompt: token ? '' : 'consent' });
  });
}

/** Esquece o token (para trocar de conta Google). */
export function sairDoGoogle() {
  if (token && window.google?.accounts?.oauth2?.revoke) { try { window.google.accounts.oauth2.revoke(token); } catch { /* ok */ } }
  token = null; tokenExpira = 0;
}

/* ------------------------------------------------------------------ */
/* o Picker                                                            */
/* ------------------------------------------------------------------ */

const MIME_PASTA = 'application/vnd.google-apps.folder';
const MIME_PDF = 'application/pdf';

/** Abre o Picker e devolve o que a pessoa escolheu: [{ id, name, mimeType }]. */
async function escolherNoDrive(tokenAcesso) {
  const P = window.google.picker;
  return new Promise((ok) => {
    /* uma vista de PDFs (com pastas navegáveis e selecionáveis) e uma vista
       só de pastas — as duas aceitam seleção múltipla */
    const pdfs = new P.DocsView(P.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(`${MIME_PDF},${MIME_PASTA}`)
      .setLabel('PDFs e pastas');
    const pastas = new P.DocsView(P.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setLabel('Pastas');
    const b = new P.PickerBuilder()
      .setOAuthToken(tokenAcesso)
      .setDeveloperKey(GOOGLE.API_KEY)
      .setLocale('pt-BR')
      .setTitle('Escolha os PDFs das pranchas, ou a pasta inteira')
      .enableFeature(P.Feature.MULTISELECT_ENABLED)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .addView(pdfs)
      .addView(pastas)
      .setCallback((d) => {
        if (d.action === P.Action.PICKED) ok((d.docs || []).map(x => ({ id: x.id, name: x.name, mimeType: x.mimeType })));
        else if (d.action === P.Action.CANCEL) ok([]);
      });
    if (GOOGLE.APP_ID) b.setAppId(GOOGLE.APP_ID);
    try { b.setOrigin(window.location.protocol + '//' + window.location.host); } catch { /* ok */ }
    b.build().setVisible(true);
  });
}

/* ------------------------------------------------------------------ */
/* Drive API v3: listar pasta e baixar arquivo                         */
/* ------------------------------------------------------------------ */

const API = 'https://www.googleapis.com/drive/v3';

async function drive(rota, tokenAcesso, params = {}) {
  const u = new URL(API + rota);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('supportsAllDrives', 'true');
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tokenAcesso}` } });
  if (!r.ok) {
    let msg = `Drive respondeu ${r.status}`;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  return r;
}

/** Todos os PDFs de uma pasta, descendo nas subpastas até a profundidade. */
async function listarPdfsDaPasta(pastaId, tokenAcesso, profundidade = 0, caminho = '') {
  const out = [];
  let pageToken = '';
  do {
    const r = await drive('/files', tokenAcesso, {
      q: `'${pastaId}' in parents and trashed = false and (mimeType = '${MIME_PDF}' or mimeType = '${MIME_PASTA}')`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
      orderBy: 'name',
      ...(pageToken ? { pageToken } : {}),
    });
    const j = await r.json();
    for (const f of (j.files || [])) {
      if (f.mimeType === MIME_PASTA) {
        if (profundidade < GOOGLE.PROFUNDIDADE_MAXIMA) {
          out.push(...await listarPdfsDaPasta(f.id, tokenAcesso, profundidade + 1, caminho + f.name + '/'));
        }
      } else {
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size) || 0, caminho });
      }
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** Baixa um PDF do Drive e devolve um `File`, como o <input type="file"> daria. */
async function baixarPdf(arq, tokenAcesso) {
  const r = await drive(`/files/${encodeURIComponent(arq.id)}`, tokenAcesso, { alt: 'media' });
  const blob = await r.blob();
  const nome = /\.pdf$/i.test(arq.name) ? arq.name : arq.name + '.pdf';
  return new File([blob], nome, { type: MIME_PDF, lastModified: Date.now() });
}

/* ------------------------------------------------------------------ */
/* a porta de entrada                                                  */
/* ------------------------------------------------------------------ */

/**
 * Login → Picker → (pastas viram PDFs) → download. Devolve os `File`s prontos
 * para `receberArquivos()`, mais o que foi pulado e por quê.
 *
 * `aoProgredir(texto, fracao)` é chamado ao longo do download, para a barra.
 * Lança só quando nada pôde ser feito (sem configuração, login recusado,
 * scripts bloqueados); a falha de um arquivo específico vai para `pulados`.
 */
export async function importarDoDrive(aoProgredir = () => {}) {
  await prepararGoogle();
  const tk = await obterToken();
  const escolhidos = await escolherNoDrive(tk);
  if (!escolhidos.length) return { arquivos: [], pulados: [], cancelado: true };

  aoProgredir('listando o que foi escolhido no Drive', 0);
  const fila = [];
  const vistos = new Set();
  for (const d of escolhidos) {
    const itens = d.mimeType === MIME_PASTA ? await listarPdfsDaPasta(d.id, tk) : [d];
    for (const it of itens) {
      if (vistos.has(it.id)) continue;
      vistos.add(it.id);
      if (it.mimeType && it.mimeType !== MIME_PDF && !/\.pdf$/i.test(it.name || '')) continue;
      fila.push(it);
    }
  }

  const arquivos = [];
  const pulados = [];
  for (let i = 0; i < fila.length; i++) {
    const it = fila[i];
    aoProgredir(`baixando do Drive ${i + 1} de ${fila.length}: ${it.name}`, i / Math.max(1, fila.length));
    try { arquivos.push(await baixarPdf(it, tk)); }
    catch (e) { pulados.push({ nome: it.name, motivo: e.message }); }
  }
  aoProgredir('download concluído', 1);
  return { arquivos, pulados, cancelado: false, total: fila.length };
}
