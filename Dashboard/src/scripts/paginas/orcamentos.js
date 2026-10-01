/* ==========================================================
   PÁGINA — orçamentos: os pedidos de encomenda personalizada que
   chegam pela loja (com fotos de referência). A dona responde com
   o valor, o sinal, a data e o horário — ou recusa com um recado.
   Quando o cliente aceita, o orçamento vira um pedido.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, dataHora, dataPorExtenso, emReais, enderecoEmLinha, paraCentavos, telefone } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";
import { atualizarContagem } from "../nucleo/notificacoes.js";
import { urlDaLoja } from "../nucleo/enderecos.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";
import { abrirPedido } from "../componentes/detalhe-pedido.js";

const FILTROS = [["novo", "Novos"], ["respondido", "Proposta enviada"], ["aceito", "Aceitos"], ["todos", "Todos"]];
const STATUS = {
  novo: ["badge--aviso", "Novo"], respondido: ["badge--info", "Proposta enviada"], aceito: ["badge--sucesso", "Aceito — virou pedido"],
  recusado: ["badge--neutro", "Recusado"], cancelado: ["badge--neutro", "Cancelado pelo cliente"],
};
const selo = (status) => { const [c, t] = STATUS[status] ?? STATUS.novo; return html`<span class="badge ${c}">${t}</span>`; };

/** Mensagem pronta para avisar o cliente no WhatsApp que a proposta está na loja. */
function linkAviso(o) {
  const loja = urlDaLoja();
  const r = o.resposta ?? {};
  const texto = o.status === "recusado"
    ? `Olá, ${o.cliente.nome.split(" ")[0]}! Sobre o seu pedido de orçamento #${o.id}: ${r.mensagem || "infelizmente não conseguimos atender desta vez."}`
    : `Olá, ${o.cliente.nome.split(" ")[0]}! O seu orçamento #${o.id} está pronto${r.titulo ? `: ${r.titulo}` : ""}, ${brl(r.total)}. Veja os detalhes e confirme${loja ? ` aqui: ${loja}/#/conta/orcamentos` : " em Minha conta → Orçamentos, na loja"}.`;
  return o.cliente.telefone ? `https://wa.me/55${o.cliente.telefone}?text=${encodeURIComponent(texto)}` : "";
}

