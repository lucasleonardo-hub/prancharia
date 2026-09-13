/* Glossário de mapeamento — a memória do processo.

   Traduz o que está escrito no projeto para o vocabulário da planilha:
   Categoria, Nome do Produto/Serviço e Sistema Construtivo. Começa com as
   regras tiradas da planilha-padrão e aprende com cada correção sua, valendo
   para todos os empreendimentos seguintes. Nada aqui inventa marca, modelo ou
   dimensão: só classifica o texto que já existe no documento. */

import { normalizar } from './model.js';

const PEDRA = 'Revestimento de pedras naturais (mármore, granito, pedra mineira, mosaico e outros)';
const CERAMICO = 'Revestimento cerâmico interno';
const CERAMICO_EXT = 'Revestimento cerâmico externo';
const PINTURA = 'Pinturas, Texturas, Vernizes (Interna)';
const SANITARIOS = 'Louças e metais sanitários';

/* Ordem importa: a primeira regra que casa vence. */
export const REGRAS_BASE = [
  // --- esquadrias (vêm antes das regras de pintura: uma porta pintada é porta)
  { p: '\\bporta\\b.*(aluminio|alumínio|alumíno)|(aluminio|alumínio|alumíno).*\\bporta\\b', prod: 'Porta', sis: 'Esquadrias de alumínio', cat: 'Esquadrias', forcaCat: true },
  { p: '\\bporta\\b.*madeira|madeira.*\\bporta\\b|\\bporta\\b.*pivotante|\\bporta\\b.*de correr|\\bporta\\b.*de abrir', prod: 'Porta', sis: 'Esquadrias de madeira', cat: 'Esquadrias', forcaCat: true },
  { p: '\\bporta\\b.*(ferro|aco|aço)', prod: 'Porta', sis: 'Esquadrias de ferro e aço', cat: 'Esquadrias', forcaCat: true },
  { p: 'janela|maxim ar|maxim-ar|veneziana|oscilobatente', prod: 'Janela', sis: 'Esquadrias de alumínio', cat: 'Esquadrias', forcaCat: true },
  { p: 'guarda.?corpo', prod: 'Guarda-corpo', sis: 'Guarda-corpos de alumínio', cat: 'Esquadrias', forcaCat: true },
  { p: 'portao|portão', prod: 'Portão', sis: 'Esquadrias de ferro e aço', cat: 'Esquadrias', forcaCat: true },
  { p: '\\bporta\\b', prod: 'Porta', sis: '', cat: 'Esquadrias', forcaCat: true },

  // --- teto
  { p: 'forro de gesso', prod: 'Forro de gesso', sis: 'Forro de gesso (interno e externo)', cat: 'Teto' },
  { p: 'forro.*madeira|forro modular em madeira', prod: 'Forro de madeira', sis: 'Forro de madeira', cat: 'Teto' },
  { p: 'tabica', prod: 'Tabica', sis: 'Esquadrias de alumínio', cat: 'Teto' },
  { p: 'laje a receber pintura|laje.*pintura', prod: 'Pintura', sis: PINTURA, cat: 'Teto' },
  { p: 'alcapao|alçapão', prod: 'Alçapão', sis: 'Esquadrias de madeira', cat: 'Teto' },
  { p: 'claraboia|clarabóia', prod: 'Claraboia', sis: 'Esquadrias de alumínio', cat: 'Teto' },

  // --- louças, metais e hidráulica
  { p: 'bacia sanitaria|bacia sanitária|vaso sanitario|vaso sanitário', prod: 'Bacia sanitária', sis: SANITARIOS, cat: 'Louças', forcaCat: true },
  { p: '\\bcuba\\b', prod: 'Cuba', sis: SANITARIOS, cat: 'Louças', forcaCat: true },
  { p: 'tanque', prod: 'Tanque', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'torneira', prod: 'Torneira', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'misturador', prod: 'Misturador', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'chuveiro', prod: 'Chuveiro', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: '\\bducha\\b', prod: 'Ducha', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'registro de gaveta', prod: 'Registro de gaveta', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'registro de pressao|registro de pressão|registro', prod: 'Registro', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'sifao|sifão', prod: 'Sifão', sis: SANITARIOS, cat: 'Metais', forcaCat: true },
  { p: 'banheira', prod: 'Banheira', sis: SANITARIOS, cat: 'Banheira', forcaCat: true },
  { p: 'ralo.*grelha|grelha linear|\\bralo\\b', prod: 'Ralo com grelha', sis: 'Instalações hidráulicas - Água não potável - Águas pluviais e drenagem', cat: 'Metais', forcaCat: true },

  // --- pedras naturais (antes das regras de piso, para não virar cerâmica)
  { p: 'pingadeira', prod: 'Pingadeira', sis: PEDRA, cat: 'Revestimentos em Pedras Naturais', forcaCat: true },
  { p: 'soleira', prod: 'Soleira', sis: PEDRA, cat: 'Revestimentos em Pedras Naturais', forcaCat: true },
  { p: 'baguete', prod: 'Baguete', sis: PEDRA, cat: 'Revestimentos em Pedras Naturais', forcaCat: true },
  { p: '\\btento\\b', prod: 'Tento', sis: PEDRA, cat: 'Revestimentos em Pedras Naturais', forcaCat: true },
  { p: 'bancada|tampo', nao: 'misturador|torneira|cuba|chuveiro|sifao|sifão|registro|ducha', prod: 'Bancada', sis: PEDRA, cat: 'Bancadas', forcaCat: true },
  { p: 'rodape em marmore|rodapé em mármore', prod: 'Rodapé', sis: PEDRA },
  { p: 'marmore travertino|mármore travertino|travertino', prod: 'Mármore travertino', sis: PEDRA },
  { p: 'quartzito', prod: 'Quartzito', sis: PEDRA },
  { p: 'quartzo', prod: 'Quartzo', sis: PEDRA },
  { p: 'granito', prod: 'Granito', sis: PEDRA },
  { p: 'cacao de pedra|cacão de pedra|pedra moledo|moledo', prod: 'Pedra natural', sis: PEDRA },
  { p: 'marmore|mármore', prod: 'Mármore', sis: PEDRA },

  // --- rodapés
  { p: 'rodape negativo|rodapé negativo|perfil metalico embutido|perfil metálico embutido', prod: 'Rodapé negativo', sis: 'Serralheria' },
  { p: 'rodape em porcelanato|rodapé em porcelanato', prod: 'Rodapé', sis: CERAMICO },
  { p: 'rodape.*mdf.*santa luzia|rodapé.*mdf.*santa luzia', prod: 'Rodapé', sis: '' },
  { p: 'rodape.*mdf|rodapé.*mdf', prod: 'Rodapé', sis: 'Rodapés em madeira' },
  { p: 'santa luzia|poliestireno', prod: 'Rodapé', sis: 'Rodapés em poliestireno' },

  // --- piso e parede
  { p: 'porcelanato.*(externo|area externa|área externa)|area externa.*porcelanato', prod: 'Porcelanato', sis: CERAMICO_EXT },
  { p: 'porcelanato', prod: 'Porcelanato', sis: CERAMICO },
  { p: 'pastilha', prod: 'Pastilha', sis: CERAMICO },
  { p: 'cristal pool', prod: 'Pastilha de piscina', sis: 'Piscina', nao: 'deck' },
  { p: 'ladrilho hidraulico|ladrilho hidráulico', prod: 'Ladrilho hidráulico', sis: 'Revestimento em ladrilho hidráulico' },
  { p: 'ladrilho', prod: 'Ladrilho', sis: CERAMICO },
  { p: 'tinta epoxi|tinta epóxi|epoxi|epóxi', prod: 'Pintura epóxi', sis: 'Pintura epóxi' },
  { p: 'deck em madeira|piso em madeira|assoalho|\\btaco\\b|madeira a definir', prod: 'Piso de madeira', sis: 'Pisos de madeira - Tacos, assoalhos e decks de madeira' },
  { p: 'area permeavel|área permeável|gramado|paisagismo', prod: 'Área permeável', sis: 'Jardins e paisagismo' },
  { p: 'cimento queimado|microcimento', prod: 'Cimento queimado', sis: 'Revestimentos em concreto' },
  { p: 'contrapiso|argamassa colante', prod: 'Argamassa colante', sis: 'Contrapiso' },
  { p: 'rejunte', prod: 'Rejunte', sis: 'Rejuntes' },
  { p: 'revestimento ceramico|revestimento cerâmico|ceramica|cerâmica', prod: 'Revestimento cerâmico', sis: CERAMICO },
  { p: 'papel de parede', prod: 'Papel de parede', sis: 'Decoração' },
  { p: 'painel em madeira|marcenaria', prod: 'Painel em madeira', sis: 'Decoração', cat: 'Mobiliário' },
  { p: 'textura', prod: 'Textura', sis: PINTURA },
  { p: 'pintura.*(latex|látex|acrilica|acrílica)|latex acrilica|látex acrílica|pintura acrilica|pintura acrílica', prod: 'Pintura', sis: PINTURA },
  { p: 'pintura|tinta', prod: 'Pintura', sis: PINTURA },
  { p: 'impermeabiliz', prod: 'Impermeabilizante', sis: 'Impermeabilização' },
  { p: 'drywall', prod: 'Drywall', sis: 'Drywall' },
  { p: 'vidro', prod: 'Vidro', sis: 'Vidros' },
  { p: 'gouache', prod: 'Revestimento cerâmico', sis: CERAMICO },

  // --- luminárias
  { p: 'arandela', prod: 'Arandela', sis: 'Luminárias', cat: 'Luminárias', forcaCat: true },
  { p: 'plafon', prod: 'Plafon', sis: 'Luminárias', cat: 'Luminárias', forcaCat: true },
  { p: 'pendente', prod: 'Pendente', sis: 'Luminárias', cat: 'Luminárias', forcaCat: true },
  { p: 'fita de led|fita led', prod: 'Fita de LED', sis: 'Instalações elétricas', cat: 'Luminárias', forcaCat: true },
  { p: '\\bspot\\b', prod: 'Spot', sis: 'Luminárias', cat: 'Luminárias', forcaCat: true },
  { p: 'balizador|embutido de teto|luminaria|luminária', prod: 'Luminária', sis: 'Luminárias', cat: 'Luminárias', forcaCat: true },
  { p: 'driver', prod: 'Driver', sis: 'Instalações elétricas', cat: 'Acessórios', forcaCat: true },

];

