/* js/core/model.js — Novo Modelo de Dados Focado no Local

   O Local é a raiz: tudo o que pertence a um espaço — piso, parede, teto,
   esquadria, louça, metal, pedra — mora dentro dele, cada item com as suas
   evidências e a proveniência de cada evidência.

   Duas regras atravessam o arquivo inteiro:
   - categoria é a string oficial da planilha, guardada como veio. Agrupar é
     trabalho da view, não do modelo.
   - nada de dado sem evidência, e nada de dado perdido na conversão: o que o
     formato antigo sabia, o novo continua sabendo. */

export { CATEGORIAS } from './vocab.js';

export const STATUS = {
  identificado: { rotulo: 'Identificado', tom: 'bom' },
  revisar: { rotulo: 'Revisar', tom: 'atencao' },
  confirmado: { rotulo: 'Confirmado', tom: 'bom' },
  corrigido: { rotulo: 'Corrigido', tom: 'bom' },
  conflito: { rotulo: 'Conflito', tom: 'critico' },
  excluido: { rotulo: 'Excluído', tom: 'apagado' },
};

export const CONFIANCA = {
  alta: { rotulo: 'Alta', tom: 'bom', ordem: 3 },
  media: { rotulo: 'Média', tom: 'atencao', ordem: 2 },
  baixa: { rotulo: 'Baixa', tom: 'critico', ordem: 1 },
};

export const MOTIVOS_PENDENCIA = {
  sem_sistema: 'Sistema construtivo não preenchido',
  tag_sem_ambiente: 'Tag localizada fora das paredes lidas',
  legenda_ausente: 'Símbolo não encontrado na legenda',
  baixa_confianca: 'Vínculo espacial incerto',
  ambiente_proposto: 'Ambiente presumido pela proximidade',
  conflito: 'Divergência entre documentos (Prancha vs Memorial)',
  incompleto: 'Informação incompleta',
  ilegivel: 'Documento ilegível',
  marca_proposta: 'Marca proposta',
  vinculo_por_proximidade: 'Local proposto pela proximidade',
  vinculo_por_familia: 'Local deduzido do plural da legenda',
  vinculo_geral: 'Legenda vale para todos os locais',
  lista_aberta: 'Lista de ambientes terminada em “etc”',
  termo_sem_ambiente: 'Termo da legenda sem local correspondente',
};

