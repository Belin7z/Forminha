/* PÁGINA — visão geral: indicadores do dia, vendas por período, produtos e formas de pagamento */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, brlInteiro, dataBR, dataCurta, plural, tempoRelativo } from "/src/scripts/base/formatacao.js";
import { FORMAS_PAGAMENTO, STATUS_TEXTO } from "/src/scripts/base/dominio.js";
import { api } from "../nucleo/api.js";
import { estado, ouvir } from "../nucleo/estado.js";
import { carregandoPagina, cabecalhoPagina, erroPagina, indicador } from "../componentes/pagina.js";
import { ativarGraficos, graficoBarras, ranking } from "../componentes/grafico.js";
import { abrirPedido } from "../componentes/detalhe-pedido.js";
import { armazenamento } from "/src/scripts/base/armazenamento.js";

const PERIODOS = [7, 14, 30, 90];

export async function visaoGeral(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let dias = 14;

  async function carregar() {
    let r;
    try { r = await api.get(`/resumo?dias=${dias}`); }
    catch (erro) { if (ctx.ativo()) montar(ctx.raiz, erroPagina(erro.message)); return; }
    if (!ctx.ativo()) return;
    const passos = (await api.get("/checklist").catch(() => null))?.itens ?? [];
    const previsao = await api.get("/estoque/previsao").catch(() => null); // aviso de estoque: se falhar, a página segue sem ele
    if (!ctx.ativo()) return;
    const estoqueRisco = previsao?.resumo ?? { faltando: 0, baixo: 0 };
    const feitos = passos.filter((i) => i.feito).length;
    const mostrarPassos = passos.length > 0 && feitos < passos.length && !armazenamento.ler("zqp.passos-ocultos", false);
    const k = r.kpis;
    const totalPeriodo = r.serie.reduce((s, d) => s + d.total, 0);
    const pedidosPeriodo = r.serie.reduce((s, d) => s + d.pedidos, 0);

    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: `Olá, ${estado.usuario.nome.split(" ")[0]}!`,
        descricao: "Resumo do que está acontecendo na sua loja.",
        acoes: html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="atualizar">${icone("atualizar", { tamanho: 15 })} Atualizar</button>`,
      })}

      ${k.novos_pedidos > 0 && html`<a href="#/pedidos" class="aviso aviso--marca aviso--link">${icone("sino", { tamanho: 18 })}
        <span><strong>${plural(k.novos_pedidos, "pedido novo", "pedidos novos")}</strong> esperando confirmação.</span><span class="espaco"></span>Ver pedidos ${icone("direita", { tamanho: 16 })}</a>`}

      ${estoqueRisco.faltando > 0 && html`<a href="#/estoque" class="aviso aviso--perigo aviso--link">${icone("alerta", { tamanho: 18 })}
        <span><strong>${plural(estoqueRisco.faltando, "ingrediente vai", "ingredientes vão")} faltar</strong> para os pedidos dos próximos ${previsao.dias === 1 ? "dias" : `${previsao.dias} dias`}.</span><span class="espaco"></span>Ver lista de compras ${icone("direita", { tamanho: 16 })}</a>`}
      ${estoqueRisco.faltando === 0 && estoqueRisco.baixo > 0 && html`<a href="#/estoque" class="aviso aviso--info aviso--link">${icone("estoque", { tamanho: 18 })}
        <span><strong>${plural(estoqueRisco.baixo, "ingrediente", "ingredientes")}</strong> abaixo do estoque mínimo.</span><span class="espaco"></span>Ver estoque ${icone("direita", { tamanho: 16 })}</a>`}

      ${mostrarPassos && html`<section class="cartao primeiros-passos" aria-label="Primeiros passos">
        <div class="cartao__cab"><div><h2>Primeiros passos</h2><small class="texto-suave">${feitos} de ${passos.length} concluídos — deixe a loja pronta para vender</small></div>
          <div class="linha-flex"><a href="#/primeiros-passos" class="btn btn--primario btn--pequeno">${feitos ? "Continuar" : "Começar"} com o assistente</a>
          <button type="button" class="link" data-acao="ocultar-passos">Ocultar</button></div></div>
        <div class="progresso" role="progressbar" aria-valuemin="0" aria-valuemax="${passos.length}" aria-valuenow="${feitos}"><span style="width:${Math.round((feitos / passos.length) * 100)}%"></span></div>
        <ul class="passos">${passos.map((i) => html`<li class="${i.feito && "passo--feito"}">
          <span class="passo__marca">${icone(i.feito ? "check" : "mais", { tamanho: 15 })}</span>
          <div><strong>${i.titulo}</strong><small class="texto-suave">${i.dica}</small></div>
          ${!i.feito && html`<a href="#${i.link}" class="btn btn--suave btn--pequeno">Fazer agora</a>`}</li>`)}</ul>
      </section>`}

      <section class="kpis" aria-label="Indicadores">
        ${indicador({ rotulo: "Pedidos hoje", valor: k.pedidos_hoje, nota: `${brl(k.faturamento_hoje)} em vendas`, icone: icone("pacote", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Entregas de hoje", valor: k.entregas_hoje, nota: "agendadas e em aberto", icone: icone("caminhao", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Vendas no mês", valor: brl(k.faturamento_mes), nota: plural(k.pedidos_mes, "pedido"), icone: icone("dinheiro", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Ticket médio", valor: brl(k.ticket_medio_mes), nota: "neste mês", icone: icone("etiqueta", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Em andamento", valor: k.em_andamento, nota: `${k.novos_pedidos} novo(s)`, destaque: k.novos_pedidos > 0, icone: icone("relogio", { tamanho: 16 }) })}
        ${indicador({ rotulo: "Clientes", valor: k.clientes, nota: `+${k.clientes_novos_mes} neste mês`, icone: icone("usuarios", { tamanho: 16 }) })}
      </section>

      <div class="painel-grade painel-grade--2-1">
        <section class="cartao">
          <div class="cartao__cab">
            <div><h2>Vendas por dia</h2><small class="texto-suave">${brl(totalPeriodo)} · ${plural(pedidosPeriodo, "pedido")} nos últimos ${dias} dias (sem cancelados)</small></div>
            <div class="segmentos" role="group" aria-label="Período">
              ${PERIODOS.map((d) => html`<button type="button" class="segmento ${d === dias && "segmento--ativo"}" data-acao="periodo" data-dias="${d}" aria-pressed="${String(d === dias)}">${d} dias</button>`)}
            </div>
          </div>
          ${graficoBarras({
            titulo: "Faturamento diário",
            dados: r.serie.map((d) => ({
              rotulo: dataCurta(d.dia), valor: d.total,
              dica: `${dataBR(d.dia)} · ${brl(d.total)} · ${plural(d.pedidos, "pedido")}`,
            })),
            formato: brl, formatoEixo: brlInteiro, colunaValor: "Vendas",
          })}
        </section>

        <section class="cartao">
          <div class="cartao__cab"><h2>Pedidos por situação</h2><small class="texto-suave">últimos ${dias} dias</small></div>
          ${ranking({
            dados: r.status.map((s) => ({ rotulo: STATUS_TEXTO[s.status] ?? s.status, valor: s.n })).sort((a, b) => b.valor - a.valor),
            formato: (n) => n, vazio: "Nenhum pedido no período.",
          })}
        </section>
      </div>

      <div class="painel-grade painel-grade--3">
        <section class="cartao">
          <div class="cartao__cab"><h2>Mais vendidos</h2><small class="texto-suave">unidades</small></div>
          ${ranking({ dados: r.top_produtos.map((p) => ({ rotulo: p.nome, valor: p.qtd })), formato: (n) => n, vazio: "Sem vendas no período." })}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><h2>Formas de pagamento</h2><small class="texto-suave">pedidos</small></div>
          ${ranking({ dados: r.pagamentos.map((p) => ({ rotulo: FORMAS_PAGAMENTO[p.pagamento] ?? p.pagamento, valor: p.n })), formato: (n) => n, vazio: "Sem vendas no período." })}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><h2>Mais favoritados</h2><a href="#/favoritos" class="link">ver todos</a></div>
          ${ranking({ dados: r.favoritos_top.map((p) => ({ rotulo: p.nome, valor: p.n })), formato: (n) => `${n} ${n === 1 ? "favorito" : "favoritos"}`, vazio: "Ninguém favoritou ainda." })}
        </section>
      </div>

      <section class="cartao">
        <div class="cartao__cab"><h2>Últimos pedidos</h2><a href="#/pedidos" class="link">ver todos</a></div>
        ${r.ultimos.length ? html`<div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Agendado</th><th>Situação</th><th class="texto-direita">Total</th><th></th></tr></thead>
          <tbody>${r.ultimos.map((p) => html`<tr>
            <td><strong>${p.codigo}</strong><br><small class="texto-suave">${tempoRelativo(p.criado_em)}</small></td>
            <td>${p.cliente.nome}</td>
            <td>${dataBR(p.data)} ${p.hora}<br><small class="texto-suave">${p.tipo === "entrega" ? "Entrega" : "Retirada"}</small></td>
            <td><span class="status status--${p.status}">${p.status_texto}</span></td>
            <td class="texto-direita"><strong>${brl(p.total)}</strong></td>
            <td class="texto-direita"><button type="button" class="btn btn--suave btn--pequeno" data-acao="abrir" data-id="${p.id}">Abrir</button></td>
          </tr>`)}</tbody></table></div>`
        : html`<p class="texto-suave">Os pedidos aparecem aqui assim que chegarem.</p>`}
      </section>
      ${k.avaliacoes_pendentes > 0 && html`<a href="#/avaliacoes" class="aviso aviso--info aviso--link">${icone("estrela", { tamanho: 18 })}
        <span>${plural(k.avaliacoes_pendentes, "avaliação", "avaliações")} aguardando aprovação.</span><span class="espaco"></span>Revisar ${icone("direita", { tamanho: 16 })}</a>`}
    `);

  }

  delegar(ctx.raiz, {
    periodo: (el) => { dias = Number(el.dataset.dias); carregar(); },
    atualizar: () => carregar(),
    "ocultar-passos": () => { armazenamento.gravar("zqp.passos-ocultos", true); carregar(); },
    abrir: (el) => abrirPedido(el.dataset.id, carregar),
  });

  ativarGraficos(ctx.raiz); // ouvintes por delegação: ligar uma vez basta, mesmo com a página redesenhada
  const desligar = ouvir("pedidos-novos", carregar);
  await carregar();
  return desligar;
}
