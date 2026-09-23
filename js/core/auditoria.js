/* Auditoria automática.

   A regra é a mesma do resto do sistema: o que é objetivo e comprovado pelo
   próprio documento é apontado como erro; o que depende de interpretação vai
   para revisão humana com as fontes à vista. Nada aqui inventa valor — quando
   falta informação, a ocorrência diz que falta, não preenche.

   Toda a análise roda no próprio navegador, sobre os dados já extraídos e
   sobre os arquivos anexados. Nenhum texto sai do computador. */

import { normalizar, mesmoAmbienteFlex as mesmoAmbiente, CATEGORIAS } from './model.js';
import { locaisDe, especificacoesDe } from './exporter.js';
import { refDoc, nomeDoc, paginaDoc } from './provas.js';
import { classificar } from './glossario.js';
import { SISTEMA_POR_NOME } from './vocab.js';

export const CLASSES = {
  erro: { rotulo: 'Erro confirmado', tom: 'critico', ordem: 1, desc: 'Objetivo e comprovado pelo próprio documento.' },
  conflito: { rotulo: 'Conflito documental', tom: 'critico', ordem: 2, desc: 'Duas fontes afirmam coisas diferentes. A decisão é sua, com as duas à vista.' },
  provavel: { rotulo: 'Provável', tom: 'atencao', ordem: 3, desc: 'Indício forte, mas cabe interpretação. Há sugestão, não correção automática.' },
  revisar: { rotulo: 'Necessita revisão', tom: 'atencao', ordem: 4, desc: 'O sistema não consegue decidir sozinho.' },
  insuficiente: { rotulo: 'Informação insuficiente', tom: 'neutro', ordem: 5, desc: 'O documento não diz. Nada foi presumido no lugar.' },
};

const vivo = x => x && x.status !== 'excluido';
const txt = v => (v == null ? '' : String(v)).trim();
/* A ocorrência guarda só a referência do documento: quem quiser a evidência
   inteira abre o painel pelo alvoId. */
const refEv = ev => ev ? { documento: nomeDoc(ev), pagina: paginaDoc(ev), ref: refDoc(ev) } : null;

/** Id estável: a mesma ocorrência mantém o mesmo id entre análises. */
const idOc = (regra, alvoId, campo) => `oc:${regra}:${alvoId || '-'}:${campo || '-'}`;

function oc(o) {
  return {
    id: idOc(o.regra, o.alvoId, o.campo), acoes: ['confirmar', 'manter', 'excluir'],
    alvo: 'achado', campo: '', atual: '', sugerido: '', evidencia: null, ...o,
  };
}

/* ================= análise do próprio empreendimento ================= */

