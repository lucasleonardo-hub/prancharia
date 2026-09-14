# Prancharia — código-fonte

Aplicação de análise de pranchas, memoriais e documentos técnicos. O frontend
roda inteiro no navegador: nenhum PDF sai do computador.

A leitura tem dois motores, e o frontend escolhe qual usar:

| motor | o que faz | precisa de rede |
|---|---|---|
| `fallback_vetorial` | lê o texto e a geometria vetorial do PDF: tags forma+número cruzadas com a legenda, tabelas desenhadas. **Padrão.** | não |
| `multimodal_gemini` | manda o recorte do local e o recorte da legenda para o BFF, que pergunta ao Gemini. Acha o que só a imagem mostra: hachuras, paginação, especificação escrita no desenho. | sim, o BFF em `localhost:3000` |

O motor multimodal **soma**, não substitui: a leitura vetorial continua sendo a
espinha (ela lê o texto real da legenda) e o que a IA vê entra por cima. Quando
os dois leem a mesma tag, a Especificação fica com duas evidências — é a
confirmação por caminhos independentes. Quando só a IA vê algo, isso vira um
item novo com proveniência `multimodal_gemini`.

### O pipeline híbrido, passo a passo

A IA nunca faz o trabalho pesado do zero. A ordem é fixa, em `engine.js`:

| passo | onde | o que acontece |
|---|---|---|
| 1. vetorial, sempre | `analisarFolha` | `rooms.js` lê os ambientes, `shapes.js`/`legend.js` leem tags e legendas, `tables.js`/`quadros.js` leem as tabelas. Rápido, sem rede, exato onde há texto e grade. |
| 2. empacotar | `consolidar` → `processarComIAHibrida` | o que o vetor montou para **aquele local** vira JSON (`vetor.especificacoes`, com os campos que faltam, `vetor.lacunas`, `vetor.ambientes`, as tags com o tipo de vínculo) e vai no corpo da chamada junto com os recortes. A leitura ampla faz o mesmo por folha (`vetor.ambientes`, `vetor.legendas`, `vetor.tabelas` linha a linha). |
| 3. revisão pela IA | `server/prompt.js` | o prompt diz: *"aqui estão os dados que já extraí vetorialmente; analise a imagem apenas para VERIFICAR se falta algo e PREENCHER as lacunas"*. Cada item volta com `acao`: `confirmar`, `completar` ou `novo`. |
| 4. mesclar | `mesclarLeituras` | confirmação e complemento se anexam ao item do vetor (que nunca é substituído); só o `novo` vira linha própria. `confirmar` sem item correspondente é descartado — não tem evidência própria. |

A Regra de Ouro continua imposta em código, não só pedida no prompt: no
servidor, item da IA **sem `justificativa`** (de onde saiu, na imagem) é
descartado antes de chegar ao frontend (`sanear`, R11 / `sanearQuadro`, Q11), e
qualquer campo sem respaldo volta como `""`, nunca `"N/A"`. O log do servidor
mostra por chamada quantos itens foram `conf · compl · novos` e quantos caíram
por falta de evidência — é a régua para afinar o prompt.

## Como abrir para editar e testar

São módulos ES (`import`/`export`), então **não funciona abrindo o arquivo
direto** (`file://`) — o navegador bloqueia. Precisa de um servidor local, e
qualquer um serve:

```bash
cd prancharia
python3 -m http.server 8000
# depois abra http://localhost:8000/local.html
```

Ou, com Node:

```bash
npx serve .        # abra o local.html na porta que aparecer
```

## Os dois HTML

| arquivo | para quê |
|---|---|
| `local.html` | documento completo (`<!doctype>`, `<head>`, `<body>`). É este que você abre no navegador para desenvolver. |
| `index.html` | o mesmo conteúdo **sem** doctype/html/head/body. É o formato que a publicação como artifact exige — ela embrulha o arquivo automaticamente. |