function abrirOrcamento(id, aoMudar) {
  const m = abrirModal({ titulo: `Orçamento #${id}`, largura: 860, classe: "modal-orcamento", corpo: carregandoPagina });

  function desenhar(o) {
    const r = o.resposta ?? {};
    const aberto = ["novo", "respondido"].includes(o.status);
    const aviso = ["respondido", "recusado"].includes(o.status) && linkAviso(o);
    m.corpo.innerHTML = String(html`
      <div class="orc-detalhe">
        <div class="orc-detalhe__topo">${selo(o.status)} <small class="texto-suave">Pedido em ${dataHora(o.criado_em)}</small></div>
        <div class="ped-grade">
          <div>
            <section class="ped-bloco">
              <h3>O que o cliente quer</h3>
              <p class="orc-detalhe__desc">${o.descricao}</p>
              <dl class="orc-detalhe__dados">
                <div><dt>Para quando</dt><dd>${dataPorExtenso(o.data_desejada)}</dd></div>
                ${o.quantidade && html`<div><dt>Quantidade</dt><dd>${o.quantidade}</dd></div>`}
                ${o.verba && html`<div><dt>Pretende gastar</dt><dd>${o.verba}</dd></div>`}
                <div><dt>Como recebe</dt><dd>${o.tipo === "entrega" ? html`Entrega · ${enderecoEmLinha(o.endereco ?? {})}` : "Retira na loja"}</dd></div>
              </dl>
            </section>
            ${o.fotos.length > 0 && html`
              <section class="ped-bloco">
                <h3>Fotos de referência</h3>
                <div class="orc-fotos">${o.fotos.map((f, i) => html`<button type="button" class="orc-fotos__foto" data-ampliar="${i}" aria-label="Ampliar a foto ${i + 1}"><img src="${f}" alt="Referência ${i + 1}"></button>`)}</div>
              </section>`}
          </div>
          <div>
            <section class="ped-bloco">
              <h3>Cliente</h3>
              <p><strong>${o.cliente.nome}</strong></p>
              ${o.cliente.telefone && html`<p class="linha-flex">${icone("telefone", { tamanho: 15 })} ${telefone(o.cliente.telefone)}
                <a class="btn btn--whats btn--pequeno" target="_blank" rel="noopener" href="https://wa.me/55${o.cliente.telefone}">${icone("mensagem", { tamanho: 14 })} Conversar</a></p>`}
            </section>
            ${o.status === "respondido" && html`
              <section class="ped-bloco">
                <h3>Proposta enviada</h3>
                <p><strong>${r.titulo || "Encomenda"}</strong> · ${brl(r.total)}${r.sinal > 0 ? ` (sinal ${brl(r.sinal)})` : ""}</p>
                <p class="texto-suave">${dataPorExtenso(r.data)} às ${r.hora} · vale até ${r.valido_ate.split("-").reverse().join("/")}</p>
              </section>`}
            ${o.status === "aceito" && o.pedido && html`
              <section class="ped-bloco">
                <h3>Virou o pedido ${o.pedido.codigo}</h3>
                <button type="button" class="btn btn--primario btn--pequeno" data-abrir-pedido="${o.pedido.id}">${icone("pacote", { tamanho: 15 })} Abrir o pedido</button>
              </section>`}
            ${o.status === "recusado" && r.mensagem && html`<section class="ped-bloco"><h3>Recado enviado</h3><p class="texto-suave">“${r.mensagem}”</p></section>`}
            ${aviso && html`<a class="btn btn--whats btn--pequeno" target="_blank" rel="noopener" href="${aviso}">${icone("mensagem", { tamanho: 14 })} Avisar o cliente no WhatsApp</a>`}
          </div>
        </div>
        ${aberto && html`
          <form id="form-proposta" class="ped-acoes orc-proposta" novalidate>
            <h3>${o.status === "novo" ? "Responder com uma proposta" : "Atualizar a proposta"}</h3>
            <div class="form-erro" data-erro-geral hidden></div>
            ${campo({ nome: "titulo", rotulo: "Nome da encomenda (aparece no pedido)", valor: r.titulo ?? "", atributos: 'maxlength="80"', placeholder: "Ex.: Bolo jardim 2 andares — 40 fatias" })}
            <div class="grade-campos grade-campos--3">
              ${campo({ nome: "valor", rotulo: "Valor da encomenda (R$)", valor: emReais(r.valor ?? 0), obrigatorio: true, mascara: "moeda" })}
              ${o.tipo === "entrega" && campo({ nome: "taxa_entrega", rotulo: "Entrega (R$)", valor: emReais(r.taxa_entrega ?? 0), mascara: "moeda" })}
              ${campo({ nome: "sinal", rotulo: "Sinal para confirmar (R$)", valor: emReais(r.sinal ?? 0), mascara: "moeda", ajuda: "0 = sem sinal." })}
            </div>
            <div class="grade-campos grade-campos--3">
              ${campo({ nome: "data", rotulo: "Data", tipo: "date", valor: r.data ?? o.data_desejada, obrigatorio: true })}
              ${campo({ nome: "hora", rotulo: "Horário", tipo: "time", valor: r.hora ?? "", obrigatorio: true })}
              ${campo({ nome: "validade_dias", rotulo: "Proposta vale por (dias)", tipo: "number", valor: 7, atributos: 'min="1" max="60"' })}
            </div>
            ${campo({ nome: "mensagem", rotulo: "Recado para o cliente (opcional)", tipo: "textarea", linhas: 2, valor: r.mensagem ?? "", atributos: 'maxlength="1000"', placeholder: "Ex.: inclui topo de papel e plaquinha com o nome." })}
            <div class="linha-flex">
              <button type="submit" class="btn btn--primario">${icone("check", { tamanho: 16 })} ${o.status === "novo" ? "Enviar proposta" : "Atualizar proposta"}</button>
              <button type="button" class="btn btn--perigo-suave" data-recusar>Recusar</button>
            </div>
          </form>`}
      </div>`);

    m.corpo.querySelectorAll("[data-ampliar]").forEach((b) => b.addEventListener("click", () => b.classList.toggle("orc-fotos__foto--grande")));
    m.corpo.querySelector("[data-abrir-pedido]")?.addEventListener("click", (ev) => { m.fechar(); abrirPedido(Number(ev.currentTarget.dataset.abrirPedido)); });
    const form = m.corpo.querySelector("#form-proposta");
    if (!form) return;
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          const { orcamento } = await api.post(`/orcamentos/${o.id}/responder`, {
            ...d, valor: paraCentavos(d.valor), taxa_entrega: paraCentavos(d.taxa_entrega ?? "0"), sinal: paraCentavos(d.sinal), validade_dias: Number(d.validade_dias) || 7,
          });
          toast("Proposta enviada! Avise o cliente no WhatsApp.");
          desenhar(orcamento);
          aoMudar?.(orcamento);
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
    form.querySelector("[data-recusar]").addEventListener("click", async (ev) => {
      const mensagem = form.elements.mensagem.value.trim();
      if (!mensagem && !confirm("Recusar sem deixar um recado para o cliente?")) return;
      await ocupado(ev.currentTarget, async () => {
        try {
          const { orcamento } = await api.post(`/orcamentos/${o.id}/recusar`, { mensagem });
          toast("Orçamento recusado.", "info");
          desenhar(orcamento);
          aoMudar?.(orcamento);
        } catch (erro) { toast(erro.message, "erro"); }
      });
    });
  }

  api.get(`/orcamentos/${id}`).then(({ orcamento }) => { if (!m.fechado) desenhar(orcamento); })
    .catch((erro) => { m.corpo.innerHTML = String(erroPagina(erro.message)); });
  return m;
}

