// Capturas em lote do Prancharia: modal, telas do projeto, escuro e móvel.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const raiz = process.cwd();
const PORTA_BFF = Number(process.env.PORTA_BFF || 3901), PORTA_WEB = Number(process.env.PORTA_WEB || 5901);
/* a pasta de saída é criada se não existir; sem SAIDA, vai para a pasta temporária */
const S = process.env.SAIDA || path.join(tmpdir(), 'prancharia-capturas'); const PREF = process.env.PREF || 'antes';
mkdirSync(S, { recursive: true });
const PW_DIR = path.join(process.env.LOCALAPPDATA, 'prancharia-e2e');
const CHROME = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
const dados = mkdtempSync(path.join(tmpdir(), 'prancharia-cap-'));
const procs = [];
const subir = (args, env = {}) => { const p = spawn(process.execPath, args, { cwd: raiz, env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); };
async function esperar(url) { for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); } throw new Error('não subiu ' + url); }
subir([path.join('server', 'simulador.mjs'), String(PORTA_BFF)], { DADOS_DIR: dados });
subir(['static-server.mjs', String(PORTA_WEB)]);
await esperar(`http://localhost:${PORTA_BFF}/api/health`); await esperar(`http://localhost:${PORTA_WEB}/local.html`);
const nav = await chromium.launch({ executablePath: CHROME });
const ctx = await nav.newContext({ viewport: { width: 1440, height: 940 } });
await ctx.addInitScript(b => localStorage.setItem('prancharia.nuvem', JSON.stringify({ base: b, modo: 'nuvem', escolhido: true })), `http://localhost:${PORTA_BFF}`);
const pg = await ctx.newPage(); const erros = [];
pg.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); }); pg.on('pageerror', e => erros.push(String(e).slice(0, 200)));
const cap = (n) => pg.screenshot({ path: path.join(S, `${PREF}-${n}.png`) });
await pg.goto(`http://localhost:${PORTA_WEB}/local.html`); await pg.waitForTimeout(2500);
await pg.click('.cabeca [data-acao="criarEmp"]'); await pg.waitForTimeout(600); await cap('modal');
await pg.fill('#empNome', 'Residencial Green Park'); await pg.fill('#empLocal', 'Curitiba / PR');
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForTimeout(1500); await cap('projeto-home');
for (const r of ['documentos', 'locais', 'produtos', 'revisao', 'exportar', 'config']) {
  await pg.evaluate(h => { location.hash = h; }, '#/' + r); await pg.waitForTimeout(900); await cap(r);
}
await pg.evaluate(h => { location.hash = h; }, '#/documentos'); await pg.waitForTimeout(500);
await pg.click('[data-acao="tema"]'); await pg.waitForTimeout(500); await cap('escuro-documentos');
await pg.evaluate(h => { location.hash = h; }, '#/empreendimentos'); await pg.waitForTimeout(700); await cap('escuro-empreendimentos');
await pg.click('[data-acao="tema"]'); await pg.waitForTimeout(300);
await pg.setViewportSize({ width: 400, height: 820 }); await pg.evaluate(h => { location.hash = h; }, '#/documentos'); await pg.waitForTimeout(900); await cap('movel-documentos');
await pg.click('#abrirMenu'); await pg.waitForTimeout(600); await cap('movel-menu');
await pg.setViewportSize({ width: 960, height: 820 }); await pg.waitForTimeout(600); await cap('medio-documentos');
console.log(`capturas ${PREF}-*.png em ${S}`);
console.log(erros.length ? 'ERROS: ' + erros.join(' | ') : 'sem erros de console');
await nav.close(); for (const p of procs) p.kill(); process.exit(erros.length ? 1 : 0);