Se você editar a marcação de um, replique no outro. O `local.html` é gerado a
partir do `index.html`: pegue tudo o que está antes de `<div id="app">` como
cabeça e o resto como corpo.

## Estrutura

```
index.html          corpo da página + bootstrap do módulo
local.html          versão para rodar em servidor local
css/app.css         sistema visual inteiro (tokens, componentes, tema claro/escuro)
js/app.js           estado, rotas, menu lateral, render, ações globais
js/core/
  tipos.js          taxonomia de tipos de empreendimento — define quais níveis
                    hierárquicos existem (torre, tipologia, unidade, pavimento)
  model.js          modelo de dados, status, confiança, migração de projetos
  vocab.js          categorias, 192 sistemas construtivos, layout da planilha
  glossario.js      regras texto → categoria/produto/sistema; aprende com você
  pdfdoc.js         carga do pdf.js e leitura de página
  shapes.js         leitura das formas geométricas desenhadas (tags)
  legend.js         blocos de legenda: forma + número → material
  rooms.js          ambientes e vínculo espacial tag → ambiente (BFS geodésico)
  tables.js         tabelas desenhadas na prancha (esquadrias, pedras)
  engine.js         orquestra a extração de uma folha e consolida no projeto
  ia.js             configuração do motor (provedor, endereço do BFF, tempo
                    limite, disjuntor) e transporte das chamadas
  memorial.js       leitura de memorial descritivo e fusão semântica com as
                    pranchas (com o cruzamento heurístico como rede)
  auditoria.js      auditoria automática: regras, classificação, agrupamento
  provas.js         evidências por papel (ambiente, tag, legenda, memorial) e
                    cadeia completa de rastreabilidade
  exporter.js       planilhas (MP, MC, fornecedores, locais, evidências)
  xlsx.js           escritor de .xlsx próprio (ZIP + SpreadsheetML)
  audit.js          leitor de .xlsx/.csv e comparação manual × planilha
  storage.js        persistência (IndexedDB / banco do artifact) e downloads
js/ui/
  views.js          todas as telas
  drawer.js         painel de evidências
  viewer.js         visor de prancha, recortes e realces
vendor/
  pdf.js            pdf.js 5.7.284, build legacy (não trocar pela build moderna:
  pdf.worker.js     a moderna usa APIs que o Chromium do artifact não tem)
server/             o BFF: guarda a chave da API e fala com o Gemini
  server.js         Express + @google/generative-ai, POST /api/vision/process-local
  prompt.js         instrução de sistema, JSON Schema e saneamento da resposta
  simulador.mjs     BFF de mentira, sem dependência nenhuma, para testar a UI
                    (as duas rotas, e os modos LENTO= e FALHAR=)
  ping.mjs          confere se o BFF responde no contrato que o engine espera
  .env.exemplo      copie para .env e preencha a GEMINI_API_KEY
```

## O servidor de IA (`/server`)

O navegador não pode ver a `GEMINI_API_KEY` — qualquer pessoa abriria o
DevTools e a levaria. Então quem fala com o Gemini é um processo Node separado,
o BFF. Ele expõe dois endpoints:

```
POST http://localhost:3000/api/vision/process-local      (a prancha, por imagem)
  { local, imagemLocal, imagemLegenda, vetor, documento, pagina }
→ { ok, motor, modelo, ms, especificacoes: [ ...Especificacao ] }

POST http://localhost:3000/api/text/process-memorial     (o memorial, por sentido)
  { documento, paginas: [{ pagina, texto }], locais: [{ id, nome, especificacoes }] }
→ { ok, motor, modelo, ms, lotes, recusadas, atualizacoes: [ ...Atualizacao ] }
```

### Fusão semântica do memorial

A prancha diz `Piso 01` e a legenda traduz para `PORCELANATO A DEFINIR`. O
memorial, dez páginas depois, escreve *"Piso: porcelanato Flakes SBE NAT
120x120, marca Ceusa"*. É o mesmo produto, e **nenhuma substring liga os dois**
— só o sentido liga. É esse casamento que a rota do memorial faz.

