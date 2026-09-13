/* O Prancharia inteiro contra o servidor: cria empresa, cria projeto, processa
   uma prancha A0 de verdade, recarrega numa "segunda máquina" e confere que o
   levantamento sobreviveu à viagem. */
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { spawn } from 'child_process';
const root = '/home/claude/prancharia';
const PORTA_BFF = Number(process.env.PORTA_BFF || 3300);
const BFF = `http://localhost:${PORTA_BFF}`;
const DADOS = process.env.DADOS_DIR || '/tmp/prancharia-nuvtest';

/* O teste sobe o próprio servidor, num banco limpo: rodar duas vezes dá o
   mesmo resultado, e não depende de nada estar de pé antes. */
fs.rmSync(DADOS, { recursive: true, force: true });
const bff = spawn(process.execPath, ['--no-warnings', path.join(root, 'server/simulador.mjs'), String(PORTA_BFF)],
  { env: { ...process.env, DADOS_DIR: DADOS }, stdio: ['ignore', 'pipe', 'pipe'] });
bff.stdout.on('data', d => process.stdout.write('    [bff] ' + d));
bff.stderr.on('data', d => process.stdout.write('    [bff!] ' + d));
const encerrar = (codigo) => { try { bff.kill('SIGTERM'); } catch { /* já morreu */ } process.exit(codigo); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => encerrar(1));

for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BFF + '/api/health'); if (r.ok && (await r.json()).banco) break; } catch { /* ainda subindo */ }
  await new Promise(r => setTimeout(r, 250));
}
console.log(`  servidor de teste em ${BFF} · banco em ${DADOS}`);
const t = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.pdf':'application/pdf' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/local.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('nf'); }
  s.writeHead(200, { 'Content-Type': t[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8150, r));

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  FALHOU:', m); } else console.log('  ok:', m); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const abrir = async () => {
  /* contexto novo a cada chamada: IndexedDB e localStorage zerados, que é o
     que faz a "segunda máquina" ser de verdade uma segunda máquina */
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => { falhas++; console.log('  PAGEERROR:', e.message); });
  pg.on('console', m => { if (m.type() === 'error' && !/fonts|404|net::/.test(m.text())) console.log('  console:', m.text().slice(0, 160)); });
  await pg.addInitScript((bff) => { window.PRANCHARIA_NUVEM = { base: bff, modo: 'nuvem' }; }, BFF);
  await pg.goto('http://localhost:8150/local.html');
  await pg.waitForSelector('#nav button');
  return pg;
};

/* ---------- máquina 1 ---------- */
const pg = await abrir();
ok(await pg.evaluate(() => document.querySelector('[data-rota="empresas"]') !== null), 'a rota Empresas apareceu no menu');

await pg.click('[data-rota="empresas"]'); await pg.waitForSelector('#empNomeEmpresa', { timeout: 15000 });
ok((await pg.innerText('#conteudo')).includes('Nenhuma empresa cadastrada'), 'tela de empresas vazia, com explicação');

await pg.fill('#empNomeEmpresa', 'Construtora Alfa');
await pg.fill('#empRegras', 'Nesta empresa as varandas são chamadas de Terraço. O padrão de área comum é porcelanato 90x90.');
await pg.click('[data-acao="novoFornecedor"]'); await pg.waitForTimeout(200);
await pg.fill('#tabFornecedores tbody tr [data-campo="marca"]', 'Portobello');
await pg.fill('#tabFornecedores tbody tr [data-campo="fornecedor"]', 'Cerâmica Sul');
await pg.click('[data-acao="novoTermo"]'); await pg.waitForTimeout(200);
await pg.fill('#tabVocabulario tbody tr [data-campo="de"]', 'Varanda');
await pg.fill('#tabVocabulario tbody tr [data-campo="para"]', 'Terraço');
await pg.click('[data-acao="salvarEmpresa"]'); await pg.waitForTimeout(900);

const tela = await pg.innerText('#conteudo');
ok(tela.includes('Construtora Alfa'), 'empresa salva e listada');
ok(/1 marca\(s\)/.test(tela) && /1 termo\(s\)/.test(tela), 'marca e termo persistiram na mesma gravação');

await pg.click('[data-acao="verPromptEmpresa"]'); await pg.waitForTimeout(700);
const prompt = await pg.innerText('#promptEmpresa');
ok(prompt.includes('CONTEXTO DA EMPRESA: Construtora Alfa'), 'a tela mostra o bloco vindo do servidor');
ok(prompt.includes('E0.') && /PROIBIDO usá-lo para preencher/.test(prompt), 'a trava E0 está no texto que a IA vai ler');
ok(prompt.includes('"Varanda" nesta empresa se escreve "Terraço"'), 'o vocabulário entrou no prompt');
ok(prompt.includes('Portobello') && prompt.includes('Cerâmica Sul'), 'os fornecedores entraram no prompt');

