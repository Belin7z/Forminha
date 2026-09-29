/* ==========================================================
   TELA — entrar na Central: e-mail ou usuário + senha; com a
   verificação em duas etapas ligada, depois vem o código do
   aplicativo (ou um código de reserva). "Esqueci a senha": o dono
   recebe um link por e-mail (#/nova-senha/<código>); a equipe pede
   uma senha nova ao dono.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { fecharJanelas, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, aviso as caixaAviso, marca, raiz } from "../nucleo.js";
import { botaoTema } from "../claro-escuro.js";

/** A moldura da tela de entrar (arte de um lado, a caixa do outro). */
function moldura(conteudo) {
  montar(raiz, html`
    <main class="entrar">
      <section class="entrar__arte" aria-hidden="true">
        <div class="entrar__centro"><div class="entrar__forminha"></div><span class="entrar__selo">${icone("cupcake", { tamanho: 44 })}</span></div>
        <p class="entrar__nome">Forminha<small>Central</small></p>
      </section>
      <section class="entrar__lado">
        ${botaoTema("entrar__tema")}
        <div class="entrar__caixa" data-caixa>${marca}${conteudo}</div>
        <p class="entrar__copy">© ${new Date().getFullYear()} Forminha · <a class="link" href="#/termos">Termos</a> · <a class="link" href="#/privacidade">Privacidade</a></p>
      </section>
    </main>`);
  return raiz.querySelector("[data-caixa]");
}

export function telaEntrar(aoEntrar, aviso = "") {
  document.title = "Entrar — Forminha";
  fecharJanelas(); // sessão acabou com uma ficha aberta: a janela não fica por cima do login
  const caixa = moldura("");

  function passoSenha(mensagem = aviso) {
    montar(caixa, html`${marca}
      <h1>Entrar</h1>
      ${mensagem && caixaAviso("aviso", mensagem)}
      <form id="form-entrar" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "usuario", rotulo: "E-mail ou usuário", obrigatorio: true, atributos: 'autocomplete="username" autocapitalize="none" spellcheck="false" autofocus' })}
        ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
        <p class="entrar__caps" data-caps hidden>${icone("alerta", { tamanho: 14 })} Caps Lock ligado</p>
        <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar ${icone("direita", { tamanho: 17 })}</button>
      </form>
      <button type="button" class="link entrar__esqueci" data-esqueci>Esqueci a senha</button>`);
    const form = caixa.querySelector("form");
    ativarCampos(form);
    const caps = caixa.querySelector("[data-caps]");
    const olharCaps = (ev) => { if (ev.getModifierState) caps.hidden = !ev.getModifierState("CapsLock"); };
    form.senha.addEventListener("keydown", olharCaps);
    form.senha.addEventListener("keyup", olharCaps);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          const r = await api("POST", "entrar", dadosDe(form));
          if (r.etapa === "codigo") return passoCodigo(r.desafio);
          await aoEntrar();
        } catch (erro) { mostrarErros(form, erro); form.senha.select(); }
      });
    });
    caixa.querySelector("[data-esqueci]").addEventListener("click", () => passoEsqueci(form.usuario.value));
  }

  function passoCodigo(desafio) {
    montar(caixa, html`${marca}
      <h1>Código de verificação</h1>
      <p class="entrar__texto">Abra o aplicativo de autenticação no celular e digite o código de 6 números da Forminha.</p>
      <form id="form-codigo" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "codigo", rotulo: "Código", obrigatorio: true, placeholder: "000 000", classe: "campo--codigo",
          atributos: 'inputmode="numeric" autocomplete="one-time-code" maxlength="9" autofocus spellcheck="false"' })}
        <button type="submit" class="btn btn--primario btn--grande btn--bloco">Confirmar ${icone("direita", { tamanho: 17 })}</button>
      </form>
      <details class="entrar__ajuda">
        <summary>Sem o celular?</summary>
        <p>Digite um dos <strong>códigos de reserva</strong> que você guardou (formato abcd-efgh). Cada um vale uma vez. É da equipe e perdeu o celular? Peça ao dono para desligar a verificação da sua conta.</p>
      </details>
      <button type="button" class="link entrar__esqueci" data-voltar>Voltar</button>`);
    const form = caixa.querySelector("form");
    ativarCampos(form);
    // 6 números: confirma sozinho (menos um toque no celular)
    form.codigo.addEventListener("input", () => { if (/^\d{6}$/.test(form.codigo.value.replace(/\s/g, ""))) form.requestSubmit(); });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          const r = await api("POST", "entrar/codigo", { desafio, codigo: form.codigo.value.trim() });
          if (r.reservas_restantes !== null && r.reservas_restantes !== undefined) {
            toast(r.reservas_restantes ? `Código de reserva usado: restam ${r.reservas_restantes}.` : "Era o último código de reserva: gere novos em Segurança da conta.", "info", 7000);
          }
          await aoEntrar();
        } catch (erro) {
          if (erro.status === 401 && /tempo/.test(erro.message)) return passoSenha(erro.message);
          mostrarErros(form, erro);
          form.codigo.select();
        }
      });
    });
    caixa.querySelector("[data-voltar]").addEventListener("click", () => passoSenha(""));
  }

  function passoEsqueci(digitado = "") {
    montar(caixa, html`${marca}
      <h1>Esqueci a senha</h1>
      <p class="entrar__texto">Digite o e-mail da conta: o link para criar uma senha nova chega em instantes (vale 30 minutos).</p>
      <form id="form-esqueci" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "email", rotulo: "E-mail da conta", tipo: "email", obrigatorio: true, valor: /@/.test(digitado) ? digitado : "", atributos: 'autocomplete="email" autofocus' })}
        <button type="submit" class="btn btn--primario btn--grande btn--bloco">Enviar o link</button>
      </form>
      <p class="entrar__texto entrar__texto--pequeno">É da equipe (usuário FM…)? Peça ao dono uma senha nova, na tela Equipe.</p>
      <button type="button" class="link entrar__esqueci" data-voltar>Voltar para entrar</button>`);
    const form = caixa.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          const r = await api("POST", "senha/esqueci", dadosDe(form));
          montar(form, caixaAviso("sucesso", r.mensagem));
        } catch (erro) { mostrarErros(form, erro); }
      });
    });
    caixa.querySelector("[data-voltar]").addEventListener("click", () => passoSenha(""));
  }

  passoSenha();
}

/** Senha nova pelo link do e-mail. */
export function telaNovaSenha(token, aoTerminar) {
  document.title = "Senha nova — Forminha";
  fecharJanelas();
  const caixa = moldura(html`
    <h1>Criar senha nova</h1>
    <form id="form-nova" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "nova", rotulo: "Senha nova", tipo: "password", obrigatorio: true, ajuda: "8 caracteres ou mais.", atributos: 'autocomplete="new-password" autofocus' })}
      ${campo({ nome: "repita", rotulo: "Repita a senha nova", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"' })}
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Salvar e entrar</button>
    </form>`);
  const form = caixa.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        await api("POST", "senha/nova", { token, ...dadosDe(form) });
        history.replaceState(null, "", "#/");
        toast("Senha nova salva. Entre com ela.");
        aoTerminar();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}
