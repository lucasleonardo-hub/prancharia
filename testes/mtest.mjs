/* Fidelidade da migração: nenhum campo do formato antigo pode se perder
   na conversão para a árvore de locais. Roda sem navegador. */
import * as M from './js/core/model.js';

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  FALHOU:', msg); } };

/* ---------- projeto antigo com todos os campos populados ---------- */
const antigo = {
  id: 'emp_legado', nome: '21003 — Alexandre Pompeo', tipo: 'casa',
  criadoEm: '2026-01-02T10:00:00.000Z', atualizadoEm: '2026-03-04T11:00:00.000Z',
  endereco: 'Rua X, 123', localizacao: 'Florianópolis / SC',
  responsavel: 'Letícia', observacoes: 'obs',
  dados: { pavimentos: '4' },
  estrutura: { grupo: [{ id: 'g1', nome: 'Torre A' }], tipologia: [{ id: 't1', nome: '2 dorm' }], unidade: [], pavimento: [{ id: 'p1', nome: 'TÉRREO' }] },
  niveisExtras: ['unidade'], niveisDesligados: ['grupo'],
  documentos: [{ id: 'doc1', nome: 'EX01.pdf' }],
  legendas: [{ documentoId: 'doc1', blocos: [] }],
  tabelas: [{ documentoId: 'doc1', tipo: 'esquadrias' }],
  marcas: [{ nome: 'Portobello' }], fornecedores: [{ nome: 'Loja' }],
  auditorias: [{ id: 'aud1' }], revisoes: { 'oc:x': { estado: 'mantido' } },
  historico: [{ id: 'h1', quando: '2026-01-02T10:00:00.000Z', texto: 'criado', tipo: 'empreendimento' }],
  tipologias: [{ id: 'tv', nome: 'legado' }],
  ambientes: [
    {
      id: 'amb1', nome: 'B.SERVIÇO', area: '2.11m²', pavimento: 'SUBSOLO',
      tipologia: '2 dorm', grupoId: 'g1', tipologiaId: 't1', unidadeId: null, pavimentoId: 'p1',
      areaComum: true, origem: 'rotulo', confianca: 'alta', status: 'confirmado',
      evidencias: [{ documentoId: 'doc1', documento: 'EX01.pdf', pagina: 1, caixa: [10, 20, 30, 40], texto: 'B.SERVIÇO 2.11m²', tipo: 'rotulo' }],
    },
    { id: 'amb2', nome: 'EXCLUÍDO', status: 'excluido', evidencias: [] },
  ],
  achados: [
    {
      id: 'ach1', tipo: 'tag', ambienteId: 'amb1', ambienteNome: 'B.SERVIÇO', pavimento: 'SUBSOLO',
      categoria: 'Revestimentos em Pedras Naturais', nomeProduto: 'Soleira',
      sistema: 'Soleiras, peitoris e pingadeiras', descricao: 'SO01 — Soleira em travertino romano — 89 x 24 x 2 cm',
      marca: 'Marca X', modelo: 'Mod 1', fornecedor: 'Forn 1',
      codigo: 'SO01', forma: 'quadrado', numero: '08',
      dimensao: '89 x 24 x 2', peitoril: '1.10', quantidade: '3',
      status: 'conflito', confianca: 'baixa',
      motivos: ['vinculo_por_familia', 'lista_aberta'],
      divergencias: [{ documento: 'EX05.pdf', pagina: 1, descricao: 'outra leitura' }],
      chave: 'amb1|Revestimentos em Pedras Naturais|SO01',
      fontes: [
        { documentoId: 'doc1', documento: 'EX01.pdf', pagina: 1, caixa: [100, 100, 200, 200], tagCaixa: [140, 140, 160, 160], legendaCaixa: [500, 500, 700, 512], legendaBlocoCaixa: [490, 400, 720, 600], tituloLegenda: 'PISOS', texto: 'Quadrado 08', cadeia: ['B.SERVIÇO', 'Quadrado 08', 'PISOS', 'SO01', 'Piso'] },
        { documentoId: 'doc2', documento: 'Memorial.pdf', pagina: 24, caixa: [1, 2, 3, 4], tituloLegenda: 'Memorial descritivo', texto: 'Marca: Portobello' },
      ],
    },
    {
      id: 'ach2', tipo: 'tabela', ambienteId: null, ambienteNome: 'não identificado',
      categoria: 'Esquadrias', nomeProduto: 'Porta', descricao: 'PA5 — 6,88x2,70 m',
      codigo: 'PA5', dimensao: '6,88x2,70', quantidade: '1',
      status: 'revisar', confianca: 'baixa', motivos: ['incompleto'],
      fontes: [{ documentoId: 'doc1', documento: 'EX01.pdf', pagina: 1, caixa: [5, 5, 9, 9] }],
    },
    { id: 'ach3', ambienteId: 'amb1', status: 'excluido', categoria: 'Piso', descricao: 'apagado' },
  ],
};

