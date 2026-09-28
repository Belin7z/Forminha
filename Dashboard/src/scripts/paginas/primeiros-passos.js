/* ==========================================================
   PÁGINA — assistente de primeiros passos (#/primeiros-passos).
   Cinco passos curtos para a loja nova ficar pronta para vender:
   dados da loja, logo, cores, primeiro doce e PIX. Cada passo
   salva na hora e pode ser pulado. Abre sozinho depois do convite
   e pode ser reaberto pela Visão geral ou pelas Configurações.
   ========================================================== */
import { delegar, escapar, html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { copiar, ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, mostrarErros } from "/src/scripts/base/formularios.js";
import { iniciais, telefone } from "/src/scripts/base/formatacao.js";
import { UFS } from "/src/scripts/base/dominio.js";
import { TEMAS, aplicarAparencia, gerarTokens, normalizarAparencia } from "/src/scripts/base/tema.js";
import { TIPOS_CHAVE, tipoDaChave } from "/src/scripts/base/chave-pix.js";
import { SUGESTOES_CATEGORIA, SUGESTOES_UNIDADE } from "/src/scripts/base/sugestoes.js";
import {
  NOME_PADRAO, aparenciaEscolhida, passosFeitos, salvarCores, salvarDoce, salvarLogo, salvarLoja, salvarPix,
} from "/src/scripts/base/assistente.js";
import { api } from "../nucleo/api.js";
import { emitir, estado } from "../nucleo/estado.js";
import { carregandoPagina, erroPagina } from "../componentes/pagina.js";
import { cartaoTema, carregarFontesDaPrevia, miniLoja } from "../componentes/config-aparencia.js";
import { escolherFoto } from "../componentes/foto.js";

const URL_LOJA = String(window.CONFIG_APP?.urlLoja ?? "").replace(/\/+$/, "");

const PASSOS = [["loja", "Sua loja", "home"], ["logo", "Logo", "imagem"], ["cores", "Cores", "paleta"], ["produto", "Primeiro doce", "bolo"], ["pix", "PIX", "dinheiro"]];

const EXEMPLO_CHAVE = { documento: "000.000.000-00", celular: "(11) 98765-4321", email: "voce@email.com", aleatoria: "Copie e cole do app do banco" };

const titulo = (texto, apoio) => html`<div class="assistente__titulo"><h2>${texto}</h2><p class="texto-suave">${apoio}</p></div>`;

export async function primeirosPassos(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let cfg, categorias, feitos;
  try {
    const [c, lista, cats] = await Promise.all([api.get("/configuracoes"), api.get("/checklist"), api.get("/categorias")]);
    cfg = c.configuracoes;
    categorias = cats.categorias;
    feitos = passosFeitos(cfg, lista.itens);
  } catch (erro) { if (ctx.ativo()) montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;
  carregarFontesDaPrevia();

  const pendente = () => PASSOS.find(([id]) => !feitos[id])?.[0] ?? "pronto";
  let atual = [...PASSOS.map(([id]) => id), "pronto"].includes(ctx.params.passo) ? ctx.params.passo : pendente();
  let fotoNova = null;      // foto do doce, já enquadrada (enviada junto com o produto)
  let maisUmDoce = false;   // "Cadastrar mais um" no passo do doce

  // nome e logo no menu lateral acompanham o que ela acabou de salvar
  const atualizarMarca = () => { estado.loja = { ...estado.loja, nome: cfg.loja.nome, logo: cfg.loja.logo }; emitir("contagem", estado.contagem); };

  /* ---------- Os passos: o que aparece e como salva ---------- */
  const passos = {
    loja: {
      corpo: () => html`
        ${titulo("Como sua loja se chama?", "O nome e o WhatsApp aparecem no site e nas mensagens dos pedidos.")}
        ${campo({ nome: "nome", rotulo: "Nome da loja", valor: cfg.loja.nome === NOME_PADRAO ? "" : cfg.loja.nome, obrigatorio: true, placeholder: "Ex.: Doces da Ana", atributos: 'maxlength="80" autocomplete="organization"' })}
        ${campo({ nome: "whatsapp", rotulo: "WhatsApp da loja", valor: telefone(cfg.loja.whatsapp), tipo: "tel", mascara: "telefone", obrigatorio: true, ajuda: "Os clientes falam com você por este número." })}
        <div class="grade-campos assistente__cidade">
          ${campo({ nome: "cidade", rotulo: "Cidade", valor: cfg.loja.cidade, atributos: 'maxlength="80"' })}
          ${campo({ nome: "uf", rotulo: "UF", tipo: "select", valor: cfg.loja.uf, opcoes: [{ valor: "", texto: "—" }, ...UFS.map((u) => ({ valor: u, texto: u }))] })}
        </div>
        ${campo({ nome: "slogan", rotulo: "Frase curta (opcional)", valor: cfg.loja.slogan, placeholder: "Ex.: Doces feitos com carinho", atributos: 'maxlength="120"' })}`,
      async salvar(d) {
        cfg = await salvarLoja(api, cfg, d);
        atualizarMarca();
        return true;
      },
    },

    logo: {
      corpo: () => html`
        ${titulo("Tem uma logo?", "Ela aparece no topo da loja. Sem logo, a loja mostra as iniciais do nome.")}
        <div class="assistente-logo">
          <div class="assistente-logo__previa ${cfg.loja.logo && "assistente-logo__previa--img"}">
            ${cfg.loja.logo ? html`<img src="${cfg.loja.logo}" alt="Logo da loja">` : html`<span>${iniciais(cfg.loja.nome || NOME_PADRAO)}</span>`}</div>
          <div class="assistente-logo__acoes">
            <label class="btn ${cfg.loja.logo ? "btn--contorno" : "btn--primario"}" data-enviar-logo>${icone("upload", { tamanho: 16 })} ${cfg.loja.logo ? "Trocar a logo" : "Enviar a logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-logo></label>
            <small class="texto-suave">PNG com fundo transparente fica melhor.</small>
          </div>
        </div>`,
      botao: () => (cfg.loja.logo ? "Continuar" : null), // sem logo, o botão principal é o de enviar
      ligar(form) {
        form.querySelector("[data-logo]").addEventListener("change", async (ev) => {
          const arquivo = ev.target.files?.[0];
          if (!arquivo) return;
          const rotulo = form.querySelector("[data-enviar-logo]");
          try {
            const dados = await escolherFoto(arquivo, "logo"); // abre o enquadramento
            ev.target.value = "";
            if (!dados) return;
            rotulo.classList.add("carregando");
            cfg = await salvarLogo(api, cfg, dados);
            feitos.logo = true;
            atualizarMarca();
            toast("Logo salva!");
            desenhar();
          } catch (erro) { rotulo.classList.remove("carregando"); toast(erro.message, "erro"); }
        });
      },
      salvar: async () => Boolean(cfg.loja.logo),
    },

    cores: {
      corpo() {
        const a = normalizarAparencia(cfg.aparencia);
        return html`
          ${titulo("Escolha as cores", "Toque num tema para ver como a loja fica. Dá para trocar quando quiser.")}
          <div class="assistente-cores">
            <div class="ap-temas" role="radiogroup" aria-label="Tema">
              ${TEMAS.map((t) => cartaoTema(t, a.tema))}
              ${a.tema === "personalizado" && html`<label class="ap-tema ap-tema--minhas">
                <input type="radio" name="tema" value="personalizado" checked>
                <span class="ap-tema__corpo"><span class="ap-amostra ap-amostra--arco"><i></i><i></i><i></i><i></i></span>
                  <strong>Minhas cores</strong><small>As que você escolheu</small><span class="ap-tema__check">${icone("check", { tamanho: 14 })}</span></span>
              </label>`}
            </div>
            <aside class="ap__previa"><p class="ap__previa-rotulo">${icone("olho", { tamanho: 14 })} Prévia</p>${miniLoja(cfg)}</aside>
          </div>
          <p class="texto-suave assistente__nota">Quer as cores exatas da sua marca? Use <a class="link" href="#/configuracoes/aparencia">Configurações → Aparência</a>.</p>`;
      },
      tema: (form) => form.querySelector('[name="tema"]:checked')?.value ?? normalizarAparencia(cfg.aparencia).tema,
      ligar(form) {
        const previa = form.querySelector("[data-previa]");
        const pintar = () => { for (const [k, v] of Object.entries(gerarTokens(aparenciaEscolhida(cfg.aparencia, passos.cores.tema(form))))) previa.style.setProperty(k, v); };
        form.addEventListener("change", pintar);
        pintar();
      },
      async salvar(_d, form) {
        cfg = await salvarCores(api, cfg, passos.cores.tema(form));
        aplicarAparencia(cfg.aparencia); // o painel também troca de cor
        estado.aparencia = cfg.aparencia;
        return true;
      },
    },

    produto: {
      corpo() {
        if (feitos.produto && !maisUmDoce) {
          return html`
            ${titulo("Seu cardápio já começou", "Você já tem doces na loja. Cadastre mais um aqui ou siga para o próximo passo.")}
            <div class="assistente-ok">${icone("check", { tamanho: 18 })}<span>Produtos cadastrados</span><span class="espaco"></span><a class="link" href="#/produtos">Ver produtos</a></div>
            <button type="button" class="btn btn--contorno" data-acao="mais-um-doce">${icone("mais", { tamanho: 16 })} Cadastrar mais um</button>`;
        }
        const nomesCategoria = [...new Set([...categorias.map((c) => c.nome), ...SUGESTOES_CATEGORIA])];
        return html`
          ${titulo(feitos.produto ? "Mais um doce" : "Cadastre seu primeiro doce", "Só o básico. Opções, tamanhos e fotos extras você completa depois em Produtos.")}
          <div class="assistente-produto">
            <div class="foto-envio">
              <div class="foto-envio__previa" data-previa-foto>${fotoNova ? html`<img src="${fotoNova}" alt="Foto do doce">` : icone("bolo", { tamanho: 44 })}</div>
              <label class="btn btn--suave btn--pequeno">${icone("upload", { tamanho: 15 })} ${fotoNova ? "Trocar foto" : "Foto"}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-foto></label>
            </div>
            <div>
              ${campo({ nome: "nome", rotulo: "Nome do doce", obrigatorio: true, placeholder: "Ex.: Bolo de brigadeiro", atributos: 'maxlength="80"' })}
              <div class="grade-campos grade-campos--2">
                ${campo({ nome: "preco", rotulo: "Preço (R$)", obrigatorio: true, mascara: "moeda", placeholder: "0,00" })}
                ${campo({ nome: "unidade", rotulo: "Vendido por", valor: "unidade", obrigatorio: true, atributos: 'list="assistente-unidades" maxlength="30"' })}
              </div>
              ${campo({ nome: "categoria", rotulo: "Categoria", valor: categorias[0]?.nome ?? "", obrigatorio: true, placeholder: "Ex.: Bolos", atributos: 'list="assistente-categorias" maxlength="50"',
                ajuda: categorias.length ? "Escolha uma que já existe ou escreva uma nova." : "Escolha uma sugestão ou escreva a sua." })}
            </div>
          </div>
          ${campo({ nome: "descricao", rotulo: "Descrição (opcional)", tipo: "textarea", linhas: 2, placeholder: "Ex.: Massa de chocolate com recheio de brigadeiro cremoso.", atributos: 'maxlength="400"' })}
          <datalist id="assistente-unidades">${SUGESTOES_UNIDADE.map((u) => html`<option value="${u}"></option>`)}</datalist>
          <datalist id="assistente-categorias">${nomesCategoria.map((n) => html`<option value="${n}"></option>`)}</datalist>`;
      },
      botao: () => (feitos.produto && !maisUmDoce ? "Continuar" : "Salvar e continuar"),
      ligar(form) {
        form.querySelector("[data-foto]")?.addEventListener("change", async (ev) => {
          const arquivo = ev.target.files?.[0];
          if (!arquivo) return;
          try {
            const dados = await escolherFoto(arquivo, "produto");
            if (dados) {
              fotoNova = dados;
              form.querySelector("[data-previa-foto]").innerHTML = `<img src="${escapar(dados)}" alt="Foto do doce">`;
            }
          } catch (erro) { toast(erro.message, "erro"); }
          ev.target.value = "";
        });
      },
      async salvar(d) {
        if (feitos.produto && !maisUmDoce) return true;
        categorias = await salvarDoce(api, { categorias, dados: d, foto: fotoNova, destaque: !feitos.produto }); // o primeiro doce vai para os destaques
        fotoNova = null;
        maisUmDoce = false;
        toast("Doce cadastrado! Ele já aparece na loja.");
        return true;
      },
    },

    pix: {
      corpo() {
        const p = cfg.pagamento;
        const tipo = tipoDaChave(p.pix_chave) ?? "documento";
        return html`
          ${titulo("Como você quer receber?", "Com o PIX ligado, o cliente recebe o código pronto, já com o valor do pedido.")}
          <fieldset class="assistente-tipos"><legend>Tipo da chave</legend>
            ${TIPOS_CHAVE.map(([id, texto]) => html`<label class="assistente-tipo"><input type="radio" name="tipo" value="${id}" ${id === tipo && "checked"}><span>${texto}</span></label>`)}
          </fieldset>
          ${campo({ nome: "pix_chave", rotulo: "Chave PIX", valor: p.pix_chave, obrigatorio: true, placeholder: EXEMPLO_CHAVE[tipo], atributos: 'maxlength="80" autocomplete="off" spellcheck="false"' })}
          <div class="grade-campos grade-campos--2">
            ${campo({ nome: "pix_nome", rotulo: "Nome de quem recebe", valor: p.pix_nome || cfg.loja.nome.slice(0, 25), obrigatorio: true, atributos: 'maxlength="25"', ajuda: "Como aparece no app do banco." })}
            ${campo({ nome: "pix_cidade", rotulo: "Cidade", valor: p.pix_cidade || String(cfg.loja.cidade ?? "").slice(0, 15), obrigatorio: true, atributos: 'maxlength="15"' })}
          </div>
          <div class="assistente-extras">
            <label class="opcao-mini"><input type="checkbox" name="dinheiro_ativo" ${p.dinheiro_ativo && "checked"}> Também aceito dinheiro</label>
            <label class="opcao-mini"><input type="checkbox" name="cartao_ativo" ${p.cartao_ativo && "checked"}> Também aceito cartão (maquininha)</label>
          </div>`;
      },
      ligar(form) {
        form.addEventListener("change", (ev) => { if (ev.target.name === "tipo") form.elements.pix_chave.placeholder = EXEMPLO_CHAVE[ev.target.value]; });
      },
      async salvar(d) {
        cfg = await salvarPix(api, cfg, d);
        return true;
      },
    },
  };

  /* ---------- Tela final ---------- */
  function telaFinal() {
    const faltam = PASSOS.filter(([id]) => !feitos[id]);
    return html`
      <div class="assistente-fim">
        <span class="assistente-fim__selo ${!faltam.length && "assistente-fim__selo--ok"}">${icone(faltam.length ? "estrela" : "check", { tamanho: 30 })}</span>
        <h2>${faltam.length ? "Quase lá!" : "Sua loja está pronta para vender!"}</h2>
        <p class="texto-suave">${faltam.length
          ? `${faltam.length === 1 ? "Falta 1 passo" : `Faltam ${faltam.length} passos`}. Faça agora ou quando quiser: o assistente fica na Visão geral.`
          : "Mande o link da loja no WhatsApp e no Instagram. Os pedidos chegam aqui no painel."}</p>
        ${faltam.length > 0 && html`<div class="assistente-fim__faltam">${faltam.map(([id, texto, ic]) => html`
          <button type="button" class="btn btn--suave btn--pequeno" data-acao="ir" data-passo="${id}">${icone(ic, { tamanho: 15 })} ${texto}</button>`)}</div>`}
        <div class="assistente-fim__acoes">
          ${URL_LOJA && html`<button type="button" class="btn btn--contorno" data-acao="copiar-link">${icone("copiar", { tamanho: 16 })} Copiar link da loja</button>
            <a class="btn btn--contorno" href="${URL_LOJA}" target="_blank" rel="noopener">${icone("navegar", { tamanho: 16 })} Ver minha loja</a>`}
          <a class="btn btn--primario" href="#/">Ir para o painel</a>
        </div>
        <p class="texto-suave assistente-fim__depois">${icone("caminhao", { tamanho: 14 })} Para entregar, marque a loja no mapa e as taxas em <a class="link" href="#/entrega">Entrega e mapa</a>.</p>
      </div>`;
  }

  /* ---------- Desenho e navegação ---------- */
  function desenhar() {
    const passo = passos[atual];
    const indice = PASSOS.findIndex(([id]) => id === atual);
    const botao = passo ? (passo.botao ? passo.botao() : "Salvar e continuar") : null;
    montar(ctx.raiz, html`
      <div class="assistente">
        <header class="assistente__cab">
          <div><p class="assistente__rotulo">Primeiros passos</p><h1>Deixe sua loja pronta para vender</h1></div>
          <a href="#/" class="btn btn--suave btn--pequeno">Terminar depois</a>
        </header>
        <ol class="assistente__trilha">${PASSOS.map(([id, texto], i) => html`
          <li><button type="button" class="assistente__etapa ${id === atual && "assistente__etapa--atual"} ${feitos[id] && "assistente__etapa--feita"}"
            data-acao="ir" data-passo="${id}" aria-label="Passo ${i + 1}: ${texto}" title="${texto}" ${id === atual && html`aria-current="step"`}>
            <span class="assistente__num">${feitos[id] ? icone("check", { tamanho: 14 }) : i + 1}</span><span class="assistente__nome">${texto}</span></button></li>`)}</ol>
        <section class="cartao assistente__passo">
          ${passo ? html`<form id="assistente-form" novalidate>
            <div class="form-erro" data-erro-geral hidden></div>
            ${passo.corpo()}
            <footer class="assistente__rodape">
              ${indice > 0 && html`<button type="button" class="btn btn--suave" data-acao="voltar">${icone("voltar", { tamanho: 16 })} Voltar</button>`}
              <span class="espaco"></span>
              ${!feitos[atual] && html`<button type="button" class="link" data-acao="pular">Pular por agora</button>`}
              ${botao && html`<button type="submit" class="btn btn--primario">${botao} ${icone("direita", { tamanho: 16 })}</button>`}
            </footer>
          </form>` : telaFinal()}
        </section>
      </div>`);
    const form = ctx.raiz.querySelector("#assistente-form");
    if (!form) return;
    ativarCampos(form);
    passo.ligar?.(form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await ocupado(form.querySelector("[type=submit]"), async () => {
        try {
          if (await passo.salvar(dadosDe(form), form)) feitos[atual] = true;
          seguir();
        } catch (erro) { mostrarErros(form, erro, (m) => toast(m, "erro")); }
      });
    });
  }

  function ir(id) {
    atual = id;
    history.replaceState(null, "", `#/primeiros-passos/${id}`); // recarregar a página volta para o mesmo passo
    desenhar();
    window.scrollTo({ top: 0 });
    ctx.raiz.querySelector("#assistente-form [name]:not([type=hidden]):not([type=radio])")?.focus({ preventScroll: true });
  }
  const seguir = () => ir(PASSOS[PASSOS.findIndex(([id]) => id === atual) + 1]?.[0] ?? "pronto");

  delegar(ctx.raiz, {
    ir: (el) => ir(el.dataset.passo),
    voltar: () => ir(PASSOS[Math.max(0, PASSOS.findIndex(([id]) => id === atual) - 1)][0]),
    pular: () => seguir(),
    "mais-um-doce": () => { maisUmDoce = true; desenhar(); },
    "copiar-link": () => copiar(URL_LOJA),
  });

  desenhar();
}
