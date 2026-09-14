import {PDFDocument, StandardFonts, rgb} from '/home/claude/.npm-global/lib/node_modules/pdf-lib/cjs/index.js';
import fs from 'fs';
const linhas=[
 ['MEMORIAL DESCRITIVO DE ACABAMENTOS',14,1],
 ['Residência Alexandre Pompeo — Revisão 01',10,0],
 ['',10,0],
 ['COZINHA',12,1],
 ['Piso: porcelanato Flakes SBE NAT 120x120 cm, assentado com junta seca. Marca: Ceusa',10,0],
 ['Paredes: pintura látex acrílica acetinada, cor a definir. Marca: Suvinil',10,0],
 ['Teto: forro de gesso acartonado novo com pintura acrílica branca e tabica metálica',10,0],
 ['Bancada: granito preto absoluto polido, espessura 3 cm. Marca: Marmoraria Dimagra',10,0],
 ['Metais: misturador monocomando de bancada. Marca: Deca',10,0],
 ['',10,0],
 ['ÁREA PETS',12,1],
 ['Piso: porcelanato para área externa, acabamento antiderrapante. Marca: Portobello',10,0],
 ['Paredes: textura Beton Areia de Rio, aplicada sobre reboco. Marca: Mr. Lime',10,0],
 ['Esquadrias: porta de alumínio com pintura em padrão amadeirado. Marca: Zeloart',10,0],
 ['',10,0],
 ['BANHO 01',12,1],
 ['Piso: mármore branco polido. Marca: Marmoraria Dimagra',10,0],
 ['Louças: cuba de embutir em louça branca. Marca: Kohler',10,0],
 ['Metais: chuveiro de teto em acabamento cromado. Marca: Deca',10,0],
 ['',10,0],
 ['LAVANDERIA',12,1],
 ['Piso: piso de madeira maciça de cumaru, tábua corrida envernizada. Marca: Indusparquet',10,0],
 ['Paredes: pintura látex acrílica lavável, cor branco neve. Marca: Suvinil',10,0],
 ['',10,0],
 ['Q.SERVICO',12,1],
 ['Piso: porcelanato acetinado 60x60. Marca: Portobello. Modelo: Bold Concreto',10,0],
 ['Teto: forro de gesso liso com pintura acrilica branca. Fornecedor: Gesso Sul',10,0],
];
const doc=await PDFDocument.create();
const f=await doc.embedFont(StandardFonts.Helvetica);
const fb=await doc.embedFont(StandardFonts.HelveticaBold);
let page=doc.addPage([595,842]); let y=790;
for(const [t,s,b] of linhas){
  if(y<60){page=doc.addPage([595,842]);y=790;}
  if(t) page.drawText(t,{x:56,y,size:s,font:b?fb:f,color:rgb(0.1,0.1,0.12)});
  y-=s+8;
}
fs.writeFileSync('testdata/MEMORIAL.pdf', await doc.save());
console.log('memorial gerado');
