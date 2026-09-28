/* ==========================================================
   TELA — Clientes: quem comprou (ou vai comprar) uma loja.
   Lista com busca, cadastro com cobrança PIX e a ficha de cada
   cliente: pagamento, criação da loja (acompanha sozinha), convite,
   suporte (redefinir senha), notas e histórico.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { paraCentavos, emReais } from "/src/scripts/base/formatacao.js";
import { api, aviso, dia, documentoBonito, linkWhats, pode, quando, reais, telefoneBonito } from "../nucleo.js";

/* ---------- situação ---------- */
const ETAPAS_LOJA = [
  ["criar_projeto", "Criar o banco"], ["aguardar_banco", "Banco ficando pronto"], ["preparar", "Preparar as tabelas"],
  ["publicar", "Publicar a loja e o painel"], ["convite", "Gerar o convite"], ["email", "Enviar o e-mail"],
];
function situacaoDe(c) {
  if (c.situacao === "cancelado") return ["Cancelado", "neutro"];
  if (c.situacao === "aguardando_pagamento") return ["Aguardando pagamento", "aviso"];
  if (c.etapa === "pronta") return ["Loja pronta", "sucesso"];
  if (c.parada) return ["Parou — ver", "perigo"];
  return ["Criando a loja", "info"];
}
const selo = (c) => { const [t, tom] = situacaoDe(c); return html`<span class="selo selo--${tom}">${t}</span>`; };

