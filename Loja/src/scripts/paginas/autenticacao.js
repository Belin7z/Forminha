/* PÁGINAS — entrar e criar conta */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { estado } from "../nucleo/estado.js";
import { carregarCatalogo } from "../nucleo/catalogo.js";
import { supabase } from "../nucleo/api.js";
import { cadastrar, entrar, recuperarSenha, redefinirSenha } from "../nucleo/sessao.js";

/** Só aceita voltar para caminhos internos da própria loja (evita redirecionamento para outro site). */
function destinoSeguro(valor) {
  return typeof valor === "string" && /^\/[a-zA-Z0-9/_\-?=&%.]*$/.test(valor) && !valor.startsWith("//") ? valor : "/";
}

const BENEFICIOS = [
  ["pacote", "Acompanhe seus pedidos etapa por etapa"],
  ["pino", "Salve seus endereços e receba onde quiser"],
  ["coracao", "Guarde os seus favoritos"],
  ["atualizar", "Peça de novo em poucos cliques"],
];

function moldura(titulo, subtitulo, formulario, rodape) {
  return html`
    <section class="container auth">
      <aside class="auth__lateral" aria-hidden="true">
        <span class="auth__ico">${icone("usuario", { tamanho: 30 })}</span>
        <h2>Sua conta na loja</h2>
        <ul>${BENEFICIOS.map(([e, t]) => html`<li><span>${icone(e, { tamanho: 18 })}</span>${t}</li>`)}</ul>
      </aside>
      <div class="auth__caixa">
        <h1>${titulo}</h1>
        <p class="texto-suave">${subtitulo}</p>
        ${formulario}
        <p class="auth__rodape">${rodape}</p>
      </div>
    </section>`;
}

function forcaDaSenha(senha) {
  let pontos = 0;
  if (senha.length >= 8) pontos++;
  if (senha.length >= 12) pontos++;
  if (/[A-Za-z]/.test(senha) && /\d/.test(senha)) pontos++;
  if (/[^A-Za-z0-9]/.test(senha) || (/[a-z]/.test(senha) && /[A-Z]/.test(senha))) pontos++;
  return pontos;
}

export function paginaEntrar(ctx) {
  if (estado.usuario) return ctx.ir(destinoSeguro(ctx.consulta.voltar), { substituir: true });
  const voltar = destinoSeguro(ctx.consulta.voltar);

  montar(ctx.raiz, moldura(
    "Que bom te ver de novo!", "Entre para acompanhar seus pedidos e finalizar sua compra.",
    html`<form id="form-entrar" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true, atributos: 'autocomplete="email" autofocus' })}
      ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar</button>
      <p class="texto-centro auth__ajuda"><a href="#/recuperar" class="link">Esqueci minha senha</a></p>
    </form>`,
    html`Ainda não tem conta? <a href="#/cadastrar?voltar=${encodeURIComponent(voltar)}" class="link">Criar conta grátis</a>`
  ));

  const form = ctx.raiz.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("button[type=submit]"), async () => {
      try {
        const usuario = await entrar(dadosDe(form));
        await carregarCatalogo(); // traz os favoritos deste cliente
        toast(`Bem-vinda(o), ${usuario.nome.split(" ")[0]}.`);
        ctx.ir(voltar);
      } catch (erro) {
        mostrarErros(form, erro, (m) => toast(m, "erro"));
      }
    });
  });
}

export function paginaCadastrar(ctx) {
  if (estado.usuario) return ctx.ir(destinoSeguro(ctx.consulta.voltar), { substituir: true });
  const voltar = destinoSeguro(ctx.consulta.voltar);

  montar(ctx.raiz, moldura(
    "Crie sua conta", "Leva menos de um minuto e deixa seus pedidos muito mais rápidos.",
    html`<form id="form-cadastro" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "nome", rotulo: "Nome completo", obrigatorio: true, atributos: 'autocomplete="name" maxlength="80" autofocus' })}
      <div class="grade-campos grade-campos--2">
        ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true, atributos: 'autocomplete="email"' })}
        ${campo({ nome: "telefone", rotulo: "WhatsApp / telefone", tipo: "tel", obrigatorio: true, mascara: "telefone", placeholder: "(00) 00000-0000", atributos: 'autocomplete="tel"' })}
      </div>
      ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"', ajuda: "Mínimo de 8 caracteres, com letras e números." })}
      <div class="forca" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="armadilha" aria-hidden="true"><label>Deixe este campo vazio<input type="text" name="site" tabindex="-1" autocomplete="off"></label></div>
      <label class="aceite"><input type="checkbox" name="aceite">
        <span>Li e aceito a <a href="#/privacidade" target="_blank" rel="noopener" class="link">Política de Privacidade</a> e os <a href="#/termos" target="_blank" rel="noopener" class="link">Termos de uso</a>.</span></label>
      <small class="aceite__erro" id="erro-aceite" hidden>Para criar a conta, aceite a política de privacidade e os termos.</small>
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Criar minha conta</button>
      <p class="texto-suave texto-centro auth__ajuda">Usamos seu telefone só para falar sobre o seu pedido.</p>
    </form>`,
    html`Já tem conta? <a href="#/entrar?voltar=${encodeURIComponent(voltar)}" class="link">Entrar</a>`
  ));

  const form = ctx.raiz.querySelector("form");
  ativarCampos(form);
  const barras = form.querySelectorAll(".forca span");
  form.elements.senha.addEventListener("input", (ev) => {
    const nivel = forcaDaSenha(ev.target.value);
    barras.forEach((b, i) => { b.className = i < nivel ? `on n${nivel}` : ""; });
  });

  const abertoEm = Date.now();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    // robôs preenchem tudo, inclusive o campo escondido, e enviam em milissegundos: fingimos que deu certo e não criamos nada
    if (form.elements.site.value.trim()) return confirmarEmail(ctx, form.elements.email.value.trim());
    if (Date.now() - abertoEm < 1200) { toast("Só um instante… confira os dados e tente de novo.", "info"); return; }
    const aviso = form.querySelector("#erro-aceite");
    aviso.hidden = form.elements.aceite.checked;
    if (!form.elements.aceite.checked) { form.elements.aceite.focus(); return; }
    await ocupado(form.querySelector("button[type=submit]"), async () => {
      try {
        const email = form.elements.email.value.trim();
        const usuario = await cadastrar(dadosDe(form));
        if (!usuario) return confirmarEmail(ctx, email);
        toast(`Conta criada! Bem-vinda(o), ${usuario.nome.split(" ")[0]}.`);
        ctx.ir(voltar);
      } catch (erro) {
        mostrarErros(form, erro, (m) => toast(m, "erro"));
      }
    });
  });
}

