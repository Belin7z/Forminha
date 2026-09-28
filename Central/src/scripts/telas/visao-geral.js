/* ==========================================================
   TELA — Visão geral: os números do negócio (faturamento só para
   quem vê dinheiro), vendas dos 6 últimos meses, o que precisa de
   atenção, as últimas clientes e a atividade da equipe (dono).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { api, aviso, pode, quandoCurto, reais } from "../nucleo.js";
import { abrirFicha, novaCliente, situacaoDe } from "./clientes.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeDoMes = (chave) => MESES[Number(chave.split("-")[1]) - 1];

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

/** Barras dos 6 meses: uma cor só, rótulo só no mês atual, o resto aparece ao passar o mouse (ou tocar). */
function grafico(meses) {
  const maior = Math.max(...meses.map((m) => m.total), 1);
  return html`
    <div class="barras" role="list" aria-label="Vendas por mês">
      ${meses.map((m, i) => {
        const atual = i === meses.length - 1;
        const dica = `${nomeDoMes(m.mes)}: ${reais(m.total)} · ${m.vendas} ${m.vendas === 1 ? "venda" : "vendas"}`;
        return html`
          <div class="barras__item ${atual && "barras__item--atual"}" role="listitem" tabindex="0" aria-label="${dica}" data-dica="${dica}"
            style="--altura:${Math.max(m.total / maior, m.total ? 0.04 : 0) * 100}%">
            ${atual && html`<span class="barras__valor">${reais(m.total)}</span>`}
            <span class="barras__coluna"></span>
            <span class="barras__mes">${nomeDoMes(m.mes)}</span>
          </div>`;
      })}
    </div>`;
}

export async function telaVisaoGeral(conteiner, eu) {
  document.title = "Visão geral — Forminha";
  const primeiro = String(eu.quem.nome).split(" ")[0];
  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Olá, ${primeiro === "Dono" ? "bem-vindo" : primeiro}!</h1></div>
      ${pode(eu, "clientes.cadastrar") && eu.recursos?.clientes && html`<button type="button" class="btn btn--primario" data-acao="nova-cliente">${icone("mais", { tamanho: 17 })} Nova cliente</button>`}
    </div>
    <div data-painel><div class="carregando-pagina"><div class="spinner"></div></div></div>`);

  const painel = conteiner.querySelector("[data-painel]");

  async function carregar() {
    let r;
    try { r = await api("GET", "resumo"); }
    catch (erro) { montar(painel, aviso("aviso", erro.message)); return; }
    const n = r.numeros, f = r.financeiro;
    montar(painel, html`
      <section class="numeros">
        ${f && numero({ rotulo: "Faturamento do mês", valor: reais(f.mes), nota: variacao(f.mes, f.mes_anterior), ic: "dinheiro" })}
        ${numero({ rotulo: "Clientes", valor: n.clientes, nota: `+${n.novas_no_mes} neste mês`, ic: "usuarios" })}
        ${numero({ rotulo: "Lojas no ar", valor: n.lojas_prontas, nota: n.criando ? `${n.criando} sendo ${n.criando === 1 ? "criada" : "criadas"}` : "", ic: "home" })}
        ${numero({ rotulo: "Aguardando pagamento", valor: n.aguardando, nota: f?.pendente ? reais(f.pendente) : "", ic: "relogio" })}
      </section>

      <div class="painel-grade">
        ${f && html`
          <section class="cartao">
            <div class="cartao__cab"><h2>Vendas</h2><span class="texto-suave">6 meses · ${reais(f.total)} no total</span></div>
            ${grafico(f.meses)}
          </section>`}
        <section class="cartao">
          <div class="cartao__cab"><h2>Precisa de atenção</h2></div>
          ${r.atencao.length ? html`<ul class="lista-simples">${r.atencao.map((a) => html`
            <li><button type="button" class="lista-simples__item" data-cliente="${a.cliente_id}">
              <span class="ponto ponto--${a.tipo === "parada" ? "perigo" : "aviso"}"></span>
              <span><strong>${a.nome_loja}</strong><small>${a.texto}${a.valor_centavos ? ` · ${reais(a.valor_centavos)}` : ""}</small></span>
              ${icone("direita", { tamanho: 16 })}</button></li>`)}</ul>`
          : html`<p class="tudo-certo">${icone("checkCirculo", { tamanho: 18 })} Tudo em dia.</p>`}
        </section>
        <section class="cartao">
          <div class="cartao__cab"><h2>Últimas clientes</h2>${pode(eu, "clientes.ver") && html`<a class="link" href="#/clientes">Ver todas</a>`}</div>
          ${r.recentes.length ? html`<ul class="lista-simples">${r.recentes.map((c) => { const [t, tom] = situacaoDe(c); return html`
            <li><button type="button" class="lista-simples__item" data-cliente="${c.id}">
              <span><strong>${c.nome_loja}</strong><small>${c.nome}</small></span>
              <span class="ponto ponto--${tom}">${t}</span></button></li>`; })}</ul>`
          : html`<p class="texto-suave">Nenhuma cliente ainda.</p>`}
        </section>
        ${r.atividades && html`
          <section class="cartao">
            <div class="cartao__cab"><h2>Atividade</h2><a class="link" href="#/atividade">Ver tudo</a></div>
            ${r.atividades.length ? html`<ul class="lista-simples lista-simples--atividade">${r.atividades.map((a) => html`
              <li><span class="tabela__mono">${a.usuario}</span><span>${a.acao}${a.alvo && html` · <span class="texto-suave">${a.alvo}</span>`}</span><time>${quandoCurto(a.em)}</time></li>`)}</ul>`
            : html`<p class="texto-suave">Nada por aqui ainda.</p>`}
          </section>`}
      </div>`);
  }

  conteiner.addEventListener("click", (ev) => {
    const cliente = ev.target.closest("[data-cliente]");
    if (cliente) return abrirFicha(cliente.dataset.cliente, carregar, eu);
    if (ev.target.closest('[data-acao="nova-cliente"]')) novaCliente(carregar, eu);
  });
  await carregar();
}
