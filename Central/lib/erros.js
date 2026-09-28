/* Erro com status HTTP e texto claro para a tela (campos = qual campo do formulário está errado). */
export class ErroHttp extends Error {
  constructor(status, mensagem, campos = null) { super(mensagem); this.status = status; this.campos = campos; }
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
