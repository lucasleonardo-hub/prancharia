/* Marcas do mercado brasileiro de construção que os documentos citam sem
   dizer "marca:". A planilha pede: antes de pintar a coluna Marca de
   amarelo, olhar se a marca já está na descrição — "Porcelanato branco
   Eliane 30x30" tem marca. Esta lista é o que o site "sabe" do mercado; a
   empresa ativa pode acrescentar as suas (glossário, marcas homologadas).

   Nada aqui inventa marca: só reconhece um nome que está escrito no
   documento. Duas marcas na mesma frase ("Deca ou Docol") não decidem —
   é dúvida, e fica para a construtora. */

import { normalizar } from './model.js';

export const MARCAS_CONHECIDAS = [
  // revestimentos cerâmicos e porcelanatos
  'Portobello', 'Eliane', 'Portinari', 'Ceusa', 'Biancogres', 'Elizabeth', 'Cecrisa', 'Villagres', 'Pointer',
  'Delta', 'Castelatto', 'Incepa', 'Roca', 'Lepri', 'Damme', 'Itagres', 'Incefra', 'Pamesa', 'Embramaco',
  'Cerâmica Atlas', 'Atlas', 'Decortiles', 'Cedasa', 'Savane', 'Rox', 'Formigres', 'Tecnogres', 'Cerbras',
  'Solarium', 'Jatobá', 'Palmetal', 'Mosarte', 'Vidrotil', 'Jacuzzi', 'Lanzi',
  // louças e metais
  'Deca', 'Docol', 'Celite', 'Icasa', 'Logasa', 'Ideal Standard', 'Kohler', 'Grohe', 'Hansgrohe', 'Lorenzetti',
  'Fabrimar', 'Meber', 'Esteves', 'Hydra', 'Fani', 'Perflex', 'Tramontina', 'Franke', 'Mekal', 'Ghelplus',
  'Ghel Plus', 'Blukit', 'Censi', 'Herc', 'Astra', 'Moldenox', 'Pertutti', 'Duravit', 'Toto', 'Blum',
  // tintas e texturas
  'Suvinil', 'Coral', 'Sherwin-Williams', 'Sherwin Williams', 'Lukscolor', 'Eucatex', 'Iquine', 'Anjo', 'Renner',
  'Hydronorth', 'Killing', 'Weber', 'Quartzolit', 'Votomassa', 'Votorantim', 'Votoran', 'Vedacit', 'Sika', 'Viapol',
  'Denver', 'Dryko', 'Fortaleza', 'Massa Raspada TG',
  // pisos vinílicos, laminados, madeira, carpete
  'Tarkett', 'Durafloor', 'Eucafloor', 'Quick-Step', 'Gerflor', 'Beaulieu', 'Belgotex', 'Ospe', 'Indusparquet',
  'Ipê Piso', 'Armstrong', 'Braspiso', 'LG Hausys', 'Forbo',
  // forros, drywall, gesso
  'Knauf', 'Placo', 'Gypsum', 'Trevo Drywall', 'Trevo', 'Hunter Douglas', 'Amf', 'AMF', 'Armstrong Forros',
  // esquadrias, ferragens, vidros
  'Sasazaki', 'Atlântica', 'Alumasa', 'Belmetal', 'Alcoa', 'Hydro', 'CBA', 'Weiku', 'Esquadrisul', 'Lunelli',
  'Papaiz', 'Pado', 'La Fonte', 'Imab', 'Stam', 'Aliança', 'Soprano', 'Arouca', 'Silvana', 'Yale', 'Udinese',
  'Blindex', 'Cebrace', 'Guardian', 'Saint-Gobain', 'AGC', 'Pilkington', 'Divilux', 'Esquadrias Lucasa',
  'Pormade', 'Vert', 'Randa', 'Sincol', 'Cruzeiro', 'Roma Portas',
  // elétrica e iluminação
  'Simon', 'Pial', 'Pial Legrand', 'Legrand', 'Schneider', 'Siemens', 'Steck', 'Margirius', 'Alumbra', 'Tramontina Eletrik',
  'Philips', 'Osram', 'Stella', 'Yamamura', 'Interlight', 'Lumicenter', 'Taschibra', 'Brilia', 'Intral', 'Lumini',
  'Dimlux', 'Ledvance', 'Bella Iluminação', 'Kian', 'Avant', 'Save Energy',
  // hidráulica e gás
  'Tigre', 'Amanco', 'Krona', 'Akros', 'Wavin', 'Fortlev', 'Bakof', 'Tuper', 'Eluma', 'Aquatherm', 'Rinnai',
  'Komeco', 'Lorenzetti Aquecedores', 'Heliotek', 'Soletrol',
  // elevadores e equipamentos
  'ThyssenKrupp', 'Thyssenkrupp', 'TK Elevator', 'Atlas Schindler', 'Schindler', 'Otis', 'Kone', 'Orona',
  'Brastemp', 'Electrolux', 'Consul', 'Bosch', 'Fischer', 'Cadence', 'Elgin', 'Springer', 'Carrier', 'Daikin',
  'LG', 'Samsung', 'Midea', 'Gree', 'Fujitsu', 'Intelbras', 'Garen', 'PPA', 'Rossi', 'Peccinin', 'Nice', 'Ipec',
  // pedras, bancadas, argamassas
  'Silestone', 'Caesarstone', 'Dekton', 'Cosentino', 'Quartzobras', 'Prime Quartz', 'Vitra', 'Corian', 'Durcon',
  'Leroy Merlin', 'Telhanorte', 'C&C',
  // estrutura e alvenaria
  'Gerdau', 'ArcelorMittal', 'Belgo', 'Precon', 'Tatu', 'Pauluzzi', 'Celucon', 'Siporex', 'Prensil',
];

