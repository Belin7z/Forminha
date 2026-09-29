/* ==========================================================
   TELA — banco único das lojas (Configurações, só o dono):
   explica, prepara por etapas (com o progresso na tela) e, depois,
   atualiza as tabelas quando vierem migrações novas.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { api, aviso, dorme } from "../nucleo.js";

const PASSO = {
  aguardar: "Criando o banco no Supabase (leva 1 a 2 minutos)…",
  tabelas: "Criando as tabelas…",
  sites: "Criando os 2 sites de todas as lojas na Vercel…",
  login: "Ajustando o login das clientes…",
};
const semHttps = (u) => String(u ?? "").replace(/^https?:\/\//, "");

function vista(e) {
  if (e.etapa === "nao_preparado") {
    return html`
      <div class="banco-unico">
        <p>Hoje cada loja ganha um banco próprio no Supabase (o plano grátis deixa só 2). Com o <strong>banco único</strong>,
          todas as lojas novas moram no mesmo banco e nos mesmos 2 sites:</p>
        <ul class="banco-unico__lista">
          <li>${icone("check", { tamanho: 15 })} a loja fica pronta em segundos (sem esperar o Supabase);</li>
          <li>${icone("check", { tamanho: 15 })} sem limite de projetos — o custo não cresce loja a loja;</li>
          <li>${icone("check", { tamanho: 15 })} cada loja só enxerga os dados dela (a trava fica no próprio banco).</li>
        </ul>
        <p class="texto-suave">As lojas que já existem continuam como estão. Preparar leva uns 3 minutos; pode deixar a tela aberta.</p>
        <div><button type="button" class="btn btn--primario" data-acao-bu="preparar">${icone("mais", { tamanho: 16 })} Preparar o banco único</button></div>
        <p class="banco-unico__progresso" data-progresso hidden></p>
      </div>`;
  }
  if (e.etapa !== "pronto") {
    return html`
      <div class="banco-unico">
        ${aviso("aviso", html`A preparação parou no meio: <strong>${PASSO[e.etapa] ?? e.etapa}</strong>`)}
        <div><button type="button" class="btn btn--primario" data-acao-bu="preparar">${icone("atualizar", { tamanho: 16 })} Continuar</button></div>
        <p class="banco-unico__progresso" data-progresso hidden></p>
      </div>`;
  }
  return html`
    <div class="banco-unico">
      <p class="banco-unico__ok">${icone("checkCirculo", { tamanho: 17 })}<span>Ligado: as lojas novas já nascem no banco único.</span></p>
      <dl class="dados-empilhados">
        <div><dt>Site das lojas</dt><dd><a class="link" href="${e.loja}" target="_blank" rel="noopener">${semHttps(e.loja)}</a></dd></div>
        <div><dt>Site dos painéis</dt><dd><a class="link" href="${e.painel}" target="_blank" rel="noopener">${semHttps(e.painel)}</a></dd></div>
        ${e.total && html`<div><dt>Tabelas</dt><dd>${e.feitas} de ${e.total}${e.atualizar ? " — tem atualização" : " — em dia"}</dd></div>`}
      </dl>
      ${e.atualizar && html`<div><button type="button" class="btn btn--primario btn--pequeno" data-acao-bu="preparar">${icone("atualizar", { tamanho: 15 })} Atualizar as tabelas</button></div>`}
      <p class="banco-unico__progresso" data-progresso hidden></p>
    </div>`;
}

/** Monta o cartão em `conteiner`. */
export async function cartaoBancoUnico(conteiner) {
  let atual;
  try { atual = await api("GET", "banco-unico"); }
  catch (erro) { montar(conteiner, aviso("aviso", erro.message)); return; }
  const desenhar = () => montar(conteiner, vista(atual));

  /** Chama a preparação de novo até terminar (cada chamada faz um pedaço). */
  async function preparar(botao) {
    const progresso = conteiner.querySelector("[data-progresso]");
    progresso.hidden = false;
    await ocupado(botao, async () => {
      try {
        for (let i = 0; i < 300; i++) {
          const r = await api("POST", "banco-unico/preparar", {});
          atual = r;
          if (r.etapa === "pronto" && !r.aplicada) break;
          progresso.textContent = r.aplicada ? `Tabelas: ${r.feitas} de ${r.total}…` : PASSO[r.etapa] ?? "Preparando…";
          if (r.etapa === "aguardar") await dorme(5000);
        }
        toast(atual.etapa === "pronto" ? "Banco único pronto." : "Ainda não terminou. Clique em Continuar.", atual.etapa === "pronto" ? "sucesso" : "info");
      } catch (erro) { toast(erro.message, "erro"); }
    });
    desenhar();
  }

  conteiner.addEventListener("click", (ev) => {
    const botao = ev.target.closest("[data-acao-bu]");
    if (botao?.dataset.acaoBu === "preparar") preparar(botao);
  });
  desenhar();
}