export function analisarEmpreendimento(emp) {
  const out = [];
  /* Lê a árvore: cada Especificação avaliada no contexto do seu Local, mais
     os itens que ainda não têm local. */
  const locais = locaisDe(emp);
  /* a linha obrigatória do ambiente (js/core/ambiente.js) já é uma pendência
     por si: não ganha ocorrência de "sem sistema" nem de "sem descrição" */
  const achados = especificacoesDe(emp).filter(a => a.origemLeitura !== 'obrigatoria');
  const ambientes = locais;
  const porLocal = new Map(locais.map(l => [l.id, l]));
  const nomeAmb = id => (porLocal.get(id) || {}).nome || '';
  const marcasConhecidas = (emp.marcas || []).map(m => m.nome || m).filter(x => typeof x === 'string' && x.length > 2);

  // 1. duplicados — mesma descrição, mesmo ambiente, mesma categoria
  const porChave = new Map();
  for (const a of achados) {
    const d = normalizar(a.descricao);
    if (!d) continue;
    const k = [a.localId || '-', a.categoria || '-', d].join('|');
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(a);
  }
  for (const lista of porChave.values()) {
    if (lista.length < 2) continue;
    for (const a of lista.slice(1)) out.push(oc({
      regra: 'duplicado', grupo: 'Informação duplicada', classe: 'erro', alvoId: a.id,
      ambiente: nomeAmb(a.localId),
      descricao: `"${a.descricao}" aparece ${lista.length} vezes no mesmo ambiente e na mesma categoria.`,
      atual: a.descricao, acoes: ['excluir', 'manter'],
      evidencia: refEv((a.evidencias || [])[0]),
    }));
  }

  for (const a of achados) {
    const ev = (a.evidencias || [])[0] || null;
    const local = a.localId ? porLocal.get(a.localId) : null;
    const amb = local ? local.nome : (a.localNome || '');
    const base = { alvoId: a.id, ambiente: amb, evidencia: ev && { documento: nomeDoc(ev), pagina: paginaDoc(ev) } };
    const classe = txt(a.descricao) ? classificar(a.descricao, a.categoria) : null;

    // 2. descrição vazia — a linha sairia em branco na planilha
    if (!txt(a.descricao)) out.push(oc({
      ...base, regra: 'sem_descricao', grupo: 'Item sem descrição', classe: 'erro',
      descricao: 'O item não tem descrição e sairia como linha vazia na planilha.',
      acoes: ['excluir', 'manter'],
    }));

    // 3. categoria fora do vocabulário da planilha
    if (txt(a.categoria) && !CATEGORIAS.includes(a.categoria)) out.push(oc({
      ...base, regra: 'categoria_fora', grupo: 'Categoria fora do vocabulário', classe: 'erro',
      campo: 'categoria', atual: a.categoria, sugerido: classe?.categoria || '',
      descricao: `"${a.categoria}" não é uma das ${CATEGORIAS.length} categorias aceitas na planilha.`,
      acoes: classe?.categoria ? ['aplicar', 'confirmar', 'manter'] : ['confirmar', 'manter'],
    }));
    // 4. categoria divergente do que a própria descrição indica
    else if (classe?.categoria && txt(a.categoria) && classe.categoria !== a.categoria) out.push(oc({
      ...base, regra: 'categoria_divergente', grupo: 'Categoria provavelmente incorreta', classe: 'provavel',
      campo: 'categoria', atual: a.categoria, sugerido: classe.categoria,
      descricao: `A descrição indica ${classe.categoria}, mas o item está classificado em ${a.categoria}.`,
      acoes: ['aplicar', 'manter', 'confirmar'],
    }));
    // 5. categoria ausente
    if (!txt(a.categoria)) out.push(oc({
      ...base, regra: 'sem_categoria', grupo: 'Categoria não informada',
      classe: classe?.categoria ? 'provavel' : 'insuficiente',
      campo: 'categoria', sugerido: classe?.categoria || '',
      descricao: classe?.categoria
        ? `Sem categoria preenchida. A descrição indica ${classe.categoria}.`
        : 'Sem categoria e sem termo reconhecível na descrição.',
      acoes: classe?.categoria ? ['aplicar', 'manter'] : ['manter'],
    }));

    // 6. sistema construtivo
    if (!txt(a.sistema)) out.push(oc({
      ...base, regra: 'sem_sistema', grupo: 'Sistema construtivo não definido',
      classe: classe?.sistema ? 'provavel' : 'revisar',
      campo: 'sistema', sugerido: classe?.sistema || '',
      descricao: classe?.sistema
        ? `Sem sistema preenchido. O glossário aponta "${classe.sistema}".`
        : 'Sem sistema construtivo e sem regra de glossário aplicável.',
      acoes: classe?.sistema ? ['aplicar', 'manter'] : ['manter'],
    }));
    else if (!SISTEMA_POR_NOME[a.sistema] && !SISTEMA_POR_NOME[normalizar(a.sistema)]) out.push(oc({
      ...base, regra: 'sistema_fora', grupo: 'Sistema fora da lista', classe: 'provavel',
      campo: 'sistema', atual: a.sistema, sugerido: classe?.sistema || '',
      descricao: `"${a.sistema}" não consta na lista de sistemas construtivos da planilha.`,
      acoes: classe?.sistema ? ['aplicar', 'manter'] : ['manter'],
    }));

    // 7. marca
    if (!txt(a.marca)) {
      const naDescricao = marcasConhecidas.find(m => normalizar(a.descricao).includes(normalizar(m)));
      out.push(oc({
        ...base, regra: 'sem_marca', grupo: 'Marca não identificada',
        classe: naDescricao ? 'provavel' : 'insuficiente',
        campo: 'marca', sugerido: naDescricao || '', atual: '',
        descricao: naDescricao
          ? `Sem marca preenchida, mas a descrição cita "${naDescricao}".`
          : 'Nenhum documento processado nomeia a marca deste item.',
        acoes: naDescricao ? ['aplicar', 'manter'] : ['manter'],
      }));
    }

    // 8. conflito documental
    if (a.status === 'conflito') out.push(oc({
      ...base, regra: 'conflito', grupo: 'Conflito documental', classe: 'conflito',
      atual: a.descricao,
      descricao: (a.divergencias || []).map(d => `${d.documento} p.${d.pagina}: ${d.descricao}`).join(' · ')
        || 'Duas fontes descrevem este item de formas diferentes.',
      acoes: ['confirmar', 'manter'],
    }));

    // 9. motivos levantados durante a extração
    if ((a.motivos || []).includes('tag_sem_ambiente')) out.push(oc({
      ...base, regra: 'tag_sem_ambiente', grupo: 'Local não encontrado', classe: 'revisar',
      campo: 'localId', atual: a.descricao,
      descricao: 'A tag foi lida, mas não caiu dentro de nenhum ambiente fechado da planta.',
      acoes: ['aplicar', 'manter', 'excluir'],
    }));
    if ((a.motivos || []).includes('legenda_ausente')) out.push(oc({
      ...base, regra: 'legenda_ausente', grupo: 'Legenda não encontrada', classe: 'insuficiente',
      descricao: `A forma ${a.forma || ''} ${a.numero || ''} não tem linha correspondente em nenhuma legenda da prancha.`.replace(/\s+/g, ' '),
      acoes: ['manter', 'excluir'],
    }));
    if ((a.motivos || []).includes('baixa_confianca')) out.push(oc({
      ...base, regra: 'folga_baixa', grupo: 'Vínculo espacial incerto', classe: 'revisar',
      campo: 'localId',
      descricao: `A tag está quase à mesma distância de dois ambientes${ev && ev.segundoLocal ? `: ${amb} e ${ev.segundoLocal}` : ''}.`,
      acoes: ['aplicar', 'confirmar', 'manter'],
    }));
    if ((a.motivos || []).includes('ambiente_proposto')) out.push(oc({
      ...base, regra: 'ambiente_proposto', grupo: 'Local proposto pelo sistema', classe: 'revisar',
      descricao: 'O nome do ambiente foi proposto por proximidade, não lido de um rótulo seguro.',
      acoes: ['confirmar', 'manter'],
    }));
    if ((a.motivos || []).includes('vinculo_por_proximidade')) out.push(oc({
      ...base, regra: 'vinculo_proximidade', grupo: 'Local proposto pela proximidade da tag', classe: 'revisar',
      campo: 'localId', atual: a.descricao,
      descricao: `A tag ficou fora de qualquer ambiente fechado; o local mais próximo é ${amb || '—'}`
        + `${ev && ev.segundoLocal ? `, seguido de ${ev.segundoLocal}` : ''}.`,
      acoes: ['aplicar', 'confirmar', 'manter', 'excluir'],
    }));
    if ((a.motivos || []).includes('vinculo_por_familia')) out.push(oc({
      ...base, regra: 'vinculo_familia', grupo: 'Local deduzido do plural da legenda', classe: 'provavel',
      atual: a.descricao,
      descricao: `A legenda escreve "${ev && ev.termoLegenda ? ev.termoLegenda : 'no plural'}" e este local entra nessa família`
        + `${(a.motivos || []).includes('lista_aberta') ? ' — a lista da legenda termina em "etc", então não é exaustiva' : ''}.`,
      acoes: ['confirmar', 'manter', 'excluir'],
    }));
    if ((a.motivos || []).includes('vinculo_geral')) out.push(oc({
      ...base, regra: 'vinculo_geral', grupo: 'Item de legenda sem local definido', classe: 'revisar',
      campo: 'localId', atual: a.descricao,
      descricao: `A legenda marca este item como "${a.localNome || 'geral'}" — precisa dizer em quais locais ele entra.`,
      acoes: ['aplicar', 'manter', 'excluir'],
    }));
    if ((a.motivos || []).includes('termo_sem_ambiente')) out.push(oc({
      ...base, regra: 'termo_sem_ambiente', grupo: 'Termo da legenda sem local correspondente', classe: 'revisar',
      campo: 'localId', atual: a.descricao,
      descricao: `A legenda cita "${a.localNome}", que não corresponde a nenhum local lido das pranchas.`,
      acoes: ['aplicar', 'manter', 'excluir'],
    }));

    /* 9b. órfão de verdade: nenhum motivo de vínculo explicou a falta do local.
       É a fila de triagem humana — agrupada aqui para receber atribuição em
       massa pelo mesmo seletor de Local das outras regras. */
    const MOTIVOS_VINCULO = ['tag_sem_ambiente', 'baixa_confianca', 'vinculo_por_proximidade',
      'vinculo_por_familia', 'vinculo_geral', 'termo_sem_ambiente'];
    if (!a.localId && !(a.motivos || []).some(m => MOTIVOS_VINCULO.includes(m))) out.push(oc({
      ...base, regra: 'sem_local', grupo: 'Especificação sem local', classe: 'revisar',
      campo: 'localId', atual: a.descricao || a.produto || '',
      descricao: a.localNome
        ? `O documento escreve "${a.localNome}", mas nenhum local lido das pranchas corresponde a esse texto.`
        : 'O item foi lido do documento sem nenhuma indicação de a qual local pertence.',
      acoes: ['aplicar', 'manter', 'excluir'],
    }));

    /* 9c. o que a leitura por imagem propôs com pouca certeza fica junto, para
       ser conferido de uma vez — a proveniência diz qual motor leu. */
    const motores = [...new Set((a.evidencias || []).map(x => (x.proveniencia || {}).motor_ia).filter(Boolean))];
    if (a.confianca === 'baixa' && motores.some(m => m && m !== 'fallback_vetorial' && m !== 'manual')
      && a.status !== 'confirmado' && a.status !== 'corrigido') out.push(oc({
      ...base, regra: 'leitura_por_imagem', grupo: 'Leitura por imagem a conferir', classe: 'revisar',
      atual: a.descricao || a.produto || '',
      descricao: `Este item não veio do texto vetorial da prancha: foi lido da imagem por ${motores.join(' · ')}.`
        + ' Confira o recorte no painel de evidências antes de exportar.',
      acoes: ['confirmar', 'manter', 'excluir'],
    }));

    // 10. dado sem respaldo documental
    if (!(a.evidencias || []).length) out.push(oc({
      ...base, regra: 'sem_respaldo', grupo: 'Informação sem respaldo documental', classe: 'insuficiente',
      atual: a.descricao,
      descricao: 'O item não aponta para nenhum documento, página ou recorte.',
      acoes: ['confirmar', 'manter', 'excluir'],
    }));

    // 11. dados incompatíveis
    if (a.categoria === 'Esquadrias' && txt(a.dimensao) && !/\d+\s*[x×]\s*\d+/i.test(a.dimensao)) out.push(oc({
      ...base, regra: 'dimensao_invalida', grupo: 'Dimensão em formato inválido', classe: 'provavel',
      campo: 'dimensao', atual: a.dimensao,
      descricao: `"${a.dimensao}" não está no formato largura x altura.`,
      acoes: ['manter'],
    }));
    if (txt(a.quantidade) && !/^\d+([.,]\d+)?$/.test(txt(a.quantidade))) out.push(oc({
      ...base, regra: 'quantidade_invalida', grupo: 'Quantidade não numérica', classe: 'provavel',
      campo: 'quantidade', atual: a.quantidade,
      descricao: `"${a.quantidade}" não é um número.`,
      acoes: ['manter'],
    }));
    if (a.categoria && a.sistema && incompativel(a.categoria, a.sistema)) out.push(oc({
      ...base, regra: 'sistema_incoerente', grupo: 'Sistema incompatível com a categoria', classe: 'provavel',
      campo: 'sistema', atual: a.sistema, sugerido: classe?.sistema || '',
      descricao: `Categoria ${a.categoria} com sistema "${a.sistema}".`,
      acoes: classe?.sistema ? ['aplicar', 'manter'] : ['manter'],
    }));
  }

  // 12. nomenclatura divergente entre ambientes
  for (let i = 0; i < ambientes.length; i++) for (let j = i + 1; j < ambientes.length; j++) {
    const a = ambientes[i], b = ambientes[j];
    if (a.nome === b.nome) continue;
    if ((a.pavimento || '') !== (b.pavimento || '')) continue;
    if (!semelhante(a.nome, b.nome)) continue;
    const manter = a.nome.length >= b.nome.length ? a : b;
    const trocar = manter === a ? b : a;
    out.push(oc({
      regra: 'nomenclatura', grupo: 'Divergência de nomenclatura', classe: 'provavel',
      alvo: 'ambiente', alvoId: trocar.id, ambiente: trocar.nome,
      campo: 'nome', atual: trocar.nome, sugerido: manter.nome,
      descricao: `"${a.nome}" e "${b.nome}" parecem o mesmo ambiente escrito de duas formas.`,
      acoes: ['aplicar', 'manter'],
      evidencia: refEv((trocar.evidencias || [])[0]),
    }));
  }

  // 13. cobertura do local: uma esquadria identificada não resolve o local
  const ESSENCIAIS = ['Piso', 'Paredes', 'Teto'];
  for (const a of ambientes) {
    const its = achados.filter(x => x.localId === a.id);
    if (!its.length) continue;
    for (const cat of ESSENCIAIS) {
      if (its.some(x => x.categoria === cat)) continue;
      /* a linha obrigatória vazia já mostra a falta na árvore e na planilha */
      if ((a.especificacoes || []).some(x => x.origemLeitura === 'obrigatoria' && x.categoria === cat && x.status !== 'excluido')) continue;
      out.push(oc({
        regra: 'sem_' + normalizar(cat), grupo: `Local sem ${cat.toLowerCase()} identificado`, classe: 'revisar',
        alvo: 'ambiente', alvoId: a.id, ambiente: a.nome,
        descricao: `${its.length} item(ns) levantado(s) neste local, nenhum de ${cat.toLowerCase()}.`
          + ` Procure a tag, a hachura ou a linha de legenda de ${cat.toLowerCase()} nas pranchas deste pavimento.`,
        acoes: ['manter'],
        evidencia: refEv((a.evidencias || [])[0]),
      }));
    }
  }

  // 14. ambiente sem nenhum acabamento levantado
  for (const a of ambientes) {
    if (achados.some(x => x.localId === a.id)) continue;
    out.push(oc({
      regra: 'ambiente_vazio', grupo: 'Local sem acabamento levantado', classe: 'revisar',
      alvo: 'ambiente', alvoId: a.id, ambiente: a.nome,
      descricao: 'Nenhuma tag, tabela ou trecho de memorial foi vinculado a este ambiente.',
      acoes: ['manter', 'excluir'],
      evidencia: refEv((a.evidencias || [])[0]),
    }));
  }

  return out;
}

