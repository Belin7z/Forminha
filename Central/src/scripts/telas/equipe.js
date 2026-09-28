/* ==========================================================
   TELA — Equipe (só o dono): funcionários com usuário próprio
   (FMV-0427) e função. Cadastrar, editar, senha nova, desativar,
   excluir. Embaixo, a atividade: quem fez o quê.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, aviso, linkWhats, quandoCurto } from "../nucleo.js";

const primeiroNome = (nome) => String(nome).split(" ")[0];
const situacao = (f) => (!f.ativo ? ["Desativado", "neutro"] : f.trocar_senha ? ["Pendente", "aviso"] : ["Ativo", "sucesso"]);
const ponto = ([texto, tom]) => html`<span class="ponto ponto--${tom}">${texto}</span>`;

export async function telaEquipe(conteiner) {
  document.title = "Equipe — Forminha";
  let dados = { funcionarios: [], funcoes: [] };
  let filtro = "";

  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Equipe</h1><p class="texto-suave" data-resumo></p></div>
      <button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo funcionário</button>
    </div>
    <section data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>
    <div class="secao-titulo">
      <h2>Atividade</h2>
      <select class="entrada entrada--compacta" data-filtro aria-label="Filtrar por pessoa"><option value="">Todos</option></select>
    </div>
    <section data-atividades></section>`);

  const $ = (s) => conteiner.querySelector(s);

  function desenhar() {
    const ativos = dados.funcionarios.filter((f) => f.ativo).length;
    $("[data-resumo]").textContent = dados.funcionarios.length ? `${ativos} ${ativos === 1 ? "ativo" : "ativos"}` : "";
    montar($("[data-lista]"), dados.funcionarios.length ? html`
      <div class="tabela tabela--equipe" role="table" aria-label="Equipe">
        <div class="tabela__linha tabela__cab" role="row"><span>Nome</span><span>Usuário</span><span>Função</span><span>Situação</span><span>Último acesso</span><span></span></div>
        ${dados.funcionarios.map((f) => html`
          <div class="tabela__linha ${!f.ativo && "tabela__linha--apagada"}" role="row" data-id="${f.id}">
            <span class="tabela__principal"><strong>${f.nome}</strong>
              <small class="so-celular">${f.usuario} · ${f.funcao_nome} · ${situacao(f)[0]}</small></span>
            <span class="tabela__mono">${f.usuario}</span>
            <span>${f.funcao_nome}</span>
            <span>${ponto(situacao(f))}</span>
            <span class="tabela__suave">${f.ultimo_acesso ? quandoCurto(f.ultimo_acesso) : "—"}</span>
            <span class="tabela__acoes">
              <button type="button" class="btn-icone btn-icone--pequeno" data-copiar="${f.usuario}" title="Copiar usuário" aria-label="Copiar usuário">${icone("copiar", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" title="Editar" aria-label="Editar ${f.nome}">${icone("editar", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno" data-acao="senha" title="Senha nova" aria-label="Senha nova para ${f.nome}">${icone("cadeado", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno" data-acao="ativo" title="${f.ativo ? "Desativar" : "Reativar"}" aria-label="${f.ativo ? "Desativar" : "Reativar"} ${f.nome}">${icone(f.ativo ? "xCirculo" : "checkCirculo", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" title="Excluir" aria-label="Excluir ${f.nome}">${icone("lixeira", { tamanho: 16 })}</button>
            </span>
          </div>`)}
      </div>` : html`
      <div class="vazio"><span class="vazio__ico">${icone("usuarios", { tamanho: 36 })}</span><h3>Ninguém na equipe ainda</h3></div>`);

    const select = $("[data-filtro]");
    montar(select, html`<option value="">Todos</option><option value="dono">Dono</option>${dados.funcionarios.map((f) => html`<option value="${f.id}">${f.usuario} · ${primeiroNome(f.nome)}</option>`)}`);
    select.value = filtro;
  }

  async function carregarAtividades() {
    const lista = $("[data-atividades]");
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

  async function carregar() {
    try { dados = await api("GET", "equipe"); desenhar(); }
    catch (erro) { montar($("[data-lista]"), aviso("perigo", erro.message)); }
    carregarAtividades();
  }

  $("[data-filtro]").addEventListener("change", (ev) => { filtro = ev.target.value; carregarAtividades(); });
  conteiner.addEventListener("click", async (ev) => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo || !conteiner.contains(alvo)) return;
    const acao = alvo.dataset.acao;
    if (acao === "novo") return formulario({ funcoes: dados.funcoes, depois: carregar });
    const f = dados.funcionarios.find((x) => x.id === alvo.closest("[data-id]")?.dataset.id);
    if (!f) return;
    const agir = (tarefa) => ocupado(alvo, async () => { try { await tarefa(); await carregar(); } catch (erro) { toast(erro.message, "erro"); } });
    if (acao === "editar") return formulario({ funcionario: f, funcoes: dados.funcoes, depois: carregar });
    if (acao === "senha") {
      if (!(await confirmar({ titulo: "Gerar senha nova?", mensagem: `${primeiroNome(f.nome)} sai da Central e cria outra senha no próximo acesso.`, rotulo: "Gerar" }))) return;
      return agir(async () => mostrarAcesso(await api("POST", `equipe/${f.id}/nova-senha`, {})));
    }
    if (acao === "ativo") {
      if (f.ativo && !(await confirmar({ titulo: `Desativar ${primeiroNome(f.nome)}?`, mensagem: "Sai da Central na hora. Dá para reativar depois.", rotulo: "Desativar", perigo: true }))) return;
      return agir(async () => { await api("POST", `equipe/${f.id}/ativo`, { ativo: !f.ativo }); toast(f.ativo ? "Desativado." : "Reativado."); });
    }
    if (acao === "excluir") {
      if (!(await confirmar({ titulo: `Excluir ${primeiroNome(f.nome)}?`, mensagem: `O usuário ${f.usuario} deixa de existir. A atividade continua registrada.`, rotulo: "Excluir", perigo: true }))) return;
      return agir(async () => { await api("DELETE", `equipe/${f.id}`, {}); toast("Excluído."); });
    }
  });
  await carregar();
}

/* ---------- cadastrar / editar ---------- */
function formulario({ funcionario: f = null, funcoes, depois }) {
  const descricao = (id) => funcoes.find((fn) => fn.id === id)?.descricao ?? "";
  const inicial = f?.funcao ?? "vendedor";
  const modal = abrirModal({
    titulo: f ? "Editar funcionário" : "Novo funcionário", largura: 460,
    corpo: html`
      <form id="form-funcionario" class="form-empilhado" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "nome", rotulo: "Nome", valor: f?.nome ?? "", obrigatorio: true, atributos: 'maxlength="80" autocomplete="off" autofocus' })}
        ${campo({ nome: "funcao", rotulo: "Função", tipo: "select", valor: inicial, opcoes: funcoes.map((fn) => ({ valor: fn.id, texto: `${fn.nome} (${fn.prefixo})` })) })}
        <p class="form-empilhado__dica" data-descricao>${descricao(inicial)}</p>
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-funcionario" class="btn btn--primario">${f ? "Salvar" : "Cadastrar"}</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.funcao.addEventListener("change", () => { form.querySelector("[data-descricao]").textContent = descricao(form.funcao.value); });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(modal.el.querySelector('[form="form-funcionario"]'), async () => {
      try {
        if (f) {
          const novo = await api("PUT", `equipe/${f.id}`, dadosDe(form));
          modal.fechar();
          toast(novo.usuario !== f.usuario ? `Salvo. Usuário novo: ${novo.usuario}` : "Salvo.");
        } else {
          const r = await api("POST", "equipe", dadosDe(form));
          modal.fechar();
          mostrarAcesso(r);
        }
        await depois();
      } catch (erro) { mostrarErros(form, erro); }
    });
  });
}

/** Usuário e senha temporária: aparecem uma vez, prontos para mandar. */
function mostrarAcesso({ funcionario: f, senha_temporaria: senha }) {
  const endereco = location.origin;
  const mensagem = `Olá, ${primeiroNome(f.nome)}! Seu acesso à Central da Forminha:\n${endereco}\nUsuário: ${f.usuario}\nSenha temporária: ${senha}\nNo primeiro acesso você cria a sua senha.`;
  abrirModal({
    titulo: f.nome, largura: 420,
    corpo: html`
      <dl class="dados-empilhados">
        <div><dt>Usuário</dt><dd class="tabela__mono">${f.usuario}</dd></div>
        <div><dt>Senha temporária</dt><dd class="tabela__mono">${senha}</dd></div>
        <div><dt>Endereço</dt><dd>${endereco.replace(/^https?:\/\//, "")}</dd></div>
      </dl>
      <p class="form-empilhado__dica">A senha aparece só agora.</p>`,
    rodape: html`
      <a class="btn btn--whats" href="${linkWhats(mensagem)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
      <button type="button" class="btn btn--primario" data-copiar="${mensagem}">${icone("copiar", { tamanho: 15 })} Copiar</button>`,
  });
}
