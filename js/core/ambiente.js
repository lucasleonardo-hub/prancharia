/* O que é um ambiente e o que ele precisa ter.

   Todo ambiente FECHADO tem piso, paredes e teto, mesmo quando nenhuma
   prancha ou memorial fala deles: o teto de um apartamento tem forro ou
   pintura, o piso tem alguma coisa, a parede também. A planilha do manual
   precisa dessas linhas — vazias, com o motivo à vista — para a equipe
   preencher, e não de um local que parece completo porque só a porta foi
   lida. E onde há porcelanato ou cerâmica, no piso ou na parede, há rejunte:
   se o documento não o especifica, a linha existe do mesmo jeito, vazia.

   Nada aqui inventa dado. A linha obrigatória nasce com descrição vazia,
   origem `obrigatoria`, confiança baixa e o motivo escrito; some sozinha
   quando um documento traz o item de verdade (`completarObrigatorias` poda
   antes de criar). É a regra do produto: uma célula vazia com motivo vale
   mais que uma célula preenchida sem fonte. */

import { normalizar, criarEspecificacao, criarEvidencia } from './model.js';

/* Ambientes ABERTOS: têm piso, mas não parede nem teto que se especifique. */
export const VOCAB_ABERTO = [
  'piscina', 'prainha', 'deck', 'solarium', 'solario', 'quadra', 'praca', 'patio', 'playground',
  'calcada', 'passeio', 'acesso', 'rua', 'estacionamento descoberto', 'vagas? descobertas?',
  'area externa', 'areas externas', 'terraco descoberto', 'laje descoberta', 'laje tecnica',
  'pergolado', 'gazebo', 'quiosque', 'redario',
];
/* Não são ambientes com acabamento de superfície: nada é obrigatório. */
export const VOCAB_SEM_SUPERFICIE = [
  'jardim', 'horta', 'pomar', 'paisagismo', 'vegetacao', 'telhado', 'talude', 'terreno', 'muro', 'gradil',
  'portao', 'fachada', 'cobertura', 'poco', 'shaft', 'prumada', 'duto', 'fosso',
];

const daLista = lista => new RegExp('(?:^|\\b)(?:' + lista.join('|') + ')(?:\\b|$)', 'i');
const ABERTO = daLista(VOCAB_ABERTO);
const SEM_SUPERFICIE = daLista(VOCAB_SEM_SUPERFICIE);

/** 'fechado' | 'aberto' | 'sem_superficie' — o que o nome do ambiente diz. */
export function tipoDeAmbiente(nome) {
  const n = normalizar(nome).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return 'fechado';
  if (SEM_SUPERFICIE.test(n)) return 'sem_superficie';
  if (ABERTO.test(n)) return 'aberto';
  return 'fechado';
}

/** As categorias que este ambiente tem por natureza. */
export function categoriasObrigatorias(nome) {
  const t = tipoDeAmbiente(nome);
  if (t === 'sem_superficie') return [];
  if (t === 'aberto') return ['Piso'];
  return ['Piso', 'Paredes', 'Teto'];
}

/* Revestimento assentado com junta: pede rejunte. Pedra natural e madeira
   também levam junta, mas o manual as trata no próprio item — a regra fica
   no cerâmico, que é onde o rejunte é produto à parte na planilha. */
const COM_REJUNTE = /porcelanato|ceramic|azulejo|pastilha|ladrilho|mosaico|porcelanico|gres|grês/;
const REJUNTE = /\brejunt/;

/* ------------------------------------------------------------------ */
/* ITENS OBRIGATÓRIOS POR TIPO DE AMBIENTE — o julgamento de engenheiro    */
/* ------------------------------------------------------------------ */

/* A planilha do manual espera, além de piso, paredes e teto, os itens que
   todo ambiente daquele tipo tem: bacia e cuba no banho, pia e bancada na
   cozinha, tanque na área de serviço, porta em todo cômodo fechado, rodapé
   nos cômodos secos. Só entra aqui o que existe com CERTEZA no tipo de
   ambiente; o incerto (rodapé em banho azulejado até o teto, soleira,
   janela, equipamentos) não vira linha — é decisão da equipe, não da regra.
   Cada item: [categoria da planilha, nome do produto, como reconhecer que já
   foi lido]. */
