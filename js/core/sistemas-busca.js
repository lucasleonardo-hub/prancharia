/* Conferência dos sistemas construtivos contra o texto indexado dos documentos.

   É a etapa 1 da assessoria feita onde o texto já está: para cada sistema
   da lista mestra do lado do manual, procura nos documentos os termos que
   denunciam o sistema (nome, sinônimos, siglas) e devolve as evidências
   (documento, página, trecho). Cruzado com a lista que a construtora
   manteve, aponta os candidatos a MANTIDO INCORRETAMENTE (mantido sem
   evidência) e a EXCLUÍDO INCORRETAMENTE (excluído com evidência).

   Evidência textual não é prova de existência (memorial de modelo cita o
   que a obra não tem; prancha raster não entra no índice): o resultado é a
   lista de candidatos com a fonte, para a pessoa decidir — nunca a decisão.
   Módulo puro: sem DOM, sem rede; o servidor importa (server/mcp.js). */

import { SISTEMAS } from './vocab.js';

/** Termos de busca além do nome, por sistema (em minúsculas, sem acento). */
const SINONIMOS = {
  'Ancoragem': ['ancoragem', 'ponto de ancoragem', 'linha de vida'],
  'Antena coletiva': ['antena coletiva', 'antena', 'tv a cabo', 'cabeamento de tv'],
  'Ar condicionado': ['ar condicionado', 'ar-condicionado', 'split', 'vrf', 'condensadora', 'evaporadora', 'climatizacao'],
  'Ar condicionado (Infraestrutura)': ['infraestrutura para ar condicionado', 'infra de ar condicionado', 'previsao para ar condicionado', 'dreno de ar condicionado', 'linha frigorigena', 'tubulacao frigorigena', 'ponto de ar condicionado', 'espera para split'],
  'Automação de portões': ['portao automatico', 'automatizador de portao', 'motor de portao', 'portao eletronico'],
  'Automação predial': ['automacao predial', 'bms'],
  'Automação residencial': ['automacao residencial', 'casa inteligente'],
  'Banheira de hidromassagem': ['hidromassagem', 'banheira'],
  'Brises': ['brise', 'brises'],
  'Calçadas': ['calcada', 'passeio publico'],
  'Cerca elétrica': ['cerca eletrica'],
  'Churrasqueira para uso a carvão': ['churrasqueira'],
  'Churrasqueira a gás': ['churrasqueira a gas'],
  'Cobertura': ['cobertura', 'telhado', 'telha', 'calha', 'rufo', 'cumeeira'],
  'Concreto aparente': ['concreto aparente'],
  'Concreto protendido': ['protendido', 'protensao'],
  'Contenções': ['contencao', 'muro de arrimo', 'cortina atirantada', 'solo grampeado'],
  'Contrapiso': ['contrapiso'],
  'Controle de acesso e circuito fechado de televisão (CFTV)': ['cftv', 'camera', 'cameras', 'controle de acesso', 'catraca', 'cancela', 'dvr', 'nvr'],
  'Controle de acesso e circuito fechado de televisão (CFTV) (Infraestrutura)': ['infraestrutura de cftv', 'infra para cftv', 'previsao para cameras', 'ponto para camera', 'eletroduto para cftv'],
  'Decoração': ['decoracao', 'mobiliario', 'sofa', 'poltrona', 'quadro decorativo', 'papel de parede', 'cortina'],
  'Dedetização': ['dedetizacao'],
  'Depósito de Lixo ARS (Armazenamento de Resíduos Sólidos)': ['deposito de lixo', 'lixeira coletiva', 'abrigo de residuos', 'residuos solidos', 'central de lixo'],
  'Dispositivo para carregamento de automóveis elétricos': ['carregador veicular', 'carregamento de veiculos eletricos', 'carregamento de automoveis eletricos', 'wallbox', 'eletroposto'],
  'Dispositivo para carregamento de automóveis elétricos (Infraestrutura)': ['infraestrutura para carregador', 'previsao para carregador', 'infra para carregamento de veiculos'],
  'Divisórias sanitárias': ['divisoria sanitaria', 'divisoria de banheiro'],
  'Parede em Drywall': ['drywall', 'gesso acartonado', 'placa de gesso'],
  'Elementos de vedações blindados': ['blindado', 'blindagem', 'porta blindada'],
  'Eletrodomésticos': ['eletrodomestico', 'cooktop', 'fogao', 'forno', 'coifa', 'geladeira', 'micro-ondas', 'microondas'],
  'Elevadores': ['elevador', 'elevadores', 'casa de maquinas', 'poco do elevador'],
  'Equipamentos eletrônicos': ['chuveiro eletrico', 'televisor', 'tv led', 'interfone'],
  'Escadas rolantes': ['escada rolante'],
  'Espaço fitness': ['fitness', 'academia', 'sala de ginastica'],
  'Espelho d’água': ['espelho d agua', 'espelho dagua', 'espelho d’agua'],
  'Espelhos': ['espelho', 'espelhos'],
  'Esquadrias de alumínio': ['esquadria de aluminio', 'esquadrias de aluminio', 'janela de aluminio', 'porta de aluminio', 'caixilho de aluminio', 'aluminio anodizado', 'aluminio pintado'],
  'Esquadrias de ferro e aço': ['esquadria de ferro', 'esquadria de aco', 'serralheria', 'porta de ferro', 'grade de ferro', 'portao de ferro'],
  'Esquadrias de madeira': ['esquadria de madeira', 'porta de madeira', 'janela de madeira', 'marco de madeira'],
  'Esquadrias de PVC': ['esquadria de pvc', 'janela de pvc', 'porta de pvc'],
  'Estacionamento (externo)': ['estacionamento externo', 'vagas descobertas', 'estacionamento descoberto'],
  'Estacionamento (interno)': ['estacionamento coberto', 'vagas cobertas', 'garagem'],
  'Estrutura metálica': ['estrutura metalica', 'perfil metalico', 'trelica metalica', 'viga metalica'],
  'Estrutura pré-moldada': ['pre-moldado', 'pre moldado', 'premoldado', 'pre-fabricado'],
  'Estruturas de concreto armado': ['concreto armado', 'pilar', 'viga', 'laje', 'armadura'],
  'ETE - Estação de Tratamento de Efluentes': ['ete', 'tratamento de efluentes', 'tratamento de esgoto', 'fossa', 'filtro anaerobio'],
  'ETA - Estação de Tratamento de Água': ['eta', 'tratamento de agua'],
  'Fachada em pele de vidro': ['pele de vidro', 'fachada envidracada', 'structural glazing'],
  'Fachada Ventilada': ['fachada ventilada'],
  'Fachadas': ['fachada', 'fachadas'],
  'Fachadas com revestimento cerâmico': ['pastilha', 'ceramica de fachada', 'porcelanato de fachada', 'revestimento ceramico na fachada'],
  'Fachadas em EPS': ['eps na fachada', 'moldura de eps', 'fachada em eps'],
  'Ferragens e fechaduras': ['fechadura', 'dobradica', 'ferragem', 'puxador', 'macaneta'],
  'Fontes e chafariz': ['chafariz', 'fonte decorativa'],
  'Forno de pizza para uso a carvão': ['forno de pizza'],
  'Forro de EPS': ['forro de eps', 'forro em eps'],
  'Forro de gesso (interno e externo)': ['forro de gesso', 'gesso acartonado no teto', 'sanca', 'tabica', 'forro em gesso'],
  'Forro de madeira': ['forro de madeira', 'lambri'],
  'Forro de PVC': ['forro de pvc', 'forro em pvc'],
  'Forro mineral': ['forro mineral', 'fibra mineral'],
  'Forro modular': ['forro modular', 'forro removivel'],
  'Fundações': ['fundacao', 'fundacoes', 'estaca', 'sapata', 'radier', 'bloco de coroamento', 'tubulao'],
  'Garagem (externa)': ['garagem externa', 'garagem descoberta'],
  'Garagem (interna)': ['garagem', 'subsolo', 'vaga de garagem'],
  'Gerador de energia': ['gerador', 'grupo gerador', 'grupo motor gerador'],
  'Geradores de água quente': ['aquecedor central', 'boiler', 'caldeira', 'gerador de agua quente'],
  'Grupo gerador': ['grupo gerador', 'gerador'],
  'Guarda-corpos de alumínio': ['guarda-corpo de aluminio', 'guarda corpo de aluminio'],
  'Guarda-corpos de ferro e aço': ['guarda-corpo metalico', 'guarda corpo de ferro', 'guarda-corpo de aco', 'guarda corpo em aco'],
  'Guarda-corpos de madeira': ['guarda-corpo de madeira', 'guarda corpo de madeira'],
  'Iluminação automática': ['sensor de presenca', 'iluminacao automatica', 'fotocelula'],
  'Iluminação de emergência - Baterias comuns': ['iluminacao de emergencia'],
  'Iluminação de emergência - Baterias seladas': ['iluminacao de emergencia', 'bateria selada'],
  'Iluminação de emergência - Conjunto de blocos autônomos e módulos': ['bloco autonomo', 'iluminacao de emergencia'],
  'Iluminação de emergência - Grupo gerador': ['iluminacao de emergencia', 'grupo gerador'],
  'Iluminação de emergência - Sistema centralizado com baterias recarregáveis': ['iluminacao de emergencia', 'sistema centralizado', 'central de iluminacao de emergencia'],
  'Impermeabilização': ['impermeabilizacao', 'manta asfaltica', 'argamassa polimerica', 'impermeabilizante'],
  'Instalação de gás combustível': ['gas', 'glp', 'gas natural', 'central de gas', 'medidor de gas', 'ponto de gas'],
  'Instalações elétricas': ['eletrica', 'quadro de distribuicao', 'disjuntor', 'tomada', 'interruptor', 'eletroduto', 'circuito'],
  'Instalações hidráulicas - Sistema de combate a incêndio': ['hidrante', 'sprinkler', 'combate a incendio', 'reserva de incendio', 'mangueira de incendio'],
  'Instalações hidráulicas - Água não potável - Esgoto': ['esgoto', 'caixa de inspecao', 'ramal de esgoto', 'tubo de queda'],
  'Instalações hidráulicas - Água não potável - Rede coletora de gordura': ['caixa de gordura'],
  'Instalações hidráulicas - Água não potável - Água de reúso': ['agua de reuso', 'reuso de agua', 'aproveitamento de agua de chuva', 'cisterna de reuso'],
  'Instalações hidráulicas - Água não potável - Águas pluviais e drenagem e Água servida': ['aguas pluviais', 'pluvial', 'drenagem', 'ralo', 'caixa de areia', 'agua servida'],
  'Instalações hidráulicas - Água potável - Água fria': ['agua fria', 'reservatorio', 'caixa d agua', 'caixa dagua', 'hidrometro', 'barrilete'],
  'Instalações hidráulicas - Água potável - Água quente': ['agua quente', 'aquecedor', 'tubulacao de agua quente', 'ppr', 'cpvc'],
  'Instalações preventivas contra incêndio': ['extintor', 'alarme de incendio', 'rota de fuga', 'saida de emergencia', 'sinalizacao de emergencia', 'detector de fumaca', 'ppci', 'pscip'],
  'Irrigação automática': ['irrigacao'],
  'Jardins e paisagismo': ['paisagismo', 'jardim', 'jardins', 'grama', 'canteiro'],
  'Juntas de dilatação': ['junta de dilatacao'],
  'Kit porta pronta': ['porta pronta', 'kit porta'],
  'Lareira para uso a carvão': ['lareira'],
  'Louças e metais sanitários': ['bacia sanitaria', 'vaso sanitario', 'cuba', 'lavatorio', 'torneira', 'registro', 'sifao', 'metais sanitarios', 'loucas'],
  'Luminárias': ['luminaria', 'luminarias', 'arandela', 'pendente', 'spot', 'plafon', 'poste de iluminacao'],
  'Muros externos': ['muro', 'muro de divisa', 'muros'],
  'Parede em EPS': ['parede em eps', 'painel de eps', 'painel monolitico'],
  'Paredes de concreto': ['parede de concreto', 'paredes de concreto', 'concreto moldado in loco'],
  'Pet place': ['pet place', 'espaco pet'],
  'Pintura em poliuretano': ['poliuretano', 'tinta pu'],
  'Pintura epóxi': ['epoxi', 'epoxi'],
  'Pinturas, Texturas, Vernizes (Externa)': ['pintura externa', 'textura', 'textura acrilica', 'verniz', 'pintura de fachada'],
  'Pinturas, Texturas, Vernizes (Interna)': ['pintura', 'tinta acrilica', 'latex', 'massa corrida', 'selador'],
  'Piscina': ['piscina', 'casa de bombas', 'deck da piscina'],
  'Piscina coberta': ['piscina coberta', 'piscina aquecida'],
  'Piso carpete': ['carpete'],
  'Piso cimentado (externo)': ['cimentado', 'piso cimentado'],
  'Piso cimentado (interno)': ['cimentado', 'piso cimentado'],
  'Piso acabado em concreto (externo)': ['concreto polido', 'piso de concreto', 'concreto desempenado'],
  'Piso acabado em concreto (interno)': ['concreto polido', 'piso de concreto'],
  'Piso de borracha': ['piso de borracha', 'piso emborrachado'],
  'Piso elevado externo e interno': ['piso elevado'],
  'Piso em blocos de concreto intertravados': ['intertravado', 'bloco intertravado', 'paver', 'piso intertravado'],
  'Piso laminado': ['piso laminado', 'laminado de madeira'],
  'Piso tátil': ['piso tatil', 'tatil'],
  'Piso vinílico': ['vinilico', 'piso vinilico', 'lvt'],
  'Pisos de madeira - Tacos, assoalhos e decks de madeira': ['deck de madeira', 'assoalho', 'taco', 'piso de madeira'],
  'Pisos de vidro': ['piso de vidro'],
  'Plataformas elevatórias de acessibilidade': ['plataforma elevatoria', 'plataforma de acessibilidade'],
  'Portas corta-fogo': ['corta-fogo', 'corta fogo', 'pcf'],
  'Portas de Enrolar': ['porta de enrolar', 'porta de aco de enrolar'],
  'Porteiro eletrônico': ['porteiro eletronico', 'interfone', 'video porteiro', 'videoporteiro'],
  'Rede de lógica': ['rede logica', 'cabeamento estruturado', 'rack de telecom', 'rj45', 'cat6', 'cat5'],
  'Rejuntes': ['rejunte', 'rejuntamento'],
  'Reservatório metálico': ['reservatorio metalico', 'caixa d agua metalica'],
  'Reservatório de concreto': ['reservatorio de concreto', 'reservatorio enterrado', 'cisterna'],
  'Revestimento cerâmico externo': ['ceramica externa', 'porcelanato externo', 'revestimento ceramico externo'],
  'Revestimento cerâmico interno': ['porcelanato', 'ceramica', 'azulejo', 'revestimento ceramico', 'pastilha'],
  'Revestimento de paredes e tetos em argamassa (interno e externo)': ['reboco', 'emboco', 'chapisco', 'argamassa'],
  'Revestimento de paredes em gesso (interno e externo)': ['gesso liso', 'gesso corrido', 'revestimento em gesso'],
  'Revestimento de pedras naturais (mármore, granito, pedra mineira, mosaico e outros)': ['granito', 'marmore', 'pedra mineira', 'soleira', 'peitoril', 'bancada em granito', 'pedra natural', 'ardosia', 'limestone'],
  'Revestimento de pedras sintéticas': ['quartzo', 'silestone', 'dekton', 'pedra sintetica', 'marmore sintetico'],
  'Revestimento em ladrilho hidráulico': ['ladrilho hidraulico'],
  'Revestimentos em concreto': ['revestimento em concreto', 'placa cimenticia', 'cimento queimado'],
  'Revestimentos em madeira': ['revestimento em madeira', 'painel de madeira', 'lambri de madeira'],
  'Rodapés em madeira': ['rodape de madeira', 'rodape em madeira', 'rodape de mdf'],
  'Rodapés em poliestireno': ['rodape de poliestireno', 'poliestireno', 'rodape em poliestireno'],
  'Sauna seca': ['sauna seca', 'sauna'],
  'Sauna úmida': ['sauna umida', 'sauna a vapor', 'sauna'],
  'Serralheria': ['serralheria', 'gradil', 'grade', 'portao'],
  'Shaft hidráulico em EPS': ['shaft'],
  'Sistema de aquecimento a gás': ['aquecedor a gas', 'aquecedor de passagem', 'rinnai', 'lorenzetti a gas', 'aquecimento a gas'],
  'Sistema de aquecimento a gás (Infraestrutura)': ['ponto de gas para aquecedor', 'espera para aquecedor', 'previsao para aquecedor', 'infraestrutura para aquecedor'],
  'Sistema de aquecimento central de água': ['aquecimento central', 'central de agua quente', 'boiler'],
  'Sistema de aquecimento solar': ['aquecimento solar', 'coletor solar', 'placa solar termica', 'boiler solar'],
  'Sistema de atenuação acústica': ['acustica', 'atenuacao acustica', 'isolamento acustico', 'la de rocha', 'la de vidro', 'manta acustica'],
  'Sistema fotovoltaico': ['fotovoltaico', 'fotovoltaica', 'painel solar', 'inversor solar', 'geracao solar'],
  'Sistemas de exaustão mecânica - Banheiros, lavabos e vestiários': ['exaustor', 'exaustao mecanica', 'exaustao de banheiro'],
  'Sistemas de exaustão mecânica - Churrasqueiras': ['exaustao da churrasqueira', 'coifa da churrasqueira', 'exaustor da churrasqueira'],
  'Sistemas de exaustão mecânica - Coifa': ['coifa', 'depurador'],
  'Sistemas de exaustão mecânica - Piscinas cobertas': ['exaustao da piscina', 'desumidificacao'],
  'Sistemas de pressurização de escada': ['pressurizacao', 'escada pressurizada', 'antecamara'],
  'SPA/Ofurô': ['spa', 'ofuro'],
  'SPDA - Sistema de Proteção Contra Descargas Atmosféricas': ['spda', 'para-raios', 'para raios', 'descargas atmosfericas', 'captor', 'malha de aterramento'],
  'Steel frame': ['steel frame', 'light steel'],
  'Subestação': ['subestacao', 'transformador', 'cabine primaria', 'media tensao'],
  'Telefonia e sistema de interfones': ['telefonia', 'interfone', 'interfonia', 'ponto de telefone', 'central telefonica'],
  'Vidros': ['vidro', 'vidros', 'vidro temperado', 'vidro laminado', 'box de vidro', 'guarda-corpo de vidro'],
  'Vidros com resistência ao fogo': ['vidro corta-fogo', 'vidro resistente ao fogo'],
  'Wood frame': ['wood frame'],
  'Área de recreação infantil': ['playground', 'brinquedoteca', 'recreacao infantil', 'parquinho'],
  'Alvenaria de bloco de concreto celular autoclavado': ['concreto celular', 'bloco celular', 'autoclavado'],
  'Alvenaria de tijolos cerâmicos': ['tijolo ceramico', 'bloco ceramico', 'tijolo'],
  'Alvenaria estrutural': ['alvenaria estrutural', 'bloco estrutural'],
  'Alvenaria vedação de bloco de concreto': ['bloco de concreto', 'alvenaria de vedacao', 'alvenaria'],
  'Calefação': ['calefacao', 'aquecimento de ambiente', 'piso aquecido'],
  'Corrimãos de alumínio': ['corrimao de aluminio'],
  'Corrimãos de ferro e aço': ['corrimao metalico', 'corrimao de aco', 'corrimao de ferro', 'corrimao em aco'],
  'Corrimãos de madeira': ['corrimao de madeira'],
  'Elementos Decorativos em ACM nas Fachadas': ['acm', 'aluminio composto'],
  'Elementos Decorativos em WPC nas Fachadas': ['wpc', 'madeira plastica'],
  'Elementos Decorativos em Serralheria nas Fachadas': ['cobogo metalico', 'brise metalico', 'serralheria decorativa'],
  'Piso - Camada isolante térmica (externa)': ['isolante termico', 'isolamento termico'],
  'Sinalizações (verticais e horizontais)': ['sinalizacao', 'placa de sinalizacao', 'demarcacao de vagas'],
  'Pavimentação': ['pavimentacao', 'asfalto', 'cbuq'],
  'Terraplenagem': ['terraplenagem', 'aterro', 'corte e aterro'],
  'Piso Industrial': ['piso industrial'],
  'Infraestrutura para prática recreativa - Piso gramado sintético': ['grama sintetica'],
  'Infraestrutura para prática recreativa - Piso gramado natural': ['campo gramado', 'grama natural'],
  'Infraestrutura para prática recreativa - Areia': ['quadra de areia', 'areia'],
  'Infraestrutura para prática recreativa - Piso cimentado': ['quadra poliesportiva', 'quadra cimentada'],
  'Infraestrutura para prática recreativa - Piso de base asfáltica': ['quadra asfaltica'],
  'Infraestrutura para prática recreativa - Piso de madeira': ['quadra de madeira'],
  'Infraestrutura para prática recreativa - Piso de saibro': ['saibro'],
  'Lago artificial': ['lago artificial'],
  'Sonorização': ['sonorizacao', 'som ambiente', 'caixa de som'],
  'Aspiração Central': ['aspiracao central'],
  'Cênica': ['cenica', 'palco', 'iluminacao cenica'],
  'Estrutura de madeira engenheirada': ['madeira engenheirada', 'clt', 'mlc', 'glulam'],
  'Painéis Kronan e Lajes Alveolares': ['laje alveolar', 'kronan'],
  'Parede com Painel PIR': ['painel pir'],
  'Isopainel': ['isopainel', 'painel isotermico'],
  'Light Wall': ['light wall'],
  'Shaft hidráulico em MDF': ['shaft em mdf'],
  'Shaft hidráulico em bloco de concreto': ['shaft'],
  'Subbase de placa cimentícia': ['placa cimenticia'],
  'Tanque de retardo': ['tanque de retardo', 'reservatorio de retardo', 'bacia de retencao'],
  'Refrigeração Industrial': ['refrigeracao industrial'],
  'Câmaras Frigoríficas Modulares': ['camara fria', 'camara frigorifica'],
  'Insufladores - Sistema de Ventilação Industrial': ['insuflador', 'ventilacao industrial', 'insuflamento'],
  'Niveladora de Doca': ['niveladora de doca', 'doca'],
  'Balança Rodoviária': ['balanca rodoviaria'],
  'Esteira de Transporte Vertical/Horizontal': ['esteira transportadora'],
  'Poste e iluminação do sistema viário': ['poste', 'iluminacao viaria', 'iluminacao publica'],
  'Forro colmeia': ['forro colmeia'],
  'Forro de fibra mineralizada': ['fibra mineralizada'],
  'Forro de melamina expandida': ['melamina'],
  'Revestimento em madeira ecológica': ['madeira ecologica', 'madeira plastica', 'wpc'],
  'Piso cimentício (externo)': ['piso cimenticio', 'placa cimenticia'],
  'Automação predial via BMS': ['bms', 'automacao predial'],
};

