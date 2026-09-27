/* ==========================================================
   ESTOQUE — "Receber compra": lança de uma vez vários itens de
   uma nota (ou de uma ida ao mercado), cada um por embalagem ou
   por fardo, com o valor pago e a validade de cada um. Tudo ou
   nada.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe } from "/src/scripts/base/formularios.js";
import { brl, emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { lerNumero, paraCampo, paraEnvio, qtdTexto, temFardo } from "../nucleo/estoque.js";

const formaOpcoes = (i, sel) => html`<option value="embalagem" ${sel !== "fardo" && "selected"}>${i?.embalagem_nome || "embalagem"}</option>
  ${i && temFardo(i) && html`<option value="fardo" ${sel === "fardo" && "selected"}>${i.fardo_nome}</option>`}`;

/** inicial: [{ ingrediente_id, embalagens, valor (centavos) }] para já abrir preenchido (ex.: a lista de compras). */
export async function abrirReceberCompra({ inicial = [], nota = "", aoSalvar } = {}) {
  let ings;
  try { ings = (await api.get("/ingredientes")).ingredientes.filter((i) => i.ativo); }
  catch (erro) { toast(erro.message, "erro"); return; }
  if (!ings.length) { toast("Cadastre os ingredientes antes de lançar uma compra.", "erro"); return; }
  const porId = new Map(ings.map((i) => [String(i.id), i]));
  let linhas = inicial.length
    ? inicial.map((l) => ({ ing: String(l.ingrediente_id), emb: paraCampo(l.embalagens), valor: l.valor > 0 ? emReais(l.valor) : "", validade: "", forma: "embalagem" }))
    : [{ ing: "", emb: "1", valor: "", validade: "", forma: "embalagem" }];

  const m = abrirModal({
    titulo: "Receber compra", largura: 860, classe: "est-editor",
    corpo: html`<form id="form-compra" novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "nota", rotulo: "De onde veio? (opcional)", valor: nota, atributos: 'maxlength="120"', placeholder: "Ex.: Nota 123 — Atacadão" })}
      <div class="est-compra-cab" aria-hidden="true"><span>Ingrediente</span><span>Quantidade</span><span>Valor pago (R$)</span><span>Validade</span><span></span></div>
      <div id="compra-linhas"></div>
      <button type="button" class="btn btn--suave btn--pequeno" data-acao="mais">${icone("mais", { tamanho: 15 })} Adicionar item</button>
      <p class="est-previa" data-total></p>
    </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
      <button type="button" class="btn btn--primario" data-acao="salvar-compra">Registrar compra</button>`,
  });
  const form = m.el.querySelector("form"), lista = m.el.querySelector("#compra-linhas");

  const ler = () => [...lista.querySelectorAll("[data-linha]")].map((r) => ({
    ing: r.querySelector('[data-campo="ing"]').value, emb: r.querySelector('[data-campo="emb"]').value,
    valor: r.querySelector('[data-campo="valor"]').value, validade: r.querySelector('[data-campo="validade"]').value,
    forma: r.querySelector('[data-campo="forma"]').value,
  }));

  function desenhar() {
    montar(lista, html`${linhas.map((l, i) => { const ing = porId.get(l.ing); return html`<div class="est-compra-linha" data-linha data-ing="${l.ing}">
      <select class="entrada" data-campo="ing" aria-label="Ingrediente"><option value="">Escolha…</option>${ings.map((x) => html`<option value="${x.id}" ${String(x.id) === l.ing && "selected"}>${x.nome}</option>`)}</select>
      <span class="est-linha__qtd"><input class="entrada" data-campo="emb" inputmode="decimal" value="${l.emb}" aria-label="Quantidade">
        <select class="entrada entrada--forma" data-campo="forma" aria-label="Comprado por">${formaOpcoes(ing, l.forma)}</select></span>
      <input class="entrada" data-campo="valor" data-mascara="moeda" value="${l.valor}" aria-label="Valor pago">
      <input class="entrada" type="date" data-campo="validade" value="${l.validade}" aria-label="Validade">
      <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="tirar" data-i="${i}" aria-label="Tirar item">${icone("lixeira", { tamanho: 17 })}</button>
      <small class="texto-suave est-compra-equivale" data-equivale></small>
    </div>`; })}`);
    lista.querySelectorAll("[data-linha]").forEach((r) => ativarCampos(r));
    resumir();
  }

  function resumir() {
    let total = 0;
    for (const r of lista.querySelectorAll("[data-linha]")) {
      const idSel = r.querySelector('[data-campo="ing"]').value;
      if (r.dataset.ing !== idSel) { // trocou o ingrediente: refaz as opções de "comprado por" (e não deixa "fardo" escolhido sem existir)
        r.dataset.ing = idSel;
        montar(r.querySelector('[data-campo="forma"]'), formaOpcoes(porId.get(idSel), "embalagem"));
      }
      const i = porId.get(idSel), e = lerNumero(r.querySelector('[data-campo="emb"]').value);
      const forma = r.querySelector('[data-campo="forma"]').value;
      const equivale = r.querySelector("[data-equivale]");
      if (i && e > 0) {
        const mult = forma === "fardo" ? Number(i.fardo_qtd) : 1;
        equivale.textContent = `= ${qtdTexto(e * mult * i.embalagem_qtd, i.unidade)}`;
      } else equivale.textContent = "";
      total += paraCentavos(r.querySelector('[data-campo="valor"]').value);
    }
    form.querySelector("[data-total]").textContent = total > 0 ? `Total pago: ${brl(total)}` : "";
  }
  form.addEventListener("input", resumir);
  form.addEventListener("change", resumir);
  desenhar();

  delegar(m.el, {
    mais: () => { linhas = ler(); linhas.push({ ing: "", emb: "1", valor: "", validade: "", forma: "embalagem" }); desenhar(); },
    tirar: (el) => { linhas = ler(); linhas.splice(Number(el.dataset.i), 1); if (!linhas.length) linhas.push({ ing: "", emb: "1", valor: "", validade: "", forma: "embalagem" }); desenhar(); },
    "salvar-compra": async (botao) => {
      const itens = [];
      for (const l of ler()) {
        if (l.ing === "" && paraCentavos(l.valor) === 0 && (l.emb.trim() === "" || l.emb.trim() === "1")) continue; // linha em branco
        if (l.ing === "") { toast("Escolha o ingrediente de cada linha (ou tire a linha vazia).", "erro"); return; }
        itens.push({ ingrediente_id: Number(l.ing), embalagens: paraEnvio(l.emb), valor: paraCentavos(l.valor) || undefined, validade: l.validade || undefined, forma: l.forma });
      }
      if (!itens.length) { toast("Adicione pelo menos um item comprado.", "erro"); return; }
      await ocupado(botao, async () => {
        try {
          const r = await api.post("/estoque/compra", { nota: dadosDe(form).nota, itens });
          toast(`Compra registrada: ${r.itens} ${r.itens === 1 ? "item" : "itens"}${r.total > 0 ? ` · ${brl(r.total)}` : ""}.`);
          m.fechar();
          aoSalvar?.();
        } catch (erro) { toast(erro.message, "erro"); }
      });
    },
  });
  return m;
}
