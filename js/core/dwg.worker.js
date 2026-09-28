/* Worker de leitura de DWG: recebe os bytes, roda o libredwg (WebAssembly)
   e a montagem das folhas fora da thread da tela, e devolve as páginas
   empacotadas em arrays tipados (transferidos, não copiados). O código é o
   mesmo de js/core/dwg.js — aqui só mora a ponte de mensagens. */

import { lerEEmpacotar } from './dwg.js';

self.onmessage = async (ev) => {
  const { bytes } = ev.data || {};
  try {
    const { pacote, buffers } = await lerEEmpacotar(new Uint8Array(bytes), (progresso) => self.postMessage({ progresso }));
    self.postMessage({ pacote }, buffers);
  } catch (err) {
    self.postMessage({ erro: err && err.message ? err.message : String(err) });
  }
};
