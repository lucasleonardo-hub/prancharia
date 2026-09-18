---
version: 1
slug: "local-html"
primary_target: "local.html"
related_targets: ["css/app.css","js/ui/drawer.js","index.html"]
---

# Surface brief — local.html (casca do app e ficha do local)

Escopo: o aplicativo inteiro (casca, menu, todas as telas), com a ficha do local como primeiro viewport. Modo: Operate.
Audiência: equipe interna da Predialize, pessoa técnica em desktop, sessões longas de revisão linha a linha.
Tarefa: conferir e completar o levantamento de acabamentos por local, com a evidência de cada dado à vista.
Restrições confirmadas (2026-09-19): tema escuro obrigatório; nada é sagrado na marca; evitar parecer marketing, perder densidade, parecer software antigo de engenharia, cansar em sessão longa. Modo local sem servidor continua funcionando; layout MP/MC intocado.
Referências escolhidas pelo usuário para a régua de acabamento: Linear e Figma.

## Direction contract

THESIS: Uma ferramenta de trabalho densa e neutra em que a tabela e a prancha são o conteúdo e o cromo quase desaparece. Recusa o painel de cartões brancos flutuando sobre cinza com botão índigo — a fórmula que hoje denuncia geração automática — e recusa também a grade cinza de CAD antigo.

OWN-WORLD: Cinzas quase sem cor: claro com fundo #f7f7f8 e superfície #ffffff, escuro com fundo #0f1012 e superfícies #17181b; divisórias de 1 px em rgba, sombras só em popovers e no visor flutuante; um acento cobalto (#2c5fd6 claro / #6f9bff escuro) para ação primária, seleção e foco; três estados (verde, âmbar, vermelho) e as quatro formas geométricas das tags continuam semânticos e são a única cor além do acento. Tipografia de trabalho em 13 px: Source Sans 3 para a interface (pesos 400/600), Source Code Pro para números, códigos e tags, com tabular-nums. Linhas de tabela de 34 px, cabeçalhos de coluna em 11 px caixa alta, ícones de 16 px de traço único, botões de 28 px com atalho de teclado visível, raio de 6 px em tudo, 4 px em chips. Barra lateral de 232 px, barra superior de 44 px, inspetor fixo de 360 px à direita.

STORY: Quem abre um local vê a tabela inteira de uma vez, seleciona uma linha e vê a evidência ao lado sem sair da tabela; confirma, edita e segue para a próxima com o teclado. Entende que nada ali está sem origem porque a origem está sempre visível ao lado.

FIRST VIEWPORT: A ficha do local em 1440 px. Cabeçalho de uma linha: trilha (empreendimento › Locais), nome do local em 18 px 600, chips de estado e contagens, ações pequenas à direita com "Confirmar" em cobalto. Abaixo, a grade densa agrupada por categoria (Piso, Paredes, Teto, Esquadrias…), colunas Produto · Sistema · Descrição · Marca · Origem · Confiança, linha selecionada com fundo de acento a 8 %. À direita, o inspetor de 360 px com o visor compacto da prancha no ponto da evidência, as abas de prova (local, tag, legenda, memorial), os dados extraídos e a cadeia da informação. Sem véu, sem gaveta por cima.

FORM: O padrão da categoria (canon), escolhido pelo usuário na página de decisão; candidatos grounded e desafiantes vistos e recusados. Seed key d77e79e7 (scope direction, mode operate). Referências de acabamento: Linear e Figma. Caminho code-led (sem geração de imagem).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Interação-assinatura e movimento
Inspetor fixo: setas ↑/↓ percorrem as linhas da tabela, Enter foca o inspetor, Esc volta à tabela; o visor acompanha a linha selecionada. Movimento quase nulo: 120 ms para cor e fundo, 160 ms para o painel; o canvas do visor nunca anima. Abaixo de 1080 px o inspetor vira painel deslizante à direita; abaixo de 720 px a barra lateral vira gaveta.

## Decisões em aberto
Nenhuma. Reabrir só a pedido do usuário.