const original = JSON.parse(JSON.stringify(antigo));

/* ---------- 1. migrarParaLocais preserva o empreendimento ---------- */
console.log('\n1. campos do empreendimento');
const novo = M.migrarParaLocais(antigo);
for (const campo of ['id', 'nome', 'tipo', 'criadoEm', 'atualizadoEm', 'endereco', 'localizacao',
  'responsavel', 'observacoes', 'niveisExtras', 'niveisDesligados']) {
  ok(JSON.stringify(novo[campo]) === JSON.stringify(original[campo]), `${campo}: ${JSON.stringify(novo[campo])}`);
}
for (const campo of ['dados', 'estrutura', 'documentos', 'legendas', 'tabelas', 'marcas',
  'fornecedores', 'auditorias', 'revisoes', 'historico']) {
  ok(JSON.stringify(novo[campo]) === JSON.stringify(original[campo]), `${campo} não preservado`);
}
ok(novo.empresaId === null, 'empresaId deve existir como vínculo vazio');
ok(Array.isArray(novo.especificacoesSemLocal), 'especificacoesSemLocal deve existir');

/* ---------- 2. o Local guarda tudo ---------- */
console.log('2. campos do local');
ok(novo.locais.length === 2, `locais: ${novo.locais.length} (o excluído continua, com status)`);
ok(novo.locais[1].status === 'excluido' && novo.locais[1].statusAuditoria === 'excluido', 'local excluído preserva o status');
const l = novo.locais[0];
const a0 = original.ambientes[0];
ok(l.id === a0.id, 'id do local preservado');
ok(l.nome === a0.nome && l.area === a0.area && l.pavimento === a0.pavimento, 'nome/área/pavimento');
ok(l.areaComum === true, 'areaComum (separação MC/MP)');
ok(l.tipologia === a0.tipologia && l.grupoId === a0.grupoId && l.tipologiaId === a0.tipologiaId
  && l.pavimentoId === a0.pavimentoId, 'posição na hierarquia do tipo');
ok(l.status === 'confirmado' && l.statusAuditoria === 'confirmado', 'status e statusAuditoria');
ok(l.confianca === 'alta' && l.origem === 'rotulo', 'confiança e origem');
ok(l.evidencias.length === 1, 'evidência do rótulo (âncora do Nível 2)');
ok(JSON.stringify(l.evidencias[0].coordenadas) === JSON.stringify(a0.evidencias[0].caixa), 'caixa do rótulo');
ok(l.evidencias[0].tipo === 'rotulo', 'tipo da evidência do rótulo');
ok(JSON.stringify(l.poligonoOriginal) === JSON.stringify(a0.evidencias[0].caixa), 'poligonoOriginal para o fallback do pdf.js');

