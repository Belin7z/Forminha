/* ==========================================================
   TELA — Equipe (só o dono): funcionários da Forminha, cada um com
   usuário próprio (FMV-0427) e uma função. Cadastrar, mudar função,
   senha temporária nova, desativar e excluir. E a atividade recente:
   quem fez o quê na Central.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { abrirModal, confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { api, aviso, dia, linkWhats, quando } from "../nucleo.js";

const TOM_DA_FUNCAO = { gerente: "perigo", vendedor: "sucesso", suporte: "info", financeiro: "aviso" };
const primeiroNome = (nome) => String(nome).split(" ")[0];

function situacao(f) {
  if (!f.ativo) return html`<span class="selo selo--neutro">Desativado</span>`;
  if (f.trocar_senha) return html`<span class="selo selo--aviso">Esperando o 1º acesso</span>`;
  return html`<span class="selo selo--sucesso">Ativo</span>`;
}

export async function telaEquipe(conteiner) {
  document.title = "Equipe — Forminha";
  let dados = { funcionarios: [], funcoes: [], permissoes: {} };
  let filtro = "";

  montar(conteiner, html`
    <div class="central__titulo">
      <div><h1>Equipe</h1><p class="texto-suave" data-resumo>Carregando…</p></div>
      <button type="button" class="btn btn--primario" data-acao="novo">${icone("mais", { tamanho: 17 })} Novo funcionário</button>
    </div>
    <section data-lista><div class="carregando-pagina"><div class="spinner"></div></div></section>
    <div class="config-grade equipe__extras">
      <section class="cartao">
        <div class="cartao__cab"><h2>O que cada função faz</h2></div>
        <div data-funcoes></div>
      </section>
      <section class="cartao">
        <div class="cartao__cab"><h2>Atividade recente</h2>
          <select class="entrada entrada--pequena" data-filtro aria-label="Filtrar por pessoa"><option value="">Todos</option></select></div>
        <ol class="atividades" data-atividades></ol>
      </section>
    </div>`);

  const $ = (s) => conteiner.querySelector(s);

  function desenhar() {
    const ativos = dados.funcionarios.filter((f) => f.ativo).length;
    $("[data-resumo]").textContent = dados.funcionarios.length
      ? `${ativos} ${ativos === 1 ? "pessoa ativa" : "pessoas ativas"} · entram com o usuário da Forminha (ex.: FMV-0427), nunca com e-mail.`
      : "Cada pessoa entra com um usuário próprio da Forminha (ex.: FMV-0427), nunca com e-mail.";
    montar($("[data-lista]"), dados.funcionarios.length ? html`
      <div class="tabela-equipe" role="list">
        <div class="te__cab" aria-hidden="true"><span>Pessoa</span><span>Usuário</span><span>Função</span><span>Situação</span><span>Último acesso</span><span></span></div>
        ${dados.funcionarios.map((f) => html`
          <div class="te__linha ${!f.ativo && "te__linha--inativa"}" role="listitem" data-id="${f.id}">
            <span class="te__nome"><strong>${f.nome}</strong><small>desde ${dia(f.criado_em)}</small></span>
            <span><button type="button" class="codigo" data-copiar="${f.usuario}" title="Copiar o usuário">${f.usuario} ${icone("copiar", { tamanho: 13 })}</button></span>
            <span><span class="selo selo--${TOM_DA_FUNCAO[f.funcao]}">${f.funcao_nome}</span></span>
            <span>${situacao(f)}</span>
            <span class="te__data">${f.ultimo_acesso ? quando(f.ultimo_acesso) : "—"}</span>
            <span class="te__acoes">
              <button type="button" class="btn-icone btn-icone--pequeno" data-acao="editar" title="Editar nome e função" aria-label="Editar ${f.nome}">${icone("editar", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno" data-acao="senha" title="Senha temporária nova" aria-label="Senha nova para ${f.nome}">${icone("cadeado", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno" data-acao="ativo" title="${f.ativo ? "Desativar" : "Reativar"}" aria-label="${f.ativo ? "Desativar" : "Reativar"} ${f.nome}">${icone(f.ativo ? "xCirculo" : "checkCirculo", { tamanho: 16 })}</button>
              <button type="button" class="btn-icone btn-icone--pequeno btn-icone--perigo" data-acao="excluir" title="Excluir" aria-label="Excluir ${f.nome}">${icone("lixeira", { tamanho: 16 })}</button>
            </span>
          </div>`)}
      </div>` : html`
      <div class="vazio"><span class="vazio__ico">${icone("usuarios", { tamanho: 36 })}</span><h3>Ninguém na equipe ainda</h3>
        <p>Cadastre quem vende, quem dá suporte ou cuida do financeiro. A pessoa recebe um usuário (ex.: FMV-0427) e uma senha temporária.</p></div>`);

    montar($("[data-funcoes]"), html`<ul class="funcoes">${dados.funcoes.map((fn) => html`
      <li><div class="funcoes__cab"><span class="selo selo--${TOM_DA_FUNCAO[fn.id]}">${fn.nome}</span><span class="codigo codigo--texto">${fn.prefixo}-0000</span></div>
        <p>${fn.descricao}</p></li>`)}
      <li><div class="funcoes__cab"><span class="selo selo--neutro">Dono (você)</span></div><p>Tudo, inclusive equipe, configurações e excluir lojas.</p></li></ul>`);

    const select = $("[data-filtro]");
    montar(select, html`<option value="">Todos</option><option value="dono">Dono</option>${dados.funcionarios.map((f) => html`<option value="${f.id}">${f.usuario} · ${primeiroNome(f.nome)}</option>`)}`);
    select.value = filtro;
  }

  async function carregarAtividades() {
    const lista = $("[data-atividades]");
    try {
      const { atividades } = await api("GET", `atividades${filtro ? `?quem=${encodeURIComponent(filtro)}` : ""}`);
      montar(lista, atividades.length ? html`${atividades.map((a) => html`
        <li><span class="atividades__quem">${a.usuario}</span><span class="atividades__acao">${a.acao}${a.alvo && html` · <strong>${a.alvo}</strong>`}</span><time>${quando(a.em)}</time></li>`)}`
        : html`<li class="texto-suave">Nada por aqui ainda.</li>`);
    } catch (erro) { montar(lista, html`<li>${aviso("perigo", erro.message)}</li>`); }
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
    if (acao === "editar") return formulario({ funcionario: f, funcoes: dados.funcoes, depois: carregar });
    if (acao === "senha") {
      const ok = await confirmar({ titulo: "Senha temporária nova?", mensagem: `${primeiroNome(f.nome)} sai da Central na hora e, no próximo acesso, cria uma senha nova.`, rotulo: "Gerar senha nova" });
      if (!ok) return;
      return ocupado(alvo, async () => {
        try { const r = await api("POST", `equipe/${f.id}/nova-senha`, {}); mostrarAcesso(r); await carregar(); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
    if (acao === "ativo") {
      if (f.ativo && !(await confirmar({ titulo: `Desativar ${primeiroNome(f.nome)}?`, mensagem: "A pessoa sai da Central na hora e não consegue mais entrar. Dá para reativar depois.", rotulo: "Desativar", perigo: true }))) return;
      return ocupado(alvo, async () => {
        try { await api("POST", `equipe/${f.id}/ativo`, { ativo: !f.ativo }); toast(f.ativo ? "Desativado." : "Reativado."); await carregar(); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
    if (acao === "excluir") {
      const ok = await confirmar({ titulo: `Excluir ${f.nome}?`, mensagem: `O usuário ${f.usuario} deixa de existir. O que a pessoa fez continua na atividade. Se for só uma pausa, prefira desativar.`, rotulo: "Excluir", perigo: true });
      if (!ok) return;
      return ocupado(alvo, async () => {
        try { await api("DELETE", `equipe/${f.id}`, {}); toast("Excluído."); await carregar(); }
        catch (erro) { toast(erro.message, "erro"); }
      });
    }
  });
  await carregar();
}

/* ---------- cadastrar / editar ---------- */
function formulario({ funcionario: f = null, funcoes, depois }) {
  const modal = abrirModal({
    titulo: f ? `Editar ${f.nome}` : "Novo funcionário", largura: 620,
    corpo: html`
      <form id="form-funcionario" novalidate>
        <div class="form-erro" data-erro-geral hidden></div>
        ${campo({ nome: "nome", rotulo: "Nome", valor: f?.nome ?? "", obrigatorio: true, atributos: 'maxlength="80" autocomplete="off" autofocus' })}
        <fieldset class="funcoes-escolha"><legend>Função</legend>
          ${funcoes.map((fn) => html`
            <label class="funcoes-escolha__item">
              <input type="radio" name="funcao" value="${fn.id}" ${(f ? f.funcao === fn.id : fn.id === "vendedor") && "checked"}>
              <span><strong>${fn.nome} <span class="codigo codigo--texto">${fn.prefixo}</span></strong><small>${fn.descricao}</small></span>
            </label>`)}
        </fieldset>
        ${f ? html`<p class="texto-suave">Mudar a função troca só a letra do usuário (o número fica): avise a pessoa do usuário novo.</p>`
          : html`<p class="nota-seguranca">${icone("cadeado", { tamanho: 14 })} A pessoa recebe um usuário próprio e uma senha temporária; no 1º acesso, cria a senha dela. O nome fica guardado criptografado.</p>`}
      </form>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Cancelar</button><button type="submit" form="form-funcionario" class="btn btn--primario">${f ? "Salvar" : "Cadastrar"}</button>`,
  });
  const form = modal.el.querySelector("form");
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(modal.el.querySelector('[form="form-funcionario"]'), async () => {
      try {
        if (f) {
          const novo = await api("PUT", `equipe/${f.id}`, dadosDe(form));
          modal.fechar();
          toast(novo.usuario !== f.usuario ? `Salvo. O usuário agora é ${novo.usuario}.` : "Salvo.");
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

/** Usuário e senha temporária: aparecem UMA vez, prontos para mandar. */
function mostrarAcesso({ funcionario: f, senha_temporaria: senha }) {
  const endereco = location.origin;
  const mensagem = `Olá, ${primeiroNome(f.nome)}! Seu acesso à Central da Forminha:\n${endereco}\nUsuário: ${f.usuario}\nSenha temporária: ${senha}\nNo primeiro acesso você cria a sua senha.`;
  abrirModal({
    titulo: `Acesso de ${f.nome}`, largura: 520,
    corpo: html`
      <div class="acesso-pronto">
        <div class="acesso-pronto__linha"><span>Endereço</span><strong>${endereco.replace(/^https?:\/\//, "")}</strong></div>
        <div class="acesso-pronto__linha"><span>Usuário</span><strong class="codigo codigo--texto">${f.usuario}</strong></div>
        <div class="acesso-pronto__linha"><span>Senha temporária</span><strong class="codigo codigo--texto">${senha}</strong></div>
      </div>
      ${aviso("aviso", "A senha temporária aparece só agora. Mande para a pessoa; no 1º acesso ela cria a senha dela.")}
      <div class="convite-pronto__botoes">
        <button type="button" class="btn btn--primario btn--pequeno" data-copiar="${mensagem}">${icone("copiar", { tamanho: 15 })} Copiar tudo</button>
        <a class="btn btn--whats btn--pequeno" href="${linkWhats(mensagem)}" target="_blank" rel="noopener">${icone("mensagem", { tamanho: 15 })} WhatsApp</a>
      </div>`,
    rodape: html`<button type="button" class="btn btn--suave" data-fechar>Pronto</button>`,
  });
}
