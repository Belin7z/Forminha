/* ==========================================================
   COMPONENTE — estrutura do painel.
   O esqueleto (lateral, topo e página) é criado uma vez; depois
   só o menu e o topo são redesenhados. A área da página nunca é
   tocada por eles.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { iniciais } from "/src/scripts/base/formatacao.js";
import { toast } from "/src/scripts/base/ui.js";
import { api } from "../nucleo/api.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { nomeDaLoja, seloDaLoja } from "./marca.js";
import { podeAcessar } from "../nucleo/permissoes.js";
import { alternarSom, pararNotificacoes, somAtivo } from "../nucleo/notificacoes.js";
import { aoMudarInstalacao, instalar, podeInstalar } from "/src/scripts/base/instalar.js";

const MENU = [
  { grupo: "Vendas", itens: [["/", "Visão geral", "grafico"], ["/relatorios", "Relatórios", "tendencia"], ["/pedidos", "Pedidos", "pacote", "pedidos"], ["/agenda", "Agenda", "calendario"], ["/producao", "Produção", "lista"]] },
  { grupo: "Cardápio", itens: [["/produtos", "Produtos", "bolo"], ["/categorias", "Categorias", "grade"], ["/estoque", "Estoque", "estoque", "estoque"]] },
  { grupo: "Clientes", itens: [["/clientes", "Clientes", "usuarios"], ["/avaliacoes", "Avaliações", "estrela"], ["/favoritos", "Favoritos", "coracao"]] },
  { grupo: "Loja", itens: [["/cupons", "Cupons", "percentual"], ["/entrega", "Entrega e mapa", "caminhao"], ["/configuracoes", "Configurações", "ajustes"], ["/equipe", "Equipe", "usuario"], ["/atividade", "Atividade", "relogio"]] },
];

const TITULOS = { "/conta": "Minha conta", "/primeiros-passos": "Primeiros passos" };
const URL_LOJA = String(window.CONFIG_APP?.urlLoja ?? "").replace(/\/+$/, "");
for (const g of MENU) for (const [caminho, titulo] of g.itens) TITULOS[caminho] = titulo;

/** Título da página a partir do caminho ("/pedidos" -> "Pedidos"). */
export function tituloDe(caminho) {
  if (caminho === "/") return TITULOS["/"];
  const chave = Object.keys(TITULOS).filter((c) => c !== "/" && caminho.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  return TITULOS[chave] ?? "Painel";
}

export function montarEstrutura({ aoSair }) {
  const raiz = document.getElementById("raiz");
  let caminho = "/";

  montar(raiz, html`
    <div class="painel">
      <aside class="lateral" id="lateral" aria-label="Menu do painel"></aside>
      <div class="lateral__fundo" id="lateral-fundo" data-acao="fechar-menu" hidden></div>
      <div class="painel__corpo">
        <header class="topo" id="topo"></header>
        <main id="pagina" class="pagina" tabindex="-1"></main>
      </div>
    </div>`);

  const lateral = document.getElementById("lateral");
  const fundo = document.getElementById("lateral-fundo");
  const topo = document.getElementById("topo");

  const alternarMenu = (abrir) => { lateral.classList.toggle("lateral--aberta", abrir); fundo.hidden = !abrir; };

  function desenharLateral() {
    const u = estado.usuario;
    const novos = estado.contagem.novo ?? 0;
    const risco = estado.estoque?.risco ?? 0;
    const ativo = (c) => (c === "/" ? caminho === "/" : caminho.startsWith(c));
    montar(lateral, html`
      <a href="#${u.papel === "admin" ? "/" : "/pedidos"}" class="lateral__marca">
        ${seloDaLoja("lateral__logo")}
        <span><strong>${nomeDaLoja()}</strong><small>Painel</small></span>
      </a>
      <nav class="lateral__menu">
        ${MENU.map((g) => ({ ...g, itens: g.itens.filter(([c]) => podeAcessar(u.papel, c)) })).filter((g) => g.itens.length).map((g) => html`
          <p class="lateral__grupo">${g.grupo}</p>
          ${g.itens.map(([c, texto, ic, selo]) => html`
            <a href="#${c}" class="lateral__link ${ativo(c) && "lateral__link--ativo"}" ${ativo(c) && html`aria-current="page"`}>
              ${icone(ic, { tamanho: 19 })}<span>${texto}</span>
              ${selo === "pedidos" && novos > 0 && html`<b class="lateral__selo" title="${novos} pedido(s) novo(s)">${novos}</b>`}
              ${selo === "estoque" && risco > 0 && html`<b class="lateral__selo lateral__selo--alerta" title="${risco} ingrediente(s) precisam de atenção">${risco}</b>`}
            </a>`)}`)}
      </nav>
      <div class="lateral__rodape">
        ${podeInstalar() && html`<button type="button" class="lateral__link lateral__link--botao" data-acao="instalar">${icone("baixar", { tamanho: 19 })}<span>Instalar o app</span></button>`}
        <a href="${URL_LOJA || "/"}" target="_blank" rel="noopener" class="lateral__link">${icone("home", { tamanho: 19 })}<span>Ver a loja</span></a>
        <div class="lateral__usuario">
          <a href="#/conta" class="lateral__perfil" aria-label="Minha conta">
            <span class="avatar">${iniciais(u.nome)}</span>
            <span><strong>${u.nome}</strong><small>${u.email}</small></span>
          </a>
          <button type="button" class="btn-icone" data-acao="sair" aria-label="Sair" title="Sair">${icone("sair", { tamanho: 19 })}</button>
        </div>
      </div>`);
  }

  function desenharTopo() {
    const novos = estado.contagem.novo ?? 0;
    const som = somAtivo();
    montar(topo, html`
      <button type="button" class="btn-icone topo__menu" data-acao="menu" aria-label="Abrir menu">${icone("menu")}</button>
      <h2 class="topo__titulo">${tituloDe(caminho)}</h2>
      <span class="espaco"></span>
      <button type="button" class="btn-icone btn-icone--contorno ${!som && "topo__som--mudo"}" data-acao="som" aria-pressed="${String(som)}"
              title="Som de novo pedido: ${som ? "ligado" : "desligado"}" aria-label="Som de novo pedido">${icone("sino")}</button>
      <a href="#/pedidos" class="btn btn--primario btn--pequeno ${novos === 0 && "topo__novos--vazio"}">${icone("pacote", { tamanho: 16 })}
        ${novos > 0 ? `${novos} novo${novos > 1 ? "s" : ""}` : "Pedidos"}</a>`);
  }

  const desenharTudo = () => { desenharLateral(); desenharTopo(); };

  delegar(raiz, {
    menu: () => alternarMenu(true),
    "fechar-menu": () => alternarMenu(false),
    som: () => { alternarSom(); toast(`Som de novo pedido ${somAtivo() ? "ligado" : "desligado"}.`, "info", 2000); desenharTopo(); },
    sair: async () => { pararNotificacoes(); await api.post("/auth/sair").catch(() => {}); aoSair(); },
    instalar: () => instalar("o painel"),
  });
  lateral.addEventListener("click", (ev) => { if (ev.target.closest(".lateral__link")) alternarMenu(false); });

  ouvir("contagem", desenharTudo);
  aoMudarInstalacao(desenharLateral);
  desenharTudo();

  return {
    marcarAtivo(novoCaminho) { caminho = novoCaminho; desenharTudo(); },
    redesenhar: desenharTudo,
  };
}