/* ---------- 3. a Especificação guarda tudo ---------- */
console.log('3. campos da especificação');
ok(l.especificacoes.length === 2, `especificações no local: ${l.especificacoes.length} (inclui a excluída, com status)`);
ok(l.especificacoes[1].status === 'excluido', 'especificação excluída preserva o status');
const esp = l.especificacoes[0];
const ac = original.achados[0];
ok(esp.id === ac.id, 'id preservado (chave de referência)');
ok(esp.categoria === 'Revestimentos em Pedras Naturais', `categoria exata: "${esp.categoria}"`);
ok(esp.produto === ac.nomeProduto, 'produto');
ok(esp.sistema === ac.sistema, 'sistema construtivo');
ok(esp.descricao === ac.descricao, 'descrição original preservada junto do produto');
ok(esp.marca === ac.marca && esp.modelo === ac.modelo && esp.fornecedor === ac.fornecedor, 'marca/modelo/fornecedor');
ok(esp.codigoOrigem === 'quadrado 08', `codigoOrigem: "${esp.codigoOrigem}"`);
ok(esp.forma === ac.forma && esp.numero === ac.numero, 'forma e número (materiais diferentes)');
ok(esp.dimensao === ac.dimensao && esp.peitoril === ac.peitoril && esp.quantidade === ac.quantidade, 'dimensão/peitoril/quantidade');
ok(esp.status === 'conflito' && esp.confianca === 'baixa', 'status e confiança');
ok(JSON.stringify(esp.motivos) === JSON.stringify(ac.motivos), 'motivos (agrupamento da revisão em massa)');
ok(JSON.stringify(esp.divergencias) === JSON.stringify(ac.divergencias), 'divergências (as duas leituras do conflito)');
ok(esp.chave === ac.chave, 'chave de merge');
ok(esp.localId === l.id && esp.localNome === l.nome && esp.pavimento === 'SUBSOLO', 'vínculo com o local');

console.log('4. evidências e proveniência');
ok(esp.evidencias.length === 2, `duas fontes → duas evidências: ${esp.evidencias.length}`);
const e1 = esp.evidencias[0];
ok(e1.documentoOrigem.docId === 'doc1' && e1.documentoOrigem.pagina === 1 && e1.documentoOrigem.nomeDoc === 'EX01.pdf', 'documentoOrigem');
ok(JSON.stringify(e1.coordenadas) === JSON.stringify(ac.fontes[0].tagCaixa), 'Nível 3: zoom exato');
ok(JSON.stringify(e1.regiao) === JSON.stringify(ac.fontes[0].caixa), 'Nível 2: região');
ok(JSON.stringify(e1.legendaCoordenadas) === JSON.stringify(ac.fontes[0].legendaCaixa), 'linha da legenda');
ok(JSON.stringify(e1.legendaBloco) === JSON.stringify(ac.fontes[0].legendaBlocoCaixa), 'bloco da legenda');
ok(e1.tituloLegenda === 'PISOS' && e1.texto === 'Quadrado 08', 'título da legenda e texto de origem');
ok(JSON.stringify(e1.cadeia) === JSON.stringify(ac.fontes[0].cadeia), 'cadeia de interpretação');
ok(e1.proveniencia.motor_ia === 'legado_vetorial' && e1.proveniencia.confianca === 'baixa', 'proveniência');

/* ---------- 5. órfão vai para especificacoesSemLocal ---------- */
console.log('5. itens sem local');
ok(novo.especificacoesSemLocal.length === 1, `sem local: ${novo.especificacoesSemLocal.length}`);
const orfa = novo.especificacoesSemLocal[0];
ok(orfa.id === 'ach2' && orfa.codigoOrigem === 'PA5', 'órfão preservado com o seu código');
ok(orfa.localId === null, 'órfão sem localId');
ok(orfa.categoria === 'Esquadrias' && orfa.dimensao === '6,88x2,70', 'campos do órfão');

/* ---------- 6. nada se perde na conta ---------- */
console.log('6. contagem');
const total = M.todasEspecificacoes(novo).length;
ok(total === original.achados.length, `achados ${original.achados.length} → especificações ${total} (nada descartado)`);
const vivos = M.todasEspecificacoes(novo).filter(x => x.status !== 'excluido').length;
ok(vivos === original.achados.filter(a => a.status !== 'excluido').length, `vivos preservados: ${vivos}`);

