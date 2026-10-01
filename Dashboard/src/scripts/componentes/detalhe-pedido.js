/* ==========================================================
   COMPONENTE — detalhe do pedido (janela): itens, cliente,
   entrega no mapa, pagamento, histórico e troca de status
   (com aviso ao cliente pelo WhatsApp e impressão).
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, dataHora, dataPorExtenso, emReais, enderecoEmLinha, km, paraCentavos, telefone, tempoRelativo } from "/src/scripts/base/formatacao.js";
import { criarMapa } from "/src/scripts/base/mapa.js";
import { api } from "../nucleo/api.js";
import { atualizarContagem } from "../nucleo/notificacoes.js";
import { carregandoPagina } from "./pagina.js";
import { abrirEtiquetas } from "./etiquetas.js";
import { nomeComQuantidade } from "/src/scripts/base/opcoes.js";

/** Mensagem pronta para avisar o cliente sobre o novo status. */
function mensagemWhats(p) {
  const nome = p.cliente.nome.split(" ")[0];
  const quando = `${dataPorExtenso(p.data)} às ${p.hora}`;
  const retirada = p.tipo === "retirada";
  const texto = {
    novo: `Recebemos o seu pedido ${p.codigo}! Já vamos confirmar.`,
    confirmado: `Seu pedido ${p.codigo} foi *confirmado* para ${quando}. Obrigada!`,
    em_preparo: `Seu pedido ${p.codigo} está *em preparo*.`,
    pronto: retirada ? `Seu pedido ${p.codigo} está *pronto para retirada*!` : `Seu pedido ${p.codigo} está *pronto* e logo sai para entrega!`,
    saiu_entrega: `Seu pedido ${p.codigo} *saiu para entrega*! Chega em breve.`,
    entregue: `Seu pedido ${p.codigo} foi ${retirada ? "retirado" : "entregue"}. Bom apetite! Conte pra gente o que achou`,
    cancelado: `Infelizmente o pedido ${p.codigo} foi *cancelado*${p.motivo_cancelamento ? `: ${p.motivo_cancelamento}` : "."}`,
  }[p.status];
  return `Olá, ${nome}! ${texto}`;
}

const SITUACAO = {
  pago: ["badge--sucesso", "Pago"], sinal_pago: ["badge--info", "Sinal pago"], parcial: ["badge--aviso", "Pago em parte"],
  aguardando_sinal: ["badge--aviso", "Aguardando sinal"], pendente: ["badge--neutro", "A receber"],
};
export const situacaoPagamento = (p) => SITUACAO[p.pagamento_situacao] ?? SITUACAO.pendente;

const MOTIVOS_AVISO = {
  desligado: "Os avisos por WhatsApp estão desligados (Configurações → Integrações).", evento_desligado: "Esta situação está desligada nos avisos.",
  cliente_recusou: "O cliente escolheu não receber avisos pelo WhatsApp.", sem_telefone: "O pedido não tem telefone para avisar.",
  ja_enviado: "Este aviso já foi enviado.", status_mudou: "A situação do pedido mudou.",
};

/**
 * Avisa o cliente pelo WhatsApp sobre a situação ATUAL do pedido (o banco decide se deve enviar).
 * Sem WhatsApp configurado, não incomoda ninguém. `forcar`: reenviar de propósito.
 */
export async function avisarCliente(pedido, { forcar = false } = {}) {
  try {
    const r = await api.post("/avisos/enviar", { pedido_id: pedido.id, evento: pedido.status, forcar });
    if (r.enviado) toast("Cliente avisado pelo WhatsApp.", "sucesso");
    else if (r.erro) toast(`Não foi possível avisar pelo WhatsApp: ${r.erro}`, "erro", 8000);
    else if (forcar || r.motivo === "cliente_recusou") toast(MOTIVOS_AVISO[r.motivo] ?? "Aviso não enviado.", "info", 5000);
    return r;
  } catch (erro) {
    if (forcar || erro.status === 503) toast(erro.message, "erro", 8000);
    return null;
  }
}

