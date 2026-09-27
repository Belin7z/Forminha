/* ==========================================================
   ESTOQUE — Receitas-base: massa de brigadeiro, ganache, calda…
   Cadastradas uma vez e usadas em várias receitas de produtos.
   Mudou o preço de um ingrediente, o custo de todos os produtos
   que usam a receita-base muda junto.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { UNIDADES, lerNumero, numero, paraCampo, paraEnvio, qtdTexto } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, subAbas, vazio } from "./pagina.js";
import { criarEditorLinhas, linhaDoServidor } from "./estoque-linhas.js";
import { SUBABAS_RECEITAS } from "./estoque-receitas.js";

export async function preparosEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let lista;

  async function carregar() {
    try { lista = (await api.get("/preparos")).preparos; }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  function desenhar() {
    montar(ctx.raiz, html`
      ${subAbas(SUBABAS_RECEITAS, "receitas-base")}
      <p class="texto-suave est-intro">Uma <strong>receita-base</strong> é uma preparação que entra em vários produtos (massa de brigadeiro, ganache, calda, recheio…). Você cadastra uma vez, e nas receitas dos produtos basta dizer
        quanto dela vai. O estoque e o custo passam a ser calculados a partir dos ingredientes dela.</p>
      <div class="filtros-barra"><span class="espaco"></span>
        <button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Nova receita-base</button></div>
      <div class="cartao cartao--sem-margem">${lista.length ? html`<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Receita-base</th><th class="texto-direita">Cada lote rende</th><th class="texto-direita">Custo do lote</th><th class="texto-direita">Custo por ${"unidade"}</th><th>Usada em</th><th></th></tr></thead>
        <tbody>${lista.map((p) => html`<tr>
          <td><strong>${p.nome}</strong><br><small class="texto-suave">${p.linhas.length} ${p.linhas.length === 1 ? "ingrediente" : "ingredientes"}${Number(p.perda_pct) > 0 ? ` · perda ${numero(p.perda_pct)}%` : ""}</small></td>
          <td class="texto-direita">${qtdTexto(p.rendimento, p.unidade)}</td>
          <td class="texto-direita">${brl(p.custo_lote)}</td>
          <td class="texto-direita">${brl(Math.round(p.custo_unit * 100) / 100)}<br><small class="texto-suave">por ${p.unidade === "un" ? "unidade" : p.unidade}</small></td>
          <td>${p.usado_em > 0 ? `${p.usado_em} ${p.usado_em === 1 ? "produto" : "produtos"}` : html`<span class="texto-suave">nenhum ainda</span>`}</td>
          <td class="texto-direita nowrap">
            <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" data-id="${p.id}" aria-label="Editar ${p.nome}">${icone("editar", { tamanho: 17 })}</button>
            <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" data-id="${p.id}" aria-label="Excluir ${p.nome}">${icone("lixeira", { tamanho: 17 })}</button></td>
        </tr>`)}</tbody></table></div>`
        : vazio("livro", "Nenhuma receita-base ainda", "Exemplo: “Massa de brigadeiro” com leite condensado, chocolate e manteiga, que rende 30 unidades. Depois é só usá-la nos produtos.",
          html`<button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Nova receita-base</button>`)}</div>`);
  }

  async function abrirEditor(preparo = null) {
    let ings;
    try { ings = (await api.get("/ingredientes")).ingredientes; } catch (erro) { toast(erro.message, "erro"); return; }
    if (!ings.length) {
      abrirModal({
        titulo: "Cadastre os ingredientes primeiro", largura: 460,
        corpo: html`<p class="texto-suave">Uma receita-base é feita de ingredientes. Cadastre alguns na aba Ingredientes.</p>`,
        rodape: html`<button type="button" class="btn btn--suave" data-fechar>Depois</button><a href="#/estoque/ingredientes" class="btn btn--primario" data-fechar>Cadastrar ingredientes</a>`,
      });
      return;
    }
    const p = preparo ?? { nome: "", unidade: "g", rendimento: 1, perda_pct: 0, linhas: [] };
    const base = p.linhas.map((l) => linhaDoServidor(l));
    if (!base.length) base.push({ ref: "", qtd: "", medida: "" });

    const m = abrirModal({
      titulo: preparo ? `Receita-base — ${p.nome}` : "Nova receita-base", largura: 900, classe: "est-editor",
      corpo: html`<form id="form-preparo" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "nome", rotulo: "Nome", valor: p.nome, obrigatorio: true, atributos: 'maxlength="80" autofocus', placeholder: "Ex.: Massa de brigadeiro" })}
          ${campo({ nome: "unidade", rotulo: "Medida do que ela rende", tipo: "select", valor: p.unidade, opcoes: UNIDADES, ajuda: preparo ? "Não dá para trocar se já está em receitas de produtos." : "Peso (g), líquido (ml) ou unidades (ex.: 30 brigadeiros)." })}
        </div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "rendimento", rotulo: "Cada lote rende quanto?", valor: paraCampo(p.rendimento), atributos: 'inputmode="decimal"', ajuda: "Na medida escolhida ao lado. As quantidades abaixo são do lote inteiro." })}
          ${campo({ nome: "perda_pct", rotulo: "Perda de preparo (%)", valor: paraCampo(p.perda_pct), atributos: 'inputmode="decimal"', ajuda: "Quebra e sobra na panela. O sistema gasta esse percentual a mais." })}
        </div>
        <h3 class="est-editor__titulo">Ingredientes do lote</h3>
        <div data-lista="base"></div>
        <div class="est-editor__resumo" data-resumo aria-live="polite"></div>
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="button" class="btn btn--primario" data-acao="salvar-preparo">Salvar receita-base</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    const perda = () => { const n = lerNumero(form.elements.perda_pct.value); return n > 0 ? 1 + n / 100 : 1; };
    const editor = criarEditorLinhas({ ings, base, fator: () => perda(), aoMudar: resumir });
    function resumir() {
      const lote = editor.custoBase(), rend = lerNumero(form.elements.rendimento.value), un = form.elements.unidade.value;
      form.querySelector("[data-resumo]").innerHTML = lote > 0
        ? `Custo do lote: <strong>${brl(Math.round(lote))}</strong>${rend > 0 ? ` · por ${un === "un" ? "unidade" : un}: <strong>${brl(Math.round((lote / rend) * 100) / 100)}</strong>` : ""}`
        : "Escolha os ingredientes e as quantidades para ver o custo.";
    }
    editor.ligar({ base: form.querySelector('[data-lista="base"]') });
    form.addEventListener("input", () => { editor.atualizarTudo(); resumir(); });

    delegar(m.el, {
      "salvar-preparo": async (botao) => {
        let linhas;
        try { linhas = editor.linhasParaApi(); } catch (erro) { toast(erro.message, "erro"); return; }
        const d = dadosDe(form);
        await ocupado(botao, async () => {
          try {
            const corpo = { nome: d.nome, unidade: d.unidade, rendimento: paraEnvio(d.rendimento), perda_pct: paraEnvio(d.perda_pct || "0"), linhas };
            if (preparo) await api.put(`/preparos/${preparo.id}`, corpo); else await api.post("/preparos", corpo);
            toast("Receita-base salva!");
            m.fechar();
            if (await carregar()) desenhar();
          } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
        });
      },
    });
  }

  const achar = (el) => lista.find((x) => x.id === Number(el.dataset.id));
  delegar(ctx.raiz, {
    novo: () => abrirEditor(),
    editar: (el) => abrirEditor(achar(el)),
    excluir: async (el) => {
      const p = achar(el);
      if (!(await confirmar({ titulo: "Excluir receita-base", mensagem: `Excluir “${p.nome}”? Se ela está em receitas de produtos, é preciso tirá-la de lá antes.`, rotulo: "Excluir", perigo: true }))) return;
      try { await api.delete(`/preparos/${p.id}`); toast("Receita-base excluída."); if (await carregar()) desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });

  if (await carregar()) desenhar();
}
