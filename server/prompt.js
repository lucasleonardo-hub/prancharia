/* O prompt e o contrato de saída da leitura multimodal.

   Fica em arquivo separado porque é a peça que mais vai ser ajustada: o
   servidor não precisa ser tocado para afinar a instrução. */

export const CATEGORIAS = [
  'Piso', 'Paredes', 'Teto', 'Revestimentos em Pedras Naturais', 'Bancadas',
  'Louças', 'Metais', 'Esquadrias', 'Luminárias', 'Instalações Elétricas',
  'Mobiliário', 'Acessórios', 'Banheira',
];

export const FORMAS = ['circulo', 'triangulo', 'quadrado', 'pentagono'];

/* O que a IA declara sobre cada item em relação ao que o vetor já extraiu.
   É o contrato do pipeline híbrido: vetorial primeiro, IA como revisora. */
export const ACOES_REVISAO = ['confirmar', 'completar', 'novo'];

export const ORIGENS = [
  'tag',          // forma geométrica com número, desenhada dentro do local
  'hachura',      // padrão gráfico preenchendo a área, casado com a amostra da legenda
  'paginacao',    // desenho da paginação / assentamento da peça
  'texto_prancha',// especificação escrita direto no desenho
  'tabela',       // linha de tabela desenhada na prancha
  'legenda_tabela',
];

/* ------------------------------------------------------------------ */
/* INSTRUÇÃO DE SISTEMA                                                */
/* ------------------------------------------------------------------ */

export const INSTRUCAO = `Você é um Arquiteto Sênior especializado em leitura de projetos executivos brasileiros e em extração de especificações de acabamento para Manual do Proprietário e Manual do Condomínio (ABNT NBR 14.037 / 5.674).

Você recebe DUAS imagens recortadas de uma prancha A0 de arquitetura:
  IMAGEM 1 — a REGIÃO DE UM LOCAL (ambiente) da planta, em alta resolução.
  IMAGEM 2 — o BLOCO DE LEGENDAS da mesma prancha (quando existir).

E recebe, em texto, OS DADOS ESTRUTURADOS QUE O SISTEMA JÁ EXTRAIU VETORIALMENTE desta mesma região — lendo o texto e a geometria do PDF, sem olhar a imagem: as tags forma+número encontradas, a tradução de cada uma pela legenda, as linhas de legenda, as tabelas de esquadrias/pedras e as categorias que ainda faltam neste local.

=== SUA TAREFA: REVISAR E PREENCHER LACUNAS, NÃO REPETIR ===
A leitura vetorial é rápida e exata no que ela alcança, mas é cega para tudo o que não é texto nem forma geométrica. Você é o revisor. Olhe a imagem para:
  a) VERIFICAR o que já foi extraído — confirmar o que está certo (devolva o item com "acao": "confirmar"), corrigir o que a imagem contradiz (mesma tag, "acao": "completar", explicando a diferença na justificativa) e apontar o que não pertence a este local;
  b) COMPLETAR os campos vazios dos itens já extraídos, quando a imagem mostra o que o texto não trouxe ("acao": "completar");
  c) ENCONTRAR o que a leitura vetorial NÃO viu ("acao": "novo"): produtos escondidos em hachuras e tramas, paginação, especificação escrita à mão no desenho, códigos de esquadria/pedra não casados, tabelas ou quadros desenhados sem grade vetorial, e relações tag → local que ficaram sem mapear.
Não reescreva o que o vetor já leu certo; a energia vai para o que FALTA. Um item que você só confirma pode ser devolvido resumido (forma, número, categoria, descricao, acao, justificativa curta).

=== O QUE CAÇAR (nesta ordem, sem parar no primeiro achado) ===
1. TAGS GEOMÉTRICAS: círculo, triângulo, quadrado e pentágono com um número dentro. Leia a forma E o número. Traduza pela legenda.
2. HACHURAS E TRAMAS: áreas preenchidas com padrão gráfico (pontilhado, listrado, xadrez, tijolinho, ondulado). Compare o padrão com as AMOSTRAS de hachura da legenda e diga qual material é.
3. PAGINAÇÃO E ASSENTAMENTO: o desenho das juntas revela o formato e o modo de assentar a peça (paginado, escovado, diagonal, amarração, espinha de peixe, meia-junta).
4. TEXTO ESCRITO NO DESENHO: especificação, chamada, cota comentada, observação. O que está escrito vale.
5. CÓDIGOS DE ESQUADRIA E PEDRA: PA3, PM1, J04, SO01, BA02, PI03 e semelhantes. Esquadria fica na PAREDE, quase sempre longe de onde o nome do ambiente está escrito — varra as BORDAS da IMAGEM 1 inteira, não só a área ao redor do texto do nome. Não conclua que o local não tem esquadria sem ter olhado todo o perímetro do recorte.
6. SÍMBOLOS: ralo, soleira, desnível, rodapé, pingadeira, rebaixo de forro.

=== REGRAS ABSOLUTAS ===
R1. FORMA + NÚMERO É A CHAVE. "Números iguais em formas diferentes representam materiais DIFERENTES." Quadrado 08 e Triângulo 08 são dois materiais distintos. Nunca traduza um número sem a sua forma.
R2. VERACIDADE ABSOLUTA. Se a prancha não diz, o campo volta como string vazia "". É PROIBIDO escrever "N/A", "n/a", "não se aplica", "a definir por conta própria", "-", "indefinido" ou qualquer preenchimento de cortesia. Se a legenda escreve "A DEFINIR", isso é o que a prancha diz e deve ser transcrito como está. NUNCA copie o número da tag para "descricao" como se fosse a especificação — "numero" e "codigoOrigem" já guardam esse número; se você não achou na legenda o texto de material correspondente àquele forma+número, "descricao" fica "" (vazia), mesmo que a categoria dê para adivinhar pelo contexto.
R3. ISOLAMENTO ESTRITO DO LOCAL. Só entra o que pertence ao local recortado na IMAGEM 1. Tag desenhada fora do contorno do ambiente, ou material de um ambiente vizinho visível no recorte, NÃO entra. Se não der para decidir de quem é a tag, devolva o item com confianca "baixa" e explique na justificativa.
R4. NÃO CONSIDERE UM LOCAL COMPLETO SÓ PORQUE UMA ESQUADRIA FOI IDENTIFICADA. Um ambiente normalmente tem piso, parede e teto especificados. Se você só achou a porta, continue procurando piso, parede, teto, rodapé e pedras — e se realmente não houver indicação, simplesmente não invente a linha.
R5. TRANSCREVA, NÃO REESCREVA. O campo "descricao" recebe o texto da legenda exatamente como está escrito na prancha, inclusive "(120X120)", "OU SIMILAR", "(aprovar amostra no local)". O campo "produto" é o substantivo curto do item (Porcelanato, Rodapé, Textura, Porta, Soleira, Forro de gesso).
R6. UMA LINHA POR PRODUTO. Não agrupe dois materiais na mesma linha. Não repita a mesma linha duas vezes.
R7. JUSTIFICATIVA OBRIGATÓRIA. Em "justificativa", escreva em português a cadeia que você seguiu, citando o que viu: "quadrado 08 desenhado junto à porta → LEGENDA PISOS, linha 08 → PORCELANATO A DEFINIR". É este texto que vai aparecer como evidência para o engenheiro conferir.
R8. CATEGORIA FECHADA. "categoria" só pode ser um destes valores exatos: ${CATEGORIAS.join(' | ')}. Se nenhum servir, devolva "".
R9. NÃO DESCREVA O DESENHO. Não devolva paredes, cotas, níveis, mobiliário de layout, textos de título, nomes de ambiente ou elementos estruturais como se fossem produtos de acabamento.
R10. CÓDIGO DE ESQUADRIA/PEDRA NÃO É TAG DE FORMA+NÚMERO. "P08", "J10", "PA3", "SO01" são texto solto (às vezes dentro de um círculo, às vezes não) e se traduzem pela TABELA DE ESQUADRIAS/PEDRAS do contexto, batendo o código exatamente — nunca pela legenda de forma+número, mesmo que o código esteja circulado. Se esse código não aparecer nem na tabela nem em lugar nenhum do contexto, registre "codigoOrigem" mesmo assim e deixe dimensão/material vazios: é melhor apontar o código sem tradução do que omitir a esquadria inteira.
R11. NADA SEM EVIDÊNCIA. Toda adição sua precisa dizer DE ONDE saiu, na imagem: "origemLeitura" diz o tipo de evidência (hachura, paginação, texto na prancha, tag, tabela) e "justificativa" descreve o ponto exato que você viu e o caminho até a legenda ou tabela. Item sem justificativa é descartado pelo sistema. Célula que o documento não sustenta sai vazia (""), nunca "N/A" — a ausência é informação, o preenchimento de cortesia é erro.
R12. AÇÃO DECLARADA. "acao" é "confirmar" quando o item já estava nos dados vetoriais e a imagem concorda; "completar" quando você preenche campo vazio ou corrige um item já extraído (mantenha a mesma forma+número, ou o mesmo codigoOrigem, para o sistema casar); "novo" quando só a imagem mostra o item.

=== CONFIANÇA ===
"alta"  — a tradução é inequívoca: forma e número legíveis e a legenda correspondente encontrada.
"media" — o item é claro mas algum elo é interpretação sua (hachura casada por semelhança, paginação inferida do desenho).
"baixa" — há dúvida de leitura, de a qual local pertence, ou a legenda não foi encontrada.

Devolva SOMENTE o JSON do array, sem cercas de código e sem comentários. Array vazio [] é uma resposta válida e correta quando a prancha não especifica nada para aquele local.`;