/* Seções da tabela de esquadrias: evidência direta do material. */
export const SECOES_ESQUADRIA = [
  { p: 'porta.*madeira|madeira', tipo: 'Porta', sis: 'Esquadrias de madeira' },
  { p: 'porta.*(aluminio|alumínio|aluminío)', tipo: 'Porta', sis: 'Esquadrias de alumínio' },
  { p: 'janela.*(aluminio|alumínio|aluminío)', tipo: 'Janela', sis: 'Esquadrias de alumínio' },
  { p: 'janela.*madeira', tipo: 'Janela', sis: 'Esquadrias de madeira' },
  { p: 'porta.*(ferro|aco|aço)', tipo: 'Porta', sis: 'Esquadrias de ferro e aço' },
  { p: 'porta.*pvc', tipo: 'Porta', sis: 'Esquadrias de PVC' },
  { p: 'vidro', tipo: 'Porta de vidro', sis: 'Vidros' },
  { p: 'janela', tipo: 'Janela', sis: '' },
  { p: 'porta', tipo: 'Porta', sis: '' },
];

export function lerSecaoEsquadria(texto) {
  const n = normalizar(texto);
  if (!n) return null;
  for (const s of SECOES_ESQUADRIA) if (new RegExp(s.p).test(n)) return s;
  return null;
}

