/* TELA — Lojas: todas as lojas no Supabase/Vercel (criar à mão, convite, pagamento online, domínio, atualizar banco, reativar, excluir) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { montarDominio } from "/src/scripts/base/dns.js";
import { montarEnderecoNaForminha } from "./dominio-forminha.js";
import { baixarJson } from "./configuracoes.js";
import { api, aviso, dorme, pode } from "../nucleo.js";

const ETAPAS = {
  migrada: ["Mudou para o banco único", "neutro"], mudando: ["Mudando de banco", "info"],
  pronta: ["Pronta", "sucesso"], criando: ["Criando o banco", "info"], tabelas: ["Preparando", "info"], sites: ["Falta publicar", "aviso"],
  pausada: ["Pausada", "aviso"], reativando: ["Reativando", "info"], problema: ["Com problema", "perigo"],
};
const incompleta = (l) => ["criando", "tabelas", "sites"].includes(l.etapa);

function cartaoLoja(l, eu) {
  const suporte = pode(eu, "lojas.suporte");
  const [rotulo, tom] = ETAPAS[l.etapa] ?? ["—", "neutro"];
  return html`
    <article class="loja" data-ref="${l.ref}">
      <header class="loja__cab">
        <div>
          <h2 class="loja__nome">${l.nome}</h2>
          <button type="button" class="codigo" data-acao="copiar-codigo" data-codigo="${l.codigo}" title="Copiar o código">${l.codigo} ${icone("copiar", { tamanho: 13 })}</button>
        </div>
        <span class="selo selo--${l.suspensa ? "perigo" : tom}">${l.suspensa ? "Suspensa" : rotulo}${l.etapa === "tabelas" && l.total ? ` · ${l.feitas} de ${l.total}` : ""}</span>
      </header>
      ${l.atualizar && html`<p class="loja__nota">${icone("atualizar", { tamanho: 14 })} Tem atualização do banco para esta loja.</p>`}
      ${l.dominio && !l.dominio_ativo && html`<p class="loja__nota">${icone("globo", { tamanho: 14 })} ${l.dominio}: aguardando o DNS.</p>`}
      ${l.etapa === "migrada" && html`<p class="loja__nota">${icone("checkCirculo", { tamanho: 14 })} Os dados e os endereços já estão no banco único. Este é o banco antigo, guardado: pode excluir quando quiser.</p>`}
      ${l.banco_unico && l.ref === "banco-unico" && html`<p class="loja__nota">${icone("alerta", { tamanho: 14 })} O banco único está ${l.etapa === "pausada" ? "pausado" : "indisponível"}: as lojas dele voltam quando ele voltar.</p>`}
      ${(l.loja || l.painel) && l.etapa !== "migrada" && html`<div class="loja__links">
        ${l.loja && html`<a href="${l.loja}" target="_blank" rel="noopener" class="link">${icone("home", { tamanho: 15 })} ${l.loja.replace("https://", "")}</a>`}
        ${l.painel && html`<a href="${l.painel}" target="_blank" rel="noopener" class="link">${icone("grade", { tamanho: 15 })} ${l.painel.replace("https://", "")}</a>`}
      </div>`}
      <footer class="loja__acoes">
        ${suporte && incompleta(l) && html`<button type="button" class="btn btn--primario btn--pequeno" data-acao="continuar">Continuar criação</button>`}
        ${suporte && l.etapa === "pronta" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="convite">${icone("email", { tamanho: 15 })} Convite da dona</button>`}
        ${suporte && l.etapa === "pronta" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="pagamento">${icone("cartao", { tamanho: 15 })} Pagamento online</button>`}
        ${suporte && l.etapa === "pronta" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="dominio">${icone("globo", { tamanho: 15 })} Domínio</button>`}
        ${suporte && l.etapa === "pronta" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="copia" title="Baixar os dados da loja num arquivo">${icone("baixar", { tamanho: 15 })} Cópia</button>`}
        ${suporte && l.atualizar && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="atualizar">${icone("atualizar", { tamanho: 15 })} Atualizar banco</button>`}
        ${suporte && l.etapa === "pausada" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="reativar">${icone("atualizar", { tamanho: 15 })} Reativar</button>`}
        ${eu.quem?.tipo === "dono" && eu.recursos?.banco_unico && !l.banco_unico && ["pronta", "mudando"].includes(l.etapa) && html`
          <button type="button" class="btn btn--${l.etapa === "mudando" ? "primario" : "suave"} btn--pequeno" data-acao="mudar">${icone("atualizar", { tamanho: 15 })} ${l.etapa === "mudando" ? "Continuar a mudança" : "Mudar para o banco único"}</button>`}
        ${pode(eu, "lojas.excluir") && l.ref !== "banco-unico" && html`<button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao="excluir">${icone("lixeira", { tamanho: 15 })} ${l.etapa === "migrada" ? "Excluir o banco antigo" : "Excluir"}</button>`}
      </footer>
    </article>`;
}

/** Convite pronto para mandar: link, copiar, WhatsApp e e-mail. */
export function painelConvite({ link, email, loja, urlLoja, urlPainel, vale_dias: dias = 7, telefone = "" }) {
  const mensagem = `Olá! Sua loja "${loja}" está pronta. Crie seu acesso ao painel por este link (vale ${dias} dias e só funciona uma vez): ${link}`;
  return html`
    <div class="convite-pronto">
      <h3>${icone("checkCirculo", { tamanho: 20 })} Tudo pronto!</h3>
      ${(urlLoja || urlPainel) && html`<p class="texto-suave">Loja: <a class="link" href="${urlLoja}" target="_blank" rel="noopener">${String(urlLoja ?? "").replace("https://", "")}</a> · Painel: <a class="link" href="${urlPainel}" target="_blank" rel="noopener">${String(urlPainel ?? "").replace("https://", "")}</a></p>`}
      <p>Convite para <strong>${email}</strong>:</p>
      <div class="convite-pronto__link"><code>${link}</code></div>
      <div class="convite-pronto__botoes">
        <button type="button" class="btn btn--primario btn--pequeno" data-copiar="${link}">${icone("copiar", { tamanho: 15 })} Copiar link</button>
        <a class="btn btn--whats btn--pequeno" href="https://wa.me/${telefone ? `55${telefone}` : ""}?text=${encodeURIComponent(mensagem)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
        <a class="btn btn--suave btn--pequeno" href="mailto:${email}?subject=${encodeURIComponent(`Sua loja ${loja} está pronta`)}&body=${encodeURIComponent(mensagem)}">${icone("email", { tamanho: 15 })} E-mail</a>
      </div>
    </div>`;
}

