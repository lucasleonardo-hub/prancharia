// PostToolUse (Edit|Write): `node --check` no .js/.mjs recém-editado.
// O projeto não tem linter nem build; sem isto um erro de sintaxe em
// server/*.js só aparece no cold start do Render. Sai com código 2 e a
// mensagem no stderr, que o Claude Code devolve ao modelo.
import { readFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let caminho = '';
try {
  const j = JSON.parse(readFileSync(0, 'utf8') || '{}');
  caminho = j.tool_response?.filePath || j.tool_input?.file_path || '';
} catch {
  caminho = '';
}
if (/\.m?js$/i.test(caminho) && !/[\\/]node_modules[\\/]/.test(caminho)) {
  const r = spawnSync(process.execPath, ['--check', caminho], { encoding: 'utf8' });
  if (r.status !== 0) {
    writeSync(2, `node --check falhou em ${caminho}:\n${(r.stderr || r.stdout || '').trim()}\n`);
    process.exitCode = 2;
  }
}
