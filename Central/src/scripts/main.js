/* ==========================================================
   CENTRAL DA FORMINHA — decide qual tela mostrar.
     #/pagar/<link>   página de pagamento da cliente (pública)
     sem login        entrar
     senha temporária funcionário cria a própria senha
     #/clientes · #/lojas · #/equipe · #/configuracoes  (cada aba só
     aparece para quem tem a permissão; o servidor confere de novo)
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { copiar, toast } from "/src/scripts/base/ui.js";
import { api, aviso, marca, pode, quandoExpirar, raiz } from "./nucleo.js";
import { botaoTema } from "./claro-escuro.js";
import { telaEntrar } from "./telas/entrar.js";
import { telaClientes } from "./telas/clientes.js";
import { telaLojas } from "./telas/lojas.js";
import { telaEquipe } from "./telas/equipe.js";
import { telaConfiguracoes } from "./telas/configuracoes.js";
import { telaPagar } from "./telas/pagar.js";
import { telaPrimeiraSenha, trocarMinhaSenha } from "./telas/minha-senha.js";

const ABAS = [
  ["clientes", "Clientes", "usuarios", "clientes.ver"], ["lojas", "Lojas", "home", "lojas.ver"],
  ["equipe", "Equipe", "usuario", "equipe"], ["configuracoes", "Configurações", "ajustes", "configuracoes"],
];

/** Quem está usando: "Dono" ou "Ana · FMV-0427 · Vendedor" (funcionário troca a própria senha por aqui). */
function quemEsta(eu) {
  if (eu.quem?.tipo !== "funcionario") return html`<span class="quem-esta quem-esta--dono">${icone("usuario", { tamanho: 15 })}<span class="some-no-celular">Dono</span></span>`;
  const q = eu.quem;
  return html`<button type="button" class="quem-esta" data-acao="minha-senha" title="Trocar minha senha">
    ${icone("usuario", { tamanho: 15 })}<span><strong>${String(q.nome).split(" ")[0]}</strong><small class="some-no-celular">${q.usuario} · ${q.funcao_nome}</small></span></button>`;
}

async function rotear() {
  const pagar = /^#\/pagar\/([A-Za-z0-9_-]{20,64})$/.exec(location.hash);
  if (pagar) return telaPagar(pagar[1]);
  const eu = await api("GET", "eu").catch(() => ({ logado: false }));
  if (!eu.logado) return telaEntrar(rotear);
  if (eu.quem?.trocar_senha) return telaPrimeiraSenha(eu, rotear);
  const abas = ABAS.filter(([, , , permissao]) => pode(eu, permissao));
  const aba = abas.find(([id]) => location.hash.startsWith(`#/${id}`))?.[0] ?? abas[0]?.[0];
  montar(raiz, html`
    <div class="central">
      <header class="topo-central">
        ${marca}
        <nav class="abas-central" aria-label="Seções">${abas.map(([id, texto, ic]) => html`
          <a href="#/${id}" class="abas-central__item ${id === aba && "abas-central__item--ativa"}" ${id === aba && html`aria-current="page"`}>${icone(ic, { tamanho: 16 })}<span>${texto}</span></a>`)}</nav>
        <div class="topo-central__acoes">${botaoTema()}${quemEsta(eu)}<button type="button" class="btn btn--suave btn--pequeno" data-acao="sair">${icone("sair", { tamanho: 15 })}<span class="some-no-celular">Sair</span></button></div>
      </header>
      <main class="central__corpo">
        ${eu.simulado && aviso("info", html`<strong>Modo de teste:</strong> nada é criado de verdade no Supabase, na Vercel nem no Mercado Pago; e-mails aparecem só no terminal.`)}
        ${eu.faltando?.length > 0 && !eu.simulado && aviso("aviso", html`Falta configurar: <strong>${eu.faltando.join(", ")}</strong>. Veja em <a class="link" href="#/configuracoes">Configurações</a>.`)}
        ${eu.chaves?.map((c) => aviso(c.dias <= 7 ? "perigo" : "aviso", html`<strong>${c.texto}.</strong> Crie uma nova e rode <code>npm run configurar</code> na pasta Central (opção ${c.opcao}).`))}
        <div data-conteudo></div>
      </main>
    </div>`);
  const conteudo = raiz.querySelector("[data-conteudo]");
  if (aba === "clientes") await telaClientes(conteudo, eu);
  else if (aba === "lojas") await telaLojas(conteudo, eu);
  else if (aba === "equipe") await telaEquipe(conteudo, eu);
  else if (aba === "configuracoes") await telaConfiguracoes(conteudo, eu);
}

raiz.addEventListener("click", async (ev) => {
  if (ev.target.closest('[data-acao="minha-senha"]')) return trocarMinhaSenha();
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