/** Palavras que não distinguem um sistema de outro quando derivadas do nome. */
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'a', 'o', 'as', 'os', 'sistema', 'sistemas', 'instalacoes', 'instalacao', 'infraestrutura', 'interno', 'externo', 'interna', 'externa', 'interior', 'exterior', 'uso', 'outros', 'via', 'tipo', 'elementos', 'decorativos', 'nas', 'pratica', 'recreativa']);

export const normalizar = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`´]/g, ' ').replace(/\s+/g, ' ').trim();

/** Termos de busca de um sistema: sinônimos curados + o nome sem parênteses +
    o nome sem as palavras vazias (só se sobrar algo com 4+ letras). */
export function termosDoSistema(nome) {
  const termos = new Set((SINONIMOS[nome] || []).map(normalizar));
  const base = normalizar(nome.replace(/\(.*?\)/g, ' ').replace(/ - .*$/, m => ' ' + m.slice(3)));
  if (base.length >= 4) termos.add(base);
  const semVazias = base.split(' ').filter(p => p && !VAZIAS.has(p)).join(' ');
  if (semVazias.length >= 4 && semVazias !== base) termos.add(semVazias);
  return [...termos].filter(t => t.length >= 3);
}

/** Normaliza um texto guardando o mapa posição-normalizada → posição-original
    (Int32Array: um documento grande não vira um array de números por caractere). */
function normalizarComMapa(t) {
  const partes = [];
  const mapa = new Int32Array(t.length * 2);
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`´]/g, ' ');
    for (let k = 0; k < c.length; k++) { partes.push(c[k]); if (n < mapa.length) mapa[n] = i; n++; }
  }
  return { texto: partes.join(''), mapa };
}

