/* ==========================================================
   BASE — tela do domínio próprio de uma loja (ex.: suadoceria.com.br).
   Igual no painel da dona e na Central: mostra os endereços, os
   registros de DNS que faltam criar e liga/troca/tira o domínio.
   Quem chama a Central muda de um lado para o outro (`chamar`).
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";

const SITUACAO = { ok: ["Funcionando", "sucesso"], parcial: ["Funcionando em parte", "aviso"], aguardando: ["Aguardando o DNS", "aviso"] };
const PAPEL = { loja: "Loja", atalho: "Atalho para a loja", painel: "Painel" };
const semHttps = (u) => String(u ?? "").replace(/^https?:\/\//, "");

/** Os registros de todos os endereços, sem repetir. */
export function registrosDe(info) {
  const mapa = new Map();
  for (const e of info.enderecos ?? []) {
    for (const r of e.registros ?? []) {
      const chave = `${r.tipo}|${r.nome}|${r.valor}`;
      const antes = mapa.get(chave);
      mapa.set(chave, { ...r, ok: antes ? antes.ok && r.ok : r.ok });
    }
  }
  return [...mapa.values()];
}

const formDominio = (info) => html`
  <form class="dns__form" data-form-dominio novalidate>
    <div class="form-erro" data-erro-geral hidden></div>
    ${campo({ nome: "dominio", rotulo: "Domínio", valor: info.dominio ?? "", obrigatorio: true, placeholder: "suadoceria.com.br", atributos: 'autocomplete="off" spellcheck="false" autocapitalize="off"' })}
    ${interruptor({ nome: "painel", rotulo: "Usar também painel.seudominio para abrir o painel", marcado: info.dominio ? info.painel : true })}
    <div><button type="submit" class="btn btn--primario">${info.dominio ? "Salvar" : "Ligar domínio"}</button></div>
  </form>`;

const tabelaDns = (registros) => html`
  <div class="dns__registros" role="table" aria-label="Registros de DNS">
    <div class="dns__linha dns__linha--cab" role="row"><span role="columnheader">Tipo</span><span role="columnheader">Nome</span><span role="columnheader">Valor</span><span role="columnheader">Situação</span></div>
    ${registros.map((r) => html`
      <div class="dns__linha" role="row">
        <span role="cell" data-rotulo="Tipo"><strong>${r.tipo}</strong></span>
        <span role="cell" data-rotulo="Nome"><code>${r.nome}</code></span>
        <span role="cell" class="dns__valor"><code>${r.valor}</code>
          <button type="button" class="dns__copiar" data-copiar-dns="${r.valor}" title="Copiar" aria-label="Copiar o valor">${icone("copiar", { tamanho: 15 })}</button></span>
        <span role="cell" class="dns__status ${r.ok && "dns__status--ok"}">${r.ok ? html`${icone("check", { tamanho: 14 })} Pronto` : "Falta criar"}</span>
      </div>`)}
  </div>`;

export function vistaDominio(info) {
  if (!info.dominio) {
    return html`
      <div class="dns" tabindex="-1">
        <p class="dns__passo">Use um endereço só seu, como <strong>suadoceria.com.br</strong>. Até o novo ficar pronto, a loja continua em
          <a class="link" href="${info.endereco_loja}" target="_blank" rel="noopener">${semHttps(info.endereco_loja)}</a>.</p>
        ${formDominio(info)}
        <p class="dns__dica">Ainda não tem domínio? Compre no <a class="link" href="https://registro.br" target="_blank" rel="noopener">Registro.br</a> (para .com.br) ou em outro site de domínios e volte aqui.</p>
      </div>`;
  }
  const [rotulo, tom] = SITUACAO[info.situacao] ?? SITUACAO.aguardando;
  const registros = registrosDe(info);
  const faltam = registros.filter((r) => !r.ok).length;
  return html`
    <div class="dns" tabindex="-1">
      <div class="dns__cab"><strong class="dns__dominio">${info.dominio}</strong><span class="badge badge--${tom}">${rotulo}</span></div>
      <ul class="dns__enderecos">${(info.enderecos ?? []).map((e) => html`
        <li>
          <span class="dns__marca ${e.ok && "dns__marca--ok"}">${icone(e.ok ? "checkCirculo" : "relogio", { tamanho: 17 })}</span>
          <span class="dns__host">${e.ok ? html`<a class="link" href="https://${e.host}" target="_blank" rel="noopener">${e.host}</a>` : e.host}</span>
          <span class="dns__papel">${PAPEL[e.atalho ? "atalho" : e.site]}</span>
        </li>`)}</ul>
      ${faltam ? html`
        <p class="dns__passo">No site onde o domínio foi comprado (Registro.br, Hostinger, GoDaddy…), abra <strong>DNS</strong> ou <strong>Zona</strong> e crie ${faltam === 1 ? "este registro" : "estes registros"}:</p>
        ${tabelaDns(registros)}
        <p class="dns__dica">Já existe um registro com o mesmo nome e tipo? Troque o valor. “@” é o domínio sem nada antes (no Registro.br, deixe o nome em branco). Depois de salvar, leva de alguns minutos a algumas horas; a loja continua funcionando no endereço de hoje.</p>`
      : html`<p class="dns__passo dns__passo--ok">${icone("checkCirculo", { tamanho: 16 })}<span>A loja abre em <a class="link" href="${info.endereco_loja}" target="_blank" rel="noopener">${semHttps(info.endereco_loja)}</a>.</span></p>`}
      <div class="dns__botoes">
        ${faltam > 0 && html`<button type="button" class="btn btn--primario btn--pequeno" data-acao-dns="conferir">${icone("atualizar", { tamanho: 15 })} Conferir agora</button>`}
        <button type="button" class="btn btn--perigo-suave btn--pequeno" data-acao-dns="tirar">Tirar o domínio</button>
      </div>
      <details class="dns__trocar"><summary>Trocar de domínio ou mudar o painel</summary>${formDominio(info)}</details>
    </div>`;
}

