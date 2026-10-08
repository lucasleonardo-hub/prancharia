# Prancharia

Leitura de pranchas e memoriais para o levantamento de acabamentos por local,
com evidência de cada dado. Equipe interna da Predialize; tudo em pt-BR.

Leia antes de mexer:

- `LEIA-ME.md` — arquitetura, pipeline híbrido (vetorial → IA), telas, servidor, modo nuvem.
- `PRODUCT.md` — verdade do produto: usuários, propósito, restrições confirmadas, princípios.
- `DESIGN.md` — sistema visual (tokens em `css/app.css` são a fonte; o arquivo descreve como aplicá-los).

## Regras que o código impõe e que você não relaxa

- **Nada sem evidência.** Item da IA sem `justificativa` é descartado no servidor (`sanear`); campo sem respaldo volta `""`, nunca `"N/A"`. Não afrouxe o saneamento para "melhorar a cobertura".
- **O vetor é a espinha.** A IA só `confirmar` / `completar` / `novo`; nunca substitui o que a leitura vetorial extraiu (`mesclarLeituras` em `js/core/engine.js`).
- **O documento vence** as regras de empresa (`E0` em `server/prompt.js`).
- **Modo local sem servidor precisa continuar funcionando.** Nenhuma funcionalidade essencial pode depender do BFF.
- **Layout da planilha MP/MC é fixo** (`js/core/vocab.js`, `js/core/exporter.js`). Não renomeie nem reordene colunas.

## Fatos que não estão no código

- **Render free tem disco efêmero.** Dados só persistem com `TURSO_DATABASE_URL`; `GET /api/health` deve responder `persistente: true`.
- **Push não redeploya o Render.** Publicar é `/deploy` (Vercel via `vercel --prod --yes`; Render via POST na API com a chave em `~/.prancharia-render.env`).
- **`testes/` não roda no Windows** (aponta para `/home/claude`). Use `/e2e`, que sobe `server/simulador.mjs` + `static-server.mjs` e o Chromium local.
- **Projeto de referência**: as plantas são raster (só o carimbo tem texto); locais vêm do memorial ou da leitura por imagem (Q12). Não perca tempo afinando `rooms.js` para elas.
- `index.html` (formato artifact, sem `<html>`) e `local.html` (documento completo, raiz da Vercel) têm o mesmo corpo: edite os dois.

## Ferramentas do projeto

- `/deploy` e `/e2e` em `.claude/skills/`; agentes `prompt-reviewer` e `security-reviewer` em `.claude/agents/` (use antes de publicar mudanças em `server/`).
- Hooks em `.claude/settings.json`: escrita em `.env*` é recusada; `node --check` roda após editar `.js`/`.mjs`.
- MCP em `.mcp.json`: `context7` (docs de Gemini SDK, Express, libsql) e `playwright` (navegar o `local.html`).
- Sem bundler, sem linter, sem TypeScript. ES modules puros; precisa de servidor estático (`node static-server.mjs 8000`).
- `vendor/libredwg` é o LibreDWG em WebAssembly (GPL, 9,5 MB), carregado sob demanda por `js/core/dwg.js`; não o importe no carregamento da página. DXF não é lido.
- **O servidor importa `js/core`** (`server/mcp.js` → `../js/core/*`) para o conector do Claude. Nenhum módulo de `js/core` importado ali pode puxar `pdfdoc.js`/`vendor/pdf.js` ou `ia.js` (dependem do navegador); `memorial.js` e `assistente.js` ficam de fora. No Render o repositório inteiro é clonado (rootDir `server`, `buildFilter` em `render.yaml`).
- **Conector MCP:** `POST /mcp` com chave fixa (`Authorization: Bearer`), chave em Configurações do site; escrita pelo Claude passa pelas mesmas regras (fonte ou justificativa, vocabulário controlado, `confirmar: true` para excluir). A tela detecta a concorrência pelo carimbo (`X-Base-Atualizado-Em` → 409) e sonda `/version` a cada 30 s.
- Commits em português, no imperativo, uma linha dizendo o efeito para o usuário (ver `git log`).
