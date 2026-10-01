/* ==========================================================
   COMPONENTE — Configurações > Aparência.
   A dona escolhe um tema pronto (ou "Minhas cores", com 3 cores)
   e o estilo das letras; a mini-loja ao lado mostra na hora como
   fica. Nada muda no site até ela clicar em "Salvar aparência".
   ========================================================== */
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { mostrarErros } from "/src/scripts/base/formularios.js";
import { iniciais } from "/src/scripts/base/formatacao.js";
import { FONTES, MODELOS, TEMAS, aplicarAparencia, gerarTokens, normalizarAparencia } from "/src/scripts/base/tema.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";

const URL_LOJA = String(window.CONFIG_APP?.urlLoja ?? "").replace(/\/+$/, "");

const CORES = [
  ["marca", "Cor da sua marca", "Dá o clima da loja: fundos suaves, realces e etiquetas."],
  ["escura", "Cor escura", "Títulos, botão principal e rodapé. Se ficar clara demais para ler, o sistema escurece sozinho."],
  ["detalhe", "Cor dos detalhes", "Filetes, estrelas e pequenos enfeites. Dourado combina com quase tudo."],
];

const estiloDe = (tokens) => Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(";");

/** Amostra de cores de um tema (4 bolinhas: fundo, realce, escura e detalhe). */
function amostra(tokens) {
  return html`<span class="ap-amostra">${["--marca-200", "--marca-destaque", "--escura", "--detalhe"].map((k) => html`<i style="background:${tokens[k]}"></i>`)}</span>`;
}

export function cartaoTema(t, atual) {
  const tokens = gerarTokens({ tema: t.id });
  return html`
    <label class="ap-tema">
      <input type="radio" name="tema" value="${t.id}" ${atual === t.id && "checked"}>
      <span class="ap-tema__corpo" style="background:${tokens["--marca-50"]};border-color:${tokens["--borda"]}">
        ${amostra(tokens)}
        <strong style="font-family:${FONTES[t.fonte].titulo};color:${tokens["--escura"]}">${t.nome}</strong>
        <small>${t.descricao}</small>
        <span class="ap-tema__check">${icone("check", { tamanho: 14 })}</span>
      </span>
    </label>`;
}

