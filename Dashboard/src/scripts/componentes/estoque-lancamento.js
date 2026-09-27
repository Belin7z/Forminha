/* ==========================================================
   COMPONENTE — lançar no estoque: compra (entrada, em embalagem
   ou em fardo), contagem (acertar o que existe de verdade) ou
   perda (saída).
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { embalagemTexto, fardoTexto, lerNumero, paraCampo, paraEnvio, qtdTexto } from "../nucleo/estoque.js";

const TIPOS = [
  { valor: "compra", texto: "Comprei (entrada no estoque)" },
  { valor: "ajuste", texto: "Contei o estoque (acertar a quantidade)" },
  { valor: "perda", texto: "Perdi ou estragou (saída)" },
];

/**
 * ing: { id, nome, unidade, estoque, embalagem_nome, embalagem_qtd, embalagem_preco, fardo_nome, fardo_qtd }
 * padrao: { tipo, embalagens, valor, forma } para já abrir preenchido (ex.: vindo da lista de compras)
 */
export function abrirLancamento(ing, { padrao = {}, aoSalvar } = {}) {
  const tipoInicial = padrao.tipo ?? "compra";
  const temFardo = Number(ing.fardo_qtd) > 0;
  let forma = temFardo && padrao.forma === "fardo" ? "fardo" : "embalagem";
  const m = abrirModal({
    titulo: `Lançar — ${ing.nome}`, largura: 520,
    corpo: html`<form id="form-lancamento" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      <p class="texto-suave est-resumo">Em estoque agora: <strong>${qtdTexto(ing.estoque, ing.unidade)}</strong></p>
      ${campo({ nome: "tipo", rotulo: "O que aconteceu?", tipo: "select", valor: tipoInicial, opcoes: TIPOS })}

      <div data-grupo="compra">
        ${temFardo && html`<div class="segmentos segmentos--solto" role="group" aria-label="Comprou em">
          <button type="button" class="segmento ${forma === "embalagem" && "segmento--ativo"}" data-acao="forma" data-forma="embalagem" aria-pressed="${String(forma === "embalagem")}">Por ${ing.embalagem_nome || "embalagem"}</button>
          <button type="button" class="segmento ${forma === "fardo" && "segmento--ativo"}" data-acao="forma" data-forma="fardo" aria-pressed="${String(forma === "fardo")}">Por ${ing.fardo_nome || "fardo"}</button>
        </div>`}
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "embalagens", rotulo: "Quantas?", valor: padrao.embalagens ?? "1", atributos: 'inputmode="decimal"', ajuda: "…" })}
          ${campo({ nome: "valor", rotulo: "Valor total pago (R$)", valor: padrao.valor != null ? emReais(padrao.valor) : "", mascara: "moeda", ajuda: "Opcional. Atualiza o preço para o cálculo de custo." })}
        </div>
        ${campo({ nome: "validade", rotulo: "Validade (opcional)", tipo: "date", valor: "", ajuda: "Informe para acompanhar o vencimento e usar primeiro o que vence antes." })}
        <p class="est-previa" data-previa-compra></p>
      </div>
      <div data-grupo="ajuste" hidden>
        ${campo({ nome: "novo_estoque", rotulo: `Quanto tem agora? (${ing.unidade})`, valor: paraCampo(ing.estoque), atributos: 'inputmode="decimal"', ajuda: "O sistema calcula a diferença e registra o acerto." })}
        <p class="est-previa" data-previa-ajuste></p>
      </div>
      <div data-grupo="perda" hidden>
        ${campo({ nome: "quantidade", rotulo: `Quanto foi perdido? (${ing.unidade})`, valor: "", atributos: 'inputmode="decimal"' })}
      </div>
      ${campo({ nome: "nota", rotulo: "Observação (opcional)", valor: "", atributos: 'maxlength="200"', placeholder: "Ex.: mercado do centro, validade vencida…" })}
    </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
      <button type="submit" form="form-lancamento" class="btn btn--primario" data-salvar>Registrar</button>`,
  });

  const form = m.el.querySelector("form");
  ativarCampos(form);
  const tipoCampo = form.querySelector('[name="tipo"]');
  const qtdCampo = form.querySelector('[name="embalagens"]');
  const previa = (nome) => form.querySelector(`[data-previa-${nome}]`);

  function multiplicador() { return forma === "fardo" ? ing.fardo_qtd : 1; }
  function nomeUnidade() { return forma === "fardo" ? (ing.fardo_nome || "fardo") : (ing.embalagem_nome || "embalagem"); }

  function atualizarRotulos() {
    qtdCampo.closest(".campo").querySelector("label").firstChild.textContent = `Quantos ${nomeUnidade()}s?`;
    qtdCampo.closest(".campo").querySelector(".campo__ajuda").textContent =
      forma === "fardo" ? `Cada ${ing.fardo_nome || "fardo"}: ${fardoTexto(ing)}.` : `Cada ${ing.embalagem_nome || "embalagem"}: ${embalagemTexto(ing)}.`;
  }

  function atualizar() {
    for (const g of form.querySelectorAll("[data-grupo]")) g.hidden = g.dataset.grupo !== tipoCampo.value;
    const d = dadosDe(form);
    const emb = lerNumero(d.embalagens);
    if (Number.isFinite(emb) && emb > 0) {
      const entra = Math.round(emb * multiplicador() * ing.embalagem_qtd * 1000) / 1000;
      const valor = paraCentavos(d.valor);
      previa("compra").textContent = `Entram ${qtdTexto(entra, ing.unidade)} no estoque${valor > 0 ? ` · ${brl(Math.round(valor / emb))} por ${nomeUnidade()}` : ""}.`;
    } else previa("compra").textContent = "";
    const alvo = lerNumero(d.novo_estoque);
    if (Number.isFinite(alvo)) {
      const dif = Math.round((alvo - ing.estoque) * 1000) / 1000;
      previa("ajuste").textContent = dif === 0 ? "Igual ao que o sistema já tem." : `Diferença: ${dif > 0 ? "+" : "−"}${qtdTexto(Math.abs(dif), ing.unidade)}.`;
    } else previa("ajuste").textContent = "";
  }
  form.addEventListener("input", atualizar);
  tipoCampo.addEventListener("change", atualizar);
  form.querySelectorAll('[data-acao="forma"]').forEach((b) => b.addEventListener("click", () => {
    forma = b.dataset.forma;
    form.querySelectorAll('[data-acao="forma"]').forEach((x) => { x.classList.toggle("segmento--ativo", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    atualizarRotulos();
    atualizar();
  }));
  atualizarRotulos();
  atualizar();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(form);
    const corpo = { ingrediente_id: ing.id, tipo: d.tipo, nota: d.nota };
    if (d.tipo === "compra") { corpo.embalagens = paraEnvio(d.embalagens); corpo.valor = paraCentavos(d.valor) || undefined; corpo.validade = d.validade || undefined; if (temFardo) corpo.forma = forma; }
    else if (d.tipo === "ajuste") corpo.novo_estoque = paraEnvio(d.novo_estoque);
    else corpo.quantidade = paraEnvio(d.quantidade);
    await ocupado(m.el.querySelector("[data-salvar]"), async () => {
      try {
        const r = await api.post("/estoque/movimentos", corpo);
        toast(r.sem_mudanca ? "A contagem é igual à do sistema: nada mudou." : "Lançamento registrado!");
        m.fechar();
        aoSalvar?.(r.ingrediente);
      } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
    });
  });
  return m;
}
