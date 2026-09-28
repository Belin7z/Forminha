/* TELA — Configurações: valor da loja, sua chave PIX, o que está ligado (banco, criptografia, e-mail, Mercado Pago) e a senha de acesso */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { api, aviso } from "../nucleo.js";

const item = (ligado, titulo, texto, como) => html`
  <li class="conexao ${ligado ? "conexao--on" : ""}">
    <span class="conexao__ponto" aria-hidden="true"></span>
    <div><strong>${titulo}</strong><small>${ligado ? texto : como}</small></div>
    <span class="selo selo--${ligado ? "sucesso" : "neutro"}">${ligado ? "Ligado" : "Desligado"}</span>
  </li>`;

export async function telaConfiguracoes(conteiner, eu) {
  document.title = "Configurações — Forminha";
  const r = eu.recursos ?? {};
  const webhook = `${location.origin}/api/webhook/mercadopago`;
  let cfg = null;
  if (r.clientes) { try { cfg = await api("GET", "configuracoes"); } catch { /* mostra só as conexões */ } }

  montar(conteiner, html`
    <div class="central__titulo"><div><h1>Configurações</h1></div></div>
    <div class="config-grade">
      ${cfg ? html`
        <form class="cartao" id="f-cobranca" novalidate>
          <div class="cartao__cab"><h2>Cobrança</h2></div>
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "valor", rotulo: "Valor padrão da loja (R$)", mascara: "moeda", valor: cfg.valor_padrao_centavos ? emReais(cfg.valor_padrao_centavos) : "", ajuda: "Já vem preenchido ao cadastrar uma cliente (dá para mudar em cada uma)." })}
          ${campo({ nome: "pix_chave", rotulo: "Sua chave PIX", valor: cfg.pix.chave, placeholder: "CPF, CNPJ, e-mail, telefone ou chave aleatória", atributos: 'maxlength="77"' })}
          <div class="grade-2">
            ${campo({ nome: "pix_nome", rotulo: "Nome do recebedor", valor: cfg.pix.nome, atributos: 'maxlength="25"', ajuda: "Até 25 letras." })}
            ${campo({ nome: "pix_cidade", rotulo: "Cidade do recebedor", valor: cfg.pix.cidade, atributos: 'maxlength="15"', ajuda: "Até 15 letras, sem acento." })}
          </div>
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
        </form>` : html`
        <section class="cartao">
          <div class="cartao__cab"><h2>Cobrança</h2></div>
          ${aviso("aviso", "Para cadastrar clientes e cobrar, ligue o banco da Central e a criptografia (veja ao lado).")}
        </section>`}

      <section class="cartao">
        <div class="cartao__cab"><h2>Conexões</h2></div>
        <ul class="conexoes">
          ${item(r.clientes, "Banco da Central (Neon)", "Clientes e pagamentos guardados.", html`Na Vercel: projeto <strong>forminha</strong> → Storage → Create Database → Neon → conectar. Depois, publique de novo.`)}
          ${item(r.clientes, "Criptografia dos dados", "Dados pessoais cifrados com AES-256.", html`No computador, na pasta Central: <code>npm run configurar</code>.`)}
          ${item(r.email, "E-mail (Gmail)", "Cobranças e acessos saem do seu Gmail.", html`Crie uma “senha de app” no Google e rode <code>npm run configurar</code> (opção E-mail).`)}
          ${item(r.mercado_pago, "PIX automático (Mercado Pago)", "O pagamento se confirma sozinho.", html`Opcional. Com conta no Mercado Pago, rode <code>npm run configurar</code> (opção Mercado Pago). Sem ele, você confirma o PIX no painel.`)}
          ${r.mercado_pago && item(r.assinatura_mp, "Assinatura dos avisos do Mercado Pago", "Avisos falsos são recusados.", "Recomendado: cole a “assinatura secreta” do Mercado Pago no npm run configurar.")}
        </ul>
        ${r.mercado_pago && html`
          <div class="bloco-link">
            <p class="bloco-link__rotulo">Endereço para avisos (cole no Mercado Pago → Webhooks → Pagamentos)</p>
            <div class="convite-pronto__link"><code>${webhook}</code></div>
            <button type="button" class="btn btn--suave btn--pequeno" data-copiar="${webhook}">${icone("copiar", { tamanho: 15 })} Copiar</button>
          </div>`}
      </section>

      <form class="cartao" id="f-senha" novalidate>
        <div class="cartao__cab"><h2>Senha de acesso</h2></div>
        ${r.trocar_senha ? html`
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "atual", rotulo: "Senha atual", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
          <div class="grade-2">
            ${campo({ nome: "nova", rotulo: "Nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password" minlength="8"', ajuda: "8 caracteres ou mais." })}
            ${campo({ nome: "repita", rotulo: "Repita a nova", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"' })}
          </div>
          <p class="texto-suave">Quem estiver com a Central aberta em outro aparelho sai na hora. Esqueceu a senha? No computador, rode <code>npm run configurar</code> (opção 7).</p>
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Trocar senha</button></div>`
        : aviso("aviso", "Para trocar a senha por aqui, ligue o banco da Central (veja Conexões).")}
      </form>
    </div>`);

  const formSenha = conteiner.querySelector("#f-senha");
  if (r.trocar_senha) {
    ativarCampos(formSenha);
    formSenha.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(formSenha.querySelector("[type=submit]"), async () => {
        try {
          await api("POST", "senha", dadosDe(formSenha));
          formSenha.reset();
          toast("Senha trocada. Use a nova da próxima vez que entrar.");
        } catch (erro) { mostrarErros(formSenha, erro); }
      });
    });
  }

  const form = conteiner.querySelector("#f-cobranca");
  if (!form) return;
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(form);
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        await api("PUT", "configuracoes", { valor_padrao_centavos: paraCentavos(d.valor || "0"), pix: { chave: d.pix_chave, nome: d.pix_nome, cidade: d.pix_cidade } });
        toast("Configurações salvas.");
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}