/** Pedidos de fora da tela (busca rápida): destacar uma loja ou já abrir "Loja sem cobrança". */
export const pedidoLojas = { destacar: null, nova: false };

export async function telaLojas(conteiner, eu) {
  document.title = "Lojas — Forminha";
  let lojas = [];
  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Lojas</h1><p class="texto-suave" data-resumo>Carregando…</p></div>
      ${pode(eu, "lojas.criar") && html`<button type="button" class="btn btn--suave" data-acao="nova">${icone("mais", { tamanho: 17 })} Loja sem cobrança</button>`}
    </div>
    <section class="lojas" data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>`);

  async function carregar() {
    const lista = conteiner.querySelector("[data-lista]");
    if (!lista) return;
    try { lojas = (await api("GET", "lojas")).lojas; }
    catch (erro) {
      montar(lista, html`<div class="vazio"><span class="vazio__ico">${icone("alerta", { tamanho: 34 })}</span><h3>Não consegui carregar as lojas</h3><p>${erro.message}</p></div>`);
      conteiner.querySelector("[data-resumo]").textContent = "";
      return;
    }
    const prontas = lojas.filter((l) => l.etapa === "pronta").length;
    const total = lojas.filter((l) => l.etapa !== "migrada").length; // o banco antigo de uma loja que mudou não conta
    conteiner.querySelector("[data-resumo]").textContent = total
      ? `${total} ${total === 1 ? "loja" : "lojas"} · ${prontas} ${prontas === 1 ? "pronta" : "prontas"}` : "Nenhuma loja ainda.";
    montar(lista, lojas.length ? html`${lojas.map((l) => cartaoLoja(l, eu))}` : html`
      <div class="vazio">
        <span class="vazio__ico">${icone("cupcake", { tamanho: 38 })}</span>
        <h3>Nenhuma loja ainda</h3>
        <p>As lojas aparecem aqui quando uma cliente paga. Para criar uma loja sem cobrança (teste ou cortesia), use o botão acima.</p>
      </div>`);
  }

  conteiner.addEventListener("click", async (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo || !conteiner.contains(alvo)) return;
    const acao = alvo.dataset.acao;
    if (acao === "nova") return novaLoja(carregar);
    if (acao === "copiar-codigo") { await copiar(alvo.dataset.codigo); return toast("Código copiado."); }
    const loja = lojas.find((l) => l.ref === alvo.closest("[data-ref]")?.dataset.ref);
    if (!loja) return;
    if (acao === "continuar") return acompanharCriacao(loja, "", carregar);
    if (acao === "convite") return novoConvite(loja);
    if (acao === "pagamento") return pagamentoOnline(loja);
    if (acao === "dominio") return dominioDaLoja(loja, carregar);
    if (acao === "copia") {
      return ocupado(alvo, async () => {
        try {
          const copia = await api("GET", `lojas/${loja.ref}/backup`);
          baixarJson(`forminha-loja-${loja.codigo}-${copia.gerado_em.slice(0, 10)}.json`, copia);
          toast("Cópia da loja baixada.");
        } catch (erro) { toast(erro.message, "erro"); }
      });
    }
    if (acao === "atualizar") return atualizarBanco(loja, carregar);
    if (acao === "mudar") return mudarDeBanco(loja, carregar);
    if (acao === "reativar") {
      await ocupado(alvo, async () => {
        try { await api("POST", `lojas/${loja.ref}/reativar`, {}); toast("Reativando a loja. Leva 1 a 2 minutos."); await carregar(); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
    if (acao === "excluir") return excluir(loja, carregar);
  });
  await carregar();
  if (pedidoLojas.nova && pode(eu, "lojas.criar")) novaLoja(carregar);
  if (pedidoLojas.destacar) {
    const cartao = conteiner.querySelector(`[data-ref="${pedidoLojas.destacar}"]`);
    if (cartao) {
      cartao.scrollIntoView({ block: "center" });
      cartao.classList.add("loja--destaque");
      setTimeout(() => cartao.classList.remove("loja--destaque"), 2600);
    }
  }
  Object.assign(pedidoLojas, { destacar: null, nova: false });
}

/* ---------- loja sem cobrança: formulário e passo a passo ---------- */
function novaLoja(depois) {
  const modal = abrirModal({
    titulo: "Loja sem cobrança", largura: 520,
    corpo: html`
      <form id="form-nova" novalidate>
        <p class="texto-suave">Para teste ou cortesia. Para vender, cadastre a cliente na aba Clientes: a loja é criada sozinha quando ela paga.</p>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "nome", rotulo: "Nome da loja", obrigatorio: true, placeholder: "Ex.: Doce da Ana", atributos: 'maxlength="60" autofocus' })}
        ${campo({ nome: "email", rotulo: "E-mail da dona da loja", tipo: "email", obrigatorio: true, ajuda: "Só esse e-mail consegue usar o convite." })}
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-nova" class="btn btn--primario">Criar loja</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(modal.el.querySelector('[form="form-nova"]'), async () => {
      try {
        const criada = await api("POST", "lojas", dadosDe(form));
        modal.fechar();
        acompanharCriacao(criada, criada.email, depois);
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}

