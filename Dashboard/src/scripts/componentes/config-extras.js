/* ==========================================================
   COMPONENTE — abas extras das Configurações:
   imagens do site (logo, foto de destaque, galeria), perguntas
   frequentes e textos legais (privacidade e termos).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { campo } from "/src/scripts/base/formularios.js";
import { api } from "../nucleo/api.js";
import { escolherFoto } from "./foto.js";

const LIMITE_GALERIA = 8;

/* ---------- Imagens ---------- */
const bloco = (campoNome, url, titulo, ajuda) => html`
  <section class="cartao">
    <div class="cartao__cab"><div><h2>${titulo}</h2><small class="texto-suave">${ajuda}</small></div></div>
    <div class="imagem-envio" data-campo="${campoNome}">
      <div class="imagem-envio__previa ${campoNome === "logo" && "imagem-envio__previa--logo"}">${url ? html`<img src="${url}" alt="${titulo}">` : icone("imagem", { tamanho: 30 })}</div>
      <div class="imagem-envio__acoes">
        <label class="btn btn--suave btn--pequeno">${icone("upload", { tamanho: 15 })} ${url ? "Trocar imagem" : "Enviar imagem"}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-arquivo></label>
        ${url && html`<button type="button" class="btn btn--suave btn--pequeno" data-ajustar>Ajustar</button>`}
        ${url && html`<button type="button" class="link" data-remover>Remover</button>`}
      </div>
    </div>
  </section>`;

export function paginaImagens(cfg) {
  const galeria = cfg.galeria?.itens ?? [];
  return html`
    <details class="dicas-foto cartao">
      <summary>Dicas para fotos que vendem</summary>
      <ul>
        <li><strong>Luz do dia:</strong> fotografe perto de uma janela, sem flash. É o que mais melhora a foto.</li>
        <li><strong>Fundo simples:</strong> uma mesa clara, papel ou pano liso. Tire da frente o que não for o doce.</li>
        <li><strong>Chegue perto:</strong> o doce deve ocupar bem o quadro. Foto de longe fica pequena no site.</li>
        <li><strong>Celular firme:</strong> apoie os cotovelos e toque na tela para focar no doce antes de tirar.</li>
        <li><strong>Formato:</strong> a foto de destaque e a galeria são quadradas, a da seção “Sobre nós” é vertical e os produtos são na horizontal. O assistente já recorta na proporção certa, e o botão “Ajustar” reenquadra, gira ou clareia uma foto que já está no site.</li>
        <li><strong>Primeiras fotos a tirar:</strong> o produto mais vendido, um bolo inteiro e cortado, os brigadeiros em fileira e uma foto sua trabalhando.</li>
      </ul>
    </details>
    ${bloco("logo", cfg.loja.logo, "Logo da loja", "Aparece no topo do site. Prefira PNG com fundo transparente, a partir de 300 px de largura. Sem logo, o site usa um monograma com o nome.")}
    ${bloco("hero_imagem", cfg.textos.hero_imagem, "Foto de destaque", "A foto grande da página inicial (quadrada). Sem ela, aparecem as fotos dos produtos ou as iniciais da loja.")}
    ${bloco("sobre_imagem", cfg.textos.sobre_imagem, "Foto da seção Sobre nós", "Aparece na seção “Sobre nós” (você, a equipe ou a cozinha), quando você escreve o texto dela.")}
    <section class="cartao">
      <div class="cartao__cab"><div><h2>Galeria</h2><small class="texto-suave">Até ${LIMITE_GALERIA} fotos dos seus doces, mostradas na página inicial.</small></div></div>
      <div class="galeria-editor">
        ${galeria.map((url, i) => html`<figure class="galeria-editor__foto"><img src="${url}" alt="Foto ${i + 1} da galeria">
          <button type="button" class="btn-icone btn-icone--pequeno galeria-editor__ajustar" data-ajustar-galeria="${i}" aria-label="Ajustar a foto ${i + 1}" title="Ajustar">${icone("editar", { tamanho: 14 })}</button>
          <button type="button" class="btn-icone btn-icone--pequeno galeria-editor__x" data-remover-galeria="${i}" aria-label="Remover a foto ${i + 1}">${icone("x", { tamanho: 15 })}</button></figure>`)}
        ${galeria.length < LIMITE_GALERIA && html`<label class="galeria-editor__novo">${icone("mais", { tamanho: 24 })}<span>Adicionar foto</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-arquivo-galeria></label>`}
      </div>
    </section>`;
}

