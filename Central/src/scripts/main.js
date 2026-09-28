/* ==========================================================
   CENTRAL DA FORMINHA — decide qual tela mostrar.
     #/pagar/<link>   página de pagamento da cliente (pública)
     sem login        entrar
     #/clientes       clientes (início)  ·  #/lojas  ·  #/configuracoes
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { copiar, toast } from "/src/scripts/base/ui.js";
import { api, aviso, marca, quandoExpirar, raiz } from "./nucleo.js";
import { botaoTema } from "./claro-escuro.js";
import { telaEntrar } from "./telas/entrar.js";
import { telaClientes } from "./telas/clientes.js";
import { telaLojas } from "./telas/lojas.js";
import { telaConfiguracoes } from "./telas/configuracoes.js";
import { telaPagar } from "./telas/pagar.js";

const ABAS = [["clientes", "Clientes", "usuarios"], ["lojas", "Lojas", "home"], ["configuracoes", "Configurações", "ajustes"]];

async function rotear() {
  const pagar = /^#\/pagar\/([A-Za-z0-9_-]{20,64})$/.exec(location.hash);
  if (pagar) return telaPagar(pagar[1]);
  const eu = await api("GET", "eu").catch(() => ({ logado: false }));
  if (!eu.logado) return telaEntrar(rotear);
  const aba = ABAS.find(([id]) => location.hash.startsWith(`#/${id}`))?.[0] ?? "clientes";
  montar(raiz, html`
    <div class="central">
      <header class="topo-central">
        ${marca}
        <nav class="abas-central" aria-label="Seções">${ABAS.map(([id, texto, ic]) => html`
          <a href="#/${id}" class="abas-central__item ${id === aba && "abas-central__item--ativa"}" ${id === aba && html`aria-current="page"`}>${icone(ic, { tamanho: 16 })}<span>${texto}</span></a>`)}</nav>
        <div class="topo-central__acoes">${botaoTema()}<button type="button" class="btn btn--suave btn--pequeno" data-acao="sair">${icone("sair", { tamanho: 15 })}<span class="some-no-celular">Sair</span></button></div>
      </header>
      <main class="central__corpo">
        ${eu.simulado && aviso("info", html`<strong>Modo de teste:</strong> nada é criado de verdade no Supabase, na Vercel nem no Mercado Pago; e-mails aparecem só no terminal.`)}
        ${eu.faltando?.length > 0 && !eu.simulado && aviso("aviso", html`Falta configurar: <strong>${eu.faltando.join(", ")}</strong>. Veja em <a class="link" href="#/configuracoes">Configurações</a>.`)}
        <div data-conteudo></div>
      </main>
    </div>`);
  const conteudo = raiz.querySelector("[data-conteudo]");
  if (aba === "clientes") await telaClientes(conteudo, eu);
  else if (aba === "lojas") await telaLojas(conteudo);
  else await telaConfiguracoes(conteudo, eu);
}

raiz.addEventListener("click", async (ev) => {
  if (!ev.target.closest('[data-acao="sair"]')) return;
  await api("POST", "sair", {}).catch(() => {});
  history.replaceState(null, "", "#/");
  telaEntrar(rotear);
});
// qualquer botão com data-copiar copia o texto dele
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copiar]");
  if (!b) return;
  await copiar(b.dataset.copiar);
  toast("Copiado.");
});

quandoExpirar(() => telaEntrar(rotear, "Sua sessão terminou. Entre de novo."));
window.addEventListener("hashchange", rotear);
rotear();
