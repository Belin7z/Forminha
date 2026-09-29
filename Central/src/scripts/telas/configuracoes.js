/* TELA — Configurações (só o dono): cobrança, conexões, conta, senha de acesso, segurança e cópias de segurança */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { api, aviso, quando } from "../nucleo.js";
import { abrirSeguranca } from "./seguranca.js";

/** Baixa um JSON como arquivo. */
function baixarJson(nome, dados) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export { baixarJson };

const item = (ligado, titulo, como) => html`
  <li class="conexao ${ligado ? "conexao--on" : ""}">
    <span class="conexao__ponto" aria-hidden="true"></span>
    <div><strong>${titulo}</strong>${!ligado && html`<small>${como}</small>`}</div>
    <span class="selo selo--${ligado ? "sucesso" : "neutro"}">${ligado ? "Ligado" : "Desligado"}</span>
  </li>`;

export async function telaConfiguracoes(conteiner, eu) {
  document.title = "Configurações — Forminha";
  const r = eu.recursos ?? {};
  const webhook = `${location.origin}/api/webhook/mercadopago`;
  let cfg = null;
  if (r.clientes) { try { cfg = await api("GET", "configuracoes"); } catch { /* mostra só as conexões */ } }
  const conta = await api("GET", "conta").catch(() => ({ nome: "", email: "", usuario: "" }));

  montar(conteiner, html`
    <div class="central__titulo"><div><h1>Configurações</h1></div></div>
    <div class="config-grade">
      ${cfg ? html`
        <form class="cartao" id="f-cobranca" novalidate>
          <div class="cartao__cab"><h2>Cobrança</h2></div>
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "valor", rotulo: "Valor da loja (R$)", mascara: "moeda", valor: cfg.valor_padrao_centavos ? emReais(cfg.valor_padrao_centavos) : "" })}
          ${campo({ nome: "pix_chave", rotulo: "Chave PIX", valor: cfg.pix.chave, placeholder: "CPF, CNPJ, e-mail, celular ou aleatória", atributos: 'maxlength="77"' })}
          ${campo({ nome: "pix_nome", rotulo: "Nome no PIX", valor: cfg.pix.nome, atributos: 'maxlength="25"' })}
          ${campo({ nome: "pix_cidade", rotulo: "Cidade", valor: cfg.pix.cidade, atributos: 'maxlength="15"' })}
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
        </form>` : html`
        <section class="cartao">
          <div class="cartao__cab"><h2>Cobrança</h2></div>
          ${aviso("aviso", "Ligue o banco e a criptografia (Conexões).")}
        </section>`}

      <section class="cartao">
        <div class="cartao__cab"><h2>Conexões</h2></div>
        <ul class="conexoes">
          ${item(r.clientes, "Banco da Central", html`Vercel → Storage → Neon.`)}
          ${item(r.clientes, "Criptografia", html`<code>npm run configurar</code>`)}
          ${item(r.email, "E-mail (Gmail)", html`<code>npm run configurar</code>, opção 2.`)}
          ${item(r.mercado_pago, "PIX automático", html`Opcional: <code>npm run configurar</code>, opção 3.`)}
          ${r.mercado_pago && item(r.assinatura_mp, "Assinatura do Mercado Pago", html`<code>npm run configurar</code>, opção 3.`)}
        </ul>
        ${r.mercado_pago && html`
          <div class="bloco-link">
            <p class="bloco-link__rotulo">Webhook do Mercado Pago</p>
            <div class="convite-pronto__link"><code>${webhook}</code></div>
            <button type="button" class="btn btn--suave btn--pequeno" data-copiar="${webhook}">${icone("copiar", { tamanho: 15 })} Copiar</button>
          </div>`}
      </section>

      <form class="cartao" id="f-conta" novalidate>
        <div class="cartao__cab"><h2>Conta de acesso</h2></div>
        ${r.trocar_senha ? html`
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "nome", rotulo: "Seu nome", valor: conta.nome, placeholder: "Aparece no seu perfil", atributos: 'autocomplete="name" maxlength="60"' })}
          ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", valor: conta.email, obrigatorio: true, atributos: 'autocomplete="email"' })}
          ${campo({ nome: "usuario", rotulo: "Usuário (opcional)", valor: conta.usuario, placeholder: "ex.: ana", atributos: 'autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30"' })}
          ${campo({ nome: "senha", rotulo: "Senha atual", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>`
        : html`<dl class="dados-empilhados"><div><dt>E-mail</dt><dd>${conta.email || "—"}</dd></div></dl>`}
      </form>

      <form class="cartao" id="f-senha" novalidate>
        <div class="cartao__cab"><h2>Senha de acesso</h2></div>
        ${r.trocar_senha ? html`
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "atual", rotulo: "Senha atual", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
          ${campo({ nome: "nova", rotulo: "Nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password" minlength="8"', ajuda: "8 caracteres ou mais." })}
          ${campo({ nome: "repita", rotulo: "Repita a nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"' })}
          <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Trocar senha</button></div>`
        : aviso("aviso", "Ligue o banco da Central (Conexões).")}
      </form>

      ${r.trocar_senha && html`
      <section class="cartao">
        <div class="cartao__cab"><h2>Segurança e cópias</h2></div>
        <div class="config-seguranca">
          <div>
            <p><strong>Verificação em duas etapas</strong></p>
            <p class="texto-suave">Além da senha, o código do aplicativo no celular. Recomendado para você e para a equipe.</p>
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="seguranca">${icone("cadeado", { tamanho: 15 })} Segurança da conta</button>
          </div>
          <div>
            <p><strong>Cópia da Central</strong> <small class="texto-suave" data-ultimo-backup></small></p>
            <p class="texto-suave">Clientes, pagamentos, histórico, equipe e cupons num arquivo. Os dados pessoais continuam criptografados: guarde o arquivo junto com a <code>CHAVE_CRIPTOGRAFIA</code>. A Central lembra toda semana. A cópia de cada loja fica em Lojas → Cópia.</p>
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="backup">${icone("baixar", { tamanho: 15 })} Baixar cópia da Central</button>
          </div>
        </div>
      </section>`}
    </div>`);

  const ultimo = conteiner.querySelector("[data-ultimo-backup]");
  const mostrarUltimo = (em) => { if (ultimo) ultimo.textContent = em ? `· última em ${quando(em)}` : "· nenhuma ainda"; };
  if (ultimo) api("GET", "backup/situacao").then((s) => mostrarUltimo(s.ultimo_em)).catch(() => {});
  conteiner.addEventListener("click", async (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo) return;
    if (alvo.dataset.acao === "seguranca") return abrirSeguranca();
    if (alvo.dataset.acao === "backup") {
      await ocupado(alvo, async () => {
        try {
          const copia = await api("GET", "backup");
          baixarJson(`forminha-central-${copia.gerado_em.slice(0, 10)}.json`, copia);
          mostrarUltimo(copia.gerado_em);
          toast("Cópia baixada. Guarde em lugar seguro.");
        } catch (erro) { toast(erro.message, "erro"); }
      });
    }
  });

  const formSenha = conteiner.querySelector("#f-senha");
  const formConta = conteiner.querySelector("#f-conta");
  if (r.trocar_senha) {
    ativarCampos(formConta);
    formConta.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(formConta.querySelector("[type=submit]"), async () => {
        try {
          const salvo = await api("PUT", "conta", dadosDe(formConta));
          formConta.senha.value = "";
          toast("Salvo.");
          window.dispatchEvent(new Event("hashchange")); // o perfil no topo mostra o nome novo
        } catch (erro) { mostrarErros(formConta, erro); }
      });
    });
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
