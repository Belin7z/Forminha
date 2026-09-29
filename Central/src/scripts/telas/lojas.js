/* TELA — Lojas: todas as lojas no Supabase/Vercel (criar à mão, convite, pagamento online, domínio, atualizar banco, reativar, excluir) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { montarDominio } from "/src/scripts/base/dns.js";
import { baixarJson } from "./configuracoes.js";
import { api, aviso, dorme, pode } from "../nucleo.js";

const ETAPAS = {
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
        <span class="selo selo--${tom}">${rotulo}${l.etapa === "tabelas" && l.total ? ` · ${l.feitas} de ${l.total}` : ""}</span>
      </header>
      ${l.atualizar && html`<p class="loja__nota">${icone("atualizar", { tamanho: 14 })} Tem atualização do banco para esta loja.</p>`}
      ${l.dominio && !l.dominio_ativo && html`<p class="loja__nota">${icone("globo", { tamanho: 14 })} ${l.dominio}: aguardando o DNS.</p>`}
      ${(l.loja || l.painel) && html`<div class="loja__links">
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
        ${pode(eu, "lojas.excluir") && html`<button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao="excluir">${icone("lixeira", { tamanho: 15 })} Excluir</button>`}
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
    conteiner.querySelector("[data-resumo]").textContent = lojas.length
      ? `${lojas.length} ${lojas.length === 1 ? "loja" : "lojas"} · ${prontas} ${prontas === 1 ? "pronta" : "prontas"}` : "Nenhuma loja ainda.";
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
      passo("sites", "fazendo", "Criando os 2 sites na Vercel…");
      const sites = estado.etapa === "sites" ? await api("POST", `lojas/${loja.ref}/publicar`, {}) : estado;
      passo("sites", "feito", "Publicados — ficam no ar em 1 a 2 minutos.");
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
        <p class="form-empilhado__dica">A Central instala o PIX automático e o cartão na loja. A chave fica só nos segredos da loja: não aparece de novo.</p>
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

/** Domínio próprio da loja (ex.: suadoceria.com.br): a mesma tela que a dona vê no painel dela. */
async function dominioDaLoja(loja, depois) {
  let mudou = false;
  const modal = abrirModal({
    titulo: `Domínio — ${loja.nome}`, largura: 640, corpo: html`<div class="carregando-pagina"><div class="spinner"></div></div>`,
    aoFechar: () => { if (mudou) depois(); },
  });
  const chamar = (metodo, acao, corpo) => api(metodo, `lojas/${loja.ref}/dominio${acao ? `/${acao}` : ""}`, corpo);
  try { montarDominio(modal.corpo, await chamar("GET"), { chamar, aoMudar: () => { mudou = true; } }); }
  catch (erro) { montar(modal.corpo, aviso("perigo", erro.message)); }
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
