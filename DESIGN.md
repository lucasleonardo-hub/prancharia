---
name: Prancharia
description: A mesa do revisor — interface serena e técnica que recua para deixar a prancha e os dados em primeiro plano.
colors:
  papel-frio: "#fafafc"
  branco-prancha: "#ffffff"
  papel-sombreado: "#f7f7fa"
  papel-fundo: "#f0f0f5"
  grafite: "#15161a"
  grafite-medio: "#5a5f6b"
  grafite-claro: "#8b91a0"
  linha-luz: "rgba(15, 18, 30, .06)"
  linha-luz-forte: "rgba(15, 18, 30, .11)"
  indigo-esquadria: "#4f46e5"
  indigo-esquadria-forte: "#4338ca"
  indigo-esquadria-veu: "rgba(79, 70, 229, .075)"
  tinta-sobre-indigo: "#ffffff"
  verde-conforme: "#047857"
  verde-conforme-veu: "rgba(4, 120, 87, .085)"
  ambar-atencao: "#8a5d0b"
  ambar-atencao-veu: "rgba(180, 124, 20, .1)"
  vermelho-critico: "#b42318"
  vermelho-critico-veu: "rgba(180, 35, 24, .08)"
  circulo-azul: "#2563eb"
  triangulo-roxo: "#9333ea"
  quadrado-verde: "#047857"
  pentagono-ambar: "#b45309"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.032em"
  headline:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.026em"
  title:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.014em"
  body:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.005em"
  label:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.1em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  raio-xs: "8px"
  raio-s: "10px"
  botao: "11px"
  raio: "14px"
  raio-g: "20px"
  pilula: "999px"
spacing:
  xs: "7px"
  sm: "9px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  xxl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.indigo-esquadria}"
    textColor: "{colors.tinta-sobre-indigo}"
    rounded: "{rounded.botao}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-esquadria-forte}"
    textColor: "{colors.tinta-sobre-indigo}"
  button-secondary:
    backgroundColor: "{colors.branco-prancha}"
    textColor: "{colors.grafite}"
    rounded: "{rounded.botao}"
    padding: "9px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.grafite-medio}"
    rounded: "{rounded.botao}"
    padding: "9px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.papel-fundo}"
    textColor: "{colors.grafite}"
  button-danger:
    backgroundColor: "{colors.vermelho-critico}"
    textColor: "{colors.tinta-sobre-indigo}"
    rounded: "{rounded.botao}"
    padding: "9px 16px"
  button-small:
    rounded: "9px"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.branco-prancha}"
    textColor: "{colors.grafite}"
    rounded: "{rounded.raio-g}"
    padding: "20px 24px"
  card-selection:
    backgroundColor: "{colors.branco-prancha}"
    textColor: "{colors.grafite}"
    rounded: "{rounded.raio}"
    padding: "18px 20px"
  input:
    backgroundColor: "{colors.branco-prancha}"
    textColor: "{colors.grafite}"
    rounded: "{rounded.botao}"
    padding: "9px 13px"
  chip-status-good:
    backgroundColor: "{colors.verde-conforme-veu}"
    textColor: "{colors.verde-conforme}"
    rounded: "{rounded.pilula}"
    padding: "3px 10px"
  chip-status-attention:
    backgroundColor: "{colors.ambar-atencao-veu}"
    textColor: "{colors.ambar-atencao}"
    rounded: "{rounded.pilula}"
    padding: "3px 10px"
  chip-status-critical:
    backgroundColor: "{colors.vermelho-critico-veu}"
    textColor: "{colors.vermelho-critico}"
    rounded: "{rounded.pilula}"
    padding: "3px 10px"
  chip-status-neutral:
    backgroundColor: "{colors.papel-fundo}"
    textColor: "{colors.grafite-medio}"
    rounded: "{rounded.pilula}"
    padding: "3px 10px"
  pill-mono:
    backgroundColor: "{colors.papel-fundo}"
    textColor: "{colors.grafite-medio}"
    typography: "{typography.mono}"
    rounded: "{rounded.pilula}"
    padding: "3px 9px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.grafite-medio}"
    rounded: "{rounded.raio-s}"
    padding: "8px 12px"
  nav-item-active:
    backgroundColor: "{colors.indigo-esquadria-veu}"
    textColor: "{colors.indigo-esquadria}"
    rounded: "{rounded.raio-s}"
    padding: "8px 12px"
---

# Design System: Prancharia

## Overview