/* ---------- 7. migrar converte o legado e apaga as listas ---------- */
console.log('7. migração: a árvore é a única verdade');
const emp2 = M.migrar(JSON.parse(JSON.stringify(original)));
ok(emp2.locais.length === 2 && M.todasEspecificacoes(emp2).length === 3, 'árvore com todos os itens');
ok(emp2.ambientes === undefined && emp2.achados === undefined && emp2.tags === undefined,
  `listas antigas apagadas do objeto: ambientes=${emp2.ambientes} achados=${emp2.achados} tags=${emp2.tags}`);
const serial = JSON.stringify(emp2);
ok(!serial.includes('"ambientes"') && !serial.includes('"achados"'), 'nada de legado no JSON gravado');
ok(!serial.includes('"nomeProduto"') && !serial.includes('"ambienteId"') && !serial.includes('"fontes"'),
  'nenhum apelido antigo no JSON gravado');
ok(emp2.locais[0].especificacoes[0].produto !== undefined, 'a especificação responde pelo nome novo');
ok(emp2.locais[0].especificacoes[0].nomeProduto === undefined, 'e não responde mais pelo antigo');
/* migrar de novo é idempotente: quem já tem árvore não é reconvertido */
const emp2b = M.migrar(JSON.parse(JSON.stringify(emp2)));
ok(emp2b.locais.length === 2 && M.todasEspecificacoes(emp2b).length === 3, 'migração idempotente');
ok(emp2.estrutura.tipologia.length === 1, 'estrutura preservada');
ok(!emp2.tipologias, 'tipologias legado migrada para estrutura');

/* ---------- 8. histórico nos dois formatos ---------- */
console.log('8. histórico');
const emp3 = M.empreendimentoVazio('teste', 'casa');
M.registrarHistorico(emp3, { texto: 'Item confirmado', tipo: 'revisao', antes: 'a', depois: 'b', alvo: 'x' });
M.registrarHistorico(emp3, 'texto solto');
const h0 = emp3.historico[1], h1 = emp3.historico[0];
ok(h0.texto === 'Item confirmado' && h0.tipo === 'revisao' && h0.antes === 'a' && h0.depois === 'b', 'forma rica');
ok(!!h0.quando && !!h0.data && h0.motivo === 'Item confirmado', 'quando/data e motivo como apelidos');
ok(h1.texto === 'texto solto' && h1.tipo === 'evento', 'forma de string');

/* ---------- 9. novoId sem colisão ---------- */
console.log('9. novoId');
const ids = new Set(); for (let i = 0; i < 50000; i++) ids.add(M.novoId('esp'));
ok(ids.size === 50000, `50000 ids únicos: ${ids.size}`);
ok(/^esp_[a-z0-9]+$/.test(M.novoId('esp')), 'formato do id');

/* ---------- 10. comparação de nomes ---------- */
console.log('10. comparação de nomes');
ok(M.mesmoAmbienteFlex('B.SERVIÇO', 'B SERVIÇO'), 'pontuação');
ok(M.mesmoAmbienteFlex('BANHO 02', 'banho 2'), 'zero à esquerda');
ok(!M.mesmoAmbienteFlex('COZINHA', 'BANHO 01'), 'não casa o que é diferente');
const ambs = [{ id: '1', nome: 'B.SERVIÇO', pavimento: 'SUBSOLO' }, { id: '2', nome: 'BANHO 01', pavimento: 'TÉRREO' }];
const casos = M.casarAmbientes('banhos', ambs, ['SUBSOLO', 'TÉRREO']);
ok(casos.length === 2, `"banhos" alcança os dois: ${casos.map(c => c.ambiente.nome + '/' + c.forca).join(', ')}`);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODAS AS VERIFICAÇÕES PASSARAM');
process.exit(falhas ? 1 : 0);
