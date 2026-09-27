/* PÁGINA — equipe: administradores com acesso ao painel */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { dataBR, iniciais, tempoRelativo } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";
import { PAPEIS } from "../nucleo/permissoes.js";
import { cabecalhoPagina, carregandoPagina, erroPagina } from "../componentes/pagina.js";

export async function equipe(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let lista;
  const carregar = async () => { lista = (await api.get("/equipe")).equipe; };
  try { await carregar(); } catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  function desenhar() {
    montar(ctx.raiz, html`
      ${cabecalhoPagina({
        titulo: "Equipe", descricao: "Quem pode entrar neste painel. Administrador vê e altera tudo; atendente cuida só de pedidos, agenda e produção.",
        acoes: html`<button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Adicionar pessoa</button>`,
      })}
      <div class="cartao cartao--sem-margem"><ul class="lista-linhas">${lista.map((u) => html`
        <li class="${!u.ativo && "linha-inativa"}">
          <span class="avatar">${iniciais(u.nome)}</span>
          <div class="lista-linhas__texto"><strong>${u.nome} ${u.id === estado.usuario.id && html`<span class="badge">Você</span>`}</strong>
            <small class="texto-suave">${u.email} · desde ${dataBR(u.criado_em.slice(0, 10))}${u.ultimo_acesso ? ` · acesso ${tempoRelativo(u.ultimo_acesso)}` : ""}</small></div>
          <span class="badge ${u.papel === "admin" ? "badge--info" : "badge--neutro"}">${PAPEIS[u.papel] ?? u.papel}</span>
          <span class="badge ${u.ativo ? "badge--sucesso" : "badge--neutro"}">${u.ativo ? "Ativo" : "Desativado"}</span>
          ${u.id !== estado.usuario.id && html`<button type="button" class="btn btn--suave btn--pequeno" data-acao="papel" data-id="${u.id}">Mudar papel</button>
            <button type="button" class="btn ${u.ativo ? "btn--perigo-suave" : "btn--suave"} btn--pequeno" data-acao="alternar" data-id="${u.id}">${u.ativo ? "Desativar" : "Reativar"}</button>`}
        </li>`)}</ul></div>`);
  }

  delegar(ctx.raiz, {
    novo: () => {
      const m = abrirModal({
        titulo: "Dar acesso ao painel", largura: 460,
        corpo: html`<form id="form-equipe" novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          <p class="texto-suave">A pessoa precisa primeiro <strong>criar uma conta na loja</strong> (com o e-mail que ela usa). Depois é só informar esse e-mail aqui.</p>
          ${campo({ nome: "email", rotulo: "E-mail da conta", tipo: "email", obrigatorio: true, atributos: 'autofocus' })}
          ${campo({ nome: "papel", rotulo: "Papel", tipo: "select", valor: "atendente", opcoes: [{ valor: "atendente", texto: "Atendente — pedidos, agenda e produção" }, { valor: "admin", texto: "Administrador — acesso total" }] })}</form>`,
        rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-equipe" class="btn btn--primario" data-salvar>Dar acesso</button>`,
      });
      const form = m.el.querySelector("form");
      ativarCampos(form);
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await ocupado(m.el.querySelector("[data-salvar]"), async () => {
          try { await api.post("/equipe", dadosDe(form)); await carregar(); toast("Acesso liberado!"); m.fechar(); desenhar(); }
          catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
        });
      });
    },
    papel: (el) => {
      const u = lista.find((x) => x.id === el.dataset.id);
      const m = abrirModal({
        titulo: `Papel de ${u.nome}`, largura: 460,
        corpo: html`<form id="form-papel" novalidate>
          <div class="form-erro" data-erro-geral hidden></div>
          ${campo({ nome: "papel", rotulo: "Papel", tipo: "select", valor: u.papel, opcoes: [{ valor: "atendente", texto: "Atendente — pedidos, agenda e produção" }, { valor: "admin", texto: "Administrador — acesso total" }, { valor: "cliente", texto: "Sem acesso ao painel (volta a ser só cliente)" }] })}</form>`,
        rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-papel" class="btn btn--primario" data-salvar>Salvar</button>`,
      });
      const form = m.el.querySelector("form");
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await ocupado(m.el.querySelector("[data-salvar]"), async () => {
          try { await api.post("/equipe", { email: u.email, papel: dadosDe(form).papel }); await carregar(); toast("Papel atualizado."); m.fechar(); desenhar(); }
          catch (erro) { mostrarErros(form, erro, (msg) => toast(msg, "erro")); }
        });
      });
    },
    alternar: async (el) => {
      const u = lista.find((x) => x.id === el.dataset.id); // o id da pessoa é um UUID (texto)
      try { await api.patch(`/equipe/${u.id}`, { ativo: !u.ativo }); await carregar(); toast(u.ativo ? "Acesso desativado." : "Acesso reativado.", "info"); desenhar(); }
      catch (erro) { toast(erro.message, "erro"); }
    },
  });
  desenhar();
}
