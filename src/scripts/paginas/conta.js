/* PÁGINA — minha conta: dados, endereços, pedidos e senha */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, dataBR, dataHora, enderecoEmLinha, iniciais, plural, telefone } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { emitir, estado } from "../nucleo/estado.js";
import { exigirLogin, sair } from "../nucleo/sessao.js";
import { abrirFormEndereco, resumoDeEntrega } from "../componentes/endereco-form.js";
import { carregando } from "../componentes/carregando.js";

const ABAS = [
  ["dados", "Meus dados", "usuario"],
  ["enderecos", "Endereços", "pino"],
  ["pedidos", "Pedidos", "pacote"],
  ["senha", "Senha", "cadeado"],
  ["privacidade", "Privacidade", "info"],
];

/* ---------- Aba: dados ---------- */
function abaDados(alvo) {
  const u = estado.usuario;
  montar(alvo, html`
    <form id="form-dados" class="cartao-form" novalidate>
      <h2>Meus dados</h2>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "nome", rotulo: "Nome completo", valor: u.nome, obrigatorio: true, atributos: 'maxlength="80"' })}
      <div class="grade-campos grade-campos--2">
        ${campo({ nome: "email", rotulo: "E-mail", valor: u.email, atributos: "readonly", ajuda: "O e-mail não pode ser alterado." })}
        ${campo({ nome: "telefone", rotulo: "WhatsApp / telefone", valor: u.telefone, tipo: "tel", obrigatorio: true, mascara: "telefone" })}
      </div>
      ${interruptor({ nome: "avisos_whatsapp", rotulo: "Receber avisos do pedido pelo WhatsApp", marcado: u.avisos_whatsapp !== false,
        ajuda: "Mandamos uma mensagem quando o pedido for confirmado, ficar pronto ou sair para entrega. Você pode desligar quando quiser." })}
      <button type="submit" class="btn btn--primario">Salvar alterações</button>
    </form>`);
  const form = alvo.querySelector("form");
  ativarCampos(form);
  // a preferência de avisos vale na hora, sem precisar salvar o resto
  form.elements.avisos_whatsapp.addEventListener("change", async (ev) => {
    try {
      estado.usuario = (await api.put("/conta/preferencias", { avisos_whatsapp: ev.target.checked })).usuario;
      emitir("usuario");
      toast(ev.target.checked ? "Avisos pelo WhatsApp ligados." : "Avisos pelo WhatsApp desligados.", "info");
    } catch (erro) { ev.target.checked = !ev.target.checked; toast(erro.message, "erro"); }
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        const { nome, telefone: tel } = dadosDe(form);
        estado.usuario = (await api.put("/conta", { nome, telefone: tel })).usuario;
        emitir("usuario");
        toast("Dados atualizados!");
      } catch (erro) { mostrarErros(form, erro, (m) => toast(m, "erro")); }
    });
  });
}

