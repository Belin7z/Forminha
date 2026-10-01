/* PÁGINA — novo pedido lançado pela equipe: encomendas que chegam por WhatsApp, telefone ou balcão */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, paraCentavos, plural, telefone } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { descricaoDaSelecao, extrasDaSelecao, faltandoNaSelecao, nomeComQuantidade } from "/src/scripts/base/opcoes.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina } from "../componentes/pagina.js";

export async function novoPedido(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let produtos, categorias;
  try {
    [produtos, categorias] = await Promise.all([api.get("/produtos").then((r) => r.produtos), api.get("/categorias").then((r) => r.categorias)]);
  } catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  const e = { modo: "conta", cliente: null, itens: [], resultados: [] };
  const agendas = new Map(); // "2026-09" -> resposta de /agenda
  let temporizador;
  const hoje = dataISO(new Date());

  montar(ctx.raiz, html`
    ${cabecalhoPagina({
      titulo: "Novo pedido", descricao: "Lance aqui as encomendas que chegam por WhatsApp, telefone ou balcão. O sistema confere os valores e o pedido entra na agenda e na produção.",
      acoes: html`<a href="#/pedidos" class="btn btn--suave">${icone("voltar", { tamanho: 16 })} Voltar</a>`,
    })}
    <form id="form-pedido" class="novo-pedido" novalidate>
      <div class="novo-pedido__passos">
        <section class="cartao">
          <h2 class="cartao__titulo">1. Cliente</h2>
          <div class="segmentos" role="group" aria-label="Tipo de cliente">
            <button type="button" class="segmento" data-acao="modo" data-modo="conta">Cliente cadastrado</button>
            <button type="button" class="segmento" data-acao="modo" data-modo="avulso">Sem cadastro</button>
          </div>
          <div id="cliente-conta">
            <div class="busca"><input type="search" id="busca-cliente" placeholder="Buscar por nome, e-mail ou telefone…" aria-label="Buscar cliente" autocomplete="off">${icone("busca", { tamanho: 18 })}</div>
            <div id="cliente-escolhido"></div>
            <ul class="lista-escolha" id="resultados-cliente"></ul>
          </div>
          <div id="cliente-avulso" hidden>
            <div class="grade-campos grade-campos--2">
              ${campo({ nome: "nome", rotulo: "Nome do cliente", obrigatorio: true, atributos: 'maxlength="80"' })}
              ${campo({ nome: "telefone", rotulo: "Telefone / WhatsApp", tipo: "tel", mascara: "telefone", ajuda: "Opcional, mas ajuda a avisar o cliente." })}
            </div>
          </div>
        </section>

        <section class="cartao">
          <h2 class="cartao__titulo">2. Itens</h2>
          <div class="picker">
            <div class="campo"><label for="sel-produto">Produto do cardápio</label>
              <select id="sel-produto"><option value="">Escolha um produto…</option>
                ${categorias.map((c) => html`<optgroup label="${c.nome}">${produtos.filter((p) => p.categoria_id === c.id).map((p) =>
                  html`<option value="${p.id}">${p.nome} — ${brl(p.preco)}${p.ativo ? "" : " (pausado)"}</option>`)}</optgroup>`)}</select></div>
            <div id="opcoes-produto"></div>
            <div class="grade-campos grade-campos--2">
              <div class="campo"><label for="qtd-produto">Quantidade</label><input id="qtd-produto" class="entrada" type="number" min="1" max="999" value="1"></div>
              <div class="campo"><label for="obs-produto">Observação do item</label><input id="obs-produto" class="entrada" maxlength="200" placeholder="Ex.: escrever “Parabéns, Ana”"></div>
            </div>
            <button type="button" class="btn btn--suave" data-acao="add-produto">${icone("mais", { tamanho: 16 })} Adicionar ao pedido</button>
          </div>
          <details class="avulso">
            <summary>Item avulso <small class="texto-suave">— bolo personalizado ou encomenda com preço combinado</small></summary>
            <div class="grade-campos grade-campos--3">
              <div class="campo"><label for="av-nome">Descrição</label><input id="av-nome" class="entrada" maxlength="80" placeholder="Ex.: Bolo temático 2 kg"></div>
              <div class="campo"><label for="av-preco">Preço unitário (R$)</label><input id="av-preco" class="entrada" data-mascara="moeda" inputmode="decimal" value="0,00"></div>
              <div class="campo"><label for="av-qtd">Quantidade</label><input id="av-qtd" class="entrada" type="number" min="1" max="999" value="1"></div>
            </div>
            <button type="button" class="btn btn--suave" data-acao="add-avulso">${icone("mais", { tamanho: 16 })} Adicionar item avulso</button>
          </details>
          <ul class="itens-novo" id="lista-itens"></ul>
        </section>

        <section class="cartao">
          <h2 class="cartao__titulo">3. Recebimento e data</h2>
          ${campo({ nome: "tipo", rotulo: "Como o cliente recebe?", tipo: "select", valor: "retirada", opcoes: [{ valor: "retirada", texto: "Retirada na loja" }, { valor: "entrega", texto: "Entrega" }] })}
          <div id="bloco-entrega" hidden>
            ${campo({ nome: "endereco", rotulo: "Endereço de entrega", tipo: "textarea", linhas: 2, atributos: 'maxlength="200"', placeholder: "Rua, número, bairro, referência" })}
            ${campo({ nome: "taxa_entrega", rotulo: "Taxa de entrega (R$)", valor: "0,00", mascara: "moeda" })}
          </div>
          <div class="grade-campos grade-campos--2">
            ${campo({ nome: "data", rotulo: "Data", tipo: "date", valor: hoje, obrigatorio: true })}
            ${campo({ nome: "hora", rotulo: "Horário", tipo: "time", valor: "", obrigatorio: true })}
          </div>
          <div id="aviso-agenda"></div>
        </section>

        <section class="cartao">
          <h2 class="cartao__titulo">4. Pagamento</h2>
          <div class="grade-campos grade-campos--2">
            ${campo({ nome: "pagamento", rotulo: "Forma de pagamento", tipo: "select", valor: "pix", opcoes: [{ valor: "pix", texto: "PIX" }, { valor: "dinheiro", texto: "Dinheiro" }, { valor: "cartao_entrega", texto: "Cartão (maquininha)" }] })}
            ${campo({ nome: "status", rotulo: "Situação do pedido", tipo: "select", valor: "confirmado", opcoes: [{ valor: "confirmado", texto: "Já confirmado" }, { valor: "novo", texto: "Novo (falta confirmar)" }] })}
            ${campo({ nome: "desconto", rotulo: "Desconto (R$)", valor: "0,00", mascara: "moeda" })}
            ${campo({ nome: "sinal", rotulo: "Sinal combinado (R$)", valor: "0,00", mascara: "moeda", ajuda: "Opcional. Depois registre o recebimento no pedido." })}
          </div>
          ${campo({ nome: "observacoes", rotulo: "Observações do pedido", tipo: "textarea", linhas: 3, atributos: 'maxlength="500"' })}
        </section>
      </div>
      <aside class="cartao novo-pedido__resumo" id="resumo" aria-live="polite"></aside>
    </form>`);

  const $ = (s) => ctx.raiz.querySelector(s);
  const form = $("#form-pedido");
  ativarCampos(form);
  ativarCampos($(".avulso"));

  /* ---------- Cliente ---------- */
  function desenharCliente() {
    ctx.raiz.querySelectorAll("[data-acao=modo]").forEach((b) => {
      const ativo = b.dataset.modo === e.modo;
      b.classList.toggle("segmento--ativo", ativo);
      b.setAttribute("aria-pressed", String(ativo));
    });
    $("#cliente-conta").hidden = e.modo !== "conta";
    $("#cliente-avulso").hidden = e.modo !== "avulso";
    montar($("#cliente-escolhido"), e.cliente ? html`<div class="chip-cliente"><span class="avatar">${e.cliente.nome.slice(0, 1)}</span>
      <div><strong>${e.cliente.nome}</strong><small class="texto-suave">${e.cliente.telefone ? telefone(e.cliente.telefone) : "sem telefone"} · ${e.cliente.email}</small></div>
      <button type="button" class="btn btn--suave btn--pequeno" data-acao="limpar-cliente">Trocar</button></div>` : html``);
    montar($("#resultados-cliente"), e.cliente ? html`` : html`${e.resultados.map((c) => html`<li><button type="button" data-acao="escolher-cliente" data-id="${c.id}">
      <strong>${c.nome}</strong><small class="texto-suave">${c.telefone ? telefone(c.telefone) : ""} ${c.email}</small></button></li>`)}`);
    $("#busca-cliente").hidden = !!e.cliente;
    $("#busca-cliente").closest(".busca").hidden = !!e.cliente;
  }

  async function buscarClientes() {
    const termo = $("#busca-cliente").value.trim();
    try {
      const { clientes } = await api.get(`/clientes${termo ? `?busca=${encodeURIComponent(termo)}` : ""}`);
      e.resultados = clientes.slice(0, 8);
    } catch { e.resultados = []; }
    if (ctx.ativo()) desenharCliente();
  }

  /* ---------- Itens ---------- */
  const produtoEscolhido = () => produtos.find((p) => p.id === Number($("#sel-produto").value));

  function desenharOpcoes() {
    const p = produtoEscolhido();
    montar($("#opcoes-produto"), p ? html`${(p.opcoes ?? []).map((g) => (g.tipo === "quantidade"
      ? html`
      <fieldset class="opcao-grupo" data-grupo="${g.id}"><legend>${g.nome} * (quantos de cada, somando ${g.total})</legend>
        ${g.itens.map((i) => html`<label class="opcao-linha opcao-linha--qtd"><span>${i.nome}${i.preco > 0 ? html` <small class="texto-suave">+ ${brl(i.preco)} cada</small>` : ""}</span>
          <input class="entrada entrada--curta" type="number" min="0" max="${g.total}" value="0" data-item="${i.id}" aria-label="Quantidade de ${i.nome}"></label>`)}</fieldset>`
      : html`
      <fieldset class="opcao-grupo" data-grupo="${g.id}"><legend>${g.nome}${g.obrigatorio ? " *" : ""}${g.tipo === "unica" ? "" : " (pode marcar mais de uma)"}</legend>
        ${g.itens.map((i) => html`<label class="opcao-linha"><input type="${g.tipo === "unica" ? "radio" : "checkbox"}" name="g-${g.id}" value="${i.id}">
          <span>${i.nome}${i.preco > 0 ? html` <small class="texto-suave">+ ${brl(i.preco)}</small>` : ""}</span></label>`)}</fieldset>`))}` : html``);
  }

  function lerSelecao(p) {
    const selecao = {};
    for (const g of p.opcoes ?? []) {
      if (g.tipo === "quantidade") {
        const caixa = {};
        for (const el of ctx.raiz.querySelectorAll(`[data-grupo="${g.id}"] [data-item]`)) {
          const n = Math.max(0, Math.floor(Number(el.value) || 0));
          if (n) caixa[el.dataset.item] = n;
        }
        if (Object.keys(caixa).length) selecao[g.id] = caixa;
        continue;
      }
      const marcados = [...ctx.raiz.querySelectorAll(`[data-grupo="${g.id}"] input:checked`)].map((i) => i.value);
      if (g.max && marcados.length > g.max) { toast(`“${g.nome}”: escolha até ${g.max}.`, "erro"); return null; }
      if (marcados.length) selecao[g.id] = marcados;
    }
    const falta = faltandoNaSelecao(p, selecao);
    if (falta) { toast(falta.texto, "erro"); return null; }
    const descricao = descricaoDaSelecao(p, selecao).map((d) => `${d.grupo}: ${d.itens.map(nomeComQuantidade).join(", ")}`);
    return { selecao, descricao, extras: extrasDaSelecao(p, selecao) };
  }

  const qtdValida = (el) => { const n = Number(el.value); return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null; };

  function adicionarProduto() {
    const p = produtoEscolhido();
    if (!p) { toast("Escolha um produto.", "erro"); return; }
    const qtd = qtdValida($("#qtd-produto"));
    if (!qtd) { toast("Informe uma quantidade de 1 a 999.", "erro"); return; }
    const s = lerSelecao(p);
    if (!s) return;
    e.itens.push({ produto: p, nome: p.nome, qtd, selecao: s.selecao, descricao: s.descricao, obs: $("#obs-produto").value.trim(), unit: p.preco + s.extras });
    $("#sel-produto").value = ""; $("#qtd-produto").value = "1"; $("#obs-produto").value = "";
    desenharOpcoes(); desenharItens();
  }

  function adicionarAvulso() {
    const nome = $("#av-nome").value.trim(), qtd = qtdValida($("#av-qtd"));
    if (nome.length < 2) { toast("Descreva o item avulso.", "erro"); return; }
    if (!qtd) { toast("Informe uma quantidade de 1 a 999.", "erro"); return; }
    e.itens.push({ avulso: true, nome, qtd, descricao: [], obs: "", unit: paraCentavos($("#av-preco").value) });
    $("#av-nome").value = ""; $("#av-preco").value = "0,00"; $("#av-qtd").value = "1";
    desenharItens();
  }

  function desenharItens() {
    montar($("#lista-itens"), e.itens.length ? html`${e.itens.map((i, n) => html`<li>
      <div><strong>${i.qtd}× ${i.nome}</strong>${i.avulso ? html` <span class="badge badge--neutro">avulso</span>` : ""}
        ${i.descricao.map((d) => html`<small>${d}</small>`)}${i.obs && html`<small>“${i.obs}”</small>`}</div>
      <span>${brl(i.unit * i.qtd)}</span>
      <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="remover-item" data-n="${n}" aria-label="Remover ${i.nome}">${icone("lixeira", { tamanho: 16 })}</button></li>`)}`
      : html`<li class="itens-novo__vazio texto-suave">Nenhum item ainda. Adicione produtos acima.</li>`);
    desenharResumo();
  }

  /* ---------- Resumo ---------- */
  function totais() {
    const d = dadosDe(form);
    const subtotal = e.itens.reduce((s, i) => s + i.unit * i.qtd, 0);
    const taxa = d.tipo === "entrega" ? paraCentavos(d.taxa_entrega) : 0;
    const desconto = paraCentavos(d.desconto);
    return { d, subtotal, taxa, desconto, total: Math.max(0, subtotal + taxa - desconto), sinal: paraCentavos(d.sinal) };
  }

  function desenharResumo() {
    const t = totais();
    montar($("#resumo"), html`
      <h2 class="cartao__titulo">Resumo</h2>
      <dl class="resumo__totais">
        <div><dt>Itens (${e.itens.reduce((s, i) => s + i.qtd, 0)})</dt><dd>${brl(t.subtotal)}</dd></div>
        ${t.taxa > 0 && html`<div><dt>Entrega</dt><dd>${brl(t.taxa)}</dd></div>`}
        ${t.desconto > 0 && html`<div class="resumo__desconto"><dt>Desconto</dt><dd>− ${brl(t.desconto)}</dd></div>`}
        <div class="resumo__total"><dt>Total</dt><dd>${brl(t.total)}</dd></div>
        ${t.sinal > 0 && html`<div><dt>Sinal combinado</dt><dd>${brl(t.sinal)}</dd></div>
          <div><dt>Restante</dt><dd>${brl(Math.max(t.total - t.sinal, 0))}</dd></div>`}
      </dl>
      <button type="submit" class="btn btn--primario btn--grande btn--bloco" data-salvar ${!e.itens.length && "disabled"}>Criar pedido</button>
      <small class="texto-suave texto-centro">O sistema confere os valores ao salvar.</small>`);
  }

  /* ---------- Data: avisa se o dia está bloqueado ou cheio (não impede a equipe) ---------- */
  async function conferirAgenda() {
    const data = form.elements.data.value;
    const caixa = $("#aviso-agenda");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { caixa.innerHTML = ""; return; }
    const mes = data.slice(0, 7);
    if (!agendas.has(mes)) { try { agendas.set(mes, await api.get(`/agenda?mes=${mes}`)); } catch { return; } }
    if (!ctx.ativo() || form.elements.data.value !== data) return;
    const a = agendas.get(mes), dia = a.dias.find((x) => x.data === data);
    const avisos = [];
    if (dia?.bloqueada) avisos.push(`Este dia está bloqueado${dia.motivo ? ` (${dia.motivo})` : ""}: os clientes não conseguem agendar, mas você pode lançar mesmo assim.`);
    if (a.max_pedidos_dia > 0 && dia?.pedidos >= a.max_pedidos_dia) avisos.push(`A agenda deste dia já tem ${plural(dia.pedidos, "pedido")} (limite: ${a.max_pedidos_dia}).`);
    else if (dia?.pedidos > 0) avisos.push(`Este dia já tem ${plural(dia.pedidos, "pedido")}.`);
    caixa.innerHTML = avisos.length ? String(html`<div class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>${avisos.join(" ")}</span></div>`) : "";
  }

  /* ---------- Eventos ---------- */
  delegar(ctx.raiz, {
    modo: (el) => { e.modo = el.dataset.modo; desenharCliente(); },
    "escolher-cliente": (el) => { e.cliente = e.resultados.find((c) => c.id === el.dataset.id) ?? null; desenharCliente(); },
    "limpar-cliente": () => { e.cliente = null; desenharCliente(); $("#busca-cliente").focus(); },
    "add-produto": adicionarProduto,
    "add-avulso": adicionarAvulso,
    "remover-item": (el) => { e.itens.splice(Number(el.dataset.n), 1); desenharItens(); },
  });
  $("#sel-produto").addEventListener("change", desenharOpcoes);
  $("#busca-cliente").addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(buscarClientes, 300); });
  $("#busca-cliente").addEventListener("focus", () => { if (!e.resultados.length) buscarClientes(); });
  form.addEventListener("input", () => desenharResumo());
  form.addEventListener("change", (ev) => {
    if (ev.target.name === "tipo") $("#bloco-entrega").hidden = ev.target.value !== "entrega";
    if (ev.target.name === "data") conferirAgenda();
    desenharResumo();
  });
  form.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.tagName === "INPUT") ev.preventDefault(); }); // Enter não envia o pedido sem querer

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!e.itens.length) { toast("Adicione pelo menos um item.", "erro"); return; }
    if (e.modo === "conta" && !e.cliente) { toast("Escolha o cliente ou use “Sem cadastro”.", "erro"); return; }
    const t = totais(), d = t.d;
    const corpo = {
      tipo: d.tipo, data: d.data, hora: d.hora, pagamento: d.pagamento, status: d.status, observacoes: d.observacoes,
      desconto: t.desconto, sinal: t.sinal,
      itens: e.itens.map((i) => (i.avulso ? { nome: i.nome, preco: i.unit, qtd: i.qtd } : { produto_id: i.produto.id, qtd: i.qtd, opcoes: i.selecao, obs: i.obs })),
    };
    if (d.tipo === "entrega") { corpo.endereco = d.endereco; corpo.taxa_entrega = t.taxa; }
    if (e.modo === "conta") corpo.cliente_id = e.cliente.id; else { corpo.nome = d.nome; corpo.telefone = d.telefone; }
    await ocupado($("[data-salvar]"), async () => {
      try {
        const { pedido } = await api.post("/pedidos", corpo);
        toast(`Pedido ${pedido.codigo} criado!`);
        location.hash = `#/pedidos?abrir=${pedido.id}`;
      } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
    });
  });

  desenharCliente();
  desenharOpcoes();
  desenharItens();
  conferirAgenda();
  return () => clearTimeout(temporizador);
}
