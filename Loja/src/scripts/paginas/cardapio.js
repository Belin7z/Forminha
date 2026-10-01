/* PÁGINA — cardápio: filtros por categoria, busca, ordenação e "só favoritos" */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { plural } from "/src/scripts/base/formatacao.js";
import { toast } from "/src/scripts/base/ui.js";
import { estado } from "../nucleo/estado.js";
import { precoInicial, produtoPorId } from "../nucleo/catalogo.js";
import { aplicarSeo, aplicarSeoDoProduto } from "../nucleo/seo.js";
import { cartaoProduto } from "../componentes/cartao-produto.js";
import { ligarProdutos } from "../componentes/acoes-produto.js";
import { abrirProduto } from "../componentes/modal-produto.js";

const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Link próprio do produto: o cardápio com a janela do produto já aberta.
 * Ao fechar a janela, o endereço volta a ser o do cardápio.
 */
export function paginaDoProduto(ctx) {
  const desligar = cardapio(ctx);
  const p = produtoPorId(ctx.params.id);
  if (!p) {
    toast("Este produto não está mais disponível. Veja o cardápio.", "info");
    history.replaceState(null, "", "#/cardapio");
    return desligar;
  }
  history.replaceState(null, "", `#/produto/${p.id}`); // o cardápio acerta o endereço ao abrir; enquanto o produto está aberto, é o dele
  aplicarSeoDoProduto(estado.config, p);
  abrirProduto(p.id, ctx, {
    aoFechar: () => {
      aplicarSeo(estado.config);
      if (ctx.ativo()) history.replaceState(null, "", "#/cardapio");
    },
  });
  return desligar;
}

