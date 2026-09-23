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
const COM_REJUNTE = /porcelanato|ceramic|azulejo|pastilha|ladrilho|mosaico|piso vinilico em placa|porcelanico|gres|grês/;
const REJUNTE = /\brejunt/;

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

    /* 1) poda: o que já foi suprido, ou deixou de ser necessário */
    const antes = local.especificacoes.length;
    local.especificacoes = local.especificacoes.filter(a => {
      if (!ehObrigatoria(a)) return true;
      const rejunte = a.motivos.includes('rejunte_obrigatorio');
      if (rejunte) return precisaRejunte(a.categoria);
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