const linkWhats = (p) => `https://wa.me/55${p.cliente.telefone}?text=${encodeURIComponent(mensagemWhats(p))}`;

function corpo(p) {
  const endereco = p.endereco;
  const pertoDeAgora = tempoRelativo(p.criado_em);
  return html`
    <div class="ped-topo">
      <span class="status status--${p.status} status--grande">${p.status_texto}</span>
      <span class="badge badge--info">${icone(p.tipo === "entrega" ? "caminhao" : "sacola", { tamanho: 14 })} ${p.tipo === "entrega" ? "Entrega" : "Retirada"}</span>
      ${p.origem === "manual" && html`<span class="badge badge--neutro">Lançado pela loja</span>`}
      ${p.origem === "orcamento" && html`<span class="badge badge--info">Veio de um orçamento</span>`}
      <span class="ped-topo__quando">${icone("calendario", { tamanho: 16 })} <strong>${dataPorExtenso(p.data)}</strong> às <strong>${p.hora}</strong></span>
      <small class="texto-suave">Feito ${pertoDeAgora} · ${dataHora(p.criado_em)}</small>
    </div>

    <div class="ped-grade">
      <div>
        <section class="ped-bloco">
          <h3>Itens</h3>
          <ul class="ped-itens">${p.itens.map((i) => html`
            <li><div><strong>${i.qtd}× ${i.nome}</strong>
              ${i.opcoes.map((o) => html`<small>${o.grupo}: ${o.itens.map(nomeComQuantidade).join(", ")}</small>`)}
              ${i.obs && html`<small class="ped-itens__obs">“${i.obs}”</small>`}</div><span>${brl(i.total)}</span></li>`)}</ul>
          <dl class="resumo__totais">
            <div><dt>Subtotal</dt><dd>${brl(p.subtotal)}</dd></div>
            ${p.tipo === "entrega" && html`<div><dt>Entrega${p.distancia_km != null ? ` · ${km(p.distancia_km)}` : ""}</dt><dd>${p.taxa_entrega ? brl(p.taxa_entrega) : "Grátis"}</dd></div>`}
            ${p.desconto > 0 && html`<div class="resumo__desconto"><dt>Cupom ${p.cupom}</dt><dd>− ${brl(p.desconto)}</dd></div>`}
            <div class="resumo__total"><dt>Total</dt><dd>${brl(p.total)}</dd></div>
          </dl>
        </section>
        ${p.observacoes && html`<section class="ped-bloco"><h3>Observações do cliente</h3><p class="ped-obs">${p.observacoes}</p></section>`}
      </div>

      <div>
        <section class="ped-bloco">
          <h3>Cliente</h3>
          <p><strong>${p.cliente.nome}</strong></p>
          <p class="linha-flex">${icone("telefone", { tamanho: 15 })} ${telefone(p.cliente.telefone)}
            <a href="${linkWhats(p)}" target="_blank" rel="noopener" class="btn btn--whats btn--pequeno">${icone("mensagem", { tamanho: 14 })} Avisar no WhatsApp</a></p>
        </section>

        <section class="ped-bloco">
          <h3>${p.tipo === "entrega" ? "Entrega" : "Retirada na loja"}</h3>
          ${endereco
            ? html`<p>${icone("pino", { tamanho: 15 })} ${enderecoEmLinha(endereco)}</p>
                ${endereco.referencia && html`<p class="texto-suave">Ref.: ${endereco.referencia}</p>`}
                ${p.lat != null && html`<div class="mapa mapa--pequeno" data-mapa></div>
                  <p class="linha-flex" style="margin-top:.5rem">
                    <a class="btn btn--suave btn--pequeno" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">${icone("navegar", { tamanho: 14 })} Traçar rota</a></p>`}`
            : html`<p class="texto-suave">O cliente vem buscar.</p>`}
        </section>

        <section class="ped-bloco">
          <h3>Pagamento</h3>
          <p class="linha-flex">${icone("cartao", { tamanho: 15 })} ${p.pagamento_texto} <span class="badge ${situacaoPagamento(p)[0]}">${situacaoPagamento(p)[1]}</span></p>
          ${p.troco_para && html`<p class="texto-suave">Troco para ${brl(p.troco_para)} (levar ${brl(p.troco_para - p.total)})</p>`}
          <dl class="resumo__totais resumo__totais--compacto">
            ${p.sinal > 0 && html`<div><dt>Sinal combinado</dt><dd>${brl(p.sinal)}</dd></div>`}
            <div><dt>Recebido</dt><dd>${brl(p.pago)}</dd></div>
            <div class="resumo__total"><dt>Falta receber</dt><dd>${brl(p.saldo)}</dd></div>
          </dl>
          ${p.pagamentos.length > 0 && html`<ul class="pagamentos">${p.pagamentos.map((g) => html`
            <li><span><strong>${brl(g.valor)}</strong> · ${g.forma_texto}<small class="texto-suave"> ${dataHora(g.criado_em)}</small></span>
              ${g.forma === "pix_auto" ? html`<small class="texto-suave" title="Confirmado pelo Mercado Pago: devolva pelo Mercado Pago">automático</small>`
                : html`<button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-excluir-pagamento="${g.id}" aria-label="Estornar pagamento de ${brl(g.valor)}">${icone("lixeira", { tamanho: 15 })}</button>`}</li>`)}</ul>`}
          ${p.status !== "cancelado" && p.saldo > 0 && html`<button type="button" class="btn btn--suave btn--pequeno" data-registrar-pagamento>${icone("dinheiro", { tamanho: 15 })} Registrar pagamento</button>`}
          ${p.pagamento === "pix" && p.saldo > 0 && html`<p class="texto-suave">Confira o PIX recebido e registre o valor para o pedido ficar em dia.</p>`}
        </section>
      </div>
    </div>

    ${p.proximos.length > 0 && html`
      <section class="ped-acoes">
        <div class="campo"><label for="nota-status">Observação para o histórico <span class="texto-suave">(opcional)</span></label>
          <input id="nota-status" class="entrada" maxlength="300" placeholder="Ex.: cliente pediu para entregar na portaria"></div>
        <div class="linha-flex">
          ${p.proximos.map((s, i) => s.status === "cancelado"
            ? html`<button type="button" class="btn btn--perigo-suave" data-status="cancelado">Cancelar pedido</button>`
            : html`<button type="button" class="btn ${i === 0 ? "btn--primario" : "btn--suave"}" data-status="${s.status}">${icone(i === 0 ? "check" : "direita", { tamanho: 16 })} ${s.texto}</button>`)}
        </div>
      </section>`}

    <section class="ped-bloco" data-avisos-bloco>
      <h3>Avisos ao cliente <small class="texto-suave">(WhatsApp)</small></h3>
      <ul class="avisos-lista" data-avisos-lista><li><small class="texto-suave">Carregando…</small></li></ul>
      ${p.status !== "novo" && html`<button type="button" class="btn btn--suave btn--pequeno" data-reenviar-aviso>${icone("mensagem", { tamanho: 15 })} Reenviar aviso de “${p.status_texto}”</button>`}
    </section>

    <section class="ped-bloco">
      <h3>Histórico</h3>
      <ul class="historico">${[...p.historico].reverse().map((h) => html`
        <li><span class="status status--${h.status}">${h.status_texto}</span><small class="texto-suave">${dataHora(h.criado_em)}</small>${h.nota && html`<small>${h.nota}</small>`}</li>`)}</ul>
    </section>`;
}