/**
 * Desenha e liga a tela no `conteiner`.
 * chamar(metodo, "" | "conferir", corpo) -> a situação nova (a Central devolve sempre o mesmo formato).
 */
export function montarDominio(conteiner, info, { chamar, aoMudar = () => {} }) {
  let atual = info;
  let conferindo = false;

  /** focar: depois de uma ação da pessoa, o foco fica na tela nova (senão ele se perde e o Esc deixa de fechar a janela). */
  function desenhar({ focar = false } = {}) {
    montar(conteiner, vistaDominio(atual));
    if (focar) conteiner.querySelector(".dns")?.focus({ preventScroll: true });
    const form = conteiner.querySelector("[data-form-dominio]");
    ativarCampos(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = dadosDe(form);
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          atual = await chamar("POST", "", { dominio: d.dominio, painel: d.painel });
          toast(atual.situacao === "ok" ? "Domínio ligado e funcionando!" : "Domínio ligado. Agora crie os registros de DNS.");
          desenhar({ focar: true });
          aoMudar(atual);
        } catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
      });
    });
  }

  async function conferir(botao, { avisar = true } = {}) {
    if (conferindo) return;
    conferindo = true;
    const focar = Boolean(botao) || conteiner.contains(document.activeElement);
    const tarefa = async () => {
      try {
        const antes = atual.situacao;
        atual = await chamar("POST", "conferir", {});
        if (avisar) toast(atual.situacao === "ok" ? "Tudo certo: o domínio está funcionando!" : atual.situacao !== antes ? "Parte já está funcionando." : "Ainda não. O DNS pode levar algumas horas.", atual.situacao === "ok" ? "sucesso" : "info");
        desenhar({ focar });
        if (atual.mudou) aoMudar(atual);
      } catch (erro) { if (avisar) toast(erro.message, "erro"); }
    };
    try { await (botao ? ocupado(botao, tarefa) : tarefa()); } finally { conferindo = false; }
  }

  conteiner.addEventListener("click", async (ev) => {
    const copia = ev.target.closest("[data-copiar-dns]");
    if (copia) { await copiar(copia.dataset.copiarDns); toast("Copiado."); return; }
    const botao = ev.target.closest("[data-acao-dns]");
    if (!botao) return;
    if (botao.dataset.acaoDns === "conferir") return conferir(botao);
    if (botao.dataset.acaoDns === "tirar") {
      const ok = await confirmar({
        titulo: "Tirar o domínio?", perigo: true, rotulo: "Tirar",
        mensagem: `A loja volta para o endereço da Forminha. O domínio ${atual.dominio} continua sendo seu; só deixa de abrir a loja.`,
      });
      if (!ok) return;
      await ocupado(botao, async () => {
        try { atual = await chamar("DELETE", "", {}); toast("Domínio tirado."); desenhar({ focar: true }); aoMudar(atual); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
  });

  desenhar();
  if (atual.mudou) aoMudar(atual); // ao abrir, o domínio já estava pronto e a loja passou a usá-lo
  // abriu com o domínio ainda pendente: confere sozinho (o DNS pode ter ficado pronto)
  if (atual.dominio && atual.situacao !== "ok") conferir(null, { avisar: false });
}
