---
name: Prancharia
description: Ferramenta de trabalho densa e neutra — a tabela e a prancha são o conteúdo, o cromo quase desaparece.
colors:
  ground: "#f7f7f8"
  surface: "#ffffff"
  surface-2: "#f3f3f5"
  surface-3: "#ebebee"
  ink: "#1c1d21"
  ink-2: "#5c5f66"
  ink-3: "#767a83"
  line: "rgba(20, 21, 26, 0.08)"
  line-strong: "rgba(20, 21, 26, 0.16)"
  accent: "#2c5fd6"
  accent-forte: "#2450b8"
  accent-ink: "#ffffff"
  accent-soft: "rgba(44, 95, 214, 0.10)"
  bom: "#1a7f4b"
  bom-soft: "rgba(26, 127, 75, 0.10)"
  atencao: "#9a6700"
  atencao-soft: "rgba(154, 103, 0, 0.11)"
  critico: "#c2362b"
  critico-soft: "rgba(194, 54, 43, 0.09)"
  circulo: "#1f6fd0"
  triangulo: "#8b3fd1"
  quadrado: "#1a7f4b"
  pentagono: "#b3610a"
typography:
  title:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  subtitle:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  body-secondary:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.05em"
    lineHeight: 1.3
  mono:
    fontFamily: "Source Code Pro, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    fontFeature: "tabular-nums"
  mono-small:
    fontFamily: "Source Code Pro, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    fontFeature: "tabular-nums"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  "1": "4px"
  "2": "6px"
  "3": "8px"
  "4": "10px"
  "5": "12px"
  "6": "14px"
  "7": "16px"
  "8": "20px"
  "9": "24px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-active:
    backgroundColor: "{colors.surface-3}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-forte}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.critico}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-small:
    padding: "0 8px"
    height: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  chip-neutral:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  chip-good:
    backgroundColor: "{colors.bom-soft}"
    textColor: "{colors.bom}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  chip-warning:
    backgroundColor: "{colors.atencao-soft}"
    textColor: "{colors.atencao}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  chip-critical:
    backgroundColor: "{colors.critico-soft}"
    textColor: "{colors.critico}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  pill-mono:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono-small}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "12px 14px 14px"
  panel-header:
    padding: "8px 14px"
    height: "40px"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "7px 12px"
  table-row:
    padding: "7px 12px"
    height: "34px"
  table-row-hover:
    backgroundColor: "{colors.surface-2}"
  table-row-selected:
    backgroundColor: "{colors.accent-soft}"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  nav-item-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  nav-item-current:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
  sidebar:
    backgroundColor: "{colors.ground}"
    width: "232px"
  topbar:
    backgroundColor: "{colors.ground}"
    height: "44px"
  inspector:
    backgroundColor: "{colors.surface}"
    width: "360px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    width: "720px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  local-row:
    backgroundColor: "{colors.surface}"
    padding: "6px 14px"
    height: "40px"
  card-empreendimento:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "14px"
---

# Design System: Prancharia

## Overview

**Creative North Star: "A mesa de trabalho que some"**

Prancharia é uma ferramenta de operação para sessões longas de revisão linha a linha. A tabela de acabamentos e a prancha são o conteúdo; todo o resto (barra lateral, barra superior, inspetor) é cromo que se afasta para o cinza e só volta a aparecer quando o ponteiro ou o teclado o chamam. A régua de acabamento é a das ferramentas que a equipe usa o dia inteiro (Linear, Figma): cinzas quase sem cor, divisórias de 1 px, tipografia de trabalho em 13 px, um único acento que marca ação, seleção e foco, e o teclado em tudo. É a execução do padrão da categoria, escolhida de propósito; direções expressivas foram vistas e recusadas (PRODUCT.md, compromissos de marca).

