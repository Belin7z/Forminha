/* ==========================================================
   CENTRAL DA FORMINHA — estrutura do painel e qual tela mostrar.
     #/pagar/<link>   página de pagamento da cliente (pública)
     sem login        entrar
     senha temporária funcionário cria a própria senha
     logado           menu lateral + topo com o perfil (Configurações, Sair)
   Cada item do menu só aparece para quem tem a permissão; o servidor
   confere de novo em toda requisição.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { iniciais } from "/src/scripts/base/formatacao.js";
import { api, aviso, marca, pode, quandoExpirar, raiz } from "./nucleo.js";
import { botaoTema } from "./claro-escuro.js";
import { telaEntrar } from "./telas/entrar.js";
import { telaVisaoGeral } from "./telas/visao-geral.js";
import { telaClientes } from "./telas/clientes.js";
import { telaPagamentos } from "./telas/pagamentos.js";
import { telaVendas } from "./telas/vendas.js";
import { telaLojas } from "./telas/lojas.js";
import { telaEquipe } from "./telas/equipe.js";
import { telaAtividade } from "./telas/atividade.js";
import { telaConfiguracoes } from "./telas/configuracoes.js";
import { telaPagar } from "./telas/pagar.js";
import { telaPrimeiraSenha, trocarMinhaSenha } from "./telas/minha-senha.js";
import { abrirFicha } from "./telas/clientes.js";
import { ligarSino } from "./sino.js";

// [endereço, nome, ícone, permissão (null = todos), tela]
const MENU = [
  { itens: [["visao-geral", "Visão geral", "grade", null, telaVisaoGeral]] },
  { grupo: "Vendas", itens: [
    ["clientes", "Clientes", "usuarios", "clientes.ver", telaClientes], ["vendas", "Vendas", "grafico", "financeiro.ver", telaVendas],
    ["pagamentos", "Pagamentos", "dinheiro", "financeiro.ver", telaPagamentos],
  ] },
  { grupo: "Lojas", itens: [["lojas", "Lojas", "home", "lojas.ver", telaLojas]] },
  { grupo: "Administração", itens: [["equipe", "Equipe", "usuario", "equipe", telaEquipe], ["atividade", "Atividade", "relogio", "equipe", telaAtividade]] },
];
const TELAS = Object.fromEntries(MENU.flatMap((g) => g.itens).map(([id, nome, , permissao, tela]) => [id, { nome, permissao, tela }]));
TELAS.configuracoes = { nome: "Configurações", permissao: "configuracoes", tela: telaConfiguracoes };

function lateral(eu, atual) {
  return html`
    <aside class="lateral" aria-label="Menu">
      <a class="lateral__marca" href="#/visao-geral">${marca}</a>
      <nav class="lateral__menu">
        ${MENU.map((g) => ({ ...g, itens: g.itens.filter(([, , , p]) => !p || pode(eu, p)) })).filter((g) => g.itens.length).map((g) => html`
          ${g.grupo && html`<p class="lateral__grupo">${g.grupo}</p>`}
          ${g.itens.map(([id, nome, ic]) => html`
            <a href="#/${id}" class="lateral__link ${id === atual && "lateral__link--ativo"}" ${id === atual && html`aria-current="page"`}>${icone(ic, { tamanho: 18 })}<span>${nome}</span></a>`)}`)}
      </nav>
      ${eu.simulado && html`<p class="lateral__teste">Modo de teste</p>`}
    </aside>`;
}

/** Nome que aparece no topo: o nome da pessoa (completo, como ela escreveu). */
const nomeDe = (q) => q.nome || String(q.usuario || "").split("@")[0] || "Perfil";

function perfil(eu) {
  const q = eu.quem;
  const dono = q.tipo === "dono";
  const detalhe = dono ? q.usuario : `${q.usuario} · ${q.funcao_nome}`;
  const nome = nomeDe(q);
  return html`
    <div class="perfil">
      <button type="button" class="perfil__botao" data-acao="perfil" aria-haspopup="menu" aria-expanded="false">
        <span class="avatar">${iniciais(nome)}</span>
        <span class="perfil__nome"><strong>${nome}</strong><small>${dono ? "Dono" : q.funcao_nome}</small></span>
        ${icone("baixo", { tamanho: 16 })}
      </button>
      <div class="perfil__menu" role="menu" hidden>
        <div class="perfil__cab"><strong>${nome}</strong>${detalhe && html`<small>${detalhe}</small>`}</div>
        ${pode(eu, "configuracoes") && html`<a role="menuitem" href="#/configuracoes" class="perfil__item">${icone("ajustes", { tamanho: 17 })} Configurações</a>`}
        ${!dono && html`<button type="button" role="menuitem" class="perfil__item" data-acao="minha-senha">${icone("cadeado", { tamanho: 17 })} Trocar minha senha</button>`}
        <button type="button" role="menuitem" class="perfil__item" data-acao="sair">${icone("sair", { tamanho: 17 })} Sair</button>
      </div>
    </div>`;
}

