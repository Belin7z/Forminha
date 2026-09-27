/* PÁGINA — favoritos do cliente */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { estado } from "../nucleo/estado.js";
import { cartaoProduto } from "../componentes/cartao-produto.js";
import { ligarProdutos } from "../componentes/acoes-produto.js";

export function favoritos(ctx) {
  if (!estado.usuario) {
    montar(ctx.raiz, html`
      <section class="container pagina-simples">
        <div class="vazio"><span class="vazio__ico">${icone("coracao", { tamanho: 38 })}</span><h3>Seus favoritos ficam guardados aqui</h3>
          <p>Entre na sua conta para salvar os doces que você mais ama e pedir de novo em segundos.</p>
          <a href="#/entrar?voltar=%2Ffavoritos" class="btn btn--primario">Entrar</a>
          <p><a href="#/cadastrar?voltar=%2Ffavoritos" class="link">Criar minha conta</a></p></div>
      </section>`);
    return;
  }

  const lista = estado.produtos.filter((p) => estado.favoritos.has(p.id));
  montar(ctx.raiz, html`
    <section class="container pagina-cardapio">
      <header class="pagina-cab"><h1>Meus <span class="script">favoritos</span></h1></header>
      ${lista.length
        ? html`<div class="grade-produtos">${lista.map((p, i) => cartaoProduto(p, i))}</div>`
        : html`<div class="vazio"><span class="vazio__ico">${icone("coracao", { tamanho: 38 })}</span><h3>Nenhum favorito ainda</h3>
            <p>Toque no coração dos doces que você mais gosta para guardá-los aqui.</p>
            <a href="#/cardapio" class="btn btn--primario">Explorar o cardápio</a></div>`}
    </section>`);
  return ligarProdutos(ctx.raiz, ctx);
}
