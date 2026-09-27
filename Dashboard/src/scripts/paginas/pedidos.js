/* ==========================================================
   PÁGINA — pedidos: quadro por etapa (estilo "cozinha") e lista,
   com busca, filtro por data, avanço rápido de status e detalhe.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { toast, ocupado } from "/src/scripts/base/ui.js";
import { brl, dataBR, dataCurta, plural } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { STATUS_ATIVOS, STATUS_TEXTO, proximosStatus, statusTexto } from "/src/scripts/base/dominio.js";
import { api } from "../nucleo/api.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { atualizarContagem } from "../nucleo/notificacoes.js";
import { cabecalhoPagina, carregandoPagina, vazio } from "../componentes/pagina.js";
import { abrirPedido, avisarCliente, situacaoPagamento } from "../componentes/detalhe-pedido.js";
import { abrirExportacaoPedidos } from "../componentes/planilha.js";
import { armazenamento } from "/src/scripts/base/armazenamento.js";

const ABAS = [
  ["ativos", "Em aberto"], ["novo", "Novos"], ["confirmado", "Confirmados"], ["em_preparo", "Em preparo"],
  ["pronto", "Prontos"], ["saiu_entrega", "Em entrega"], ["entregue", "Entregues"], ["cancelado", "Cancelados"], ["todos", "Todos"],
];

/** "Hoje", "Amanhã" ou a data — para o quadro ficar fácil de ler. */
function rotuloDia(iso) {
  const hoje = new Date();
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  if (iso === dataISO(hoje)) return "Hoje";
  if (iso === dataISO(amanha)) return "Amanhã";
  return dataCurta(iso);
}

