/* ==========================================================
   ESTOQUE — Contagem guiada: percorre os ingredientes um a um
   (por local, se você cadastrou), você digita o que tem de
   verdade na prateleira e manda tudo de uma vez ao final.
   Pensado para usar no celular, andando pela cozinha/despensa.
   ========================================================== */
import { html, montar, delegar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { confirmar, ocupado, toast } from "/src/scripts/base/ui.js";
import { api } from "../nucleo/api.js";
import { lerNumero, paraCampo, paraEnvio, qtdTexto } from "../nucleo/estoque.js";
import { carregandoPagina, erroPagina, vazio } from "./pagina.js";

export async function contagemEstoque(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let ingredientes, contados, indice = 0, salvando = false;

  async function carregar() {
    try { ingredientes = (await api.get("/ingredientes")).ingredientes.filter((i) => i.ativo).sort((a, b) => (a.local || "￿").localeCompare(b.local || "￿", "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR")); }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return false; }
    contados = new Map(ingredientes.map((i) => [i.id, null])); // null = ainda não contado
    return ctx.ativo();
  }

  const restam = () => [...contados.values()].filter((v) => v === null).length;
  const feitos = () => ingredientes.length - restam();

  function desenharTopo() {
    const alvo = ctx.raiz.querySelector("#cont-progresso");
    if (alvo) montar(alvo, html`<div class="progresso" role="progressbar" aria-valuemin="0" aria-valuemax="${ingredientes.length}" aria-valuenow="${feitos()}"><span style="width:${Math.round((feitos() / ingredientes.length) * 100)}%"></span></div>
      <p class="texto-suave">${feitos()} de ${ingredientes.length} contados</p>`);
  }

  function cartaoAtual() {
    const alvo = ctx.raiz.querySelector("#cont-cartao");
    if (!alvo) return;
    if (indice >= ingredientes.length) { montar(alvo, telaFinal()); return; }
    const i = ingredientes[indice];
    const valor = contados.get(i.id);
    montar(alvo, html`<div class="cartao est-conta-cartao">
      ${i.local && html`<span class="badge badge--neutro">${i.local}</span>`}
      <h2>${i.nome}</h2>
      <p class="texto-suave">O sistema tem: <strong>${qtdTexto(i.estoque, i.unidade)}</strong></p>
      <label class="est-conta-campo"><span>Quanto tem na prateleira agora?</span>
        <span class="est-linha__qtd"><input class="entrada entrada--grande" id="cont-valor" inputmode="decimal" placeholder="0" value="${valor ?? paraCampo(i.estoque)}" autofocus><b>${i.unidade}</b></span></label>
      <div class="est-conta-acoes">
        <button type="button" class="btn btn--suave" data-acao="confere">${icone("check", { tamanho: 17 })} Está certo, é isso mesmo</button>
        <button type="button" class="btn btn--primario" data-acao="proximo">Confirmar e ir para o próximo</button>
      </div>
      <div class="est-conta-rodape">
        <button type="button" class="btn-icone" data-acao="anterior" ${indice === 0 ? "disabled" : ""} aria-label="Voltar">${icone("voltar", { tamanho: 18 })}</button>
        <button type="button" class="link" data-acao="pular">Pular este</button>
        <button type="button" class="btn-icone" data-acao="seguinte" aria-label="Avançar sem contar">${icone("direita", { tamanho: 18 })}</button>
      </div>
    </div>`);
    ctx.raiz.querySelector("#cont-valor")?.focus();
  }

  function telaFinal() {
    const mudados = [...contados.entries()].filter(([id, v]) => v !== null && Number(v) !== Number(ingredientes.find((i) => i.id === id).estoque));
    return html`<div class="cartao est-conta-cartao">
      <h2>Contagem concluída!</h2>
      ${mudados.length
        ? html`<p class="texto-suave">${mudados.length} ${mudados.length === 1 ? "ingrediente vai mudar" : "ingredientes vão mudar"}:</p>
          <ul class="avisos-lista">${mudados.map(([id, v]) => { const i = ingredientes.find((x) => x.id === id); return html`<li><strong>${i.nome}</strong>: ${qtdTexto(i.estoque, i.unidade)} → ${qtdTexto(v, i.unidade)}</li>`; })}</ul>`
        : html`<p class="texto-suave">Nada mudou: o estoque já batia com o que você contou.</p>`}
      ${restam() > 0 && html`<p class="texto-suave">${restam()} ${restam() === 1 ? "ingrediente não foi contado" : "ingredientes não foram contados"} e continuam como estavam.</p>`}
      <div class="est-conta-acoes">
        <button type="button" class="btn btn--suave" data-acao="revisar">Revisar do início</button>
        ${mudados.length > 0 ? html`<button type="button" class="btn btn--primario" data-acao="enviar">Salvar contagem</button>` : html`<a href="#/estoque/ingredientes" class="btn btn--primario">Voltar ao estoque</a>`}
      </div>
    </div>`;
  }

  function desenhar() {
    montar(ctx.raiz, html`
      <p class="texto-suave est-intro">Percorra os ingredientes um a um e diga o que tem de verdade. Ao final, só o que mudou é gravado — não é preciso mexer nos que já estavam certos.</p>
      <div id="cont-progresso"></div>
      <div id="cont-cartao"></div>`);
    desenharTopo();
    cartaoAtual();
  }

  const salvarAtual = () => {
    const campo = ctx.raiz.querySelector("#cont-valor");
    if (!campo) return;
    const n = lerNumero(campo.value);
    if (Number.isFinite(n) && n >= 0) contados.set(ingredientes[indice].id, campo.value);
  };
  const ir = (novo) => { salvarAtual(); indice = Math.max(0, Math.min(ingredientes.length, novo)); desenharTopo(); cartaoAtual(); };

  delegar(ctx.raiz, {
    confere: () => { contados.set(ingredientes[indice].id, paraCampo(ingredientes[indice].estoque)); ir(indice + 1); },
    proximo: () => ir(indice + 1),
    anterior: () => ir(indice - 1),
    seguinte: () => ir(indice + 1),
    pular: () => { contados.set(ingredientes[indice].id, null); ir(indice + 1); },
    revisar: () => { indice = 0; desenharTopo(); cartaoAtual(); },
    enviar: async (botao) => {
      const itens = [...contados.entries()].filter(([, v]) => v !== null).map(([id, v]) => ({ ingrediente_id: id, novo_estoque: paraEnvio(v) }));
      if (salvando) return;
      salvando = true;
      await ocupado(botao, async () => {
        try {
          const r = await api.post("/estoque/contagem", { nota: "Contagem guiada", itens });
          toast(`Contagem salva: ${r.ajustados} ${r.ajustados === 1 ? "ajuste" : "ajustes"}.`);
          if (await carregar()) { indice = ingredientes.length; desenhar(); }
        } catch (erro) { toast(erro.message, "erro"); }
        finally { salvando = false; }
      });
    },
  });
  ctx.raiz.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.id === "cont-valor") { ev.preventDefault(); ir(indice + 1); }
  });

  if (!(await carregar())) return;
  if (!ingredientes.length) { montar(ctx.raiz, vazio("check", "Nenhum ingrediente em uso", "Cadastre ingredientes na aba Ingredientes antes de fazer a contagem.", html`<a href="#/estoque/ingredientes" class="btn btn--primario">Ir para Ingredientes</a>`)); return; }
  if (!(await confirmar({ titulo: "Contagem guiada", mensagem: `Vamos passar pelos ${ingredientes.length} ingredientes em uso, um de cada vez. Você pode voltar, pular ou parar quando quiser — nada é salvo até o fim.`, rotulo: "Começar" }))) { history.back(); return; }
  desenhar();
}
