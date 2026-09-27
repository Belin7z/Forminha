/* ==========================================================
   ESTOQUE — Simulador: "quanto preciso para fazer isto?"
   Monta uma lista de produtos (ex.: uma encomenda grande) e o
   sistema mostra o que falta e quanto comprar, considerando o
   que já está comprometido com os pedidos agendados.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { embalagemTexto, numero, paraEnvio, qtdTexto } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, indicador, vazio } from "./pagina.js";
import { abrirLancamento } from "./estoque-lancamento.js";

export async function simuladorEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let produtos, ingredientesPorId, itens = [{ produto: "", qtd: "" }], resultado = null;

  async function carregar() {
    try {
      const [c, ings] = await Promise.all([api.get("/produtos"), api.get("/ingredientes")]);
      produtos = c.produtos.filter((p) => p.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      ingredientesPorId = new Map(ings.ingredientes.map((i) => [i.id, i]));
    } catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  function desenharLinhas() {
    const alvo = ctx.raiz.querySelector("#sim-linhas");
    if (!alvo) return;
    montar(alvo, html`${itens.map((l, i) => html`<div class="est-compra-linha est-compra-linha--sim" data-linha>
      <select class="entrada" data-campo="produto" aria-label="Produto"><option value="">Escolha o produto…</option>${produtos.map((p) => html`<option value="${p.id}" ${String(p.id) === l.produto && "selected"}>${p.nome}</option>`)}</select>
      <span class="est-linha__qtd"><input class="entrada" data-campo="qtd" inputmode="decimal" placeholder="Quantidade" value="${l.qtd}" aria-label="Quantidade"></span>
      <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="tirar" data-i="${i}" aria-label="Tirar item">${icone("lixeira", { tamanho: 17 })}</button>
    </div>`)}`);
  }

  function desenhar() {
    montar(ctx.raiz, html`
      <p class="texto-suave est-intro">Monte a lista do que pretende fazer (uma encomenda grande, uma festa) e veja o que falta comprar — já contando com o que os pedidos agendados vão gastar.</p>
      <div class="cartao">
        <div id="sim-linhas"></div>
        <div class="est-conta-acoes est-conta-acoes--inicio">
          <button type="button" class="btn btn--suave btn--pequeno" data-acao="mais">${icone("mais", { tamanho: 15 })} Adicionar produto</button>
          <button type="button" class="btn btn--primario" data-acao="calcular">${icone("calculadora", { tamanho: 16 })} Calcular</button>
        </div>
      </div>
      <div id="sim-resultado">${resultado ? resultadoHtml() : ""}</div>`);
    desenharLinhas();
  }

  function resultadoHtml() {
    const r = resultado;
    return html`
      ${r.sem_receita.length > 0 && html`<div class="aviso aviso--info">${icone("info", { tamanho: 18 })}
        <span>Sem receita cadastrada (não entram na conta de ingredientes): ${r.sem_receita.join(", ")}.</span></div>`}
      <section class="kpis" aria-label="Resumo">
        ${indicador({ rotulo: "Custo dos ingredientes", valor: brl(r.custo_total), icone: icone("dinheiro", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Faltam", valor: r.faltam, nota: r.faltam > 0 ? "ingredientes" : "nada em falta", destaque: r.faltam > 0, icone: icone("alerta", { tamanho: 16 }) })}
        ${indicador({ rotulo: "A comprar", valor: brl(r.comprar_valor), nota: "estimado", icone: icone("carrinho", { tamanho: 16 }) })}
      </section>
      <section class="cartao cartao--sem-margem est-secao">
        <h2 class="cartao__titulo">Ingredientes necessários</h2>
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Ingrediente</th><th class="texto-direita">Precisa</th><th class="texto-direita">Livre agora</th><th class="texto-direita">Falta</th><th>Comprar</th><th class="texto-direita"></th></tr></thead>
          <tbody>${r.itens.map((i) => html`<tr>
            <td><strong>${i.nome}</strong>${i.comprometido > 0 && html`<br><small class="texto-suave">${qtdTexto(i.comprometido, i.unidade)} já reservado para pedidos</small>`}</td>
            <td class="texto-direita">${qtdTexto(i.necessario, i.unidade)}</td>
            <td class="texto-direita">${qtdTexto(i.livre, i.unidade)}</td>
            <td class="texto-direita">${i.falta > 0 ? html`<strong class="est__qtd--zero">${qtdTexto(i.falta, i.unidade)}</strong>` : html`<span class="badge badge--sucesso">Tem</span>`}</td>
            <td>${i.falta > 0 ? html`${numero(i.comprar_embalagens)}× ${i.embalagem_nome}<br><small class="texto-suave">${brl(i.comprar_valor)}</small>` : "—"}</td>
            <td class="texto-direita">${i.falta > 0 && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="lancar" data-id="${i.id}">Lançar compra</button>`}</td>
          </tr>`)}</tbody></table></div>
      </section>`;
  }

  const ler = () => [...ctx.raiz.querySelectorAll("#sim-linhas [data-linha]")].map((r) => ({ produto: r.querySelector('[data-campo="produto"]').value, qtd: r.querySelector('[data-campo="qtd"]').value }));

  delegar(ctx.raiz, {
    mais: () => { itens = ler(); itens.push({ produto: "", qtd: "" }); resultado = null; desenhar(); },
    tirar: (el) => { itens = ler(); itens.splice(Number(el.dataset.i), 1); if (!itens.length) itens.push({ produto: "", qtd: "" }); resultado = null; desenhar(); },
    calcular: async (botao) => {
      const linhas = ler().filter((l) => l.produto);
      if (!linhas.length) { toast("Escolha pelo menos um produto.", "erro"); return; }
      for (const l of linhas) if (!(Number(String(l.qtd).replace(",", ".")) > 0)) { toast("Informe a quantidade de cada produto.", "erro"); return; }
      await ocupado(botao, async () => {
        try {
          resultado = await api.post("/estoque/simular", { itens: linhas.map((l) => ({ produto_id: Number(l.produto), qtd: paraEnvio(l.qtd) })) });
          montar(ctx.raiz.querySelector("#sim-resultado"), resultadoHtml());
        } catch (erro) { toast(erro.message, "erro"); }
      });
    },
    lancar: (el) => {
      const i = resultado.itens.find((x) => x.id === Number(el.dataset.id));
      const ing = ingredientesPorId.get(i.id);
      abrirLancamento(ing, {
        padrao: { tipo: "compra", embalagens: numero(i.comprar_embalagens), valor: i.comprar_valor > 0 ? i.comprar_valor : null },
        aoSalvar: () => toast(`Compra lançada. ${embalagemTexto(ing)}.`),
      });
    },
  });

  if (await carregar()) {
    if (!produtos.length) montar(ctx.raiz, vazio("bolo", "Nenhum produto no cardápio", "Cadastre produtos antes de simular."));
    else desenhar();
  }
}
