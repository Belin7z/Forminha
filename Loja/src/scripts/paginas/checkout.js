/* ==========================================================
   PÁGINA — finalizar pedido.
   Cada mudança (endereço, data, cupom…) pede um orçamento ao
   servidor, que recalcula tudo e diz o que ainda falta.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { armazenamento } from "/src/scripts/base/armazenamento.js";
import { brl, dataCurta, diaCurto, enderecoEmLinha, horasTexto, km, paraCentavos } from "/src/scripts/base/formatacao.js";
import { diasDisponiveis, gerarHorarios } from "/src/scripts/base/agendamento.js";
import { FORMAS_PAGAMENTO } from "/src/scripts/base/dominio.js";
import { api } from "../nucleo/api.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { antecedenciaHoras, limpar, linhas, paraApi } from "../nucleo/carrinho.js";
import { exigirLogin } from "../nucleo/sessao.js";
import { abrirFormEndereco } from "../componentes/endereco-form.js";
import { abrirGaveta } from "../componentes/gaveta-carrinho.js";
import { visualProduto } from "../componentes/cartao-produto.js";

const PREFERENCIAS = "zq.checkout";

export async function checkout(ctx) {
  if (!exigirLogin(ctx, "Entre para finalizar seu pedido.")) return;

  if (!linhas().length) {
    montar(ctx.raiz, html`<section class="container pagina-simples"><div class="vazio"><span class="vazio__ico">${icone("sacola", { tamanho: 38 })}</span>
      <h3>Seu carrinho está vazio</h3><p>Escolha alguns doces para começar o pedido.</p>
      <a href="#/cardapio" class="btn btn--primario">Ver cardápio</a></div></section>`);
    return;
  }

  const cfg = estado.config;
  let [enderecos, agendaLoja] = await Promise.all([
    api.get("/enderecos").then((r) => r.enderecos),
    api.get("/agenda").catch(() => ({ indisponiveis: [] })), // se falhar, o servidor ainda confere no envio
  ]);
  if (!ctx.ativo()) return;

  const pref = armazenamento.ler(PREFERENCIAS, {});
  const pagamentos = [
    cfg.pagamento.pix_ativo && "pix",
    cfg.pagamento.dinheiro_ativo && "dinheiro",
    cfg.pagamento.cartao_ativo && "cartao_entrega",
  ].filter(Boolean);
  const tiposAtivos = [cfg.entrega.entrega_ativa && "entrega", cfg.entrega.retirada_ativa && "retirada"].filter(Boolean);

  const antecedencia = antecedenciaHoras();
  const minimo = new Date(Date.now() + antecedencia * 3600_000);
  const todosDias = diasDisponiveis(cfg.horarios, minimo, cfg.pedidos.intervalo_min, cfg.pedidos.dias_maximos);
  const fechados = new Map(agendaLoja.indisponiveis.map((x) => [x.data, x.motivo]));
  const dias = todosDias.filter((d) => !fechados.has(d));

  const f = {
    tipo: tiposAtivos.includes(pref.tipo) ? pref.tipo : tiposAtivos[0],
    endereco_id: (enderecos.find((e) => e.principal) ?? enderecos[0])?.id ?? null,
    data: dias[0] ?? "", hora: "",
    pagamento: pagamentos.includes(pref.pagamento) ? pref.pagamento : pagamentos[0],
    troco: "", cupom: "", observacoes: "",
  };
  let orcamento = null;
  let versao = 0;
  let temporizador;

  montar(ctx.raiz, html`
    <section class="container checkout">
      <header class="pagina-cab"><h1>Finalizar <span class="script">pedido</span></h1></header>
      <div class="checkout__grade">
        <form class="checkout__passos" id="form-checkout" novalidate>
          <section class="passo-card">
            <h2><span class="passo-card__num">1</span> Como você quer receber?</h2>
            <div class="opcoes opcoes--2" id="bloco-tipo"></div>
            <div id="bloco-endereco"></div>
          </section>
          <section class="passo-card">
            <h2><span class="passo-card__num">2</span> Quando?</h2>
            <p class="texto-suave passo-card__dica">${icone("relogio", { tamanho: 15 })} Seu pedido exige <strong>${horasTexto(antecedencia)}</strong> de antecedência.</p>
            <div id="bloco-agenda"></div>
          </section>
          <section class="passo-card">
            <h2><span class="passo-card__num">3</span> Pagamento</h2>
            <div id="bloco-pagamento"></div>
          </section>
          <section class="passo-card">
            <h2><span class="passo-card__num">4</span> Cupom e observações</h2>
            <div class="campo-cupom">
              <div class="campo"><label for="cupom">Cupom de desconto</label>
                <div class="linha-flex"><input id="cupom" class="entrada" placeholder="Digite o código" autocomplete="off" style="flex:1;text-transform:uppercase">
                <button type="button" class="btn btn--suave" data-acao="cupom">Aplicar</button></div>
                <small class="campo__erro" id="erro-cupom" hidden></small></div>
            </div>
            <div class="campo"><label for="observacoes">Observações do pedido</label>
              <textarea id="observacoes" class="entrada" rows="3" maxlength="500" placeholder="Alergias, horário preferido, dedicatória, ponto de referência…"></textarea></div>
          </section>
        </form>

        <aside class="resumo" id="resumo" aria-live="polite"></aside>
      </div>
    </section>`);

  const $ = (s) => ctx.raiz.querySelector(s);

  /* ---------- 1. Recebimento ---------- */
  function desenharTipo() {
    montar($("#bloco-tipo"), html`${tiposAtivos.map((t) => html`
      <label class="opcao"><input type="radio" name="tipo" value="${t}" ${f.tipo === t && "checked"}><span class="opcao__marca"></span>
        <span class="opcao__texto"><strong>${t === "entrega" ? "Entrega" : "Retirada na loja"}</strong>
        <small>${t === "entrega" ? "Levamos até você" : "Sem custo, você busca"}</small></span>
        ${icone(t === "entrega" ? "caminhao" : "sacola", { tamanho: 22 })}</label>`)}`);
  }

  function desenharEndereco() {
    const bloco = $("#bloco-endereco");
    if (f.tipo === "retirada") {
      montar(bloco, html`<div class="aviso aviso--marca">${icone("pino", { tamanho: 17 })}<div>
        <strong>Retire em:</strong> ${cfg.loja.endereco}${cfg.loja.cidade && ` — ${cfg.loja.cidade}/${cfg.loja.uf}`}<br>
        <a href="#/contato" class="link">Ver no mapa e horários</a></div></div>`);
      return;
    }
    montar(bloco, html`
      <div class="opcoes">
        ${enderecos.map((e) => html`
          <label class="opcao opcao--endereco">
            <input type="radio" name="endereco_id" value="${e.id}" ${f.endereco_id === e.id && "checked"}><span class="opcao__marca"></span>
            <span class="opcao__texto"><strong>${e.apelido} ${e.principal && html`<span class="badge">Principal</span>`}</strong>
              <small>${enderecoEmLinha(e)}</small>
              ${e.lat == null && html`<small class="texto-perigo">Sem localização no mapa — edite para marcar.</small>`}</span>
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="editar-endereco" data-id="${e.id}">${icone("editar", { tamanho: 14 })} Editar</button>
          </label>`)}
      </div>
      <button type="button" class="btn btn--contorno btn--bloco" data-acao="novo-endereco" style="margin-top:.7rem">${icone("mais", { tamanho: 17 })} Adicionar novo endereço</button>
      <div class="problema" data-problema="endereco" hidden></div>
      <div class="entrega-info" id="entrega-info"></div>`);
  }

  /* ---------- 2. Data e horário ---------- */
  function desenharAgenda() {
    if (!dias.length) {
      montar($("#bloco-agenda"), html`<div class="aviso aviso--perigo">${icone("alerta", { tamanho: 17 })}<span>Não há datas disponíveis no momento. Fale com a loja pelo WhatsApp.</span></div>`);
      return;
    }
    const horas = f.data ? gerarHorarios(cfg.horarios, f.data, minimo, cfg.pedidos.intervalo_min) : [];
    montar($("#bloco-agenda"), html`
      <div class="rotulo-mini">Escolha o dia</div>
      <div class="datas" role="radiogroup" aria-label="Dia">${todosDias.slice(0, 21).map((d) => fechados.has(d) ? html`
        <button type="button" class="data data--fechada" disabled aria-disabled="true" title="${fechados.get(d) === "lotada" ? "Agenda cheia neste dia" : "Sem agendamentos neste dia"}">
          <small>${diaCurto(d)}</small><strong>${dataCurta(d)}</strong><em>${fechados.get(d) === "lotada" ? "Lotado" : "Fechado"}</em></button>` : html`
        <button type="button" class="data ${f.data === d && "data--ativa"}" data-acao="data" data-valor="${d}" role="radio" aria-checked="${String(f.data === d)}">
          <small>${diaCurto(d)}</small><strong>${dataCurta(d)}</strong></button>`)}</div>
      <div class="rotulo-mini">Escolha o horário ${f.tipo === "entrega" ? "da entrega" : "da retirada"}</div>
      <div class="horas" role="radiogroup" aria-label="Horário">${horas.map((h) => html`
        <button type="button" class="hora ${f.hora === h && "hora--ativa"}" data-acao="hora" data-valor="${h}" role="radio" aria-checked="${String(f.hora === h)}">${h}</button>`)}</div>`);
  }

  /* ---------- 3. Pagamento ---------- */
  function desenharPagamento() {
    const detalhes = {
      pix: ["PIX", "Você recebe o código “copia e cola” logo após enviar o pedido.", "dinheiro"],
      dinheiro: ["Dinheiro", "Pague na entrega ou na retirada. Podemos levar troco.", "dinheiro"],
      cartao_entrega: [FORMAS_PAGAMENTO.cartao_entrega, "Levamos a maquininha até você.", "cartao"],
    };
    montar($("#bloco-pagamento"), pagamentos.length ? html`
      <div class="opcoes">${pagamentos.map((p) => html`
        <label class="opcao"><input type="radio" name="pagamento" value="${p}" ${f.pagamento === p && "checked"}><span class="opcao__marca"></span>
          <span class="opcao__texto"><strong>${detalhes[p][0]}</strong><small>${detalhes[p][1]}</small></span>${icone(detalhes[p][2] === "cartao" ? "cartao" : "dinheiro", { tamanho: 22 })}</label>`)}</div>
      <div class="campo" id="campo-troco" ${f.pagamento !== "dinheiro" && "hidden"} style="margin-top:.8rem">
        <label for="troco">Precisa de troco? <span class="texto-suave">(opcional)</span></label>
        <input id="troco" class="entrada" inputmode="decimal" placeholder="Troco para quanto? Ex.: 100,00" autocomplete="off">
      </div>` : html`<div class="aviso aviso--perigo">${icone("alerta", { tamanho: 17 })}<span>Nenhuma forma de pagamento disponível no momento.</span></div>`);
  }

  /* ---------- Resumo e orçamento ---------- */
  function desenharResumo() {
    const itens = linhas();
    const o = orcamento;
    const problemas = o?.problemas ?? [];
    const bloqueios = problemas.filter((p) => p.campo !== "cupom");

    montar($("#resumo"), html`
      <h2>Resumo do pedido</h2>
      <ul class="resumo__itens">${itens.map((l) => html`
        <li><div class="resumo__img">${visualProduto(l.produto)}</div>
          <div><strong>${l.qtd}× ${l.produto.nome}</strong>
            ${l.escolhas.map((e) => html`<small>${e.itens.map((i) => i.nome).join(", ")}</small>`)}</div>
          <span>${brl(l.total)}</span></li>`)}</ul>
      <button type="button" class="link" data-acao="editar-carrinho">Editar carrinho</button>

      <dl class="resumo__totais">
        <div><dt>Subtotal</dt><dd>${brl(o?.subtotal ?? itens.reduce((s, l) => s + l.total, 0))}</dd></div>
        ${f.tipo === "entrega" && html`<div><dt>Entrega${o?.distancia_km != null ? ` · ${km(o.distancia_km)}` : ""}</dt>
          <dd>${o ? (o.taxa_entrega > 0 ? brl(o.taxa_entrega) : html`<span class="texto-sucesso">Grátis</span>`) : "—"}</dd></div>`}
        ${o?.desconto > 0 && html`<div class="resumo__desconto"><dt>Cupom ${o.cupom}</dt><dd>− ${brl(o.desconto)}</dd></div>`}
        <div class="resumo__total"><dt>Total</dt><dd>${o ? brl(o.total) : "—"}</dd></div>
        ${o?.sinal > 0 && html`<div class="resumo__sinal"><dt>Sinal para garantir a data</dt><dd>${brl(o.sinal)}</dd></div>`}
      </dl>
      ${o?.prazo_min && f.tipo === "entrega" && html`<p class="texto-suave resumo__prazo">${icone("relogio", { tamanho: 15 })} Tempo de entrega estimado: ~${o.prazo_min} min</p>`}

      ${bloqueios.length > 0 && html`<div class="aviso aviso--aviso"><span>${icone("alerta", { tamanho: 16 })}</span>
        <div><strong>Para finalizar:</strong><ul class="lista-pendencias">${bloqueios.map((p) => html`<li>${p.mensagem}</li>`)}</ul></div></div>`}

      <button type="button" class="btn btn--primario btn--grande btn--bloco" data-acao="confirmar" ${(!o || bloqueios.length > 0) && "disabled"}>Confirmar pedido</button>
      <small class="texto-suave texto-centro resumo__nota">${o?.sinal > 0
        ? `Depois de enviar, você paga o sinal de ${brl(o.sinal)} por PIX para garantir a data. O restante é na ${f.tipo === "entrega" ? "entrega" : "retirada"}.`
        : "Você paga somente depois de confirmarmos o pedido."}</small>`);

    // mensagens junto dos blocos
    const endereco = problemas.find((p) => p.campo === "endereco");
    const el = $('[data-problema="endereco"]');
    if (el) { el.hidden = !endereco; el.textContent = endereco?.mensagem ?? ""; el.className = "problema aviso aviso--perigo"; }
    const erroCupom = problemas.find((p) => p.campo === "cupom");
    const alvo = $("#erro-cupom");
    alvo.hidden = !erroCupom;
    alvo.textContent = erroCupom?.mensagem ?? "";
    atualizarInfoEntrega();
  }

  function atualizarInfoEntrega() {
    const alvo = $("#entrega-info");
    if (!alvo || !orcamento) return;
    alvo.innerHTML = orcamento.tipo === "entrega" && orcamento.distancia_km != null && !orcamento.problemas.some((p) => p.campo === "endereco")
      ? String(html`<span class="texto-sucesso">${icone("checkCirculo", { tamanho: 16 })} Atendemos este endereço · ${km(orcamento.distancia_km)} da loja${orcamento.zona ? ` · ${orcamento.zona.nome}` : ""}</span>`)
      : "";
  }

  const corpo = () => ({
    itens: paraApi(), tipo: f.tipo,
    endereco_id: f.tipo === "entrega" ? f.endereco_id ?? undefined : undefined,
    data: f.data, hora: f.hora, pagamento: f.pagamento,
    troco_para: f.pagamento === "dinheiro" && f.troco.trim() ? paraCentavos(f.troco) : undefined,
    cupom: f.cupom || undefined, observacoes: f.observacoes,
  });

  async function orcar() {
    const minha = ++versao;
    try {
      const resposta = await api.post("/pedidos/orcamento", corpo());
      if (minha !== versao || !ctx.ativo()) return;
      orcamento = resposta;
      desenharResumo();
    } catch (erro) {
      if (erro.status !== 401) toast(erro.message, "erro");
    }
  }
  const orcarDepois = () => { clearTimeout(temporizador); temporizador = setTimeout(orcar, 300); };

  /* ---------- Eventos ---------- */
  ctx.raiz.addEventListener("change", (ev) => {
    const { name, value } = ev.target;
    if (name === "tipo") { f.tipo = value; desenharEndereco(); desenharAgenda(); orcar(); }
    else if (name === "endereco_id") { f.endereco_id = Number(value); orcar(); }
    else if (name === "pagamento") { f.pagamento = value; $("#campo-troco").hidden = value !== "dinheiro"; orcar(); }
  });
  ctx.raiz.addEventListener("input", (ev) => {
    if (ev.target.id === "troco") { f.troco = ev.target.value; orcarDepois(); }
    if (ev.target.id === "observacoes") f.observacoes = ev.target.value;
  });

  const abrirEndereco = (endereco) => abrirFormEndereco({
    endereco,
    aoSalvar: (lista, id) => { enderecos = lista; f.endereco_id = id; desenharEndereco(); orcar(); },
  });

  ctx.raiz.addEventListener("click", async (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === "novo-endereco") abrirEndereco(null);
    else if (acao === "editar-endereco") { ev.preventDefault(); abrirEndereco(enderecos.find((e) => e.id === Number(alvo.dataset.id))); }
    else if (acao === "data") { f.data = alvo.dataset.valor; f.hora = ""; desenharAgenda(); orcar(); }
    else if (acao === "hora") { f.hora = alvo.dataset.valor; desenharAgenda(); orcar(); }
    else if (acao === "cupom") { f.cupom = $("#cupom").value.trim().toUpperCase(); orcar(); }
    else if (acao === "editar-carrinho") abrirGaveta();
    else if (acao === "confirmar") {
      await ocupado(alvo, async () => {
        try {
          const { pedido } = await api.post("/pedidos", corpo());
          armazenamento.gravar(PREFERENCIAS, { tipo: f.tipo, pagamento: f.pagamento });
          limpar();
          ctx.ir(`/pedido/${pedido.codigo}?novo=1`);
        } catch (erro) {
          toast(erro.message, "erro");
          orcar();
        }
      });
    }
  });
  $("#form-checkout").addEventListener("submit", (ev) => ev.preventDefault());

  desenharTipo();
  desenharEndereco();
  desenharAgenda();
  desenharPagamento();
  desenharResumo();
  orcar();

  // carrinho editado pela gaveta: refaz o resumo (ou volta ao estado "vazio")
  const desligarCarrinho = ouvir("carrinho", () => {
    if (!linhas().length) { ctx.ir("/finalizar"); return; }
    desenharResumo();
    orcar();
  });

  return () => { clearTimeout(temporizador); desligarCarrinho(); };
}
