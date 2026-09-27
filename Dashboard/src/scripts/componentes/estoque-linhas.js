/* ==========================================================
   COMPONENTE — editor de linhas de receita: cada linha é um
   ingrediente (ou uma receita-base) e uma quantidade, que pode
   ser digitada em medida caseira (xícara, colher…). Mostra o
   custo e o estoque de cada linha ao vivo — e deixa lançar
   estoque na hora, sem sair da receita. Serve às receitas dos
   produtos e às receitas-base.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { lerNumero, paraCampo, qtdTexto } from "../nucleo/estoque.js";
import { abrirLancamento } from "./estoque-lancamento.js";

export const chaveOpcao = (grupo, item) => JSON.stringify([grupo, item]);

/** Linha vinda do servidor -> linha do editor (a quantidade sempre volta na medida-base). */
export const linhaDoServidor = (l) => ({
  ref: l.ingrediente_id ? `i:${l.ingrediente_id}` : `p:${l.preparo_id}`, qtd: paraCampo(l.quantidade), medida: "",
  opcao: l.opcao_grupo ? chaveOpcao(l.opcao_grupo, l.opcao_item) : undefined,
});

/**
 * ings: [{ id, nome, unidade, estoque, custo_unit, medidas, ativo, … }]   preparos: [{ id, nome, unidade, custo_unit }]
 * opcoes: [{ chave, rotulo }] (só nas receitas de produto)   fator(tipo): multiplicador do custo ("base" | "extra")
 */
