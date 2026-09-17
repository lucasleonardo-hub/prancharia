// Teste ponta a ponta base do Prancharia para esta máquina Windows.
// Uso: node .claude/skills/e2e/scripts/e2e-base.mjs   (na raiz do repo)
// Ver .claude/skills/e2e/SKILL.md para os pré-requisitos e as variáveis.
// Nota: `pagina.$eval` é a API do Playwright (avalia no navegador); não é eval() de string.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const raiz = process.cwd();
const PORTA_BFF = Number(process.env.PORTA_BFF || 3900);
const PORTA_WEB = Number(process.env.PORTA_WEB || 5900);
const ROTA = process.env.ROTA || '';
const PW_DIR = process.env.PW_DIR || path.join(process.env.LOCALAPPDATA || '', 'prancharia-e2e');
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const CAPTURA = process.env.CAPTURA || path.join(tmpdir(), `e2e-${Date.now()}.png`);

if (!existsSync(path.join(PW_DIR, 'node_modules', 'playwright-core'))) {
  console.error(`playwright-core não encontrado em ${PW_DIR}. Rode: cd "${PW_DIR}" && npm install playwright-core@1.58.0`);
  process.exit(1);
}
if (!existsSync(CHROME)) { console.error(`Chromium não encontrado em ${CHROME}`); process.exit(1); }
const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');

const dados = mkdtempSync(path.join(tmpdir(), 'prancharia-e2e-'));
const procs = [];
function subir(args, env = {}) {
  const p = spawn(process.execPath, args, { cwd: raiz, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${path.basename(args[0])}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${path.basename(args[0])}] ${d}`));
  procs.push(p);
  return p;
}
async function esperar(url, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`não respondeu: ${url}`);
}

subir([path.join('server', 'simulador.mjs'), String(PORTA_BFF)], { DADOS_DIR: dados });
subir(['static-server.mjs', String(PORTA_WEB)]);
await esperar(`http://localhost:${PORTA_BFF}/api/health`);
await esperar(`http://localhost:${PORTA_WEB}/local.html`);

const navegador = await chromium.launch({ executablePath: CHROME });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 940 } });
await contexto.addInitScript((base) => {
  localStorage.setItem('prancharia.nuvem', JSON.stringify({ base, modo: 'nuvem', escolhido: true }));
}, `http://localhost:${PORTA_BFF}`);
const pagina = await contexto.newPage();
const erros = [];
pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 300)); });
pagina.on('pageerror', (e) => erros.push(String(e).slice(0, 300)));

await pagina.goto(`http://localhost:${PORTA_WEB}/local.html${ROTA}`);
await pagina.waitForTimeout(3000);
console.log('\n=== #conteudo ===\n' + (await pagina.$eval('#conteudo', (e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 900))));
console.log('\n=== estado do sistema ===\n' + (await pagina.$eval('#estadoSistema', (e) => e.textContent.replace(/\s+/g, ' ').trim())));
await pagina.screenshot({ path: CAPTURA, fullPage: false });
console.log(`\ncaptura: ${CAPTURA}`);
console.log(erros.length ? `\nERROS DE CONSOLE (${erros.length}):\n- ` + erros.join('\n- ') : '\nsem erros de console');

await navegador.close();
for (const p of procs) p.kill();
process.exit(erros.length ? 1 : 0);
