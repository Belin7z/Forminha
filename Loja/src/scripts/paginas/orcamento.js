/* ==========================================================
   PÁGINA — encomenda por orçamento: o cliente conta o que quer
   (tema, sabor, para quantos, data), manda até 3 fotos de
   referência e a loja responde com o valor. Em "Minha conta →
   Orçamentos" ele vê a proposta e aceita (vira um pedido).
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, dataBR, dataHora, enderecoEmLinha } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { FORMAS_PAGAMENTO } from "/src/scripts/base/dominio.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";
import { exigirLogin } from "../nucleo/sessao.js";
import { abrirFormEndereco } from "../componentes/endereco-form.js";

const MAX_FOTOS = 3;
export const STATUS_ORCAMENTO = {
  novo: ["badge--aviso", "Aguardando a resposta da loja"],
  respondido: ["badge--info", "Proposta recebida"],
  aceito: ["badge--sucesso", "Aceito — virou pedido"],
  recusado: ["badge--neutro", "A loja não pôde atender"],
  cancelado: ["badge--neutro", "Cancelado"],
};

export const orcamentoAtivo = () => estado.config.orcamento?.ativo !== false;

/** Reduz a foto no aparelho (as fotos de celular têm vários MB) e devolve um data URL JPEG de até ~300 KB. */
function reduzirFoto(arquivo) {
  return new Promise((ok, falhar) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(arquivo.type)) return falhar(new Error("Envie fotos em JPG, PNG ou WEBP."));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); falhar(new Error("Não foi possível abrir esta foto.")); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      for (const [lado, qualidade] of [[1100, 0.8], [900, 0.72], [700, 0.65]]) {
        const escala = Math.min(1, lado / Math.max(img.width, img.height));
        const tela = document.createElement("canvas");
        tela.width = Math.round(img.width * escala); tela.height = Math.round(img.height * escala);
        const c = tela.getContext("2d");
        c.fillStyle = "#fff"; c.fillRect(0, 0, tela.width, tela.height);
        c.drawImage(img, 0, 0, tela.width, tela.height);
        const dados = tela.toDataURL("image/jpeg", qualidade);
        if (dados.length <= 420000) return ok(dados);
      }
      falhar(new Error("Esta foto é grande demais. Tente outra."));
    };
    img.src = url;
  });
}