async function rotear() {
  const pagar = /^#\/pagar\/([A-Za-z0-9_-]{20,64})$/.exec(location.hash);
  if (pagar) return telaPagar(pagar[1]);
  const eu = await api("GET", "eu").catch(() => ({ logado: false }));
  if (!eu.logado) return telaEntrar(rotear);
  if (eu.quem?.trocar_senha) return telaPrimeiraSenha(eu, rotear);

  const pedida = location.hash.replace(/^#\/?/, "").split("/")[0];
  const atual = TELAS[pedida] && (!TELAS[pedida].permissao || pode(eu, TELAS[pedida].permissao)) ? pedida : "visao-geral";
  montar(raiz, html`
    <div class="app">
      ${lateral(eu, atual)}
      <div class="app__fundo" data-acao="fechar-menu"></div>
      <div class="app__corpo">
        <header class="topo">
          <button type="button" class="btn-icone topo__menu" data-acao="abrir-menu" aria-label="Abrir menu">${icone("menu", { tamanho: 20 })}</button>
          <p class="topo__secao">${TELAS[atual].nome}</p>
          <span class="espaco"></span>
          ${eu.recursos?.trocar_senha && html`<div class="sino" data-sino-conteiner></div>`}
          ${botaoTema()}
          ${perfil(eu)}
        </header>
        <main class="app__pagina">
          ${eu.faltando?.length > 0 && !eu.simulado && aviso("aviso", html`Falta configurar: <strong>${eu.faltando.join(", ")}</strong>.`)}
          ${eu.chaves?.map((c) => aviso(c.dias <= 7 ? "perigo" : "aviso", html`<strong>${c.texto}.</strong> Rode <code>npm run configurar</code> (opção ${c.opcao}).`))}
          <div data-conteudo></div>
        </main>
      </div>
    </div>`);
  const sino = raiz.querySelector("[data-sino-conteiner]");
  if (sino) ligarSino(sino, { aoAbrirCliente: (id) => (pode(eu, "clientes.ver") ? abrirFicha(id, rotear, eu) : null) });
  await TELAS[atual].tela(raiz.querySelector("[data-conteudo]"), eu);
  if (eu.quem.tipo === "dono" && !eu.quem.nome && eu.recursos?.trocar_senha) pedirNome();
}

/** Sem nome ainda: pergunta uma vez (por visita) como a pessoa quer aparecer no topo. */
function pedirNome() {
  try { if (sessionStorage.getItem("forminha:pediu-nome")) return; sessionStorage.setItem("forminha:pediu-nome", "1"); } catch { /* modo privado */ }
  const modal = abrirModal({
    titulo: "Como você quer ser chamado?", largura: 420,
    corpo: html`<form id="form-nome" class="form-empilhado" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "nome", rotulo: "Seu nome", obrigatorio: true, placeholder: "Nome e sobrenome", atributos: 'autocomplete="name" maxlength="60" autofocus' })}
      <p class="form-empilhado__dica">Aparece no topo, no seu perfil.</p>
    </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Agora não</button><button type="submit" form="form-nome" class="btn btn--primario">Salvar</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(modal.el.querySelector('[form="form-nome"]'), async () => {
      try { await api("PUT", "perfil", dadosDe(form)); modal.fechar(); rotear(); }
      catch (erro) { mostrarErros(form, erro); }
    });
  });
}

/* ---------- menu do perfil e menu lateral no celular ---------- */
function fecharPerfil() {
  const menu = raiz.querySelector(".perfil__menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  raiz.querySelector('[data-acao="perfil"]')?.setAttribute("aria-expanded", "false");
}

raiz.addEventListener("click", async (ev) => {
  const alvo = ev.target.closest("[data-acao]");
  const acao = alvo?.dataset.acao;
  if (acao !== "perfil" && !ev.target.closest(".perfil__menu")) fecharPerfil();
  if (ev.target.closest(".lateral__link")) raiz.querySelector(".app")?.classList.remove("app--menu");
  if (ev.target.closest(".perfil__item")) fecharPerfil();
  if (acao === "perfil") {
    const menu = raiz.querySelector(".perfil__menu");
    menu.hidden = !menu.hidden;
    alvo.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) menu.querySelector(".perfil__item")?.focus();
  }
  if (acao === "abrir-menu") raiz.querySelector(".app")?.classList.add("app--menu");
  if (acao === "fechar-menu") raiz.querySelector(".app")?.classList.remove("app--menu");
  if (acao === "minha-senha") return trocarMinhaSenha();
  if (acao === "sair") {
    await api("POST", "sair", {}).catch(() => {});
    history.replaceState(null, "", "#/");
    telaEntrar(rotear);
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  fecharPerfil();
  raiz.querySelector(".app")?.classList.remove("app--menu");
});
// qualquer botão com data-copiar copia o texto dele
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copiar]");
  if (!b) return;
  await copiar(b.dataset.copiar);
  toast("Copiado.");
});

quandoExpirar(() => telaEntrar(rotear, "Sua sessão terminou. Entre de novo."));
window.addEventListener("hashchange", rotear);
rotear();
