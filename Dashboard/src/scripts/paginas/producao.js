/* PÁGINA — produção: o que fazer em cada data (totais por item e roteiro por horário), pronta para imprimir */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { dataPorExtenso, plural } from "/src/scripts/base/formatacao.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";

const inicial = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const somarDias = (iso, n) => {
  const [a, m, d] = iso.split("-").map(Number);
  return dataISO(new Date(a, m - 1, d + n));
};
/** [{grupo, itens}] de um pedido -> "Cobertura: Chocolate · Recheio: Ninho" */
const opcoesTexto = (opcoes) => (Array.isArray(opcoes) ? opcoes : []).map((o) => `${o.grupo}: ${(o.itens ?? []).map((i) => i.nome ?? i).join(", ")}`).join(" · ");

export async function producao(ctx) {
  montar(ctx.raiz, carregandoPagina);
  const amanha = somarDias(dataISO(new Date()), 1);
  let data = /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.data ?? "") ? ctx.params.data : amanha;
  let incluirEntregues = false;
  let r;

  async function carregar() {
    try { r = await api.get(`/producao?data=${data}&incluir_entregues=${incluirEntregues}`); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  function desenhar() {
    const unidades = r.itens.reduce((s, i) => s + Number(i.qtd), 0);
    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Produção", descricao: "Tudo o que precisa ser feito para a data escolhida, somando todos os pedidos ativos.",
        acoes: html`<button type="button" class="btn btn--primario" data-acao="imprimir">${icone("impressora", { tamanho: 17 })} Imprimir</button>`,
      })}
      <div class="prod__controles cartao cartao--sem-margem">
        <button type="button" class="btn-icone" data-acao="anterior" aria-label="Dia anterior">${icone("voltar", { tamanho: 18 })}</button>
        <div class="prod__data"><strong>${inicial(dataPorExtenso(data))}</strong>
          <input type="date" class="entrada entrada--auto" value="${data}" data-acao-mudar="data" aria-label="Escolher a data"></div>
        <button type="button" class="btn-icone" data-acao="seguinte" aria-label="Próximo dia">${icone("direita", { tamanho: 18 })}</button>
        <label class="prod__opcao"><input type="checkbox" data-acao-mudar="entregues" ${incluirEntregues && "checked"}> Incluir já entregues</label>
      </div>

      <div class="prod__folha">
        <header class="prod__cab-impressao"><h2>Produção — ${inicial(dataPorExtenso(data))}</h2></header>
        ${r.pedidos.length ? html`
          <div class="prod__resumo">
            <div><strong>${plural(r.pedidos.length, "pedido")}</strong><small>na data</small></div>
            <div><strong>${unidades}</strong><small>${unidades === 1 ? "unidade" : "unidades"} no total</small></div>
            <div><strong>${r.itens.length}</strong><small>${r.itens.length === 1 ? "item diferente" : "itens diferentes"}</small></div>
          </div>
          <section class="cartao cartao--sem-margem">
            <h2 class="cartao__titulo">O que produzir</h2>
            <div class="tabela-rolagem"><table class="tabela">
              <thead><tr><th>Item</th><th>Detalhes</th><th class="texto-direita">Quantidade</th><th class="texto-direita">Pedidos</th></tr></thead>
              <tbody>${r.itens.map((i) => html`<tr><td><strong>${i.nome}</strong></td><td><small class="texto-suave">${opcoesTexto(i.opcoes) || "—"}</small></td>
                <td class="texto-direita"><strong class="prod__qtd">${i.qtd}</strong></td><td class="texto-direita">${i.pedidos}</td></tr>`)}</tbody></table></div>
          </section>
          <section class="cartao cartao--sem-margem">
            <h2 class="cartao__titulo">Roteiro por horário</h2>
            <ol class="prod__roteiro">${r.pedidos.map((p) => html`<li>
              <span class="prod__hora">${p.hora}</span>
              <div class="prod__corpo">
                <div class="prod__linha"><strong>${p.cliente}</strong><span class="badge badge--neutro">${p.tipo === "entrega" ? "Entrega" : "Retirada"}</span>
                  <span class="badge ${p.status === "novo" ? "badge--aviso" : "badge--info"}">${p.status_texto}</span><small class="texto-suave">#${p.codigo} · ${p.telefone}</small></div>
                <ul>${(p.itens ?? []).map((i) => html`<li>${i.qtd}× ${i.nome}${opcoesTexto(i.opcoes) && html` <small class="texto-suave">(${opcoesTexto(i.opcoes)})</small>`}${i.obs && html` <em class="prod__obs">“${i.obs}”</em>`}</li>`)}</ul>
                ${p.observacoes && html`<p class="prod__nota">${icone("mensagem", { tamanho: 14 })} ${p.observacoes}</p>`}
              </div></li>`)}</ol>
          </section>`
          : vazio("bolo", "Nada para produzir nesta data", "Quando houver pedidos agendados para este dia, eles aparecem aqui já somados.")}
      </div>`);
  }

  async function ir(nova) {
    data = nova;
    history.replaceState(null, "", `#/producao/${data}`);
    if (await carregar()) desenhar();
  }

  delegar(ctx.raiz, {
    anterior: () => ir(somarDias(data, -1)),
    seguinte: () => ir(somarDias(data, 1)),
    imprimir: () => {
      document.body.classList.add("imprimindo-pagina");
      window.addEventListener("afterprint", () => document.body.classList.remove("imprimindo-pagina"), { once: true });
      window.print();
    },
  });
  ctx.raiz.addEventListener("change", (ev) => {
    const alvo = ev.target.dataset?.acaoMudar;
    if (alvo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(ev.target.value)) ir(ev.target.value);
    if (alvo === "entregues") { incluirEntregues = ev.target.checked; carregar().then((ok) => ok && desenhar()); }
  });

  if (await carregar()) desenhar();
}