O que a fusão pode e não pode fazer:

| | |
|---|---|
| preenche | `produto`, `sistema`, `marca`, `modelo`, `fornecedor` — **somente onde estava vazio** |
| não toca | a `descricao` que a prancha deu. Só preenche quando a prancha não descreveu nada |
| material diferente | vira `status: 'conflito'` com as duas fontes em `divergencias` — nunca uma correção silenciosa |
| toda alteração | ganha uma `Evidencia` nova `tipo: 'texto_memorial'` com a página e o **trecho literal**, e `proveniencia: { motor_ia: 'multimodal_gemini', metodo: 'fusao_semantica' }` |

Três travas no servidor (`sanearMemorial`), porque prompt não é garantia:

1. **ID inventado cai.** Só IDs que existem de verdade na árvore são aceitos.
2. **Sem trecho, sem atualização.** Alteração sem a frase do memorial que a
   sustenta é descartada — é a Regra de Ouro da evidência, imposta em código.
3. **Uma por especificação.** Conflito ganha de enriquecimento; entre iguais,
   ganha a de maior confiança.

O `recusadas` na resposta conta o que caiu em cada trava — útil para afinar o
prompt. Quando a IA está desligada ou o servidor cai, o memorial passa pelo
cruzamento heurístico de sempre (`cruzarComPranchas`): a leitura do memorial
nunca é abortada, e a tela de Documentos mostra qual dos dois trabalhou.

### Primeira vez

```bash
cd prancharia/server
npm install                      # express, cors, dotenv, @google/generative-ai
cp .env.exemplo .env
```

