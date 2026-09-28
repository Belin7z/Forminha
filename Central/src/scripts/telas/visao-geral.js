/* ==========================================================
   TELA — Visão geral: os números do negócio (faturamento só para
   quem vê dinheiro), as vendas do mês dia a dia (ou 12 meses), o
   que precisa de atenção, as últimas clientes e a atividade (dono).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { api, aviso, pode, quandoCurto, reais } from "../nucleo.js";
import { graficoDeVendas } from "../grafico.js";
import { periodo } from "../periodo.js";
import { abrirFicha, novaCliente, situacaoDe } from "./clientes.js";


function variacao(atual, anterior) {
  if (!anterior) return atual ? "primeiro mês com vendas" : "sem vendas ainda";
  const p = Math.round(((atual - anterior) / anterior) * 100);
  return `${p >= 0 ? "+" : ""}${p}% vs. mês passado`;
}

const numero = ({ rotulo, valor, nota, ic }) => html`
  <div class="numero">
    <p class="numero__rotulo">${icone(ic, { tamanho: 16 })} ${rotulo}</p>
    <p class="numero__valor">${valor}</p>
    ${nota && html`<p class="numero__nota">${nota}</p>`}
  </div>`;

export async function telaVisaoGeral(conteiner, eu) {
  document.title = "Visão geral — Forminha";
  const primeiro = String(eu.quem.nome || "").split(" ")[0];
  let visao = "mes"; // gráfico: este mês (por dia) ou 12 meses
  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>${primeiro ? `Olá, ${primeiro}!` : "Visão geral"}</h1></div>
      ${pode(eu, "clientes.cadastrar") && eu.recursos?.clientes && html`<button type="button" class="btn btn--primario" data-acao="nova-cliente">${icone("mais", { tamanho: 17 })} Nova cliente</button>`}
    </div>
    <div data-painel><div class="carregando-pagina"><div class="spinner"></div></div></div>`);

  const painel = conteiner.querySelector("[data-painel]");

  async function desenharVendas() {
    const alvo = conteiner.querySelector("[data-grafico-vendas]");
    if (!alvo) return;
    const p = periodo(visao);
    try {
      const v = await api("GET", `vendas?de=${p.de}&ate=${p.ate}&agrupar=${p.agrupar}`);
      montar(alvo, html`<p class="cartao__total"><strong>${reais(v.resumo.total)}</strong> <span class="texto-suave">· ${v.resumo.vendas} ${v.resumo.vendas === 1 ? "venda" : "vendas"}</span></p>
        ${graficoDeVendas({ serie: v.serie, agrupamento: v.agrupamento })}`);
    } catch (erro) { montar(alvo, aviso("aviso", erro.message)); }
  }

  async function carregar() {
    let r;
    try { r = await api("GET", "resumo"); }
    catch (erro) { montar(painel, aviso("aviso", erro.message)); return; }
    const n = r.numeros, f = r.financeiro;
    const ultimas = html`
        <section class="cartao">
          <div class="cartao__cab"><h2>Últimas clientes</h2>${pode(eu, "clientes.ver") && html`<a class="link" href="#/clientes">Ver todas</a>`}</div>
          ${r.recentes.length ? html`<ul class="lista-simples">${r.recentes.map((c) => { const [t, tom] = situacaoDe(c); return html`
            <li><button type="button" class="lista-simples__item" data-cliente="${c.id}">
              <span><strong>${c.nome_loja}</strong><small>${c.nome}</small></span>
              <span class="ponto ponto--${tom}">${t}</span></button></li>`; })}</ul>`
          : html`<p class="texto-suave">Nenhuma cliente ainda.</p>`}
        </section>`;
    montar(painel, html`
      <section class="numeros">
        ${f && numero({ rotulo: "Faturamento do mês", valor: reais(f.mes), nota: variacao(f.mes, f.mes_anterior), ic: "dinheiro" })}
        ${numero({ rotulo: "Clientes", valor: n.clientes, nota: `+${n.novas_no_mes} neste mês`, ic: "usuarios" })}
        ${numero({ rotulo: "Lojas no ar", valor: n.lojas_prontas, nota: n.criando ? `${n.criando} sendo ${n.criando === 1 ? "criada" : "criadas"}` : "", ic: "home" })}
        ${numero({ rotulo: "Aguardando pagamento", valor: n.aguardando, nota: f?.pendente ? reais(f.pendente) : "", ic: "relogio" })}
      </section>

      <div class="painel-grade">
        <div class="painel-coluna">
        ${f && html`
          <section class="cartao cartao--vendas">
            <div class="cartao__cab">
              <h2>Vendas</h2>
              <div class="segmentos segmentos--pequeno" role="group" aria-label="Período do gráfico">
                <button type="button" class="segmento ${visao === "mes" && "segmento--ativo"}" data-visao="mes" aria-pressed="${String(visao === "mes")}">Este mês</button>
                <button type="button" class="segmento ${visao === "12m" && "segmento--ativo"}" data-visao="12m" aria-pressed="${String(visao === "12m")}">12 meses</button>
              </div>
            </div>
            <div data-grafico-vendas><div class="carregando-pagina carregando-pagina--baixo"><div class="spinner"></div></div></div>
            ${pode(eu, "financeiro.ver") && html`<a class="link cartao__rodape-link" href="#/vendas">Relatório completo ${icone("direita", { tamanho: 15 })}</a>`}
          </section>`}
        ${ultimas}
        </div>
        <div class="painel-coluna">
        <section class="cartao">
          <div class="cartao__cab"><h2>Precisa de atenção</h2></div>
          ${r.atencao.length ? html`<ul class="lista-simples">${r.atencao.map((a) => html`
            <li><button type="button" class="lista-simples__item" data-cliente="${a.cliente_id}">
              <span class="ponto ponto--${a.tipo === "parada" ? "perigo" : "aviso"}"></span>
              <span><strong>${a.nome_loja}</strong><small>${a.texto}${a.valor_centavos ? ` · ${reais(a.valor_centavos)}` : ""}</small></span>
              ${icone("direita", { tamanho: 16 })}</button></li>`)}</ul>`
          : html`<p class="tudo-certo">${icone("checkCirculo", { tamanho: 18 })} Tudo em dia.</p>`}
        </section>

        ${r.atividades && html`
          <section class="cartao">
            <div class="cartao__cab"><h2>Atividade</h2><a class="link" href="#/atividade">Ver tudo</a></div>
            ${r.atividades.length ? html`<ul class="lista-simples lista-simples--atividade">${r.atividades.map((a) => html`
              <li><span class="tabela__mono">${a.usuario}</span><span>${a.acao}${a.alvo && html` · <span class="texto-suave">${a.alvo}</span>`}</span><time>${quandoCurto(a.em)}</time></li>`)}</ul>`
            : html`<p class="texto-suave">Nada por aqui ainda.</p>`}
          </section>`}
        </div>
      </div>`);
    if (f) desenharVendas();
  }

  conteiner.addEventListener("click", (ev) => {
    const botaoVisao = ev.target.closest("[data-visao]");
    if (botaoVisao) {
      visao = botaoVisao.dataset.visao;
      conteiner.querySelectorAll("[data-visao]").forEach((b) => { const ativo = b === botaoVisao; b.classList.toggle("segmento--ativo", ativo); b.setAttribute("aria-pressed", String(ativo)); });
      return desenharVendas();
    }
    const cliente = ev.target.closest("[data-cliente]");
    if (cliente) return abrirFicha(cliente.dataset.cliente, carregar, eu);
    if (ev.target.closest('[data-acao="nova-cliente"]')) novaCliente(carregar, eu);
  });
  await carregar();
}
