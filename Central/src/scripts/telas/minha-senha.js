/* TELA — senha de quem é da equipe: criar a própria no 1º acesso e trocar quando quiser */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, marca, raiz } from "../nucleo.js";
import { botaoTema } from "../claro-escuro.js";

const campos = (primeira) => html`
  ${campo({ nome: "atual", rotulo: primeira ? "Senha temporária" : "Senha atual", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password" autofocus' })}
  ${campo({ nome: "nova", rotulo: "Nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password" minlength="8"', ajuda: "8 caracteres ou mais." })}
  ${campo({ nome: "repita", rotulo: "Repita a nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"' })}`;

/** 1º acesso (ou senha temporária nova): antes de qualquer coisa, a pessoa cria a própria senha. */
export function telaPrimeiraSenha(eu, aoTerminar) {
  document.title = "Crie sua senha — Forminha";
  const q = eu.quem;
  montar(raiz, html`
    <main class="entrar">
      <section class="entrar__arte" aria-hidden="true">
        <div class="entrar__centro"><div class="entrar__forminha"></div><span class="entrar__selo">${icone("cupcake", { tamanho: 44 })}</span></div>
        <p class="entrar__nome">Forminha<small>Central</small></p>
      </section>
      <section class="entrar__lado">
        ${botaoTema("entrar__tema")}
        <div class="entrar__caixa">
          ${marca}
          <h1>Olá, ${String(q.nome).split(" ")[0]}!</h1>
          <p class="texto-suave primeira-senha__texto">Crie a sua senha para começar.</p>
          <form id="form-primeira" novalidate>
            <div class="form-erro" data-erro-geral hidden></div>
            ${campos(true)}
            <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar ${icone("direita", { tamanho: 17 })}</button>
          </form>
          <p class="entrar__ajuda"><button type="button" class="link" data-acao="sair">Sair</button></p>
        </div>
        <p class="entrar__copy">© ${new Date().getFullYear()} Forminha</p>
      </section>
    </main>`);
  const form = raiz.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        await api("POST", "minha-senha", dadosDe(form));
        toast("Senha criada.");
        await aoTerminar();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}

/** Trocar a própria senha a qualquer momento (botão com o nome, no topo). */
export function trocarMinhaSenha() {
  const modal = abrirModal({
    titulo: "Trocar minha senha", largura: 460,
    corpo: html`<form id="form-minha-senha" novalidate><div class="form-erro" data-erro-geral hidden></div>${campos(false)}</form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-minha-senha" class="btn btn--primario">Trocar senha</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(modal.el.querySelector('[form="form-minha-senha"]'), async () => {
      try {
        await api("POST", "minha-senha", dadosDe(form));
        modal.fechar();
        toast("Senha trocada.");
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}
