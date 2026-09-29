/* ==========================================================
   TELA — domínio da Forminha (ex.: forminha.com.br):
   • em Configurações: ligar o domínio na Central, os registros de
     DNS (raiz, www e o coringa "*" das lojas) e dar o endereço
     novo às lojas que já existiam;
   • na janela "Domínio" de cada loja: o endereço dela embaixo do
     domínio (anadoces.forminha.com.br), trocar o nome ou tirar.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { registrosDe, tabelaDns } from "/src/scripts/base/dns.js";
import { api, aviso } from "../nucleo.js";

const SITUACAO = { ok: ["Funcionando", "sucesso"], parcial: ["Funcionando em parte", "aviso"], aguardando: ["Aguardando o DNS", "aviso"] };
const PAPEL = { central: "Central", atalho: "Atalho para a Central", lojas: "Endereços das lojas", loja: "Loja", painel: "Painel" };

const listaDeEnderecos = (enderecos) => html`
  <ul class="dns__enderecos">${enderecos.map((e) => html`
    <li>
      <span class="dns__marca ${e.ok && "dns__marca--ok"}">${icone(e.ok ? "checkCirculo" : "relogio", { tamanho: 17 })}</span>
      <span class="dns__host">${e.ok && !e.host.startsWith("*") ? html`<a class="link" href="https://${e.host}" target="_blank" rel="noopener">${e.host}</a>` : e.host}</span>
      <span class="dns__papel">${PAPEL[e.site] ?? ""}</span>
    </li>`)}</ul>`;

/* ---------- Configurações: o domínio da Forminha ---------- */

