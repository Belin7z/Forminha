/* PÁGINA — categorias: criar, renomear, ativar/ocultar, reordenar e excluir */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone, ICONES_CATEGORIA } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { plural } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina, vazio } from "../componentes/pagina.js";

export async function categorias(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let lista;
  try { lista = (await api.get("/categorias")).categorias; }
  catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  function desenhar() {
    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Categorias", descricao: "Organize o cardápio. A ordem aqui é a ordem dos filtros na loja.",
        acoes: html`<button type="button" class="btn btn--primario" data-acao="nova">${icone("mais", { tamanho: 17 })} Nova categoria</button>`,
      })}
      ${lista.length ? html`<div class="cartao cartao--sem-margem"><ul class="lista-linhas">
        ${lista.map((c, i) => html`<li class="${!c.ativa && "linha-inativa"}">
          <span class="lista-linhas__ico">${icone(c.icone || "bolo", { tamanho: 22 })}</span>
          <div class="lista-linhas__texto"><strong>${c.nome}</strong><small class="texto-suave">${plural(c.produtos, "produto")}${c.ativa ? "" : " · oculta na loja"}</small></div>
          <label class="interruptor interruptor--tabela"><input type="checkbox" ${c.ativa && "checked"} data-acao="alternar" data-id="${c.id}" aria-label="Categoria visível: ${c.nome}"><span class="interruptor__trilho"></span></label>
          <button type="button" class="btn-icone btn-icone--pequeno" data-acao="subir" data-id="${c.id}" ${i === 0 && "disabled"} aria-label="Mover para cima">${icone("cima", { tamanho: 17 })}</button>
          <button type="button" class="btn-icone btn-icone--pequeno" data-acao="descer" data-id="${c.id}" ${i === lista.length - 1 && "disabled"} aria-label="Mover para baixo">${icone("baixo", { tamanho: 17 })}</button>
          <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" data-id="${c.id}" aria-label="Editar ${c.nome}">${icone("editar", { tamanho: 17 })}</button>
          <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" data-id="${c.id}" aria-label="Excluir ${c.nome}">${icone("lixeira", { tamanho: 17 })}</button>
        </li>`)}</ul></div>`
      : vazio("grade", "Nenhuma categoria ainda", "Crie categorias como Bolos, Docinhos e Presentes.")}`);
  }

  function formulario(categoria = null) {
    const c = categoria ?? {};
    const m = abrirModal({
      titulo: categoria ? "Editar categoria" : "Nova categoria", largura: 440,
      corpo: html`<form id="form-cat" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "nome", rotulo: "Nome", valor: c.nome ?? "", obrigatorio: true, atributos: 'maxlength="50" autofocus' })}
        <fieldset class="seletor-icone"><legend>Ícone (aparece na loja)</legend>
          <div class="seletor-icone__grade">${ICONES_CATEGORIA.map(([chave, nome]) => html`<label class="seletor-icone__item" title="${nome}"><input type="radio" name="icone" value="${chave}" ${(c.icone || "bolo") === chave && "checked"}><span>${icone(chave, { tamanho: 26 })}</span></label>`)}</div></fieldset>
        ${interruptor({ nome: "ativa", rotulo: "Visível na loja", marcado: c.ativa ?? true })}</form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
        <button type="submit" form="form-cat" class="btn btn--primario" data-salvar>Salvar</button>`,
    });
    const form = m.el.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(m.el.querySelector("[data-salvar]"), async () => {
        try {
          const corpo = dadosDe(form);
          lista = (categoria ? await api.put(`/categorias/${categoria.id}`, corpo) : await api.post("/categorias", corpo)).categorias;
          toast("Categoria salva!");
          m.fechar();
          desenhar();
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  const achar = (el) => lista.find((c) => c.id === Number(el.dataset.id));
  async function mover(el, delta) {
    const i = lista.findIndex((c) => c.id === Number(el.dataset.id));
    const ids = lista.map((c) => c.id);
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    try { lista = (await api.put("/categorias/ordem", { ids })).categorias; desenhar(); }
    catch (erro) { toast(erro.message, "erro"); }
  }

  delegar(ctx.raiz, {
    nova: () => formulario(),
    editar: (el) => formulario(achar(el)),
    subir: (el) => mover(el, -1),
    descer: (el) => mover(el, +1),
    excluir: async (el) => {
      const c = achar(el);
      if (!(await confirmar({ titulo: "Excluir categoria", mensagem: `Excluir “${c.nome}”? Só é possível se ela não tiver produtos.`, rotulo: "Excluir", perigo: true }))) return;
      try { lista = (await api.delete(`/categorias/${c.id}`)).categorias; toast("Categoria excluída."); desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  ctx.raiz.addEventListener("change", async (ev) => {
    const el = ev.target.closest("[data-acao=alternar]");
    if (!el) return;
    const c = achar(el);
    try { lista = (await api.put(`/categorias/${c.id}`, { nome: c.nome, icone: c.icone, ativa: el.checked })).categorias; desenhar(); }
    catch (erro) { toast(erro.message, "erro"); desenhar(); }
  });

  desenhar();
}