/* ---------- Aba: endereços ---------- */
async function abaEnderecos(alvo, ctx) {
  let enderecos = (await api.get("/enderecos")).enderecos;
  if (!ctx.ativo()) return;

  function desenhar() {
    montar(alvo, html`
      <div class="cartao-form">
        <div class="cartao-form__cab"><h2>Meus endereços</h2>
          <button type="button" class="btn btn--primario btn--pequeno" data-acao="novo">${icone("mais", { tamanho: 16 })} Novo endereço</button></div>
        ${enderecos.length ? html`<ul class="lista-enderecos">${enderecos.map((e) => html`
          <li class="endereco-card">
            <div class="endereco-card__topo">
              <strong>${icone("pino", { tamanho: 17 })} ${e.apelido}</strong>
              ${e.principal && html`<span class="badge badge--sucesso">Principal</span>`}
            </div>
            <p>${enderecoEmLinha(e)}</p>
            <small class="texto-suave">CEP ${e.cep}${e.referencia && ` · ${e.referencia}`}</small>
            <small class="endereco-card__entrega">${resumoDeEntrega(e.lat, e.lng)}</small>
            <div class="endereco-card__acoes">
              <button type="button" class="btn btn--suave btn--pequeno" data-acao="editar" data-id="${e.id}">${icone("editar", { tamanho: 14 })} Editar</button>
              ${!e.principal && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="principal" data-id="${e.id}">Tornar principal</button>`}
              <button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao="excluir" data-id="${e.id}">${icone("lixeira", { tamanho: 14 })} Excluir</button>
            </div>
          </li>`)}</ul>`
        : html`<div class="vazio"><span class="vazio__ico">${icone("pino", { tamanho: 38 })}</span><h3>Nenhum endereço salvo</h3><p>Salve seus endereços para pedir com muito mais rapidez.</p></div>`}
      </div>`);
  }

  const aoSalvar = (lista) => { enderecos = lista; desenhar(); };
  desenhar();

  delegar(alvo, {
    novo: () => abrirFormEndereco({ aoSalvar }),
    editar: (el) => abrirFormEndereco({ endereco: enderecos.find((e) => e.id === Number(el.dataset.id)), aoSalvar }),
    principal: async (el) => {
      const e = enderecos.find((x) => x.id === Number(el.dataset.id));
      try { aoSalvar((await api.put(`/enderecos/${e.id}`, { ...e, principal: true })).enderecos); toast("Endereço principal atualizado."); }
      catch (erro) { toast(erro.message, "erro"); }
    },
    excluir: async (el) => {
      const e = enderecos.find((x) => x.id === Number(el.dataset.id));
      if (!(await confirmar({ titulo: "Excluir endereço", mensagem: `Remover “${e.apelido}” da sua conta?`, rotulo: "Excluir", perigo: true }))) return;
      try { aoSalvar((await api.delete(`/enderecos/${e.id}`)).enderecos); toast("Endereço removido."); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
}

/* ---------- Aba: pedidos ---------- */
async function abaPedidos(alvo, ctx) {
  const { pedidos } = await api.get("/pedidos");
  if (!ctx.ativo()) return;
  montar(alvo, html`
    <div class="cartao-form">
      <h2>Meus pedidos</h2>
      ${pedidos.length ? html`<ul class="lista-pedidos">${pedidos.map((p) => html`
        <li><a class="pedido-linha" href="#/pedido/${p.codigo}">
          <div><strong>${p.codigo}</strong><small class="texto-suave">${dataHora(p.criado_em)} · ${plural(p.qtd_itens, "item", "itens")}</small></div>
          <div class="pedido-linha__meio"><span class="status status--${p.status}">${p.status_texto}</span>
            <small class="texto-suave">${icone(p.tipo === "entrega" ? "caminhao" : "sacola", { tamanho: 14 })} ${dataBR(p.data)} às ${p.hora}</small></div>
          <div class="pedido-linha__fim"><strong>${brl(p.total)}</strong>${icone("direita", { tamanho: 18 })}</div>
        </a></li>`)}</ul>`
      : html`<div class="vazio"><span class="vazio__ico">${icone("documento", { tamanho: 38 })}</span><h3>Você ainda não fez pedidos</h3><p>Quando fizer, você acompanha tudo por aqui.</p><a href="#/cardapio" class="btn btn--primario">Ver cardápio</a></div>`}
    </div>`);
}

/* ---------- Aba: senha ---------- */
function abaSenha(alvo) {
  montar(alvo, html`
    <form id="form-senha" class="cartao-form" novalidate>
      <h2>Trocar senha</h2>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "atual", rotulo: "Senha atual", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password"' })}
      ${campo({ nome: "nova", rotulo: "Nova senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="new-password"', ajuda: "Mínimo de 8 caracteres, com letras e números." })}
      <button type="submit" class="btn btn--primario">Trocar senha</button>
    </form>`);
  const form = alvo.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try { await api.put("/conta/senha", dadosDe(form)); form.reset(); toast("Senha alterada com sucesso!"); }
      catch (erro) { mostrarErros(form, erro, (m) => toast(m, "erro")); }
    });
  });
}

/* ---------- Aba: privacidade (LGPD) ---------- */
function abaPrivacidade(alvo) {
  montar(alvo, html`
    <section class="cartao-form">
      <h2>Seus dados</h2>
      <p class="texto-suave">Os dados são seus. Baixe uma cópia de tudo o que guardamos (cadastro, endereços, pedidos, favoritos e avaliações) em um arquivo. Veja também a <a href="#/privacidade" class="link">Política de Privacidade</a>.</p>
      <button type="button" class="btn btn--contorno" data-acao="baixar">${icone("baixar", { tamanho: 17 })} Baixar meus dados</button>
    </section>
    <section class="cartao-form cartao-form--perigo">
      <h2>Excluir minha conta</h2>
      <p class="texto-suave">Apagamos seu cadastro, endereços, favoritos e avaliações. Os pedidos já feitos ficam só como registro de venda da loja, <strong>sem seu nome, telefone ou endereço</strong>. Não dá para desfazer.</p>
      <button type="button" class="btn btn--perigo-suave" data-acao="excluir">Excluir minha conta</button>
    </section>`);

  delegar(alvo, {
    baixar: async (botao) => {
      await ocupado(botao, async () => {
        try {
          const dados = await api.get("/conta/dados");
          const arquivo = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(arquivo);
          link.download = "meus-dados.json";
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(link.href), 2000);
          toast("Arquivo baixado.");
        } catch (erro) { toast(erro.message, "erro"); }
      });
    },
    excluir: () => {
      const m = abrirModal({
        titulo: "Excluir minha conta", largura: 460,
        corpo: html`<form id="form-excluir" novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          <p class="texto-suave">Para confirmar, digite a sua senha. Depois disso não há como recuperar a conta.</p>
          ${campo({ nome: "senha", rotulo: "Sua senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password" autofocus' })}</form>`,
        rodape: html`<button type="button" class="btn btn--suave" data-fechar>Voltar</button>
          <button type="submit" form="form-excluir" class="btn btn--perigo" data-confirmar>Excluir para sempre</button>`,
      });
      const form = m.el.querySelector("form");
      ativarCampos(form);
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await ocupado(m.el.querySelector("[data-confirmar]"), async () => {
          try {
            await api.post("/conta/excluir", { senha: dadosDe(form).senha });
            m.fechar();
            await sair().catch(() => {});
            toast("Sua conta foi excluída.", "info");
            location.hash = "#/";
          } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
        });
      });
    },
  });
}

export async function conta(ctx) {
  if (!exigirLogin(ctx)) return;
  const aba = ABAS.some(([id]) => id === ctx.params.aba) ? ctx.params.aba : "dados";
  const u = estado.usuario;

  montar(ctx.raiz, html`
    <section class="container conta">
      <header class="conta__cab">
        <span class="avatar avatar--grande">${iniciais(u.nome)}</span>
        <div><h1>Olá, ${u.nome.split(" ")[0]}!</h1><p class="texto-suave">${u.email} · ${telefone(u.telefone)}</p></div>
      </header>
      <nav class="abas" aria-label="Minha conta">
        ${ABAS.map(([id, texto, ic]) => html`<a href="#/conta/${id}" class="aba ${id === aba && "aba--ativa"}">${icone(ic, { tamanho: 17 })} ${texto}</a>`)}
      </nav>
      <div id="conteudo-aba">${carregando}</div>
    </section>`);

  const alvo = ctx.raiz.querySelector("#conteudo-aba");
  try {
    if (aba === "dados") abaDados(alvo);
    else if (aba === "enderecos") await abaEnderecos(alvo, ctx);
    else if (aba === "pedidos") await abaPedidos(alvo, ctx);
    else if (aba === "privacidade") abaPrivacidade(alvo);
    else abaSenha(alvo);
  } catch (erro) {
    if (ctx.ativo()) montar(alvo, html`<div class="aviso aviso--perigo">${erro.message}</div>`);
  }
}