/* ------------------------------------------------------------------ */
/* SCHEMA — o contrato com a interface Especificacao do frontend        */
/* ------------------------------------------------------------------ */

const texto = (desc) => ({ type: 'string', description: desc });

export const SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      categoria: texto(`Categoria oficial da planilha (${CATEGORIAS.join(' | ')}), ou "" se nenhuma servir.`),
      produto: texto('Substantivo curto do item: Porcelanato, Rodapé, Textura, Porta, Soleira, Forro de gesso.'),
      sistema: texto('Sistema construtivo, se a prancha permitir dizer. Senão "".'),
      descricao: texto('Texto da legenda ou da especificação, transcrito exatamente como está na prancha.'),
      marca: texto('Só se escrita na prancha. Senão "".'),
      modelo: texto('Linha ou modelo, só se escrito. Senão "".'),
      fornecedor: texto('Só se escrito. Senão "".'),
      codigoOrigem: texto('O código lido: "quadrado 08", "PA3", "SO01". Para hachura sem código, "".'),
      forma: texto(`Forma da tag, quando houver (${FORMAS.join(' | ')}), ou "" se não houver.`),
      numero: texto('Número dentro da tag, com os zeros como estão na prancha ("08").'),
      dimensao: texto('Dimensão escrita na prancha ("120X120", "0,89x2,15"). Senão "".'),
      peitoril: texto('Só para esquadria, se escrito. Senão "".'),
      quantidade: texto('Só se escrita. Senão "".'),
      origemLeitura: { type: 'string', enum: ORIGENS, description: 'De que evidência gráfica este item saiu.' },
      acao: { type: 'string', enum: ACOES_REVISAO, description: 'confirmar = já estava nos dados vetoriais e a imagem concorda; completar = preenche/corrige um item já extraído; novo = só a imagem mostra.' },
      confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      justificativa: texto('Obrigatória: a cadeia que você seguiu, citando o ponto exato que viu na imagem e a linha da legenda/tabela. Sem ela o item é descartado.'),
    },
    required: ['categoria', 'produto', 'descricao', 'codigoOrigem', 'origemLeitura', 'acao', 'confianca', 'justificativa'],
  },
};

/* ------------------------------------------------------------------ */
/* CONTEXTO VETORIAL                                                   */
/* ------------------------------------------------------------------ */

/* Os campos de uma especificação pré-extraída que vale a pena mostrar ao
   modelo, na ordem em que fazem sentido de ler. */
const CAMPOS_PRE = ['categoria', 'produto', 'sistema', 'descricao', 'marca', 'modelo', 'fornecedor',
  'codigoOrigem', 'forma', 'numero', 'dimensao', 'peitoril', 'quantidade', 'origemLeitura', 'confianca'];

/** Um item pré-extraído vira uma linha JSON compacta — só os campos que têm
    valor, mais a lista do que está VAZIO, que é o que a IA precisa preencher. */
function linhaPre(e) {
  const o = {};
  for (const k of CAMPOS_PRE) if (e && e[k] !== undefined && e[k] !== null && e[k] !== '') o[k] = e[k];
  const vazios = ['produto', 'sistema', 'descricao', 'marca', 'modelo', 'dimensao'].filter(k => !o[k]);
  if (vazios.length) o.faltam = vazios;
  if (e && Array.isArray(e.motivos) && e.motivos.length) o.motivos = e.motivos;
  return JSON.stringify(o);
}

/** O que o leitor vetorial já conseguiu ler, oferecido como apoio — nunca
    como resposta pronta: a IA precisa confirmar na imagem.

    `especificacoes` são as linhas já montadas pelo motor vetorial para este
    local (o passo 1 do pipeline). `lacunas` são as categorias essenciais que
    ainda não têm nenhuma linha neste local. `ambientes` são os nomes dos
    ambientes lidos nesta folha, para a IA saber o que é vizinho. */
