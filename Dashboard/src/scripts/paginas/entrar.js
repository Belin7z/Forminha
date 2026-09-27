/* PÁGINA — login do administrador */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { armazenamento } from "/src/scripts/base/armazenamento.js";
import { api } from "../nucleo/api.js";
import { nomeDaLoja, seloDaLoja } from "../componentes/marca.js";

/** Depois de 5 erros seguidos, espera 30 s (dobra a cada nova rodada, até 5 min). O Supabase também limita; isto evita insistência. */
const FALHAS = "zqp.login-falhas";
const espera = () => Math.max(0, Math.ceil(((armazenamento.ler(FALHAS, {}).ate ?? 0) - Date.now()) / 1000));
function registrarFalha() {
  const f = armazenamento.ler(FALHAS, { n: 0, rodadas: 0 });
  f.n += 1;
  if (f.n >= 5) { f.rodadas += 1; f.ate = Date.now() + Math.min(300, 30 * 2 ** (f.rodadas - 1)) * 1000; f.n = 0; }
  armazenamento.gravar(FALHAS, f);
}

const URL_LOJA = String(window.CONFIG_APP?.urlLoja ?? "").replace(/\/+$/, "");

/** Desenha a tela de login. `aoEntrar(usuario)` é chamado com o administrador autenticado. */
export function mostrarLogin({ aviso = "", aoEntrar }) {
  const raiz = document.getElementById("raiz");
  document.title = `Entrar — ${nomeDaLoja()}`;
  montar(raiz, html`
    <div class="login">
      <div class="login__caixa">
        ${seloDaLoja("login__logo")}
        <h1>${nomeDaLoja()}</h1>
        <p class="login__subtitulo">Painel da loja</p>
        <p class="texto-suave">Acesso restrito à equipe.</p>
        ${aviso && html`<div class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>${aviso}</span></div>`}
        <form id="form-login" novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true, atributos: 'autocomplete="username" autofocus' })}
          ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
          <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar</button>
        </form>
        ${URL_LOJA && html`<p class="login__rodape"><a href="${URL_LOJA}/#/recuperar" class="link" rel="noopener">Esqueci minha senha</a></p>`}
        <p class="login__rodape">${icone("cadeado", { tamanho: 14 })} Conexão protegida</p>
      </div>
    </div>`);

  const form = raiz.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const aguardar = espera();
    if (aguardar > 0) return mostrarErros(form, { message: `Muitas tentativas. Aguarde ${aguardar} segundos e tente de novo.`, campos: null });
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        const { usuario } = await api.post("/auth/entrar", dadosDe(form));
        armazenamento.remover(FALHAS);
        aoEntrar(usuario);
      } catch (erro) {
        if (erro.status === 401 || erro.status === 422) registrarFalha();
        mostrarErros(form, erro);
      }
    });
  });
}