Abra o `.env` e preencha a chave (pegue em https://aistudio.google.com/apikey):

```
GEMINI_API_KEY=AIza...
```

### Rodar

```bash
cd prancharia/server
npm start           # http://localhost:3000
npm run dev         # o mesmo, reiniciando a cada edição
npm run ping        # confere se está respondendo no contrato certo
```

Deixe este terminal aberto e abra **outro** para o servidor de arquivos do
frontend (`python3 -m http.server 8000`). São dois processos.

### Ligar o motor multimodal no frontend

O padrão é o motor vetorial. Para ligar a IA, abra o console do navegador na
página e rode:

```js
const eng = await import('./js/core/engine.js');
await eng.saudeDaIA();                                  // confere se o BFF está no ar
eng.configurarIA({ provedor: 'multimodal_gemini' });    // liga (fica gravado)
eng.configurarIA({ provedor: 'fallback_vetorial' });    // desliga
eng.IA                                                  // configuração e contadores
```

A escolha fica no `localStorage`, então sobrevive ao recarregar. Também dá para
fixar antes do carregamento pondo `window.PRANCHARIA_IA = { provedor: '...' }`
no HTML.

Opções de `configurarIA`:

| opção | padrão | o que faz |
|---|---|---|
| `provedor` | `fallback_vetorial` | qual motor usar |
| `bff` | `http://localhost:3000` | endereço do servidor |
| `timeoutMs` | `60000` | quanto esperar por chamada de prancha antes de cair no vetorial |
| `timeoutMemorialMs` | `180000` | o mesmo para a fusão do memorial, que vai em uma chamada por lote |
| `maxFalhas` | `3` | falhas seguidas até desligar o motor pelo resto da sessão |
| `lerLocaisSemTag` | `true` | também chama a IA nos locais sem nenhuma tag — é onde estão as hachuras |
| `paralelas` | `3` | chamadas simultâneas ao BFF |

### Testar sem chave e sem `npm install`

O simulador responde no mesmo contrato, sem tocar no Gemini e sem dependência
alguma:

```bash
node server/simulador.mjs              # porta 3000
LENTO=8000 node server/simulador.mjs   # simula demora, para testar o timeout
FALHAR=1 node server/simulador.mjs     # responde 502, para testar o fallback
```

O `server.js` também tem esse modo: `npm run simular`.

Duas suítes na raiz sobem simuladores e validam a ligação inteira:

```bash
node iatest.mjs      # pranchas: chamada, mesclagem híbrida, proveniência,
                     # timeout, disjuntor, fallback
node fustest.mjs     # memorial: casamento semântico, enriquecimento só em
                     # campo vazio, conflito, evidência com trecho literal,
                     # travas contra alucinação de ID e contra falta de prova
```

### O que o servidor garante

1. **Nunca devolve "N/A".** `prompt.js` sanea a resposta do modelo: categoria
   fora das 13 oficiais vira `""`, preenchimento de cortesia vira `""`, linha
   sem conteúdo é descartada, linha repetida é descartada. O prompt pede; o
   código impõe.
2. **Sempre responde JSON**, inclusive ao falhar, com `ok: false` e `erro`.
3. **Responde 503 sem chave**, para o frontend cair no vetorial em vez de
   travar o processamento da prancha.

### Quando algo dá errado

| sintoma | o que é |
|---|---|
| `503 GEMINI_API_KEY não configurada` | falta o `.env`, ou o `npm start` foi rodado de outra pasta |
| `504 tempo limite estourado` | recorte grande ou modelo lento. Suba o `GEMINI_TIMEOUT_MS` no `.env` |
| `502` com mensagem do Google | cota, chave inválida ou modelo indisponível. A mensagem vem inteira no corpo |
| memorial com 0 atualizações | veja `recusadas` na resposta: muito `idDesconhecido` é prompt a afinar; muito `semTrecho` é o modelo resumindo em vez de copiar |
| `Failed to fetch` no console | o BFF não está rodando, ou o `bff` aponta para a porta errada |
| tudo sai com `fallback_vetorial` | o motor se desligou depois de `maxFalhas`. Veja `eng.IA.ultimoErro` |

Em **todos** esses casos o processamento da prancha termina normalmente, com o
motor vetorial. A IA nunca é capaz de abortar uma extração.

### A página publicada

A publicação como artifact roda em sandbox sem rede externa: lá o
`multimodal_gemini` não alcança `localhost:3000` e o sistema fica no motor
vetorial. O motor multimodal é para rodar local — ou, no futuro, com o BFF
hospedado e o endereço em `configurarIA({ bff: 'https://...' })`.

## Modo nuvem — projetos compartilhados e memória por empresa

Até aqui os dados viviam no navegador de quem processou a prancha. Agora eles
podem viver no servidor, e isso destrava duas coisas: **a mesma equipe trabalha
no mesmo levantamento**, e **cada construtora acumula a própria memória técnica**.

### Subir

```bash
cd server
node simulador.mjs          # zero dependências — já serve dados e arquivos de verdade
# ou, com npm disponível:
npm install && npm start    # express + @google/generative-ai + o Gemini de verdade
```

Recarregue o Prancharia. Ele detecta o servidor sozinho e passa a gravar lá. Se
o servidor não responder na abertura (hibernando), a tela de Empreendimentos
avisa, o sistema continua sondando em segundo plano e liga a nuvem sozinho
quando ele acordar — sem recarregar a página.

O banco é um arquivo só: `server/dados/prancharia.db`. As pranchas ficam em
`server/dados/pranchas/`, nomeadas pelo SHA-256 do conteúdo. Copiar essa pasta
inteira é o backup, e é também a mudança de máquina.

### Banco persistente — obrigatório no Render free ("não vejo em outro navegador")

**A causa.** O plano gratuito do Render tem disco efêmero: a cada hibernação
(~15 min sem uso) ou deploy a instância nasce limpa e `server/dados/` some —
o `/api/health` do servidor publicado mostrava `projetos: 0` mesmo depois de
criar empreendimentos. Quem criou continuava vendo os dados só porque o próprio
navegador tinha caído em modo local; qualquer outro navegador via o servidor
vazio. Não é bug de cache nem de CORS: os dados eram apagados de verdade.

**A solução** é tirar o banco do disco. `server/db.js` agora tem um terceiro
driver, **Turso/libSQL** (SQLite hospedado, plano gratuito), e
`armazenamento.js` ganhou o modo `banco`, que guarda os PDFs na tabela `blobs`
do mesmo banco. Nada mais muda: mesmas rotas, mesmo esquema.

Passo a passo (uma vez, ~5 minutos):

1. Crie uma conta em <https://turso.tech> e instale a CLI
   (`curl -sSfL https://get.tur.so/install.sh | bash`, ou pelo site: *Databases → Create*).
2. Crie o banco e pegue a URL e o token:
   ```bash
   turso db create prancharia
   turso db show --url prancharia          # libsql://prancharia-<seu-usuario>.turso.io
   turso db tokens create prancharia       # eyJhbGci...
   ```
3. No painel do Render → serviço `prancharia-bff` → **Environment**, adicione:
   ```
   TURSO_DATABASE_URL = libsql://prancharia-<seu-usuario>.turso.io
   TURSO_AUTH_TOKEN   = eyJhbGci...
   ARMAZENAMENTO      = banco
   ```
   (o `render.yaml` já declara as três; só os valores são preenchidos à mão).
4. Salve — o Render faz o redeploy. No log de subida deve aparecer
   `banco .............. libsql · libsql://...` e `pranchas em ........ banco`.
   Se em vez disso aparecer `ATENÇÃO ... DISCO EFÊMERO`, alguma variável não
   pegou.
5. Abra o Prancharia em qualquer navegador: `/api/health` passa a responder
   `"persistente": true` e o aviso vermelho da tela de Empreendimentos some.

Enquanto o servidor estiver sem banco persistente, o frontend se defende:
grava uma **cópia local de tudo** (write-through) mesmo em modo nuvem, avisa em
vermelho na tela de Empreendimentos, e ao abrir **reenvia sozinho** os projetos
que só existem no navegador (sem nunca sobrescrever o que o servidor já tem).
Projeto que existe nos dois lados com a versão local mais nova aparece num
aviso com o botão *Enviar a versão deste navegador*.

Para testar localmente sem conta no Turso, o driver aceita arquivo:
`TURSO_DATABASE_URL=file:./dados/teste.db ARMAZENAMENTO=banco npm start`.

> **Não há autenticação.** Quem alcança a porta lê e escreve tudo. Isso serve
> numa rede de escritório ou atrás de VPN, e não serve num IP público. O gancho
> `autenticar` no `server.js` é o único lugar a mexer quando isso mudar.

### O esquema

| tabela | o que guarda |
|---|---|
| `empresas` | `id`, `nome`, `regras_ia`, `fornecedores_homologados` (JSON), `vocabulario` (JSON) |
| `projetos` | `id`, `empresa_id`, `nome`, `tipo`, `dados_json` (a árvore inteira), `bytes` |
| `arquivos` | índice das pranchas: `id`, `projeto_id`, `sha256`, `chave` no armazenamento |
| `glossario` | regras aprendidas, por escopo — `global` ou `empresa:<id>` |

Apagar uma empresa **não** apaga os projetos dela: eles voltam para "sem
empresa" (`ON DELETE SET NULL`) e podem ser reatribuídos.

O driver é `better-sqlite3` quando ele está instalado e `node:sqlite` (embutido
no Node 22) quando não está. Os dois leem o mesmo arquivo.

### As rotas

```
GET    /api/health                     estado do banco, do armazenamento e do modelo
GET    /api/companies                  lista
GET    /api/companies/:id              uma
GET    /api/companies/:id/prompt       o texto exato que vai para o Gemini
POST   /api/companies[/:id]            cria ou atualiza (só os campos enviados)
DELETE /api/companies/:id
GET    /api/projects[?companyId=]      só os cabeçalhos, sem a árvore
GET    /api/projects/:id               o projeto inteiro
POST   /api/projects                   grava a árvore
DELETE /api/projects/:id
GET    /api/projects/:id/files         as pranchas deste projeto
GET    /api/glossary[?companyId=]      global, ou global + empresa
POST   /api/glossary
POST   /api/upload                     multipart; campo `arquivo`
GET    /api/files/:id                  os bytes de volta
```

As três rotas do Gemini aceitam `companyId` no corpo **ou** `X-Empresa-Id` no
cabeçalho. Empresa inexistente não é erro: a chamada segue sem contexto.

### O nível Empresa

Cadastre em **Empresas** o que a prancha nunca declara: como a construtora nomeia
os ambientes, que marcas homologa, e as regras que a IA precisa saber antes de
ler a primeira folha. Isso vira três coisas:

- **`regras_ia`** entra no *System Instruction* do Gemini;
- **`vocabulario`** traduz o nome do local para a língua da casa;
- **`fornecedores_homologados`** faz o glossário reconhecer e grafar certo uma
  marca que o documento cita.

**A trava que sustenta tudo isso** é a regra `E0`, no topo do bloco: o contexto
da empresa é *subordinado* às regras de veracidade e **não pode preencher campo
que o documento deixou vazio**. A empresa comprar só Portobello não autoriza
escrever Portobello onde a prancha não diz marca. Havendo conflito entre a regra
da empresa e o documento, **o documento vence**.

O painel **"O que a IA vai ler"** mostra o texto final, buscado do servidor —
não é uma reconstrução da tela. Cadastrar regra de IA sem poder ler o resultado
seria pedir confiança no escuro.

### O que o modo nuvem não faz

- **Não funciona offline.** Foi a escolha explícita: toda gravação vai direto ao
  servidor e só vale quando ele confirma. O cache de leitura dura 4 segundos e
  serve só para não repetir a mesma viagem.
- **Não resolve conflito.** Duas pessoas gravando o mesmo projeto ao mesmo tempo:
  a última gravação vence. Divida os projetos, não as folhas.
- **Não mescla automaticamente.** Um projeto é uma árvore, gravada inteira.

### Migrar o que já existe

O que está no navegador **sobe sozinho** na primeira abertura com o servidor
no ar: `app.js` chama `store.enviarLocaisParaNuvem({ soNovos: true })`, que
manda os projetos que o servidor não tem, com os PDFs que ainda estiverem no
IndexedDB. O que existir nos dois lados fica para você decidir no aviso da
tela de Empreendimentos. O caminho manual continua valendo: **Planilhas →
Baixar JSON** e importar; o servidor deduplica PDFs pelo SHA-256.

## Importar do Google Drive

Na tela **Upload (Documentos)** o botão **Importar do Google Drive** abre o
seletor do Google (Picker): dá para marcar vários PDFs ou **uma pasta inteira**
(subpastas incluídas, até 4 níveis). Os arquivos são baixados para a memória do
navegador e entram no mesmo caminho do "Enviar arquivos" — IndexedDB, upload
para o servidor do Prancharia (se houver) e processamento. Nada do Drive passa
pelo BFF; o token OAuth vive só na aba.

Tudo mora em `js/core/drive.js`. As credenciais entram de um destes jeitos:

```js
// 1) editando o arquivo (os dois campos marcados com >>> COLE AQUI <<<)
export const GOOGLE = { CLIENT_ID: '...apps.googleusercontent.com', API_KEY: 'AIza...', ... };

// 2) sem editar, no HTML antes do módulo
window.PRANCHARIA_GOOGLE = { CLIENT_ID: '...', API_KEY: '...' };

// 3) sem editar, no console do navegador (fica no localStorage)
const d = await import('./js/core/drive.js');
d.configurarGoogle({ CLIENT_ID: '...', API_KEY: '...' });
```

### Como gerar o CLIENT_ID e a API_KEY no Google Cloud Console

1. **Projeto.** Abra <https://console.cloud.google.com>, crie um projeto (ex.:
   `prancharia`) e selecione-o no topo.
