/* HTTP — erro padrão das chamadas à API (status + mensagem + erros por campo) */

export class ErroApi extends Error {
  constructor(status, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.campos = campos ?? null;
  }
}