export function criarEditorLinhas({ ings, preparos = [], opcoes = [], base = [], extras = [], fator = () => 1, aoMudar = () => {} }) {
  const itens = new Map([...ings.map((i) => [`i:${i.id}`, i]), ...preparos.map((p) => [`p:${p.id}`, p])]);
  const dados = { base: base.map((l) => ({ medida: "", ...l })), extras: extras.map((l) => ({ medida: "", ...l })) };
  const alvo = { base: null, extras: null };

  const medidaOpcoes = (it, sel) => html`<option value="">${it?.unidade ?? "—"}</option>${(it?.medidas ?? []).map((m, k) =>
    html`<option value="${k}" ${String(sel) === String(k) && "selected"}>${m.nome}</option>`)}`;

  const linhaHtml = (l, tipo, i) => {
    const it = itens.get(l.ref);
    return html`<div class="est-linha ${tipo === "extras" && "est-linha--opcao"}" data-linha data-ref="${l.ref}">
      ${tipo === "extras" && html`<select class="entrada" data-campo="opcao" aria-label="Opção escolhida">${opcoes.map((o) =>
        html`<option value="${o.chave}" ${o.chave === l.opcao && "selected"}>${o.rotulo}</option>`)}</select>`}
      <select class="entrada" data-campo="ref" aria-label="Ingrediente"><option value="">Escolha…</option>
        <optgroup label="Ingredientes">${ings.filter((x) => x.ativo || `i:${x.id}` === l.ref).map((x) =>
          html`<option value="i:${x.id}" ${`i:${x.id}` === l.ref && "selected"}>${x.nome} (${x.unidade}) — tem ${qtdTexto(x.estoque, x.unidade)}</option>`)}</optgroup>
        ${preparos.length > 0 && html`<optgroup label="Receitas-base">${preparos.map((x) =>
          html`<option value="p:${x.id}" ${`p:${x.id}` === l.ref && "selected"}>${x.nome} (${x.unidade})</option>`)}</optgroup>`}
      </select>
      <span class="est-linha__qtd"><input class="entrada" data-campo="qtd" inputmode="decimal" placeholder="0" value="${l.qtd}" aria-label="Quantidade">
        <select class="entrada entrada--medida" data-campo="medida" aria-label="Medida">${medidaOpcoes(it, l.medida)}</select></span>
      <span class="est-linha__custo" data-custo></span>
      <span class="est-linha__acoes">
        ${it && l.ref.startsWith("i:") && html`<button type="button" class="btn-icone btn-icone--pequeno" data-acao="add-estoque" title="Lançar estoque de ${it.nome}" aria-label="Lançar estoque de ${it.nome}">${icone("mais", { tamanho: 15 })}</button>`}
        <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="tirar" data-tipo="${tipo}" data-i="${i}" aria-label="Tirar linha">${icone("lixeira", { tamanho: 17 })}</button>
      </span>
    </div>`;
  };

  function renderizar(tipo) {
    const el = alvo[tipo];
    if (!el) return;
    montar(el, html`<div class="est-linhas">${dados[tipo].map((l, i) => linhaHtml(l, tipo, i))}</div>
      <button type="button" class="btn btn--suave btn--pequeno" data-acao="mais" data-tipo="${tipo}">${icone("mais", { tamanho: 15 })} ${tipo === "base" ? "Adicionar ingrediente" : "Adicionar acréscimo"}</button>`);
    atualizar(el, tipo);
  }

  const lerDom = (row) => ({
    ref: row.querySelector('[data-campo="ref"]').value, qtd: row.querySelector('[data-campo="qtd"]').value,
    medida: row.querySelector('[data-campo="medida"]').value, opcao: row.querySelector('[data-campo="opcao"]')?.value,
  });
  const sincronizar = (tipo) => { if (alvo[tipo]) dados[tipo] = [...alvo[tipo].querySelectorAll("[data-linha]")].map(lerDom); };

  /** Quantidade da linha na medida-base do ingrediente (ex.: "2 xícaras" -> 180 g). NaN se não for número. */
  function quantidadeBase(l) {
    const q = lerNumero(l.qtd), it = itens.get(l.ref);
    if (l.medida === "" || !it?.medidas?.[l.medida]) return q;
    return q * Number(it.medidas[l.medida].qtd);
  }

  /** Refaz o botão de "Lançar estoque" da linha (só existe depois de escolher um ingrediente). */
  function atualizarAcoes(row, it, ref) {
    montar(row.querySelector(".est-linha__acoes"), html`
      ${it && ref.startsWith("i:") && html`<button type="button" class="btn-icone btn-icone--pequeno" data-acao="add-estoque" title="Lançar estoque de ${it.nome}" aria-label="Lançar estoque de ${it.nome}">${icone("mais", { tamanho: 15 })}</button>`}
      <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="tirar" aria-label="Tirar linha">${icone("lixeira", { tamanho: 17 })}</button>`);
  }

  /** Atualiza o que muda enquanto se digita (medidas, custo e estoque da linha) sem redesenhar tudo. */
  function atualizar(el, tipo) {
    for (const row of el.querySelectorAll("[data-linha]")) {
      const l = lerDom(row), it = itens.get(l.ref);
      if (row.dataset.ref !== l.ref) {
        row.dataset.ref = l.ref;
        montar(row.querySelector('[data-campo="medida"]'), medidaOpcoes(it, ""));
        l.medida = "";
        atualizarAcoes(row, it, l.ref);
      }
      const q = quantidadeBase(l);
      const custo = it && q > 0 ? q * Number(it.custo_unit) * fator(tipo) : 0;
      const convertida = it && l.medida !== "" && q > 0 ? `= ${qtdTexto(q, it.unidade)} · ` : "";
      const custoTxt = custo > 0 ? `${convertida}≈ ${brl(Math.round(custo))}` : convertida.replace(/ · $/, "");
      montar(row.querySelector("[data-custo]"), html`${custoTxt}${custoTxt && it && " · "}${it && html`<span class="${Number(it.estoque) <= 0 && "est__qtd--zero"}">tem ${qtdTexto(it.estoque, it.unidade)}</span>`}`);
    }
  }

  const custoDe = (tipo) => (alvo[tipo] ? [...alvo[tipo].querySelectorAll("[data-linha]")] : []).reduce((soma, row) => {
    const l = lerDom(row), it = itens.get(l.ref), q = quantidadeBase(l);
    return soma + (it && q > 0 ? q * Number(it.custo_unit) * fator(tipo) : 0);
  }, 0);

  const atualizarTudo = () => { for (const t of ["base", "extras"]) if (alvo[t]) atualizar(alvo[t], t); };

  /** Depois de lançar estoque, atualiza o texto do próprio <option> (pode aparecer em mais de uma linha/lista). */
  function atualizarOpcaoRef(ref) {
    const it = itens.get(ref);
    if (!it || !ref.startsWith("i:")) return;
    const rotulo = `${it.nome} (${it.unidade}) — tem ${qtdTexto(it.estoque, it.unidade)}`;
    for (const t of ["base", "extras"]) {
      alvo[t]?.querySelectorAll(`option[value="${CSS.escape(ref)}"]`).forEach((op) => { op.textContent = rotulo; });
    }
  }

  function ligar(lista) {
    for (const [tipo, el] of Object.entries(lista)) {
      if (!el) continue;
      alvo[tipo] = el;
      renderizar(tipo);
      el.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-acao]");
        if (!b || !el.contains(b)) return;
        if (b.dataset.acao === "add-estoque") {
          const row = b.closest("[data-linha]");
          const it = itens.get(row.dataset.ref);
          if (!it) return;
          abrirLancamento(it, { aoSalvar: (novo) => { itens.set(row.dataset.ref, novo); atualizarTudo(); atualizarOpcaoRef(row.dataset.ref); aoMudar(); } });
          return;
        }
        sincronizar(tipo);
        if (b.dataset.acao === "mais") dados[tipo].push({ ref: "", qtd: "", medida: "", opcao: opcoes[0]?.chave });
        else if (b.dataset.acao === "tirar") dados[tipo].splice(Number(b.dataset.i), 1);
        else return;
        renderizar(tipo);
        aoMudar();
      });
      const aoDigitar = () => { atualizar(el, tipo); aoMudar(); };
      el.addEventListener("input", aoDigitar);
      el.addEventListener("change", aoDigitar);
    }
    aoMudar();
  }

  /** Linhas prontas para o servidor. Linha vazia nas de base é ignorada; erro de preenchimento vira uma Error com a frase para a tela. */
  function linhasParaApi() {
    sincronizar("base"); sincronizar("extras");
    const saida = [];
    for (const tipo of ["base", "extras"]) {
      for (const l of dados[tipo]) {
        if (tipo === "base" && l.ref === "" && String(l.qtd).trim() === "") continue;
        if (l.ref === "") throw new Error("Escolha o ingrediente de cada linha (ou tire a linha vazia).");
        const it = itens.get(l.ref), q = quantidadeBase(l);
        if (!(q > 0)) throw new Error(`Informe a quantidade de ${it?.nome ?? "cada ingrediente"}.`);
        const linha = { quantidade: Math.round(q * 1000) / 1000 };
        if (l.ref.startsWith("i:")) linha.ingrediente_id = Number(l.ref.slice(2)); else linha.preparo_id = Number(l.ref.slice(2));
        if (tipo === "extras") { const [g, i] = JSON.parse(l.opcao); linha.opcao_grupo = g; linha.opcao_item = i; }
        saida.push(linha);
      }
    }
    return saida;
  }

  return { ligar, linhasParaApi, custoBase: () => custoDe("base"), custoExtras: () => custoDe("extras"), atualizarTudo };
}
