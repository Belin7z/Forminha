/* ==========================================================
   CENTRAL DA FORMINHA — tela.
   Entrar com a senha, ver as lojas, criar uma loja nova (com o passo a
   passo na tela), mandar o convite, atualizar, reativar e excluir.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { TEMAS, gerarTokens } from "/src/scripts/base/tema.js";

const raiz = document.getElementById("raiz");
const dorme = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ---------- conversa com a API da Central ---------- */
async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(`/api/${caminho}`, {
      method: metodo, credentials: "same-origin",
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch { throw Object.assign(new Error("Sem conexão com a Central. Confira a internet."), { status: 0 }); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && caminho !== "entrar") { telaEntrar("Sua sessão terminou. Entre de novo."); }
    throw Object.assign(new Error(dados.erro ?? "Algo deu errado."), { status: r.status, campos: dados.campos });
  }
  return dados;
}

const marca = html`<span class="marca-central"><span class="marca-central__selo">${icone("cupcake", { tamanho: 22 })}</span>
  <span><strong>Forminha</strong><small>Central</small></span></span>`;

/* ---------- entrar ---------- */
const VANTAGENS = [
  ["bolo", "Loja e painel no ar em minutos", "Banco, sites e tabelas se montam sozinhos."],
  ["mensagem", "Convite pronto para o WhatsApp", "A dona cria o acesso e já cai no painel dela."],
  ["escudo", "Cada loja no seu cantinho", "Código próprio e dados separados das outras."],
];

/** As bolinhas dos temas prontos (com as cores de verdade de cada um). */
const amostraDeTemas = () => html`<ul class="entrar__temas" aria-label="Temas prontos">${TEMAS.map((t) => {
  const c = gerarTokens({ tema: t.id });
  return html`<li title="${t.nome}" style="background:linear-gradient(135deg, ${c["--marca-300"]} 50%, ${c["--escura"]} 50%)"></li>`;
})}</ul>`;

function telaEntrar(aviso = "") {
  document.title = "Entrar — Forminha";
  montar(raiz, html`
    <main class="entrar">
      <section class="entrar__vitrine">
        <div class="entrar__vitrine-miolo">
          ${marca}
          <h1>Cada doceria com a <span class="script">sua</span> loja.</h1>
          <p class="entrar__lema">Crie em minutos a loja online e o painel de uma cliente — e acompanhe todas daqui.</p>
          <ul class="entrar__vantagens">${VANTAGENS.map(([ic, titulo, texto]) => html`
            <li><span class="entrar__ico">${icone(ic, { tamanho: 18 })}</span><div><strong>${titulo}</strong><small>${texto}</small></div></li>`)}</ul>
          <div class="entrar__rodape-vitrine">
            ${amostraDeTemas()}
            <small>${TEMAS.length} temas prontos — ou as cores da marca de cada cliente</small>
          </div>
        </div>
        <span class="entrar__marca-dagua" aria-hidden="true">${icone("cupcake", { tamanho: 360 })}</span>
      </section>

      <section class="entrar__lado">
        <div class="entrar__caixa">
          <p class="entrar__sobre">Central</p>
          <h2>Entrar</h2>
          <p class="texto-suave">Use a senha da Central da Forminha.</p>
          ${aviso && html`<div class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>${aviso}</span></div>`}
          <form id="form-entrar" novalidate>
            <div class="form-erro" data-erro-geral hidden></div>
            ${campo({ nome: "senha", rotulo: "Senha", tipo: "password", obrigatorio: true, atributos: 'autocomplete="current-password" autofocus' })}
            <p class="entrar__caps" data-caps hidden>${icone("alerta", { tamanho: 14 })} O Caps Lock está ligado.</p>
            <button type="submit" class="btn btn--primario btn--grande btn--bloco">Entrar ${icone("direita", { tamanho: 17 })}</button>
          </form>
          <details class="entrar__ajuda">
            <summary>Esqueceu a senha?</summary>
            <p>Por segurança, a senha não fica guardada em lugar nenhum — nem dá para "recuperar". Crie uma nova no computador:
              na pasta <code>Central</code>, rode <code>npm run configurar</code>.</p>
          </details>
          <p class="entrar__rodape">${icone("cadeado", { tamanho: 14 })} Conexão protegida · só para quem administra a Forminha</p>
        </div>
      </section>
    </main>`);
  const form = raiz.querySelector("form");
  ativarCampos(form);
  const caps = raiz.querySelector("[data-caps]");
  const olharCaps = (ev) => { if (ev.getModifierState) caps.hidden = !ev.getModifierState("CapsLock"); };
  form.senha.addEventListener("keydown", olharCaps);
  form.senha.addEventListener("keyup", olharCaps);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try { await api("POST", "entrar", dadosDe(form)); await telaLojas(); }
      catch (erro) { mostrarErros(form, erro); form.senha.select(); }
    });
  });
}