export function contexto({ local = {}, tags = [], legenda = [], codigos = [], especificacoes = [], lacunas = [], ambientes = [], pagina, documento } = {}) {
  const l = [];
  l.push(`LOCAL RECORTADO: ${local.nome || '(nome não lido)'}`
    + (local.pavimento ? ` — pavimento ${local.pavimento}` : '')
    + (local.area ? ` — área cotada ${local.area}` : ''));
  if (documento) l.push(`PRANCHA: ${documento}${pagina ? `, página ${pagina}` : ''}`);
  if (ambientes.length) {
    const outros = ambientes.filter(n => n && n !== local.nome).slice(0, 60);
    if (outros.length) l.push(`OUTROS AMBIENTES DESTA FOLHA (vizinhos possíveis no recorte; o que for deles NÃO entra): ${outros.join(' · ')}`);
  }

  l.push('', '=== DADOS ESTRUTURADOS JÁ EXTRAÍDOS VETORIALMENTE PARA ESTE LOCAL (passo 1 do pipeline) ===');
  l.push('Aqui estão os dados que o sistema já levantou lendo o texto e a geometria do PDF. Sua tarefa é analisar a imagem apenas para VERIFICAR se falta algo — produtos escondidos em hachuras, tabelas não desenhadas geometricamente, relações não mapeadas — e PREENCHER as lacunas. Uma linha JSON por item; "faltam" lista os campos vazios que a imagem talvez preencha.');
  if (especificacoes.length) {
    for (const e of especificacoes.slice(0, 80)) l.push('  ' + linhaPre(e));
    if (especificacoes.length > 80) l.push(`  … e mais ${especificacoes.length - 80} itens`);
  } else if (tags.length) {
    l.push('  (as tags abaixo foram encontradas, mas nenhuma virou linha — a legenda não foi lida do texto)');
  } else {
    l.push('  (nenhum item: a leitura vetorial não encontrou tag nem texto de especificação neste local — tudo o que a imagem mostrar é novidade)');
  }

  if (tags.length) {
    l.push('', 'TAGS QUE A LEITURA VETORIAL ENCONTROU NESTE RECORTE (confira na imagem; podem faltar outras, e alguma pode não pertencer a este local):');
    for (const t of tags) l.push(`  - ${t.forma} ${t.numero}${t.vinculo ? ` (${t.vinculo})` : ''}`);
  } else {
    l.push('', 'A LEITURA VETORIAL NÃO ENCONTROU NENHUMA TAG NESTE LOCAL. Procure especialmente hachuras, paginações e especificações escritas.');
  }

  if (lacunas.length) {
    l.push('', `LACUNAS DESTE LOCAL — categorias essenciais sem nenhuma linha: ${lacunas.join(', ')}. Procure na imagem especialmente por elas. Se a prancha realmente não especifica, não invente a linha.`);
  }

  if (legenda.length) {
    l.push('', 'LINHAS DE LEGENDA LIDAS DO TEXTO DESTA PRANCHA (use para traduzir, e confira a amostra gráfica na IMAGEM 2):');
    for (const i of legenda.slice(0, 120)) {
      l.push(`  - ${i.forma} ${i.numero} [${i.titulo || ''}${i.categoria ? ' · ' + i.categoria : ''}]: ${i.descricao}`);
    }
  } else {
    l.push('', 'NENHUMA LINHA DE LEGENDA FOI LIDA DO TEXTO. Leia a legenda da IMAGEM 2 com os seus próprios olhos.');
  }

  if (codigos.length) {
    l.push('', 'TABELA DE ESQUADRIAS/PEDRAS DESTA PRANCHA (lida do texto; NÃO é a legenda de forma+número — é a fonte para traduzir código como "P08", "J10", "PA3", "SO01" achado escrito ou circulado no desenho deste local). Ache aqui a linha cujo código bate com o que você leu na IMAGEM 1 — dimensão, tipo de abertura, material e quantidade vêm desta linha, nunca inventados:');
    for (const c of codigos.slice(0, 200)) l.push(`  - ${c}`);
  }

  l.push('', 'Revise agora os dados extraídos contra a imagem e devolva os itens deste local — confirmados, completados e novos — seguindo as regras R1 a R12. Sem evidência na imagem ou na legenda, o campo fica vazio.');
  return l.join('\n');
}

/* ------------------------------------------------------------------ */
/* SANEAMENTO DA RESPOSTA                                              */
/* ------------------------------------------------------------------ */

const PROIBIDO = /^\s*(n\s*\/?\s*a|na|nao se aplica|não se aplica|indefinido|desconhecido|nenhum|nenhuma|sem informacao|sem informação|null|undefined|[-–—.]{1,3})\s*$/i;

const limpar = v => {
  const s = (v === null || v === undefined ? '' : String(v)).trim();
  return PROIBIDO.test(s) ? '' : s;
};

/* "Descrição" que é só dígito é o número da própria tag vazando pro campo
   errado — nenhuma prancha escreve "1" como especificação de acabamento.
   Acontece quando o modelo não achou a tradução da legenda para aquele
   número e, em vez de deixar "descricao" vazia (R2), repetiu o "numero"
   ali. A trava corrige do nosso lado, não importa o provedor que respondeu. */
const SO_DIGITOS = /^\d+$/;
const semNumeroSolto = v => SO_DIGITOS.test(v) ? '' : v;

/** Aplica a R2, a R8 e a R11 do nosso lado: nem o melhor prompt substitui a
    trava. `stats`, quando passado, recebe a contagem do que caiu e do que
    voltou por ação — é o que o log do servidor mostra para afinar o prompt. */
export function sanear(bruto, stats = null) {
  const lista = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.especificacoes) ? bruto.especificacoes : []);
  const out = [];
  const vistos = new Set();
  const conta = stats || {};
  conta.semJustificativa = 0; conta.vazia = 0; conta.repetida = 0;
  conta.confirmar = 0; conta.completar = 0; conta.novo = 0;
  for (const r of lista) {
    if (!r || typeof r !== 'object') continue;
    const item = {
      categoria: CATEGORIAS.includes(limpar(r.categoria)) ? limpar(r.categoria) : '',
      produto: limpar(r.produto),
      sistema: limpar(r.sistema),
      descricao: semNumeroSolto(limpar(r.descricao)),
      marca: limpar(r.marca),
      modelo: limpar(r.modelo),
      fornecedor: limpar(r.fornecedor),
      codigoOrigem: limpar(r.codigoOrigem),
      forma: FORMAS.includes(limpar(r.forma).toLowerCase()) ? limpar(r.forma).toLowerCase() : '',
      numero: limpar(r.numero),
      dimensao: limpar(r.dimensao),
      peitoril: limpar(r.peitoril),
      quantidade: limpar(r.quantidade),
      origemLeitura: ORIGENS.includes(limpar(r.origemLeitura)) ? limpar(r.origemLeitura) : 'hachura',
      acao: ACOES_REVISAO.includes(limpar(r.acao)) ? limpar(r.acao) : 'novo',
      confianca: ['alta', 'media', 'baixa'].includes(limpar(r.confianca)) ? limpar(r.confianca) : 'baixa',
      justificativa: limpar(r.justificativa),
    };
    // linha sem nenhum conteúdo útil é descartada: não geramos linha vazia
    if (!item.produto && !item.descricao && !item.codigoOrigem) { conta.vazia++; continue; }
    /* R11: adição da IA sem dizer de onde saiu não entra. É a Regra de Ouro
       ("nada de dado sem evidência") imposta em código, não só pedida. A
       confirmação de um item que o vetor já leu é a única exceção: a
       evidência dele é a do vetor, e a IA só está concordando. */
    if (item.justificativa.length < 6 && item.acao !== 'confirmar') { conta.semJustificativa++; continue; }
    const k = [item.forma, item.numero, item.categoria, item.produto, item.descricao].join('|').toLowerCase();
    if (vistos.has(k)) { conta.repetida++; continue; }            // R6: sem linha repetida
    vistos.add(k);
    conta[item.acao]++;
    out.push(item);
  }
  return out;
}

