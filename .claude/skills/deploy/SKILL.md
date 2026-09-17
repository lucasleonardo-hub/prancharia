---
name: deploy
description: Publica o Prancharia — frontend na Vercel (vercel --prod) e backend no Render (disparo pela API, porque o push não redeploya) — e confere /api/health no fim.
disable-model-invocation: true
---

# Deploy do Prancharia

Dois alvos, dois mecanismos. O push para o GitHub **não** dispara o Render:
todo deploy do histórico foi pela API. Leve até o fim; não espere webhook.

## 0. Decidir o que precisa subir

```bash
git status --short
git diff --stat origin/master..HEAD
```

- Mudou só `index.html`, `local.html`, `css/`, `js/`, `vendor/` → só Vercel.
- Mudou `server/` → Vercel **e** Render (o frontend costuma acompanhar).
- Mudou só `LEIA-ME.md`, `testes/`, `.claude/` → nada a publicar; diga isso e pare.

## 1. Commit e push

Se houver mudança não commitada, use `/commit` (plugin commit-commands) ou
commite normalmente. Depois:

```bash
git push origin master
```

## 2. Frontend na Vercel

O CLI já está logado e o projeto linkado em `.vercel/`. A raiz do site é
`local.html` (rewrite em `vercel.json`); `index.html` fica fora do deploy.

```bash
vercel --prod --yes
```

Guarde a URL que o comando imprime (produção: https://prancharia.vercel.app).

## 3. Backend no Render (só se `server/` mudou)

A chave fica em `~/.prancharia-render.env` (`RENDER_API_KEY` e
`RENDER_SERVICE_ID`), fora do repositório. Leia de lá; **não peça a chave ao
usuário e não a imprima**. Se a chave vier colada em dobro ("rnd_…El rnd_…"),
a certa é a curta (`rnd_` + 28 caracteres).

```bash
set -a; . ~/.prancharia-render.env; set +a
curl -s -X POST "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'
```

O build leva de 1 a 5 minutos. Acompanhe sem poll agressivo (uma consulta a
cada ~60 s):

```bash
curl -s "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys?limit=1" \
  -H "Authorization: Bearer $RENDER_API_KEY"
```

`status` termina em `live` (ok) ou `build_failed` / `update_failed` (abra os
logs no painel e relate o erro; não tente redeploy cego).

## 4. Conferir

```bash
curl -s https://prancharia-bff.onrender.com/api/health
```

A resposta lista as rotas e `persistente: true` (Turso ligado). Se vier
`persistente: false`, os dados vão sumir na hibernação: avise, é bloqueante
(ver `LEIA-ME.md`, "Banco persistente").

Abra https://prancharia.vercel.app e confirme que o rodapé da barra lateral
mostra o servidor compartilhado, não "só este navegador".

## 5. Relatar

Diga o que subiu (Vercel, Render ou ambos), a URL, o status do deploy do
Render e o resultado do `/api/health`. Se algo ficou de fora, diga qual e por quê.
