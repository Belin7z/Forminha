/* TELA — Atividade (só o dono): quem entrou e o que fez na Central, com filtro por pessoa */
import { html, montar } from "/src/scripts/base/html.js";
import { api, aviso, quandoCurto } from "../nucleo.js";

export async function telaAtividade(conteiner) {
  document.title = "Atividade — Forminha";
  let filtro = "";
  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Atividade</h1></div>
      <select class="entrada entrada--compacta" data-filtro aria-label="Filtrar por pessoa"><option value="">Todos</option><option value="dono">Dono</option></select>
    </div>
    <section data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>`);

  const lista = conteiner.querySelector("[data-lista]");
  const select = conteiner.querySelector("[data-filtro]");

  // a equipe entra no filtro (se não carregar, fica só "Todos" e "Dono")
  api("GET", "equipe").then(({ funcionarios }) => {
    montar(select, html`<option value="">Todos</option><option value="dono">Dono</option>${funcionarios.map((f) => html`<option value="${f.id}">${f.usuario} · ${f.nome.split(" ")[0]}</option>`)}`);
    select.value = filtro;
  }).catch(() => {});

  async function carregar() {
    try {
      const { atividades } = await api("GET", `atividades${filtro ? `?quem=${encodeURIComponent(filtro)}` : ""}`);
      montar(lista, atividades.length ? html`
        <div class="tabela tabela--atividades" role="table" aria-label="Atividade">
          <div class="tabela__linha tabela__cab" role="row"><span>Quando</span><span>Quem</span><span>Ação</span><span>Loja / pessoa</span></div>
          ${atividades.map((a) => html`
            <div class="tabela__linha" role="row">
              <span class="tabela__suave">${quandoCurto(a.em)}</span>
              <span class="tabela__mono">${a.usuario}</span>
              <span>${a.acao}</span>
              <span class="tabela__suave ${!a.alvo && "tabela__vazio"}">${a.alvo || "—"}</span>
            </div>`)}
        </div>` : html`<p class="texto-suave">Nada por aqui ainda.</p>`);
    } catch (erro) { montar(lista, aviso("perigo", erro.message)); }
  }

  select.addEventListener("change", () => { filtro = select.value; carregar(); });
  await carregar();
}
