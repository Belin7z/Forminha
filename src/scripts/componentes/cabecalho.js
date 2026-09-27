/* COMPONENTE — cabeçalho: marca, menu, favoritos, carrinho e conta do cliente */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { iniciais } from "/src/scripts/base/formatacao.js";
import { abertaAgora } from "/src/scripts/base/agendamento.js";
import { toast } from "/src/scripts/base/ui.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { quantidade } from "../nucleo/carrinho.js";
import { sair } from "../nucleo/sessao.js";
import { abrirGaveta } from "./gaveta-carrinho.js";

const LINKS = [
  ["/", "Início"],
  ["/cardapio", "Cardápio"],
  ["/favoritos", "Favoritos"],
  ["/contato", "Contato"],
];

// Se o nome TERMINA com o tipo do negócio ("Ana Souza Confeitaria"), ele vira a linha pequena embaixo do nome.
const TIPO_NO_FIM = /\s+(confeitaria|doceria|doces|brigaderia|bolos|ateli[êe]|patisserie|p[âa]tisserie|cakes|bakery|padaria)$/i;

/** Logo enviada no Dashboard ou, na falta dela, um monograma com o nome da loja. */
function marca(config) {
  const nome = config.loja.nome;
  if (config.loja.logo) return html`<img class="marca__img" src="${config.loja.logo}" alt="${nome}">`;
  const tipo = TIPO_NO_FIM.exec(nome);
  const principal = tipo ? nome.slice(0, tipo.index) : nome;
  const iniciais = principal.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return html`<span class="marca__mono" aria-hidden="true">${iniciais}</span>
    <span class="marca__txt"><strong>${principal}</strong>${tipo && html`<em>${tipo[1]}</em>`}</span>`;
}

export function iniciarCabecalho(roteador) {
  const raiz = document.getElementById("cabecalho");
  let caminho = "/";
  let menuAberto = false;
  let contaAberta = false;

  function faixa() {
    const { pedidos, horarios } = estado.config;
    if (pedidos.pausados) return html`<div class="faixa faixa--pausa">${icone("alerta", { tamanho: 16 })}<span>${pedidos.mensagem_pausa}</span></div>`;
    if (!abertaAgora(horarios)) {
      return html`<div class="faixa">${icone("relogio", { tamanho: 16 })}<span>Estamos fechados agora, mas você pode <strong>agendar seu pedido</strong> para os próximos dias.</span></div>`;
    }
    return "";
  }

  function desenhar() {
    const { config, usuario, favoritos } = estado;
    const qtd = quantidade();
    const ativo = (c) => (c === "/" ? caminho === "/" : caminho.startsWith(c));

    montar(raiz, html`
      ${faixa()}
      <div class="container cabecalho__in">
        <a href="#/" class="marca" aria-label="${config.loja.nome} — início">
          ${marca(config)}
        </a>

        <nav class="menu ${menuAberto && "menu--aberto"}" aria-label="Principal">
          ${LINKS.map(([c, texto]) => html`<a href="#${c}" class="${ativo(c) && "ativo"}">${texto}</a>`)}
        </nav>

        <div class="cabecalho__acoes">
          <a href="#/favoritos" class="btn-icone btn-icone--contorno icone-com-selo" aria-label="Favoritos">
            ${icone("coracao")}${favoritos.size > 0 && html`<span class="selo">${favoritos.size}</span>`}
          </a>
          <button type="button" class="btn-icone btn-icone--contorno icone-com-selo" data-acao="carrinho" aria-label="Abrir carrinho">
            ${icone("sacola")}${qtd > 0 && html`<span class="selo">${qtd}</span>`}
          </button>
          ${usuario
            ? html`<div class="conta-menu">
                <button type="button" class="conta-menu__botao" data-acao="conta" aria-expanded="${String(contaAberta)}" aria-haspopup="menu">
                  <span class="avatar">${iniciais(usuario.nome)}</span>
                  <span class="conta-menu__nome">${usuario.nome.split(" ")[0]}</span>${icone("baixo", { tamanho: 16 })}
                </button>
                ${contaAberta && html`<div class="conta-menu__lista" role="menu">
                  <a href="#/conta/pedidos" role="menuitem">${icone("pacote", { tamanho: 16 })} Meus pedidos</a>
                  <a href="#/conta/enderecos" role="menuitem">${icone("pino", { tamanho: 16 })} Meus endereços</a>
                  <a href="#/conta" role="menuitem">${icone("usuario", { tamanho: 16 })} Meus dados</a>
                  <a href="#/favoritos" role="menuitem">${icone("coracao", { tamanho: 16 })} Favoritos</a>
                  <button type="button" data-acao="sair" role="menuitem">${icone("sair", { tamanho: 16 })} Sair</button>
                </div>`}
              </div>`
            : html`<a href="#/entrar" class="btn btn--primario btn--pequeno">Entrar</a>`}
          <button type="button" class="btn-icone hamburguer" data-acao="menu" aria-label="Menu" aria-expanded="${String(menuAberto)}">${icone(menuAberto ? "x" : "menu")}</button>
        </div>
      </div>`);
  }

  delegar(raiz, {
    carrinho: () => abrirGaveta(),
    menu: () => { menuAberto = !menuAberto; desenhar(); },
    conta: () => { contaAberta = !contaAberta; desenhar(); },
    sair: async () => {
      contaAberta = false;
      await sair();
      toast("Você saiu da sua conta.", "info");
      roteador.ir("/");
    },
  });

  // fecha menus ao clicar fora ou ao navegar
  document.addEventListener("click", (ev) => {
    if (contaAberta && !ev.target.closest(".conta-menu")) { contaAberta = false; desenhar(); }
    if (menuAberto && !ev.target.closest(".menu, .hamburguer")) { menuAberto = false; desenhar(); }
  });
  raiz.addEventListener("click", (ev) => {
    if (ev.target.closest(".menu a, .conta-menu__lista a")) { menuAberto = false; contaAberta = false; setTimeout(desenhar); }
  });

  for (const topico of ["usuario", "carrinho", "favoritos"]) ouvir(topico, desenhar);
  desenhar();

  return {
    marcarAtivo(novoCaminho) { caminho = novoCaminho; menuAberto = false; contaAberta = false; desenhar(); },
  };
}