export async function orcamentos(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let filtro = FILTROS.some(([f]) => f === ctx.consulta.status) ? ctx.consulta.status : "novo";
  let r;
  const carregar = async () => {
    try { r = await api.get(`/orcamentos?status=${filtro}`); return ctx.ativo(); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
  };
  if (!(await carregar())) return;

  function desenhar() {
    montar(ctx.raiz, html`
      ${cabecalhoPagina({ titulo: "Orçamentos", descricao: "Pedidos de encomenda personalizada feitos pela loja. Responda com o valor: aceitando, vira pedido." })}
      ${estado.usuario?.papel === "admin" && html`<section class="cartao orc-config">
        <form id="f-orc-config" class="orc-config__form" novalidate>
          ${interruptor({ nome: "ativo", rotulo: "Receber pedidos de orçamento pela loja", marcado: r.ativo, ajuda: "Aparece o botão “Pedir orçamento” no início, no cardápio e no rodapé da loja." })}
          ${campo({ nome: "texto", rotulo: "Convite (opcional)", valor: r.texto, atributos: 'maxlength="200"', placeholder: "Ex.: Bolos de festa, mesas de doces e kits sob medida." })}
          <button type="submit" class="btn btn--suave btn--pequeno">Salvar</button>
        </form>
      </section>`}
      <div class="chips orc-filtros" role="tablist" aria-label="Situação">
        ${FILTROS.map(([f, t]) => html`<button type="button" class="chip ${f === filtro && "chip--ativo"}" data-acao="filtro" data-filtro="${f}" role="tab" aria-selected="${String(f === filtro)}">${t}${f !== "todos" && r.contagem[f] ? html` <small>${r.contagem[f]}</small>` : ""}</button>`)}
      </div>
      ${r.orcamentos.length ? html`
        <div class="orc-lista">${r.orcamentos.map((o) => html`
          <button type="button" class="orc-item cartao" data-acao="abrir" data-id="${o.id}">
            <div class="orc-item__cab"><strong>#${o.id} · ${o.cliente.nome}</strong>${selo(o.status)}</div>
            <p class="orc-item__desc">${o.descricao}</p>
            <small class="texto-suave">${icone("calendario", { tamanho: 13 })} para ${dataPorExtenso(o.data_desejada)}${o.quantidade && ` · ${o.quantidade}`} · ${o.tipo === "entrega" ? "entrega" : "retirada"}${o.n_fotos ? ` · ${o.n_fotos} foto${o.n_fotos > 1 ? "s" : ""}` : ""}
              ${o.resposta?.total ? html` · <strong>${brl(o.resposta.total)}</strong>` : ""}</small>
          </button>`)}</div>`
        : vazio("documento", filtro === "novo" ? "Nenhum orçamento novo" : "Nada por aqui", filtro === "novo" ? "Quando um cliente pedir um orçamento pela loja, ele aparece aqui (e o menu avisa)." : "Mude o filtro para ver outros.")}`);
    const form = ctx.raiz.querySelector("#f-orc-config");
    if (!form) return;
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try { Object.assign(r, await api.put("/orcamentos/config", dadosDe(form))); toast(r.ativo ? "Pedidos de orçamento ligados na loja." : "Pedidos de orçamento desligados.", "info"); }
        catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }
  desenhar();

  const recarregar = async () => { if (await carregar()) { desenhar(); atualizarContagem(); } };
  delegar(ctx.raiz, {
    filtro: async (el) => { filtro = el.dataset.filtro; history.replaceState(null, "", `#/orcamentos?status=${filtro}`); await recarregar(); },
    abrir: (el) => abrirOrcamento(Number(el.dataset.id), recarregar),
  });
}