**Creative North Star: "A Mesa do Revisor"**

Tudo serve à sessão longa de revisão: a hierarquia é feita por espaço, a evidência está sempre a um clique, e nada compete com o desenho. A interface é serena e técnica, discreta, quase invisível; a prancha e os dados são os protagonistas. A cor vem da própria prancha: papel levemente frio, grafite do traço, o índigo dos códigos de esquadria e as quatro cores das formas geométricas que marcam as tags.

A densidade é a de uma mesa de trabalho, não a de um painel: o respiro é maior que o necessário de propósito, porque numa tela com 200 linhas de acabamento o branco é o que deixa a leitura possível. As superfícies nascem levemente elevadas e se separam por luz (linhas translúcidas e sombras rasas em camadas), nunca por bordas opacas. Os componentes são contidos e silenciosos, e todo movimento desacelera na mesma curva, o que dá a sensação de uma peça só.

Duas referências foram rejeitadas de forma confirmada: o painel SaaS genérico (cartões de KPI coloridos, gráficos decorativos, gradientes) e o software de engenharia antigo (grade cinza densa, barras de ferramentas empilhadas).

**Key Characteristics:**
- A prancha é o protagonista: o visor ocupa até 72vh e recebe fundo neutro, sem moldura decorativa.
- Separação por luz: linhas rgba e sombras em camadas, nenhuma borda opaca.
- Índigo escasso: só no botão primário, no foco, no item de menu ativo e nos elos da cadeia de evidência.
- As quatro formas e os três estados são cores semânticas, não decoração.
- Uma única curva de saída (`--mola`) para todo o sistema; o canvas do visor fica fora dela.
- Tema escuro que troca a família de superfícies por grafites profundos e clareia o índigo, sem inverter o claro.

## Colors

Uma paleta tirada da prancha: papéis frios, grafites do traço, um índigo profundo e sete cores semânticas de baixa saturação que ganham um "véu" translúcido para fundos.

### Primary
- **Índigo de Esquadria** (`indigo-esquadria`): o nome vem dos códigos de esquadria das pranchas, de onde a cor foi tirada. Aparece no botão primário, no anel de foco (`--anel`, 3px a 16% de opacidade), no item de menu ativo, nos links, no ponto e no elo da cadeia de evidência, na barra de progresso e no glifo da marca. No escuro clareia para `#8b8ef8`, porque índigo saturado sobre grafite some.
- **Índigo de Esquadria forte** (`indigo-esquadria-forte`): apenas o hover do botão primário.
- **Véu de índigo** (`indigo-esquadria-veu`): fundo do item de menu ativo, do tipo selecionado e da linha de legenda usada; hover de célula editável.

### Neutral
- **Papel frio** (`papel-frio`): o chão da página e da barra lateral (`--ground`).
- **Branco da prancha** (`branco-prancha`): superfície de cartões, botões, campos, gaveta e modal (`--surface`).
- **Papel sombreado** (`papel-sombreado`): cabeçalho de tabela, linha em hover, nós de fluxo, chips de categoria, abas de prova (`--surface-2`).
- **Papel de fundo** (`papel-fundo`): fundo do visor, do selo neutro, da pílula mono e do hover dos botões discretos (`--surface-3`).
- **Grafite** (`grafite`): texto principal e fundo do toast (`--ink`).
- **Grafite médio** (`grafite-medio`): descrições, botões discretos, itens de menu em repouso (`--ink-2`).
- **Grafite claro** (`grafite-claro`): rótulos em caixa alta, metadados, contagens, células vazias (`--ink-3`).
- **Linha de luz** (`linha-luz`) e **Linha de luz forte** (`linha-luz-forte`): as únicas "bordas" do sistema, sempre rgba, usadas como `inset 0 0 0 1px`, `border-bottom` de célula e `border` de botão secundário e campo (`--line`, `--line-strong`; `--borda` repete a forte).

### Estados (semânticos, fixos)
- **Verde conforme** (`verde-conforme`): item confirmado, servidor ligado, selo `bom`.
- **Âmbar de atenção** (`ambar-atencao`): pendência, triagem, faixa de aviso, placar em aviso.
- **Vermelho crítico** (`vermelho-critico`): erro, botão de perigo, placar em alerta, faixa crítica.
- Cada estado tem um véu (`*-veu`) que é o fundo do seu selo e da sua faixa; o texto usa a cor cheia.

