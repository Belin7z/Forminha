/* ==========================================================
   COMPONENTE — imprimir etiquetas (de um produto, de um pedido
   ou de todos os pedidos de um dia). A dona escolhe quantas de
   cada, a data de fabricação, o tamanho (térmica ou folha A4) e
   uma linha livre (ex.: CNPJ); a prévia mostra como fica.
   Os textos de cada etiqueta vêm de base/etiquetas.js (testado).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, toast } from "/src/scripts/base/ui.js";
import { dataISO } from "/src/scripts/base/agendamento.js";
import { TAMANHOS, TAMANHO_PADRAO, dadosDaEtiqueta, faltandoNaEtiqueta, opcoesEmTexto, paginar } from "/src/scripts/base/etiquetas.js";
import { api } from "../nucleo/api.js";

const PREFERENCIAS = "forminha:etiquetas"; // tamanho e linha livre ficam lembrados neste aparelho
const MAXIMO = 500;
const lerPreferencias = () => { try { return JSON.parse(localStorage.getItem(PREFERENCIAS)) ?? {}; } catch { return {}; } };
const gravarPreferencias = (p) => { try { localStorage.setItem(PREFERENCIAS, JSON.stringify(p)); } catch { /* sem espaço ou modo privado */ } };

function etiquetaHtml(e) {
  return html`
    <div class="etq">
      <strong class="etq__nome">${e.nome}</strong>
      ${e.detalhe && html`<span class="etq__detalhe">${e.detalhe}</span>`}
      ${e.cliente && html`<span class="etq__cliente">${e.cliente}</span>`}
      ${e.ingredientes && html`<span class="etq__ing"><b>Ingredientes:</b> ${e.ingredientes}</span>`}
      ${e.alergicos && html`<span class="etq__alerta">${e.alergicos}</span>`}
      ${e.gluten && html`<span class="etq__alerta">${e.gluten}</span>`}
      ${e.conservacao && html`<span class="etq__cons">${e.conservacao}</span>`}
      <span class="etq__datas">
        ${e.fabricacao && html`<span>Fab.: <b>${e.fabricacao}</b></span>`}
        ${e.validade && html`<span>Val.: <b>${e.validade}</b></span>`}
        ${e.lote && html`<span>Lote: ${e.lote}</span>`}
      </span>
      <span class="etq__loja">${e.loja}${e.extra && ` · ${e.extra}`}</span>
    </div>`;
}

/** Monta as páginas fora da tela e chama a impressão do navegador (só as etiquetas saem no papel). */
function imprimir(etiquetas, tamanho) {
  const t = TAMANHOS[tamanho];
  document.getElementById("area-etiquetas")?.remove();
  document.getElementById("pagina-etiquetas")?.remove();
  const area = document.createElement("div");
  area.id = "area-etiquetas";
  area.className = `etq-area ${t.folha ? "etq-area--folha" : "etq-area--termica"}`;
  area.dataset.tamanho = tamanho;
  area.style.cssText = `--etq-l:${t.largura}mm;--etq-a:${t.altura}mm`
    + (t.folha ? `;--etq-topo:${t.folha.topo}mm;--etq-esq:${t.folha.esquerda}mm;--etq-col:${t.folha.colunas};--etq-espaco:${t.folha.espacoColunas}mm` : "");
  montar(area, html`${paginar(etiquetas, tamanho).map((pagina) => html`<div class="etq-pagina">${pagina.map(etiquetaHtml)}</div>`)}`);
  const estilo = document.createElement("style");
  estilo.id = "pagina-etiquetas";
  estilo.textContent = t.folha ? "@page { size: A4; margin: 0; }" : `@page { size: ${t.largura}mm ${t.altura}mm; margin: 0; }`;
  document.head.append(estilo);
  document.body.append(area);
  document.body.classList.add("imprimindo-etiquetas");
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("imprimindo-etiquetas");
    area.remove();
    estilo.remove();
  }, { once: true });
  window.print();
}

/**
 * Abre a janela de etiquetas.
 * itens: [{ produto_id?, nome, opcoes?, cliente?, lote?, copias? }] — o produto é achado pelo id (ou pelo nome, nos itens antigos).
 */