/* Só entram aqui termos que nomeiam a superfície sem ambiguidade. Pintura,
   textura e verniz atravessam categorias (existe pintura de piso, de parede e
   de teto) e por isso ficam de fora: apontá-las geraria falso positivo. */
const GRUPO_CAT = {
  Piso: /\b(piso|pisos|rodape|rodapes|soleira|contrapiso)\b/,
  Teto: /\b(forro|forros|teto|tetos|tabica)\b/,
  Paredes: /\b(parede|paredes|azulejo|azulejos)\b/,
  'Louças': /\b(louca|loucas|bacia|cuba)\b/,
  Metais: /\b(torneira|torneiras|registro|registros|misturador)\b/,
};
function incompativel(categoria, sistema) {
  const re = GRUPO_CAT[categoria];
  if (!re) return false;
  const s = normalizar(sistema);
  if (re.test(s)) return false;
  for (const [cat, outro] of Object.entries(GRUPO_CAT)) {
    if (cat === categoria) continue;
    if (outro.test(s)) return true;
  }
  return false;
}
function semelhante(a, b) {
  const na = normalizar(a).replace(/\s/g, ''), nb = normalizar(b).replace(/\s/g, '');
  if (!na || !nb || na === nb) return na === nb;
  const curto = na.length < nb.length ? na : nb, longo = na.length < nb.length ? nb : na;
  if (longo.startsWith(curto) && longo.length - curto.length <= 2) return true;
  return mesmoAmbiente(a, b) && longo.startsWith(curto.slice(0, Math.max(4, curto.length - 2)));
}