const apagar = (url) => (url ? api.post("/site/imagem/apagar", { url }).catch(() => {}) : null);

export function ligarImagens(ctx, cfg) {
  const recarregar = () => ctx.ir("/configuracoes/imagens");
  const salvarCampo = async (campoNome, url) => {
    const [secao, atual] = campoNome === "logo" ? ["loja", cfg.loja] : ["textos", cfg.textos];
    await api.put(`/configuracoes/${secao}`, { ...atual, [campoNome]: url });
  };

  ctx.raiz.addEventListener("change", async (ev) => {
    const arquivo = ev.target.files?.[0];
    if (!arquivo) return;
    const alvo = ev.target.closest(".imagem-envio");
    const ehGaleria = ev.target.matches("[data-arquivo-galeria]");
    if (!alvo && !ehGaleria) return;
    try {
      const campoNome = alvo?.dataset.campo;
      const tipo = ehGaleria ? "galeria" : { logo: "logo", hero_imagem: "hero", sobre_imagem: "sobre" }[campoNome];
      const dados = await escolherFoto(arquivo, tipo); // abre o assistente de enquadramento
      ev.target.value = "";
      if (!dados) return;
      const { url } = await api.post("/site/imagem", { imagem: dados });
      if (ehGaleria) {
        await api.put("/configuracoes/galeria", { itens: [...(cfg.galeria?.itens ?? []), url] });
      } else {
        const antiga = campoNome === "logo" ? cfg.loja.logo : cfg.textos[campoNome];
        await salvarCampo(campoNome, url);
        await apagar(antiga);
      }
      toast("Imagem salva!");
      recarregar();
    } catch (erro) { toast(erro.message, "erro"); }
  });

  ctx.raiz.addEventListener("click", async (ev) => {
    const remover = ev.target.closest("[data-remover]");
    const removerGaleria = ev.target.closest("[data-remover-galeria]");
    const ajustar = ev.target.closest("[data-ajustar]");
    const ajustarGaleria = ev.target.closest("[data-ajustar-galeria]");
    try {
      if (ajustar) {
        // reenquadra a foto que já está no site: sobe a nova e apaga a antiga
        const campoNome = ajustar.closest(".imagem-envio").dataset.campo;
        const antiga = campoNome === "logo" ? cfg.loja.logo : cfg.textos[campoNome];
        const dados = await escolherFoto(antiga, { logo: "logo", hero_imagem: "hero", sobre_imagem: "sobre" }[campoNome]);
        if (!dados) return;
        const { url } = await api.post("/site/imagem", { imagem: dados });
        await salvarCampo(campoNome, url);
        await apagar(antiga);
        toast("Foto ajustada!");
        recarregar();
      } else if (ajustarGaleria) {
        const itens = [...(cfg.galeria?.itens ?? [])];
        const i = Number(ajustarGaleria.dataset.ajustarGaleria);
        const dados = await escolherFoto(itens[i], "galeria");
        if (!dados) return;
        const antiga = itens[i];
        itens[i] = (await api.post("/site/imagem", { imagem: dados })).url;
        await api.put("/configuracoes/galeria", { itens });
        await apagar(antiga);
        toast("Foto ajustada!");
        recarregar();
      } else if (remover) {
        const campoNome = remover.closest(".imagem-envio").dataset.campo;
        const antiga = campoNome === "logo" ? cfg.loja.logo : cfg.textos[campoNome];
        await salvarCampo(campoNome, "");
        await apagar(antiga);
        toast("Imagem removida.", "info");
        recarregar();
      } else if (removerGaleria) {
        const itens = [...(cfg.galeria?.itens ?? [])];
        const [tirada] = itens.splice(Number(removerGaleria.dataset.removerGaleria), 1);
        await api.put("/configuracoes/galeria", { itens });
        await apagar(tirada);
        toast("Foto removida.", "info");
        recarregar();
      }
    } catch (erro) { toast(erro.message, "erro"); }
  });
}