const PASSOS = [
  ["banco", "Criar o banco da loja"],
  ["espera", "Esperar o banco ficar pronto", "Leva de 1 a 3 minutos."],
  ["tabelas", "Preparar as tabelas"],
  ["sites", "Publicar a loja e o painel"],
  ["convite", "Gerar o convite da dona"],
];

function acompanharCriacao(loja, email, depois) {
  const modal = abrirModal({
    titulo: `Criando “${loja.nome}”`, largura: 560,
    corpo: html`
      <p class="texto-suave">Código da loja: <strong class="codigo codigo--texto">${loja.codigo}</strong>. Pode deixar esta janela aberta: tudo acontece sozinho.</p>
      <ol class="passos-criacao">${PASSOS.map(([id, titulo, dica]) => html`
        <li data-passo="${id}"><span class="passos-criacao__marca"></span><div><strong>${titulo}</strong><small data-detalhe>${dica ?? ""}</small></div></li>`)}</ol>
      <div data-final></div>`,
    aoFechar: () => { modal.parado = true; depois?.(); },
  });
  const passo = (id, situacao, detalhe) => {
    const li = modal.el.querySelector(`[data-passo="${id}"]`);
    li.className = `passo--${situacao}`;
    if (detalhe !== undefined) li.querySelector("[data-detalhe]").textContent = detalhe;
  };
  const final = modal.el.querySelector("[data-final]");

  async function rodar() {
    montar(final, "");
    try {
      passo("banco", "feito");
      let estado = await api("GET", `lojas/${loja.ref}`);
      passo("espera", "fazendo", "Leva de 1 a 3 minutos.");
      for (let i = 0; estado.etapa === "criando" || estado.etapa === "reativando"; i++) {
        if (modal.parado) return;
        if (i > 90) throw new Error("O banco está demorando mais que o normal. Feche e use “Continuar criação” daqui a pouco.");
        await dorme(4000);
        estado = await api("GET", `lojas/${loja.ref}`);
      }
      if (estado.etapa === "pausada" || estado.etapa === "problema") throw new Error(estado.etapa === "pausada" ? "A loja está pausada: reative antes de continuar." : "O Supabase informou um problema neste banco.");
      passo("espera", "feito", "Banco pronto.");
      passo("tabelas", "fazendo");
      while (estado.etapa === "tabelas") {
        if (modal.parado) return;
        passo("tabelas", "fazendo", estado.total ? `${estado.feitas ?? 0} de ${estado.total}` : "");
        estado = await api("POST", `lojas/${loja.ref}/preparar`, email ? { email } : {});
      }
      passo("tabelas", "feito", "Tudo pronto e a loja zerada.");
      // banco único: a loja não ganha sites próprios, só os endereços dela nos sites de todas as lojas
      const unico = loja.tipo === "unico" || loja.banco_unico || estado.banco_unico;
      passo("sites", "fazendo", unico ? "Ligando os endereços da loja…" : "Criando os 2 sites na Vercel…");
      const sites = estado.etapa === "sites" ? await api("POST", `lojas/${loja.ref}/publicar`, {}) : estado;
      passo("sites", "feito", unico ? "Endereços prontos — abrem em alguns segundos." : "Publicados — ficam no ar em 1 a 2 minutos.");
      passo("convite", "fazendo");
      const convite = await api("POST", `lojas/${loja.ref}/convite`, email ? { email } : {});
      passo("convite", "feito", `Para ${convite.email}.`);
      montar(final, painelConvite({ ...convite, loja: loja.nome, urlLoja: sites.loja, urlPainel: sites.painel }));
      toast(`“${loja.nome}” está pronta!`);
    } catch (erro) {
      modal.el.querySelectorAll(".passo--fazendo").forEach((li) => { li.className = "passo--erro"; });
      const pedeEmail = erro.campos?.email;
      montar(final, html`
        ${aviso("perigo", erro.message)}
        ${pedeEmail && html`<form class="passos-email" novalidate>${campo({ nome: "email", rotulo: "E-mail da dona da loja", tipo: "email", obrigatorio: true })}</form>`}
        <div class="passos-criacao__botoes"><button type="button" class="btn btn--primario" data-de-novo>Tentar de novo</button></div>`);
      final.querySelector("[data-de-novo]").addEventListener("click", () => {
        const campoEmail = final.querySelector('[name="email"]');
        if (campoEmail) email = campoEmail.value.trim();
        rodar();
      });
    }
  }
  rodar();
}