### As quatro formas da prancha (semânticas)
- **Círculo azul** (`circulo-azul`) = Teto; **Triângulo roxo** (`triangulo-roxo`) = Paredes; **Quadrado verde** (`quadrado-verde`) = Piso; **Pentágono âmbar** (`pentagono-ambar`) = Pedras naturais. Colorem a tag `.forma`, o ponto do rótulo de categoria e o texto da célula de categoria. Nunca aparecem como decoração.

### Named Rules
**A Regra da Escassez do Índigo.** O índigo só marca o que é ação primária ou estado de foco e seleção: botão primário, anel de foco, item de menu ativo, link, cadeia de evidência. Ele nunca comunica status (isso é dos três estados) nem categoria (isso é das quatro formas). Se um índigo novo aparece numa tela sem ser um desses, está errado.

**A Regra das Quatro Formas.** Círculo, triângulo, quadrado e pentágono têm cor porque na prancha eles têm forma. A cor acompanha a forma e a categoria que ela representa; não se usa uma delas para "dar cor" a um elemento sem forma.

## Typography

**Display Font:** Plus Jakarta Sans (com -apple-system, Segoe UI, Roboto, Arial)
**Body Font:** Plus Jakarta Sans (a mesma família; só peso e tamanho mudam)
**Label/Mono Font:** JetBrains Mono (com ui-monospace, Menlo) para números, códigos e contagens

**Character:** Uma só família humanista-geométrica em quatro pesos, com tracking negativo crescendo com o tamanho (−0.005em no corpo, −0.032em no display). O mono entra quando o dado é número, código de tag ou contagem, sempre com `tabular-nums`. O resultado é técnico sem ser frio: lê-se como um memorial bem composto.

### Hierarchy
- **Display** (700, 28px, 1.25, −0.032em): o `h1` da cabeça de cada tela; cai para 23px abaixo de 720px. O placar usa o mesmo tamanho para o número, com −0.04em e `tabular-nums`.
- **Headline** (700, 20px, 1.25, −0.026em): título do modal. Os cartões de seleção usam 16–17px em 700 com −0.022em.
- **Title** (600, 15px, 1.25, −0.014em): `h2` do cabeçalho de cartão; `h3` do estado vazio em 16.5px.
- **Body** (400, 14px, 1.55, −0.005em): texto corrente. Descrições e parágrafos de apoio descem para 13.5px com 1.6 e largura máxima de 68ch; tabelas e botões usam 13px.
- **Label** (600, 9.5–11px, 0.1em, caixa alta, grafite claro): cabeçalho de tabela (10px), `dt` do placar (10px), rótulo de campo (10px), grupo do menu (9.5px), rótulos da cadeia e da ficha (9.5px), título de seção (11px). A categoria (`.cat`) usa 10.5px com 0.09em e leva a cor da forma.
- **Mono** (500, 12.5px em célula numérica; 10.5–11.5px em pílulas, contagens e tags de forma): JetBrains Mono com `tabular-nums`.

### Named Rules
**A Regra do Rótulo em Caixa Alta.** O único texto em caixa alta é rótulo estrutural: cabeçalho de coluna, nome de campo, grupo do menu, rótulo de dado. Fica entre 9.5px e 11px, peso 600, tracking 0.09–0.12em, sempre em grafite claro (ou na cor da forma quando é categoria). Título nunca vai em caixa alta.

**A Regra do Número Tabular.** Todo número que se compara em coluna (contagens, tags, medidas, placar) usa `font-variant-numeric: tabular-nums`; quando é código ou contagem auxiliar, vai em JetBrains Mono.

## Layout

A página é uma grade de duas colunas: barra lateral fixa de 256px sobre o papel frio e a área principal com barra superior de 62px (translúcida, `backdrop-filter: blur(20px) saturate(180%)`, colada no topo). O conteúdo vive numa `faixa` centrada de no máximo 1380px, com 28px de margem lateral e 88px de folga inferior, empilhando blocos com 24px de gap.

O ritmo de espaço é generoso e recorrente: 7px e 9px entre botões e chips, 14px entre cartões da grade, 18px entre grades duplas, 24px de padding interno dos cartões (20px em cima) e 28px no modal. Dentro de tabelas, células têm 14px vertical por 18px horizontal, com 24px na primeira e na última coluna para alinhar com o cabeçalho do cartão.

Grades de conteúdo são fluidas por `auto-fit`/`auto-fill`: placar em colunas de 158px, cartões de local de 240px, cartões de empreendimento de 320px, provas de 310px, campos de formulário de 230px.