/* projeto */
await pg.click('[data-rota="empreendimentos"]'); await pg.waitForTimeout(400);
await pg.click('[data-acao="criarEmp"]'); await pg.waitForSelector('#modal .modal-caixa');
await pg.fill('#empNome', 'Residencial Nuvem');
await pg.click('[data-tipo="cond_apartamentos"]'); await pg.waitForTimeout(150);
await pg.click('[data-acao="salvarEmpNovo"]'); await pg.waitForSelector('.placar');
const empId = await pg.evaluate(() => location.hash);
ok(true, 'projeto criado ' + empId);

await pg.click('[data-rota="documentos"]');
await pg.setInputFiles('#entradaDocs', [root + '/testdata/EX01SUB_TER_E_SUPR00.pdf', root + '/testdata/EX05PISOSUB_E_TERR01.pdf']);
console.log('  processando as duas pranchas A0…');
await pg.waitForFunction("document.querySelectorAll('table tbody tr').length>=2 && !document.querySelector('.progresso')", { timeout: 300000 });
await pg.waitForTimeout(2500);   // as gravações e os uploads terminarem

await pg.click('[data-rota="locais"]'); await pg.waitForSelector('.aba-modulo', { timeout: 20000 });
await pg.waitForTimeout(600);
const abas1 = await pg.$$eval('.aba-modulo', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
console.log('  abas na máquina 1:', abas1.join(' | '));

/* o que o servidor tem */
const proj = await (await fetch(`${BFF}/api/projects`)).json();
ok(proj.projetos.length === 1, 'o servidor tem 1 projeto');
ok(proj.projetos[0].empresaId, 'o projeto nasceu vinculado à empresa: ' + proj.projetos[0].empresaId);
ok(proj.projetos[0].bytes > 100000, `a árvore inteira subiu (${(proj.projetos[0].bytes/1024).toFixed(0)} KB)`);
const arqs = await (await fetch(`${BFF}/api/projects/${proj.projetos[0].id}/files`)).json();
ok(arqs.arquivos.length === 2, `as ${arqs.arquivos.length} prancha(s) subiram`);
const totalMb = arqs.arquivos.reduce((a, x) => a + x.bytes, 0) / 1048576;
ok(totalMb > 5, `${totalMb.toFixed(2)} MB de PDF no servidor`);
const todos = await (await fetch(`${BFF}/api/projects/${proj.projetos[0].id}/files`)).json();
ok(todos.arquivos.length === 2, `cada prancha subiu UMA vez (${todos.arquivos.length} registros para 2 pranchas)`);

/* ---------- máquina 2: outro navegador, IndexedDB vazio ---------- */
console.log('  --- segunda máquina (navegador limpo) ---');
const pg2 = await abrir();
await pg2.waitForTimeout(1200);
const lista2 = await pg2.innerText('#conteudo');
ok(lista2.includes('Residencial Nuvem'), 'a segunda máquina VÊ o projeto da primeira');

await pg2.click('button[data-acao="abrirEmpreendimento"]');
await pg2.waitForSelector('.placar', { timeout: 20000 });
await pg2.waitForTimeout(800);
await pg2.click('[data-rota="locais"]'); await pg2.waitForSelector('.aba-modulo', { timeout: 20000 });
await pg2.waitForTimeout(600);
const abas2 = await pg2.$$eval('.aba-modulo', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
console.log('  abas na máquina 2:', abas2.join(' | '));
ok(JSON.stringify(abas1) === JSON.stringify(abas2), 'o levantamento é IDÊNTICO nas duas máquinas');

/* e a prancha abre lá, tendo vindo do servidor */
await pg2.click('[data-rota="documentos"]'); await pg2.waitForTimeout(400);
const verDoc = await pg2.$('button[data-acao="verDoc"]');
if (verDoc) {
  await verDoc.click();
  await pg2.waitForTimeout(9000);
  const pintou = await pg2.evaluate(() => {
    const c = document.querySelector('.visor > canvas');
    if (!c) return 'sem canvas';
    const x = document.createElement('canvas'); x.width = c.width; x.height = c.height;
    const g = x.getContext('2d'); g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, x.width, x.height).data;
    let tinta = 0; for (let i = 0; i < d.length; i += 400) if (d[i] < 235) tinta++;
    return tinta;
  });
  ok(typeof pintou === 'number' && pintou > 30, `a PRANCHA ABRIU na segunda máquina, vinda do servidor (${pintou} amostras de traço)`);
} else { falhas++; console.log('  FALHOU: sem botão de abrir documento'); }

/* a empresa ativa também atravessou */
await pg2.click('[data-rota="empresas"]'); await pg2.waitForTimeout(600);
ok((await pg2.innerText('#conteudo')).includes('Construtora Alfa'), 'a memória da empresa está na segunda máquina');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nNUVEM: OK');
await b.close(); srv.close(); encerrar(falhas ? 1 : 0);