function vistaCentral(info) {
  if (!info.dominio) {
    return html`
      <div class="dns" tabindex="-1">
        <p class="dns__passo">Com um domínio seu, a Central abre nele (ex.: <strong>forminha.com.br</strong>) e cada loja ganha um endereço como <strong>anadoces.forminha.com.br</strong>.</p>
        <form class="dns__form" data-form-central novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "dominio", rotulo: "Domínio", obrigatorio: true, placeholder: "forminha.com.br", atributos: 'autocomplete="off" spellcheck="false" autocapitalize="off"' })}
          <div><button type="submit" class="btn btn--primario">Ligar domínio</button></div>
        </form>
        <p class="dns__dica">Ainda não tem? Compre no <a class="link" href="https://registro.br" target="_blank" rel="noopener">Registro.br</a> (para .com.br). Até ficar pronto, tudo continua funcionando como hoje.</p>
      </div>`;
  }
  const [rotulo, tom] = SITUACAO[info.situacao] ?? SITUACAO.aguardando;
  const registros = registrosDe(info);
  const faltam = registros.filter((r) => !r.ok).length;
  return html`
    <div class="dns" tabindex="-1">
      <div class="dns__cab"><strong class="dns__dominio">${info.dominio}</strong><span class="badge badge--${tom}">${rotulo}</span></div>
      ${listaDeEnderecos(info.enderecos ?? [])}
      ${faltam ? html`
        <p class="dns__passo">No site onde o domínio foi comprado (Registro.br, Hostinger, GoDaddy…), abra <strong>DNS</strong> ou <strong>Zona</strong> e crie ${faltam === 1 ? "este registro" : "estes registros"}:</p>
        ${tabelaDns(registros)}
        <p class="dns__dica">“@” é o domínio sem nada antes (no Registro.br, deixe o nome em branco). O “*” (coringa) faz qualquer nome antes do domínio chegar à Vercel: é ele que dá endereço às lojas. Depois de salvar, leva de alguns minutos a algumas horas.</p>`
      : html`<p class="dns__passo dns__passo--ok">${icone("checkCirculo", { tamanho: 16 })}<span>A Central abre em <a class="link" href="https://${info.dominio}" target="_blank" rel="noopener">${info.dominio}</a> e as lojas novas já nascem com endereço nele.</span></p>`}
      ${info.ativo && html`<p class="dns__dica">Os links novos (pagamento, e-mails) já usam ${info.dominio}. Os antigos, em forminha.vercel.app, continuam funcionando.</p>`}
      <div class="dns__botoes">
        ${faltam > 0 && html`<button type="button" class="btn btn--primario btn--pequeno" data-acao-central="conferir">${icone("atualizar", { tamanho: 15 })} Conferir agora</button>`}
        ${info.coringa && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao-central="lojas">${icone("globo", { tamanho: 15 })} Dar endereço às lojas antigas</button>`}
        <button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao-central="tirar">Tirar o domínio</button>
      </div>
      <p class="dns__passo" data-progresso-lojas hidden></p>
    </div>`;
}

/** Monta o cartão "Domínio da Forminha" em `conteiner` (só o dono vê Configurações). */
export async function cartaoDominioForminha(conteiner) {
  let atual;
  try { atual = await api("GET", "dominio"); }
  catch (erro) { montar(conteiner, aviso("aviso", erro.message)); return; }
  let conferindo = false;

  function desenhar({ focar = false } = {}) {
    montar(conteiner, vistaCentral(atual));
    if (focar) conteiner.querySelector(".dns")?.focus({ preventScroll: true });
    const form = conteiner.querySelector("[data-form-central]");
    if (!form) return;
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          atual = await api("POST", "dominio", dadosDe(form));
          toast("Domínio ligado. Agora crie os registros de DNS.");
          desenhar({ focar: true });
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  async function conferir(botao, { avisar = true } = {}) {
    if (conferindo) return;
    conferindo = true;
    const tarefa = async () => {
      try {
        const antes = atual;
        atual = await api("POST", "dominio/conferir", {});
        if (atual.ativo && !antes.ativo) toast(`A Central já abre em ${atual.dominio}.`, "sucesso", 6000);
        else if (atual.coringa && !antes.coringa) toast("Coringa pronto: as lojas já podem ganhar endereço.", "sucesso", 6000);
        else if (avisar) toast(atual.situacao === "ok" ? "Tudo funcionando!" : "Ainda não. O DNS pode levar algumas horas.", atual.situacao === "ok" ? "sucesso" : "info");
        desenhar({ focar: Boolean(botao) });
      } catch (erro) { if (avisar) toast(erro.message, "erro"); }
    };
    try { await (botao ? ocupado(botao, tarefa) : tarefa()); } finally { conferindo = false; }
  }

  /** As lojas prontas sem endereço na Forminha ganham o delas, uma de cada vez (cada uma leva alguns segundos). */
  async function darEnderecoAsLojas(botao) {
    const progresso = conteiner.querySelector("[data-progresso-lojas]");
    await ocupado(botao, async () => {
      try {
        const lista = (await api("GET", "lojas")).lojas.filter((l) => l.etapa === "pronta" && !l.subdominio);
        if (!lista.length) { toast("Todas as lojas prontas já têm endereço."); return; }
        let feitas = 0;
        const falhas = [];
        progresso.hidden = false;
        for (const l of lista) {
          progresso.textContent = `Ligando ${l.nome} (${feitas + falhas.length + 1} de ${lista.length})…`;
          try { await api("POST", `lojas/${l.ref}/subdominio`, {}); feitas++; }
          catch (erro) { falhas.push(`${l.nome}: ${erro.message}`); }
        }
        progresso.textContent = `${feitas} ${feitas === 1 ? "loja ganhou" : "lojas ganharam"} endereço.${falhas.length ? ` Não deu em ${falhas.length}: ${falhas.join(" · ")}` : ""}`;
        toast(falhas.length ? "Terminei, com alguns problemas." : "Pronto: as lojas ganharam endereço.", falhas.length ? "erro" : "sucesso");
      } catch (erro) { toast(erro.message, "erro"); }
    });
  }

  conteiner.addEventListener("click", async (ev) => {
    const copia = ev.target.closest("[data-copiar-dns]");
    if (copia) { await copiar(copia.dataset.copiarDns); toast("Copiado."); return; }
    const botao = ev.target.closest("[data-acao-central]");
    if (!botao) return;
    const acao = botao.dataset.acaoCentral;
    if (acao === "conferir") return conferir(botao);
    if (acao === "lojas") return darEnderecoAsLojas(botao);
    if (acao === "tirar") {
      const ok = await confirmar({
        titulo: "Tirar o domínio da Forminha?", perigo: true, rotulo: "Tirar",
        mensagem: `A Central volta a abrir só em forminha.vercel.app. As lojas que já têm endereço em ${atual.dominio} continuam com ele até você tirar (em Lojas → Domínio).`,
      });
      if (!ok) return;
      await ocupado(botao, async () => {
        try { atual = await api("DELETE", "dominio", {}); toast("Domínio tirado."); desenhar({ focar: true }); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
  });

  desenhar();
  if (atual.dominio && atual.situacao !== "ok") conferir(null, { avisar: false });
}

/* ---------- Lojas → Domínio: o endereço da loja na Forminha ---------- */

function vistaDaLoja(info) {
  const exemplo = (rotulo) => `Loja: ${rotulo || "nome"}.${info.raiz} · Painel: ${rotulo || "nome"}-painel.${info.raiz}`;
  const form = (valor, texto) => html`
    <form class="dns__form" data-form-sub novalidate>
      <div class="form-erro" data-erro-geral hidden></div>
      ${campo({ nome: "subdominio", rotulo: "Nome no endereço", valor, obrigatorio: true, ajuda: exemplo(valor), atributos: 'autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="50"' })}
      <div><button type="submit" class="btn btn--primario btn--pequeno">${texto}</button></div>
    </form>`;
  if (!info.subdominio && !info.pronta) {
    return html`<div class="dns" tabindex="-1">${aviso("marca", html`Os endereços em <strong>${info.raiz}</strong> ficam disponíveis quando o registro coringa (*) estiver pronto. Veja em <a class="link" href="#/configuracoes">Configurações → Domínio da Forminha</a>.`)}</div>`;
  }
  if (!info.subdominio) {
    return html`<div class="dns" tabindex="-1">
      <p class="dns__passo">Um endereço fácil embaixo do domínio da Forminha, sem a dona precisar comprar nada.</p>
      ${form(info.sugestao, "Ligar endereço")}
    </div>`;
  }
  const [rotulo, tom] = SITUACAO[info.situacao] ?? SITUACAO.aguardando;
  return html`
    <div class="dns" tabindex="-1">
      <div class="dns__cab"><strong class="dns__dominio">${info.host}</strong><span class="badge badge--${tom}">${rotulo}</span></div>
      ${listaDeEnderecos(info.enderecos ?? [])}
      ${info.situacao !== "ok" && html`<p class="dns__dica">A Vercel prepara o endereço em poucos minutos. Se demorar, confira o coringa (*) em Configurações.</p>`}
      <div class="dns__botoes">
        ${info.situacao !== "ok" && html`<button type="button" class="btn btn--primario btn--pequeno" data-acao-sub="conferir">${icone("atualizar", { tamanho: 15 })} Conferir agora</button>`}
        <button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao-sub="tirar">Tirar o endereço</button>
      </div>
      <details class="dns__trocar"><summary>Trocar o nome</summary>${form(info.subdominio, "Salvar")}</details>
    </div>`;
}

/** Desenha o endereço na Forminha da loja em `conteiner`. chamar(metodo, "" | "conferir", corpo) fala com a Central. */
export function montarEnderecoNaForminha(conteiner, info, { chamar, aoMudar = () => {} }) {
  let atual = info;
  conteiner.hidden = !info.raiz;
  if (!info.raiz) return;

  function desenhar({ focar = false } = {}) {
    montar(conteiner, html`<h3 class="dominio-secao__titulo">Endereço na Forminha</h3>${vistaDaLoja(atual)}`);
    if (focar) conteiner.querySelector(".dns")?.focus({ preventScroll: true });
    const form = conteiner.querySelector("[data-form-sub]");
    if (!form) return;
    ativarCampos(form);
    const ajuda = form.querySelector(".campo__ajuda");
    form.subdominio.addEventListener("input", () => {
      const r = form.subdominio.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      ajuda.textContent = `Loja: ${r || "nome"}.${atual.raiz} · Painel: ${r || "nome"}-painel.${atual.raiz}`;
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          atual = await chamar("POST", "", dadosDe(form));
          toast(atual.situacao === "ok" ? `A loja já abre em ${atual.host}.` : "Endereço ligado. Falta a Vercel terminar de preparar.");
          desenhar({ focar: true });
          aoMudar(atual);
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  conteiner.addEventListener("click", async (ev) => {
    const botao = ev.target.closest("[data-acao-sub]");
    if (!botao) return;
    if (botao.dataset.acaoSub === "conferir") {
      await ocupado(botao, async () => {
        try {
          atual = await chamar("POST", "conferir", {});
          toast(atual.situacao === "ok" ? "Funcionando!" : "Ainda não. Tente de novo em alguns minutos.", atual.situacao === "ok" ? "sucesso" : "info");
          desenhar({ focar: true });
          if (atual.mudou) aoMudar(atual);
        } catch (erro) { toast(erro.message, "erro"); }
      });
      return;
    }
    if (botao.dataset.acaoSub === "tirar") {
      const ok = await confirmar({ titulo: "Tirar o endereço?", perigo: true, rotulo: "Tirar", mensagem: `A loja deixa de abrir em ${atual.host} e volta para o endereço da Vercel.` });
      if (!ok) return;
      await ocupado(botao, async () => {
        try { atual = await chamar("DELETE", "", {}); toast("Endereço tirado."); desenhar({ focar: true }); aoMudar(atual); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
  });

  desenhar();
  if (atual.mudou) aoMudar(atual);
}