const ITENS_MOLHADOS = {
  banho: [
    ['Louças', 'Bacia sanitária', /bacia|vaso sanit/],
    ['Louças', 'Cuba', /\bcuba|lavatorio/],
    ['Metais', 'Torneira', /torneira|misturador|monocomando/],
    ['Metais', 'Registro', /registro/],
    ['Metais', 'Sifão', /sifao/],
    ['Bancadas', 'Bancada', /bancada|tampo/],
  ],
  cozinha: [
    ['Metais', 'Pia', /\bpia\b|cuba (de )?inox|cuba de aco/],
    ['Metais', 'Torneira', /torneira|misturador|monocomando/],
    ['Metais', 'Sifão', /sifao/],
    ['Bancadas', 'Bancada', /bancada|tampo/],
  ],
  servico: [
    ['Metais', 'Tanque', /tanque/],
    ['Metais', 'Torneira', /torneira/],
  ],
};
const RE_BANHO = /\b(banh|wc|lavabo|sanitari|toalete|bwc)/;
const RE_COZINHA = /\bcozinha/;
const RE_SERVICO = /area de servico|\ba\.?\s?s\b|lavanderia/;
/* cômodos que não têm porta própria: são a própria circulação */
const RE_SEM_PORTA = /circulac|corredor|\bhall\b|escada|rampa|elevador|antecamara|foyer|lobby|varanda|sacada|terraco|garagem|estacionamento|vaga/;
const RE_SECO_SEM_RODAPE = /varanda|sacada|terraco|garagem|estacionamento|vaga/;

/** Os itens que este ambiente tem por natureza, além de piso, paredes e teto. */
export function itensEsperados(nome) {
  const t = tipoDeAmbiente(nome);
  if (t !== 'fechado') return [];
  const n = normalizar(nome).replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();
  const itens = [];
  const molhado = RE_BANHO.test(n) ? 'banho' : RE_COZINHA.test(n) ? 'cozinha' : RE_SERVICO.test(n) ? 'servico' : '';
  if (molhado) itens.push(...ITENS_MOLHADOS[molhado]);
  else if (!RE_SECO_SEM_RODAPE.test(n)) itens.push(['Piso', 'Rodapé', /rodape/]);
  if (!RE_SEM_PORTA.test(n)) itens.push(['Esquadrias', 'Porta', /\bporta|\bpm\s?\d|\bpi\s?\d|\bpa\s?\d|\bp\s?\d{1,2}\b/]);
  return itens.map(([categoria, produto, re]) => ({ categoria, produto, re }));
}

/* ------------------------------------------------------------------ */
/* A MARCA: nem todo produto tem uma                                     */
/* ------------------------------------------------------------------ */

/* Produto sem marca própria mas com fornecedor (gesso, esquadria, pedra,
   vidro, serralheria): a coluna Marca da planilha recebe "Fornecedor do
   forro de gesso", e essa "marca" existe na aba Forn. com os dados do
   fornecedor real. Produto sem marca e sem fornecedor por natureza
   (contrapiso, reboco): fica em branco, sem amarelo — não é informação
   faltante, é inexistente. O resto tem marca, e sem ela a célula é dúvida. */
const SEM_MARCA = /contrapiso|reboco|chapisco|emboco|regularizac|enchimento|laje\b|alvenaria|concreto|argamassa de assentamento|cimentado|piso de concreto/;
const POR_FORNECEDOR = [
  [/forro de gesso|gesso acartonado|drywall|forro/, 'do forro de gesso', 'o'],
  [/esquadria|\bporta|\bjanela|\bcaixilho|porta.?balcao|veneziana|maxim/, null, 'a'],
  [/marcenaria|armario|bancada de madeira|painel de madeira/, 'da marcenaria', 'a'],
  [/granito|marmore|pedra|bancada|soleira|peitoril|bitbox|pingadeira|rodabanca/, 'da marmoraria', 'a'],
  [/vidro|espelho|box\b/, 'da vidraçaria', 'a'],
  [/serralheria|guarda.?corpo|corrimao|gradil|portao|estrutura metalica|ferro/, 'da serralheria', 'a'],
];