2. **APIs.** Menu *APIs e serviços → Biblioteca*: ative **Google Drive API** e
   **Google Picker API** (as duas — o Picker é uma API separada).
3. **Tela de consentimento.** *APIs e serviços → Tela de permissão OAuth*:
   tipo **Externo**, nome do app "Prancharia", seu e-mail de suporte, salvar.
   Em **Escopos** adicione `.../auth/drive.readonly` (é o que permite listar o
   conteúdo de uma pasta). Em **Usuários de teste** adicione os e-mails que
   vão usar — enquanto o app estiver em "Teste", só eles conseguem entrar
   (até 100, sem passar por verificação do Google).
4. **CLIENT_ID.** *APIs e serviços → Credenciais → Criar credenciais → ID do
   cliente OAuth*: tipo **Aplicativo da Web**. Em **Origens JavaScript
   autorizadas** coloque exatamente de onde a página é servida, sem barra no
   fim: `http://localhost:8000` (ou a porta que você usa) e
   `https://prancharia.vercel.app`. *URIs de redirecionamento* pode ficar
   vazio (o fluxo é por token, em popup). Copie o **ID do cliente** — termina
   em `.apps.googleusercontent.com`.
5. **API_KEY.** *Credenciais → Criar credenciais → Chave de API*. Depois clique
   na chave para restringi-la: **Restrições de aplicativo → Referenciadores
   HTTP** com `http://localhost:8000/*` e `https://prancharia.vercel.app/*`;
   **Restrições de API → Google Picker API**. Copie a chave (`AIza...`).