function marcadorDePagina(textoIndexado, posicao) {
  const p = textoIndexado.lastIndexOf('[p.', posicao);
  const f = textoIndexado.lastIndexOf('[folha ', posicao);
  const i = Math.max(p, f);
  if (i < 0) return '';
  const m = /^\[(?:p\.(\d+)|folha (\d+):)/.exec(textoIndexado.slice(i, i + 24));
  return m ? (m[1] || m[2]) : '';
}

const limite = /[a-z0-9]/;
/** Ocorrência de `termo` em `texto` normalizado respeitando fronteira de palavra. */
function* ocorrencias(textoN, termo) {
  let i = textoN.indexOf(termo);
  while (i >= 0) {
    const antes = i > 0 ? textoN[i - 1] : ' ', depois = textoN[i + termo.length] || ' ';
    if (!limite.test(antes) && !limite.test(depois)) yield i;
    i = textoN.indexOf(termo, i + termo.length);
  }
}

/* índices montados uma vez: nome normalizado → nome oficial, e os termos de cada sistema */
const POR_NORMALIZADO = new Map(SISTEMAS.map(s => [normalizar(s.n), s.n]));
const TERMOS = new Map(SISTEMAS.map(s => [s.n, termosDoSistema(s.n)]));
const NOMES_MESTRA = new Set(SISTEMAS.map(s => s.n));

export const LIMITE_LISTA = 400, LIMITE_NOME = 150, LIMITE_TEXTO = 15_000_000;

/** Nome da lista mestra para um nome digitado (exato, sem acento, ou único parecido). */
export function resolverNome(nome) {
  if (typeof nome !== 'string') return { nome: null, parecidos: [] };
  if (NOMES_MESTRA.has(nome)) return { nome, exato: true };
  const n = normalizar(nome);
  if (!n) return { nome: null, parecidos: [] };
  const igual = POR_NORMALIZADO.get(n);
  if (igual) return { nome: igual, exato: false };
  const parecidos = [];
  for (const [nn, oficial] of POR_NORMALIZADO) if (nn.includes(n) || n.includes(nn)) parecidos.push(oficial);
  if (parecidos.length === 1) return { nome: parecidos[0], exato: false };
  return { nome: null, parecidos: parecidos.slice(0, 6) };
}

/**
 * Confere a lista mantida pela construtora contra as evidências dos documentos.
 * @param {object} emp  o empreendimento (usa emp.documentos[].textoIndexado, .nome, .id, .foraDoEscopo)
 * @param {object} opcoes { lado: 'comum' | 'privativa', lista: string[], maxTrechos?: number }
 * Lê um documento por vez (normaliza, varre todos os sistemas, descarta) para não
 * segurar todos os textos normalizados na memória ao mesmo tempo.
 */
export function conferirSistemas(emp, { lado = 'comum', lista = [], maxTrechos = 3 } = {}) {
  if (!Array.isArray(lista)) throw new Error('lista deve ser um array de nomes de sistemas');
  if (lista.length > LIMITE_LISTA) throw new Error(`lista com ${lista.length} itens; o máximo é ${LIMITE_LISTA}`);
  const docsBrutos = (emp.documentos || []).filter(d => d.textoIndexado && !d.foraDoEscopo);
  const semIndice = (emp.documentos || []).filter(d => !d.textoIndexado && !d.foraDoEscopo).map(d => d.nome);
  const totalTexto = docsBrutos.reduce((n, d) => n + d.textoIndexado.length, 0);
  if (totalTexto > LIMITE_TEXTO) throw new Error(`texto indexado de ${totalTexto} caracteres passa do limite de ${LIMITE_TEXTO}; confira por documento com buscar_nos_documentos`);

  const mantidos = new Set();
  const nomesInvalidos = [];
  for (const n of new Set(lista.map(x => (typeof x === 'string' ? x.trim() : x)))) {
    if (typeof n !== 'string' || !n || n.length > LIMITE_NOME) { nomesInvalidos.push({ nome: typeof n === 'string' ? n.slice(0, 60) + '…' : '(item não textual)', parecidos: [] }); continue; }
    const r = resolverNome(n);
    if (r.nome) mantidos.add(r.nome); else nomesInvalidos.push({ nome: n, parecidos: r.parecidos || [] });
  }

  const doLado = SISTEMAS.filter(s => (lado === 'privativa' ? s.p : s.c) && !s.legado);
  const foraDoLado = [...mantidos].filter(n => !doLado.some(s => s.n === n));
  const acum = new Map(doLado.map(s => [s.n, { total: 0, termos: new Set(), evidencias: [] }]));

  for (const d of docsBrutos) {
    const bruto = d.textoIndexado;
    const { texto, mapa } = normalizarComMapa(bruto);
    for (const s of doLado) {
      const a = acum.get(s.n);
      for (const termo of TERMOS.get(s.n)) {
        for (const i of ocorrencias(texto, termo)) {
          a.total++; a.termos.add(termo);
          if (a.evidencias.length < maxTrechos) {
            const ini = mapa[i], fim = mapa[Math.min(mapa.length - 1, i + termo.length - 1)] + 1;
            a.evidencias.push({ documento: d.nome, documentoId: d.id, pagina: marcadorDePagina(bruto, ini), termo, trecho: bruto.slice(Math.max(0, ini - 120), fim + 120).replace(/\s+/g, ' ').trim() });
          } else if (a.total > 50) break;  // já há trechos e contagem suficientes neste documento
        }
      }
    }
  }

  const sistemas = doLado.map(s => {
    const a = acum.get(s.n);
    const naLista = mantidos.has(s.n), comEvidencia = a.total > 0;
    const veredito = naLista
      ? (comEvidencia ? 'mantido_com_evidencia' : 'mantido_sem_evidencia')
      : (comEvidencia ? 'excluido_com_evidencia' : 'excluido_sem_evidencia');
    return { sistema: s.n, naLista, ocorrencias: a.total, termos: [...a.termos], evidencias: a.evidencias, veredito };
  });

  const por = v => sistemas.filter(s => s.veredito === v);
  return {
    lado, documentosIndexados: docsBrutos.length, semIndice, nomesInvalidos, foraDoLado,
    resumo: {
      mantidosComEvidencia: por('mantido_com_evidencia').length,
      mantidosSemEvidencia: por('mantido_sem_evidencia').length,
      excluidosComEvidencia: por('excluido_com_evidencia').length,
      excluidosSemEvidencia: por('excluido_sem_evidencia').length,
    },
    candidatosMantidosIncorretamente: por('mantido_sem_evidencia').map(s => s.sistema),
    candidatosExcluidosIncorretamente: por('excluido_com_evidencia').map(s => ({ sistema: s.sistema, ocorrencias: s.ocorrencias, termos: s.termos, evidencias: s.evidencias })),
    sistemas: sistemas.filter(s => s.veredito !== 'excluido_sem_evidencia'),
    aviso: 'Evidência textual não prova existência (memorial de modelo cita o que a obra não tem; prancha raster não entra no índice). Decida com os documentos abertos; os pares "X" × "X (Infraestrutura)" exigem leitura do que é entregue.',
  };
}