async function novoConvite(loja) {
  const modal = abrirModal({ titulo: `Convite — ${loja.nome}`, largura: 560, corpo: html`<div class="carregando-pagina"><div class="spinner"></div></div>` });
  try {
    const convite = await api("POST", `lojas/${loja.ref}/convite`, {});
    montar(modal.corpo, html`<p class="texto-suave">Um link novo (os anteriores que não foram usados continuam valendo até vencer).</p>${painelConvite({ ...convite, loja: loja.nome, urlLoja: loja.loja, urlPainel: loja.painel })}`);
  } catch (erro) { montar(modal.corpo, aviso("perigo", erro.message)); }
}

/** Liga o PIX automático e o cartão da loja com o Access Token do Mercado Pago da doceria. */
function pagamentoOnline(loja) {
  const modal = abrirModal({
    titulo: `Pagamento online — ${loja.nome}`, largura: 500,
    corpo: html`
      <form id="form-pagamento" class="form-empilhado" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "token", rotulo: "Access Token do Mercado Pago da doceria", tipo: "password", obrigatorio: true, placeholder: "APP_USR-…", atributos: 'autocomplete="off" spellcheck="false" autofocus' })}
        <p class="form-empilhado__dica">A Central instala o PIX automático e o cartão na loja. A chave fica guardada só para as funções de pagamento (cifrada) e não aparece de novo.</p>
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-pagamento" class="btn btn--primario">Conectar</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(modal.el.querySelector('[form="form-pagamento"]'), async () => {
      try {
        const r = await api("POST", `lojas/${loja.ref}/pagamento`, dadosDe(form));
        modal.fechar();
        toast(`Pagamento online ligado${r.conta ? ` (${r.conta})` : ""}.`);
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}

/**
 * Endereços da loja: o da Forminha (anadoces.forminha.com.br, se o domínio da Forminha estiver ligado) e o
 * domínio próprio (ex.: suadoceria.com.br) — este com a mesma tela que a dona vê no painel dela.
 */
async function dominioDaLoja(loja, depois) {
  let mudou = false;
  const aoMudar = () => { mudou = true; };
  const modal = abrirModal({
    titulo: `Domínio — ${loja.nome}`, largura: 640, corpo: html`<div class="carregando-pagina"><div class="spinner"></div></div>`,
    aoFechar: () => { if (mudou) depois(); },
  });
  const rota = (base) => (metodo, acao, corpo) => api(metodo, `lojas/${loja.ref}/${base}${acao ? `/${acao}` : ""}`, corpo);
  try {
    const [sub, proprio] = await Promise.all([rota("subdominio")("GET").catch(() => ({ raiz: null })), rota("dominio")("GET")]);
    montar(modal.corpo, html`
      <section class="dominio-secao" data-sub hidden></section>
      <section class="dominio-secao">${sub.raiz && html`<h3 class="dominio-secao__titulo">Domínio próprio</h3>`}<div data-proprio></div></section>`);
    // o endereço na Forminha mudou: a parte do domínio próprio é desenhada de novo (ela diz onde a loja abre hoje)
    const redesenharProprio = async () => {
      const lugar = modal.corpo.querySelector("[data-proprio]");
      const novo = document.createElement("div");
      novo.setAttribute("data-proprio", "");
      try { const info = await rota("dominio")("GET"); lugar.replaceWith(novo); montarDominio(novo, info, { chamar: rota("dominio"), aoMudar }); }
      catch { /* fica como estava */ }
    };
    montarEnderecoNaForminha(modal.corpo.querySelector("[data-sub]"), sub, { chamar: rota("subdominio"), aoMudar: () => { aoMudar(); redesenharProprio(); } });
    montarDominio(modal.corpo.querySelector("[data-proprio]"), proprio, { chamar: rota("dominio"), aoMudar });
  } catch (erro) { montar(modal.corpo, aviso("perigo", erro.message)); }
}

/**
 * Muda uma loja de projeto próprio para o banco único: confirma com o código e vai por etapas, mostrando o progresso
 * (preparar, dados, fotos, endereços). Dá para fechar e continuar depois.
 */
function mudarDeBanco(loja, depois) {
  const continuando = loja.etapa === "mudando";
  const modal = abrirModal({
    titulo: `Mudar “${loja.nome}” para o banco único`, largura: 580, aoFechar: () => { modal.parado = true; depois(); },
    corpo: html`
      <div data-mudanca>
        ${!continuando && html`
          <p>A loja passa a morar no banco único, com <strong>tudo</strong>: pedidos, clientes, cardápio, estoque, os logins (com as mesmas senhas) e as fotos. Os endereços continuam os mesmos.</p>
          <ul class="mudanca__lista">
            <li>Enquanto muda (alguns minutos), a loja mostra “Estamos atualizando a loja” e não recebe pedidos.</li>
            <li>Os 2 sites antigos são apagados; os endereços passam para os sites do banco único.</li>
            <li>O banco antigo fica guardado: você exclui depois, quando quiser.</li>
            <li>Pagamento online e WhatsApp precisam ser conectados de novo (as chaves não saem do projeto antigo).</li>
          </ul>
          <form id="form-mudar" novalidate>
            <div class="form-erro" data-erro-geral hidden></div>
            ${campo({ nome: "codigo", rotulo: `Para confirmar, digite o código da loja (${loja.codigo})`, obrigatorio: true, atributos: 'autocomplete="off" spellcheck="false"' })}
          </form>`}
        <p class="mudanca__progresso" data-progresso ${!continuando && "hidden"}>${continuando ? "Continuando a mudança…" : ""}</p>
        <div data-final></div>
      </div>`,
    rodape: continuando ? "" : html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-mudar" class="btn btn--primario">Mudar agora</button>`,
  });
  const progresso = modal.el.querySelector("[data-progresso]");
  const final = modal.el.querySelector("[data-final]");
  const TEXTO = {
    dados: (r) => `Trazendo os dados: ${r.tabelas.feitas} de ${r.tabelas.total} tabelas…`,
    fotos: (r) => `Copiando as fotos: ${r.fotos.feitas} de ${r.fotos.total}…`,
    enderecos: () => "Passando os endereços para os sites do banco único…",
  };

  async function rodar(codigo) {
    progresso.hidden = false;
    montar(final, "");
    try {
      let r;
      for (let i = 0; i < 500; i++) {
        if (modal.parado) return;
        r = await api("POST", `lojas/${loja.ref}/mudar`, codigo ? { codigo } : {});
        codigo = null;
        if (r.etapa === "pronta") break;
        progresso.textContent = (TEXTO[r.etapa] ?? (() => "Mudando…"))(r);
      }
      progresso.hidden = true;
      montar(final, html`
        ${aviso("sucesso", html`Pronto: “${loja.nome}” já está no banco único${r.loja ? html` — abre em <a class="link" href="${r.loja}" target="_blank" rel="noopener">${r.loja.replace("https://", "")}</a>` : ""}.`)}
        ${r.fotos?.falhas > 0 && aviso("aviso", `${r.fotos.falhas} foto(s) não vieram: a dona pode enviá-las de novo no painel.`)}
        ${r.reconectar?.length > 0 && aviso("aviso", `Conecte de novo: ${r.reconectar.map((x) => (x === "pagamento" ? "o pagamento online (Mercado Pago)" : "o WhatsApp")).join(" e ")} — pela loja em Lojas ou pela dona no painel.`)}`);
      toast("Loja mudada para o banco único.");
    } catch (erro) {
      progresso.hidden = true;
      montar(final, html`${aviso("perigo", erro.message)}<div class="passos-criacao__botoes"><button type="button" class="btn btn--primario" data-de-novo>Continuar</button></div>`);
      final.querySelector("[data-de-novo]").addEventListener("click", () => rodar(null));
    }
  }

  const form = modal.el.querySelector("#form-mudar");
  if (form) {
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const { codigo } = dadosDe(form);
      if (String(codigo).trim() !== loja.codigo) return mostrarErros(form, { message: "O código não confere.", campos: { codigo: "O código não confere." } });
      form.hidden = true;
      modal.el.querySelector(".mudanca__lista")?.setAttribute("hidden", "");
      modal.el.querySelector('[form="form-mudar"]')?.setAttribute("disabled", "");
      await rodar(String(codigo).trim());
    });
  } else rodar(null);
}