Pontos de mudança: abaixo de 1080px a barra lateral encolhe para 74px (só ícones); abaixo de 720px ela vira gaveta fixa de 268px com véu escuro, a barra superior cai para 56px, as margens laterais para 16px, o placar vira duas colunas e os botões da cabeça ocupam a largura inteira.

### Named Rules
**A Regra do Respiro.** Espaço é hierarquia. Antes de introduzir uma linha, uma cor de fundo ou um título para separar dois grupos, aumente o espaço entre eles: um gap de 24px separa blocos; 14px separa cartões irmãos; 7–9px separa controles que agem juntos.

## Elevation & Depth

Sistema híbrido de camadas sempre visíveis: cartões e painéis nascem levemente elevados (`--sombra-1`) e sobem um degrau no hover (`--sombra-2`); o que flutua sobre a tela (gaveta, modal, legenda do visor, toast, barra lateral móvel) recebe `--sombra-3`. Nenhuma sombra é um borrão só: cada token é um par de sombras rasas, uma curta e uma difusa. A separação entre superfícies vizinhas é feita por luz (linha translúcida `inset 0 0 0 1px var(--line)` ou `border-bottom: 1px solid var(--line)`), o que faz o mesmo token funcionar no claro e no escuro sem retoque. No escuro as sombras ficam pretas e mais fortes (até 0.8 de opacidade) porque o grafite engole sombra fraca.

### Shadow Vocabulary
- **Repouso** (`--sombra-1`: `0 1px 2px rgba(15,18,30,.04), 0 1px 3px -1px rgba(15,18,30,.03)`): cartão, botão secundário, campo, cartão de seleção, recorte de evidência.
- **Hover** (`--sombra-2`: `0 2px 6px -1px rgba(15,18,30,.04), 0 4px 20px -2px rgba(15,18,30,.07)`): o mesmo elemento sob o ponteiro, geralmente com `translateY(-1px)` ou `-2px`.
- **Flutuante** (`--sombra-3`: `0 4px 12px -2px rgba(15,18,30,.06), 0 20px 56px -16px rgba(15,18,30,.22)`): gaveta, modal, legenda flutuante do visor, toast, barra lateral quando vira gaveta.
- **Anel de foco** (`--anel`: `0 0 0 3px rgba(79,70,229,.16)`): substitui o `outline` em todo `:focus-visible`, nos campos em foco e na zona de soltar arquivo enquanto o arquivo está sobre ela.
- **Sombra tingida do primário** (`0 4px 16px -4px color-mix(in srgb, var(--accent) 55%, transparent)`): exclusiva do botão primário, cresce para 65% no hover.

### Named Rules
**A Regra da Separação por Luz.** Nenhuma borda opaca. O que divide duas superfícies é uma linha translúcida em rgba (`--line` a 6%, `--line-strong` a 11%) ou uma sombra em camadas. Uma cor sólida de borda em qualquer componente novo é defeito.

**A Regra das Camadas Sempre Visíveis.** Cartões e painéis não são planos em repouso: nascem com `--sombra-1` e a linha de luz interna. O hover sobe um degrau (`--sombra-2`), nunca dois; só o que flutua sobre a página usa `--sombra-3`.

## Shapes

Cantos generosos numa escada de quatro degraus: 20px para os contêineres grandes (cartão, gaveta, modal, zona de soltar), 14px para cartões médios e recortes (placar, cartão de seleção, tipo, faixa de aviso, legenda do visor), 10px para peças internas (nós de fluxo, abas de prova, item de menu, miniaturas) e 8px para o menor nível (célula em foco, campos dentro de tabela, linha de legenda). Botões e campos de formulário usam 11px (9px no botão pequeno). Selos, pílulas e o toast são cápsulas (999px). Pontos de estado são círculos de 7–9px; o marcador de categoria é um quadradinho de 8px com 3px de raio.

Não há bordas opacas. A "borda" é sempre a linha de luz por `inset` ou uma borda `transparent` de 1.5px que só ganha cor no estado selecionado (`.cartao-selecao.atual`, `.tipo[aria-pressed]`). Linhas tracejadas (`1.5px dashed var(--line-strong)`) marcam o provisório: zona de soltar arquivo, input de arquivo, cartão de local proposto. O único traço sólido colorido é a barra esquerda de 3px do nó de fluxo, que carrega a cor do papel de origem da evidência.