/** Desenho simples de cada modelo da página inicial (só formas, nas cores do tema). */
const desenhoDoModelo = (id) => html`<span class="ap-modelo__desenho ap-modelo__desenho--${id}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;

/** Mini-loja da prévia: usa o nome, a logo e os textos reais da loja, no modelo escolhido. */
export function miniLoja(cfg, modelo = normalizarAparencia(cfg.aparencia).modelo) {
  const nome = cfg.loja?.nome || "Minha loja";
  const titulo = cfg.textos?.hero_titulo || nome; // como na loja: sem título, o topo mostra o nome
  return html`
    <div class="mini mini--${modelo}" data-previa aria-hidden="true">
      <div class="mini__topo">
        ${cfg.loja?.logo ? html`<span class="mini__logo mini__logo--img"><img src="${cfg.loja.logo}" alt=""></span>` : html`<span class="mini__logo">${iniciais(nome)}</span>`}
        <strong class="mini__nome">${nome}</strong>
        <span class="mini__sacola">${icone("sacola", { tamanho: 13 })} 2</span>
      </div>
      <div class="mini__hero">
        <p class="mini__script">${cfg.loja?.slogan || "Pedidos online"}</p>
        <p class="mini__titulo">${titulo}</p>
        <p class="mini__sub">Faça seu pedido online, com entrega ou retirada.</p>
        <span class="mini__btn">Ver cardápio</span><span class="mini__btn mini__btn--contorno">WhatsApp</span>
      </div>
      <div class="mini__cards">
        <div class="mini__card"><i class="mini__foto"></i><b>Bolo de Ninho</b><small>bolo 1 kg</small><span><em>R$ 120,00</em><u>Mais pedido</u></span></div>
        <div class="mini__card"><i class="mini__foto mini__foto--2"></i><b>Brigadeiro</b><small>unidade · mín. 10</small><span><em>R$ 3,50</em><span class="mini__estrelas">★★★★★</span></span></div>
      </div>
      <div class="mini__aviso">Pedidos com <b>24 h</b> de antecedência. <u>Saiba mais</u></div>
      <div class="mini__rodape"><strong>${nome}</strong><small>Rodapé da loja · © 2026</small></div>
    </div>`;
}

/** As 4 famílias de letra carregadas, para os cartões e a prévia aparecerem com a letra certa. */
export function carregarFontesDaPrevia() {
  for (const [id, f] of Object.entries(FONTES)) {
    if (document.getElementById(`fonte-previa-${id}`)) continue;
    const link = document.createElement("link");
    link.id = `fonte-previa-${id}`; link.rel = "stylesheet"; link.href = f.url;
    document.head.append(link);
  }
}

export function paginaAparencia(cfg) {
  const a = normalizarAparencia(cfg.aparencia);
  return html`
    <form class="cartao" id="f-aparencia" novalidate>
      <div class="cartao__cab"><h2>Aparência da loja</h2></div>
      <p class="texto-suave">Escolha um tema pronto ou use as cores da sua marca. A prévia mostra como a loja fica — nada muda no site até você salvar.</p>
      <div class="form-erro" data-erro-geral hidden></div>
      <div class="ap">
        <div class="ap__opcoes">
          <h3 class="ap__passo"><span>1</span> Tema</h3>
          <div class="ap-temas" role="radiogroup" aria-label="Tema">
            ${TEMAS.map((t) => cartaoTema(t, a.tema))}
            <label class="ap-tema ap-tema--minhas">
              <input type="radio" name="tema" value="personalizado" ${a.tema === "personalizado" && "checked"}>
              <span class="ap-tema__corpo">
                <span class="ap-amostra ap-amostra--arco"><i></i><i></i><i></i><i></i></span>
                <strong>Minhas cores</strong>
                <small>Use as cores da sua marca</small>
                <span class="ap-tema__check">${icone("check", { tamanho: 14 })}</span>
              </span>
            </label>
          </div>

          <div class="ap-cores" data-cores ${a.tema !== "personalizado" && "hidden"}>
            ${CORES.map(([k, rotulo, ajuda]) => html`
              <label class="ap-cor">
                <input type="color" data-cor="${k}" value="${a.cores[k]}" aria-describedby="ajuda-cor-${k}">
                <span class="ap-cor__texto"><strong>${rotulo}</strong><small id="ajuda-cor-${k}">${ajuda}</small></span>
                <code data-hex="${k}">${a.cores[k]}</code>
              </label>`)}
            <p class="ap-dica">${icone("info", { tamanho: 14 })} Não precisa acertar o tom exato: o sistema cria os tons claros e escuros a partir dessas cores, sempre com texto fácil de ler.</p>
          </div>

          <h3 class="ap__passo"><span>2</span> Estilo das letras</h3>
          <div class="ap-fontes" role="radiogroup" aria-label="Estilo das letras">
            ${Object.entries(FONTES).map(([id, f]) => html`
              <label class="ap-fonte">
                <input type="radio" name="fonte" value="${id}" ${a.fonte === id && "checked"}>
                <span class="ap-fonte__corpo">
                  <span class="ap-fonte__amostra" style="font-family:${f.titulo};font-size-adjust:${f.ajusteTitulo}">${cfg.loja?.nome || "Minha Doceria"}</span>
                  <span class="ap-fonte__texto" style="font-family:${f.corpo};font-size-adjust:${f.ajusteCorpo}"><strong>${f.nome}</strong> · ${f.descricao}</span>
                </span>
              </label>`)}
          </div>
          <h3 class="ap__passo"><span>3</span> Modelo da página inicial</h3>
          <div class="ap-modelos" role="radiogroup" aria-label="Modelo da página inicial">
            ${Object.entries(MODELOS).map(([id, mo]) => html`
              <label class="ap-modelo">
                <input type="radio" name="modelo" value="${id}" ${a.modelo === id && "checked"}>
                <span class="ap-modelo__corpo">
                  ${desenhoDoModelo(id)}
                  <strong>${mo.nome}</strong>
                  <small>${mo.descricao}</small>
                </span>
              </label>`)}
          </div>
          <p class="texto-suave ap-logo-dica">${icone("imagem", { tamanho: 14 })} A logo e as fotos da página inicial ficam em <a class="link" href="#/configuracoes/imagens">Imagens</a>.</p>
        </div>

        <aside class="ap__previa">
          <p class="ap__previa-rotulo">${icone("olho", { tamanho: 14 })} Prévia</p>
          ${miniLoja(cfg)}
        </aside>
      </div>
      <div class="cartao__rodape">
        ${URL_LOJA && html`<a class="btn btn--contorno" href="${URL_LOJA}" target="_blank" rel="noopener">${icone("navegar", { tamanho: 16 })} Ver a loja</a>`}
        <button type="submit" class="btn btn--primario">Salvar aparência</button>
      </div>
    </form>`;
}

export function ligarAparencia(ctx, cfg, aoSalvar) {
  const form = ctx.raiz.querySelector("#f-aparencia");
  const previa = form.querySelector("[data-previa]");
  const blocoCores = form.querySelector("[data-cores]");
  const inicial = normalizarAparencia(cfg.aparencia);
  const cores = { ...inicial.cores };

  carregarFontesDaPrevia();

  const escolha = () => {
    const tema = form.querySelector('[name="tema"]:checked')?.value ?? inicial.tema;
    const fonte = form.querySelector('[name="fonte"]:checked')?.value ?? inicial.fonte;
    const modelo = form.querySelector('[name="modelo"]:checked')?.value ?? inicial.modelo;
    return tema === "personalizado" ? { tema, fonte, modelo, cores: { ...cores } } : { tema, fonte, modelo };
  };

  const atualizarPrevia = () => {
    const a = escolha();
    for (const [k, v] of Object.entries(gerarTokens(a))) previa.style.setProperty(k, v);
    previa.className = `mini mini--${a.modelo}`;
    blocoCores.hidden = a.tema !== "personalizado";
  };

  form.addEventListener("change", (ev) => {
    const t = ev.target;
    // ao passar para "Minhas cores", começa das cores do tema que estava escolhido (não do zero)
    if (t.name === "tema" && t.value === "personalizado") {
      const anterior = normalizarAparencia({ tema: form.dataset.ultimoTema ?? inicial.tema });
      if (inicial.tema !== "personalizado" || form.dataset.ultimoTema) {
        Object.assign(cores, anterior.cores);
        for (const k of Object.keys(cores)) {
          form.querySelector(`[data-cor="${k}"]`).value = cores[k];
          form.querySelector(`[data-hex="${k}"]`).textContent = cores[k];
        }
      }
    }
    if (t.name === "tema" && t.value !== "personalizado") form.dataset.ultimoTema = t.value;
    atualizarPrevia();
  });
  // cores: a prévia acompanha enquanto ela arrasta no seletor
  form.addEventListener("input", (ev) => {
    const k = ev.target.dataset.cor;
    if (!k) return;
    cores[k] = ev.target.value.toLowerCase();
    form.querySelector(`[data-hex="${k}"]`).textContent = cores[k];
    atualizarPrevia();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        const { configuracoes } = await api.put("/configuracoes/aparencia", escolha());
        aplicarAparencia(configuracoes.aparencia); // o próprio painel já troca de cor
        estado.aparencia = configuracoes.aparencia;
        aoSalvar(configuracoes);
        toast("Aparência salva! A loja já abre com o novo visual.");
      } catch (erro) { mostrarErros(form, erro, (m) => toast(m, "erro")); }
    });
  });

  atualizarPrevia();
}