6. **(Opcional) APP_ID.** É o *Número do projeto* em *Configurações do
   projeto*. Só melhora o Picker; pode ficar vazio.
7. Cole os dois valores em `js/core/drive.js` (ou use `configurarGoogle`),
   recarregue e clique em **Importar do Google Drive**. O primeiro clique abre
   o login do Google e pede a permissão de leitura do Drive.

Erros comuns: `idpiframe_initialization_failed` / `origin_mismatch` é a origem
fora da lista do passo 4 (confira porta e `http` × `https`); `403` ao listar
pasta é escopo sem `drive.readonly` ou usuário fora da lista de teste;
`The API developer key is invalid` é a API_KEY restrita à API errada. A página
publicada como artifact bloqueia scripts do Google — lá o botão avisa e não faz
nada; use o site na Vercel ou o `local.html`.

### Testar

```bash
node nuvtest.mjs      # sobe o próprio servidor, processa duas pranchas A0 reais
                      # e confere que o levantamento atravessa para outra máquina
```

## Exportar para o Obsidian

Em **Planilhas → Obsidian** o levantamento vira um cofre de notas Markdown
(`js/core/obsidian.js`), tudo ligado por `[[links]]`:

```
Prancharia/<Empreendimento>/
  <Empreendimento>.md      índice: resumo, documentos, locais por pavimento, histórico
  Locais/<Local>.md        tabela de especificações; evidências apontam para a nota do documento
  Documentos/<Doc>.md      páginas, locais lidos, tabelas reconhecidas
  Pendências.md            uma tarefa (- [ ]) por item pendente, agrupadas por motivo
  Sem local.md             itens ainda não triados
```