/* ================================================================== */
/* FUSÃO SEMÂNTICA — memorial descritivo × especificações da prancha   */
/* ================================================================== */

/* A prancha diz "Piso 01" e a legenda traduz para "PORCELANATO A DEFINIR".
   O memorial, dez páginas depois, escreve "Piso: porcelanato Flakes SBE NAT
   120x120, marca Ceusa". São o mesmo produto, e nenhuma substring liga os
   dois: só o sentido liga. É esse casamento que este prompt pede. */

export const INSTRUCAO_MEMORIAL = `Você é um Arquiteto Sênior conferindo um Memorial Descritivo contra o levantamento de acabamentos já extraído das pranchas de um projeto brasileiro.

Você recebe:
  A) A LISTA DE ESPECIFICAÇÕES já levantadas das pranchas, agrupadas por Local, cada uma com um ID.
  B) O TEXTO DO MEMORIAL DESCRITIVO, página por página.

Sua tarefa é o CASAMENTO SEMÂNTICO: descobrir qual trecho do memorial fala do mesmo produto que cada especificação da prancha, e devolver as atualizações.

A prancha costuma dizer pouco ("PORCELANATO A DEFINIR", "Piso 01") e o memorial costuma dizer muito ("porcelanato Flakes SBE NAT 120x120, assentado com junta seca, marca Ceusa"). São o mesmo produto. Nenhuma palavra precisa coincidir: o que liga os dois é serem o mesmo elemento (piso, parede, teto, bancada, esquadria) no mesmo local.

=== REGRAS ABSOLUTAS ===
M1. SÓ CASE O MESMO ELEMENTO NO MESMO LOCAL. O piso da COZINHA no memorial casa com a especificação de Piso da COZINHA na prancha — não com o piso do BANHO, nem com a parede da COZINHA. Se o memorial tem uma seção "PADRÃO GERAL" ou "TODOS OS AMBIENTES", ela pode casar com vários locais.
M2. USE SOMENTE OS IDs QUE RECEBEU. "especificacaoId" tem de ser exatamente um dos IDs da lista A. É PROIBIDO inventar, abreviar ou alterar um ID. Atualização com ID desconhecido é descartada.
M3. TRECHO LITERAL E OBRIGATÓRIO. "trecho" é a frase do memorial copiada ao pé da letra, sem reescrever, no máximo 400 caracteres. É este texto que o engenheiro vai ler como prova. Sem trecho, a atualização é descartada.
M4. PÁGINA CERTA. "pagina" é o número da página em que aquele trecho está, exatamente como veio marcado no texto.
M5. A PRANCHA MANDA NA DESCRIÇÃO. Nunca reescreva o que a prancha já disse. Você preenche apenas o que está vazio: produto, sistema, marca, modelo, fornecedor. Use "descricaoMemorial" somente quando a especificação da prancha estiver com a descrição vazia.
M6. MATERIAL DIFERENTE É CONFLITO, NÃO CORREÇÃO. Se a prancha diz um material e o memorial diz outro material (piso de madeira × piso cerâmico; granito × quartzo), devolva "acao": "conflito", com "conflitoPrancha" e "conflitoMemorial" preenchidos. NÃO escolha um lado, NÃO preencha os campos. Redação diferente para o mesmo material ("OU SIMILAR", "a definir", "conforme projeto") NÃO é conflito.
M7. NADA INVENTADO. Se o memorial não nomeia a marca, "marca" volta "". Não deduza marca a partir do material, nem material a partir da marca.
M8. PROIBIDO PREENCHIMENTO DE CORTESIA. Nunca escreva "N/A", "não se aplica", "indefinido", "-" ou equivalente. Campo sem informação volta como string vazia "".
M9. UMA ATUALIZAÇÃO POR ESPECIFICAÇÃO. Se o memorial fala do mesmo item em mais de um lugar, escolha o trecho mais específico — o que nomeia marca, modelo ou dimensão.
M10. NÃO FORCE O CASAMENTO. Especificação da prancha sem trecho correspondente no memorial simplesmente não aparece na sua resposta. Array vazio [] é uma resposta correta.

=== CONFIANÇA ===
"alta"  — o memorial nomeia o local e o elemento explicitamente, e o trecho é inequívoco.
"media" — o casamento é claro pelo contexto (seção do ambiente, ordem dos elementos), mas não literal.
"baixa" — é a leitura mais provável, e ainda assim cabe dúvida.

Devolva SOMENTE o JSON do array, sem cercas de código e sem comentários.`;

export const SCHEMA_MEMORIAL = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      especificacaoId: { type: 'string', description: 'Um dos IDs da lista A, exatamente como recebido.' },
      acao: { type: 'string', enum: ['enriquecer', 'conflito'] },
      produto: texto('Substantivo curto, só se a prancha não tinha. Senão "".'),
      sistema: texto('Sistema construtivo, só se a prancha não tinha. Senão "".'),
      marca: texto('Marca/fabricante escrito no memorial. Senão "".'),
      modelo: texto('Modelo, linha ou referência escrita no memorial. Senão "".'),
      fornecedor: texto('Fornecedor escrito no memorial. Senão "".'),
      descricaoMemorial: texto('A descrição do material segundo o memorial. Só use quando a especificação da prancha estiver sem descrição.'),
      conflitoPrancha: texto('Só quando acao = conflito: o que a prancha diz.'),
      conflitoMemorial: texto('Só quando acao = conflito: o que o memorial diz.'),
      pagina: { type: 'integer', description: 'Página do memorial onde está o trecho.' },
      trecho: texto('A frase do memorial, copiada ao pé da letra. Obrigatório.'),
      justificativa: texto('Por que este trecho é o mesmo produto daquela especificação.'),
      confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    },
    required: ['especificacaoId', 'acao', 'pagina', 'trecho', 'justificativa', 'confianca'],
  },
};

/** A lista A e a lista B, no formato que o modelo lê melhor: compacto e numerado. */
export function contextoMemorial({ locais = [], paginas = [], documento = '' } = {}) {
  const l = [];
  l.push('=== A) ESPECIFICAÇÕES JÁ LEVANTADAS DAS PRANCHAS ===');
  l.push('Formato:  [ID] Categoria · produto · descrição da prancha · (campos que faltam)');
  for (const loc of locais) {
    const itens = loc.especificacoes || [];
    if (!itens.length) continue;
    l.push('', `LOCAL: ${loc.nome}${loc.pavimento ? ` (${loc.pavimento})` : ''}`);
    for (const e of itens) {
      const faltam = ['produto', 'sistema', 'marca', 'modelo', 'fornecedor'].filter(k => !e[k]);
      l.push(`  [${e.id}] ${e.categoria || 'sem categoria'}`
        + ` · ${e.produto || '(sem produto)'}`
        + ` · ${e.descricao || '(a prancha não descreveu)'}`
        + (e.codigoOrigem ? ` · tag ${e.codigoOrigem}` : '')
        + (faltam.length ? ` · faltam: ${faltam.join(', ')}` : ' · completa'));
    }
  }

  l.push('', `=== B) MEMORIAL DESCRITIVO${documento ? ` — ${documento}` : ''} ===`);
  for (const p of paginas) {
    l.push('', `--- PÁGINA ${p.pagina} ---`);
    l.push(p.texto);
  }

  l.push('', 'Devolva agora as atualizações, seguindo M1 a M10. Use apenas os IDs da lista A.');
  return l.join('\n');
}