### Named Rules
**A Regra do Raio Generoso.** Quanto maior o contêiner, maior o raio: 20 → 14 → 10 → 8px. Um raio menor que 8px só existe em detalhes de 8px ou menos (marcador de categoria, barra de progresso).

## Components

Contidos e silenciosos: bordas translúcidas, raios generosos, nenhum relevo. O índigo aparece só no botão primário e no foco; todo o resto se diferencia por superfície, sombra e peso de texto.

### Buttons
- **Shape:** cápsula suave (11px de raio; 9px no `pequeno`), 9px por 16px de padding, 13px em peso 500, ícone de 15px alinhado com gap de 7px.
- **Primary** (`.btn.primario`): fundo Índigo de Esquadria, texto branco, borda transparente, sombra tingida de índigo. Hover: Índigo forte, sombra tingida mais aberta e `translateY(-1px)`.
- **Secondary** (`.btn`): branco da prancha, borda de linha de luz, `--sombra-1`. Hover: linha forte, `--sombra-2`, `translateY(-1px)`; ativo volta ao repouso.
- **Ghost** (`.btn.discreto`): sem fundo, sem borda, sem sombra, texto grafite médio; hover: papel de fundo e grafite. Usado para menu, tema, "voltar" e ações secundárias em tabelas.
- **Danger** (`.btn.perigo`): vermelho crítico com texto branco; hover escurece 12% com `color-mix`.
- **Link** (`.btn.link`): inline, índigo, sublinha no hover.
- **Disabled:** 40% de opacidade, sem sombra, sem deslocamento.
- **Motion:** `transition: all var(--normal) var(--mola)`.

### Chips
- **Selo de estado** (`.selo`): cápsula de 3px por 10px, 11.5px em peso 500; fundo é o véu do estado e o texto a cor cheia (`bom`, `atencao`, `critico`); `neutro` usa papel de fundo com grafite médio; `apagado` é só um anel de linha forte.
- **Pílula mono** (`.pilula`): contagem ou código em JetBrains Mono 10.5px sobre papel de fundo, cápsula.
- **Tag de forma** (`.forma`): ícone SVG de 13px mais número em mono 11.5px, na cor da forma; sem fundo.
- **Chip de categoria** (`.chip-cat`): cápsula 7px por 13px sobre papel sombreado com anel de linha, quadradinho de 8px na cor da forma, contagem em `tabular-nums`; `apagado` cai a 40%.
- **Selecionável** (`.aba-prova`, `.nivel-cartao`): papel sombreado com anel de linha; o ativo vira branco com anel de 1.5px na cor do papel (ou índigo) mais `--sombra-1`.

### Cards / Containers
- **Corner Style:** 20px no `.cartao` e no cartão de empreendimento; 14px no cartão de seleção, placar e recorte.
- **Background:** branco da prancha; sub-blocos internos (números do empreendimento, nós de fluxo, provas) em papel sombreado.
- **Shadow Strategy:** `--sombra-1` mais `inset 0 0 0 1px var(--line)` em repouso; hover sobe para `--sombra-2` (e `translateY(-2px)` nos cartões de seleção e placar).
- **Border:** nenhuma opaca; o cartão de seleção carrega borda transparente de 1.5px que fica índigo no `atual` e tracejada em linha forte no `proposto`. O destaque de triagem usa anel âmbar a 60%.
- **Internal Padding:** cabeçalho 20px 24px 18px; corpo 6px 24px 24px; cartão de seleção 18px 20px (22px no de empreendimento).

### Inputs / Fields
- **Style:** branco da prancha, borda de linha forte (`--borda`), 11px de raio, 9px por 13px de padding, 13px, `--sombra-1`. Dentro de tabelas e da barra de lote encolhem para 12.5px, 6–7px por 10–11px e raio 8–10px.
- **Focus:** borda índigo e `--anel`; `outline: none`.
- **Hover:** borda passa para linha forte.
- **Label:** rótulo em caixa alta de 10px, 7px acima do campo. Ajuda em 12px grafite claro.
- **File / Drop:** tracejado de 1.5px em linha forte, 20px de raio na zona de soltar; hover e "sobre" viram índigo com véu de índigo e anel.
- **Checkbox:** nativo, 15px, `accent-color` índigo; `color-scheme` acompanha o tema.