export function normalizar(texto) {
  if (!texto) return '';
  return String(texto).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

export function mesmoAmbiente(a, b) {
  return normalizar(a) === normalizar(b);
}

/* Timestamp + sequência + aleatório: o id é chave de merge, não pode colidir
   entre dois itens criados no mesmo milissegundo. */
let seq = 0;
export function novoId(prefixo = 'id') {
  return `${prefixo}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ================= ENTIDADES PRINCIPAIS ================= */

export function criarEmpreendimento(empresaId, nome, tipo) {
  return {
    id: novoId('emp'),
    empresaId: empresaId || null,
    nome: nome || 'Novo Projeto',
    tipo: tipo || 'outro',
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),

    // cadastro
    endereco: '', localizacao: '', responsavel: '', observacoes: '',
    dados: {},                       // respostas do formulário do tipo

    // estrutura hierárquica conforme o tipo (torre, tipologia, unidade, pavimento)
    estrutura: { grupo: [], tipologia: [], unidade: [], pavimento: [] },
    niveisExtras: [], niveisDesligados: [],

    documentos: [],                  // metadados dos PDFs e planilhas anexadas
    locais: [],                      // O Centro da Arquitetura
    especificacoesSemLocal: [],      // itens lidos que ainda não têm local
                                     // — insumo principal de Pendências

    // acervo de leitura e de revisão
    legendas: [], tabelas: [], marcas: [], fornecedores: [],
    auditorias: [], revisoes: {},
    historico: [],
  };
}

export function criarLocal(nome, area = '', pavimento = '', poligonoOriginal = null) {
  return {
    id: novoId('loc'),
    nome: nome,
    area: area,
    pavimento: pavimento,
    poligonoOriginal: poligonoOriginal, // Mantido para o fallback do pdf.js e BBox
    statusAuditoria: 'pendente',

    // posição na hierarquia do tipo de empreendimento
    tipologia: '', grupoId: null, tipologiaId: null, unidadeId: null, pavimentoId: null,
    areaComum: false,                // separa MC de MP na planilha

    confianca: 'alta',
    status: 'identificado',
    origem: '',

    // onde o rótulo do local foi lido — âncora do recorte de Nível 2
    evidencias: [],

    especificacoes: [],              // lista plana; agrupar é papel da view
  };
}

export function criarEspecificacao(dados = {}) {
  return {
    id: novoId('esp'),

    // identificação do item
    categoria: dados.categoria || '',        // string oficial da planilha, como veio
    produto: dados.produto || '',            // Nome do Produto/Serviço
    sistema: dados.sistema || '',            // Sistema Construtivo
    descricao: dados.descricao || '',        // Descrição/Modelo/Linha, texto original
    marca: dados.marca || '',
    modelo: dados.modelo || '',
    fornecedor: dados.fornecedor || '',

    // o que a prancha desenhou/escreveu
    codigoOrigem: dados.codigoOrigem || '',  // Ex: 'Quadrado 08', 'PM1', 'SO01'
    forma: dados.forma || '',
    numero: dados.numero || '',
    dimensao: dados.dimensao || '',
    peitoril: dados.peitoril || '',
    quantidade: dados.quantidade || '',

    // estado de leitura e de revisão
    status: dados.status || 'revisar',
    confianca: dados.confianca || 'media',
    motivos: dados.motivos ? [...dados.motivos] : [],
    divergencias: dados.divergencias ? [...dados.divergencias] : [],
    chave: dados.chave || '',                // índice de merge entre pranchas

    localId: dados.localId || null,          // vazio = está em especificacoesSemLocal
    localNome: dados.localNome || '',
    pavimento: dados.pavimento || '',
    tipologia: dados.tipologia || '',

    // como este item foi lido: tag, tabela, legenda_tabela, memorial, manual
    origemLeitura: dados.origemLeitura || 'tag',
    origemClasse: dados.origemClasse || '',  // regra de glossário que classificou
    detalhadoDe: dados.detalhadoDe || '',    // descrição genérica que outra fonte detalhou

    evidencias: [],
  };
}

export function criarEvidencia(dados = {}) {
  return {
    id: novoId('evd'),
    documentoOrigem: dados.documentoOrigem || null, // { docId, pagina, nomeDoc }
    tipo: dados.tipo || 'tag', // 'tag', 'hachura', 'texto_memorial', 'tabela', 'rotulo'
    coordenadas: dados.coordenadas || null,  // Bbox do ponto exato — Nível 3
    regiao: dados.regiao || null,            // Bbox do entorno — Nível 2
    legendaCoordenadas: dados.legendaCoordenadas || null,
    legendaBloco: dados.legendaBloco || null,
    legendaItens: dados.legendaItens || null,
    tituloLegenda: dados.tituloLegenda || '',
    texto: dados.texto || '',
    cadeia: dados.cadeia ? [...dados.cadeia] : [],
    // contexto espacial do vínculo, para a tela de evidências explicar a dúvida
    localCoordenadas: dados.localCoordenadas || null,
    segundoLocal: dados.segundoLocal || '',
    folga: dados.folga ?? null,
    termoLegenda: dados.termoLegenda || '',
    forcaVinculo: dados.forcaVinculo || '',
    areaLegenda: dados.areaLegenda || '',
    tabelaCoordenadas: dados.tabelaCoordenadas || null,
    proveniencia: dados.proveniencia || {
      motor_ia: 'legado_vetorial',
      metodo: 'extracao_local',
      confianca: 'alta',
    },
  };
}

/**
 * Aceita a forma nova (uma string) e a rica que a aplicação usa
 * ({ texto, tipo, antes, depois, alvo }). Guarda as duas leituras do mesmo
 * evento para que nenhuma tela precise adivinhar o formato.
 */
export function registrarHistorico(empreendimento, motivo) {
  if (!empreendimento) return;
  if (!empreendimento.historico) empreendimento.historico = [];
  const ev = typeof motivo === 'string' ? { texto: motivo } : (motivo || {});
  const quando = new Date().toISOString();
  empreendimento.historico.unshift({
    id: novoId('h'),
    quando, data: quando,
    texto: ev.texto || '', motivo: ev.texto || '',
    tipo: ev.tipo || 'evento',
    ...(ev.antes !== undefined ? { antes: ev.antes } : {}),
    ...(ev.depois !== undefined ? { depois: ev.depois } : {}),
    ...(ev.alvo !== undefined ? { alvo: ev.alvo } : {}),
  });
  // o histórico é a trilha de auditoria do projeto: 600 eventos, não 50
  if (empreendimento.historico.length > 600) empreendimento.historico.length = 600;
}

/* ================= CONVERSÃO DO FORMATO ANTIGO ================= */

const vivo = x => x && x.status !== 'excluido';

/** Código que a prancha desenhou ou escreveu, para o campo codigoOrigem. */
function codigoDe(achado) {
  if (achado.forma) return `${achado.forma} ${achado.numero || ''}`.trim();
  return (achado.codigo || '').trim();
}

const TIPO_EVIDENCIA = {
  memorial: 'texto_memorial',
  legenda_tabela: 'tabela',
  tabela: 'tabela',
  manual: 'manual',
};

/** Um achado antigo vira uma Especificação com tudo o que ele sabia. */
export function especificacaoDeAchado(achado, local = null) {
  const esp = criarEspecificacao({
    categoria: achado.categoria || '',
    produto: achado.nomeProduto || '',
    sistema: achado.sistema || '',
    descricao: achado.descricao || '',
    marca: achado.marca, modelo: achado.modelo, fornecedor: achado.fornecedor,
    codigoOrigem: codigoDe(achado),
    forma: achado.forma, numero: achado.numero,
    dimensao: achado.dimensao, peitoril: achado.peitoril, quantidade: achado.quantidade,
    status: achado.status, confianca: achado.confianca,
    motivos: achado.motivos, divergencias: achado.divergencias,
    chave: achado.chave,
    tipologia: achado.tipologia,
    origemLeitura: achado.tipo || 'tag',
    origemClasse: achado.origemClasse, detalhadoDe: achado.detalhadoDe,
    localId: local ? local.id : (achado.ambienteId || null),
    localNome: local ? local.nome : (achado.ambienteNome || ''),
    pavimento: achado.pavimento || (local ? local.pavimento : ''),
  });
  esp.id = achado.id || esp.id;
  // o produto sintetizado nunca substitui a descrição original
  if (!esp.produto && !esp.descricao) esp.descricao = achado.descricao || '';

  const fontes = achado.fontes && achado.fontes.length
    ? achado.fontes
    : (achado.evidencia ? [achado.evidencia] : []);
  for (const f of fontes) {
    esp.evidencias.push(criarEvidencia({
      documentoOrigem: { docId: f.documentoId, pagina: f.pagina, nomeDoc: f.documento },
      tipo: TIPO_EVIDENCIA[achado.tipo] || 'tag',
      coordenadas: f.tagCaixa || f.caixa || null,
      regiao: f.caixa || f.tabelaCaixa || null,
      legendaCoordenadas: f.legendaCaixa || null,
      legendaBloco: f.legendaBlocoCaixa || null,
      legendaItens: f.legendaItens || null,
      tituloLegenda: f.tituloLegenda || '',
      texto: f.texto || '',
      cadeia: f.cadeia || [],
      localCoordenadas: f.ambienteCaixa || null,
      segundoLocal: f.segundoAmbiente || '',
      folga: f.folga ?? null,
      termoLegenda: f.termoLegenda || '',
      forcaVinculo: f.forcaVinculo || '',
      areaLegenda: f.areaLegenda || '',
      tabelaCoordenadas: f.tabelaCaixa || null,
      proveniencia: {
        motor_ia: 'legado_vetorial',
        metodo: 'extracao_local',
        confianca: achado.confianca || 'media',
      },
    }));
  }
  return esp;
}

/** Um ambiente antigo vira um Local, com a evidência do próprio rótulo. */
export function localDeAmbiente(amb) {
  const l = criarLocal(amb.nome, amb.area, amb.pavimento,
    amb.poligonoOriginal || amb.bboxTexto || amb.bbox || (amb.evidencias || [])[0]?.caixa || null);
  l.id = amb.id || l.id;
  l.status = amb.status || 'identificado';
  l.statusAuditoria = amb.status === 'confirmado' || amb.status === 'corrigido' ? 'confirmado'
    : amb.status === 'excluido' ? 'excluido' : 'pendente';
  l.confianca = amb.confianca || 'alta';
  l.origem = amb.origem || '';
  l.areaComum = !!amb.areaComum;
  l.tipologia = amb.tipologia || '';
  l.grupoId = amb.grupoId || null;
  l.tipologiaId = amb.tipologiaId || null;
  l.unidadeId = amb.unidadeId || null;
  l.pavimentoId = amb.pavimentoId || null;
  for (const ev of (amb.evidencias || [])) {
    l.evidencias.push(criarEvidencia({
      documentoOrigem: { docId: ev.documentoId, pagina: ev.pagina, nomeDoc: ev.documento },
      tipo: 'rotulo',
      coordenadas: ev.caixa || null,
      regiao: ev.caixa || null,
      texto: ev.texto || '',
      proveniencia: { motor_ia: 'legado_vetorial', metodo: 'leitura_rotulo', confianca: amb.confianca || 'alta' },
    }));
  }
  return l;
}

/**
 * Converte as listas antigas em { locais, especificacoesSemLocal } sem
 * descartar nada: item cujo ambiente não existe mais vai para o array de
 * itens sem local, que é o que alimenta Pendências.
 */
export function converterParaLocais(projeto) {
  /* O excluído continua na árvore com o seu status: exclusão aqui é lógica e
     reversível, e o rastro de que alguém excluiu aquele item é dado também.
     Todo consumidor já filtra por status !== 'excluido'. */
  const locais = [];
  const porId = new Map();
  for (const amb of (projeto.ambientes || [])) {
    const l = localDeAmbiente(amb);
    locais.push(l); porId.set(l.id, l);
  }
  const semLocal = [];
  for (const achado of (projeto.achados || [])) {
    const local = achado.ambienteId ? porId.get(achado.ambienteId) : null;
    const esp = especificacaoDeAchado(achado, local || null);
    if (local) local.especificacoes.push(esp);
    else semLocal.push(esp);
  }
  return { locais, especificacoesSemLocal: semLocal };
}

/**
 * Converte um projeto salvo no formato antigo para a árvore centrada em
 * locais[]. Destrutiva por natureza — troca a forma do projeto. Só deve ser
 * chamada quando engine, exporter e views lerem a árvore nova; até lá use a
 * `migrar`, que projeta sem apagar.
 */
export function migrarParaLocais(projetoAntigo) {
  if (!projetoAntigo) return criarEmpreendimento();
  if (projetoAntigo.locais && !projetoAntigo.ambientes) return projetoAntigo;

  const novo = criarEmpreendimento(projetoAntigo.empresaId || null,
    projetoAntigo.nome || 'Projeto Legado', projetoAntigo.tipo || 'outro');
  novo.id = projetoAntigo.id || novo.id;
  novo.criadoEm = projetoAntigo.criadoEm || novo.criadoEm;
  novo.atualizadoEm = projetoAntigo.atualizadoEm || novo.atualizadoEm;

  for (const campo of ['endereco', 'localizacao', 'responsavel', 'observacoes']) {
    if (projetoAntigo[campo]) novo[campo] = projetoAntigo[campo];
  }
  novo.dados = projetoAntigo.dados || {};
  novo.estrutura = projetoAntigo.estrutura || novo.estrutura;
  for (const k of ['grupo', 'tipologia', 'unidade', 'pavimento']) novo.estrutura[k] = novo.estrutura[k] || [];
  novo.niveisExtras = projetoAntigo.niveisExtras || [];
  novo.niveisDesligados = projetoAntigo.niveisDesligados || [];
  novo.documentos = projetoAntigo.documentos || [];
  novo.legendas = projetoAntigo.legendas || [];
  novo.tabelas = projetoAntigo.tabelas || [];
  novo.marcas = projetoAntigo.marcas || [];
  novo.fornecedores = projetoAntigo.fornecedores || [];
  novo.auditorias = projetoAntigo.auditorias || [];
  novo.revisoes = projetoAntigo.revisoes || {};
  novo.historico = projetoAntigo.historico || [];

  const { locais, especificacoesSemLocal } = converterParaLocais(projetoAntigo);
  novo.locais = locais;
  novo.especificacoesSemLocal = especificacoesSemLocal;
  return novo;
}

/* ================================================================= */
/* CAMADA DE COMPATIBILIDADE — temporária, encolhe a cada módulo      */
/*                                                                    */
/* Engine, exporter e views ainda leem `ambientes`/`achados`. Enquanto */
/* migramos módulo por módulo, o que está abaixo mantém a aplicação de */
/* pé e os dados intactos. Cada bloco sai quando o seu consumidor      */
/* passar a ler a árvore de `locais`.                                  */
/* ================================================================= */

/* Chave de comparação: colapsa pontuação além do espaço. É o que faz
   "B.SERVIÇO" e "B SERVIÇO" caírem no mesmo lugar. A `normalizar` preserva a
   pontuação, então as comparações de nome usam esta. */
const chave = s => normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Comparação tolerante de nome de ambiente. Cobre zero à esquerda
 * ("BANHO 02" = "banho 2") e plural que abrange numeração ("banhos 02 e 03"
 * alcança "BANHO 02").
 */
export function mesmoAmbienteFlex(a, b) {
  const na = chave(a).replace(/\b0+(\d)/g, '$1');
  const nb = chave(b).replace(/\b0+(\d)/g, '$1');
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.replace(/\s+/g, '') === nb.replace(/\s+/g, '')) return true;
  const ta = na.split(' '), tb = nb.split(' ');
  const numA = ta.filter(t => /^\d+$/.test(t)), numB = tb.filter(t => /^\d+$/.test(t));
  const baseA = ta.filter(t => !/^\d+$/.test(t)).join(' ').replace(/s$/, '');
  const baseB = tb.filter(t => !/^\d+$/.test(t)).join(' ').replace(/s$/, '');
  if (!baseA || !baseB) return false;
  if (baseA !== baseB && !baseA.startsWith(baseB) && !baseB.startsWith(baseA)) return false;
  if (!numA.length || !numB.length) return baseA === baseB;
  return numA.some(n => numB.includes(n));
}

/* Abreviações de prancha, para reconhecer a família do ambiente quando a
   legenda fala no plural. Nunca entram em comparação estrita. */
const ABREVIACOES = [
  [/^b\b/, 'banho'], [/^ban\b/, 'banho'], [/^q\b/, 'quarto'], [/^dorm\b/, 'dormitorio'],
  [/^a\s*s\b/, 'area de servico'], [/^as\b/, 'area de servico'],
  [/^circ\b/, 'circulacao'], [/^dep\b/, 'deposito'], [/^vest\b/, 'vestiario'],
  [/^sac\b/, 'sacada'], [/^terr\b/, 'terraco'], [/^tec\b/, 'area tecnica'],
  [/^lav\b/, 'lavanderia'], [/^est\b/, 'estar'], [/^jant\b/, 'jantar'],
  [/^gar\b/, 'garagem'], [/^cob\b/, 'cobertura'], [/^hall\b/, 'hall'],
];

export function formasDoNome(nome) {
  const n = chave(nome);
  const formas = new Set([n]);
  for (const [re, cheio] of ABREVIACOES) if (re.test(n)) formas.add(n.replace(re, cheio));
  return [...formas];
}

const GENERICOS = new Set(['geral', 'gerais', 'todos', 'todas', 'todo', 'toda',
  'demais', 'demais ambientes', 'todos os ambientes', 'geral seguir especificacao do piso']);

/**
 * Resolve um termo da coluna "AMBIENTES" de uma legenda de prancha para os
 * locais do empreendimento. 'exata' quando o nome bate, 'familia' quando o
 * plural cobre uma família, 'pavimento' quando nomeia um pavimento inteiro,
 * 'geral' quando vale para tudo. Termo que não casa volta vazio — nada é
 * resolvido por palpite.
 */
export function casarAmbientes(termo, ambientes, pavimentos = []) {
  const t = chave(termo).replace(/\b0+(\d)/g, '$1');
  if (!t || t.length < 2) return [];
  if (GENERICOS.has(t) || /^geral\b/.test(t)) return ambientes.map(a => ({ ambiente: a, forca: 'geral' }));

  const pav = pavimentos.find(p => {
    const np = chave(p);
    return np && (np === t || t === 'pavimento ' + np || t.endsWith(' ' + np) || np.includes(t));
  });
  if (pav) {
    const lista = ambientes.filter(a => chave(a.pavimento) === chave(pav));
    if (lista.length) return lista.map(a => ({ ambiente: a, forca: 'pavimento' }));
  }

  /* Exata e família somam, não se excluem: "banhos" alcança BANHO 01 pelo
     nome e B.SERVIÇO pela família, e cada um entra com a sua força. */
  const casos = [];
  const vistos = new Set();
  for (const a of ambientes) {
    if (!mesmoAmbienteFlex(a.nome, termo)) continue;
    casos.push({ ambiente: a, forca: 'exata' }); vistos.add(a.id);
  }
  const base = t.replace(/s$/, '');
  if (base.length >= 4) {
    for (const a of ambientes) {
      if (vistos.has(a.id)) continue;
      const cabe = formasDoNome(a.nome).some(f => {
        const semNum = f.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
        return semNum === base || semNum.startsWith(base + ' ') || semNum.split(' ').includes(base)
          || (base.length >= 5 && semNum.startsWith(base));
      });
      if (cabe) { casos.push({ ambiente: a, forca: 'familia' }); vistos.add(a.id); }
    }
  }
  return casos;
}

/** Empreendimento com os arrays antigos que a UI atual ainda escreve e lê. */
export function empreendimentoVazio(nome, tipo = 'outro') {
  return criarEmpreendimento(null, nome, tipo || 'outro');
}

/**
 * Migração: garante os campos de que a UI depende e converte para a árvore
 * qualquer documento gravado antes do corte. Documento novo já vem com
 * `locais`; documento antigo tem as listas e é convertido aqui, e as listas
 * são então removidas do objeto — não há mais duas verdades.
 */
export function migrar(emp) {
  if (!emp) return emp;
  emp.tipo = emp.tipo || 'outro';
  emp.empresaId = emp.empresaId || null;
  emp.criadoEm = emp.criadoEm || emp.atualizadoEm || new Date().toISOString();
  emp.dados = emp.dados || {};
  emp.estrutura = emp.estrutura || { grupo: [], tipologia: [], unidade: [], pavimento: [] };
  for (const k of ['grupo', 'tipologia', 'unidade', 'pavimento']) emp.estrutura[k] = emp.estrutura[k] || [];
  if (Array.isArray(emp.tipologias) && emp.tipologias.length && !emp.estrutura.tipologia.length) {
    emp.estrutura.tipologia = emp.tipologias.map(t => ({ id: t.id || novoId('niv'), nome: t.nome, descricao: t.descricao || '' }));
  }
  delete emp.tipologias;
  emp.niveisExtras = emp.niveisExtras || [];
  emp.niveisDesligados = emp.niveisDesligados || [];
  emp.documentos = emp.documentos || [];
  emp.locais = emp.locais || []; emp.especificacoesSemLocal = emp.especificacoesSemLocal || [];
  emp.marcas = emp.marcas || []; emp.fornecedores = emp.fornecedores || [];
  emp.legendas = emp.legendas || []; emp.tabelas = emp.tabelas || [];
  emp.auditorias = emp.auditorias || []; emp.historico = emp.historico || [];
  emp.revisoes = emp.revisoes || {};

  /* Quem tem árvore, tem a verdade. Documento gravado depois do corte traz
     `locais` e nenhuma lista; documento antigo traz as listas e nenhuma
     árvore, e aí a árvore é construída a partir delas. */
  const temArvore = Array.isArray(emp.locais) && emp.locais.length > 0;
  if (!temArvore) atualizarLocais(emp);
  /* o legado sai do objeto: depois do corte ele não é mais lido por ninguém e
     não deve voltar ao banco na próxima gravação. */
  delete emp.ambientes; delete emp.achados; delete emp.tags;
  return sincronizar(emp);
}

/* Depois do corte nada é projetado: a árvore é gravada e as listas antigas
   não existem mais. A constante fica como contrato do que o serializador
   precisa omitir — hoje, nada. */
export const CAMPOS_PROJETADOS = [];

/** Constrói a árvore a partir de um documento gravado antes do corte. */
export function atualizarLocais(emp) {
  if (!emp) return emp;
  const { locais, especificacoesSemLocal } = converterParaLocais(emp);
  emp.locais = locais;
  emp.especificacoesSemLocal = especificacoesSemLocal;
  return emp;
}

/** Sincroniza a lista de pavimentos com o que foi lido das pranchas. */
export function semearPavimentos(emp) {
  const vistos = new Set(emp.estrutura.pavimento.map(p => chave(p.nome)));
  for (const a of (emp.locais || [])) {
    const nome = (a.pavimento || '').trim();
    if (!nome || vistos.has(chave(nome))) continue;
    vistos.add(chave(nome));
    emp.estrutura.pavimento.push({ id: novoId('niv'), nome, descricao: '', origem: 'prancha' });
  }
}

/** Todos os itens do projeto na forma nova, com e sem local. */
export function todasEspecificacoes(emp) {
  const dentro = (emp.locais || []).flatMap(l => l.especificacoes || []);
  return dentro.concat(emp.especificacoesSemLocal || []);
}

/* ================================================================= */
/* A ÁRVORE É A ÚNICA VERDADE                                        */
/*                                                                    */
/* Não existe mais camada de projeção nem apelidos. `emp.locais` e    */
/* `emp.especificacoesSemLocal` são o que o motor escreve, o que o    */
/* banco grava e o que as telas leem. As listas `emp.ambientes` e     */
/* `emp.achados` deixaram de existir.                                 */
/* ================================================================= */

/**
 * Recoloca cada especificação no local a que ela diz pertencer: o que aponta
 * para um local vivo entra nele, o que não aponta para nenhum cai na fila de
 * triagem. Chamar depois de qualquer escrita na árvore ou de qualquer revisão
 * humana que mude o local de um item.
 */
export function sincronizar(emp) {
  if (!emp) return emp;
  emp.locais = emp.locais || [];
  emp.especificacoesSemLocal = emp.especificacoesSemLocal || [];
  const porId = new Map(emp.locais.map(l => [l.id, l]));
  const todos = todasEspecificacoes(emp);
  for (const l of emp.locais) l.especificacoes = [];
  const semLocal = [];
  for (const esp of todos) {
    const destino = esp.localId ? porId.get(esp.localId) : null;
    if (destino) {
      esp.localNome = destino.nome;
      esp.pavimento = destino.pavimento || esp.pavimento || '';
      esp.tipologia = destino.tipologia || esp.tipologia || '';
      destino.especificacoes.push(esp);
    } else {
      esp.localId = null;
      semLocal.push(esp);
    }
  }
  emp.especificacoesSemLocal = semLocal;
  return emp;
}
