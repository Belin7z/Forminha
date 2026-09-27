/* ==========================================================
   PÁGINA — acompanhamento do pedido: linha do tempo, entrega no
   mapa, PIX, cancelamento, novo pedido e avaliação. Atualiza
   sozinha enquanto o pedido está em andamento.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { brl, dataHora, dataPorExtenso, enderecoEmLinha, km } from "/src/scripts/base/formatacao.js";
import { STATUS_ATIVOS, etapasDoPedido, statusTexto } from "/src/scripts/base/dominio.js";
import { criarMapa } from "/src/scripts/base/mapa.js";
import { gerarPix } from "/src/scripts/base/pix.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";
import { adicionar } from "../nucleo/carrinho.js";
import { produtoPorId } from "../nucleo/catalogo.js";
import { exigirLogin } from "../nucleo/sessao.js";
import { carregando, erroDePagina } from "../componentes/carregando.js";
import { escolherNota, estrelas } from "../componentes/estrelas.js";
import { linkWhats } from "../componentes/rodape.js";

function mensagemDoStatus(p) {
  const quando = `${dataPorExtenso(p.data)} às ${p.hora}`;
  const retirada = p.tipo === "retirada";
  return {
    novo: "Recebemos o seu pedido! Assim que a loja confirmar, você será avisado aqui.",
    confirmado: `Pedido confirmado! Já estamos organizando tudo para ${quando}.`,
    em_preparo: "Estamos preparando os seus doces com todo o carinho.",
    pronto: retirada ? "Seu pedido está pronto! Pode retirar na loja." : "Seu pedido está pronto e logo sai para entrega.",
    saiu_entrega: "Seu pedido saiu para entrega e chega em breve!",
    entregue: retirada ? "Pedido retirado. Bom apetite!" : "Pedido entregue. Bom apetite!",
    cancelado: `Este pedido foi cancelado${p.motivo_cancelamento ? `: ${p.motivo_cancelamento}` : "."}`,
  }[p.status];
}

function linhaDoTempo(p) {
  if (p.status === "cancelado") return "";
  const etapas = etapasDoPedido(p.tipo);
  const atual = etapas.indexOf(p.status);
  return html`<ol class="tempo">${etapas.map((e, i) => html`
    <li class="tempo__etapa ${i < atual && "tempo__etapa--feita"} ${i === atual && "tempo__etapa--atual"}">
      <span class="tempo__bolinha">${i < atual ? icone("check", { tamanho: 14 }) : i + 1}</span>
      <span class="tempo__nome">${statusTexto(e, p.tipo)}</span>
    </li>`)}</ol>`;
}

/** Recoloca no carrinho os itens de um pedido antigo (casando opções pelo nome). */
function refazerPedido(p) {
  let adicionados = 0;
  for (const item of p.itens) {
    const produto = produtoPorId(item.produto_id);
    if (!produto) continue;
    const opcoes = {};
    for (const escolha of item.opcoes) {
      const grupo = produto.opcoes.find((g) => g.nome === escolha.grupo);
      if (!grupo) continue;
      opcoes[grupo.id] = escolha.itens.map((i) => grupo.itens.find((x) => x.nome === i.nome)?.id).filter(Boolean);
    }
    adicionar({ produto_id: produto.id, qtd: Math.max(item.qtd, produto.min_qtd), opcoes, obs: item.obs ?? "" });
    adicionados++;
  }
  return adicionados;
}

