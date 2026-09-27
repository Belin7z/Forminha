/* COMPONENTE — comportamento comum dos cartões de produto (abrir, favoritar, adicionar) */
import { icone } from "/src/scripts/base/icones.js";
import { toast } from "/src/scripts/base/ui.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { produtoPorId } from "../nucleo/catalogo.js";
import { adicionar } from "../nucleo/carrinho.js";
import { alternarFavorito } from "../nucleo/sessao.js";
import { abrirProduto } from "./modal-produto.js";

/**
 * Liga os cliques dos cartões dentro de `raiz`. Devolve a função que desfaz tudo
 * (as páginas a devolvem ao roteador como limpeza).
 */
export function ligarProdutos(raiz, ctx) {
  const abrir = (el) => abrirProduto(el.dataset.id, ctx);

  const aoClicar = (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo || !raiz.contains(alvo)) return;
    const id = Number(alvo.dataset.id);
    if (alvo.dataset.acao === "abrir") abrir(alvo);
    else if (alvo.dataset.acao === "favorito") alternarFavorito(id, ctx);
    else if (alvo.dataset.acao === "adicionar") {
      const p = produtoPorId(id);
      if (p.opcoes.length) return abrirProduto(id, ctx); // precisa escolher opções
      adicionar({ produto_id: id, qtd: p.min_qtd });
      toast(`${p.nome} adicionado ao carrinho.`);
    }
  };

  const aoTeclar = (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const cartao = ev.target.closest(".produto");
    if (cartao && ev.target === cartao) { ev.preventDefault(); abrir(cartao); }
  };

  // corações refletem o estado sem redesenhar a lista
  const atualizarCoracoes = () => {
    raiz.querySelectorAll('[data-acao="favorito"]').forEach((b) => {
      const on = estado.favoritos.has(Number(b.dataset.id));
      b.classList.toggle("favorito--on", on);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", `${on ? "Remover dos" : "Adicionar aos"} favoritos`);
      b.innerHTML = String(icone("coracao", { tamanho: 19, preenchido: on }));
    });
  };

  raiz.addEventListener("click", aoClicar);
  raiz.addEventListener("keydown", aoTeclar);
  const desligar = ouvir("favoritos", atualizarCoracoes);
  return () => {
    raiz.removeEventListener("click", aoClicar);
    raiz.removeEventListener("keydown", aoTeclar);
    desligar();
  };
}
