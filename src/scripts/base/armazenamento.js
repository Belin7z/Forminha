/* ARMAZENAMENTO — localStorage à prova de falhas (navegação privada, cota cheia…) */
export const armazenamento = {
  ler(chave, padrao = null) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto === null ? padrao : JSON.parse(bruto);
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem persistência */ }
  },
  remover(chave) {
    try { localStorage.removeItem(chave); } catch { /* ignora */ }
  },
};