### Navigation
- **Sidebar** (`#lateral`): 256px, papel frio, separada por `inset -1px 0 0 var(--line)`; marca com glifo índigo de 36px sobre véu de índigo (gira −6° no hover) e subtítulo "análise de pranchas" em caixa alta de 9.5px.
- **Item** (`nav button`): 13.5px peso 500, grafite médio, ícone de 17px com traço 1.7, raio 10px, 8px por 12px; contagem à direita em mono 10.5px. Hover: papel de fundo e grafite. Ativo (`aria-current="page"`): véu de índigo, texto e ícone índigo, peso 600.
- **Grupo:** rótulo em caixa alta de 9.5px, 0.11em.
- **Trilha** (`.trilha`): 13px em grafite claro, o nível atual em 600 grafite; separadores a 50%.
- **Mobile:** 74px só ícones abaixo de 1080px; gaveta fixa com véu abaixo de 720px, deslizando com `--lento` e `--mola`.

### Gaveta de evidência (signature)
Painel fixo à direita com 10px de folga em todos os lados, `min(600px, 100% − 20px)`, 20px de raio, `--sombra-3` mais linha de luz, entrando por `translateX` em `--lento` com `--mola`; véu de `rgba(10,12,20,.32)` com blur de 3px atrás. Dentro, a **cadeia de evidência**: ponto índigo de 8px com halo de 12%, fio de 2px em linha forte, rótulo em caixa alta e recorte da prancha num contêiner de 14px de raio sobre papel de fundo com legenda em mono 11px.

### Visor da prancha (signature)
Fundo papel de fundo, altura `min(72vh, 780px)` (compacto: `min(46vh, 380px)`, cursor `grab`), sem borda. O canvas e a camada de marcas recebem `transition: none !important` porque o arraste os move a cada quadro. A legenda flutuante fica no canto inferior direito com `--sombra-3`, entrando com `subir`.

### Named Rules
**A Regra da Única Curva de Saída.** Toda transição e toda entrada com `transform` usa `cubic-bezier(.16, 1, .3, 1)` (`--mola`) em uma de três durações: 0.16s para cor e fundo, 0.22s para botão e cartão, 0.32s para gaveta, modal e barra lateral. Só o fade puro de opacidade (`surgir` na faixa, no véu e no modal) usa `ease`.

**A Exceção do Visor.** O canvas da prancha, a camada de marcas e o canvas da legenda nunca recebem transição. Qualquer regra nova que os alcance precisa preservar o `transition: none !important`.

## Do's and Don'ts

### Do:
- **Do** separar superfícies com `inset 0 0 0 1px var(--line)` ou `border-bottom: 1px solid var(--line)`; a linha é sempre rgba.
- **Do** dar a todo cartão novo `--sombra-1` em repouso e `--sombra-2` no hover; reservar `--sombra-3` para o que flutua sobre a página.
- **Do** usar o véu do estado como fundo e a cor cheia como texto em qualquer selo ou faixa de status (`--bom`/`--bom-soft`, `--atencao`/`--atencao-soft`, `--critico`/`--critico-soft`).
- **Do** colorir categoria e tag pela forma (Teto círculo, Paredes triângulo, Piso quadrado, Pedras naturais pentágono) usando os tokens `--circulo`, `--triangulo`, `--quadrado`, `--pentagono`.
- **Do** escrever números comparáveis com `tabular-nums` e códigos em JetBrains Mono.
- **Do** manter `:focus-visible` com `box-shadow: var(--anel)` e `outline: none`.
- **Do** usar `--mola` e uma das três durações (`--rapido`, `--normal`, `--lento`) em toda transição nova.
- **Do** definir cores novas nos dois temas ao mesmo tempo, em `:root` e em `:root[data-theme="dark"]`, com o escuro como grafite profundo e o acento clareado.

### Don't:
- **Don't** usar borda sólida opaca em nenhum componente; se precisa de contorno, use a linha de luz ou uma borda `transparent` que só ganha cor no estado selecionado.
- **Don't** colocar índigo em selos, faixas, placares ou ícones de status; índigo é ação primária, foco, seleção e link.
- **Don't** criar cartões de KPI coloridos, gráficos decorativos ou gradientes; o placar é branco, o número é grafite, e só a cor do valor muda em alerta ou aviso.
- **Don't** empilhar barras de ferramentas nem comprimir a grade: a densidade vem de tabelas com 14px por 18px de célula, não de cromo extra.
- **Don't** animar o canvas do visor, a camada de marcas ou o canvas da legenda.
- **Don't** usar caixa alta em títulos; ela é exclusiva dos rótulos estruturais de 9.5–11px.
- **Don't** introduzir uma segunda curva de easing ou uma quarta duração.