/* ---------- Perguntas frequentes ---------- */
export function paginaPerguntas() {
  return html`<section class="cartao">
    <div class="cartao__cab"><div><h2>Perguntas frequentes</h2>
      <small class="texto-suave">Aparecem na página inicial. Se você não cadastrar nenhuma, o site mostra respostas automáticas com os dados da loja.</small></div></div>
    <div class="form-erro" data-erro-geral hidden></div>
    <div id="faq-editor"></div>
    <div class="cartao__rodape">
      <button type="button" class="btn btn--suave" data-faq-limpar>Usar as respostas automáticas</button>
      <button type="button" class="btn btn--primario" data-faq-salvar>Salvar</button>
    </div>
  </section>`;
}

export function ligarPerguntas(ctx, cfg) {
  let itens = (cfg.faq?.itens ?? []).map((q) => ({ p: q.p, r: q.r }));
  const raiz = ctx.raiz.querySelector("#faq-editor");
  const desenhar = () => montar(raiz, html`
    ${itens.length === 0 && html`<p class="texto-suave">Nenhuma pergunta cadastrada — o site usa as respostas automáticas.</p>`}
    ${itens.map((q, i) => html`
      <div class="faq-editor__item">
        <div class="linha-flex"><strong>Pergunta ${i + 1}</strong><span class="espaco"></span>
          <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-remover="${i}" aria-label="Remover a pergunta ${i + 1}">${icone("lixeira", { tamanho: 16 })}</button></div>
        <div class="campo"><label>Pergunta</label><input class="entrada" data-p="${i}" value="${q.p}" maxlength="160"></div>
        <div class="campo"><label>Resposta</label><textarea class="entrada" data-r="${i}" rows="3" maxlength="800">${q.r}</textarea></div>
      </div>`)}
    ${itens.length < 12 && html`<button type="button" class="btn btn--contorno btn--pequeno" data-adicionar>${icone("mais", { tamanho: 16 })} Adicionar pergunta</button>`}`);
  desenhar();

  ctx.raiz.addEventListener("input", (ev) => {
    const i = ev.target.dataset.p ?? ev.target.dataset.r;
    if (i === undefined) return;
    if (ev.target.dataset.p !== undefined) itens[Number(i)].p = ev.target.value; else itens[Number(i)].r = ev.target.value;
  });
  ctx.raiz.addEventListener("click", async (ev) => {
    const botao = ev.target.closest("button");
    if (!botao) return;
    if (botao.dataset.adicionar !== undefined) { itens.push({ p: "", r: "" }); desenhar(); }
    else if (botao.dataset.remover !== undefined) { itens.splice(Number(botao.dataset.remover), 1); desenhar(); }
    else if (botao.dataset.faqLimpar !== undefined || botao.dataset.faqSalvar !== undefined) {
      const limpar = botao.dataset.faqLimpar !== undefined;
      await ocupado(botao, async () => {
        try {
          await api.put("/configuracoes/faq", { itens: limpar ? [] : itens.filter((q) => q.p.trim() || q.r.trim()) });
          toast(limpar ? "Voltou para as respostas automáticas." : "Perguntas salvas!");
          if (limpar) { itens = []; desenhar(); }
        } catch (erro) { toast(erro.message, "erro"); }
      });
    }
  });
}

/* ---------- Textos legais ---------- */
export function paginaLegal(cfg) {
  const l = cfg.legal ?? {};
  return html`<form class="cartao" id="f-legal" novalidate>
    <div class="cartao__cab"><div><h2>Privacidade e termos de uso</h2>
      <small class="texto-suave">Mostrados em “Privacidade” e “Termos de uso”, no rodapé do site. Deixe em branco para usar o texto padrão.</small></div></div>
    <div class="form-erro" data-erro-geral hidden></div>
    <div class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>O texto padrão é um modelo geral. Peça para um advogado revisar antes de divulgar a loja.</span></div>
    <p class="texto-suave" style="margin:.8rem 0">Dica: uma linha que começa com <code># </code> vira título (ex.: <code># Seus direitos</code>). Linhas em branco separam parágrafos.</p>
    ${campo({ nome: "privacidade", rotulo: "Política de privacidade", tipo: "textarea", valor: l.privacidade ?? "", linhas: 12, atributos: 'maxlength="12000"' })}
    ${campo({ nome: "termos", rotulo: "Termos de uso", tipo: "textarea", valor: l.termos ?? "", linhas: 12, atributos: 'maxlength="12000"' })}
    <div class="cartao__rodape"><button type="submit" class="btn btn--primario">Salvar</button></div>
  </form>`;
}