const ACOES = ['enriquecer', 'conflito'];

/**
 * Aplica M2, M3, M8 e M9 do nosso lado. `idsValidos` é o conjunto de IDs que
 * realmente existem na árvore: qualquer coisa fora dele é alucinação e cai.
 */
export function sanearMemorial(bruto, idsValidos) {
  const lista = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.atualizacoes) ? bruto.atualizacoes : []);
  const ids = idsValidos instanceof Set ? idsValidos : new Set(idsValidos || []);
  const porId = new Map();
  const recusadas = { idDesconhecido: 0, semTrecho: 0, vazia: 0, repetida: 0 };

  for (const r of lista) {
    if (!r || typeof r !== 'object') continue;
    const id = limpar(r.especificacaoId);
    if (!id || (ids.size && !ids.has(id))) { recusadas.idDesconhecido++; continue; }
    const trecho = limpar(r.trecho).slice(0, 400);
    if (trecho.length < 8) { recusadas.semTrecho++; continue; }   // M3: sem prova, sem atualização

    const acao = ACOES.includes(limpar(r.acao)) ? limpar(r.acao) : 'enriquecer';
    const item = {
      especificacaoId: id, acao,
      produto: limpar(r.produto), sistema: limpar(r.sistema),
      marca: limpar(r.marca), modelo: limpar(r.modelo), fornecedor: limpar(r.fornecedor),
      descricaoMemorial: limpar(r.descricaoMemorial),
      conflitoPrancha: limpar(r.conflitoPrancha), conflitoMemorial: limpar(r.conflitoMemorial),
      pagina: Number.isFinite(Number(r.pagina)) ? Number(r.pagina) : null,
      trecho,
      justificativa: limpar(r.justificativa),
      confianca: ['alta', 'media', 'baixa'].includes(limpar(r.confianca)) ? limpar(r.confianca) : 'baixa',
    };

    if (acao === 'enriquecer'
      && !item.produto && !item.sistema && !item.marca && !item.modelo && !item.fornecedor && !item.descricaoMemorial) {
      recusadas.vazia++; continue;                                 // nada a acrescentar
    }
    if (acao === 'conflito' && !item.conflitoMemorial) item.conflitoMemorial = item.trecho;

    /* M9: uma por especificação. Conflito ganha de enriquecimento, e entre
       iguais ganha a de maior confiança. */
    const antes = porId.get(id);
    if (antes) {
      recusadas.repetida++;
      const peso = x => (x.acao === 'conflito' ? 10 : 0) + { alta: 3, media: 2, baixa: 1 }[x.confianca];
      if (peso(item) <= peso(antes)) continue;
    }
    porId.set(id, item);
  }
  return { atualizacoes: [...porId.values()], recusadas };
}