export async function pedidos(ctx) {
  const f = { status: "ativos", busca: "", data: "", pagina: 1, visao: armazenamento.ler("zqp.visao", "quadro") };
  let dados = null;
  let temporizador;

  montar(ctx.raiz, html`
    ${cabecalhoPagina({
      titulo: "Pedidos", descricao: "Acompanhe, confirme e avance cada pedido até a entrega.",
      acoes: html`<a href="#/pedidos/novo" class="btn btn--primario">${icone("mais", { tamanho: 17 })} Novo pedido</a>
        <button type="button" class="btn btn--contorno" data-acao="exportar">${icone("baixar", { tamanho: 16 })} Exportar</button>
        <div class="segmentos" role="group" aria-label="Visualização">
        <button type="button" class="segmento" data-acao="visao" data-v="quadro">${icone("grade", { tamanho: 15 })} Quadro</button>
        <button type="button" class="segmento" data-acao="visao" data-v="lista">${icone("lista", { tamanho: 15 })} Lista</button></div>`,
    })}
    <div class="filtros-barra">
      <div class="busca"><input type="search" id="busca" placeholder="Buscar por código, cliente ou telefone…" aria-label="Buscar pedidos" autocomplete="off">${icone("busca", { tamanho: 18 })}</div>
      <label class="filtro-data">${icone("calendario", { tamanho: 16 })}<span class="sr-only">Data agendada</span>
        <input type="date" id="filtro-data" class="entrada" aria-label="Filtrar pela data agendada"></label>
      <button type="button" class="btn btn--suave btn--pequeno" data-acao="atualizar">${icone("atualizar", { tamanho: 15 })} Atualizar</button>
    </div>
    <div class="abas-status" id="abas" role="tablist"></div>
    <div id="resultado">${carregandoPagina}</div>`);

  const $ = (s) => ctx.raiz.querySelector(s);

  function desenharAbas() {
    const c = estado.contagem;
    const n = (id) => (id === "ativos" ? c.ativos : id === "todos" ? Object.entries(c).filter(([k]) => k !== "ativos").reduce((s, [, v]) => s + v, 0) : c[id]) ?? 0;
    montar($("#abas"), html`${ABAS.map(([id, texto]) => html`
      <button type="button" role="tab" class="aba-status ${id === f.status && "aba-status--ativa"} ${id === "novo" && n("novo") > 0 && "aba-status--alerta"}"
              data-acao="aba" data-id="${id}" aria-selected="${String(id === f.status)}">${texto} <b>${n(id)}</b></button>`)}`);
    ctx.raiz.querySelectorAll("[data-acao=visao]").forEach((b) => {
      const ativo = b.dataset.v === f.visao;
      b.classList.toggle("segmento--ativo", ativo);
      b.setAttribute("aria-pressed", String(ativo));
    });
  }

  /* ---------- Quadro ---------- */
  function cartaoQuadro(p) {
    const proximo = proximosStatus(p.status, p.tipo).find((s) => s !== "cancelado");
    return html`
      <article class="cartao-pedido cartao-pedido--${p.status}" data-acao="abrir" data-id="${p.id}" tabindex="0" role="button" aria-label="Abrir pedido ${p.codigo}">
        <div class="cartao-pedido__topo"><strong>${p.codigo}</strong><span class="cartao-pedido__total">${brl(p.total)}</span></div>
        <p class="cartao-pedido__cliente">${p.cliente.nome}</p>
        <p class="cartao-pedido__quando ${rotuloDia(p.data) === "Hoje" && "cartao-pedido__quando--hoje"}">${icone("relogio", { tamanho: 14 })} ${rotuloDia(p.data)} às ${p.hora}</p>
        <p class="cartao-pedido__meta">${icone(p.tipo === "entrega" ? "caminhao" : "sacola", { tamanho: 14 })} ${p.tipo === "entrega" ? "Entrega" : "Retirada"} · ${plural(p.qtd_itens, "item", "itens")}</p>
        ${p.pagamento_situacao !== "pendente" && html`<p class="cartao-pedido__meta"><span class="badge ${situacaoPagamento(p)[0]}">${situacaoPagamento(p)[1]}</span></p>`}
        ${proximo && html`<button type="button" class="btn btn--primario btn--pequeno btn--bloco" data-acao="avancar" data-id="${p.id}" data-status="${proximo}">${statusTexto(proximo, p.tipo)} ${icone("direita", { tamanho: 14 })}</button>`}
      </article>`;
  }

  function quadro() {
    const colunas = STATUS_ATIVOS.map((s) => ({ s, itens: dados.itens.filter((p) => p.status === s) }));
    return html`<div class="quadro">${colunas.map(({ s, itens }) => html`
      <section class="coluna-quadro" aria-label="${STATUS_TEXTO[s]}">
        <header><span class="status status--${s}">${STATUS_TEXTO[s]}</span><b>${itens.length}</b></header>
        <div class="coluna-quadro__lista">${itens.length ? itens.map(cartaoQuadro) : html`<p class="coluna-quadro__vazio">Nenhum pedido</p>`}</div>
      </section>`)}</div>`;
  }

  /* ---------- Lista ---------- */
  function lista() {
    return html`<div class="cartao cartao--sem-margem"><div class="tabela-rolagem"><table class="tabela tabela--clicavel">
      <thead><tr><th>Pedido</th><th>Cliente</th><th>Agendado para</th><th>Recebimento</th><th>Pagamento</th><th>Situação</th><th class="texto-direita">Total</th></tr></thead>
      <tbody>${dados.itens.map((p) => html`<tr data-acao="abrir" data-id="${p.id}" tabindex="0">
        <td><strong>${p.codigo}</strong><br><small class="texto-suave">${plural(p.qtd_itens, "item", "itens")}</small></td>
        <td>${p.cliente.nome}</td>
        <td><strong>${rotuloDia(p.data)}</strong> ${dataBR(p.data)} às ${p.hora}</td>
        <td>${icone(p.tipo === "entrega" ? "caminhao" : "sacola", { tamanho: 14 })} ${p.tipo === "entrega" ? "Entrega" : "Retirada"}</td>
        <td>${p.pagamento_texto.split(" (")[0]}${p.pagamento_situacao !== "pendente" && html`<br><span class="badge ${situacaoPagamento(p)[0]}">${situacaoPagamento(p)[1]}</span>`}</td>
        <td><span class="status status--${p.status}">${p.status_texto}</span></td>
        <td class="texto-direita"><strong>${brl(p.total)}</strong></td></tr>`)}</tbody></table></div></div>`;
  }

  function desenharResultado() {
    desenharAbas();
    if (!dados.itens.length) {
      montar($("#resultado"), vazio("pacote", "Nenhum pedido por aqui", f.busca || f.data ? "Nenhum pedido corresponde aos filtros." : "Quando chegarem pedidos, eles aparecem neste quadro."));
      return;
    }
    const usarQuadro = f.visao === "quadro" && f.status === "ativos";
    montar($("#resultado"), html`
      ${usarQuadro ? quadro() : lista()}
      ${dados.total > dados.itens.length && html`<div class="paginacao">
        ${usarQuadro
          ? html`<small class="texto-suave">Mostrando ${dados.itens.length} de ${dados.total} pedidos em aberto. Use a lista para ver todos.</small>`
          : html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="pagina" data-p="${f.pagina - 1}" ${f.pagina <= 1 && "disabled"}>Anterior</button>
              <small class="texto-suave">Página ${dados.pagina} de ${dados.paginas} · ${plural(dados.total, "pedido")}</small>
              <button type="button" class="btn btn--suave btn--pequeno" data-acao="pagina" data-p="${f.pagina + 1}" ${f.pagina >= dados.paginas && "disabled"}>Próxima</button>`}
      </div>`}`);
  }

  async function carregar() {
    const q = new URLSearchParams({ status: f.status, pagina: f.pagina });
    if (f.busca) q.set("busca", f.busca);
    if (f.data) q.set("data", f.data);
    try {
      const [resposta] = await Promise.all([api.get(`/pedidos?${q}`), atualizarContagem()]);
      if (!ctx.ativo()) return;
      dados = resposta;
      desenharResultado();
    } catch (erro) {
      if (ctx.ativo()) montar($("#resultado"), html`<div class="aviso aviso--perigo">${erro.message}</div>`);
    }
  }

  delegar(ctx.raiz, {
    visao: (el) => { f.visao = el.dataset.v; armazenamento.gravar("zqp.visao", f.visao); if (dados) desenharResultado(); },
    aba: (el) => { f.status = el.dataset.id; f.pagina = 1; carregar(); },
    atualizar: () => carregar(),
    exportar: () => abrirExportacaoPedidos(),
    pagina: (el) => { f.pagina = Number(el.dataset.p); carregar(); },
    abrir: (el) => abrirPedido(el.dataset.id, carregar),
    avancar: async (el) => {
      await ocupado(el, async () => {
        try {
          const { pedido } = await api.patch(`/pedidos/${el.dataset.id}/status`, { status: el.dataset.status, nota: "" });
          toast(`${pedido.codigo}: ${pedido.status_texto}`);
          avisarCliente(pedido); // sem esperar: o aviso sai em segundo plano
          await carregar();
        } catch (erro) { toast(erro.message, "erro"); }
      });
    },
  });
  ctx.raiz.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("[data-acao=abrir]")) { ev.preventDefault(); abrirPedido(ev.target.dataset.id, carregar); }
  });
  $("#busca").addEventListener("input", (ev) => { clearTimeout(temporizador); temporizador = setTimeout(() => { f.busca = ev.target.value.trim(); f.pagina = 1; carregar(); }, 300); });
  $("#filtro-data").addEventListener("change", (ev) => { f.data = ev.target.value; f.pagina = 1; carregar(); });

  desenharAbas();
  await carregar();
  if (/^\d+$/.test(ctx.consulta.abrir ?? "")) abrirPedido(ctx.consulta.abrir, carregar); // link vindo da Agenda
  const desligar = [ouvir("pedidos-novos", carregar)];
  return () => { clearTimeout(temporizador); desligar.forEach((d) => d()); };
}
