/* ==========================================================
   COMPONENTE — formulário de produto: dados, foto (redimensionada
   no navegador) e editor de opções (tamanho, recheio, adicionais…).
   ========================================================== */
import { escapar, html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { emReais, paraCentavos } from "/src/scripts/base/formatacao.js";
import { ALERGENOS } from "/src/scripts/base/dominio.js";
import { api } from "../nucleo/api.js";
import { escolherFoto } from "./foto.js";

const novoGrupo = () => ({ nome: "", tipo: "unica", obrigatorio: false, max: "", itens: [{ nome: "", preco: "0,00" }] });

export function abrirFormProduto({ produto = null, categorias, aoSalvar }) {
  const p = produto ?? {};
  // opções em edição: preços viram texto ("12,50") enquanto o usuário digita
  const opcoes = (p.opcoes ?? []).map((g) => ({
    nome: g.nome, tipo: g.tipo, obrigatorio: g.obrigatorio, max: g.max ?? "",
    itens: g.itens.map((i) => ({ nome: i.nome, preco: emReais(i.preco) })),
  }));
  let imagemNova = null;
  let removerImagem = false;
  const galeria = [...(p.galeria ?? [])]; // endereços já salvos ou fotos novas ("data:…"), até 4

  const m = abrirModal({
    titulo: produto ? "Editar produto" : "Novo produto", largura: 780, classe: "modal-produto-form",
    corpo: html`
      <form id="form-produto" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>

        <div class="produto-form__topo">
          <div class="foto-envio">
            <div class="foto-envio__previa" data-previa></div>
            <label class="btn btn--suave btn--pequeno">${icone("upload", { tamanho: 15 })} Escolher foto
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-arquivo></label>
            <button type="button" class="link" data-tirar-foto hidden>Remover foto</button>
            <small class="texto-suave">Sem foto, aparece o ícone da categoria.</small>
          </div>
          <div>
            ${campo({ nome: "nome", rotulo: "Nome do produto", valor: p.nome ?? "", obrigatorio: true, atributos: 'maxlength="80"' })}
            <div class="grade-campos grade-campos--2">
              ${campo({ nome: "categoria_id", rotulo: "Categoria", tipo: "select", valor: p.categoria_id ?? categorias[0]?.id, obrigatorio: true,
                opcoes: categorias.map((c) => ({ valor: c.id, texto: c.nome })) })}
            </div>
          </div>
        </div>

        ${campo({ nome: "descricao", rotulo: "Descrição", tipo: "textarea", valor: p.descricao ?? "", linhas: 2, atributos: 'maxlength="400"' })}

        <div class="grade-campos grade-campos--3">
          ${campo({ nome: "preco", rotulo: "Preço base (R$)", valor: emReais(p.preco ?? 0), obrigatorio: true, mascara: "moeda" })}
          ${campo({ nome: "unidade", rotulo: "Unidade", valor: p.unidade ?? "unidade", obrigatorio: true, placeholder: "unidade, bolo 1 kg, fatia…" })}
          ${campo({ nome: "min_qtd", rotulo: "Pedido mínimo", tipo: "number", valor: p.min_qtd ?? 1, atributos: 'min="1" max="999"' })}
        </div>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "tag", rotulo: "Selo (opcional)", valor: p.tag ?? "", placeholder: "Novidade, Mais pedido…", atributos: 'maxlength="20"' })}
          ${campo({ nome: "antecedencia_horas", rotulo: "Antecedência própria (horas)", tipo: "number", valor: p.antecedencia_horas ?? "", atributos: 'min="0" max="720"',
            ajuda: "Deixe vazio para usar a antecedência padrão da loja." })}
        </div>
        <div class="grade-campos grade-campos--2">
          ${interruptor({ nome: "ativo", rotulo: "Disponível na loja", marcado: p.ativo ?? true })}
          ${interruptor({ nome: "destaque", rotulo: "Destaque", marcado: p.destaque ?? false, ajuda: "Aparece primeiro nos “queridinhos”." })}
        </div>

        <section class="editor-extras">
          <h3>Informações do produto</h3>
          <fieldset class="alergenos"><legend>Contém <small class="texto-suave">— o cliente vê na loja</small></legend>
            ${ALERGENOS.map(([id, nome]) => html`<label class="opcao-mini"><input type="checkbox" name="al_${id}" ${(p.alergenos ?? []).includes(id) && "checked"}> ${nome}</label>`)}</fieldset>
          <div class="grade-campos grade-campos--3">
            ${campo({ nome: "limite_diario", rotulo: "Limite por dia (unidades)", tipo: "number", valor: p.limite_diario ?? "", atributos: 'min="1" max="100000"', ajuda: "Vazio = sem limite. Vale por data de entrega." })}
            ${campo({ nome: "disponivel_de", rotulo: "Vender para datas a partir de", tipo: "date", valor: p.disponivel_de ?? "" })}
            ${campo({ nome: "disponivel_ate", rotulo: "…até", tipo: "date", valor: p.disponivel_ate ?? "", ajuda: "Para itens de época (Páscoa, Natal…)." })}
          </div>
          <div class="campo"><label>Fotos extras <small class="texto-suave">(até 4)</small></label>
            <div class="galeria-editor galeria-editor--produto" id="galeria-produto"></div></div>
        </section>

        <section class="editor-opcoes">
          <div class="cartao-form__cab">
            <div><h3>Opções do produto</h3><small class="texto-suave">Tamanho, recheio, cobertura, adicionais… O preço de cada opção soma ao preço base.</small></div>
            <button type="button" class="btn btn--suave btn--pequeno" data-add-grupo>${icone("mais", { tamanho: 15 })} Novo grupo</button>
          </div>
          <div id="lista-grupos"></div>
        </section>
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button>
      <button type="submit" form="form-produto" class="btn btn--primario" data-salvar>${produto ? "Salvar alterações" : "Criar produto"}</button>`,
  });

  const form = m.el.querySelector("form");
  ativarCampos(form);
  const previa = m.el.querySelector("[data-previa]");
  const botaoTirar = m.el.querySelector("[data-tirar-foto]");

  function desenharPrevia() {
    const src = imagemNova ?? (removerImagem ? null : p.imagem);
    previa.innerHTML = src ? `<img src="${escapar(src)}" alt="Prévia da foto">` : String(icone(categorias.find((c) => c.id === Number(form.elements.categoria_id.value))?.icone || "bolo", { tamanho: 44 }));
    botaoTirar.hidden = !src;
  }
  form.elements.categoria_id.addEventListener("change", desenharPrevia);
  m.el.querySelector("[data-arquivo]").addEventListener("change", async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    try { const dados = await escolherFoto(arquivo, "produto"); if (dados) { imagemNova = dados; removerImagem = false; desenharPrevia(); } }
    catch (erro) { toast(erro.message, "erro"); }
    ev.target.value = "";
  });
  botaoTirar.addEventListener("click", () => { imagemNova = null; removerImagem = true; desenharPrevia(); });
  desenharPrevia();

  /* ---------- Fotos extras ---------- */
  const caixaGaleria = m.el.querySelector("#galeria-produto");
  function desenharGaleria() {
    caixaGaleria.innerHTML = String(html`${galeria.map((src, n) => html`<figure class="galeria-editor__foto"><img src="${src}" alt="Foto extra ${n + 1}">
        <button type="button" class="btn-icone btn-icone--pequeno galeria-editor__x" data-tirar-extra="${n}" aria-label="Remover foto extra ${n + 1}">${icone("x", { tamanho: 15 })}</button></figure>`)}
      ${galeria.length < 4 && html`<label class="galeria-editor__novo">${icone("mais", { tamanho: 22 })}<span>Adicionar foto</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-arquivo-extra></label>`}`);
  }
  caixaGaleria.addEventListener("click", (ev) => {
    const x = ev.target.closest("[data-tirar-extra]");
    if (x) { galeria.splice(Number(x.dataset.tirarExtra), 1); desenharGaleria(); }
  });
  caixaGaleria.addEventListener("change", async (ev) => {
    if (!ev.target.matches("[data-arquivo-extra]")) return;
    const arquivos = [...ev.target.files].slice(0, 4 - galeria.length);
    for (const arquivo of arquivos) {
      try { const dados = await escolherFoto(arquivo, "extra"); if (dados) galeria.push(dados); } catch (erro) { toast(erro.message, "erro"); }
    }
    desenharGaleria();
  });
  desenharGaleria();

  /* ---------- Editor de opções ---------- */
  const lista = m.el.querySelector("#lista-grupos");

  function desenharGrupos() {
    lista.innerHTML = String(opcoes.length ? html`${opcoes.map((g, gi) => html`
      <div class="grupo-editor" data-g="${gi}">
        <div class="grupo-editor__cab">
          <input class="entrada" data-campo="nome" placeholder="Nome do grupo (ex.: Tamanho)" value="${g.nome}" maxlength="60" aria-label="Nome do grupo">
          <select class="entrada" data-campo="tipo" aria-label="Tipo de escolha">
            <option value="unica" ${g.tipo === "unica" && "selected"}>Escolher uma</option>
            <option value="multipla" ${g.tipo === "multipla" && "selected"}>Escolher várias</option>
          </select>
          <button type="button" class="btn-icone btn-icone--perigo btn-icone--pequeno" data-tirar-grupo="${gi}" aria-label="Remover grupo">${icone("lixeira", { tamanho: 16 })}</button>
        </div>
        <div class="linha-flex grupo-editor__regras">
          <label class="opcao-mini"><input type="checkbox" data-campo="obrigatorio" ${g.obrigatorio && "checked"}> Obrigatório</label>
          ${g.tipo === "multipla" && html`<label class="opcao-mini">Máximo <input type="number" class="entrada entrada--curta" data-campo="max" min="1" max="30" value="${g.max}" placeholder="—"></label>`}
        </div>
        <ul class="grupo-editor__itens">${g.itens.map((it, ii) => html`
          <li data-i="${ii}">
            <input class="entrada" data-item="nome" placeholder="Opção (ex.: 1,5 kg)" value="${it.nome}" maxlength="60" aria-label="Nome da opção">
            <span class="moeda"><small>+ R$</small><input class="entrada entrada--curta" data-item="preco" value="${it.preco}" inputmode="decimal" aria-label="Preço adicional"></span>
            <button type="button" class="btn-icone btn-icone--pequeno" data-tirar-item="${gi}:${ii}" aria-label="Remover opção" ${g.itens.length === 1 && "disabled"}>${icone("x", { tamanho: 15 })}</button>
          </li>`)}</ul>
        <button type="button" class="link" data-add-item="${gi}">+ Adicionar opção</button>
      </div>`)}` : html`<p class="texto-suave editor-opcoes__vazio">Nenhuma opção. O produto é vendido pelo preço base.</p>`);
  }

  m.el.querySelector("[data-add-grupo]").addEventListener("click", () => {
    if (opcoes.length >= 8) return toast("No máximo 8 grupos de opções.", "info");
    opcoes.push(novoGrupo());
    desenharGrupos();
    lista.querySelector(".grupo-editor:last-child [data-campo=nome]")?.focus();
  });

  lista.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-tirar-grupo], [data-add-item], [data-tirar-item]");
    if (!a) return;
    if (a.dataset.tirarGrupo != null) opcoes.splice(Number(a.dataset.tirarGrupo), 1);
    else if (a.dataset.addItem != null) opcoes[Number(a.dataset.addItem)].itens.push({ nome: "", preco: "0,00" });
    else { const [gi, ii] = a.dataset.tirarItem.split(":").map(Number); opcoes[gi].itens.splice(ii, 1); }
    desenharGrupos();
  });

  // digitar apenas atualiza os dados (sem redesenhar, para não perder o foco)
  lista.addEventListener("input", (ev) => {
    const g = ev.target.closest("[data-g]");
    if (!g) return;
    const grupo = opcoes[Number(g.dataset.g)];
    const campoGrupo = ev.target.dataset.campo;
    if (campoGrupo) grupo[campoGrupo] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
    const campoItem = ev.target.dataset.item;
    if (campoItem) grupo.itens[Number(ev.target.closest("[data-i]").dataset.i)][campoItem] = ev.target.value;
  });
  lista.addEventListener("change", (ev) => {
    if (ev.target.dataset.campo === "tipo") desenharGrupos(); // mostra/oculta o "Máximo"
  });
  desenharGrupos();

  /* ---------- Salvar ---------- */
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = dadosDe(form);
    const corpo = {
      ...d,
      categoria_id: Number(d.categoria_id),
      preco: paraCentavos(d.preco),
      min_qtd: Number(d.min_qtd) || 1,
      alergenos: ALERGENOS.filter(([id]) => d[`al_${id}`]).map(([id]) => id),
      galeria,
      opcoes: opcoes.map((g) => ({
        nome: g.nome, tipo: g.tipo, obrigatorio: g.obrigatorio, max: g.tipo === "multipla" ? g.max : null,
        itens: g.itens.map((i) => ({ nome: i.nome, preco: paraCentavos(i.preco) })),
      })),
    };
    if (imagemNova) corpo.imagem_nova = imagemNova;
    else if (removerImagem) corpo.imagem = null;

    await ocupado(m.el.querySelector("[data-salvar]"), async () => {
      try {
        const { produto: salvo } = produto ? await api.put(`/produtos/${produto.id}`, corpo) : await api.post("/produtos", corpo);
        toast(produto ? "Produto atualizado!" : "Produto criado!");
        m.fechar();
        aoSalvar?.(salvo);
      } catch (erro) {
        mostrarErros(form, erro, (msg) => toast(msg, "erro"));
        form.querySelector("[data-erro-geral]")?.scrollIntoView({ block: "nearest" });
      }
    });
  });

  return m;
}
