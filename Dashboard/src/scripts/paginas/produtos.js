/* PÁGINA — produtos: lista com busca e filtros, liga/desliga rápido, edição completa e exclusão */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, toast } from "/src/scripts/base/ui.js";
import { brl, plural } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";
import { abrirFormProduto } from "../componentes/form-produto.js";

const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function produtos(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let lista, categorias;
  try {
    [{ produtos: lista }, { categorias }] = await Promise.all([api.get("/produtos"), api.get("/categorias")]);
  } catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  const f = { busca: "", categoria: 0, situacao: "todos" };

  montar(ctx.raiz, html`
    ${cabecalhoPagina({
      titulo: "Produtos", descricao: "Seu cardápio: preços, fotos, opções e disponibilidade.",
      acoes: html`<button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo produto</button>`,
    })}
    <div class="filtros-barra">
      <div class="busca"><input type="search" id="busca" placeholder="Buscar produto…" aria-label="Buscar produto" autocomplete="off">${icone("busca", { tamanho: 18 })}</div>
      <select id="filtro-cat" class="entrada entrada--auto" aria-label="Categoria">
        <option value="0">Todas as categorias</option>
        ${categorias.map((c) => html`<option value="${c.id}">${c.nome}</option>`)}
      </select>
      <select id="filtro-sit" class="entrada entrada--auto" aria-label="Situação">
        <option value="todos">Todos</option><option value="ativos">Disponíveis</option><option value="inativos">Ocultos</option>
      </select>
    </div>
    <div id="resultado"></div>`);

  const $ = (s) => ctx.raiz.querySelector(s);
  const categoriaDe = (id) => categorias.find((c) => c.id === id);

  function filtrados() {
    const termo = semAcento(f.busca);
    return lista.filter((p) =>
      (!f.categoria || p.categoria_id === f.categoria) &&
      (f.situacao === "todos" || (f.situacao === "ativos") === p.ativo) &&
      (!termo || semAcento(`${p.nome} ${p.descricao} ${p.tag ?? ""}`).includes(termo)));
  }

  function desenhar() {
    const itens = filtrados();
    if (!lista.length) {
      montar($("#resultado"), vazio("bolo", "Seu cardápio está vazio", "Cadastre o primeiro produto para ele aparecer na loja.", html`<button type="button" class="btn btn--primario" data-acao="novo">Novo produto</button>`));
      return;
    }
    montar($("#resultado"), itens.length ? html`
      <p class="texto-suave resultado-contagem">${plural(itens.length, "produto")}</p>
      <div class="cartao cartao--sem-margem"><div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Produto</th><th>Categoria</th><th class="texto-direita">Preço</th><th class="texto-direita">Vendidos</th><th class="texto-direita">Favoritos</th><th>Na loja</th><th>Destaque</th><th></th></tr></thead>
        <tbody>${itens.map((p) => html`<tr class="${!p.ativo && "linha-inativa"}">
          <td><div class="produto-celula">
            <span class="produto-celula__img">${p.imagem ? html`<img src="${p.imagem}" alt="">` : icone(categoriaDe(p.categoria_id)?.icone || "bolo", { tamanho: 22 })}</span>
            <div><strong>${p.nome}</strong>${p.tag && html` <span class="badge">${p.tag}</span>`}
              <small class="texto-suave">${p.unidade}${p.min_qtd > 1 ? ` · mín. ${p.min_qtd}` : ""}${p.opcoes.length ? ` · ${plural(p.opcoes.length, "grupo")} de opções` : ""}${p.antecedencia_horas != null ? ` · ${p.antecedencia_horas}h antec.` : ""}</small></div></div></td>
          <td>${categoriaDe(p.categoria_id) ? categoriaDe(p.categoria_id).nome : "—"}</td>
          <td class="texto-direita"><strong>${brl(p.preco)}</strong></td>
          <td class="texto-direita">${p.vendidos}</td>
          <td class="texto-direita">${p.favoritos}</td>
          <td><label class="interruptor interruptor--tabela"><input type="checkbox" ${p.ativo && "checked"} data-acao="alternar" data-campo="ativo" data-id="${p.id}" aria-label="Disponível na loja: ${p.nome}"><span class="interruptor__trilho"></span></label></td>
          <td><button type="button" class="btn-icone btn-icone--pequeno estrela-toggle ${p.destaque && "estrela-toggle--on"}" data-acao="alternar-destaque" data-id="${p.id}" aria-pressed="${String(p.destaque)}" aria-label="Destacar ${p.nome}">${icone("estrela", { tamanho: 18, preenchido: p.destaque })}</button></td>
          <td class="texto-direita nowrap">
            <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" data-id="${p.id}" aria-label="Editar ${p.nome}">${icone("editar", { tamanho: 17 })}</button>
            <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" data-id="${p.id}" aria-label="Excluir ${p.nome}">${icone("lixeira", { tamanho: 17 })}</button></td>
        </tr>`)}</tbody></table></div></div>`
      : vazio("busca", "Nenhum produto encontrado", "Tente outra busca ou filtro."));
  }

  const trocar = (salvo) => {
    const i = lista.findIndex((p) => p.id === salvo.id);
    if (i >= 0) lista[i] = salvo; else lista.push(salvo);
    desenhar();
  };
  const achar = (el) => lista.find((p) => p.id === Number(el.dataset.id));

  async function alterarCampo(campo, produto, valor) {
    try { trocar((await api.patch(`/produtos/${produto.id}`, { [campo]: valor })).produto); }
    catch (erro) { toast(erro.message, "erro"); desenhar(); }
  }

  delegar(ctx.raiz, {
    novo: () => {
      if (!categorias.length) return toast("Crie uma categoria antes de cadastrar produtos.", "info");
      abrirFormProduto({ categorias, aoSalvar: trocar });
    },
    editar: (el) => abrirFormProduto({ produto: achar(el), categorias, aoSalvar: trocar }),
    "alternar-destaque": (el) => alterarCampo("destaque", achar(el), !achar(el).destaque),
    excluir: async (el) => {
      const p = achar(el);
      if (!(await confirmar({ titulo: "Excluir produto", mensagem: `Excluir “${p.nome}”? Pedidos antigos continuam guardados. Se preferir só esconder da loja, desligue “Na loja”.`, rotulo: "Excluir", perigo: true }))) return;
      try { await api.delete(`/produtos/${p.id}`); lista = lista.filter((x) => x.id !== p.id); toast("Produto excluído."); desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  ctx.raiz.addEventListener("change", (ev) => {
    const el = ev.target.closest("[data-acao=alternar]");
    if (el) alterarCampo(el.dataset.campo, achar(el), el.checked);
  });
  $("#busca").addEventListener("input", (ev) => { f.busca = ev.target.value; desenhar(); });
  $("#filtro-cat").addEventListener("change", (ev) => { f.categoria = Number(ev.target.value); desenhar(); });
  $("#filtro-sit").addEventListener("change", (ev) => { f.situacao = ev.target.value; desenhar(); });

  desenhar();
}
