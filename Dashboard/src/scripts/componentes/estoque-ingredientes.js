/* ==========================================================
   ESTOQUE — aba Ingredientes: o que tem guardado, mínimo desejado,
   como cada ingrediente é comprado (embalagem e preço), onde fica
   guardado, medidas caseiras (xícara, colher) e validade.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { brl, dataBR, emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import {
  UNIDADES, custoTexto, diasAte, embalagemTexto, fardoEconomiaTexto, fardoTexto, lerNumero, nivelEstoque, paraCampo, paraEnvio,
  qtdTexto, semAcento, situacaoAtual, temFardo, validadeTexto,
} from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, vazio } from "./pagina.js";
import { abrirLancamento } from "./estoque-lancamento.js";
import { abrirReceberCompra } from "./estoque-compra.js";
import { abrirLotes, abrirPrecos } from "./estoque-detalhes.js";
import { montarAviso } from "./estoque-aviso.js";
import { baixarCsv } from "./planilha.js";

const PERIODOS = [1, 3, 7, 14, 30, 60];
const DIAS_VALIDADE = [3, 5, 7, 10, 15, 30];
const SUGESTOES_MEDIDA = ["xícara", "colher de sopa", "colher de chá", "copo"];

export async function ingredientesEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let dados, busca = "", soBaixos = false, local = "";

  async function carregar() {
    try { dados = await api.get("/ingredientes"); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    return ctx.ativo();
  }
  const recarregar = async () => { if (await carregar()) desenhar(); };
  const locais = () => [...new Set(dados.ingredientes.map((i) => i.local).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const visiveis = () => dados.ingredientes.filter((i) =>
    (!busca || semAcento(`${i.nome} ${i.fornecedor} ${i.local}`).includes(semAcento(busca)))
    && (!soBaixos || situacaoAtual(i)[1] !== "Em dia")
    && (!local || (local === "__sem" ? !i.local : i.local === local)));

  function exportar() {
    baixarCsv("estoque.csv", [
      { titulo: "Ingrediente", valor: (i) => i.nome }, { titulo: "Medida", valor: (i) => i.unidade }, { titulo: "Em estoque", valor: (i) => i.estoque },
      { titulo: "Mínimo", valor: (i) => i.minimo }, { titulo: "Embalagem", valor: (i) => i.embalagem_nome }, { titulo: "Quantidade na embalagem", valor: (i) => i.embalagem_qtd },
      { titulo: "Preço da embalagem (R$)", valor: (i) => emReais(i.embalagem_preco) }, { titulo: "Valor em estoque (R$)", valor: (i) => emReais(i.valor_estoque) },
      { titulo: "Fardo", valor: (i) => (temFardo(i) ? i.fardo_nome : "") }, { titulo: "Embalagens por fardo", valor: (i) => (temFardo(i) ? i.fardo_qtd : "") },
      { titulo: "Preço do fardo (R$)", valor: (i) => (temFardo(i) ? emReais(i.fardo_preco) : "") },
      { titulo: "Fornecedor", valor: (i) => i.fornecedor }, { titulo: "Local", valor: (i) => i.local }, { titulo: "Próxima validade", valor: (i) => (i.proxima_validade ? dataBR(i.proxima_validade) : "") },
    ], visiveis());
  }

  function linhaHtml(i) {
    const [classe, texto] = situacaoAtual(i);
    const dias = i.proxima_validade ? diasAte(i.proxima_validade) : null;
    const economia = fardoEconomiaTexto(i);
    return html`<tr>
      <td><strong>${i.nome}</strong>${!i.ativo && html` <span class="badge badge--neutro">Desativado</span>`}
        <br><small class="texto-suave">${[i.fornecedor, i.local].filter(Boolean).join(" · ") || "sem fornecedor"}${i.receitas > 0 || i.preparos > 0 ? ` · em ${i.receitas} ${i.receitas === 1 ? "produto" : "produtos"}${i.preparos > 0 ? ` e ${i.preparos} ${i.preparos === 1 ? "receita-base" : "receitas-base"}` : ""}` : ""}</small></td>
      <td class="texto-direita"><strong class="est__qtd ${Number(i.estoque) <= 0 && "est__qtd--zero"}">${qtdTexto(i.estoque, i.unidade)}</strong>
        <span class="est-nivel" title="${texto}"><span class="est-nivel__barra est-nivel__barra--${classe.replace("badge--", "")}" style="width:${nivelEstoque(i)}%"></span></span>
        <span class="badge ${classe}">${texto}</span>
        ${dias != null && html`<br><button type="button" class="link est-validade ${dias < 0 ? "est-validade--vencida" : dias <= dados.config.dias_validade ? "est-validade--perto" : ""}" data-acao="lotes" data-id="${i.id}">${validadeTexto(dias)}</button>`}</td>
      <td class="texto-direita">${Number(i.minimo) > 0 ? qtdTexto(i.minimo, i.unidade) : "—"}</td>
      <td>${embalagemTexto(i)}<br><small class="texto-suave">${brl(i.embalagem_preco)} · ${custoTexto(i)}</small>
        ${temFardo(i) && html`<br><small class="texto-suave">${fardoTexto(i)}${economia && html` · <span class="est-economia">${economia}</span>`}</small>`}</td>
      <td class="texto-direita">${brl(i.valor_estoque)}</td>
      <td class="texto-direita nowrap">
        <button type="button" class="btn btn--suave btn--pequeno" data-acao="lancar" data-id="${i.id}">Lançar</button>
        <button type="button" class="btn-icone btn-icone--pequeno" data-acao="precos" data-id="${i.id}" aria-label="Histórico de preço de ${i.nome}" title="Histórico de preço">${icone("grafico", { tamanho: 17 })}</button>
        <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" data-id="${i.id}" aria-label="Editar ${i.nome}">${icone("editar", { tamanho: 17 })}</button>
        <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" data-id="${i.id}" aria-label="Excluir ${i.nome}">${icone("lixeira", { tamanho: 17 })}</button></td>
    </tr>`;
  }

  function desenharTabela() {
    const alvo = ctx.raiz.querySelector("#est-tabela");
    if (!alvo) return;
    const lista = visiveis();
    const agrupar = !busca && !soBaixos && !local && locais().length > 1;
    let corpo;
    if (agrupar) {
      const grupos = new Map();
      for (const i of lista) { const chave = i.local || "Sem local"; if (!grupos.has(chave)) grupos.set(chave, []); grupos.get(chave).push(i); }
      const ordem = [...grupos.keys()].sort((a, b) => (a === "Sem local") - (b === "Sem local") || a.localeCompare(b, "pt-BR"));
      corpo = ordem.map((chave) => {
        const itens = grupos.get(chave);
        return html`<tr class="tabela__grupo"><td colspan="6">${chave} <small>${itens.length} ${itens.length === 1 ? "item" : "itens"}</small></td></tr>${itens.map(linhaHtml)}`;
      });
    } else corpo = lista.map(linhaHtml);
    montar(alvo, lista.length ? html`<div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Ingrediente</th><th class="texto-direita">Em estoque</th><th class="texto-direita">Mínimo</th><th>Como compra</th><th class="texto-direita">Valor parado</th><th></th></tr></thead>
      <tbody>${corpo}</tbody></table></div>`
      : (dados.ingredientes.length
        ? vazio("busca", "Nenhum ingrediente encontrado", "Tente outro nome ou desmarque os filtros.")
        : vazio("estoque", "Nenhum ingrediente cadastrado", "Cadastre farinha, ovos, chocolate… com a quantidade que você tem e como compra (pacote, lata, caixa).",
          html`<button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo ingrediente</button>`)));
  }

  function desenhar() {
    const total = dados.ingredientes.reduce((s, i) => s + Number(i.valor_estoque), 0);
    const ls = locais();
    montar(ctx.raiz, html`
      <div class="filtros-barra">
        <label class="busca">${icone("busca", { tamanho: 17 })}<input type="search" placeholder="Buscar ingrediente" value="${busca}" data-busca aria-label="Buscar ingrediente"></label>
        ${ls.length > 0 && html`<select class="entrada entrada--auto" data-filtro-local aria-label="Filtrar por local"><option value="">Todos os locais</option>
          ${ls.map((l) => html`<option value="${l}" ${l === local && "selected"}>${l}</option>`)}<option value="__sem" ${local === "__sem" && "selected"}>Sem local</option></select>`}
        <label class="prod__opcao"><input type="checkbox" data-solo-baixos ${soBaixos && "checked"}> Só o que está acabando</label>
        <span class="espaco"></span>
        ${dados.ingredientes.length > 0 && html`<button type="button" class="btn btn--suave" data-acao="exportar">${icone("baixar", { tamanho: 16 })} Exportar</button>
          <a href="#/estoque/simulador" class="btn btn--suave">${icone("calculadora", { tamanho: 16 })} Simulador</a>
          <a href="#/estoque/contagem" class="btn btn--suave">${icone("check", { tamanho: 16 })} Fazer contagem</a>
          <button type="button" class="btn btn--suave" data-acao="receber">${icone("carrinho", { tamanho: 16 })} Receber compra</button>`}
        <button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo ingrediente</button>
      </div>
      <div class="cartao cartao--sem-margem" id="est-tabela"></div>
      ${dados.ingredientes.length > 0 && html`<p class="texto-suave est-total">${dados.ingredientes.length} ${dados.ingredientes.length === 1 ? "ingrediente" : "ingredientes"} · valor guardado em estoque: <strong>${brl(total)}</strong></p>`}

      <div class="est-duas-colunas">
        <section class="cartao est-config">
          <div class="cartao__cab"><div><h2>Como o estoque é atualizado</h2><small class="texto-suave">Vale para todos os pedidos.</small></div></div>
          <form id="form-estoque-config" novalidate>
            ${interruptor({ nome: "baixa_automatica", rotulo: "Descontar os ingredientes sozinho", marcado: dados.config.baixa_automatica,
              ajuda: "Quando o pedido entra em preparo, o que a receita usa sai do estoque (e volta se o pedido for cancelado). Desligado: você acerta tudo por contagem." })}
            <div class="grade-campos grade-campos--2">
              ${campo({ nome: "dias_previsao", rotulo: "Período da previsão de compras", tipo: "select", valor: dados.config.dias_previsao,
                opcoes: [...new Set([...PERIODOS, dados.config.dias_previsao])].sort((a, b) => a - b).map((d) => ({ valor: d, texto: d === 1 ? "Hoje e amanhã" : `Até ${d} dias à frente` })),
                ajuda: "Quantos dias à frente o sistema olha os pedidos para avisar o que vai faltar." })}
              ${campo({ nome: "dias_validade", rotulo: "Avisar validade com antecedência de", tipo: "select", valor: dados.config.dias_validade,
                opcoes: [...new Set([...DIAS_VALIDADE, dados.config.dias_validade])].sort((a, b) => a - b).map((d) => ({ valor: d, texto: `${d} dias` })),
                ajuda: "Lotes que vencem dentro desse prazo aparecem em destaque." })}
            </div>
            <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
          </form>
        </section>
        <section class="cartao est-config" id="est-aviso"></section>
      </div>`);
    desenharTabela();
    montarAviso(ctx.raiz.querySelector("#est-aviso"));
  }

  /* ---------- Cadastro e edição ---------- */
  function formulario(ing = null) {
    const i = ing ?? {};
    let medidas = (i.medidas ?? []).map((x) => ({ nome: x.nome, qtd: paraCampo(x.qtd) }));
    const m = abrirModal({
      titulo: ing ? "Editar ingrediente" : "Novo ingrediente", largura: 680,
      corpo: html`<form id="form-ingrediente" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "nome", rotulo: "Nome", valor: i.nome ?? "", obrigatorio: true, atributos: 'maxlength="80" autofocus', placeholder: "Ex.: Leite condensado" })}
          ${campo({ nome: "unidade", rotulo: "Medida usada nas receitas", tipo: "select", valor: i.unidade ?? "g", opcoes: UNIDADES,
            ajuda: ing ? "Não dá para trocar depois que há receita ou histórico." : "Use gramas para pesar (1 kg = 1000 g)." })}
        </div>
        <div class="grade-campos grade-campos--2">
          ${ing
            ? html`<div class="campo"><label>Em estoque agora</label><p class="est-fixo"><strong>${qtdTexto(i.estoque, i.unidade)}</strong></p><small class="campo__ajuda">Para mudar, use o botão “Lançar” na lista.</small></div>`
            : campo({ nome: "estoque", rotulo: "Quanto você tem agora?", valor: "0", atributos: 'inputmode="decimal"', ajuda: "Na medida escolhida ao lado." })}
          ${campo({ nome: "minimo", rotulo: "Estoque mínimo", valor: paraCampo(i.minimo ?? 0), atributos: 'inputmode="decimal"', ajuda: "Abaixo disso o sistema avisa para comprar. 0 = sem aviso." })}
        </div>
        ${!ing && campo({ nome: "validade", rotulo: "Validade do que você tem agora (opcional)", tipo: "date", valor: "", ajuda: "Se souber, o sistema acompanha o vencimento." })}
        <fieldset class="est-embalagem">
          <legend>Como você compra</legend>
          <div class="grade-campos grade-campos--3">
            ${campo({ nome: "embalagem_nome", rotulo: "Embalagem", valor: i.embalagem_nome ?? "pacote", atributos: 'maxlength="30"', placeholder: "pacote, lata, caixa…" })}
            ${campo({ nome: "embalagem_qtd", rotulo: "Quanto vem nela?", valor: paraCampo(i.embalagem_qtd ?? 1), atributos: 'inputmode="decimal"', ajuda: "Na medida escolhida." })}
            ${campo({ nome: "embalagem_preco", rotulo: "Preço da embalagem (R$)", valor: emReais(i.embalagem_preco ?? 0), mascara: "moeda" })}
          </div>
          <p class="est-previa" data-previa></p>
        </fieldset>
        <details class="est-embalagem est-fardo" ${temFardo(i) && "open"}>
          <summary>Também compra em fardo ou caixa maior? <span class="texto-suave">(opcional)</span></summary>
          <p class="texto-suave est-medidas__dica">Ex.: o pacote de farinha custa R$ 5,00, mas o fardo com 10 pacotes sai por R$ 42,00 — mais barato no atacado.</p>
          <div class="grade-campos grade-campos--3">
            ${campo({ nome: "fardo_nome", rotulo: "Como chama", valor: i.fardo_nome ?? "fardo", atributos: 'maxlength="30"', placeholder: "fardo, caixa, engradado…" })}
            ${campo({ nome: "fardo_qtd", rotulo: `Quantas ${i.embalagem_nome || "embalagens"} tem`, valor: paraCampo(i.fardo_qtd ?? 0), atributos: 'inputmode="decimal"' })}
            ${campo({ nome: "fardo_preco", rotulo: "Preço do fardo (R$)", valor: emReais(i.fardo_preco ?? 0), mascara: "moeda" })}
          </div>
          <p class="est-previa" data-previa-fardo></p>
        </details>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "fornecedor", rotulo: "Onde compra (opcional)", valor: i.fornecedor ?? "", atributos: 'maxlength="80" list="lista-fornecedores"', placeholder: "Ex.: Atacadão, Mercado do Zé" })}
          ${campo({ nome: "local", rotulo: "Onde fica guardado (opcional)", valor: i.local ?? "", atributos: 'maxlength="40" list="lista-locais"', placeholder: "Ex.: Despensa, Geladeira, Freezer", ajuda: "Ajuda a organizar a contagem do estoque." })}
        </div>
        <datalist id="lista-fornecedores">${[...new Set(dados.ingredientes.map((x) => x.fornecedor).filter(Boolean))].map((f) => html`<option value="${f}">`)}</datalist>
        <datalist id="lista-locais">${locais().map((l) => html`<option value="${l}">`)}</datalist>
        <fieldset class="est-embalagem">
          <legend>Medidas caseiras (opcional)</legend>
          <p class="texto-suave est-medidas__dica">Quanto vale uma xícara, uma colher… deste ingrediente na medida escolhida acima. Nas receitas você poderá digitar “2 xícaras” e o sistema converte.</p>
          <div id="medidas-lista"></div>
          <div class="est-medidas__acoes">
            <button type="button" class="btn btn--suave btn--pequeno" data-acao="mais-medida">${icone("mais", { tamanho: 15 })} Adicionar medida</button>
            ${SUGESTOES_MEDIDA.map((s) => html`<button type="button" class="est-chip" data-acao="medida-sugerida" data-nome="${s}">${s}</button>`)}
          </div>
        </fieldset>
        ${interruptor({ nome: "ativo", rotulo: "Em uso", marcado: i.ativo ?? true, ajuda: "Desligue para esconder da lista de compras sem apagar o histórico." })}
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-ingrediente" class="btn btn--primario" data-salvar>Salvar ingrediente</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    const lista = form.querySelector("#medidas-lista");

    const lerMedidas = () => [...lista.querySelectorAll("[data-medida]")].map((r) => ({ nome: r.querySelector('[data-campo="nome"]').value, qtd: r.querySelector('[data-campo="qtd"]').value }));
    function desenharMedidas() {
      const un = form.elements.unidade.value;
      montar(lista, html`${medidas.map((x, k) => html`<div class="est-medida" data-medida>
        <input class="entrada" data-campo="nome" maxlength="20" placeholder="Ex.: colher de sopa" value="${x.nome}" aria-label="Nome da medida">
        <span class="est-linha__qtd"><input class="entrada" data-campo="qtd" inputmode="decimal" placeholder="Quanto vale" value="${x.qtd}" aria-label="Quanto vale"><b>${un}</b></span>
        <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="tirar-medida" data-i="${k}" aria-label="Tirar medida">${icone("lixeira", { tamanho: 17 })}</button></div>`)}`);
    }
    desenharMedidas();

    const previa = form.querySelector("[data-previa]");
    const previaFardo = form.querySelector("[data-previa-fardo]");
    const atualizar = () => {
      const d = dadosDe(form);
      const qtd = lerNumero(d.embalagem_qtd), preco = paraCentavos(d.embalagem_preco);
      previa.textContent = qtd > 0 && preco > 0 ? `Custo: ${custoTexto({ custo_unit: preco / qtd, unidade: d.unidade })}.` : "";
      const fQtd = lerNumero(d.fardo_qtd), fPreco = paraCentavos(d.fardo_preco);
      if (fQtd > 0 && fPreco > 0 && qtd > 0 && preco > 0) {
        const custoFardoUnit = fPreco / (fQtd * qtd), custoAvulsoUnit = preco / qtd;
        const economia = Math.round((1 - custoFardoUnit / custoAvulsoUnit) * 1000) / 10;
        previaFardo.textContent = `Custo no fardo: ${custoTexto({ custo_unit: custoFardoUnit, unidade: d.unidade })}` + (economia > 0 ? ` · economize ${economia}%` : economia < 0 ? " · mais caro que a embalagem avulsa" : "");
      } else previaFardo.textContent = "";
    };
    form.addEventListener("input", atualizar);
    form.addEventListener("change", (ev) => { atualizar(); if (ev.target.name === "unidade") { medidas = lerMedidas(); desenharMedidas(); } });
    atualizar();

    delegar(m.el, {
      "mais-medida": () => { medidas = lerMedidas(); medidas.push({ nome: "", qtd: "" }); desenharMedidas(); lista.querySelector("[data-medida]:last-child input")?.focus(); },
      "medida-sugerida": (el) => { medidas = lerMedidas().filter((x) => x.nome || x.qtd); if (!medidas.some((x) => x.nome === el.dataset.nome)) medidas.push({ nome: el.dataset.nome, qtd: "" }); desenharMedidas(); lista.querySelector("[data-medida]:last-child [data-campo=qtd]")?.focus(); },
      "tirar-medida": (el) => { medidas = lerMedidas(); medidas.splice(Number(el.dataset.i), 1); desenharMedidas(); },
    });

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      const corpo = { ...d, estoque: paraEnvio(d.estoque), minimo: paraEnvio(d.minimo), embalagem_qtd: paraEnvio(d.embalagem_qtd), embalagem_preco: paraCentavos(d.embalagem_preco),
        fardo_qtd: paraEnvio(d.fardo_qtd), fardo_preco: paraCentavos(d.fardo_preco),
        validade: d.validade || undefined, medidas: lerMedidas().filter((x) => x.nome.trim() || String(x.qtd).trim()).map((x) => ({ nome: x.nome, qtd: paraEnvio(x.qtd) })) };
      if (ing) delete corpo.estoque;
      await ocupado(m.el.querySelector("[data-salvar]"), async () => {
        try {
          if (ing) await api.put(`/ingredientes/${ing.id}`, corpo); else await api.post("/ingredientes", corpo);
          toast("Ingrediente salvo!");
          m.fechar();
          await recarregar();
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  const achar = (el) => dados.ingredientes.find((i) => i.id === Number(el.dataset.id));
  delegar(ctx.raiz, {
    novo: () => formulario(),
    editar: (el) => formulario(achar(el)),
    lancar: (el) => abrirLancamento(achar(el), { aoSalvar: recarregar }),
    lotes: (el) => abrirLotes(achar(el), { aoMudar: recarregar }),
    precos: (el) => abrirPrecos(achar(el)),
    receber: () => abrirReceberCompra({ aoSalvar: recarregar }),
    exportar,
    excluir: async (el) => {
      const i = achar(el);
      if (!(await confirmar({ titulo: "Excluir ingrediente", mensagem: `Excluir ${i.nome} e todo o histórico dele? Se ele está em alguma receita, é preciso tirá-lo de lá antes. Para só esconder, edite e desligue “Em uso”.`, rotulo: "Excluir", perigo: true }))) return;
      try { await api.delete(`/ingredientes/${i.id}`); toast("Ingrediente excluído."); await recarregar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });

  ctx.raiz.addEventListener("input", (ev) => {
    if (ev.target.matches("[data-busca]")) { busca = ev.target.value; desenharTabela(); }
  });
  ctx.raiz.addEventListener("change", (ev) => {
    if (ev.target.matches("[data-solo-baixos]")) { soBaixos = ev.target.checked; desenharTabela(); }
    if (ev.target.matches("[data-filtro-local]")) { local = ev.target.value; desenharTabela(); }
  });
  ctx.raiz.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "form-estoque-config") return;
    ev.preventDefault();
    const d = dadosDe(ev.target);
    await ocupado(ev.target.querySelector("[type=submit]"), async () => {
      try {
        dados.config = (await api.put("/estoque/config", d)).config;
        toast("Configuração salva!");
      } catch (erro) { toast(erro.message, "erro"); }
    });
  });

  await recarregar();
}