/* ---------- Pedir um orçamento ---------- */
export async function paginaOrcamento(ctx) {
  if (!orcamentoAtivo()) {
    montar(ctx.raiz, html`<section class="container pagina-simples"><div class="vazio"><span class="vazio__ico">${icone("documento", { tamanho: 38 })}</span>
      <h3>Esta loja não está recebendo orçamentos agora</h3><p>Veja o cardápio ou fale com a loja.</p><a href="#/cardapio" class="btn btn--primario">Ver cardápio</a></div></section>`);
    return;
  }
  if (!exigirLogin(ctx, "Entre na sua conta para pedir um orçamento.")) return;
  const { entrega, pedidos, orcamento } = estado.config;
  const dias = Math.max(1, Math.ceil((pedidos.antecedencia_horas ?? 24) / 24));
  const minimo = (() => { const d = new Date(); d.setDate(d.getDate() + dias); return dataISO(d); })();
  let enderecos = [];
  if (entrega.entrega_ativa) enderecos = (await api.get("/enderecos").catch(() => ({ enderecos: [] }))).enderecos;
  if (!ctx.ativo()) return;
  const fotos = [];
  const tipos = [entrega.retirada_ativa && ["retirada", "Vou retirar na loja"], entrega.entrega_ativa && ["entrega", "Quero receber em casa"]].filter(Boolean);

  montar(ctx.raiz, html`
    <section class="container pagina-orcamento">
      <header class="pagina-cab">
        <h1>Encomenda <span class="script">personalizada</span></h1>
        <p class="texto-suave">${orcamento?.texto || "Conte o que você imagina: tema, sabores, para quantas pessoas. A loja responde com o valor e você decide."}</p>
      </header>
      <form id="form-orcamento" class="cartao-form orcamento-form" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "descricao", rotulo: "O que você quer encomendar?", tipo: "textarea", linhas: 5, obrigatorio: true, atributos: 'maxlength="1500"',
          placeholder: "Ex.: bolo de 2 andares para aniversário de 5 anos, tema jardim, massa branca com recheio de ninho e morango. Cores rosa e verde." })}
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "quantidade", rotulo: "Para quantas pessoas (ou quantas unidades)?", atributos: 'maxlength="80"', placeholder: "Ex.: 40 pessoas" })}
          ${campo({ nome: "data_desejada", rotulo: "Para quando?", tipo: "date", obrigatorio: true, valor: minimo, atributos: `min="${minimo}"`,
            ajuda: `A loja pede ao menos ${dias === 1 ? "1 dia" : `${dias} dias`} de antecedência.` })}
        </div>
        <fieldset class="orcamento-form__tipo"><legend>Como você vai receber?</legend>
          ${tipos.map(([valor, texto], i) => html`<label class="opcao"><input type="radio" name="tipo" value="${valor}" ${i === 0 && "checked"}><span class="opcao__marca"></span><span class="opcao__texto"><strong>${texto}</strong></span></label>`)}
        </fieldset>
        <div class="campo" data-endereco hidden>
          <label for="endereco_id">Endereço de entrega</label>
          <div class="linha-flex">
            <select id="endereco_id" name="endereco_id" class="entrada">${enderecos.map((e) => html`<option value="${e.id}" ${e.principal && "selected"}>${e.apelido} — ${enderecoEmLinha(e)}</option>`)}</select>
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="novo-endereco">${icone("mais", { tamanho: 15 })} Novo</button>
          </div>
        </div>
        ${campo({ nome: "verba", rotulo: "Quanto pretende gastar? (opcional)", atributos: 'maxlength="60"', placeholder: "Ex.: até R$ 300" })}
        <div class="campo">
          <label>Fotos de referência <span class="texto-suave">(opcional, até ${MAX_FOTOS})</span></label>
          <div class="orcamento-fotos" data-fotos></div>
        </div>
        <button type="submit" class="btn btn--primario btn--grande">${icone("mensagem", { tamanho: 18 })} Pedir orçamento</button>
        <p class="texto-suave orcamento-form__nota">Pedir orçamento é grátis e não obriga a nada. A resposta aparece em <a class="link" href="#/conta/orcamentos">Minha conta → Orçamentos</a>.</p>
      </form>
    </section>`);

  const form = ctx.raiz.querySelector("form");
  ativarCampos(form);
  const caixaFotos = form.querySelector("[data-fotos]");
  const blocoEndereco = form.querySelector("[data-endereco]");

  function desenharFotos() {
    montar(caixaFotos, html`${fotos.map((f, i) => html`<figure class="orcamento-fotos__foto"><img src="${f}" alt="Foto de referência ${i + 1}">
        <button type="button" class="btn-icone btn-icone--pequeno" data-acao="tirar-foto" data-i="${i}" aria-label="Tirar a foto ${i + 1}">${icone("x", { tamanho: 14 })}</button></figure>`)}
      ${fotos.length < MAX_FOTOS && html`<label class="orcamento-fotos__nova">${icone("imagem", { tamanho: 22 })}<span>Adicionar foto</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-arquivo></label>`}`);
  }
  const mostrarEndereco = () => { blocoEndereco.hidden = form.elements.tipo?.value !== "entrega"; };

  desenharFotos();
  mostrarEndereco();
  form.addEventListener("change", async (ev) => {
    if (ev.target.name === "tipo") mostrarEndereco();
    if (!ev.target.matches("[data-arquivo]")) return;
    for (const arquivo of [...ev.target.files].slice(0, MAX_FOTOS - fotos.length)) {
      try { fotos.push(await reduzirFoto(arquivo)); } catch (erro) { toast(erro.message, "erro"); }
    }
    desenharFotos();
  });
  delegar(form, {
    "tirar-foto": (el) => { fotos.splice(Number(el.dataset.i), 1); desenharFotos(); },
    "novo-endereco": () => abrirFormEndereco({
      aoSalvar: (lista) => {
        enderecos = lista;
        const novo = lista.reduce((a, b) => (a.id > b.id ? a : b));
        montar(form.elements.endereco_id, html`${lista.map((e) => html`<option value="${e.id}" ${e.id === novo.id && "selected"}>${e.apelido} — ${enderecoEmLinha(e)}</option>`)}`);
      },
    }),
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(form);
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        await api.post("/orcamentos", { ...d, endereco_id: d.tipo === "entrega" ? Number(d.endereco_id) || null : null, fotos });
        montar(ctx.raiz, html`
          <section class="container pagina-simples"><div class="vazio vazio--largo">
            <span class="vazio__ico">${icone("check", { tamanho: 38 })}</span>
            <h3>Pedido de orçamento enviado!</h3>
            <p>A loja vai olhar com carinho e responder com o valor. Você acompanha em Minha conta → Orçamentos.</p>
            <a href="#/conta/orcamentos" class="btn btn--primario">Ver meus orçamentos</a>
          </div></section>`);
        window.scrollTo({ top: 0 });
      } catch (erro) { mostrarErros(form, erro, (m) => toast(m, "erro")); }
    });
  });
}

/* ---------- Minha conta → Orçamentos ---------- */
function formasDisponiveis() {
  const pg = estado.config.pagamento ?? {};
  return [(pg.pix_ativo || pg.pix_automatico) && "pix", pg.dinheiro_ativo && "dinheiro", pg.cartao_ativo && "cartao_entrega"].filter(Boolean);
}

