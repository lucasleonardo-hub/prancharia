# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A equipe interna da Predialize. Uma pessoa técnica que recebe o pacote de um
empreendimento (pranchas de arquitetura em PDF e o memorial descritivo) e monta
o levantamento de materiais e fornecedores por local do edifício. Trabalha em
desktop, no escritório, em sessões longas: muitas pranchas por vez e revisão
linha a linha do que a leitura produziu.

Não há, por ora, usuário externo (construtora, setor de compras) confirmado.

## Product Purpose

O Prancharia lê pranchas e memoriais e devolve, por local (unidade, tipologia,
área comum), o que está especificado: acabamentos, esquadrias, materiais, marcas
e fornecedores, cada item com a evidência de onde saiu. O resultado alimenta a
base de dados da Predialize para **operação e manutenção predial**: saber qual
material e qual fornecedor está em cada local do edifício entregue, para
manutenção, garantia e reposição.

Sucesso é um levantamento que a base da Predialize pode absorver sem retrabalho:
locais corretos, itens com especificação e proveniência, pendências resolvidas ou
explicitamente marcadas como tais.

## Positioning

Duas afirmações que o usuário defende e que um leitor genérico de PDF por IA não
pode copiar com honestidade:

1. **Cada dado tem evidência rastreável.** Nada entra no levantamento sem apontar
   de onde saiu na prancha ou no memorial. Campo sem respaldo fica vazio, nunca
   "N/A" nem valor inferido. A regra é imposta em código (saneamento no servidor
   e no motor), não apenas pedida no prompt.
2. **Leitura vetorial exata primeiro; a IA só verifica e completa.** O texto e a
   geometria do PDF são a espinha do levantamento. O motor multimodal recebe o
   que o vetor já extraiu e responde com `confirmar`, `completar` ou `novo`;
   nunca substitui o que o vetor leu.

## Operating Context

- **Entrada**: PDFs de pranchas (plantas, cortes, quadros de esquadrias) e o
  memorial descritivo. Chegam por upload, arrastar e soltar ou Google Drive.
  Pranchas podem ser raster puro (só o carimbo tem texto); nesse caso os locais
  vêm do memorial ou da leitura por imagem.
- **Fluxo de trabalho**, na ordem do menu: Documentos → Locais → Produtos →
  Revisão (pendências) → Exportar → Glossário → Configurações.
- **Estrutura do empreendimento**: torre, tipologia, unidade, pavimento; áreas
  comuns (MC) separadas de unidades privativas (MP); cômodos agrupados por
  tipologia.
- **Saídas**: XLSX no layout da planilha MP/MC da Predialize, CSV, JSON e um
  cofre Obsidian (zip ou gravação direta via plugin Local REST API).
- **Dois modos de dados**: só neste navegador (IndexedDB) ou servidor
  compartilhado (BFF em Node com SQLite/Turso), com a mesma equipe no mesmo
  levantamento e memória técnica por empresa (vocabulário, marcas homologadas,
  regras para a IA).
- **Dois motores de leitura**: vetorial (padrão, sem rede) e multimodal via BFF
  (Gemini, com fallback para Groq, Cohere e Hugging Face). OCR externo só para
  memorial escaneado.
- Projeto de referência usado em testes: um edifício residencial com dois
  subsolos de áreas comuns, torres e tipologias TIPO 1 a TIPO 11, plantas raster
  e memorial com texto.

## Capabilities and Constraints

Restrições confirmadas pelo usuário, a preservar em qualquer trabalho futuro:

- **Modo local sem servidor.** O app precisa continuar funcionando só no
  navegador, sem BFF, com o leitor vetorial. Nenhum PDF sai do computador nesse
  modo.
- **Layout da planilha MP/MC é fixo.** As colunas do XLSX seguem um modelo
  existente da Predialize que não pode mudar.
- **Somente português do Brasil.** Não há intenção de outro idioma; toda a
  interface, terminologia e código de domínio são em pt-BR.

Restrições técnicas presentes no código (evidência, não decisão do usuário):

- Frontend em ES modules puro, sem bundler; precisa de servidor estático para
  desenvolver (`static-server.mjs`, `python -m http.server`).
- pdf.js 5.7 em build legacy, embarcado em `vendor/`; a build moderna não roda
  no Chromium do artifact.
- Backend no Render plano free (disco efêmero; persistência só com Turso) e
  frontend na Vercel; `local.html` é a raiz do site.
- Modo nuvem não funciona offline e não resolve conflito de edição
  simultânea (a última gravação vence, por projeto).

Não confirmado (o usuário não marcou como restrição): compatibilidade contínua
com a publicação como artifact do Claude via `index.html`. O arquivo permanece
no repositório; trabalho futuro deve perguntar antes de quebrar ou remover esse
caminho.

Terminologia do domínio: prancha, memorial descritivo, local, tipologia,
unidade privativa (MP), área comum (MC), tag (forma geométrica + número),
legenda, quadro de esquadrias, pendência, evidência, proveniência, glossário,
sistema construtivo.

## Brand Commitments

Nome: **Prancharia**, subtítulo "análise de pranchas". Marca gráfica existente
em `favicon.svg` e no glifo da barra lateral. Voz da interface e da
documentação: português direto, técnico, sem jargão de marketing, explicando o
porquê das regras. Nenhum outro compromisso de identidade foi declarado.

## Evidence on Hand

- Código e documentação completos em `LEIA-ME.md`, com o pipeline híbrido, as
  telas e o esquema do servidor descritos.
- Projeto real de referência para testes (memorial com texto vetorial e plantas
  raster), fora do repositório, na máquina do usuário.
- Não há depoimentos, clientes nomeados, métricas de precisão nem números de
  uso. Trabalho futuro não deve inventar nenhum desses.

## Product Principles

1. **Evidência antes de completude.** Uma célula vazia com motivo é melhor que
   uma célula preenchida sem fonte. A interface deve tornar a ausência visível,
   não escondê-la.
2. **O documento vence.** Regras de empresa, glossário e IA são subordinados ao
   que a prancha e o memorial dizem; conflito se resolve a favor do documento.
3. **O vetor é a espinha; a IA soma.** Qualquer novo passo de leitura entra
   como camada de confirmação ou complemento, nunca como substituição.
4. **Revisão é parte do produto, não exceção.** Pendências agrupadas, ações em
   lote e rastreabilidade completa existem porque a leitura nunca decide tudo;
   a ferramenta é feita para sessões longas de conferência.
5. **Funciona sem rede.** Toda capacidade essencial precisa existir no modo
   local; o servidor e a IA ampliam, não condicionam.

## Accessibility & Inclusion

Nenhum requisito específico foi estabelecido além do uso em desktop por equipe
interna. O código já usa `aria-label` na navegação e tema claro/escuro; nada
disso foi confirmado como exigência.
