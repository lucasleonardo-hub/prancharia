/* O "serviço de login" que o claude.ai procura ao adicionar um conector.

   Quando o conector responde 401 sem credencial, o cliente MCP segue a
   especificação de autorização: lê os metadados do recurso protegido
   (/.well-known/oauth-protected-resource), acha o servidor de autorização,
   registra-se nele (Dynamic Client Registration), manda a pessoa à página
   de autorização e troca o código por um token (OAuth 2.1 com PKCE). Sem
   nada disso, o claude.ai mostra "não foi possível registrar no serviço de
   login".

   Aqui o servidor de autorização é o próprio BFF, e a "senha" da página de
   login é a chave do conector (Configurações → Claude): quem a tem recebe um
   token de 30 dias que vale no /mcp como a chave vale. Não há contas nem
   usuários — é a mesma decisão do produto, com a cerimônia que o cliente
   pede. Tudo o que persiste (clientes registrados, códigos, tokens) mora na
   tabela config, com os tokens guardados só como hash. */

import crypto from 'node:crypto';
import express from 'express';

const DIAS_TOKEN = 30, DIAS_REFRESH = 90, MIN_CODIGO = 10;
const MAX_CLIENTES = 50;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('base64url');
const aleatorio = n => crypto.randomBytes(n).toString('base64url');
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function lerEstado(banco) {
  try { return JSON.parse((await banco.lerConfig('oauth')) || '') || {}; } catch { return {}; }
}
async function gravarEstado(banco, s) { await banco.salvarConfig('oauth', JSON.stringify(s)); }
function arrumar(s) {
  for (const k of ['clientes', 'codigos', 'tokens', 'refresh']) s[k] = s[k] || {};
  const agora = Date.now();
  for (const k of ['codigos', 'tokens', 'refresh']) for (const [id, v] of Object.entries(s[k])) if (!v || !v.exp || v.exp < agora) delete s[k][id];
  /* os clientes não expiram, mas a lista não cresce sem limite */
  const ids = Object.keys(s.clientes).sort((a, b) => (s.clientes[a].criado || 0) - (s.clientes[b].criado || 0));
  while (ids.length > MAX_CLIENTES) delete s.clientes[ids.shift()];
  return s;
}