export function naturezaDaMarca(esp) {
  const t = normalizar(`${esp.produto || ''} ${esp.descricao || ''} ${esp.categoria || ''}`);
  if (SEM_MARCA.test(t) && !/porcelanato|ceramic|tinta|textura/.test(t)) return 'nenhuma';
  if (POR_FORNECEDOR.some(([re]) => re.test(t)) && !/porcelanato|ceramic|tinta|textura|louca|metais/.test(normalizar(esp.categoria || '') + ' ' + t.replace(/esquadria de aluminio|esquadria de madeira/, ''))) return 'fornecedor';
  return 'marca';
}

/** "Fornecedor da esquadria de alumínio" — o texto que vai na coluna Marca. */
export function rotuloFornecedor(esp) {
  const t = normalizar(`${esp.produto || ''} ${esp.descricao || ''}`);
  for (const [re, rotulo] of POR_FORNECEDOR) {
    if (!re.test(t)) continue;
    if (rotulo) return 'Fornecedor ' + rotulo;
    /* esquadria: diz o material quando a descrição diz */
    const material = /aluminio/.test(t) ? ' de alumínio' : /madeira/.test(t) ? ' de madeira' : /pvc/.test(t) ? ' de PVC' : /aco|ferro/.test(t) ? ' de aço' : '';
    return 'Fornecedor da esquadria' + material;
  }
  const p = String(esp.produto || 'item').toLowerCase();
  return `Fornecedor de ${p}`;
}

export const ehRejunte = esp => REJUNTE.test(normalizar(`${esp.produto || ''} ${esp.descricao || ''}`));
export const pedeRejunte = esp => !ehRejunte(esp) && COM_REJUNTE.test(normalizar(`${esp.produto || ''} ${esp.descricao || ''} ${esp.sistema || ''}`));
export const ehObrigatoria = esp => esp && esp.origemLeitura === 'obrigatoria';

const vivo = a => a && a.status !== 'excluido';

function linhaObrigatoria(local, categoria, { produto = '', motivo, cadeia }) {
  const esp = criarEspecificacao({
    categoria, produto,
    origemLeitura: 'obrigatoria',
    confianca: 'baixa', status: 'revisar',
    motivos: [motivo],
    localId: local.id, localNome: local.nome,
    pavimento: local.pavimento || '', tipologia: local.tipologia || '',
  });
  /* a evidência é o próprio ambiente: a prancha (ou o memorial) que o criou,
     e a ausência do item em todos os documentos lidos */
  const ev0 = (local.evidencias || [])[0] || null;
  esp.evidencias.push(criarEvidencia({
    documentoOrigem: ev0 ? ev0.documentoOrigem : null,
    tipo: 'ambiente',
    coordenadas: ev0 ? ev0.coordenadas : null,
    regiao: ev0 ? ev0.regiao : null,
    localCoordenadas: local.poligonoOriginal || null,
    tituloLegenda: 'Linha obrigatória do ambiente',
    texto: local.nome,
    cadeia,
    proveniencia: { motor_ia: 'fallback_vetorial', metodo: 'ambiente_obrigatorio', confianca: 'baixa' },
  }));
  return esp;
}

/**
 * Poda as linhas obrigatórias que um documento já supriu e cria as que
 * faltam. Idempotente: rodar duas vezes seguidas não muda nada.
 *
 * @returns {{ criadas: number, removidas: number }}
 */