const CHAVE = m => normalizar(m).replace(/[^a-z0-9]+/g, ' ').trim();
const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Marcas que também são palavras comuns em português ou nomes de cor/modelo:
   só valem quando escritas com inicial maiúscula num texto de caixa mista —
   "coral" (cor) não é Coral (tinta); "Delta" pode ser Delta (cerâmica). */
const AMBIGUAS = new Set(['coral', 'delta', 'atlas', 'astra', 'denver', 'fortaleza', 'anjo', 'trevo', 'vert', 'cruzeiro',
  'nice', 'rossi', 'stella', 'elizabeth', 'pointer', 'pamesa', 'renner', 'killing', 'hydro', 'cba', 'agc', 'lg',
  'toto', 'blum', 'amf', 'vitra', 'tatu', 'kian', 'avant', 'simon', 'placo', 'weber', 'ospe', 'ipec', 'ppa', 'rox']);

let padrao = null;
function padraoDe(lista) {
  const nomes = [...new Set(lista.map(CHAVE).filter(Boolean))].sort((a, b) => b.length - a.length);
  return new RegExp('(?:^|[^a-z0-9])(' + nomes.map(escapar).join('|') + ')(?=$|[^a-z0-9])', 'g');
}

/**
 * As marcas escritas num texto. Devolve { marca, todas }: `marca` é a única
 * marca encontrada (a que vai para a coluna F); com duas ou mais — "Deca ou
 * Docol" — `marca` é '' e `todas` lista as candidatas, porque a escolha
 * ainda não foi feita. `extras` são as marcas da empresa ativa.
 */
export function marcaNaDescricao(texto, extras = []) {
  const t = String(texto || '');
  if (t.length < 3) return { marca: '', todas: [] };
  const lista = extras.length ? [...MARCAS_CONHECIDAS, ...extras] : MARCAS_CONHECIDAS;
  const re = extras.length ? padraoDe(lista) : (padrao || (padrao = padraoDe(MARCAS_CONHECIDAS)));
  const caixaMista = /[a-z]/.test(t) && /[A-Z]/.test(t);
  const n = CHAVE(t);
  const achadas = new Map();
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(n))) {
    const chave = m[1];
    if (AMBIGUAS.has(chave) && caixaMista) {
      /* a palavra ambígua só é marca com inicial maiúscula no original */
      const original = new RegExp('(?:^|[^A-Za-zÀ-ÿ])' + escapar(chave.split(' ')[0]) + '(?=$|[^A-Za-zÀ-ÿ])', 'i').exec(t);
      const trecho = original ? original[0].replace(/^[^A-Za-zÀ-ÿ]/, '') : '';
      if (!trecho || !/^[A-ZÀ-Ý]/.test(trecho)) continue;
    }
    /* o nome como a lista escreve (grafia certa da marca) */
    const oficial = lista.find(x => CHAVE(x) === chave) || chave;
    if (![...achadas.keys()].some(k => k.includes(chave) || chave.includes(k))) achadas.set(chave, oficial);
  }
  const todas = [...achadas.values()];
  return { marca: todas.length === 1 ? todas[0] : '', todas };
}

/* "a definir", "a contratar", "ou similar": o produto está nomeado mas não
   está decidido — a planilha pede a célula em amarelo mesmo preenchida. */
export const INCERTEZA = /\b[aà]\s+(?:definir|contratar|especificar|escolher|confirmar|detalhar)\b|\bou\s+(?:similar|semelhante|equivalente)\b|\bsimilar(?:es)?\s*[.;]?\s*$|\bconforme\s+(?:projeto|fachada|decora[çc][ãa]o)\b|\bsujeito\s+a\s+altera/i;
export const temIncerteza = texto => INCERTEZA.test(String(texto || ''));