export async function pedido(ctx) {
  if (!exigirLogin(ctx)) return;
  montar(ctx.raiz, carregando);

  const codigo = ctx.params.codigo;
  let p;
  try { p = (await api.get(`/pedidos/${encodeURIComponent(codigo)}`)).pedido; }
  catch (erro) { if (ctx.ativo()) montar(ctx.raiz, erroDePagina(erro.status === 404 ? "Não encontramos este pedido na sua conta." : erro.message)); return; }
  if (!ctx.ativo()) return;

  const novo = ctx.consulta.novo === "1";
  let mapa = null;
  let timer = null;
  let sondagem = null; // confere o pagamento a cada 4 s enquanto o QR Code está na tela
  let qr = null;       // QR Code gerado (PIX automático)

  const qrValido = () => qr && p.pix && qr.valor === p.pix.valor && Date.parse(qr.expira_em) > Date.now();

  function blocoPix() {
    const automatico = estado.config?.pagamento?.pix_automatico;
    const titulo = p.pix.motivo === "sinal" ? "Pague o sinal para garantir sua data" : "Pague com PIX";
    const resto = p.pix.motivo === "sinal" ? html` — o restante (<strong>${brl(p.total - p.sinal)}</strong>) você paga na ${p.tipo === "entrega" ? "entrega" : "retirada"}.` : ".";
    const codigoLoja = html`<code class="pix__codigo" id="pix-codigo">${gerarPix(p.pix)}</code>
      <button type="button" class="btn btn--primario" data-acao="copiar-pix">${icone("copiar", { tamanho: 17 })} Copiar código PIX</button>`;
    if (!automatico) {
      return html`<div class="pix"><h2>${icone("dinheiro", { tamanho: 20 })} ${titulo}</h2>
        <p>Copie o código abaixo e cole no aplicativo do seu banco (<strong>PIX Copia e Cola</strong>). Valor: <strong>${brl(p.pix.valor)}</strong>${resto}</p>${codigoLoja}</div>`;
    }
    return html`<div class="pix"><h2>${icone("dinheiro", { tamanho: 20 })} ${titulo}</h2>
      ${qrValido() ? html`
        <p>No app do seu banco, escolha <strong>Pagar com PIX</strong> e leia o QR Code (ou use o código copia e cola). Valor: <strong>${brl(qr.valor)}</strong>${resto}</p>
        <img class="pix__qr" src="data:image/png;base64,${qr.qr_code_base64}" alt="QR Code do PIX" width="220" height="220">
        <code class="pix__codigo" id="pix-codigo">${qr.qr_code}</code>
        <button type="button" class="btn btn--primario" data-acao="copiar-pix-auto">${icone("copiar", { tamanho: 17 })} Copiar código PIX</button>
        <p class="texto-suave pix__aguardando">${icone("atualizar", { tamanho: 14 })} Aguardando a confirmação do pagamento. Esta tela atualiza sozinha.</p>`
      : html`<p>Pague na hora, sem digitar nada: geramos um QR Code com o valor certo e o pedido é atualizado <strong>sozinho</strong> assim que o pagamento cair. Valor: <strong>${brl(p.pix.valor)}</strong>${resto}</p>
        <button type="button" class="btn btn--primario" data-acao="gerar-pix">${icone("dinheiro", { tamanho: 17 })} Gerar QR Code do PIX</button>`}
      <details class="pix__alternativo"><summary>Prefiro usar o código de pagamento da loja</summary>
        <p class="texto-suave">Com este código o pagamento é conferido pela loja, pode levar mais tempo.</p>${codigoLoja}</details></div>`;
  }

  async function desenharMapa() {
    mapa?.destruir();
    mapa = null;
    const el = ctx.raiz.querySelector("[data-mapa]");
    if (!el || p.lat == null) return;
    try { mapa = await criarMapa(el, { lat: p.lat, lng: p.lng, zoom: 16, pino: true }); if (!ctx.ativo()) mapa.destruir(); } catch { el.remove(); }
  }

  function desenhar() {
    const whats = linkWhats(`Olá! Estou falando sobre o pedido ${p.codigo}.`);
    const ativo = STATUS_ATIVOS.includes(p.status);
    const podeCancelar = p.status === "novo";

    montar(ctx.raiz, html`
      <section class="container pedido">
        <a href="#/conta/pedidos" class="link-voltar">${icone("voltar", { tamanho: 16 })} Meus pedidos</a>

        ${novo && html`<div class="aviso aviso--sucesso pedido__novo">${icone("checkCirculo", { tamanho: 22 })}
          <div><strong>Pedido enviado com sucesso!</strong><br>Guarde o código <strong>${p.codigo}</strong>. Vamos avisar aqui a cada etapa.</div></div>`}

        <header class="pedido__cab">
          <div><h1>Pedido ${p.codigo}</h1><p class="texto-suave">Feito em ${dataHora(p.criado_em)}</p></div>
          <span class="status status--${p.status} status--grande">${p.status_texto}</span>
        </header>

        <div class="pedido__status">
          ${linhaDoTempo(p)}
          <p class="pedido__mensagem ${p.status === "cancelado" && "pedido__mensagem--cancelado"}">${mensagemDoStatus(p)}</p>
          ${ativo && html`<small class="texto-suave">${icone("atualizar", { tamanho: 13 })} Atualizamos automaticamente.</small>`}
        </div>

        ${p.pix && blocoPix()}

        <div class="pedido__grade">
          <div class="pedido__coluna">
            <section class="cartao-form">
              <h2>Itens do pedido</h2>
              <ul class="pedido__itens">${p.itens.map((i) => html`
                <li><div><strong>${i.qtd}× ${i.nome}</strong>
                  ${i.opcoes.map((o) => html`<small>${o.grupo}: ${o.itens.map((x) => x.nome).join(", ")}</small>`)}
                  ${i.obs && html`<small class="item-carrinho__obs">“${i.obs}”</small>`}</div><span>${brl(i.total)}</span></li>`)}</ul>
              <dl class="resumo__totais">
                <div><dt>Subtotal</dt><dd>${brl(p.subtotal)}</dd></div>
                ${p.tipo === "entrega" && html`<div><dt>Entrega</dt><dd>${p.taxa_entrega > 0 ? brl(p.taxa_entrega) : "Grátis"}</dd></div>`}
                ${p.desconto > 0 && html`<div class="resumo__desconto"><dt>Cupom ${p.cupom}</dt><dd>− ${brl(p.desconto)}</dd></div>`}
                <div class="resumo__total"><dt>Total</dt><dd>${brl(p.total)}</dd></div>
                ${p.pago > 0 && html`<div class="resumo__desconto"><dt>Já pago</dt><dd>− ${brl(p.pago)}</dd></div>
                  <div><dt>Falta pagar</dt><dd>${brl(p.saldo)}</dd></div>`}
              </dl>
            </section>

            ${p.historico.length > 1 && html`<section class="cartao-form"><h2>Histórico</h2>
              <ul class="historico">${[...p.historico].reverse().map((h) => html`
                <li><span class="status status--${h.status}">${h.status_texto}</span><small class="texto-suave">${dataHora(h.criado_em)}</small>${h.nota && html`<small>${h.nota}</small>`}</li>`)}</ul></section>`}
          </div>

          <div class="pedido__coluna">
            <section class="cartao-form">
              <h2>${p.tipo === "entrega" ? "Entrega" : "Retirada"}</h2>
              <p>${icone("calendario", { tamanho: 16 })} <strong>${dataPorExtenso(p.data)}</strong> às <strong>${p.hora}</strong></p>
              ${p.tipo === "entrega" && p.endereco
                ? html`<p>${icone("pino", { tamanho: 16 })} ${enderecoEmLinha(p.endereco)}</p>
                    ${p.endereco.referencia && html`<p class="texto-suave">Ref.: ${p.endereco.referencia}</p>`}
                    ${p.distancia_km != null && html`<p class="texto-suave">${km(p.distancia_km)} da loja</p>`}
                    ${p.lat != null && html`<div class="mapa mapa--pequeno" data-mapa></div>`}`
                : html`<p>${icone("pino", { tamanho: 16 })} ${estado.config.loja.endereco}${estado.config.loja.cidade && ` — ${estado.config.loja.cidade}/${estado.config.loja.uf}`}</p>`}
            </section>

            <section class="cartao-form">
              <h2>Pagamento</h2>
              <p>${icone("cartao", { tamanho: 16 })} ${p.pagamento_texto}</p>
              ${p.troco_para && html`<p class="texto-suave">Troco para ${brl(p.troco_para)}</p>`}
              ${p.sinal > 0 && html`<p class="texto-suave">Sinal de ${brl(p.sinal)}: <strong>${p.pago >= p.sinal ? "recebido" : "aguardando pagamento"}</strong></p>`}
              ${p.observacoes && html`<p class="texto-suave">Obs.: ${p.observacoes}</p>`}
            </section>

            <div class="pedido__acoes">
              ${whats && html`<a href="${whats}" target="_blank" rel="noopener" class="btn btn--whats">${icone("mensagem", { tamanho: 17 })} Falar com a loja</a>`}
              <button type="button" class="btn btn--contorno" data-acao="refazer">${icone("atualizar", { tamanho: 17 })} Pedir de novo</button>
              ${podeCancelar && html`<button type="button" class="btn btn--perigo-suave" data-acao="cancelar">Cancelar pedido</button>`}
            </div>
          </div>
        </div>

        ${p.status === "entregue" && (p.avaliacao
          ? html`<section class="cartao-form avaliacao"><h2>Sua avaliação</h2><p>${estrelas(p.avaliacao.nota, { tamanho: 20 })}</p>
              ${p.avaliacao.comentario && html`<p>“${p.avaliacao.comentario}”</p>`}
              ${p.avaliacao.resposta && html`<p class="depoimento__resposta"><strong>Resposta da loja:</strong> ${p.avaliacao.resposta}</p>`}
              ${!p.avaliacao.aprovada && html`<small class="texto-suave">Sua avaliação aparece na loja depois de revisada. Obrigada!</small>`}</section>`
          : html`<form class="cartao-form avaliacao" id="form-avaliar" novalidate>
              <h2>Como foi o seu pedido?</h2><p class="texto-suave">Sua opinião ajuda muito a nossa loja.</p>
              ${escolherNota("nota")}
              <div class="campo"><label for="comentario">Comentário <span class="texto-suave">(opcional)</span></label>
                <textarea id="comentario" name="comentario" class="entrada" rows="3" maxlength="500" placeholder="Conte o que você mais gostou…"></textarea></div>
              <button type="submit" class="btn btn--primario">Enviar avaliação</button></form>`)}
      </section>`);

    desenharMapa();
  }

  let sequencia = 0; // dois temporizadores consultam o pedido: só vale a resposta da consulta mais recente
  async function atualizar() {
    const minha = ++sequencia;
    try {
      const novoPedido = (await api.get(`/pedidos/${encodeURIComponent(codigo)}`)).pedido;
      if (!ctx.ativo() || minha !== sequencia) return;
      if (novoPedido.status !== p.status) toast(`Seu pedido agora está: ${novoPedido.status_texto}`, "info", 5000);
      if (novoPedido.pago > p.pago) toast("Pagamento confirmado! Obrigada.", "sucesso", 6000);
      if (!novoPedido.pix) { clearInterval(sondagem); qr = null; } // pago: some a cobrança
      const mudou = novoPedido.status !== p.status || novoPedido.atualizado_em !== p.atualizado_em
        || novoPedido.pago !== p.pago || Boolean(novoPedido.pix) !== Boolean(p.pix); // o carimbo tem precisão de 1 s: confere também o pagamento
      p = novoPedido;
      if (mudou) desenhar();
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  desenhar();
  if (STATUS_ATIVOS.includes(p.status)) timer = setInterval(() => { if (STATUS_ATIVOS.includes(p.status)) atualizar(); else clearInterval(timer); }, 15000);

  delegar(ctx.raiz, {
    "copiar-pix": () => copiar(gerarPix(p.pix)),
    "copiar-pix-auto": () => copiar(qr.qr_code),
    "gerar-pix": async (el) => {
      await ocupado(el, async () => {
        try {
          qr = await api.post("/pix/gerar", { codigo });
          desenhar();
          clearInterval(sondagem);
          sondagem = setInterval(atualizar, 4000);
        } catch (erro) { toast(`${erro.message} Você pode usar o código de pagamento da loja.`, "erro", 6000); }
      });
    },
    refazer: () => {
      const n = refazerPedido(p);
      if (n) { toast(`${n} item(ns) voltaram ao carrinho.`); ctx.ir("/finalizar"); }
      else toast("Esses produtos não estão mais disponíveis.", "info");
    },
    cancelar: async (el) => {
      if (!(await confirmar({ titulo: "Cancelar pedido", mensagem: "Tem certeza que deseja cancelar este pedido?", rotulo: "Sim, cancelar", perigo: true }))) return;
      await ocupado(el, async () => {
        try { p = (await api.post(`/pedidos/${encodeURIComponent(codigo)}/cancelar`, { motivo: "Cancelado pelo cliente" })).pedido; desenhar(); toast("Pedido cancelado.", "info"); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    },
  });

  ctx.raiz.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "form-avaliar") return;
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target));
    if (!dados.nota) { toast("Escolha de 1 a 5 estrelas.", "info"); return; }
    await ocupado(ev.target.querySelector("[type=submit]"), async () => {
      try {
        p = (await api.post(`/pedidos/${encodeURIComponent(codigo)}/avaliar`, { nota: Number(dados.nota), comentario: dados.comentario ?? "" })).pedido;
        desenhar();
        toast("Obrigada pela sua avaliação!");
      } catch (erro) { toast(erro.message, "erro"); }
    });
  });

  return () => { clearInterval(timer); clearInterval(sondagem); mapa?.destruir(); };
}

