// PreToolUse (Edit|Write): recusa qualquer escrita em arquivo .env*.
// As chaves (Gemini, Groq, Turso, Render, Vercel) vivem fora do código; o
// agente nunca precisa editá-las. Lê o JSON do hook em stdin e responde com
// a decisão de permissão no formato que o Claude Code espera.
import { readFileSync, writeSync } from 'node:fs';

let caminho = '';
try {
  caminho = JSON.parse(readFileSync(0, 'utf8') || '{}').tool_input?.file_path || '';
} catch {
  /* sem JSON: deixa passar */
}
const nome = caminho.split(/[\\/]/).pop() || '';
if (/^\.env(\..+)?$/i.test(nome) && !/\.exemplo$/i.test(nome)) {
  writeSync(1, JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Arquivo de segredos bloqueado pelo hook do projeto: ${nome}. Edite à mão; o modelo de referência é server/.env.exemplo.`,
    },
  }));
}