export async function abrirEtiquetas({ titulo = "Etiquetas", itens, fabricacao = dataISO(new Date()), comCliente = false }) {
  let produtos, loja;
  try {
    const [lista, cfg] = await Promise.all([api.get("/produtos"), api.get("/configuracoes")]);
    produtos = lista.produtos;
    loja = cfg.configuracoes.loja ?? {};
  } catch (erro) { toast(erro.message, "erro"); return; }

  const achar = (it) => produtos.find((p) => p.id === Number(it.produto_id)) ?? produtos.find((p) => p.nome === it.nome) ?? null;
  const linhas = itens.map((it) => ({ ...it, produto: achar(it), copias: Math.max(0, Math.min(MAXIMO, Number(it.copias ?? 1) || 0)) }));
  const pref = lerPreferencias();
  const estado = {
    tamanho: TAMANHOS[pref.tamanho] ? pref.tamanho : TAMANHO_PADRAO,
    extra: String(pref.extra ?? ""),
    fabricacao,
    cliente: comCliente && pref.cliente !== false,
  };
  const faltas = linhas.filter((l) => faltandoNaEtiqueta(l.produto).length);

  const m = abrirModal({
    titulo, largura: 880, classe: "modal-etiquetas",
    corpo: html`
      <div class="etq-tela">
        <div class="etq-tela__opcoes">
          <div class="grade-campos grade-campos--2">
            <div class="campo"><label for="etq-fab">Data de fabricação</label>
              <input id="etq-fab" class="entrada" type="date" value="${estado.fabricacao}" data-etq="fabricacao"></div>
            <div class="campo"><label for="etq-tam">Tamanho da etiqueta</label>
              <select id="etq-tam" class="entrada" data-etq="tamanho">
                ${Object.entries(TAMANHOS).map(([id, t]) => html`<option value="${id}" ${id === estado.tamanho && "selected"}>${t.nome}</option>`)}
              </select></div>
          </div>
          <div class="campo"><label for="etq-extra">Linha extra <span class="texto-suave">(opcional — ex.: CNPJ, “Feito artesanalmente”)</span></label>
            <input id="etq-extra" class="entrada" maxlength="80" value="${estado.extra}" data-etq="extra"></div>
          ${comCliente && html`<label class="opcao-mini"><input type="checkbox" data-etq="cliente" ${estado.cliente && "checked"}> Mostrar o nome do cliente</label>`}
          ${faltas.length > 0 && html`<p class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>Sem ingredientes ou validade em: <strong>${[...new Set(faltas.map((l) => l.nome))].join(", ")}</strong>. Complete em Produtos → editar → “Etiqueta”.</span></p>`}
          <ul class="etq-lista">
            ${linhas.map((l, i) => html`
              <li>
                <div><strong>${l.nome}</strong>${opcoesEmTexto(l.opcoes) && html`<small class="texto-suave">${opcoesEmTexto(l.opcoes)}</small>`}${l.cliente && html`<small class="texto-suave">${l.cliente}${l.lote ? ` · ${l.lote}` : ""}</small>`}</div>
                <label class="etq-lista__qtd"><span class="sr-only">Quantidade de etiquetas</span>
                  <input class="entrada entrada--curta" type="number" min="0" max="${MAXIMO}" value="${l.copias}" data-copias="${i}"></label>
              </li>`)}
          </ul>
          <p class="texto-suave etq-tela__aviso">${icone("info", { tamanho: 14 })} Confira com a vigilância sanitária da sua cidade o que a etiqueta do seu produto precisa ter.</p>
        </div>
        <div class="etq-tela__previa">
          <p class="ap__previa-rotulo">${icone("olho", { tamanho: 14 })} Prévia</p>
          <div class="etq-previa" data-previa></div>
        </div>
      </div>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
      <button type="button" class="btn btn--primario" data-imprimir-etiquetas>${icone("impressora", { tamanho: 16 })} <span data-total></span></button>`,
  });

  const etiquetas = () => linhas.flatMap((l) => Array.from({ length: l.copias }, () => dadosDaEtiqueta({
    item: l, produto: l.produto, loja, fabricacao: estado.fabricacao, lote: l.lote, extra: estado.extra, mostrarCliente: estado.cliente,
  })));

  function atualizar() {
    const t = TAMANHOS[estado.tamanho];
    const todas = etiquetas();
    const previa = m.el.querySelector("[data-previa]");
    previa.style.cssText = `--etq-l:${t.largura}mm;--etq-a:${t.altura}mm`;
    previa.dataset.tamanho = estado.tamanho;
    const primeira = todas[0] ?? dadosDaEtiqueta({ item: linhas[0] ?? { nome: "" }, produto: linhas[0]?.produto, loja, fabricacao: estado.fabricacao, extra: estado.extra });
    montar(previa, etiquetaHtml(primeira));
    m.rodape.querySelector("[data-total]").textContent = todas.length === 1 ? "Imprimir 1 etiqueta" : `Imprimir ${todas.length} etiquetas`;
    m.rodape.querySelector("[data-imprimir-etiquetas]").disabled = todas.length === 0 || todas.length > MAXIMO;
  }

  m.el.addEventListener("input", (ev) => {
    const campo = ev.target.dataset.etq;
    if (campo === "fabricacao" && /^\d{4}-\d{2}-\d{2}$/.test(ev.target.value)) estado.fabricacao = ev.target.value;
    else if (campo === "tamanho") estado.tamanho = ev.target.value;
    else if (campo === "extra") estado.extra = ev.target.value.trim();
    else if (campo === "cliente") estado.cliente = ev.target.checked;
    else if (ev.target.dataset.copias != null) linhas[Number(ev.target.dataset.copias)].copias = Math.max(0, Math.min(MAXIMO, Math.floor(Number(ev.target.value) || 0)));
    atualizar();
  });

  m.rodape.querySelector("[data-imprimir-etiquetas]").addEventListener("click", () => {
    const todas = etiquetas();
    if (!todas.length) return;
    if (todas.length > MAXIMO) return toast(`Imprima no máximo ${MAXIMO} etiquetas por vez.`, "info");
    gravarPreferencias({ tamanho: estado.tamanho, extra: estado.extra, cliente: estado.cliente });
    imprimir(todas, estado.tamanho);
  });

  atualizar();
  return m;
}
