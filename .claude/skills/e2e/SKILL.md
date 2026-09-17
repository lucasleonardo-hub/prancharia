---
name: e2e
description: Roda um teste ponta a ponta do Prancharia nesta máquina Windows — simulador do BFF + servidor estático + Chromium via playwright-core — para verificar uma mudança de interface ou do modo nuvem. Use antes de declarar concluída qualquer mudança em js/ui, js/app.js ou no fluxo de nuvem.
---

# Teste ponta a ponta (Windows)

Os scripts em `testes/` importam o Playwright de `/home/claude/...` e **não
rodam aqui**. Este skill traz a receita que funciona nesta máquina, com um
script base pronto em `scripts/e2e-base.mjs`.

## Pré-requisitos (uma vez por máquina)

```bash
PW="$LOCALAPPDATA/prancharia-e2e"
mkdir -p "$PW" && cd "$PW" && npm install playwright-core@1.58.0 --no-audit --no-fund
ls "$LOCALAPPDATA/ms-playwright/chromium-1243/chrome-win64/chrome.exe"
```

O Chromium já existe em `%LOCALAPPDATA%\ms-playwright\chromium-1243`; não
instale o pacote `playwright` completo (baixa navegadores à toa).

## Rodar

Duas portas livres (padrão 3900 para o simulador e 5900 para os arquivos):

```bash
cd "<raiz do repo>"
node .claude/skills/e2e/scripts/e2e-base.mjs
```

O script:

1. sobe `server/simulador.mjs` na porta do BFF com `DADOS_DIR` numa pasta
   limpa temporária (as rotas de dados são reais; só o modelo é simulado);
2. sobe `static-server.mjs` para os arquivos do frontend;
3. abre o Chromium com `localStorage['prancharia.nuvem']` já apontando para o
   simulador (via `addInitScript`), o que força o modo nuvem;
4. carrega `local.html`, coleta erros de console, tira uma captura em
   `e2e-*.png` na pasta temporária e imprime o texto de `#conteudo`;
5. derruba tudo no fim. Sai com código 1 se houve erro de console.

Variáveis úteis: `PORTA_BFF`, `PORTA_WEB`, `ROTA` (ex.: `#/documentos`),
`CAPTURA` (caminho do PNG), `PW_DIR` (onde está o `playwright-core`).

## Estender

Copie o script base para o scratchpad e acrescente passos depois de
`await pagina.goto(...)`. Padrões que já se provaram:

- **"Outro navegador"**: `await navegador.newContext()` cria um contexto sem
  localStorage nem IndexedDB; é como testar que os dados vieram do servidor.
- **Projeto de exemplo**: o memorial de referência tem texto e basta para
  criar os locais; as plantas são raster e só rendem locais com o BFF real e a
  chave do Gemini.
- **Modo lento/falha do simulador**: `LENTO=1` e `FALHAR=1` no ambiente do
  simulador testam a barra de progresso e o disjuntor.

Relate: o que foi verificado, erros de console (se houver) e o caminho da
captura. Se o Chromium não abrir, informe a versão da pasta `ms-playwright`
e o erro exato, sem tentar instalar o Playwright completo.
