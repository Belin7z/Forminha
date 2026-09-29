/* TELA — Pagamentos: todas as cobranças, com o total recebido e o pendente (quem vê dinheiro) e a nota fiscal de cada uma */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, aviso, pode, quandoCurto, reais } from "../nucleo.js";
import { abrirFicha } from "./clientes.js";

const FILTROS = [["", "Todos"], ["pendente", "Pendentes"], ["aprovado", "Pagos"], ["sem_nota", "Sem nota fiscal"], ["cancelado", "Cancelados"]];

/** Registrar (ou corrigir) a nota fiscal de um pagamento recebido. */
function registrarNota(p, depois) {
  const modal = abrirModal({
    titulo: `Nota fiscal — ${p.nome_loja}`, largura: 460,
    corpo: html`
      <form id="form-nota" class="form-empilhado" novalidate>
        <p class="texto-suave">${reais(p.valor_centavos)} · recebido em ${quandoCurto(p.confirmado_em)}. Emita a nota no sistema da prefeitura (ou do seu contador) e registre aqui.</p>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "numero", rotulo: "Número da nota", valor: p.nota_fiscal?.numero ?? "", obrigatorio: true, atributos: 'maxlength="40" autofocus' })}
        ${campo({ nome: "link", rotulo: "Link da nota (opcional)", tipo: "url", valor: p.nota_fiscal?.link ?? "", placeholder: "https://…" })}
      </form>`,
    rodape: html`${p.nota_fiscal && html`<button type="button" class="btn btn--perigo-suave" data-apagar>Apagar</button>`}
      <button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-nota" class="btn btn--primario">Salvar</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  const salvar = (corpo, botao) => ocupado(botao, async () => {
    try { await api("PUT", `pagamentos/${p.id}/nota`, corpo); modal.fechar(); toast(corpo.numero ? "Nota registrada." : "Nota apagada."); depois(); }
    catch (erro) { mostrarErros(form, erro); }
  });
  form.addEventListener("submit", (ev) => { ev.preventDefault(); salvar(dadosDe(form), modal.el.querySelector('[form="form-nota"]')); });
  modal.el.querySelector("[data-apagar]")?.addEventListener("click", (ev) => salvar({ numero: "" }, ev.currentTarget));
}
const SITUACAO = { pendente: ["Pendente", "aviso"], aprovado: ["Pago", "sucesso"], cancelado: ["Cancelado", "neutro"] };

export async function telaPagamentos(conteiner, eu) {
  document.title = "Pagamentos — Forminha";
  let filtro = "";
  montar(conteiner, html`
    <div class="central__titulo"><div><h1>Pagamentos</h1></div></div>
    <section class="numeros" data-totais></section>
    <div class="segmentos" role="group" aria-label="Filtrar">${FILTROS.map(([id, texto]) => html`
      <button type="button" class="segmento ${!id && "segmento--ativo"}" data-filtro="${id}" aria-pressed="${String(!id)}">${texto}</button>`)}</div>
    <section data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>`);

  const $ = (s) => conteiner.querySelector(s);

  const notas = pode(eu, "pagamentos.confirmar");
  let ultimos = [];
  async function carregar() {
    let r;
    try { r = await api("GET", `pagamentos${filtro ? `?situacao=${filtro}` : ""}`); }
    catch (erro) { montar($("[data-lista]"), aviso("aviso", erro.message)); return; }
    montar($("[data-totais]"), html`
      <div class="numero"><p class="numero__rotulo">Recebido</p><p class="numero__valor">${reais(r.totais.recebido)}</p></div>
      <div class="numero"><p class="numero__rotulo">Pendente</p><p class="numero__valor">${reais(r.totais.pendente)}</p></div>
      ${r.totais.sem_nota > 0 && html`<div class="numero"><p class="numero__rotulo">Sem nota fiscal</p><p class="numero__valor">${r.totais.sem_nota}</p><p class="numero__nota">pagamentos recebidos</p></div>`}`);
    ultimos = r.pagamentos;
    montar($("[data-lista]"), r.pagamentos.length ? html`
      <div class="tabela tabela--pagamentos" role="table" aria-label="Pagamentos">
        <div class="tabela__linha tabela__cab" role="row"><span>Data</span><span>Loja</span><span>Cliente</span><span>Valor</span><span>Situação</span><span>Nota fiscal</span></div>
        ${r.pagamentos.map((p) => { const [t, tom] = SITUACAO[p.situacao]; return html`
          <div class="tabela__linha tabela__linha--clicavel" role="row" tabindex="0" data-cliente="${p.cliente_id}" data-pagamento="${p.id}">
            <span class="tabela__suave">${quandoCurto(p.confirmado_em ?? p.criado_em)}</span>
            <span class="tabela__principal"><strong>${p.nome_loja}${p.tipo === "mensalidade" && html` <span class="selo selo--neutro selo--mini">Mensalidade</span>`}</strong><small class="so-celular">${p.cliente} · ${t}</small></span>
            <span>${p.cliente}</span>
            <span class="tabela__numero">${reais(p.valor_centavos)}</span>
            <span><span class="ponto ponto--${tom}">${t}</span></span>
            <span class="tabela__suave">${p.situacao !== "aprovado" ? "—"
              : p.nota_fiscal ? html`${p.nota_fiscal.link ? html`<a class="link" href="${p.nota_fiscal.link}" target="_blank" rel="noopener">${p.nota_fiscal.numero}</a>` : p.nota_fiscal.numero}
                  ${notas && html`<button type="button" class="btn-icone btn-icone--pequeno" data-nota title="Corrigir a nota" aria-label="Corrigir a nota">${icone("editar", { tamanho: 14 })}</button>`}`
              : notas ? html`<button type="button" class="btn btn--suave btn--pequeno" data-nota>Registrar</button>` : html`<span class="ponto ponto--aviso">Sem nota</span>`}</span>
          </div>`; })}
      </div>` : html`<p class="texto-suave">Nenhum pagamento aqui.</p>`);
  }

  conteiner.addEventListener("click", (ev) => {
    const botao = ev.target.closest("[data-filtro]");
    if (botao) {
      filtro = botao.dataset.filtro;
      conteiner.querySelectorAll("[data-filtro]").forEach((b) => { const ativo = b === botao; b.classList.toggle("segmento--ativo", ativo); b.setAttribute("aria-pressed", String(ativo)); });
      return carregar();
    }
    if (ev.target.closest("a")) return;
    const nota = ev.target.closest("[data-nota]");
    if (nota) {
      const p = ultimos.find((x) => x.id === nota.closest("[data-pagamento]")?.dataset.pagamento);
      if (p) registrarNota(p, carregar);
      return;
    }
    const linha = ev.target.closest("[data-cliente]");
    if (linha) abrirFicha(linha.dataset.cliente, carregar, eu);
  });
  conteiner.addEventListener("keydown", (ev) => {
    const linha = ev.target.closest?.(".tabela__linha[data-cliente]");
    if (linha && ev.target === linha && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); abrirFicha(linha.dataset.cliente, carregar, eu); }
  });
  await carregar();
}