export function cardapio(ctx) {
  // cardápio novo, ainda sem produtos: nada de busca e filtros vazios
  if (!estado.produtos.length) {
    montar(ctx.raiz, html`
      <section class="container pagina-cardapio">
        <header class="pagina-cab">
          <h1>Nosso <span class="script">cardápio</span></h1>
        </header>
        <div class="vazio vazio--largo">
          <span class="vazio__ico">${icone("sacola", { tamanho: 38 })}</span>
          <h3>O cardápio está chegando</h3>
          <p>Em breve os produtos aparecem aqui. Enquanto isso, fale com a loja para encomendar.</p>
          <div class="linha-flex linha-flex--centro">
            <a href="#/contato" class="btn btn--primario">Falar com a loja</a>
            ${estado.config.orcamento?.ativo !== false && html`<a href="#/orcamento" class="btn btn--contorno">Pedir orçamento</a>`}
          </div>
        </div>
      </section>`);
    return;
  }

  let categoria = Number(ctx.consulta.cat) || 0; // 0 = todas
  let busca = ctx.consulta.q ?? "";
  let ordem = ctx.consulta.ordem ?? "padrao";
  let soFavoritos = ctx.consulta.fav === "1";

  const contar = (id) => estado.produtos.filter((p) => p.categoria_id === id).length;

  montar(ctx.raiz, html`
    <section class="container pagina-cardapio">
      <header class="pagina-cab">
        <h1>Nosso <span class="script">cardápio</span></h1>
        <p class="texto-suave">Escolha, personalize e finalize em poucos cliques.${estado.config.orcamento?.ativo !== false && html` Não achou o que queria? <a href="#/orcamento" class="link">Peça um orçamento</a>.`}</p>
      </header>

      <div class="ferramentas">
        <div class="busca">
          ${icone("busca", { tamanho: 18 })}
          <input type="search" id="busca" placeholder="Buscar no cardápio…" value="${busca}" aria-label="Buscar no cardápio" autocomplete="off">
        </div>
        <select id="ordem" class="entrada ferramentas__ordem" aria-label="Ordenar por">
          <option value="padrao">Ordem da casa</option>
          <option value="menor">Menor preço</option>
          <option value="maior">Maior preço</option>
          <option value="nome">Nome (A–Z)</option>
          <option value="vendidos">Mais pedidos</option>
        </select>
        <button type="button" class="btn btn--contorno" id="so-fav" data-acao="fav" aria-pressed="false">${icone("coracao", { tamanho: 17 })} Só favoritos</button>
      </div>

      <div class="chips" id="chips" role="tablist" aria-label="Categorias"></div>

      <p class="resultado texto-suave" id="resultado" aria-live="polite"></p>
      <div class="grade-produtos" id="grade"></div>
    </section>`);

  const $ = (s) => ctx.raiz.querySelector(s);
  $("#ordem").value = ordem;

  function filtrar() {
    const termo = semAcento(busca.trim());
    let lista = estado.produtos.filter((p) => {
      if (categoria && p.categoria_id !== categoria) return false;
      if (soFavoritos && !estado.favoritos.has(p.id)) return false;
      return !termo || semAcento(`${p.nome} ${p.descricao} ${p.tag ?? ""}`).includes(termo);
    });
    const por = {
      menor: (a, b) => precoInicial(a).preco - precoInicial(b).preco,
      maior: (a, b) => precoInicial(b).preco - precoInicial(a).preco,
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      vendidos: (a, b) => b.vendidos - a.vendidos,
    }[ordem];
    if (por) lista = [...lista].sort(por);
    return lista;
  }

  function desenharChips() {
    montar($("#chips"), html`
      <button type="button" class="chip ${!categoria && "chip--ativo"}" data-acao="cat" data-id="0" role="tab" aria-selected="${String(!categoria)}">Todos <small>${estado.produtos.length}</small></button>
      ${estado.categorias.map((c) => html`
        <button type="button" class="chip ${categoria === c.id && "chip--ativo"}" data-acao="cat" data-id="${c.id}" role="tab" aria-selected="${String(categoria === c.id)}">
          ${c.icone && icone(c.icone, { tamanho: 16 })} ${c.nome} <small>${contar(c.id)}</small></button>`)}`);
  }

  function desenharGrade() {
    const lista = filtrar();
    $("#resultado").textContent = plural(lista.length, "item encontrado", "itens encontrados");
    $("#so-fav").classList.toggle("btn--primario", soFavoritos);
    $("#so-fav").classList.toggle("btn--contorno", !soFavoritos);
    $("#so-fav").setAttribute("aria-pressed", String(soFavoritos));

    montar($("#grade"), lista.length
      ? html`${lista.map((p, i) => cartaoProduto(p, i))}`
      : html`<div class="vazio vazio--largo"><span class="vazio__ico">${icone(soFavoritos ? "coracao" : "busca", { tamanho: 38 })}</span>
          <h3>${soFavoritos ? "Você ainda não tem favoritos aqui" : "Nada encontrado"}</h3>
          <p>${soFavoritos ? "Toque no coração dos doces que você mais gosta para guardá-los." : "Tente outra palavra ou escolha outra categoria."}</p>
          <button type="button" class="btn btn--primario" data-acao="limpar">Limpar filtros</button></div>`);
  }

  function sincronizarUrl() {
    const q = new URLSearchParams();
    if (categoria) q.set("cat", categoria);
    if (busca.trim()) q.set("q", busca.trim());
    if (ordem !== "padrao") q.set("ordem", ordem);
    if (soFavoritos) q.set("fav", "1");
    history.replaceState(null, "", `#/cardapio${q.size ? "?" + q : ""}`);
  }

  const atualizar = () => { desenharChips(); desenharGrade(); sincronizarUrl(); };

  delegar(ctx.raiz, {
    cat: (el) => { categoria = Number(el.dataset.id); atualizar(); },
    fav: () => { soFavoritos = !soFavoritos; atualizar(); },
    limpar: () => { categoria = 0; busca = ""; ordem = "padrao"; soFavoritos = false; $("#busca").value = ""; $("#ordem").value = "padrao"; atualizar(); },
  });
  $("#busca").addEventListener("input", (ev) => { busca = ev.target.value; desenharGrade(); sincronizarUrl(); });
  $("#ordem").addEventListener("change", (ev) => { ordem = ev.target.value; desenharGrade(); sincronizarUrl(); });

  atualizar();
  return ligarProdutos(ctx.raiz, ctx);
}