/* ---------------- aplicação ---------------- */

let aprendidas = [];

export function carregarAprendidas(lista) { aprendidas = Array.isArray(lista) ? lista : []; }
export function regrasAprendidas() { return aprendidas; }

/**
 * Classifica uma descrição. Devolve { produto, sistema, categoria, origem }
 * ou null quando nenhuma regra reconhece o texto — e aí os campos ficam vazios,
 * como manda a regra de veracidade.
 */
export function classificar(descricao, categoriaAtual) {
  const n = normalizar(descricao);
  if (!n) return null;
  for (const r of aprendidas) {
    if (r.exato ? n === normalizar(r.exato) : (r.p && new RegExp(r.p).test(n))) {
      return { produto: r.prod || '', sistema: r.sis || '', categoria: r.forcaCat || !categoriaAtual ? (r.cat || categoriaAtual || '') : categoriaAtual, origem: 'glossário aprendido', regra: r.exato || r.p };
    }
  }
  for (const r of REGRAS_BASE) {
    if (!new RegExp(r.p).test(n)) continue;
    if (r.nao && new RegExp(r.nao).test(n)) continue;
    return {
      produto: r.prod || '',
      sistema: r.sis || '',
      categoria: (r.forcaCat && r.cat) ? r.cat : (categoriaAtual || r.cat || ''),
      origem: 'glossário do processo',
      regra: r.p,
    };
  }
  return null;
}