const REDIRECT_OK = /^(https:\/\/[^\s/?#]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/[^\s#]*)?$/;

/* tentativas de senha por endereço: a chave é longa, mas força bruta não
   precisa ser ajudada */
const tentativas = new Map();
function limitar(ip) {
  const agora = Date.now();
  const t = tentativas.get(ip) || { n: 0, desde: agora };
  if (agora - t.desde > 15 * 60 * 1000) { t.n = 0; t.desde = agora; }
  t.n++; tentativas.set(ip, t);
  return t.n <= 20;
}

function pagina({ titulo, corpo }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#1f2430;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
main{background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:28px;max-width:460px;width:100%}h1{font-size:19px;margin:0 0 6px}p{margin:8px 0;color:#4a5160}
label{display:block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-top:16px}input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfd4db;border-radius:8px;font:inherit;margin-top:6px}
button{margin-top:16px;padding:10px 16px;border:0;border-radius:8px;background:#3e4396;color:#fff;font:inherit;font-weight:600;cursor:pointer}.erro{color:#b42318;background:#fef3f2;border:1px solid #fecdca;padding:8px 10px;border-radius:8px}
small{color:#6b7280}code{background:#f0f1f3;padding:1px 5px;border-radius:4px}</style></head><body><main>${corpo}</main></body></html>`;
}

/**
 * Monta os metadados, o registro, a autorização e o token no Express.
 * Devolve { tokenValido(token) } para o /mcp aceitar os tokens emitidos.
 */
export function montarOauth(app, { banco, chaveDoConector, chaveConfere, urlPublica }) {
  const metaRecurso = (req, res) => res.json({
    resource: urlPublica(req) + '/mcp', authorization_servers: [urlPublica(req)],
    bearer_methods_supported: ['header'], scopes_supported: ['prancharia'],
  });
  app.get('/.well-known/oauth-protected-resource', metaRecurso);
  app.get('/.well-known/oauth-protected-resource/mcp', metaRecurso);

  const metaServidor = (req, res) => {
    const b = urlPublica(req);
    res.json({
      issuer: b, authorization_endpoint: b + '/oauth/authorize', token_endpoint: b + '/oauth/token', registration_endpoint: b + '/oauth/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['prancharia'],
    });
  };
  app.get('/.well-known/oauth-authorization-server', metaServidor);
  app.get('/.well-known/oauth-authorization-server/mcp', metaServidor);
  app.get('/.well-known/openid-configuration', metaServidor);

  /* registro dinâmico: o cliente diz para onde pode ser redirecionado */
  app.post('/oauth/register', async (req, res) => {
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const uris = (Array.isArray(b.redirect_uris) ? b.redirect_uris : []).filter(u => typeof u === 'string' && u.length < 500 && REDIRECT_OK.test(u)).slice(0, 10);
      if (!uris.length) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris https são obrigatórios' });
      const s = arrumar(await lerEstado(banco));
      const id = 'cli_' + aleatorio(12);
      s.clientes[id] = { redirect_uris: uris, nome: String(b.client_name || '').slice(0, 80), criado: Date.now() };
      await gravarEstado(banco, s);
      res.status(201).json({
        client_id: id, client_name: s.clientes[id].nome, redirect_uris: uris,
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      });
    } catch (e) { console.error('[oauth] register', e.message); res.status(500).json({ error: 'server_error' }); }
  });

  const lerPedido = (q, clientes) => {
    const p = {
      client_id: String(q.client_id || ''), redirect_uri: String(q.redirect_uri || ''), state: String(q.state || '').slice(0, 512),
      code_challenge: String(q.code_challenge || ''), code_challenge_method: String(q.code_challenge_method || 'S256'),
      scope: String(q.scope || 'prancharia').slice(0, 200), resource: String(q.resource || '').slice(0, 500),
    };
    const c = clientes[p.client_id];
    if (!c) return { erro: 'client_id desconhecido — registre o cliente de novo' };
    if (!c.redirect_uris.includes(p.redirect_uri)) return { erro: 'redirect_uri não registrada para este cliente' };
    if (String(q.response_type || 'code') !== 'code') return { erro: 'response_type precisa ser code' };
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge) || p.code_challenge_method !== 'S256') return { erro: 'PKCE S256 é obrigatório' };
    return { pedido: p };
  };

  const formulario = (p, erro = '') => pagina({
    titulo: 'Prancharia — autorizar o Claude',
    corpo: `<h1>Autorizar o Claude no Prancharia</h1>
      <p>O Claude quer ler e editar os empreendimentos do Prancharia. Cole a <b>chave do conector</b> — ela está em <b>Configurações → Claude (conector MCP)</b> no site.</p>
      ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
      <form method="post" action="/oauth/authorize">
        ${['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'].map(k => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join('')}
        <label for="chave">Chave do conector</label>
        <input id="chave" name="chave" type="password" autocomplete="off" required autofocus>
        <button type="submit">Autorizar</button>
      </form>
      <p><small>O acesso vale por ${DIAS_TOKEN} dias e pode ser cortado em "Gerar nova chave" no site.</small></p>`,
  });

  app.get('/oauth/authorize', async (req, res) => {
    const s = arrumar(await lerEstado(banco));
    const { erro, pedido } = lerPedido(req.query, s.clientes);
    if (erro) return res.status(400).type('html').send(pagina({ titulo: 'Pedido inválido', corpo: `<h1>Pedido de autorização inválido</h1><p class="erro">${esc(erro)}</p><p>Volte ao claude.ai e tente adicionar o conector de novo.</p>` }));
    res.type('html').send(formulario(pedido));
  });

  app.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    const s = arrumar(await lerEstado(banco));
    const { erro, pedido } = lerPedido(req.body || {}, s.clientes);
    if (erro) return res.status(400).type('html').send(pagina({ titulo: 'Pedido inválido', corpo: `<h1>Pedido de autorização inválido</h1><p class="erro">${esc(erro)}</p>` }));
    const ip = req.get('x-forwarded-for') || req.ip || '';
    if (!limitar(ip)) return res.status(429).type('html').send(formulario(pedido, 'Muitas tentativas. Espere 15 minutos.'));
    const { chave } = await chaveDoConector(banco);
    if (!chaveConfere(String((req.body || {}).chave || '').trim(), chave)) return res.status(401).type('html').send(formulario(pedido, 'Chave incorreta. Copie-a de Configurações → Claude no site.'));
    const codigo = aleatorio(32);
    s.codigos[sha(codigo)] = { client_id: pedido.client_id, redirect_uri: pedido.redirect_uri, code_challenge: pedido.code_challenge, scope: pedido.scope, exp: Date.now() + MIN_CODIGO * 60 * 1000 };
    await gravarEstado(banco, s);
    const destino = new URL(pedido.redirect_uri);
    destino.searchParams.set('code', codigo);
    if (pedido.state) destino.searchParams.set('state', pedido.state);
    res.redirect(302, destino.toString());
  });

  const emitir = (s, client_id, scope) => {
    const access = 'pat_' + aleatorio(32), refresh = 'prt_' + aleatorio(32);
    s.tokens[sha(access)] = { client_id, scope, exp: Date.now() + DIAS_TOKEN * 86400000 };
    s.refresh[sha(refresh)] = { client_id, scope, exp: Date.now() + DIAS_REFRESH * 86400000 };
    return { access_token: access, token_type: 'Bearer', expires_in: DIAS_TOKEN * 86400, refresh_token: refresh, scope };
  };

  app.post('/oauth/token', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const s = arrumar(await lerEstado(banco));
      res.set('Cache-Control', 'no-store');
      if (b.grant_type === 'authorization_code') {
        const c = s.codigos[sha(String(b.code || ''))];
        if (!c) return res.status(400).json({ error: 'invalid_grant', error_description: 'código inválido ou expirado' });
        delete s.codigos[sha(String(b.code || ''))];               // uso único, mesmo que o resto falhe
        const verificador = String(b.code_verifier || '');
        const ok = c.client_id === String(b.client_id || c.client_id) && (!b.redirect_uri || c.redirect_uri === String(b.redirect_uri))
          && /^[A-Za-z0-9._~-]{43,128}$/.test(verificador) && sha(verificador) === c.code_challenge;
        if (!ok) { await gravarEstado(banco, s); return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE, cliente ou redirect_uri não conferem' }); }
        const r = emitir(s, c.client_id, c.scope);
        await gravarEstado(banco, s);
        return res.json(r);
      }
      if (b.grant_type === 'refresh_token') {
        const k = sha(String(b.refresh_token || ''));
        const r0 = s.refresh[k];
        if (!r0) return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh_token inválido ou expirado' });
        delete s.refresh[k];                                        // rotação: cada refresh vale uma vez
        const r = emitir(s, r0.client_id, r0.scope);
        await gravarEstado(banco, s);
        return res.json(r);
      }
      return res.status(400).json({ error: 'unsupported_grant_type' });
    } catch (e) { console.error('[oauth] token', e.message); res.status(500).json({ error: 'server_error' }); }
  });

  return {
    async tokenValido(token) {
      if (!token || !/^pat_/.test(token)) return false;
      const s = await lerEstado(banco);
      const t = (s.tokens || {})[sha(token)];
      return !!(t && t.exp > Date.now());
    },
    /* "Gerar nova chave" no site derruba também os tokens emitidos */
    async revogarTudo() { await gravarEstado(banco, { clientes: (await lerEstado(banco)).clientes || {}, codigos: {}, tokens: {}, refresh: {} }); },
  };
}