/* ================= análise dos arquivos anexados ================= */

const NORMATIVA = /\b(dever[áãa]|deve|n[ãa]o deve|obrigat[óo]ri|necess[áa]rio|proibid|recomenda-se|exige-se|nunca)\b/i;

/**
 * Cruza o texto do manual e as linhas da planilha anexada com o que já foi
 * extraído das pranchas e memoriais. Mesmo formato de ocorrência.
 */
export function analisarArquivos(emp, { manual = [], planilha = [], nomeManual = 'Manual', nomePlanilha = 'Planilha' } = {}) {
  const out = [];
  const achados = especificacoesDe(emp);
  const ambientes = locaisDe(emp);
  const textoManual = manual.map(p => p.texto).join('\n');
  const normManual = normalizar(textoManual);

  // ---- planilha anexada x dados do projeto
  const aba = planilha[0] || { linhas: [] };
  let iCab = aba.linhas.findIndex(l => l.some(c => /ambiente|local|produto|descri/i.test(String(c))));
  if (iCab < 0) iCab = 0;
  const cab = (aba.linhas[iCab] || []).map(c => String(c).trim());
  const corpo = aba.linhas.slice(iCab + 1).filter(l => l.some(c => String(c).trim()));
  const col = termos => { for (let i = 0; i < cab.length; i++) if (termos.some(t => normalizar(cab[i]).includes(t))) return i; return -1; };
  const iAmb = col(['ambiente', 'local']), iDesc = col(['descri', 'produto', 'material']), iMarca = col(['marca']);

  corpo.forEach((l, n) => {
    const desc = txt(l[iDesc]), ambp = txt(l[iAmb]);
    const linha = `linha ${iCab + n + 2}`;
    if (!desc) return;
    const chave = normalizar(desc).slice(0, 24);
    const casa = achados.some(a => normalizar(a.descricao).includes(chave) || chave.includes(normalizar(a.descricao).slice(0, 24)));
    if (!casa) out.push(oc({
      regra: 'planilha_sem_respaldo', grupo: 'Informação da planilha sem respaldo documental', classe: 'revisar',
      alvo: 'planilha', alvoId: `pl${n}`, ambiente: ambp, atual: desc,
      descricao: `"${desc}" consta na planilha anexada e não foi encontrada em nenhuma prancha ou memorial processado.`,
      acoes: ['manter'],
      evidencia: { documento: nomePlanilha, pagina: linha },
    }));
    if (ambp && !ambientes.some(a => mesmoAmbiente(a.nome, ambp))) out.push(oc({
      regra: 'planilha_ambiente', grupo: 'Local da planilha não existe no projeto', classe: 'revisar',
      alvo: 'planilha', alvoId: `pa${normalizar(ambp).replace(/\s/g, '-')}`, ambiente: ambp,
      descricao: `A planilha cita o ambiente "${ambp}", que não foi lido de nenhuma prancha.`,
      acoes: ['manter'], evidencia: { documento: nomePlanilha, pagina: linha },
    }));
    if (iMarca >= 0 && !txt(l[iMarca])) out.push(oc({
      regra: 'planilha_sem_marca', grupo: 'Marca não identificada', classe: 'insuficiente',
      alvo: 'planilha', alvoId: `pm${n}`, ambiente: ambp, atual: desc,
      descricao: `A ${linha} da planilha anexada está sem marca.`,
      acoes: ['manter'], evidencia: { documento: nomePlanilha, pagina: linha },
    }));
  });

  // ---- manual x projeto
  if (textoManual) {
    for (const a of ambientes) {
      if (normManual.includes(normalizar(a.nome))) continue;
      out.push(oc({
        regra: 'manual_sem_ambiente', grupo: 'Local ausente no manual', classe: 'revisar',
        alvo: 'ambiente', alvoId: a.id, ambiente: a.nome,
        descricao: `O ambiente "${a.nome}" foi lido da prancha e não é citado no manual.`,
        acoes: ['manter'], evidencia: { documento: nomeManual, pagina: '—' },
      }));
    }
    const frases = textoManual.split(/(?:[.;:])\s+/).filter(f => f.length > 40 && f.length < 320 && NORMATIVA.test(f));
    const vistos = new Set();
    frases.forEach((f, i) => {
      const alvo = termoTecnico(f);
      if (!alvo || vistos.has(alvo)) return;
      vistos.add(alvo);
      const coberto = achados.some(a => normalizar([a.descricao, a.produto, a.sistema].join(' ')).includes(alvo));
      if (coberto) return;
      const pag = manual.find(p => p.texto.includes(f.slice(0, 40)));
      out.push(oc({
        regra: 'manual_regra', grupo: 'Regra do manual sem item correspondente', classe: 'revisar',
        alvo: 'manual', alvoId: `mr${i}`, ambiente: '',
        descricao: `O manual determina algo sobre "${alvo}" e nenhum item levantado corresponde: "${f.trim().slice(0, 180)}"`,
        acoes: ['manter'],
        evidencia: { documento: nomeManual, pagina: pag ? pag.pagina : '—' },
      }));
    });
  }
  return out;
}