/** O Supabase pode exigir a confirmação do e-mail: o cliente só entra depois de clicar no link recebido. */
function confirmarEmail(ctx, email) {
  montar(ctx.raiz, moldura(
    "Confirme seu e-mail", "Falta só um passo para começar.",
    html`<div class="vazio"><span class="vazio__ico">${icone("email", { tamanho: 38 })}</span>
      <h3>Enviamos um link para você</h3>
      <p>Abra a mensagem enviada para <strong>${email}</strong> e clique no link para ativar sua conta. Olhe também a caixa de spam.</p>
      <a href="#/entrar" class="btn btn--primario">Já confirmei, quero entrar</a></div>`,
    ""
  ));
}

export function paginaRecuperar(ctx) {
  montar(ctx.raiz, moldura(
    "Esqueceu a senha?", "Informe o e-mail da sua conta e enviamos um link para criar uma nova senha.",
    html`<form id="form-recuperar" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true, atributos: 'autocomplete="email" autofocus' })}
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Enviar link</button>
    </form>`,
    html`Lembrou? <a href="#/entrar" class="link">Voltar para o login</a>`
  ));

  const form = ctx.raiz.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("button[type=submit]"), async () => {
      try {
        const { email } = dadosDe(form);
        await recuperarSenha(email);
        // a resposta é sempre a mesma: não revela se o e-mail tem conta
        montar(ctx.raiz, moldura(
          "Confira seu e-mail", "Se existir uma conta com esse endereço, o link já está a caminho.",
          html`<div class="vazio"><span class="vazio__ico">${icone("email", { tamanho: 38 })}</span>
            <p>O link vale por pouco tempo. Não chegou? Olhe a caixa de spam ou peça outro.</p>
            <button type="button" class="btn btn--suave" data-outro>Pedir outro link</button></div>`,
          html`<a href="#/entrar" class="link">Voltar para o login</a>`
        ));
        ctx.raiz.querySelector("[data-outro]").addEventListener("click", () => paginaRecuperar(ctx));
      } catch (erro) {
        mostrarErros(form, erro, (m) => toast(m, "erro"));
      }
    });
  });
}

export async function paginaRedefinir(ctx) {
  const { data } = await supabase.auth.getSession();
  if (!ctx.ativo()) return;
  if (!data?.session) {
    montar(ctx.raiz, moldura(
      "Link vencido", "Este link já foi usado ou expirou.",
      html`<div class="vazio"><span class="vazio__ico">${icone("relogio", { tamanho: 38 })}</span>
        <p>Peça um novo e-mail para criar sua nova senha.</p>
        <a href="#/recuperar" class="btn btn--primario">Pedir novo link</a></div>`,
      ""
    ));
    return;
  }

  montar(ctx.raiz, moldura(
    "Crie sua nova senha", "Escolha uma senha que você ainda não usou.",
    html`<form id="form-redefinir" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "senha", rotulo: "Nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password" autofocus', ajuda: "Mínimo de 8 caracteres, com letras e números." })}
      <div class="forca" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      ${campo({ nome: "confirmar", rotulo: "Repita a nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"' })}
      <button type="submit" class="btn btn--primario btn--grande btn--bloco">Salvar nova senha</button>
    </form>`,
    ""
  ));

  const form = ctx.raiz.querySelector("form");
  ativarCampos(form);
  const barras = form.querySelectorAll(".forca span");
  form.elements.senha.addEventListener("input", (ev) => {
    const nivel = forcaDaSenha(ev.target.value);
    barras.forEach((b, i) => { b.className = i < nivel ? `on n${nivel}` : ""; });
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { senha, confirmar } = dadosDe(form);
    if (senha !== confirmar) return mostrarErros(form, { message: "As senhas não são iguais.", campos: { confirmar: "As senhas não são iguais." } });
    await ocupado(form.querySelector("button[type=submit]"), async () => {
      try {
        await redefinirSenha(senha);
        toast("Senha alterada! Você já está na sua conta.");
        ctx.ir("/", { substituir: true });
      } catch (erro) {
        mostrarErros(form, erro, (m) => toast(m, "erro"));
      }
    });
  });
}
