/* Tipo de empreendimento — é ele que define a estrutura.

   Cada tipo liga apenas os níveis hierárquicos que existem naquele projeto e
   dá a eles o nome que se usa em obra: uma casa tem pavimento e ambiente; um
   condomínio de apartamentos tem torre, tipologia, unidade, pavimento e
   ambiente; um condomínio de casas tem quadra, tipologia, lote e ambiente.
   Menu, painel, formulários e planilhas leem daqui — nada é fixo. */

/** Níveis possíveis, do mais externo ao mais interno. */
export const ORDEM_NIVEIS = ['grupo', 'tipologia', 'unidade', 'pavimento'];

const N = (nivel, singular, plural, ico, ajuda) => ({ nivel, singular, plural, ico, ajuda });

export const TIPOS = [
  {
    id: 'casa', nome: 'Casa', familia: 'Residencial unifamiliar',
    resumo: 'Uma residência única. Sem tipologias, torres ou unidades.',
    niveis: [N('pavimento', 'Pavimento', 'Pavimentos', 'camadas', 'Subsolo, térreo, superior, cobertura.')],
    areasComuns: false,
    campos: [{ chave: 'pavimentos', rotulo: 'Quantidade de pavimentos', tipo: 'numero', semente: 'pavimento' }],
  },
  {
    id: 'apartamento', nome: 'Apartamento', familia: 'Residencial multifamiliar',
    resumo: 'Uma unidade dentro de um edifício. Pavimentos internos quando houver duplex.',
    niveis: [N('pavimento', 'Pavimento', 'Pavimentos', 'camadas', 'Pavimentos internos da unidade.')],
    areasComuns: false,
    campos: [{ chave: 'pavimentos', rotulo: 'Quantidade de pavimentos da unidade', tipo: 'numero', semente: 'pavimento' }],
  },
  {
    id: 'studio', nome: 'Studio', familia: 'Residencial multifamiliar',
    resumo: 'Unidade compacta de ambiente integrado.',
    niveis: [],
    areasComuns: false,
    campos: [],
  },
  {
    id: 'cond_apartamentos', nome: 'Condomínio de apartamentos', familia: 'Residencial multifamiliar',
    resumo: 'Torres, tipologias de unidade, pavimentos e áreas comuns.',
    niveis: [
      N('grupo', 'Torre', 'Torres', 'predio', 'Torres ou blocos do condomínio.'),
      N('tipologia', 'Tipologia', 'Tipologias', 'camadas', 'Ex.: 2 dormitórios, 3 dormitórios, varanda estendida.'),
      N('unidade', 'Unidade', 'Unidades', 'porta', 'Apartamentos, por número e pavimento.'),
      N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos-tipo e pavimentos de uso comum.'),
    ],
    areasComuns: true,
    campos: [
      { chave: 'torres', rotulo: 'Quantidade de torres', tipo: 'numero', semente: 'grupo' },
      { chave: 'pavimentos', rotulo: 'Pavimentos por torre', tipo: 'numero', semente: 'pavimento' },
      { chave: 'unidadesPorPavimento', rotulo: 'Unidades por pavimento', tipo: 'numero' },
    ],
  },
  {
    id: 'cond_casas', nome: 'Condomínio de casas', familia: 'Residencial unifamiliar',
    resumo: 'Quadras, tipologias de casa, lotes e áreas comuns.',
    niveis: [
      N('grupo', 'Quadra', 'Quadras', 'predio', 'Quadras ou setores do condomínio.'),
      N('tipologia', 'Tipologia de casa', 'Tipologias de casa', 'camadas', 'Modelos de casa ofertados.'),
      N('unidade', 'Lote', 'Lotes', 'porta', 'Lotes e casas implantadas.'),
      N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos de cada modelo.'),
    ],
    areasComuns: true,
    campos: [
      { chave: 'quadras', rotulo: 'Quantidade de quadras', tipo: 'numero', semente: 'grupo' },
      { chave: 'lotes', rotulo: 'Quantidade de lotes', tipo: 'numero' },
    ],
  },
  {
    id: 'hotel', nome: 'Hotel', familia: 'Hospedagem',
    resumo: 'Blocos, pavimentos, tipos de quarto e áreas comuns.',
    niveis: [
      N('grupo', 'Bloco', 'Blocos', 'predio', 'Blocos ou alas do hotel.'),
      N('tipologia', 'Tipo de quarto', 'Tipos de quarto', 'camadas', 'Ex.: standard, luxo, suíte master.'),
      N('unidade', 'Quarto', 'Quartos', 'porta', 'Unidades de hospedagem por número.'),
      N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos do bloco.'),
    ],
    areasComuns: true,
    campos: [
      { chave: 'blocos', rotulo: 'Quantidade de blocos', tipo: 'numero', semente: 'grupo' },
      { chave: 'pavimentos', rotulo: 'Pavimentos por bloco', tipo: 'numero', semente: 'pavimento' },
      { chave: 'quartos', rotulo: 'Quantidade de quartos', tipo: 'numero' },
    ],
  },
  {
    id: 'escola', nome: 'Escola', familia: 'Institucional',
    resumo: 'Blocos, pavimentos e ambientes de ensino e apoio.',
    niveis: [
      N('grupo', 'Bloco', 'Blocos', 'predio', 'Blocos da escola.'),
      N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos de cada bloco.'),
    ],
    areasComuns: true,
    campos: [
      { chave: 'blocos', rotulo: 'Quantidade de blocos', tipo: 'numero', semente: 'grupo' },
      { chave: 'pavimentos', rotulo: 'Pavimentos', tipo: 'numero', semente: 'pavimento' },
    ],
  },
  {
    id: 'hospital', nome: 'Hospital', familia: 'Saúde',
    resumo: 'Blocos, pavimentos, tipos de leito e áreas assistenciais.',
    niveis: [
      N('grupo', 'Bloco', 'Blocos', 'predio', 'Blocos ou alas assistenciais.'),
      N('tipologia', 'Tipo de unidade', 'Tipos de unidade', 'camadas', 'Ex.: enfermaria, apartamento, UTI.'),
      N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos de cada bloco.'),
    ],
    areasComuns: true,
    campos: [
      { chave: 'blocos', rotulo: 'Quantidade de blocos', tipo: 'numero', semente: 'grupo' },
      { chave: 'pavimentos', rotulo: 'Pavimentos', tipo: 'numero', semente: 'pavimento' },
    ],
  },
  {
    id: 'galpao', nome: 'Galpão', familia: 'Logística',
    resumo: 'Módulos de galpão, mezaninos e blocos administrativos.',
    niveis: [
      N('grupo', 'Módulo', 'Módulos', 'predio', 'Módulos ou galpões do empreendimento.'),
      N('pavimento', 'Nível', 'Níveis', 'escada', 'Piso, mezanino, cobertura.'),
    ],
    areasComuns: true,
    campos: [{ chave: 'modulos', rotulo: 'Quantidade de módulos', tipo: 'numero', semente: 'grupo' }],
  },
  {
    id: 'industrial', nome: 'Industrial', familia: 'Industrial',
    resumo: 'Setores de produção, utilidades e apoio.',
    niveis: [
      N('grupo', 'Setor', 'Setores', 'predio', 'Setores da planta industrial.'),
      N('pavimento', 'Nível', 'Níveis', 'escada', 'Níveis e plataformas.'),
    ],
    areasComuns: true,
    campos: [{ chave: 'setores', rotulo: 'Quantidade de setores', tipo: 'numero', semente: 'grupo' }],
  },
  {
    id: 'comercial', nome: 'Comercial / Lojas', familia: 'Comercial',
    resumo: 'Lojas e salas por pavimento, com áreas comuns.',
    niveis: [
      N('tipologia', 'Tipologia', 'Tipologias', 'camadas', 'Tipos de loja ou sala.'),
      N('unidade', 'Loja / sala', 'Lojas e salas', 'porta', 'Unidades comerciais.'),
      N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos do edifício.'),
    ],
    areasComuns: true,
    campos: [{ chave: 'pavimentos', rotulo: 'Quantidade de pavimentos', tipo: 'numero', semente: 'pavimento' }],
  },
  {
    id: 'retrofit', nome: 'Retrofit', familia: 'Reforma',
    resumo: 'Intervenção em edificação existente. Níveis conforme o que for reformado.',
    niveis: [N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos atingidos pela intervenção.')],
    areasComuns: true,
    campos: [{ chave: 'pavimentos', rotulo: 'Pavimentos atingidos', tipo: 'numero', semente: 'pavimento' }],
  },
  {
    id: 'infraestrutura', nome: 'Infraestrutura', familia: 'Infraestrutura',
    resumo: 'Obra linear ou de sistemas. Organizada por trechos.',
    niveis: [N('grupo', 'Trecho', 'Trechos', 'predio', 'Trechos ou estacas da obra.')],
    areasComuns: true,
    campos: [{ chave: 'trechos', rotulo: 'Quantidade de trechos', tipo: 'numero', semente: 'grupo' }],
  },
  {
    id: 'outro', nome: 'Outro', familia: 'Genérico',
    resumo: 'Estrutura mínima. Você liga os níveis que precisar nas configurações.',
    niveis: [N('pavimento', 'Pavimento', 'Pavimentos', 'escada', 'Pavimentos do empreendimento.')],
    areasComuns: true,
    campos: [],
  },
];

export const TIPO_POR_ID = Object.fromEntries(TIPOS.map(t => [t.id, t]));

export function tipoDe(emp) {
  return TIPO_POR_ID[emp && emp.tipo] || TIPO_POR_ID.outro;
}

/** Níveis efetivamente ligados, já considerando ajustes manuais. */
export function niveisDe(emp) {
  const t = tipoDe(emp);
  const desligados = new Set((emp && emp.niveisDesligados) || []);
  const extras = (emp && emp.niveisExtras) || [];
  const base = t.niveis.filter(n => !desligados.has(n.nivel));
  for (const id of extras) {
    if (base.some(n => n.nivel === id) || desligados.has(id)) continue;
    const modelo = TIPOS.flatMap(x => x.niveis).find(n => n.nivel === id);
    if (modelo) base.push(modelo);
  }
  return base.sort((a, b) => ORDEM_NIVEIS.indexOf(a.nivel) - ORDEM_NIVEIS.indexOf(b.nivel));
}

export function temNivel(emp, nivel) {
  return niveisDe(emp).some(n => n.nivel === nivel);
}
export function rotuloNivel(emp, nivel, plural = false) {
  const n = niveisDe(emp).find(x => x.nivel === nivel);
  if (n) return plural ? n.plural : n.singular;
  const modelo = TIPOS.flatMap(x => x.niveis).find(x => x.nivel === nivel);
  return modelo ? (plural ? modelo.plural : modelo.singular) : nivel;
}
export function temAreasComuns(emp) {
  const t = tipoDe(emp);
  return emp && emp.areasComunsForcado !== undefined ? !!emp.areasComunsForcado : !!t.areasComuns;
}

/** Cadeia hierárquica textual do tipo, para mostrar na interface. */
export function cadeiaDe(emp) {
  return ['Empreendimento', ...niveisDe(emp).map(n => n.singular), 'Ambiente'];
}