const TERMOS = ['porcelanato', 'rejunte', 'rodape', 'forro de gesso', 'pintura', 'textura', 'granito', 'marmore',
  'bancada', 'soleira', 'peitoril', 'esquadria', 'vidro', 'impermeabiliza', 'louca', 'laminado',
  'deck', 'pastilha', 'azulejo', 'cimento queimado', 'papel de parede', 'persiana', 'guarda corpo'];
function termoTecnico(frase) {
  const n = normalizar(frase);
  return TERMOS.find(t => n.includes(t)) || null;
}

/* ================= agrupamento e resumo ================= */

export function agrupar(ocorrencias, resolvidas = {}) {
  const g = new Map();
  for (const o of ocorrencias) {
    const estado = resolvidas[o.id];
    const item = { ...o, resolvida: estado ? estado.estado : '' };
    if (!g.has(o.regra)) g.set(o.regra, { regra: o.regra, grupo: o.grupo, classe: o.classe, itens: [] });
    g.get(o.regra).itens.push(item);
  }
  return [...g.values()]
    .map(x => ({ ...x, abertas: x.itens.filter(i => !i.resolvida).length }))
    .sort((a, b) => (CLASSES[a.classe].ordem - CLASSES[b.classe].ordem) || (b.abertas - a.abertas));
}

export function resumo(ocorrencias, resolvidas = {}) {
  const c = { erro: 0, conflito: 0, provavel: 0, revisar: 0, insuficiente: 0 };
  let abertas = 0;
  for (const o of ocorrencias) {
    if (resolvidas[o.id]) continue;
    abertas++; c[o.classe] = (c[o.classe] || 0) + 1;
  }
  return { ...c, abertas, total: ocorrencias.length, resolvidas: ocorrencias.length - abertas };
}
