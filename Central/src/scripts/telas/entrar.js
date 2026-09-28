/* TELA — entrar na Central (e-mail ou usuário + senha) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { fecharJanelas, ocupado } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, aviso as caixaAviso, marca, raiz } from "../nucleo.js";
import { botaoTema } from "../claro-escuro.js";

export function telaEntrar(aoEntrar, aviso = "") {
  document.title = "Entrar — Forminha";
  fecharJanelas(); // sessão acabou com uma ficha aberta: a janela não fica por cima do login
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
          <h1>Entrar</h1>
          ${aviso && caixaAviso("aviso", aviso)}
          <form id="form-entrar" novalidate>
            <div class="form-erro" data-erro-geral hidden></div>
            ${campo({ nome: "usuario", rotulo: "E-mail ou usuário", obrigatorio: true, atributos: 'autocomplete="username" autocapitalize="none" spellcheck="false" autofocus' })}
            ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
            <p class="entrar__caps" data-caps hidden>${icone("alerta", { tamanho: 14 })} Caps Lock ligado</p>
            <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar ${icone("direita", { tamanho: 17 })}</button>
          </form>
          <details class="entrar__ajuda">
            <summary>Esqueceu a senha?</summary>
            <p>Crie uma nova no computador: na pasta <code>Central</code>, rode <code>npm run configurar</code> e escolha a opção 7.</p>
          </details>
        </div>
        <p class="entrar__copy">© ${new Date().getFullYear()} Forminha</p>
      </section>
    </main>`);
  const form = raiz.querySelector("form");
  ativarCampos(form);
  const caps = raiz.querySelector("[data-caps]");
  const olharCaps = (ev) => { if (ev.getModifierState) caps.hidden = !ev.getModifierState("CapsLock"); };
  form.senha.addEventListener("keydown", olharCaps);
  form.senha.addEventListener("keyup", olharCaps);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try { await api("POST", "entrar", dadosDe(form)); await aoEntrar(); }
      catch (erro) { mostrarErros(form, erro); form.senha.select(); }
    });
  });
}