function cartaoOrcamento(o) {
  const [classe, texto] = STATUS_ORCAMENTO[o.status] ?? STATUS_ORCAMENTO.novo;
  const r = o.resposta ?? {};
  const formas = formasDisponiveis();
  return html`
    <article class="orcamento-card orcamento-card--${o.status}">
      <header class="orcamento-card__cab">
        <strong>Orçamento #${o.id}</strong>
        <span class="badge ${classe}">${texto}</span>
        <small class="texto-suave">${dataHora(o.criado_em)}</small>
      </header>
      <p class="orcamento-card__desc">${o.descricao}</p>
      <p class="texto-suave orcamento-card__meta">${icone("calendario", { tamanho: 14 })} Para ${dataBR(o.data_desejada)}${o.quantidade && ` · ${o.quantidade}`} · ${o.tipo === "entrega" ? "Entrega" : "Retirada"}${o.n_fotos > 0 ? ` · ${o.n_fotos} foto${o.n_fotos > 1 ? "s" : ""}` : ""}</p>
      ${o.status === "respondido" && html`
        <div class="orcamento-card__proposta">
          ${r.titulo && html`<strong class="orcamento-card__titulo">${r.titulo}</strong>`}
          <dl class="resumo__totais resumo__totais--compacto">
            <div><dt>Encomenda</dt><dd>${brl(r.valor)}</dd></div>
            ${r.taxa_entrega > 0 && html`<div><dt>Entrega</dt><dd>${brl(r.taxa_entrega)}</dd></div>`}
            <div class="resumo__total"><dt>Total</dt><dd>${brl(r.total)}</dd></div>
            ${r.sinal > 0 && html`<div><dt>Sinal para confirmar</dt><dd>${brl(r.sinal)}</dd></div>`}
          </dl>
          <p>${icone("relogio", { tamanho: 15 })} <strong>${dataBR(r.data)} às ${r.hora}</strong></p>
          <p class="texto-suave">Proposta válida até ${dataBR(r.valido_ate)}.</p>
          ${r.mensagem && html`<p class="orcamento-card__mensagem">“${r.mensagem}”</p>`}
          <div class="orcamento-card__aceitar">
            <label class="campo"><span>Como vai pagar?</span>
              <select class="entrada" data-pagamento="${o.id}">${formas.map((f) => html`<option value="${f}">${FORMAS_PAGAMENTO[f]}</option>`)}</select></label>
            <button type="button" class="btn btn--primario" data-acao="aceitar" data-id="${o.id}">${icone("check", { tamanho: 16 })} Aceitar e fazer o pedido</button>
          </div>
        </div>`}
      ${o.status === "recusado" && r.mensagem && html`<p class="orcamento-card__mensagem">Recado da loja: “${r.mensagem}”</p>`}
      ${o.status === "aceito" && o.pedido && html`<a class="btn btn--suave btn--pequeno" href="#/pedido/${o.pedido.codigo}">${icone("pacote", { tamanho: 15 })} Ver o pedido ${o.pedido.codigo}</a>`}
      ${["novo", "respondido"].includes(o.status) && html`<button type="button" class="link orcamento-card__cancelar" data-acao="cancelar" data-id="${o.id}">${o.status === "novo" ? "Cancelar o pedido de orçamento" : "Não quero, obrigado(a)"}</button>`}
    </article>`;
}

export async function abaOrcamentos(alvo, ctx) {
  let { orcamentos } = await api.get("/orcamentos");
  if (!ctx.ativo()) return;
  const desenhar = () => montar(alvo, html`
    <div class="cartao-form">
      <div class="cartao-form__cab"><h2>Meus orçamentos</h2>
        ${orcamentoAtivo() && html`<a class="btn btn--primario btn--pequeno" href="#/orcamento">${icone("mais", { tamanho: 16 })} Pedir orçamento</a>`}</div>
      ${orcamentos.length ? html`<div class="lista-orcamentos">${orcamentos.map(cartaoOrcamento)}</div>`
        : html`<div class="vazio"><span class="vazio__ico">${icone("documento", { tamanho: 38 })}</span><h3>Nenhum orçamento ainda</h3>
            <p>Quer algo que não está no cardápio? Peça um orçamento e a loja responde com o valor.</p>
            ${orcamentoAtivo() && html`<a href="#/orcamento" class="btn btn--primario">Pedir orçamento</a>`}</div>`}
    </div>`);
  desenhar();

  delegar(alvo, {
    aceitar: async (botao) => {
      const id = Number(botao.dataset.id);
      const pagamento = alvo.querySelector(`[data-pagamento="${id}"]`)?.value;
      if (!pagamento) return toast("Esta loja ainda não configurou as formas de pagamento. Fale com a loja.", "info");
      await ocupado(botao, async () => {
        try {
          const { pedido } = await api.post(`/orcamentos/${id}/aceitar`, { pagamento });
          toast("Pedido feito! Confira o pagamento.");
          ctx.ir(`/pedido/${pedido.codigo}`);
        } catch (erro) { toast(erro.message, "erro"); }
      });
    },
    cancelar: async (botao) => {
      if (!(await confirmar({ titulo: "Cancelar orçamento", mensagem: "A loja deixa de preparar a proposta (ou a proposta é descartada).", rotulo: "Cancelar orçamento", perigo: true }))) return;
      try {
        const { orcamento } = await api.post(`/orcamentos/${botao.dataset.id}/cancelar`);
        orcamentos = orcamentos.map((o) => (o.id === orcamento.id ? orcamento : o));
        desenhar();
      } catch (erro) { toast(erro.message, "erro"); }
    },
  });
}
