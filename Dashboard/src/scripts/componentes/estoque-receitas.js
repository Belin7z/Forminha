/* ==========================================================
   ESTOQUE — aba Receitas: quanto de cada ingrediente (ou receita-
   base) cada produto leva, com acréscimos por opção (tamanho,
   recheio…), perda de preparo, custo, margem e quantas unidades o
   estoque de hoje permite fazer.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos } from "/src/scripts/base/formularios.js";
import { brl } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { lerNumero, numero, paraCampo, paraEnvio, semAcento } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, subAbas, vazio } from "./pagina.js";
import { chaveOpcao, criarEditorLinhas, linhaDoServidor } from "./estoque-linhas.js";

const FILTROS = [["todos", "Todos"], ["sem", "Sem receita"], ["com", "Com receita"]];
export const SUBABAS_RECEITAS = [["receitas", "Receitas dos produtos", "#/estoque/receitas"], ["receitas-base", "Receitas-base", "#/estoque/receitas-base"]];

export async function receitasEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let produtos, busca = "", filtro = "todos";

  async function carregar() {
    try { produtos = (await api.get("/receitas")).produtos; }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }

  const visiveis = () => produtos.filter((p) =>
    (!busca || semAcento(`${p.nome} ${p.categoria}`).includes(semAcento(busca)))
    && (filtro === "todos" || (filtro === "com") === p.tem_receita));

  function desenharTabela() {
    const alvo = ctx.raiz.querySelector("#est-tabela");
    if (!alvo) return;
    const lista = visiveis();
    montar(alvo, lista.length ? html`<div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Produto</th><th>Receita</th><th class="texto-direita">Custo por unidade</th><th class="texto-direita">Preço</th><th class="texto-direita">Margem</th><th class="texto-direita">Dá para fazer</th><th></th></tr></thead>
      <tbody>${lista.map((p) => html`<tr>
        <td><strong>${p.nome}</strong>${!p.ativo && html` <span class="badge badge--neutro">Fora do cardápio</span>`}<br><small class="texto-suave">${p.categoria}</small></td>
        <td>${p.tem_receita
          ? html`<span class="badge badge--sucesso">${p.linhas} ${p.linhas === 1 ? "linha" : "linhas"}</span>${(Number(p.rendimento) !== 1 || Number(p.perda_pct) > 0) && html`<br><small class="texto-suave">${Number(p.rendimento) !== 1 ? `rende ${numero(p.rendimento)}` : ""}${Number(p.rendimento) !== 1 && Number(p.perda_pct) > 0 ? " · " : ""}${Number(p.perda_pct) > 0 ? `perda ${numero(p.perda_pct)}%` : ""}</small>`}`
          : html`<span class="badge badge--neutro">Sem receita</span>`}</td>
        <td class="texto-direita">${p.custo_unit != null ? brl(p.custo_unit) : "—"}</td>
        <td class="texto-direita">${brl(p.preco)}</td>
        <td class="texto-direita">${p.margem != null
          ? html`<strong class="${p.margem_pct != null && p.margem_pct < 0 ? "est__qtd--zero" : p.margem_pct != null && p.margem_pct < 30 ? "est__margem--baixa" : ""}">${brl(p.margem)}</strong>${p.margem_pct != null && html`<br><small class="texto-suave">${numero(p.margem_pct)}%</small>`}`
          : "—"}</td>
        <td class="texto-direita">${p.pode_fazer != null
          ? html`<strong class="${p.pode_fazer === 0 && "est__qtd--zero"}">${numero(p.pode_fazer)}</strong><br><small class="texto-suave">limita: ${p.limitante}</small>`
          : "—"}</td>
        <td class="texto-direita nowrap"><button type="button" class="btn btn--suave btn--pequeno" data-acao="editar" data-id="${p.id}">${p.tem_receita ? "Editar receita" : html`${icone("mais", { tamanho: 14 })} Criar receita`}</button></td>
      </tr>`)}</tbody></table></div>`
      : vazio("livro", "Nenhum produto encontrado", "Tente outro nome ou outro filtro."));
  }

  function desenhar() {
    const com = produtos.filter((p) => p.tem_receita).length;
    montar(ctx.raiz, html`
      ${subAbas(SUBABAS_RECEITAS, "receitas")}
      <p class="texto-suave est-intro">Diga quanto de cada ingrediente vai em cada produto. Com isso o sistema desconta o estoque sozinho quando o pedido entra em preparo, prevê o que vai faltar e calcula o custo e a margem.
        <strong>${com} de ${produtos.length}</strong> produtos já têm receita.</p>
      <div class="filtros-barra">
        <label class="busca">${icone("busca", { tamanho: 17 })}<input type="search" placeholder="Buscar produto" value="${busca}" data-busca aria-label="Buscar produto"></label>
        <div class="segmentos" role="group" aria-label="Filtro">${FILTROS.map(([id, texto]) => html`<button type="button" class="segmento ${id === filtro && "segmento--ativo"}" data-acao="filtro" data-filtro="${id}" aria-pressed="${String(id === filtro)}">${texto}</button>`)}</div>
      </div>
      <div class="cartao cartao--sem-margem" id="est-tabela"></div>
      <p class="texto-suave est-total">O custo considera só a receita-base do produto (sem acréscimos de tamanho ou opções) e o último preço pago por embalagem.</p>`);
    desenharTabela();
  }

  /* ---------- Editor da receita de um produto ---------- */
  async function abrirEditor(pid) {
    let rec, ings, preparos;
    try {
      const [r, i, pp] = await Promise.all([api.get(`/receitas/${pid}`), api.get("/ingredientes"), api.get("/preparos")]);
      rec = r; ings = i.ingredientes; preparos = pp.preparos;
    } catch (erro) { toast(erro.message, "erro"); return; }

    if (!ings.length) {
      return abrirModal({
        titulo: "Cadastre os ingredientes primeiro", largura: 460,
        corpo: html`<p class="texto-suave">Para montar a receita de <strong>${rec.produto.nome}</strong>, o sistema precisa saber quais ingredientes você tem. Cadastre alguns na aba Ingredientes.</p>`,
        rodape: html`<button type="button" class="btn btn--suave" data-fechar>Depois</button>
          <a href="#/estoque/ingredientes" class="btn btn--primario" data-fechar>Cadastrar ingredientes</a>`,
      });
    }

    const pr = rec.produto;
    const opcoes = [];
    for (const g of pr.opcoes ?? []) for (const it of g.itens ?? []) opcoes.push({ chave: chaveOpcao(g.nome, it.nome), rotulo: `${g.nome} — ${it.nome}` });
    const extras = rec.linhas.filter((l) => l.opcao_grupo).map((l) => {
      const linha = linhaDoServidor(l);
      if (!opcoes.some((o) => o.chave === linha.opcao)) opcoes.push({ chave: linha.opcao, rotulo: `${l.opcao_grupo} — ${l.opcao_item} (não existe mais)` });
      return linha;
    });
    const base = rec.linhas.filter((l) => !l.opcao_grupo).map(linhaDoServidor);
    if (!base.length) base.push({ ref: "", qtd: "", medida: "" });

    const m = abrirModal({
      titulo: `Receita — ${pr.nome}`, largura: 900, classe: "est-editor",
      corpo: html`<div id="editor-receita">
        <div class="est-editor__topo"><p class="texto-suave">Preço de venda: <strong>${brl(pr.preco)}</strong> por <strong>${pr.unidade}</strong>. As quantidades usam a medida de cada ingrediente (g, ml ou un) ou uma medida caseira que você cadastrou nele (xícara, colher…).</p></div>
        <section>
          <h3 class="est-editor__titulo">Ingredientes da receita</h3>
          <div class="grade-campos grade-campos--2">
            <div class="campo"><label for="rend-receita">Esta receita rende quantas unidades vendidas?</label>
              <input id="rend-receita" class="entrada" data-campo="rendimento" inputmode="decimal" value="${paraCampo(rec.rendimento)}">
              <small class="campo__ajuda">Ex.: a massa rende 30 brigadeiros → informe 30 e as quantidades abaixo da receita inteira. Para produto feito um a um, deixe 1.</small></div>
            <div class="campo"><label for="perda-receita">Perda de preparo (%)</label>
              <input id="perda-receita" class="entrada" data-campo="perda" inputmode="decimal" value="${paraCampo(rec.perda_pct)}">
              <small class="campo__ajuda">Quebra, sobra na tigela, massa que gruda… O sistema gasta esse percentual a mais de tudo. 0 = sem perda.</small></div>
          </div>
          <div data-lista="base"></div>
        </section>
        ${opcoes.length > 0 && html`<section class="est-editor__extras">
          <h3 class="est-editor__titulo">Acréscimos por opção escolhida</h3>
          <p class="texto-suave">Quando o cliente escolhe uma opção (um tamanho maior, um recheio…), some estas quantidades <strong>por unidade</strong> à receita.</p>
          <div data-lista="extras"></div>
        </section>`}
        <div class="est-editor__resumo" data-resumo aria-live="polite"></div>
      </div>`,
      rodape: html`${rec.linhas.length > 0 && html`<button type="button" class="btn btn--perigo-suave" data-acao="remover-receita">Remover receita</button><span class="espaco"></span>`}
        <button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="button" class="btn btn--primario" data-acao="salvar-receita">Salvar receita</button>`,
    });
    const corpo = m.el.querySelector("#editor-receita");
    const rendCampo = corpo.querySelector('[data-campo="rendimento"]'), perdaCampo = corpo.querySelector('[data-campo="perda"]');
    const rend = () => { const n = lerNumero(rendCampo.value); return n > 0 ? n : 1; };
    const perda = () => { const n = lerNumero(perdaCampo.value); return n > 0 ? 1 + n / 100 : 1; };

    const editor = criarEditorLinhas({
      ings, preparos, opcoes, base, extras,
      fator: (tipo) => (tipo === "base" ? perda() / rend() : perda()),
      aoMudar: resumir,
    });
    function resumir() {
      const custo = editor.custoBase();
      const margem = pr.preco - custo;
      corpo.querySelector("[data-resumo]").innerHTML = custo > 0
        ? `Custo de <strong>1 unidade</strong> (receita-base): <strong>${brl(Math.round(custo))}</strong> · preço ${brl(pr.preco)} · margem <strong>${brl(Math.round(margem))}</strong> (${numero(pr.preco > 0 ? Math.round((margem * 1000) / pr.preco) / 10 : 0)}%)`
        : "Escolha os ingredientes e as quantidades para ver o custo e a margem.";
    }
    editor.ligar({ base: corpo.querySelector('[data-lista="base"]'), extras: corpo.querySelector('[data-lista="extras"]') });
    ativarCampos(corpo);
    for (const c of [rendCampo, perdaCampo]) c.addEventListener("input", () => { editor.atualizarTudo(); resumir(); });

    delegar(m.el, {
      "remover-receita": async () => {
        if (!(await confirmar({ titulo: "Remover receita", mensagem: `Remover a receita de ${pr.nome}? Os ingredientes continuam cadastrados; o produto só deixa de descontar estoque e de entrar na previsão.`, rotulo: "Remover", perigo: true }))) return;
        try { await api.put(`/receitas/${pid}`, { linhas: [] }); toast("Receita removida."); m.fechar(); if (await carregar()) desenhar(); }
        catch (erro) { toast(erro.message, "erro"); }
      },
      "salvar-receita": async (botao) => {
        let linhas;
        try { linhas = editor.linhasParaApi(); } catch (erro) { toast(erro.message, "erro"); return; }
        if (!linhas.length && !rec.linhas.length) { toast("Adicione pelo menos um ingrediente.", "erro"); return; }
        await ocupado(botao, async () => {
          try {
            const r = await api.put(`/receitas/${pid}`, { rendimento: paraEnvio(rendCampo.value), perda_pct: paraEnvio(perdaCampo.value || "0"), linhas });
            toast(r.removida ? "Receita removida." : "Receita salva!");
            m.fechar();
            if (await carregar()) desenhar();
          } catch (erro) { toast(erro.message, "erro"); }
        });
      },
    });
  }

  delegar(ctx.raiz, {
    editar: (el) => abrirEditor(Number(el.dataset.id)),
    filtro: (el) => { filtro = el.dataset.filtro; desenhar(); },
  });
  ctx.raiz.addEventListener("input", (ev) => {
    if (ev.target.matches("[data-busca]")) { busca = ev.target.value; desenharTabela(); }
  });

  if (await carregar()) desenhar();
}