async function atualizarBanco(loja, depois) {
  const modal = abrirModal({ titulo: `Atualizar — ${loja.nome}`, largura: 480, corpo: html`<p data-progresso>Aplicando as atualizações…</p>`, aoFechar: depois });
  const p = modal.el.querySelector("[data-progresso]");
  try {
    let r;
    do { r = await api("POST", `lojas/${loja.ref}/preparar`, {}); if (r.aplicada) p.textContent = `Aplicada: ${r.aplicada.replace(/_/g, " ")} (${r.feitas} de ${r.total})`; }
    while (r.aplicada || r.etapa === "tabelas");
    montar(modal.corpo, aviso("sucesso", "Banco atualizado. Nada muda para a dona: os dados continuam todos lá."));
  } catch (erro) { montar(modal.corpo, aviso("perigo", erro.message)); }
}

function excluir(loja, depois) {
  const modal = abrirModal({
    titulo: "Excluir loja", largura: 500,
    corpo: html`
      <form id="form-excluir" novalidate>
        ${aviso("perigo", html`Isso apaga <strong>${loja.nome}</strong> de vez: banco, pedidos, clientes, fotos e os 2 sites. <strong>Não tem volta.</strong>`)}
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "codigo", rotulo: `Para confirmar, digite o código da loja: ${loja.codigo}`, obrigatorio: true, atributos: 'autocomplete="off" spellcheck="false"' })}
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-excluir" class="btn btn--perigo" disabled>Excluir para sempre</button>`,
  });
  const form = modal.el.querySelector("form");
  const botao = modal.el.querySelector('[form="form-excluir"]');
  ativarCampos(form);
  form.addEventListener("input", () => { botao.disabled = form.codigo.value.trim() !== loja.codigo; });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (botao.disabled) return;
    await ocupado(botao, async () => {
      try {
        await api("DELETE", `lojas/${loja.ref}`, { codigo: form.codigo.value.trim() });
        modal.fechar();
        toast(`“${loja.nome}” foi excluída.`);
        await depois();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}
