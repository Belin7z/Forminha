/* ==========================================================
   ESTOQUE — aba Previsão e compras: compara os pedidos agendados
   com o que existe em estoque, avisa o que vai faltar e monta a
   lista de compras (pronta para copiar ou imprimir).
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { copiar, toast } from "/src/scripts/base/ui.js";
import { brl, dataBR, dataCurta, plural } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { SITUACAO_PREVISAO, embalagemTexto, numero, paraCampo, qtdTexto } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, indicador, vazio } from "./pagina.js";
import { abrirLancamento } from "./estoque-lancamento.js";

const PERIODOS = [1, 3, 7, 14, 30, 60];
const rotuloPeriodo = (d) => (d === 1 ? "Hoje e amanhã" : `Até ${d} dias à frente`);

/** "23/09: 1,2 kg · 25/09: 500 g" — quando cada parte vai ser usada. */
const quando = (i) => {
  const l = i.dias.slice(0, 3).map((d) => `${dataCurta(d.data)}: ${qtdTexto(d.qtd, i.unidade)}`).join(" · ");
  return l + (i.dias.length > 3 ? ` · +${i.dias.length - 3}` : "");
};

export async function previsaoEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let dias = Number(ctx.consulta?.dias) || null; // vazio = período padrão da configuração
  let r;

  async function carregar() {
    try { r = await api.get(`/estoque/previsao${dias ? `?dias=${dias}` : ""}`); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    dias = r.dias;
    return ctx.ativo();
  }

  const compras = () => r.itens.filter((i) => i.comprar_embalagens > 0);

  function textoLista() {
    const l = compras();
    return [`Lista de compras — até ${dataBR(r.ate)}`, "",
      ...l.map((i) => `• ${i.nome}: ${numero(i.comprar_embalagens)}× ${embalagemTexto(i)} (${qtdTexto(i.comprar_qtd, i.unidade)})${i.comprar_valor > 0 ? ` — cerca de ${brl(i.comprar_valor)}` : ""}`),
      "", `Total estimado: ${brl(r.resumo.valor_compras)}`].join("\n");
  }

  function desenhar() {
    const usados = r.itens.filter((i) => i.necessario > 0);
    const ok = r.itens.filter((i) => i.situacao === "ok" && !(i.comprar_embalagens > 0)).length;
    const lista = compras();
    const periodos = [...new Set([...PERIODOS, r.dias])].sort((a, b) => a - b);

    montar(ctx.raiz, html`
      <div class="prod__controles cartao cartao--sem-margem est__sem-impressao">
        <label class="est-periodo"><span>Olhar os pedidos</span>
          <select class="entrada entrada--auto" data-acao-mudar="dias" aria-label="Período da previsão">${periodos.map((d) => html`<option value="${d}" ${d === r.dias && "selected"}>${rotuloPeriodo(d)}</option>`)}</select></label>
        <span class="texto-suave est-periodo__nota" title="Só entram pedidos que ainda não saíram do estoque">${plural(r.pedidos, "pedido")} até ${dataCurta(r.ate)}</span>
        <span class="espaco"></span>
        <button type="button" class="btn btn--suave" data-acao="atualizar">${icone("atualizar", { tamanho: 16 })} Atualizar</button>
        ${lista.length > 0 && html`<button type="button" class="btn btn--suave" data-acao="copiar-lista">${icone("copiar", { tamanho: 16 })} Copiar lista</button>
          <button type="button" class="btn btn--primario" data-acao="imprimir">${icone("impressora", { tamanho: 16 })} Imprimir</button>`}
      </div>

      <div class="prod__folha">
        <header class="prod__cab-impressao"><h2>Lista de compras — até ${dataBR(r.ate)}</h2></header>
        ${r.itens.length === 0 ? vazio("estoque", "Nada cadastrado ainda", "Cadastre seus ingredientes e as receitas dos produtos: o sistema passa a avisar o que vai faltar e o que comprar.",
          html`<a href="#/estoque/ingredientes" class="btn btn--primario">Cadastrar ingredientes</a>`) : html`
        <section class="kpis est__sem-impressao" aria-label="Resumo">
          ${indicador({ rotulo: "Vão faltar", valor: r.resumo.faltando, nota: r.resumo.faltando ? "antes do fim do período" : "nada em risco", destaque: r.resumo.faltando > 0, icone: icone("alerta", { tamanho: 16 }) })}
          ${indicador({ rotulo: "Abaixo do mínimo", valor: r.resumo.baixo, nota: "depois de usar nos pedidos", icone: icone("estoque", { tamanho: 16 }) })}
          ${indicador({ rotulo: "A comprar", valor: r.resumo.a_comprar, nota: r.resumo.a_comprar ? `cerca de ${brl(r.resumo.valor_compras)}` : "estoque suficiente", icone: icone("carrinho", { tamanho: 16 }) })}
          ${indicador({ rotulo: "Pedidos na conta", valor: r.pedidos, nota: `até ${dataCurta(r.ate)}`, icone: icone("pacote", { tamanho: 16 }) })}
        </section>

        ${r.sem_receita.length > 0 && html`<div class="aviso aviso--info est__sem-impressao">${icone("info", { tamanho: 18 })}
          <span><strong>${plural(r.sem_receita.length, "produto vendido não tem", "produtos vendidos não têm")} receita</strong> e ficou de fora da conta:
            ${r.sem_receita.slice(0, 4).map((s) => `${s.nome} (${s.qtd}×)`).join(", ")}${r.sem_receita.length > 4 ? "…" : ""}.
            <a href="#/estoque/receitas">Cadastrar receitas</a></span></div>`}

        <section class="cartao cartao--sem-margem est-secao">
          <h2 class="cartao__titulo">O que comprar</h2>
          ${lista.length ? html`<div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Ingrediente</th><th class="texto-direita">Em estoque</th><th class="texto-direita">Vai gastar</th><th>Situação</th><th>Comprar</th><th class="texto-direita">Custo</th><th class="est__sem-impressao"></th></tr></thead>
            <tbody>${lista.map((i) => { const [classe, texto] = SITUACAO_PREVISAO[i.situacao]; return html`<tr>
              <td><strong>${i.nome}</strong></td>
              <td class="texto-direita">${qtdTexto(i.estoque, i.unidade)}</td>
              <td class="texto-direita">${i.necessario > 0 ? qtdTexto(i.necessario, i.unidade) : "—"}</td>
              <td><span class="badge ${classe}">${texto}</span>${i.falta_em && html`<br><small class="texto-suave">a partir de ${dataBR(i.falta_em)}</small>`}</td>
              <td><strong>${numero(i.comprar_embalagens)}× ${i.embalagem_nome}</strong><br><small class="texto-suave">${qtdTexto(i.comprar_qtd, i.unidade)}</small></td>
              <td class="texto-direita">${i.comprar_valor > 0 ? brl(i.comprar_valor) : "—"}</td>
              <td class="texto-direita est__sem-impressao"><button type="button" class="btn btn--suave btn--pequeno" data-acao="comprei" data-id="${i.id}">Já comprei</button></td>
            </tr>`; })}</tbody>
            <tfoot><tr><td colspan="5" class="texto-direita"><strong>Total estimado</strong></td><td class="texto-direita"><strong>${brl(r.resumo.valor_compras)}</strong></td><td class="est__sem-impressao"></td></tr></tfoot>
          </table></div>`
          : html`<p class="est-ok">${icone("checkCirculo", { tamanho: 20 })} <span>Nada para comprar: o estoque cobre os pedidos${r.dias === 1 ? "" : " do período"} e fica acima do mínimo.</span></p>`}
        </section>

        <section class="cartao cartao--sem-margem est-secao">
          <h2 class="cartao__titulo">Uso previsto nos pedidos</h2>
          ${usados.length ? html`<div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Ingrediente</th><th class="texto-direita">Em estoque</th><th class="texto-direita">Vai gastar</th><th class="texto-direita">Sobra</th><th>Onde entra</th><th>Quando</th></tr></thead>
            <tbody>${usados.map((i) => html`<tr>
              <td><strong>${i.nome}</strong></td>
              <td class="texto-direita">${qtdTexto(i.estoque, i.unidade)}</td>
              <td class="texto-direita">${qtdTexto(i.necessario, i.unidade)}</td>
              <td class="texto-direita ${i.saldo < 0 && "est__qtd--zero"}"><strong>${i.saldo < 0 ? `faltam ${qtdTexto(-i.saldo, i.unidade)}` : qtdTexto(i.saldo, i.unidade)}</strong></td>
              <td><small>${i.usado_em.slice(0, 3).map((u) => `${u.nome} (${qtdTexto(u.qtd, i.unidade)})`).join(" · ")}${i.usado_em.length > 3 ? ` · +${i.usado_em.length - 3}` : ""}</small></td>
              <td><small>${quando(i)}</small></td></tr>`)}</tbody></table></div>`
          : html`<p class="texto-suave">Nenhum pedido no período usa ingredientes com receita cadastrada.</p>`}
          ${ok > 0 && html`<p class="texto-suave est-total">${plural(ok, "ingrediente está", "ingredientes estão")} em dia, sem necessidade de compra.</p>`}
        </section>`}
      </div>`);
  }

  const achar = (el) => r.itens.find((i) => i.id === Number(el.dataset.id));
  delegar(ctx.raiz, {
    atualizar: async () => { if (await carregar()) desenhar(); },
    "copiar-lista": async () => { await copiar(textoLista()); toast("Lista copiada! Cole no WhatsApp ou no bloco de notas."); },
    imprimir: () => {
      document.body.classList.add("imprimindo-pagina");
      window.addEventListener("afterprint", () => document.body.classList.remove("imprimindo-pagina"), { once: true });
      window.print();
    },
    comprei: (el) => {
      const i = achar(el);
      abrirLancamento(i, {
        padrao: { tipo: "compra", embalagens: paraCampo(i.comprar_embalagens), valor: i.comprar_valor > 0 ? i.comprar_valor : null },
        aoSalvar: async () => { if (await carregar()) desenhar(); },
      });
    },
  });
  ctx.raiz.addEventListener("change", async (ev) => {
    if (ev.target.dataset?.acaoMudar !== "dias") return;
    dias = Number(ev.target.value);
    if (await carregar()) desenhar();
  });

  if (await carregar()) desenhar();
}