/** Grava uma correção sua como regra para os próximos empreendimentos. */
export function aprender(descricao, { categoria, produto, sistema }) {
  const exato = (descricao || '').trim();
  if (!exato) return aprendidas;
  const i = aprendidas.findIndex(r => normalizar(r.exato) === normalizar(exato));
  const regra = { exato, cat: categoria || '', prod: produto || '', sis: sistema || '', forcaCat: !!categoria, quando: new Date().toISOString() };
  if (i >= 0) aprendidas[i] = regra; else aprendidas.unshift(regra);
  if (aprendidas.length > 800) aprendidas.length = 800;
  return aprendidas;
}

export function esquecer(exato) {
  aprendidas = aprendidas.filter(r => normalizar(r.exato) !== normalizar(exato));
  return aprendidas;
}

/* ================================================================== */
/* A CAMADA DA EMPRESA                                                 */
/* ================================================================== */

/* O glossário aprendido já chega com o escopo certo: `storage.lerGlossario()`
   mescla o global com o da empresa ativa e a empresa vence no empate. Então
   `classificar()` acima não precisou mudar uma linha — trocar de construtora
   é recarregar `aprendidas`, e é o que `recarregarParaEmpresa` faz.

   O que a empresa acrescenta além disso são duas coisas que o glossário não
   sabia fazer: grafar certo a marca que o documento cita, e falar o nome dos
   ambientes na língua da casa. As duas entram por `enriquecer()`.

   Import tardio de propósito: `companyMemory` importa `storage`, que importa
   `ia`; deixar isso no topo criaria um ciclo com quem importa o glossário no
   meio do carregamento. A referência é resolvida na primeira chamada. */

let _empresa = null;
export function ligarMemoriaDeEmpresa(modulo) { _empresa = modulo || null; }

/** Recarrega as regras no escopo da empresa que acabou de ficar ativa. */
export async function recarregarParaEmpresa(lerGlossario) {
  try { carregarAprendidas(await lerGlossario()); }
  catch (e) { console.warn('[glossário] não consegui recarregar no escopo da empresa:', e.message); }
  return aprendidas;
}

/**
 * Classificação + o que a empresa ativa sabe. Devolve sempre um objeto:
 *
 *   { produto, sistema, categoria, origem, regra,   ← do glossário, como antes
 *     sugestoes: [ ... ] }                          ← da empresa, para revisar
 *
 * As sugestões NÃO são aplicadas aqui. Elas descrevem o que a pessoa veria e
 * confirmaria na fila de revisão. A regra é a mesma do prompt: preferência de
 * compra não é evidência documental, e nada preenche campo que o documento
 * deixou vazio.
 */
export function enriquecer(esp = {}) {
  const base = classificar(esp.descricao, esp.categoria) || {};
  const sugestoes = [];
  if (_empresa && _empresa.empresaAtiva && _empresa.empresaAtiva()) {
    const marca = _empresa.sugerirMarca(esp);
    if (marca) sugestoes.push({ tipo: 'marca', ...marca });
    if (esp.local) {
      const naCasa = _empresa.nomeDaCasa(esp.local);
      if (naCasa && naCasa !== esp.local) {
        sugestoes.push({
          tipo: 'local', campo: 'local', valor: naCasa,
          porque: `esta empresa escreve "${naCasa}" onde o documento escreve "${esp.local}".`,
        });
      }
    }
  }
  return { ...base, sugestoes };
}

/** As marcas que a empresa homologa, para o autocompletar da tela de marcas. */
export function marcasDaEmpresa() {
  return (_empresa && _empresa.marcasHomologadas) ? _empresa.marcasHomologadas() : [];
}