/** Abre o pedido. `aoMudar(pedido)` avisa a página de trás para atualizar a lista. */
export async function abrirPedido(id, aoMudar) {
  let mapa = null;
  let atual = null;

  const m = abrirModal({
    titulo: "Pedido", largura: 920, classe: "modal-pedido", corpo: carregandoPagina,
    rodape: html`<button type="button" class="btn btn--suave" data-etiquetas>${icone("etiqueta", { tamanho: 16 })} Etiquetas</button>
      <button type="button" class="btn btn--suave" data-imprimir>${icone("impressora", { tamanho: 16 })} Imprimir</button>
      <button type="button" class="btn btn--escuro" data-fechar>Fechar</button>`,
    aoFechar: () => mapa?.destruir(),
  });

  async function desenhar(p) {
    atual = p;
    m.el.querySelector(".modal__cab h2").textContent = `Pedido ${p.codigo} · ${p.cliente.nome}`;
    m.corpo.innerHTML = String(corpo(p));
    mapa?.destruir();
    mapa = null;
    carregarAvisos();
    const alvo = m.corpo.querySelector("[data-mapa]");
    if (alvo) {
      try { mapa = await criarMapa(alvo, { lat: p.lat, lng: p.lng, zoom: 16, pino: true }); if (m.fechado) mapa.destruir(); }
      catch { alvo.remove(); }
    }
  }

  m.rodape.querySelector("[data-imprimir]").addEventListener("click", () => window.print());
  m.rodape.querySelector("[data-etiquetas]").addEventListener("click", () => {
    if (!atual) return;
    abrirEtiquetas({
      titulo: `Etiquetas — pedido ${atual.codigo}`, comCliente: true,
      itens: atual.itens.map((i) => ({ produto_id: i.produto_id, nome: i.nome, opcoes: i.opcoes, cliente: atual.cliente.nome, lote: atual.codigo })),
    });
  });

  async function carregarAvisos() {
    const lista = m.corpo.querySelector("[data-avisos-lista]");
    if (!lista || !atual) return;
    try {
      const { avisos } = await api.get(`/pedidos/${atual.id}/avisos`);
      lista.innerHTML = avisos.length
        ? avisos.map((a) => String(html`<li><span class="badge ${a.estado === "enviado" ? "badge--sucesso" : "badge--perigo"}">${a.estado === "enviado" ? "Enviado" : "Falhou"}</span>
            <strong>${a.evento_texto}</strong><small class="texto-suave">${dataHora(a.quando)}${a.usuario ? ` · ${a.usuario}` : ""}</small>${a.estado === "erro" && html`<small>${a.detalhe}</small>`}</li>`)).join("")
        : '<li><small class="texto-suave">Nenhum aviso enviado ainda.</small></li>';
    } catch { lista.innerHTML = ""; }
  }

  m.corpo.addEventListener("click", async (ev) => {
    if (ev.target.closest("[data-registrar-pagamento]")) return registrarPagamento();
    const estorno = ev.target.closest("[data-excluir-pagamento]");
    if (estorno) return estornar(estorno);
    const reenviar = ev.target.closest("[data-reenviar-aviso]");
    if (reenviar) return ocupado(reenviar, async () => { await avisarCliente(atual, { forcar: true }); await carregarAvisos(); });
    const botao = ev.target.closest("[data-status]");
    if (!botao) return;
    const status = botao.dataset.status;
    const nota = m.corpo.querySelector("#nota-status")?.value.trim() ?? "";

    if (status === "cancelado") return pedirMotivo(nota);
    await mudar(botao, status, nota);
  });

  async function mudar(botao, status, nota) {
    await ocupado(botao, async () => {
      try {
        const { pedido } = await api.patch(`/pedidos/${atual.id}/status`, { status, nota });
        toast(`Pedido ${pedido.codigo}: ${pedido.status_texto}`);
        await desenhar(pedido);
        aoMudar?.(pedido);
        atualizarContagem();
        avisarCliente(pedido).then(carregarAvisos);
      } catch (erro) { toast(erro.message, "erro"); }
    });
  }

  function registrarPagamento() {
    const sugestao = atual.sinal > atual.pago ? atual.sinal - atual.pago : atual.saldo;
    const r = abrirModal({
      titulo: "Registrar pagamento", largura: 460,
      corpo: html`<form id="form-pagamento" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <p class="texto-suave">Falta receber <strong>${brl(atual.saldo)}</strong>${atual.sinal > atual.pago ? html` (sinal combinado: ${brl(atual.sinal)})` : ""}.</p>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "valor", rotulo: "Valor recebido (R$)", valor: emReais(sugestao), mascara: "moeda", obrigatorio: true, atributos: "autofocus" })}
          ${campo({ nome: "forma", rotulo: "Forma", tipo: "select", valor: "pix", opcoes: [
            { valor: "pix", texto: "PIX" }, { valor: "dinheiro", texto: "Dinheiro" }, { valor: "cartao", texto: "Cartão" }, { valor: "transferencia", texto: "Transferência" }] })}
        </div>
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-pagamento" class="btn btn--primario" data-salvar>Registrar</button>`,
    });
    const form = r.el.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      await ocupado(r.el.querySelector("[data-salvar]"), async () => {
        try {
          const { pedido } = await api.post(`/pedidos/${atual.id}/pagamentos`, { valor: paraCentavos(d.valor), forma: d.forma });
          r.fechar();
          toast("Pagamento registrado.");
          await desenhar(pedido);
          aoMudar?.(pedido);
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  async function estornar(botao) {
    const g = atual.pagamentos.find((x) => x.id === Number(botao.dataset.excluirPagamento));
    if (!g || !(await confirmar({ titulo: "Estornar pagamento", mensagem: `Remover o pagamento de ${brl(g.valor)} (${g.forma_texto})? O valor volta a ficar como “a receber”.`, rotulo: "Estornar", perigo: true }))) return;
    try {
      const { pedido } = await api.delete(`/pagamentos/${g.id}`);
      toast("Pagamento estornado.", "info");
      await desenhar(pedido);
      aoMudar?.(pedido);
    } catch (erro) { toast(erro.message, "erro"); }
  }

  function pedirMotivo(notaInicial) {
    const c = abrirModal({
      titulo: "Cancelar pedido", largura: 440,
      corpo: html`<p class="texto-suave">O cliente vê este motivo na tela do pedido.</p>
        <div class="campo" style="margin-top:.8rem"><label for="motivo">Motivo do cancelamento</label>
        <textarea id="motivo" class="entrada" rows="3" maxlength="300" autofocus>${notaInicial}</textarea></div>
        <div class="form-erro" data-erro hidden></div>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Voltar</button>
        <button type="button" class="btn btn--perigo" data-confirmar>Cancelar pedido</button>`,
    });
    c.rodape.querySelector("[data-confirmar]").addEventListener("click", async (ev) => {
      const motivo = c.corpo.querySelector("#motivo").value.trim();
      if (!motivo) { const e = c.corpo.querySelector("[data-erro]"); e.hidden = false; e.textContent = "Informe o motivo."; return; }
      await ocupado(ev.currentTarget, async () => {
        try {
          const { pedido } = await api.patch(`/pedidos/${atual.id}/status`, { status: "cancelado", nota: motivo });
          c.fechar();
          toast(`Pedido ${pedido.codigo} cancelado.`, "info");
          await desenhar(pedido);
          aoMudar?.(pedido);
          atualizarContagem();
          avisarCliente(pedido).then(carregarAvisos);
        } catch (erro) { toast(erro.message, "erro"); }
      });
    });
  }

  try {
    await desenhar((await api.get(`/pedidos/${id}`)).pedido);
  } catch (erro) {
    m.corpo.innerHTML = `<p class="aviso aviso--perigo">${erro.message}</p>`;
  }
  return m;
}