Quatro decisões governam o sistema. **Cor só onde significa**: o acento cobalto, os três estados (bom, atenção, crítico) e as quatro formas geométricas das tags são as únicas cores, e nunca aparecem como decoração. **Divisória, não sombra**: superfícies se separam por uma linha translúcida de 1 px; sombra só no que flutua de verdade. **Densidade como respeito**: numa tela com 200 linhas de acabamento, a linha de 34 px e o cabeçalho de 11 px são o que deixa a sessão longa possível. **Movimento com gramática Material**: entradas desaceleram forte em `cubic-bezier(.05, .7, .1, 1)`, saídas aceleram em `cubic-bezier(.3, 0, .8, .15)` e são mais curtas; três durações (140 ms feedback, 220 ms mudança de estado, 340 ms mudança de leiaute); só transform, opacidade, cor e a coluna do inspetor animam, e o canvas do visor nunca recebe transição.

O sistema recusa o painel de cartões brancos flutuando sobre cinza com botão índigo (a fórmula que denuncia geração automática), a grade cinza do CAD antigo e qualquer vocabulário de marketing: sem heróis, sem gradientes, sem cartões de KPI, sem bordas laterais coloridas.

**Key Characteristics:**
- Cromo em cinza quase sem cor; conteúdo (tabela, prancha) é o único protagonista.
- Um acento cobalto (claro #2c5fd6 / escuro #6f9bff) reservado a ação primária, seleção e foco.
- Tipografia de trabalho: Source Sans 3 em 13 px para a interface, Source Code Pro com tabular-nums para números, códigos e tags.
- Divisórias de 1 px em rgba em vez de sombras; sombra só em modal, popover, legenda do visor e toast.
- Linhas de tabela de 34 px, rótulos estruturais de 11 px em caixa alta, botões de 28 px com atalho de teclado visível.
- Inspetor de evidência fixo à direita (360 px), lado a lado com a tabela a partir de 1080 px.
- Tema escuro nativo: fundo quase preto com superfícies um passo acima, não uma inversão do claro.

## Colors

Cinzas quase sem cor formam o cromo; o cobalto e as cores de estado aparecem apenas onde carregam significado. Os valores no frontmatter são o tema claro; o tema escuro (`prefers-color-scheme: dark` ou `data-theme="dark"`) redefine cada token na folha de estilo e está registrado no sidecar.

### Primary
- **Cobalto** (`accent`): botão primário, linha selecionada (fundo `accent-soft` mais barra interna de 2 px), cartão atual, item ativo da legenda, caret de campos, seleção de texto (22 %), cor de link e barra de progresso. No escuro clareia para `#6f9bff` sobre `#0f1012`.
- **Cobalto forte** (`accent-forte`): só o hover do botão primário.
- **Anel de foco**: `0 0 0 2px rgba(44, 95, 214, .35)` (`--anel`), aplicado a `:focus-visible`, campos em foco e zona de soltar ativa.

### Secondary (estados)
- **Bom** (`bom` / `bom-soft`): verde de confirmação; chip, ponto de status do sistema, texto `.tom-bom`.
- **Atenção** (`atencao` / `atencao-soft`): âmbar de pendência; chip, faixa de aviso, número de alerta no placar, cabeçalho do painel de triagem em destaque.
- **Crítico** (`critico` / `critico-soft`): vermelho de erro; chip, faixa crítica, botão de perigo, número em alerta.
- Os fundos "soft" são a própria cor a 9–11 % de opacidade sobre a superfície; o texto do chip é a cor cheia.

### Tertiary (as quatro formas da prancha)
- **Círculo** (`circulo`), **Triângulo** (`triangulo`), **Quadrado** (`quadrado`), **Pentágono** (`pentagono`): cor do glifo e do código da tag de acabamento (`.forma`, 12 px de SVG mais texto mono de 11 px). São a única cor além do acento e dos estados, e carregam a semântica da prancha, não decoração. O quadrado compartilha o verde de `bom` de propósito.

### Neutral
- **Fundo** (`ground`): corpo da página, barra lateral e barra superior.
- **Superfície** (`surface`): painéis, tabela, inspetor, modal, botões, campos.
- **Superfície 2** (`surface-2`): cabeçalho de tabela, linha de grupo, hover de linha/botão/item de menu, barra de lote, nó de rastreabilidade.
- **Superfície 3** (`surface-3`): item de menu atual, botão pressionado, chip neutro e pílula, fundo do visor e do recorte.
- **Tinta** (`ink`): texto principal, títulos, fundo do toast.
- **Tinta 2** (`ink-2`): descrições, cabeçalho de tabela, texto de botão discreto, item de menu em repouso.
- **Tinta 3** (`ink-3`): rótulos estruturais, contagens, metadados, legendas.
- **Linha** (`line`): toda divisória em repouso (borda de painel, linha de tabela, borda da barra lateral e do inspetor).
- **Linha forte** (`line-strong`): borda de botão, campo, `<kbd>`, chip apagado, fio da cadeia de evidência, polegar da barra de rolagem.

### Named Rules
**The Only-Where-It-Means Rule.** O acento aparece em ação primária, seleção e foco; estados e formas aparecem só quando carregam o dado. Nenhuma cor é decoração; um elemento colorido sem significado é um defeito.

**The Translucent Divider Rule.** Divisórias são rgba (`line` a 8 %, `line-strong` a 16 %) e por isso pousam corretas em qualquer superfície dos dois temas. Nunca use um cinza opaco para separar.

**The Dark Is Not Inverted Rule.** O escuro não espelha o claro: fundo quase preto (`#0f1012`), superfícies um passo acima (`#17181b`, `#1e2024`, `#27292e`), acento e estados clareados para manter contraste, sombra do popover mais funda.

## Typography

**Display Font:** nenhum; o maior tamanho é o título de tela em 18 px.
**Body Font:** Source Sans 3 (com system-ui, Segoe UI, Roboto, sans-serif) — variável, subconjunto latino, hospedada em `fonts/`.
**Label/Mono Font:** Source Code Pro (com ui-monospace, Menlo, monospace) — variável, subconjunto latino, hospedada em `fonts/`.

**Character:** Tipografia de trabalho, não de leitura editorial. A sans humanista fica em 13 px o dia inteiro; a mono entra sempre que o dado é número, código, tag ou contagem, com `tabular-nums` para as colunas alinharem. As duas famílias moram no repositório para que o modo local sem rede leia com a mesma tipografia do site publicado.

### Hierarchy
- **Title** (600, 18 px, 1.3): título de tela em `.cabeca h1` (16 px abaixo de 720 px). Único tamanho acima de 15 px.
- **Subtitle** (600, 14–15 px, 1.3): título do inspetor e do modal (15 px), título do cartão de empreendimento (15 px), do local em cartão e do estado vazio (14 px).
- **Body** (400, 13 px, 1.45): corpo, células de tabela (1.4), botões (500), descrições, campos, itens de menu, títulos de painel (600).
- **Body secondary** (400, 12 px, 1.4): metadados, ajuda de campo, contagens de filtro, legendas do visor, botão pequeno, campos de tabela, abas de prova.
- **Label** (600, 11 px, .05em, CAIXA ALTA, `ink-3`): rótulo estrutural — cabeçalho de coluna, nome de campo, grupo do menu, termos do placar, nome de categoria, rótulos da cadeia e da ficha. Nunca acima de um título como chamada.
- **Mono** (500, 12 px, tabular): células numéricas (`.num`).
- **Mono small** (500, 11 px, tabular): pílulas de código, tags de forma, contagem do menu, `<kbd>` (10 px), legenda do recorte.

### Named Rules
**The Thirteen-Pixel Rule.** A interface vive em 13 px. Títulos sobem no máximo a 18 px; nada desce de 10 px. Peso 600 marca hierarquia; 500 é reservado a botões, chips e pílulas; 400 é o resto.

**The Mono-For-Data Rule.** Número, código, tag, contagem e atalho vão em Source Code Pro com `tabular-nums`. Texto corrido nunca vai em mono; dado nunca vai em sans proporcional.

**The Structural Label Rule.** O rótulo de 11 px em caixa alta nomeia estrutura (coluna, campo, grupo, categoria). Não é uma chamada acima de título e não introduz seções de prosa.

## Layout

A casca é uma grade de duas colunas: barra lateral de 232 px (`sidebar`) fixa à esquerda com o fundo da página e divisória à direita, e a área principal com barra superior de 44 px (`topbar`) fixa no topo, também em `ground` com divisória abaixo. O conteúdo tem `14px 20px 64px` de padding e empilha blocos com 16 px de intervalo (`.faixa`). O cabeçalho de tela é uma linha: botão voltar, título de 18 px, chips, descrição opcional de até 76ch, ações à direita.

O inspetor de evidência (`inspector`, 360 px) é fixo à direita. A partir de 1080 px ele fica lado a lado com a tabela (`body.inspetor #principal` recebe `padding-right: 360px`) e não há véu; o cabeçalho da tabela gruda logo abaixo da barra (`top: 44px`). Abaixo de 1080 px o inspetor vira painel deslizante (`min(420px, 100%)`) com sombra e véu a 40 %, e a barra lateral colapsa para 56 px só com ícones. Abaixo de 720 px a barra lateral vira gaveta de 260 px com véu, o conteúdo reduz para `10px 12px 56px`, e as ações do cabeçalho ocupam a largura toda.

Ritmo de espaçamento observado: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 px. Intervalos entre botões e chips são 4–6 px; entre campos, 10–12 px; padding interno de painel `12px 14px 14px`; célula de tabela `7px 12px` (14 px nas bordas externas); grades de cartões `minmax(230px, 1fr)` para locais em cartão e `minmax(300px, 1fr)` para empreendimentos, com 8–10 px de intervalo.

Atalhos de teclado são parte do layout: `↑`/`↓` percorrem linhas, `Enter` foca o inspetor, `Esc` fecha. Os capacetes `<kbd>` aparecem inline no cabeçalho e no botão de fechar, e somem abaixo de 1080 px ou em dispositivos sem hover (`.atalhos`, `kbd.so-teclado`).

## Elevation & Depth

Camadas tonais e divisórias, não sombras. Um painel é `surface` com borda de 1 px em `line`; hover sobe para `surface-2`; ativo ou atual sobe para `surface-3`. Seleção e foco não elevam: a linha selecionada recebe fundo `accent-soft` e uma barra interna de 2 px em acento (`inset 2px 0 0`); o cartão atual recebe borda em acento reforçada por `inset 0 0 0 1px`.

### Shadow Vocabulary
- **Sombra de pop** (`box-shadow: 0 1px 2px rgba(20, 21, 26, .06), 0 8px 24px -8px rgba(20, 21, 26, .18)`; no escuro `0 1px 2px rgba(0, 0, 0, .4), 0 12px 32px -8px rgba(0, 0, 0, .7)`): exclusivamente no que flutua sobre a tela — modal, legenda flutuante do visor, toast, inspetor e barra lateral só quando viram painel deslizante sob véu.
- **Anel de foco** (`box-shadow: 0 0 0 2px rgba(44, 95, 214, .35)`): não é elevação; é o estado de foco visível em qualquer elemento.
- **Véu** (`rgba(15, 16, 18, .4)`): atrás de modal, inspetor deslizante e gaveta lateral.

### Named Rules
**The Divider-Not-Shadow Rule.** Superfícies em repouso nunca têm sombra. Se um elemento precisa de sombra, ele precisa flutuar de verdade (modal, popover, legenda do visor, toast); caso contrário, use uma divisória de 1 px ou um passo de superfície.

## Shapes

Cantos discretos e uniformes: 6 px (`md`) é o raio padrão de botão, campo, painel, cartão, item de menu, faixa de aviso, recorte e toast; 4 px (`sm`) para chips, pílulas, campos dentro de tabela, célula editável, miniaturas e o número do nível de zoom; 3 px (`xs`) só no `<kbd>`; 8 px (`lg`) só na caixa do modal. Pontos de estado e de papel são círculos de 6–7 px; o quadradinho de categoria tem 7 px com raio de 2 px.

Bordas são sempre 1 px sólido em `line` (repouso) ou `line-strong` (controles). Tracejado em `line-strong` marca o que ainda não existe: zona de soltar, input de arquivo e cartão de local proposto. Ícones são SVG de 16 px com `stroke-width: 1.6` e `fill: none` (14 px dentro de botões, 20 px na zona de soltar); onde um glifo de texto não serve, o ícone é desenhado em CSS com bordas de 1.5 px (`.ico-aviso` círculo com "!", `.ico-voltar` chevron, `.ico-fechar` X, marcador de `<details>`). Não há gradientes, nem bordas laterais coloridas, nem cantos maiores que 8 px.

## Components

### Buttons
Discretos e uniformes; o acento aparece uma vez por tela, no botão primário.
- **Shape:** cantos de 6 px, altura 28 px (`button`), padding `0 10px`, peso 500, 13 px, ícone de 14 px com 6 px de intervalo; variante pequena de 24 px, `0 8px`, 12 px (`button-small`).
- **Default:** `surface` com borda de 1 px em `line-strong`, texto em `ink`; hover `surface-2`; ativo `surface-3`.
- **Primary** (`button-primary`): fundo em acento, texto branco, sem borda visível; hover em `accent-forte`. Um por tela.
- **Ghost** (`button-ghost`, `.discreto`): sem fundo nem borda, texto em `ink-2`; hover `surface-2` e `ink`. É o botão de ações secundárias, do voltar e do fechar.
- **Danger** (`button-danger`): fundo em `critico`, texto branco; hover escurece 15 %.
- **Link** (`.btn.link`): inline, cor do acento, sublinha no hover; sem altura própria.
- **Disabled:** opacidade .45 e cursor `not-allowed`.
- **Keyboard cap:** `<kbd>` de 10 px mono em `ink-3`, borda `line-strong`, raio 3 px, dentro do botão com 2 px de margem à esquerda.
- **Transition:** fundo, borda e cor em 140 ms com a curva de entrada; ao pressionar, `scale(.985)` em 60 ms.

### Chips
Selos de estado em 11 px, peso 500, raio 4 px, padding `1px 6px`.
- **Estado** (`chip-good` / `chip-warning` / `chip-critical`): fundo "soft" da cor a ~10 %, texto na cor cheia.
- **Neutro** (`chip-neutral`): `surface-3` com `ink-2`. **Apagado**: sem fundo, `ink-3`, borda interna de 1 px em `line-strong`.
- **Pílula mono** (`pill-mono`): código ou contagem em Source Code Pro 11 px sobre `surface-3`.
- **Tag de forma** (`.forma`): glifo SVG de 12 px mais código mono, na cor da forma (círculo, triângulo, quadrado, pentágono).
- **Chip de categoria** (`.chip-cat`): 12 px, `surface` com borda `line`, quadradinho de 7 px na cor da categoria e contagem mono; apagado a .45.

### Cards / Containers
O "cartão" é um painel com divisória, não um objeto flutuante.
- **Corner Style:** 6 px.
- **Background:** `surface` sobre `ground`.
- **Shadow Strategy:** nenhuma (ver Elevation & Depth); borda de 1 px em `line`.
- **Header:** 40 px mínimos, padding `8px 14px`, título de 13 px 600, divisória abaixo, ações à direita.
- **Internal Padding:** `12px 14px 14px` (`panel`).
- **Cartão de empreendimento** (`card-empreendimento`): padding 14 px, título 15 px, grade de quatro números (`surface-2`, raio 4 px, rótulo de 10 px, valor 15 px 600 tabular), ações no rodapé; hover `surface-2` com borda `line-strong`; atual com borda em acento.
- **Linha de local** (`local-row`): Locais não são cartões, são linhas de 40 px dentro de um único painel, com título de 13 px, metadados e resumo em 12 px, essenciais como pontos de 6 px; hover `surface-2`; atual com barra interna de 2 px em acento; proposto em itálico `ink-2`.

### Inputs / Fields
- **Style:** 28 px de altura, `surface`, borda 1 px `line-strong`, raio 6 px, padding `0 8px`, 13 px (`input`); dentro de tabela 24 px, raio 4 px, 12 px; na barra de lote 26 px. Textarea com `6px 8px` e redimensionável na vertical.
- **Hover:** borda escurece para `ink` a 30 %.
- **Focus:** borda em acento mais anel de 2 px a 35 %, sem outline.
- **Label:** rótulo estrutural de 11 px acima, 4 px de intervalo (`.campo`); ajuda em 12 px `ink-3` abaixo.
- **Busca:** `min-width: 200px`, cresce até 360 px na barra de filtros.
- **Arquivo / zona de soltar:** borda tracejada em `line-strong`, `surface-2` (arquivo) ou `surface` (zona); hover e arraste sobre viram borda em acento com `accent-soft`, e a zona ganha o anel.
- **Checkbox:** nativo, 14 px, `accent-color` em acento.
- **Célula editável** (`[data-editavel]`): cursor de texto; hover mostra `accent-soft` com contorno interno de 1 px em acento a 25 %.

### Navigation
- **Barra lateral** (`sidebar`): 232 px em `ground`, divisória à direita, padding 10 px. Marca no topo (glifo de 22 px, nome 13 px 600, subtítulo 10 px em caixa alta). Grupos como rótulo estrutural com `12px 8px 4px`.
- **Item** (`nav-item`): 28 px, raio 6 px, ícone de 16 px, texto 13 px em `ink-2`; hover `surface-2` e `ink`; atual `surface-3`, `ink`, 600; contagem mono de 11 px à direita.
- **Rodapé de estado:** itens de 26 px em 12 px `ink-3` com ponto de 7 px (bom, atenção ou acento), divisória acima; alternador de tema (sol/lua).
- **Barra superior** (`topbar`): 44 px em `ground`, divisória abaixo, trilha em 13 px `ink-3` com o nó atual em `ink` 600 e chip de estado.
- **Colapso:** 56 px só com ícones abaixo de 1080 px; gaveta de 260 px com véu abaixo de 720 px.

### Table (assinatura)
A tabela densa é o primeiro viewport.
- **Cabeçalho** (`table-header`): rótulo estrutural em `ink-2` sobre `surface-2`, padding `7px 12px`, divisória abaixo; grudado sob a barra a partir de 1080 px.
- **Linha** (`table-row`): 34 px (célula `7px 12px`, linha 1.4), divisória de 1 px em `line`, última sem borda; hover `surface-2` em 120 ms.
- **Selecionada** (`table-row-selected`): `accent-soft` mais barra interna de 2 px em acento à esquerda.
- **Linha de grupo:** rótulo de categoria sobre `surface-2`, com código mono ao lado.
- **Células:** número em mono 12 px tabular (`.num`); subtexto 12 px `ink-3`; chips alinhados com 4 px; célula vazia mostra "–" em `ink-3`; documento até 520 px com reticências.
- **Ação na linha:** o botão "ver evidência" é invisível até o hover ou seleção da linha (sempre visível no toque).

### Inspector (assinatura)
- **Painel:** 360 px fixo à direita em `surface`, divisória à esquerda; cabeçalho de 44 px mínimos com título de 14 px em duas linhas com reticências e botão fechar (X em CSS mais `<kbd>Esc</kbd>`); corpo com `14px 16px 24px` e blocos separados por 16 px.
- **Conteúdo:** visor compacto da prancha (`min(46vh, 360px)`, `surface-3`, cursor de agarrar), abas de prova (12 px, borda `line`, ativa com borda na cor do papel e ponto de 7 px), níveis de zoom em três miniaturas de 60 px com número sobreposto, ficha de dados em duas colunas, cadeia da informação (ponto de 7 px em acento, fio de 1 px em `line-strong`).
- **Motion (assinatura):** em tela larga o inspetor é a terceira coluna do grid do app, que cresce de 0 até 360 px em 340 ms empurrando a tabela, com o conteúdo entrando por fade e 6 px de subida; fechar recolhe em 220 ms com a curva de saída; trocar de produto refaz só a entrada do conteúdo. Abaixo de 1080 px volta a deslizar de `translateX(100%)` sobre um véu, com `sombra-pop`.

### Visor da prancha (assinatura)
Canvas sobre `surface-3`, `min(72vh, 780px)` de altura (compacto `min(46vh, 360px)`), barra de ferramentas acima com divisória, legenda flutuante no canto inferior direito (`surface`, raio 6 px, borda `line`, `sombra-pop`, miniatura de até 132 px). O canvas e a camada de marcas têm `transition: none` forçado: o arraste os move a cada quadro.

### Modal
Caixa de `min(720px, 100%)` (pergunta: 480 px), `surface`, raio 8 px, borda `line`, `sombra-pop`, sobre véu a 40 % que surge em 140 ms; a caixa abre de `scale(.96)` para 1 com fade em 340 ms. Cabeçalho `16px 20px 4px` com título 15 px 600 e descrição 13 px `ink-2`; corpo `14px 20px`; rodapé `12px 20px 16px` com divisória e botões à direita. Grade de tipos de documento em cartões de `minmax(190px, 1fr)`, pressionado com borda em acento e `accent-soft`.

### Faixas, progresso, toast
- **Faixa de aviso:** `atencao-soft` com texto em `atencao` e borda da cor a 25 %, raio 6 px, `10px 12px`, ícone de aviso em CSS à esquerda; variante crítica idem em vermelho.
- **Progresso:** trilho de 4 px em `surface-3`, barra em acento, largura anima em 200 ms.
- **Toast:** `ink` sobre `ground` (invertido), 13 px 500, `8px 14px`, raio 6 px, `sombra-pop`, centrado embaixo a 20 px, sobe 10 px com fade em 340 ms.

## Do's and Don'ts

### Do:
- **Do** usar os tokens de `css/app.css` (`:root` e os dois blocos escuros) como única fonte; todo valor novo entra ali antes de aparecer numa regra.
- **Do** separar superfícies com divisória de 1 px em `line` ou um passo de superfície (`surface` → `surface-2` → `surface-3`); reservar `sombra-pop` para modal, popover, legenda do visor e toast.
- **Do** marcar seleção com `accent-soft` mais barra interna de 2 px em acento, e foco com o anel de 2 px a 35 %.
- **Do** escrever número, código, tag, contagem e atalho em Source Code Pro com `tabular-nums`.
- **Do** manter a linha de tabela em 34 px, o botão em 28 px (24 px pequeno), o campo em 28 px e o item de menu em 28 px.
- **Do** mostrar o atalho de teclado como `<kbd>` inline e escondê-lo em toque ou abaixo de 1080 px.
- **Do** usar ícones SVG de 16 px com traço 1.6 (14 px em botões) ou os ícones desenhados em CSS; sempre com `currentColor`.
- **Do** transicionar cor, fundo e borda em 140 ms, estados em 220 ms e leiaute em 340 ms, entradas com `cubic-bezier(.05, .7, .1, 1)` e saídas com `cubic-bezier(.3, 0, .8, .15)`; cada tela, o conteúdo do inspetor e o modal entram com fade e leve deslocamento; com `prefers-reduced-motion` fica só o fade.
- **Do** definir o escuro como paleta própria (fundo `#0f1012`, acento `#6f9bff`), nunca por inversão ou filtro.
- **Do** tratar Locais como linhas de 40 px num único painel e Empreendimentos como cartões, porque só o empreendimento carrega ações e números próprios.

### Don't:
- **Don't** usar gradientes, bordas laterais coloridas, cartões de KPI ou qualquer cor sem significado; o acento aparece só em ação primária, seleção e foco.
- **Don't** pôr sombra em painel, cartão, botão ou linha em repouso.
- **Don't** colocar rótulo em caixa alta (kicker, eyebrow) acima de um título; o rótulo de 11 px nomeia coluna, campo, grupo ou categoria.
- **Don't** subir o corpo acima de 13 px nem títulos de tela acima de 18 px; a densidade é o que sustenta a sessão longa.
- **Don't** usar raio acima de 8 px (modal) ou fora da escala 3/4/6/8.
- **Don't** animar o canvas do visor, a camada de marcas ou a miniatura da legenda; o arraste os move a cada quadro.
- **Don't** cobrir a tabela com gaveta ou véu a partir de 1080 px; o inspetor fica ao lado.
- **Don't** trocar as famílias por fontes de sistema ou carregá-las de CDN; as duas moram em `fonts/` para o modo local sem rede.
- **Don't** usar cinza opaco como divisória; `line` e `line-strong` são rgba para pousar nos dois temas.
- **Don't** usar mais de um botão primário por tela.