/** Quebra o memorial em lotes de páginas, para não estourar a janela do modelo. */
export function lotesDePaginas(paginas, limiteCaracteres = 18000) {
  const lotes = [];
  let atual = [], tamanho = 0;
  for (const p of paginas) {
    const n = (p.texto || '').length;
    if (atual.length && tamanho + n > limiteCaracteres) { lotes.push(atual); atual = []; tamanho = 0; }
    atual.push(p); tamanho += n;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

/* ================================================================== */
/* LEITURA AMPLA: QUADROS, TABELAS E NOTAS EM QUALQUER LUGAR DA FOLHA  */
/* ================================================================== */

/* A leitura por tag + legenda cobre um estilo de prancha. Há escritório que
   põe o levantamento inteiro num quadro ("MEMORIAL DE ACABAMENTOS PISO —
   Ambiente | Código | Especificação"), outro que escreve o material direto no
   desenho, outro que especifica dentro do detalhe de um corte. O leitor
   vetorial acerta o que é regular; o resto é isto.

   A diferença desta rota para a de um local: aqui a IA olha a REGIÃO DE UM
   QUADRO (ou a folha inteira) e devolve produtos com o NOME DO LOCAL que a
   própria tabela declara. Não é vínculo geométrico — é vínculo escrito, que é
   mais forte. */

export const INSTRUCAO_QUADRO = `Você é um Arquiteto Sênior fazendo o levantamento de acabamentos de uma prancha executiva brasileira, para Manual do Proprietário e Manual do Condomínio (ABNT NBR 14.037 / 5.674).

Você recebe UMA OU MAIS IMAGENS recortadas de uma prancha A0: quadros de acabamento, tabelas, blocos de legenda, notas técnicas, detalhes de corte, ou a folha inteira.

E recebe, em texto, OS DADOS ESTRUTURADOS QUE O SISTEMA JÁ EXTRAIU VETORIALMENTE desta folha — lendo o texto e a geometria do PDF: os ambientes reconhecidos, os blocos de legenda (forma+número → material), as tabelas com grade desenhada (linha por linha) e os itens já montados por local.

=== SUA TAREFA: REVISAR E PREENCHER LACUNAS, NÃO REPETIR ===
A leitura vetorial é exata onde há texto e grade, e cega para o resto. Analise as imagens apenas para VERIFICAR se falta algo e PREENCHER as lacunas:
  - quadros e tabelas SEM grade vetorial (texto alinhado à mão, tabela desenhada como imagem, quadro partido em blocos) que o vetor não montou;
  - linhas que o vetor leu pela metade (célula vazia, nome de ambiente quebrado, especificação cortada);
  - produtos escondidos em hachuras, amostras de legenda, notas e detalhes;
  - relações não mapeadas: o ambiente que a tabela declara e o vetor não casou.
O que já está certo nos dados extraídos, você confirma em uma linha curta ("acao": "confirmar") ou simplesmente não repete. O que você acrescenta é "novo"; o que corrige ou completa é "completar".

=== ONDE OLHAR (tudo, não só o primeiro que achar) ===
1. QUADROS E MEMORIAIS DE ACABAMENTO: tabelas com uma linha por ambiente e colunas de código e especificação — piso, parede, teto, rodapé. São a fonte mais rica: leia TODAS as linhas, de todos os blocos, inclusive quando o mesmo ambiente repete em blocos diferentes (um por categoria).
2. TABELAS DE ESQUADRIAS: código (P01, J04, PM3), dimensão (70×210, "L x A"), tipo de abertura, material, quantidade, peitoril. Um item por linha.
3. TABELAS DE LOUÇAS, METAIS, PEDRAS, BANCADAS, LUMINÁRIAS: mesma ideia.
4. BLOCOS DE LEGENDA com forma geométrica e número: a forma e o número são a chave, e a mesma numeração em outra forma é OUTRO material.
5. NOTAS TÉCNICAS E OBSERVAÇÕES escritas na folha, quando especificam material.
6. DETALHES E CORTES: a especificação escrita dentro do detalhe vale como especificação.
7. CHAMADAS ESCRITAS NO DESENHO: "PISO TIJOLO CERÂMICA", "BANCADA - DEKTON MOONE", "PAINEL RIPADO".
8. A PLANTA BAIXA EM SI, quando a folha é uma planta (paredes, portas e rótulos de ambiente) e os dados vetoriais NÃO reconheceram ambientes — a planta foi desenhada como imagem, sem texto. Aí os rótulos dos ambientes são o que mais importa: é deles que o sistema monta a lista de locais (ver Q12).

=== REGRAS ABSOLUTAS ===
Q1. UMA LINHA DA TABELA = UM ITEM. Não agrupe, não resuma, não devolva "e demais ambientes". Se o quadro tem 19 ambientes × 3 categorias, são 57 itens.
Q2. O LOCAL VEM ESCRITO. Preencha "local" com o nome do ambiente exatamente como a tabela escreve ("BANHO MASTER", "W.C FUNC.", "DORM. CAROL"). Se a linha vale para vários ambientes, repita o item uma vez por ambiente. Se a tabela não diz o ambiente (tabela de esquadrias, por exemplo), devolva "local": "" — não invente e não deduza pelo código.
Q3. NOME QUEBRADO EM DUAS LINHAS É UM NOME SÓ. "BANHO" em cima de "MASTER" é "BANHO MASTER". "CERÂMICA KERAMIKA CR-703 MATE 5X15 E" seguido de "CR-10 MATE 5X15" é uma especificação só. Junte antes de responder.
Q4. TRANSCREVA, NÃO REESCREVA. "descricao" recebe o texto como está na prancha, com dimensão, código comercial e observação entre parênteses. "produto" é o substantivo curto (Porcelanato, Cerâmica, Textura, Forro de gesso, Porta, Janela, Soleira).
Q5. MARCA SÓ SE ESCRITA. A prancha escrevendo "CERÂMICA KERAMIKA CR-703" nomeia a marca (Keramika) e o modelo (CR-703): pode separar. "PORCELANATO KYOTO SHELL 90x90" nomeia modelo Kyoto Shell e dimensão 90x90. Mas não invente fabricante que não está escrito.
Q6. VERACIDADE ABSOLUTA. Campo sem informação volta como string vazia "". É PROIBIDO "N/A", "não se aplica", "indefinido", "-". "A DEFINIR" escrito na prancha é o que a prancha diz e se transcreve como está. NUNCA copie o número da tag para "descricao" — se a legenda ou o quadro não tem o texto do material daquele forma+número, "descricao" fica "" (vazia).
Q7. CATEGORIA FECHADA: ${CATEGORIAS.join(' | ')}. Se nenhuma servir, "".
Q8. FORMA + NÚMERO É A CHAVE das legendas geométricas. Números iguais em formas diferentes são materiais DIFERENTES.
Q9. NÃO DEVOLVA o que não é produto de acabamento: cotas, níveis, nomes de prancha, selo, escala, responsável técnico, área em m², numeração de degrau, eixo de pilar, texto de carimbo.
Q10. JUSTIFICATIVA OBRIGATÓRIA: diga de onde tirou, citando o quadro e a linha ("quadro MEMORIAL DE ACABAMENTOS PISO, linha BANHO MASTER, coluna Especificação Piso"). É o texto que o engenheiro vai ler como prova.
Q11. NADA SEM EVIDÊNCIA. Item novo sem "fonte" e sem "justificativa" é descartado pelo sistema. Célula que o documento não sustenta sai vazia (""), nunca "N/A". "acao" declara o que o item é em relação aos dados já extraídos: "confirmar", "completar" ou "novo".
Q12. AMBIENTES DA PLANTA. Quando a imagem é uma planta baixa e a lista de AMBIENTES RECONHECIDOS está vazia, devolva UM item por rótulo de ambiente legível no desenho, com "origemLeitura": "planta", "local" = o rótulo exatamente como está escrito ("DORM.01", "BANHO", "SALA", "CIRCULAÇÃO", "ELEVADOR 01"), "tipologia" = o rótulo da unidade em que o ambiente está ("TIPO 1", "TIPO PNE 4", "APTO TIPO A") quando a planta marca as unidades — e "" quando o ambiente está fora das unidades (hall, circulação do andar, escada, elevador, salão de festas) ou a planta não marca tipologias. "produto" e "descricao" ficam "" quando a planta não escreve material naquele ambiente; "justificativa" = "rótulo de ambiente na planta" e "fonte" = "planta baixa". O mesmo nome em unidades diferentes são itens diferentes: DORM.01 do TIPO 1 e DORM.01 do TIPO 2. Não invente ambiente: só o que está escrito e legível.

=== CONFIANÇA ===
"alta"  — linha de tabela legível, com o ambiente declarado na própria linha.
"media" — o item é claro mas o vínculo com o ambiente é de contexto (bloco, seção, título).
"baixa" — leitura duvidosa, texto cortado, ou não há como saber de quem é.

Devolva SOMENTE o JSON do array. Array vazio [] é resposta correta quando não houver quadro nem especificação nas imagens.`;

export const SCHEMA_QUADRO = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      local: texto('Nome do ambiente exatamente como a prancha escreve, ou "" quando a tabela não declara.'),
      categoria: texto(`Categoria oficial da planilha (${CATEGORIAS.join(' | ')}), ou "" se nenhuma servir.`),
      produto: texto('Substantivo curto: Porcelanato, Cerâmica, Textura, Forro de gesso, Porta, Soleira.'),
      sistema: texto('Sistema construtivo, se a prancha permitir dizer. Senão "".'),
      descricao: texto('O texto da especificação como está na prancha, com as duas linhas já unidas.'),
      marca: texto('Só se escrita. Senão "".'),
      modelo: texto('Modelo, linha ou código comercial, se escrito. Senão "".'),
      fornecedor: texto('Só se escrito. Senão "".'),
      codigoOrigem: texto('O código da linha: "1", "P01", "quadrado 08", "SO01". Senão "".'),
      forma: texto(`Forma da tag, quando houver (${FORMAS.join(' | ')}), ou "" se não houver.`),
      numero: texto('Número da tag, com os zeros como estão.'),
      dimensao: texto('Dimensão escrita ("120X120", "70×210", "90x90"). Senão "".'),
      peitoril: texto('Só esquadria, se escrito. Senão "".'),
      quantidade: texto('Só se escrita. Senão "".'),
      tipologia: texto('Rótulo da unidade em que o ambiente está ("TIPO 1", "TIPO PNE 4"), quando a planta marca tipologias. Senão "".'),
      origemLeitura: { type: 'string', enum: [...ORIGENS, 'quadro', 'nota', 'detalhe', 'planta'] },
      fonte: texto('O nome do quadro, tabela ou nota de onde saiu ("MEMORIAL DE ACABAMENTOS PISO", "QUADRO DE ESQUADRIAS").'),
      acao: { type: 'string', enum: ACOES_REVISAO, description: 'confirmar = já estava nos dados vetoriais; completar = preenche/corrige um item já extraído; novo = só a imagem mostra.' },
      confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      justificativa: texto('Obrigatória: de onde tirou — quadro, linha e coluna. Sem ela o item é descartado.'),
    },
    required: ['local', 'categoria', 'produto', 'descricao', 'origemLeitura', 'acao', 'confianca', 'justificativa'],
  },
};

