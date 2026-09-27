/* PÁGINA — minha conta (administrador): nome e senha */
import { html, montar } from "/src/scripts/base/html.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api } from "../nucleo/api.js";
import { emitir, estado } from "../nucleo/estado.js";
import { cabecalhoPagina } from "../componentes/pagina.js";

export function conta(ctx) {
  const u = estado.usuario;
  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Minha conta", descricao: "Seus dados de acesso ao painel." })}
    <div class="coluna-form">
      <form class="cartao" id="f-dados" novalidate>
        <div class="cartao__cab"><h2>Dados</h2></div>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "nome", rotulo: "Nome", valor: u.nome, obrigatorio: true, atributos: 'maxlength="80"' })}
        ${campo({ nome: "email", rotulo: "E-mail", valor: u.email, atributos: "readonly" })}
        <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
      </form>

      <form class="cartao" id="f-senha" novalidate>
        <div class="cartao__cab"><h2>Trocar senha</h2></div>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "atual", rotulo: "Senha atual", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
        ${campo({ nome: "nova", rotulo: "Nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"', ajuda: "Mínimo de 8 caracteres, com letras e números. As outras sessões abertas serão encerradas." })}
        <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Trocar senha</button></div>
      </form>
    </div>`);

  const dados = ctx.raiz.querySelector("#f-dados");
  const senha = ctx.raiz.querySelector("#f-senha");
  ativarCampos(dados);
  ativarCampos(senha);

  dados.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(dados.querySelector("[type=submit]"), async () => {
      try {
        estado.usuario = (await api.put("/conta", { nome: dadosDe(dados).nome })).usuario;
        emitir("contagem"); // redesenha o menu com o novo nome
        toast("Dados atualizados!");
      } catch (erro) { mostrarErros(dados, erro, (m) => toast(m, "erro")); }
    });
  });

  senha.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(senha.querySelector("[type=submit]"), async () => {
      try { await api.put("/conta/senha", dadosDe(senha)); senha.reset(); toast("Senha alterada com sucesso!"); }
      catch (erro) { mostrarErros(senha, erro, (m) => toast(m, "erro")); }
    });
  });
}
