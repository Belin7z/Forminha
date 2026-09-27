/* ==========================================================
   PÁGINA — convite de primeiro acesso (#/convite/<código>).
   A dona da doceria recebe este link de quem criou a loja: aqui ela
   cria o acesso dela ao painel (ou entra com uma conta que já tem)
   e vira administradora. O link vale uma vez e vence em alguns dias.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api } from "../nucleo/api.js";
import { nomeDaLoja, seloDaLoja } from "../componentes/marca.js";
import { carregandoPagina } from "../componentes/pagina.js";

export const BOAS_VINDAS = "forminha:boas-vindas";

const caixa = (conteudo) => html`<div class="login"><div class="login__caixa convite">${conteudo}</div></div>`;

function formCriar(email) {
  return html`
    <form id="form-criar" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "nome", rotulo: "Seu nome", obrigatorio: true, atributos: 'autocomplete="name" maxlength="80" autofocus' })}
      ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", valor: email ?? "", obrigatorio: true, atributos: `autocomplete="username" ${email ? "readonly" : ""}`, ajuda: email ? "O convite foi feito para este e-mail." : "" })}
      ${campo({ nome: "senha", rotulo: "Crie uma senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"', ajuda: "8 ou mais caracteres, com letras e números." })}
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Criar meu acesso</button>
    </form>`;
}

function formEntrar(email) {
  return html`
    <form id="form-entrar" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", valor: email ?? "", obrigatorio: true, atributos: `autocomplete="username" ${email ? "readonly" : ""}` })}
      ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar e aceitar o convite</button>
    </form>`;
}

/** Desenha a página do convite. `aoAceitar()` é chamado quando ela vira administradora. */
export async function mostrarConvite(codigo, { aoAceitar }) {
  const raiz = document.getElementById("raiz");
  document.title = `Convite — ${nomeDaLoja()}`;
  montar(raiz, caixa(carregandoPagina));

  let info;
  try { info = await api.get(`/convite/${codigo}`); }
  catch (erro) {
    montar(raiz, caixa(html`
      ${seloDaLoja("login__logo")}
      <h1>Convite indisponível</h1>
      <div class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>${erro.message}</span></div>
      <p class="login__rodape"><a class="link" href="#/entrar">Ir para o login</a></p>`));
    return;
  }

  const loja = info.loja || nomeDaLoja();
  montar(raiz, caixa(html`
    ${seloDaLoja("login__logo")}
    <p class="login__subtitulo">Bem-vinda</p>
    <h1>${loja}</h1>
    <p class="texto-suave convite__texto">Sua loja está pronta. Crie seu acesso ao painel: por ele você cadastra os doces, escolhe as cores e acompanha os pedidos.</p>
    <div class="convite__abas" role="tablist">
      <button type="button" role="tab" class="convite__aba convite__aba--ativa" data-aba="criar" aria-selected="true">Criar meu acesso</button>
      <button type="button" role="tab" class="convite__aba" data-aba="entrar" aria-selected="false">Já tenho conta</button>
    </div>
    <div data-conteudo>${formCriar(info.email)}</div>
    <p class="login__rodape">${icone("cadeado", { tamanho: 14 })} Este link é só seu e vale uma vez.</p>`));

  const conteudo = raiz.querySelector("[data-conteudo]");
  const ligar = (aba) => {
    raiz.querySelectorAll(".convite__aba").forEach((b) => {
      const ativa = b.dataset.aba === aba;
      b.classList.toggle("convite__aba--ativa", ativa);
      b.setAttribute("aria-selected", String(ativa));
    });
    montar(conteudo, aba === "criar" ? formCriar(info.email) : formEntrar(info.email));
    const form = conteudo.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          const r = await api.post("/convite/usar", { ...dadosDe(form), codigo, criar: aba === "criar" });
          if (r.confirmar_email) {
            montar(conteudo, html`<div class="aviso aviso--sucesso">${icone("email", { tamanho: 16 })}<span>
              Enviamos um e-mail de confirmação. Confirme por lá e depois <strong>volte a este mesmo link</strong> e use “Já tenho conta”.</span></div>`);
            return;
          }
          try { sessionStorage.setItem(BOAS_VINDAS, "1"); } catch { /* modo privado */ }
          aoAceitar(r.usuario);
        } catch (erro) { mostrarErros(form, erro); }
      });
    });
  };
  raiz.querySelectorAll(".convite__aba").forEach((b) => b.addEventListener("click", () => ligar(b.dataset.aba)));
  ligar("criar");
}