/* ---------- lojas ---------- */
const ETAPAS = {
  pronta: ["Pronta", "sucesso"], criando: ["Criando o banco", "info"], tabelas: ["Preparando", "info"], sites: ["Falta publicar", "aviso"],
  pausada: ["Pausada", "aviso"], reativando: ["Reativando", "info"], problema: ["Com problema", "perigo"],
};
const incompleta = (l) => ["criando", "tabelas", "sites"].includes(l.etapa);

function cartaoLoja(l) {
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
      ${(l.loja || l.painel) && html`<div class="loja__links">
        ${l.loja && html`<a href="${l.loja}" target="_blank" rel="noopener" class="link">${icone("home", { tamanho: 15 })} ${l.loja.replace("https://", "")}</a>`}
        ${l.painel && html`<a href="${l.painel}" target="_blank" rel="noopener" class="link">${icone("grade", { tamanho: 15 })} ${l.painel.replace("https://", "")}</a>`}
      </div>`}
      <footer class="loja__acoes">
        ${incompleta(l) && html`<button type="button" class="btn btn--primario btn--pequeno" data-acao="continuar">Continuar criação</button>`}
        ${l.etapa === "pronta" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="convite">${icone("email", { tamanho: 15 })} Convite da dona</button>`}
        ${l.atualizar && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="atualizar">${icone("atualizar", { tamanho: 15 })} Atualizar banco</button>`}
        ${l.etapa === "pausada" && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="reativar">${icone("atualizar", { tamanho: 15 })} Reativar</button>`}
        <button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao="excluir">${icone("lixeira", { tamanho: 15 })} Excluir</button>
      </footer>
    </article>`;
}

let lojas = [];
async function telaLojas() {
  document.title = "Lojas — Forminha";
  const eu = await api("GET", "eu").catch(() => ({ logado: false }));
  if (!eu.logado) return telaEntrar();
  montar(raiz, html`
    <div class="central">
      <header class="topo-central">
        ${marca}
        <button type="button" class="btn btn--suave btn--pequeno" data-acao="sair">${icone("sair", { tamanho: 15 })} Sair</button>
      </header>
      <main class="central__corpo">
        ${eu.simulado && html`<div class="aviso aviso--info">${icone("info", { tamanho: 16 })}<span><strong>Modo de teste:</strong> nada é criado de verdade no Supabase nem na Vercel.</span></div>`}
        ${eu.faltando?.length > 0 && html`<div class="aviso aviso--aviso">${icone("alerta", { tamanho: 16 })}<span>A Central ainda não está pronta para criar lojas. Falta configurar: <strong>${eu.faltando.join(", ")}</strong>. No computador, rode <code>npm run configurar</code> na pasta Central.</span></div>`}
        <div class="central__titulo">
          <div><h1>Lojas</h1><p class="texto-suave" data-resumo>Carregando…</p></div>
          <button type="button" class="btn btn--primario" data-acao="nova">${icone("mais", { tamanho: 17 })} Nova loja</button>
        </div>
        <section class="lojas" data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>
      </main>
    </div>`);
  await carregarLojas();
}

async function carregarLojas() {
  const lista = raiz.querySelector("[data-lista]");
  if (!lista) return;
  try { lojas = (await api("GET", "lojas")).lojas; }
  catch (erro) {
    montar(lista, html`<div class="vazio"><span class="vazio__ico">${icone("alerta", { tamanho: 34 })}</span><h3>Não consegui carregar as lojas</h3><p>${erro.message}</p></div>`);
    raiz.querySelector("[data-resumo]").textContent = "";
    return;
  }
  const prontas = lojas.filter((l) => l.etapa === "pronta").length;
  raiz.querySelector("[data-resumo]").textContent = lojas.length
    ? `${lojas.length} ${lojas.length === 1 ? "loja" : "lojas"} · ${prontas} ${prontas === 1 ? "pronta" : "prontas"}`
    : "Nenhuma loja ainda.";
  montar(lista, lojas.length ? html`${lojas.map(cartaoLoja)}` : html`
    <div class="vazio">
      <span class="vazio__ico">${icone("cupcake", { tamanho: 38 })}</span>
      <h3>Nenhuma loja ainda</h3>
      <p>Quando uma doceria contratar, clique em “Nova loja”: o banco, a loja e o painel dela ficam prontos em poucos minutos.</p>
      <button type="button" class="btn btn--primario" data-acao="nova">${icone("mais", { tamanho: 17 })} Criar a primeira loja</button>
    </div>`);
}

const lojaDe = (el) => lojas.find((l) => l.ref === el.closest("[data-ref]")?.dataset.ref);

raiz.addEventListener("click", async (ev) => {
  const alvo = ev.target.closest("[data-acao]");
  if (!alvo) return;
  const acao = alvo.dataset.acao;
  if (acao === "sair") { await api("POST", "sair", {}).catch(() => {}); return telaEntrar(); }
  if (acao === "nova") return novaLoja();
  if (acao === "copiar-codigo") { await copiar(alvo.dataset.codigo); return toast("Código copiado."); }
  const loja = lojaDe(alvo);
  if (!loja) return;
  if (acao === "continuar") return acompanharCriacao(loja);
  if (acao === "convite") return novoConvite(loja);
  if (acao === "atualizar") return atualizarBanco(loja);
  if (acao === "reativar") {
    await ocupado(alvo, async () => {
      try { await api("POST", `lojas/${loja.ref}/reativar`, {}); toast("Reativando a loja. Leva 1 a 2 minutos."); await carregarLojas(); }
      catch (erro) { toast(erro.message, "erro"); }
    });
  }
  if (acao === "excluir") return excluir(loja);
});

/* ---------- nova loja: formulário e passo a passo ---------- */
function novaLoja() {
  const modal = abrirModal({
    titulo: "Nova loja", largura: 520,
    corpo: html`
      <form id="form-nova" novalidate>
        <p class="texto-suave">A loja nasce zerada e neutra. A dona recebe um convite para criar o acesso dela e escolher cores, logo e cardápio.</p>
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
        acompanharCriacao(criada, criada.email);
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

/** Passo a passo da criação (também serve para continuar uma loja que parou no meio). */
function acompanharCriacao(loja, email = "") {
  const modal = abrirModal({
    titulo: `Criando “${loja.nome}”`, largura: 560,
    corpo: html`
      <p class="texto-suave">Código da loja: <strong class="codigo codigo--texto">${loja.codigo}</strong>. Pode deixar esta janela aberta: tudo acontece sozinho.</p>
      <ol class="passos-criacao">${PASSOS.map(([id, titulo, dica]) => html`
        <li data-passo="${id}"><span class="passos-criacao__marca"></span><div><strong>${titulo}</strong><small data-detalhe>${dica ?? ""}</small></div></li>`)}</ol>
      <div data-final></div>`,
    aoFechar: () => { modal.parado = true; carregarLojas(); },
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
        <div class="aviso aviso--perigo">${icone("alerta", { tamanho: 16 })}<span>${erro.message}</span></div>
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

/* ---------- convite ---------- */
function painelConvite({ link, email, loja, urlLoja, urlPainel, vale_dias: dias = 7 }) {
  const mensagem = `Olá! Sua loja "${loja}" está pronta. Crie seu acesso ao painel por este link (vale ${dias} dias e só funciona uma vez): ${link}`;
  return html`
    <div class="convite-pronto">
      <h3>${icone("checkCirculo", { tamanho: 20 })} Tudo pronto!</h3>
      ${(urlLoja || urlPainel) && html`<p class="texto-suave">Loja: <a class="link" href="${urlLoja}" target="_blank" rel="noopener">${String(urlLoja ?? "").replace("https://", "")}</a> · Painel: <a class="link" href="${urlPainel}" target="_blank" rel="noopener">${String(urlPainel ?? "").replace("https://", "")}</a></p>`}
      <p>Envie este convite para <strong>${email}</strong>:</p>
      <div class="convite-pronto__link"><code>${link}</code></div>
      <div class="convite-pronto__botoes">
        <button type="button" class="btn btn--primario btn--pequeno" data-copiar="${link}">${icone("copiar", { tamanho: 15 })} Copiar link</button>
        <a class="btn btn--whats btn--pequeno" href="https://wa.me/?text=${encodeURIComponent(mensagem)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
        <a class="btn btn--suave btn--pequeno" href="mailto:${email}?subject=${encodeURIComponent(`Sua loja ${loja} está pronta`)}&body=${encodeURIComponent(mensagem)}">${icone("email", { tamanho: 15 })} E-mail</a>
      </div>
    </div>`;
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copiar]");
  if (!b) return;
  await copiar(b.dataset.copiar);
  toast("Link copiado.");
});

async function novoConvite(loja) {
  const modal = abrirModal({ titulo: `Convite — ${loja.nome}`, largura: 560, corpo: html`<div class="carregando-pagina"><div class="spinner"></div></div>` });
  try {
    const convite = await api("POST", `lojas/${loja.ref}/convite`, {});
    montar(modal.corpo, html`<p class="texto-suave">Um link novo (os anteriores que não foram usados continuam valendo até vencer).</p>${painelConvite({ ...convite, loja: loja.nome, urlLoja: loja.loja, urlPainel: loja.painel })}`);
  } catch (erro) {
    montar(modal.corpo, html`<div class="aviso aviso--perigo">${icone("alerta", { tamanho: 16 })}<span>${erro.message}</span></div>`);
  }
}

/* ---------- atualizar o banco (migrações novas) ---------- */
async function atualizarBanco(loja) {
  const modal = abrirModal({ titulo: `Atualizar — ${loja.nome}`, largura: 480, corpo: html`<p data-progresso>Aplicando as atualizações…</p>`, aoFechar: carregarLojas });
  const p = modal.el.querySelector("[data-progresso]");
  try {
    let r;
    do { r = await api("POST", `lojas/${loja.ref}/preparar`, {}); if (r.aplicada) p.textContent = `Aplicada: ${r.aplicada.replace(/_/g, " ")} (${r.feitas} de ${r.total})`; }
    while (r.aplicada || r.etapa === "tabelas");
    montar(modal.corpo, html`<div class="aviso aviso--sucesso">${icone("checkCirculo", { tamanho: 16 })}<span>Banco atualizado. Nada muda para a dona: os dados continuam todos lá.</span></div>`);
  } catch (erro) {
    montar(modal.corpo, html`<div class="aviso aviso--perigo">${icone("alerta", { tamanho: 16 })}<span>${erro.message}</span></div>`);
  }
}

/* ---------- excluir ---------- */
function excluir(loja) {
  const modal = abrirModal({
    titulo: "Excluir loja", largura: 500,
    corpo: html`
      <form id="form-excluir" novalidate>
        <div class="aviso aviso--perigo">${icone("alerta", { tamanho: 16 })}<span>Isso apaga <strong>${loja.nome}</strong> de vez: banco, pedidos, clientes, fotos e os 2 sites. <strong>Não tem volta.</strong></span></div>
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
        await carregarLojas();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}

telaLojas().catch(() => telaEntrar());