Dois caminhos:

1. **Baixar cofre (.zip)** — funciona sempre. Descompacte dentro da pasta do
   cofre; o Obsidian reconhece na hora.
2. **Gravar direto** — com o Obsidian aberto na mesma máquina e o plugin
   **Local REST API** (Configurações → Plugins da comunidade). No plugin, ligue
   *Enable HTTP server* (porta 27123) e copie a *API key* para o modal. A
   página, mesmo em `https`, fala com `127.0.0.1` sem bloqueio de conteúdo
   misto; a chave fica no `localStorage` deste navegador. A exportação
   sobrescreve as notas do empreendimento e não toca em nada fora da pasta dele.

Regra mantida: célula sem evidência sai vazia, nunca "N/A". `notasDoEmpreendimento`
é pura (sem rede nem DOM), então dá para testar em Node.

### Por que NÃO usamos AnyDoc / MarkItDown para ler as pranchas

AnyDoc (Firecrawl, Rust) e MarkItDown (Microsoft, Python) convertem PDF com
camada de texto em Markdown. Para prancha isso **destrói a informação que o
motor usa**: a leitura depende das coordenadas de cada texto e traço (tag
dentro de qual ambiente, bloco de legenda, tabela pela grade desenhada) — em
Markdown tudo isso vira uma sequência de palavras sem posição. E não é onde
o tempo vai: a extração vetorial de uma A0 leva ~1 s; o custo está nos
recortes e nas chamadas à IA. Onde um conversor faria sentido é o **memorial
descritivo em .docx/.xlsx** (hoje só PDF): converter no BFF e entrar no fluxo
de fusão semântica. Fica como próximo passo se houver memoriais nesse formato.