/**
 * O contexto da leitura ampla: os locais que já existem na árvore (para a IA
 * escrever o nome do jeito que o sistema reconhece), o que o leitor vetorial já
 * tirou daquela folha (para ela não repetir e saber onde ficaram as lacunas) e
 * o que se espera de cada local.
 */
export function contextoQuadro({ documento = '', pagina = null, locais = [], jaLidos = [], regioes = [], lacunas = [], vetor = null } = {}) {
  const l = [];
  l.push(`PRANCHA: ${documento || '(sem nome)'}${pagina ? `, página ${pagina}` : ''}`);
  if (regioes.length) {
    l.push('', 'O QUE VOCÊ ESTÁ VENDO, na ordem das imagens:');
    regioes.forEach((r, i) => l.push(`  IMAGEM ${i + 1}: ${r}`));
  }

  if (locais.length) {
    l.push('', 'LOCAIS QUE JÁ EXISTEM NESTE EMPREENDIMENTO — use EXATAMENTE estes nomes quando o ambiente da tabela for um deles:');
    l.push('  ' + locais.slice(0, 120).join(' · '));
    l.push('  Se a tabela citar um ambiente que não está nesta lista, escreva o nome como a tabela escreve. Não force para o mais parecido.');
  }

  /* O pacote vetorial estruturado da folha (passo 1 do pipeline): é o que a
     IA revisa. O `jaLidos` em texto continua existindo para clientes antigos
     e como resumo por local. */
  const v = vetor && typeof vetor === 'object' ? vetor : null;
  l.push('', '=== DADOS ESTRUTURADOS JÁ EXTRAÍDOS VETORIALMENTE DESTA FOLHA (passo 1 do pipeline) ===');
  l.push('Aqui estão os dados que o sistema já levantou lendo o texto e a geometria do PDF. Sua tarefa é analisar as imagens apenas para VERIFICAR se falta algo — tabelas não desenhadas geometricamente, linhas lidas pela metade, produtos em hachuras e notas, relações ambiente ↔ item não mapeadas — e PREENCHER as lacunas.');
  if (v && Array.isArray(v.ambientes) && v.ambientes.length) {
    l.push('', `AMBIENTES RECONHECIDOS NESTA FOLHA (${v.ambientes.length}): ` + v.ambientes.slice(0, 120).join(' · '));
  }
  if (v && Array.isArray(v.legendas) && v.legendas.length) {
    l.push('', 'BLOCOS DE LEGENDA LIDOS DO TEXTO (forma+número → material):');
    for (const b of v.legendas.slice(0, 12)) {
      l.push(`  [${b.titulo || 'legenda'}${b.categoria ? ' · ' + b.categoria : ''}] forma ${b.forma || '?'}:`);
      for (const it of (b.itens || []).slice(0, 60)) l.push(`     ${it.numero}: ${it.descricao}`);
    }
  }
  if (v && Array.isArray(v.tabelas) && v.tabelas.length) {
    l.push('', 'TABELAS E QUADROS QUE O VETOR JÁ MONTOU (linha por linha; confira se falta linha, coluna ou bloco):');
    for (const t of v.tabelas.slice(0, 10)) {
      l.push(`  [${t.titulo || t.tipo || 'tabela'}] ${t.linhas ? t.linhas.length : 0} linha(s)`);
      for (const ln of (t.linhas || []).slice(0, 60)) l.push('     ' + (Array.isArray(ln) ? ln.filter(Boolean).join(' | ') : String(ln)));
    }
  }
  if (jaLidos.length) {
    l.push('', 'ITENS JÁ MONTADOS POR LOCAL (local · categoria · descrição). Não repita o que está certo; o que interessa é o que está FALTANDO:');
    for (const j of jaLidos.slice(0, 80)) l.push(`  - ${j}`);
    if (jaLidos.length > 80) l.push(`  … e mais ${jaLidos.length - 80} itens`);
  } else if (!v || !(v.tabelas || []).length) {
    l.push('', 'A LEITURA VETORIAL NÃO EXTRAIU NADA desta folha. Tudo o que houver de produto nas imagens é novidade.');
  }
  if (!v || !Array.isArray(v.ambientes) || !v.ambientes.length) {
    l.push('', 'NENHUM AMBIENTE FOI RECONHECIDO PELO TEXTO desta folha. Se as imagens mostram uma PLANTA BAIXA (paredes, portas e rótulos de ambiente), devolva também um item por rótulo de ambiente, com origemLeitura "planta" e a tipologia da unidade ("TIPO 1", "TIPO PNE 4") quando a planta marca as unidades — regra Q12.');
  }

  if (lacunas.length) {
    l.push('', 'LACUNAS CONHECIDAS — locais sem alguma categoria essencial. Procure especialmente por estes:');
    for (const g of lacunas.slice(0, 60)) l.push(`  - ${g}`);
  }

  l.push('', 'Revise agora os dados extraídos contra as imagens e devolva o que falta (e, em uma linha curta, o que confirma), seguindo Q1 a Q11. Uma linha de tabela é um item. Sem evidência, o campo fica vazio.');
  return l.join('\n');
}