/* ---------- lista ---------- */
export async function telaClientes(conteiner, eu) {
  document.title = "Clientes — Forminha";
  let clientes = [];
  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Clientes</h1><p class="texto-suave" data-resumo>Carregando…</p></div>
      <div class="central__titulo-acoes">
        <label class="busca-central">${icone("busca", { tamanho: 16 })}<input type="search" data-busca placeholder="Buscar cliente ou loja" aria-label="Buscar cliente ou loja"></label>
        ${pode(eu, "clientes.cadastrar") && html`<button type="button" class="btn btn--primario" data-acao="novo" ${!eu.recursos?.clientes && "disabled"}>${icone("mais", { tamanho: 17 })} Nova cliente</button>`}
      </div>
    </div>
    ${!eu.recursos?.clientes && aviso("aviso", pode(eu, "configuracoes") ? html`Para cadastrar clientes, falta ligar o banco da Central e a chave de criptografia. Veja em <a class="link" href="#/configuracoes">Configurações</a>.` : "A Central ainda não está pronta para clientes. Fale com o dono.")}
    <section data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>`);

  const lista = conteiner.querySelector("[data-lista]");
  const busca = conteiner.querySelector("[data-busca]");

  function desenhar() {
    const termo = busca.value.trim().toLowerCase();
    const filtradas = clientes.filter((c) => !termo || [c.nome, c.email, c.nome_loja].some((v) => String(v ?? "").toLowerCase().includes(termo)));
    const prontas = clientes.filter((c) => c.etapa === "pronta").length;
    const aguardando = clientes.filter((c) => c.situacao === "aguardando_pagamento").length;
    conteiner.querySelector("[data-resumo]").textContent = clientes.length
      ? `${clientes.length} ${clientes.length === 1 ? "cliente" : "clientes"} · ${prontas} ${prontas === 1 ? "loja pronta" : "lojas prontas"} · ${aguardando} aguardando pagamento`
      : "Nenhuma cliente ainda.";
    if (!clientes.length) {
      montar(lista, html`<div class="vazio"><span class="vazio__ico">${icone("usuarios", { tamanho: 36 })}</span><h3>Nenhuma cliente ainda</h3>
        <p>Cadastre a primeira doceria: a Central gera o PIX, e quando ela pagar a loja é criada sozinha.</p></div>`);
      return;
    }
    montar(lista, filtradas.length ? html`
      <div class="tabela-clientes" role="list">
        <div class="tc__cab" aria-hidden="true"><span>Cliente</span><span>Loja</span><span>Situação</span><span>Valor</span><span>Desde</span></div>
        ${filtradas.map((c) => html`
          <button type="button" class="tc__linha" role="listitem" data-acao="abrir" data-id="${c.id}">
            <span class="tc__cliente"><strong>${c.nome}</strong><small>${c.email ?? ""}</small></span>
            <span class="tc__loja">${c.nome_loja}</span>
            <span>${selo(c)}</span>
            <span class="tc__valor">${reais(c.valor_centavos)}</span>
            <span class="tc__data">${dia(c.criado_em)}</span>
          </button>`)}
      </div>` : html`<p class="texto-suave">Nada encontrado para “${busca.value}”.</p>`);
  }

  async function carregar() {
    if (!eu.recursos?.clientes) { montar(lista, ""); conteiner.querySelector("[data-resumo]").textContent = ""; return; }
    try { clientes = (await api("GET", "clientes")).clientes; desenhar(); }
    catch (erro) { montar(lista, aviso("perigo", erro.message)); }
  }

  busca.addEventListener("input", desenhar);
  conteiner.addEventListener("click", (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo || !conteiner.contains(alvo)) return;
    if (alvo.dataset.acao === "novo") novaCliente(carregar, eu);
    if (alvo.dataset.acao === "abrir") abrirFicha(alvo.dataset.id, carregar, eu);
  });
  await carregar();
}

/* ---------- nova cliente ---------- */
async function novaCliente(depois, eu) {
  let padrao = 0;
  try { padrao = (await api("GET", "configuracoes")).valor_padrao_centavos; } catch { /* segue sem valor padrão */ }
  const modal = abrirModal({
    titulo: "Nova cliente", largura: 620,
    corpo: html`
      <form id="form-cliente" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <div class="grade-2">
          ${campo({ nome: "nome", rotulo: "Nome completo", obrigatorio: true, atributos: 'maxlength="120" autocomplete="off" autofocus' })}
          ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true, ajuda: "Recebe o PIX e, depois, o acesso à loja." })}
          ${campo({ nome: "telefone", rotulo: "WhatsApp", tipo: "tel", mascara: "telefone" })}
          ${campo({ nome: "documento", rotulo: "CPF ou CNPJ", atributos: 'inputmode="numeric" maxlength="18"', ajuda: "Opcional." })}
          ${campo({ nome: "nome_loja", rotulo: "Nome da loja", obrigatorio: true, placeholder: "Ex.: Doce da Ana", atributos: 'maxlength="60"' })}
          ${campo({ nome: "valor", rotulo: "Valor (R$)", mascara: "moeda", valor: padrao ? emReais(padrao) : "", obrigatorio: true })}
        </div>
        ${campo({ nome: "observacoes", rotulo: "Observações", tipo: "textarea", linhas: 2, atributos: 'maxlength="1000"', ajuda: "Só a equipe da Forminha vê. Fica guardado criptografado." })}
        <p class="nota-seguranca">${icone("cadeado", { tamanho: 14 })} Nome, e-mail, WhatsApp, CPF/CNPJ e observações são guardados criptografados.</p>
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-cliente" class="btn btn--primario">Cadastrar e gerar PIX</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const dados = dadosDe(form);
    const corpo = { ...dados, valor_centavos: paraCentavos(dados.valor) };
    delete corpo.valor;
    await ocupado(modal.el.querySelector('[form="form-cliente"]'), async () => {
      try {
        const r = await api("POST", "clientes", corpo);
        const c = r.cliente;
        montar(modal.corpo, html`
          ${aviso("sucesso", html`<strong>${c.nome}</strong> cadastrada. Cobrança de <strong>${reais(c.valor_centavos)}</strong> criada.`)}
          ${painelCobranca({ link: r.link_pagamento, cliente: c, emailEnviado: r.email_enviado })}`);
        montar(modal.rodape, html`<button type="button" class="btn btn--suave" data-fechar>Fechar</button><button type="button" class="btn btn--primario" data-ficha>Abrir ficha</button>`);
        modal.rodape.querySelector("[data-ficha]").addEventListener("click", () => { modal.fechar(); abrirFicha(c.id, depois, eu); });
        depois();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}

/** Link da página de pagamento, pronto para mandar. */
function painelCobranca({ link, cliente, emailEnviado }) {
  const msg = `Olá, ${cliente.nome.split(" ")[0]}! Para ativar a sua loja ${cliente.nome_loja}, é só pagar o PIX de ${reais(cliente.valor_centavos)} por este link: ${link}`;
  return html`
    <div class="bloco-link">
      <p class="bloco-link__rotulo">Página de pagamento</p>
      <div class="convite-pronto__link"><code>${link}</code></div>
      <div class="convite-pronto__botoes">
        <button type="button" class="btn btn--primario btn--pequeno" data-copiar="${link}">${icone("copiar", { tamanho: 15 })} Copiar link</button>
        <a class="btn btn--whats btn--pequeno" href="${linkWhats(msg, cliente.telefone)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
        <a class="btn btn--suave btn--pequeno" href="${link}" target="_blank" rel="noopener">${icone("olho", { tamanho: 15 })} Ver a página</a>
      </div>
      ${emailEnviado === true && html`<p class="bloco-link__nota">${icone("check", { tamanho: 14 })} Enviado também para ${cliente.email}.</p>`}
      ${emailEnviado === false && html`<p class="bloco-link__nota">${icone("info", { tamanho: 14 })} O e-mail não está configurado: mande o link pelo WhatsApp.</p>`}
    </div>`;
}

/* ---------- ficha ---------- */
export function abrirFicha(id, depois, eu) {
  const p = (permissao) => pode(eu, permissao);
  let d = null;
  let parar = false;
  const modal = abrirModal({ titulo: "Cliente", largura: 880, classe: "ficha-modal", corpo: html`<div class="carregando-pagina"><div class="spinner"></div></div>`, aoFechar: () => { parar = true; depois?.(); } });

  const secaoPagamento = () => {
    const c = d.cliente;
    const pendente = d.pagamentos.find((p) => p.situacao === "pendente");
    const aprovado = d.pagamentos.find((p) => p.situacao === "aprovado");
    return html`
      <section class="ficha__cartao">
        <h3>${icone("dinheiro", { tamanho: 17 })} Pagamento <span class="ficha__valor">${reais(c.valor_centavos)}</span></h3>
        ${aprovado && html`<p class="ficha__ok">${icone("checkCirculo", { tamanho: 16 })} Pago em ${quando(aprovado.confirmado_em)} · ${aprovado.confirmado_por === "mercado_pago" ? "confirmado pelo Mercado Pago" : !aprovado.confirmado_por || aprovado.confirmado_por === "admin" ? "confirmado manualmente" : `confirmado por ${aprovado.confirmado_por}`}</p>`}
        ${c.situacao === "cancelado" && html`<p class="texto-suave">Cadastro cancelado.</p>`}
        ${pendente && html`
          ${painelCobranca({ link: pendente.link, cliente: c })}
          <details class="ficha__pix"><summary>PIX copia e cola (com a sua chave)</summary><div class="convite-pronto__link"><code>${pendente.pix_copia_cola}</code></div>
            <button type="button" class="btn btn--suave btn--pequeno" data-copiar="${pendente.pix_copia_cola}">${icone("copiar", { tamanho: 14 })} Copiar PIX</button></details>
          <div class="ficha__acoes">
            ${p("pagamentos.confirmar") && html`<button type="button" class="btn btn--primario btn--pequeno" data-acao="pago">${icone("check", { tamanho: 15 })} Pagamento recebido</button>`}
            ${p("pagamentos.cobrar") && d.email_configurado && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="reenviar-cobranca">${icone("email", { tamanho: 15 })} Reenviar e-mail</button>`}
            ${p("pagamentos.cobrar") && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="cobrar">${icone("atualizar", { tamanho: 15 })} Nova cobrança</button>`}
            ${p("pagamentos.cancelar") && html`<button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao="cancelar">Cancelar cadastro</button>`}
          </div>`}
      </section>`;
  };

  const secaoLoja = () => {
    const c = d.cliente;
    if (c.situacao !== "pago") return html`<section class="ficha__cartao" data-secao-loja><h3>${icone("home", { tamanho: 17 })} Loja</h3>
      <p class="texto-suave">${c.situacao === "cancelado" ? "Sem loja." : "A loja é criada sozinha assim que o pagamento for confirmado."}</p></section>`;
    if (c.etapa !== "pronta") {
      const atual = ETAPAS_LOJA.findIndex(([e]) => e === c.etapa);
      return html`<section class="ficha__cartao" data-secao-loja><h3>${icone("home", { tamanho: 17 })} Loja</h3>
        ${c.parada ? html`${aviso("perigo", html`A criação parou: ${c.etapa_erro ?? "erro desconhecido"}`)}
          ${p("lojas.suporte") && html`<div class="ficha__acoes"><button type="button" class="btn btn--primario btn--pequeno" data-acao="tentar">Tentar de novo</button></div>`}`
        : html`<p class="texto-suave">Criando a loja — leva de 3 a 6 minutos. Pode fechar: continua sozinha.</p>`}
        <ol class="passos-criacao passos-criacao--compacto">${ETAPAS_LOJA.map(([e, t], i) => html`
          <li class="${i < atual ? "passo--feito" : i === atual ? (c.parada ? "passo--erro" : "passo--fazendo") : ""}"><span class="passos-criacao__marca"></span><div><strong>${t}</strong></div></li>`)}</ol>
      </section>`;
    }
    return html`<section class="ficha__cartao" data-secao-loja>
      <h3>${icone("home", { tamanho: 17 })} Loja <span class="selo selo--sucesso">Pronta</span></h3>
      <div class="loja__links">
        <a href="${c.loja_url}" target="_blank" rel="noopener" class="link">${icone("home", { tamanho: 15 })} ${String(c.loja_url).replace("https://", "")}</a>
        <a href="${c.painel_url}" target="_blank" rel="noopener" class="link">${icone("grade", { tamanho: 15 })} ${String(c.painel_url).replace("https://", "")}</a>
      </div>
      ${c.loja_codigo && html`<p class="texto-suave ficha__codigo">Código: <span class="codigo codigo--texto">${c.loja_codigo}</span></p>`}
      ${c.convite && html`
        <div class="bloco-link">
          <p class="bloco-link__rotulo">Link de acesso da dona ${c.email_boas_vindas_em && html`<small>· enviado por e-mail em ${quando(c.email_boas_vindas_em)}</small>`}</p>
          <div class="convite-pronto__link"><code>${c.convite}</code></div>
          <div class="convite-pronto__botoes">
            <button type="button" class="btn btn--primario btn--pequeno" data-copiar="${c.convite}">${icone("copiar", { tamanho: 15 })} Copiar</button>
            <a class="btn btn--whats btn--pequeno" href="${linkWhats(`Olá, ${c.nome.split(" ")[0]}! Sua loja ${c.nome_loja} está pronta. Crie seu acesso ao painel por este link (vale 7 dias e funciona uma vez): ${c.convite}`, c.telefone)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
            ${p("lojas.suporte") && d.email_configurado && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="reenviar-convite">${icone("email", { tamanho: 15 })} Reenviar</button>`}
            ${p("lojas.suporte") && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="convite">${icone("atualizar", { tamanho: 15 })} Link novo</button>`}
          </div>
        </div>`}
    </section>`;
  };

  const secaoSuporte = () => html`
    <section class="ficha__cartao">
      <h3>${icone("ajuda", { tamanho: 17 })} Suporte</h3>
      <div class="ficha__acoes">
        ${p("lojas.suporte") && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="senha" ${d.cliente.etapa !== "pronta" && "disabled"}>${icone("cadeado", { tamanho: 15 })} Redefinir senha da dona</button>`}
        ${p("clientes.editar") && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="editar">${icone("editar", { tamanho: 15 })} Editar dados</button>`}
      </div>
      <div data-resultado-suporte></div>
      ${p("clientes.notas") && html`<form class="ficha__nota" data-nota novalidate>
        <textarea class="entrada" name="texto" rows="2" maxlength="2000" placeholder="Anotar algo sobre esta cliente (só a equipe vê)"></textarea>
        <button type="submit" class="btn btn--suave btn--pequeno">Anotar</button>
      </form>`}
      <ol class="historico">${d.historico.map((h) => html`<li class="historico__item historico__item--${h.tipo}"><span>${h.texto}</span><time>${quando(h.quando)}</time></li>`)}</ol>
    </section>`;

  function desenhar() {
    const c = d.cliente;
    modal.el.querySelector(".modal__cab h2").textContent = c.nome;
    montar(modal.corpo, html`
      <div class="ficha__topo">
        <div>
          <p class="ficha__loja">${c.nome_loja}</p>
          <p class="ficha__contato">
            <a class="link" href="mailto:${c.email}">${c.email}</a>
            ${c.telefone && html` · <a class="link" href="https://wa.me/55${c.telefone}" target="_blank" rel="noopener">${telefoneBonito(c.telefone)}</a>`}
            ${c.documento && html` · ${documentoBonito(c.documento)}`}
          </p>
          ${c.observacoes && html`<p class="ficha__obs">${c.observacoes}</p>`}
        </div>
        ${selo(c)}
      </div>
      <div class="ficha__grade">
        <div>${secaoPagamento()}${secaoLoja()}</div>
        <div>${secaoSuporte()}</div>
      </div>`);
  }

  async function carregar() {
    try { d = await api("GET", `clientes/${id}`); desenhar(); }
    catch (erro) { montar(modal.corpo, aviso("perigo", erro.message)); }
  }

  /** Enquanto a loja estiver sendo criada, a ficha empurra e acompanha sozinha. */
  async function acompanhar() {
    while (!parar && d?.cliente.situacao === "pago" && d.cliente.etapa !== "pronta" && !d.cliente.parada) {
      try {
        const novo = await api("POST", `clientes/${id}/avancar`, {});
        if (parar) return;
        const mudou = novo.cliente.etapa !== d.cliente.etapa || novo.cliente.parada;
        d = novo;
        if (mudou) {
          const secao = modal.el.querySelector("[data-secao-loja]");
          if (secao) secao.outerHTML = String(secaoLoja());
          if (d.cliente.etapa === "pronta") { desenhar(); toast(`A loja “${d.cliente.nome_loja}” está pronta!`); }
        }
      } catch { /* sem internet por um instante: tenta de novo */ }
      await new Promise((ok) => setTimeout(ok, 4000));
    }
  }

  const agir = (botao, tarefa) => ocupado(botao, async () => {
    try { await tarefa(); } catch (erro) { toast(erro.message, "erro"); }
  });

  modal.el.addEventListener("click", async (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === "pago") {
      const ok = await confirmar({ titulo: "Pagamento recebido?", mensagem: `Confirme só se o PIX de ${reais(d.cliente.valor_centavos)} já caiu na sua conta. A loja começa a ser criada na hora.`, rotulo: "Sim, recebi" });
      if (!ok) return;
      return agir(alvo, async () => { d = await api("POST", `clientes/${id}/pagamento-recebido`, {}); desenhar(); toast("Pagamento confirmado. Criando a loja…"); acompanhar(); });
    }
    if (acao === "reenviar-cobranca") return agir(alvo, async () => { d = await api("POST", `clientes/${id}/reenviar`, { tipo: "cobranca" }); desenhar(); toast("E-mail reenviado."); });
    if (acao === "reenviar-convite") return agir(alvo, async () => { d = await api("POST", `clientes/${id}/reenviar`, { tipo: "convite" }); desenhar(); toast("Convite reenviado."); });
    if (acao === "cobrar") return agir(alvo, async () => { d = await api("POST", `clientes/${id}/cobrar`, {}); desenhar(); toast("Nova cobrança criada (a anterior foi cancelada)."); });
    if (acao === "cancelar") {
      const ok = await confirmar({ titulo: "Cancelar cadastro?", mensagem: "A cobrança deixa de valer. Os dados continuam guardados para consulta.", rotulo: "Cancelar cadastro", perigo: true });
      if (ok) return agir(alvo, async () => { d = await api("POST", `clientes/${id}/cancelar`, {}); desenhar(); });
      return;
    }
    if (acao === "tentar") return agir(alvo, async () => { d = await api("POST", `clientes/${id}/tentar-de-novo`, {}); desenhar(); acompanhar(); });
    if (acao === "convite") return agir(alvo, async () => { const r = await api("POST", `clientes/${id}/convite`, {}); d = r; desenhar(); toast(r.email_enviado ? "Link novo gerado e enviado por e-mail." : "Link novo gerado."); });
    if (acao === "senha") {
      return agir(alvo, async () => {
        const r = await api("POST", `clientes/${id}/redefinir-senha`, {});
        await carregar();
        const msg = `Olá, ${d.cliente.nome.split(" ")[0]}! Para criar uma senha nova no painel da ${d.cliente.nome_loja}, use este link (vale por pouco tempo): ${r.link}`;
        montar(modal.el.querySelector("[data-resultado-suporte]"), html`
          <div class="bloco-link">
            <p class="bloco-link__rotulo">Link para criar senha nova ${r.email_enviado && html`<small>· enviado por e-mail</small>`}</p>
            <div class="convite-pronto__link"><code>${r.link}</code></div>
            <div class="convite-pronto__botoes">
              <button type="button" class="btn btn--primario btn--pequeno" data-copiar="${r.link}">${icone("copiar", { tamanho: 15 })} Copiar</button>
              <a class="btn btn--whats btn--pequeno" href="${linkWhats(msg, d.cliente.telefone)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
            </div>
          </div>`);
      });
    }
    if (acao === "editar") return editar();
  });

  modal.el.addEventListener("submit", async (ev) => {
    if (!ev.target.matches("[data-nota]")) return;
    ev.preventDefault();
    const texto = ev.target.texto.value.trim();
    if (!texto) return;
    await agir(ev.target.querySelector("button"), async () => { d = await api("POST", `clientes/${id}/notas`, { texto }); desenhar(); });
  });

  function editar() {
    const c = d.cliente;
    const pode = c.situacao === "aguardando_pagamento";
    const m2 = abrirModal({
      titulo: "Editar dados", largura: 600,
      corpo: html`<form id="form-editar" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        <div class="grade-2">
          ${campo({ nome: "nome", rotulo: "Nome completo", valor: c.nome, obrigatorio: true })}
          ${campo({ nome: "email", rotulo: "E-mail", tipo: "email", valor: c.email, obrigatorio: true })}
          ${campo({ nome: "telefone", rotulo: "WhatsApp", tipo: "tel", mascara: "telefone", valor: telefoneBonito(c.telefone) })}
          ${campo({ nome: "documento", rotulo: "CPF ou CNPJ", valor: documentoBonito(c.documento) })}
          ${pode && campo({ nome: "nome_loja", rotulo: "Nome da loja", valor: c.nome_loja, obrigatorio: true })}
          ${pode && campo({ nome: "valor", rotulo: "Valor (R$)", mascara: "moeda", valor: emReais(c.valor_centavos), ajuda: "Mudar o valor gera uma cobrança nova." })}
        </div>
        ${campo({ nome: "observacoes", rotulo: "Observações", tipo: "textarea", linhas: 2, valor: c.observacoes })}
      </form>`,
      rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-editar" class="btn btn--primario">Salvar</button>`,
    });
    const form = m2.el.querySelector("form");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const dados = dadosDe(form);
      const corpo = { ...dados };
      if (pode) { if (paraCentavos(dados.valor) !== c.valor_centavos) corpo.valor_centavos = paraCentavos(dados.valor); if (dados.nome_loja === c.nome_loja) delete corpo.nome_loja; }
      delete corpo.valor;
      await ocupado(m2.el.querySelector('[form="form-editar"]'), async () => {
        try { d = await api("PUT", `clientes/${id}`, corpo); m2.fechar(); desenhar(); toast("Dados atualizados."); }
        catch (erro) { mostrarErros(form, erro); }
      });
    });
  }

  carregar().then(acompanhar);
}