## Pontos que valem saber antes de mexer

- **Nada de dado sem evidência.** Célula sem respaldo no documento sai vazia,
  nunca "N/A". Se você alterar `exporter.js` ou `engine.js`, mantenha isso.
- **A barra de progresso** (`views.js`, `atualizarProgresso`) mostra o
  percentual do **lote inteiro**: `(arquivosProntos + fraçãoDoAtual) / total`.
  Texto, número e barra têm id próprio e são atualizados juntos; `consolidar`
  recebe o callback e reporta local a local (é a fase cara com a IA ligada).
  O callback devolve uma Promise que cede ao navegador a cada ~80 ms — se
  você criar uma etapa nova, use `await aoProgredir(...)` para a barra pintar.
- **Geometria das pranchas.** As folhas A0 vêm com rotação 270; a conversão
  está em `pdfdoc.js`/`shapes.js`. Mexer ali afeta todos os recortes.
- **Formas iguais com números iguais são materiais diferentes.** A chave de
  legenda é `forma + número` (`legend.js`), nunca só o número.
- **O visor desenha apenas a janela visível** (`viewer.js`, função `quadro`).
  Renderizar a página inteira em zoom alto estoura o limite de canvas do
  navegador e sai em branco.
- **Um render de PDF por vez.** Todos passam pela fila `naFila` em
  `viewer.js`; dois renders concorrentes na mesma página travam um ao outro.
- **Imports circulares.** `views.js` e `app.js` se importam; qualquer constante
  calculada no topo do módulo a partir do outro precisa ser preguiçosa
  (veja `listaSistemas`).
- **"OU SIMILAR" não é descrição genérica.** No merge de duas fontes
  (`incorporarEspecificacao`), só `A DEFINIR`, `A ESPECIFICAR`, `conforme
  projeto` e vazio contam como aberto e podem ser detalhados por outra fonte.
  Material especificado com permissão de equivalente comercial é material
  especificado: se a outra fonte diz coisa diferente, é conflito.
- **O recorte é o caro, não a IA.** Cada chamada multimodal precisa de um
  render de canvas da região do local (~1,5 s numa A0). Com 40 locais isso
  domina o tempo da folha. Se precisar acelerar, baixe
  `OPCOES_RECORTE.larguraLocal` em `engine.js` — custa resolução para a IA.
- **Auditoria automática** roda em `views.js`, função `auditarNoProcessamento`.
  A lista `AUTO_SEGURAS` é a única coisa que o sistema corrige sozinho —
  só preenchimento de campo vazio e categoria fora do vocabulário.

## Republicar

Se você editar e quiser publicar de novo como artifact, o arquivo de entrada é
o `index.html` (sem doctype) e todos os demais entram como arquivos de apoio,
nos mesmos caminhos relativos.
