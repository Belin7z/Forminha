/* ==========================================================
   ESTOQUE — aba Histórico: tudo o que entrou e saiu (compras,
   contagens, perdas e o que os pedidos usaram), com o saldo.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { brl, dataHora } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { TIPOS_MOVIMENTO, qtdComSinal, qtdTexto } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, vazio } from "./pagina.js";

/** "Pedido LA1001 · R$ 16,00 · mercado" (sem repetir o pedido quando a observação já o cita). */
function detalhe(m) {
  const partes = [];
  if (m.pedido && !String(m.nota ?? "").includes(m.pedido)) partes.push(`Pedido ${m.pedido}`);
  if (m.valor > 0) partes.push(brl(m.valor));
  if (m.nota) partes.push(m.nota);
  return partes.join(" · ") || "—";
}

export async function historicoEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let ingredientes, itens, filtro = "";

  async function carregar() {
    try {
      if (!ingredientes) ingredientes = (await api.get("/ingredientes")).ingredientes;
      itens = (await api.get(`/estoque/movimentos?limite=200${filtro ? `&ingrediente_id=${filtro}` : ""}`)).itens;
    } catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  function desenhar() {
    montar(ctx.raiz, html`
      <div class="filtros-barra">
        <label class="est-periodo"><span>Ingrediente</span>
          <select class="entrada entrada--auto" data-acao-mudar="ingrediente" aria-label="Filtrar por ingrediente">
            <option value="">Todos</option>${ingredientes.map((i) => html`<option value="${i.id}" ${String(i.id) === filtro && "selected"}>${i.nome}</option>`)}</select></label>
        <span class="texto-suave">Mostra os 200 lançamentos mais recentes.</span>
      </div>
      <div class="cartao cartao--sem-margem">${itens.length ? html`<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Quando</th><th>Ingrediente</th><th>O que houve</th><th class="texto-direita">Quantidade</th><th class="texto-direita">Ficou com</th><th>Detalhe</th><th>Quem</th></tr></thead>
        <tbody>${itens.map((m) => { const [classe, texto] = TIPOS_MOVIMENTO[m.tipo] ?? ["badge--neutro", m.tipo]; return html`<tr>
          <td class="nowrap"><small>${dataHora(m.quando)}</small></td>
          <td><strong>${m.ingrediente}</strong></td>
          <td><span class="badge ${classe}">${texto}</span></td>
          <td class="texto-direita"><strong class="${Number(m.quantidade) < 0 ? "est__saida" : "est__entrada"}">${qtdComSinal(m.quantidade, m.unidade)}</strong></td>
          <td class="texto-direita ${Number(m.saldo) < 0 && "est__qtd--zero"}">${qtdTexto(m.saldo, m.unidade)}</td>
          <td><small class="texto-suave">${detalhe(m)}</small></td>
          <td><small>${m.usuario ?? "Sistema"}</small></td></tr>`; })}</tbody></table></div>`
        : vazio("relogio", "Nenhum lançamento ainda", "As compras, contagens, perdas e o que os pedidos usam aparecem aqui.")}</div>`);
  }

  ctx.raiz.addEventListener("change", async (ev) => {
    if (ev.target.dataset?.acaoMudar !== "ingrediente") return;
    filtro = ev.target.value;
    if (await carregar()) desenhar();
  });

  if (await carregar()) desenhar();
}