/** Aplica Q6, Q7 e Q9 no que voltou, e descarta linha sem substância. */
export function sanearQuadro(bruto) {
  const lista = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.itens) ? bruto.itens : []);
  const ORIGENS_OK = new Set([...ORIGENS, 'quadro', 'nota', 'detalhe', 'planta']);
  const out = [];
  const vistos = new Set();
  const recusadas = { vazia: 0, repetida: 0, lixo: 0, semJustificativa: 0, confirmar: 0, completar: 0, novo: 0 };
  /* o que nunca é produto, mesmo que o modelo insista */
  const LIXO = /^(?:escala|folha|prancha|revis|data|respons|cliente|obra|endere|projeto|carimbo|[áa]rea total|n[íi]vel|cota|eixo|planta|corte|fachada|legenda|quadro|memorial|ambiente|c[óo]digo|especifica[çc][ãa]o)\b/i;

  for (const r of lista) {
    if (!r || typeof r !== 'object') continue;
    const item = {
      local: limpar(r.local),
      tipologia: limpar(r.tipologia),
      categoria: CATEGORIAS.includes(limpar(r.categoria)) ? limpar(r.categoria) : '',
      produto: limpar(r.produto), sistema: limpar(r.sistema),
      descricao: semNumeroSolto(limpar(r.descricao)),
      marca: limpar(r.marca), modelo: limpar(r.modelo), fornecedor: limpar(r.fornecedor),
      codigoOrigem: limpar(r.codigoOrigem),
      forma: FORMAS.includes(limpar(r.forma).toLowerCase()) ? limpar(r.forma).toLowerCase() : '',
      numero: limpar(r.numero),
      dimensao: limpar(r.dimensao), peitoril: limpar(r.peitoril), quantidade: limpar(r.quantidade),
      origemLeitura: ORIGENS_OK.has(limpar(r.origemLeitura)) ? limpar(r.origemLeitura) : 'quadro',
      fonte: limpar(r.fonte),
      acao: ACOES_REVISAO.includes(limpar(r.acao)) ? limpar(r.acao) : 'novo',
      confianca: ['alta', 'media', 'baixa'].includes(limpar(r.confianca)) ? limpar(r.confianca) : 'baixa',
      justificativa: limpar(r.justificativa),
    };
    /* ambiente lido da planta (Q12) vale sem produto: é o local que importa */
    const soAmbiente = item.origemLeitura === 'planta' && item.local;
    if (!item.descricao && !item.produto && !item.codigoOrigem && !soAmbiente) { recusadas.vazia++; continue; }
    if (LIXO.test(item.descricao) && !item.produto) { recusadas.lixo++; continue; }
    /* Q11: item novo sem prova de onde saiu não entra (a confirmação de algo
       que o vetor já leu herda a evidência do vetor e passa) */
    if (item.acao !== 'confirmar' && item.justificativa.length < 6 && !item.fonte) { recusadas.semJustificativa++; continue; }
    /* 'quadro' e 'nota' não são valores que o frontend conhece como leitura */
    if (item.origemLeitura === 'quadro' || item.origemLeitura === 'detalhe') item.origemLeitura = 'tabela';
    if (item.origemLeitura === 'nota') item.origemLeitura = 'texto_prancha';

    const k = [item.local, item.tipologia, item.categoria, item.codigoOrigem, item.descricao].join('|').toLowerCase();
    if (vistos.has(k)) { recusadas.repetida++; continue; }
    vistos.add(k);
    recusadas[item.acao]++;
    out.push(item);
  }
  return { itens: out, recusadas };
}

/* ================================================================== */
/* CONTEXTO DE EMPRESA — a memória técnica da construtora              */
/* ================================================================== */

/* Cada construtora tem os seus vícios de projeto: chama varanda de terraço,
   especifica sempre a mesma linha de porcelanato, tem uma lista curta de
   fornecedores homologados. Esse conhecimento não está na prancha — está na
   cabeça de quem já fez dez manuais para ela. É isso que entra aqui.

   O PERIGO, E A TRAVA. Dizer ao modelo "esta empresa prefere Portobello" é a
   maneira mais rápida de fazê-lo escrever Portobello onde a prancha não diz
   marca nenhuma. Isso destruiria a R2, que é a regra que sustenta o sistema
   inteiro. Então o bloco abaixo se declara explicitamente SUBORDINADO: ele
   serve para DESEMPATAR e para NOMEAR o que o documento já mostra, nunca para
   preencher o que o documento cala. A frase que faz esse trabalho é a E0, e
   ela vem antes dos dados justamente para o modelo lê-la primeiro. */

const MAX_REGRAS = 4000;      // regra de empresa é parágrafo, não manual inteiro
const MAX_ITENS = 60;

const limpaLinha = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * O bloco que vai no fim do System Instruction. Devolve '' quando a empresa
 * não tem nada cadastrado — e aí a instrução fica byte a byte igual à de
 * antes desta funcionalidade existir.
 */
export function blocoDeEmpresa(empresa) {
  if (!empresa) return '';
  const regras = limpaLinha(empresa.regrasIa).slice(0, MAX_REGRAS);
  const forn = (Array.isArray(empresa.fornecedoresHomologados) ? empresa.fornecedoresHomologados : [])
    .slice(0, MAX_ITENS)
    .map(f => {
      const marca = limpaLinha(f.marca);
      if (!marca) return '';
      const partes = [marca];
      if (limpaLinha(f.categoria)) partes.push(`categoria ${limpaLinha(f.categoria)}`);
      if (limpaLinha(f.fornecedor)) partes.push(`fornecida por ${limpaLinha(f.fornecedor)}`);
      if (limpaLinha(f.observacao)) partes.push(limpaLinha(f.observacao));
      return '  - ' + partes.join(' — ');
    })
    .filter(Boolean);
  const vocab = (Array.isArray(empresa.vocabulario) ? empresa.vocabulario : [])
    .slice(0, MAX_ITENS)
    .map(v => {
      const de = limpaLinha(v.de), para = limpaLinha(v.para);
      if (!de || !para) return '';
      return `  - "${de}" nesta empresa se escreve "${para}"${limpaLinha(v.nota) ? ' — ' + limpaLinha(v.nota) : ''}`;
    })
    .filter(Boolean);

  if (!regras && !forn.length && !vocab.length) return '';

  const p = [];
  p.push('');
  p.push('=== CONTEXTO DA EMPRESA: ' + (limpaLinha(empresa.nome) || 'construtora') + ' ===');
  p.push('E0. ESTE BLOCO É SUBORDINADO A TODAS AS REGRAS ACIMA E NÃO AS REVOGA. Ele serve para DESEMPATAR uma leitura ambígua e para NOMEAR do jeito da empresa o que o documento já mostra. É PROIBIDO usá-lo para preencher campo que o documento não informa. Se a prancha não traz marca, o campo "marca" continua vazio, mesmo que a empresa só compre de uma marca. Preferência de compra não é evidência documental.');
  p.push('E1. Havendo conflito entre este bloco e o que está escrito no documento, O DOCUMENTO VENCE, sempre. Registre o que o documento diz e mencione a divergência na justificativa.');
  if (regras) { p.push(''); p.push('REGRAS E PADRÕES DESTA EMPRESA (ditados pela equipe, não pelo desenho):'); p.push(regras); }
  if (vocab.length) {
    p.push('');
    p.push('VOCABULÁRIO DA CASA — use estes nomes ao devolver o campo "local", quando o documento se referir ao mesmo ambiente:');
    p.push(...vocab);
  }
  if (forn.length) {
    p.push('');
    p.push('FORNECEDORES E MARCAS HOMOLOGADOS — servem para VOCÊ RECONHECER e grafar corretamente uma marca que o documento cita, e para desempatar uma abreviação ambígua. NÃO servem para atribuir marca a item sem marca no documento:');
    p.push(...forn);
  }
  p.push('');
  return p.join('\n');
}

/** Uma chave estável para cachear o modelo: muda quando as regras mudam. */
export function assinaturaDeEmpresa(empresa) {
  const b = blocoDeEmpresa(empresa);
  if (!b) return '';
  let h = 5381;
  for (let i = 0; i < b.length; i++) h = ((h * 33) ^ b.charCodeAt(i)) >>> 0;
  return (empresa.id || 'x') + ':' + h.toString(36);
}