export function completarObrigatorias(emp) {
  let criadas = 0, removidas = 0;
  for (const local of (emp.locais || []).filter(vivo)) {
    local.especificacoes = local.especificacoes || [];
    const reais = local.especificacoes.filter(a => vivo(a) && !ehObrigatoria(a));
    const temReal = cat => reais.some(a => a.categoria === cat);
    const temRejunteReal = cat => reais.some(a => a.categoria === cat && ehRejunte(a));
    const precisaRejunte = cat => reais.some(a => a.categoria === cat && pedeRejunte(a)) && !temRejunteReal(cat);
    const obrigatorias = categoriasObrigatorias(local.nome);

    const esperados = itensEsperados(local.nome);
    const casa = (a, it) => a.categoria === it.categoria
      && (it.re.test(normalizar(`${a.produto || ''} ${a.descricao || ''} ${a.codigoOrigem || ''}`)) || normalizar(a.produto || '') === normalizar(it.produto));
    const temItemReal = it => reais.some(a => casa(a, it));

    /* 1) poda: o que já foi suprido, ou deixou de ser necessário */
    const antes = local.especificacoes.length;
    local.especificacoes = local.especificacoes.filter(a => {
      if (!ehObrigatoria(a)) return true;
      if (a.motivos.includes('rejunte_obrigatorio')) return precisaRejunte(a.categoria);
      if (a.motivos.includes('item_obrigatorio')) {
        const it = esperados.find(x => x.categoria === a.categoria && x.produto === a.produto);
        return !!it && !temItemReal(it);
      }
      return obrigatorias.includes(a.categoria) && !temReal(a.categoria);
    });
    removidas += antes - local.especificacoes.length;
    const pendentes = local.especificacoes.filter(a => vivo(a) && ehObrigatoria(a));

    /* 2) o que falta */
    const origem = (local.evidencias || [])[0];
    const deOnde = origem && origem.documentoOrigem
      ? `${origem.documentoOrigem.nomeDoc || 'documento'}${origem.documentoOrigem.pagina ? ' p.' + origem.documentoOrigem.pagina : ''}`
      : 'documentos lidos';
    for (const cat of obrigatorias) {
      if (temReal(cat) || pendentes.some(a => a.categoria === cat && !a.motivos.includes('rejunte_obrigatorio'))) continue;
      local.especificacoes.push(linhaObrigatoria(local, cat, {
        motivo: 'categoria_obrigatoria',
        cadeia: [local.nome, `ambiente ${tipoDeAmbiente(local.nome)} lido em ${deOnde}`,
          `${cat}: nenhuma tag, tabela ou trecho de memorial encontrado`, 'linha obrigatória do ambiente — preencher ou apontar a fonte'],
      }));
      criadas++;
    }
    for (const it of esperados) {
      if (temItemReal(it) || pendentes.some(a => a.motivos.includes('item_obrigatorio') && a.categoria === it.categoria && a.produto === it.produto)) continue;
      local.especificacoes.push(linhaObrigatoria(local, it.categoria, {
        produto: it.produto,
        motivo: 'item_obrigatorio',
        cadeia: [local.nome, `ambiente ${tipoDeAmbiente(local.nome)} lido em ${deOnde}`,
          `${it.produto} (${it.categoria}): esperado neste tipo de ambiente, nenhum documento o especifica`, 'linha obrigatória — preencher ou apontar a fonte'],
      }));
      criadas++;
    }
    for (const cat of ['Piso', 'Paredes']) {
      if (!precisaRejunte(cat) || pendentes.some(a => a.categoria === cat && a.motivos.includes('rejunte_obrigatorio'))) continue;
      const rev = reais.find(a => a.categoria === cat && pedeRejunte(a));
      local.especificacoes.push(linhaObrigatoria(local, cat, {
        produto: 'Rejunte',
        motivo: 'rejunte_obrigatorio',
        cadeia: [local.nome, `${cat}: ${rev.produto || rev.descricao || 'revestimento cerâmico'}`,
          'revestimento assentado com junta e nenhum rejunte especificado', 'linha obrigatória de rejunte — preencher ou apontar a fonte'],
      }));
      criadas++;
    }
  }
  return { criadas, removidas };
}
