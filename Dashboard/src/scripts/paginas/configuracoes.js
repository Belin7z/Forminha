/* PÁGINA — configurações: loja e textos, horários, regras de pedido e pagamento (PIX) */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { ocupado, toast } from "/src/scripts/base/ui.js";
import { ativarCampos, campo, dadosDe, interruptor, mostrarErros } from "/src/scripts/base/formularios.js";
import { emReais, paraCentavos, telefone } from "/src/scripts/base/formatacao.js";
import { DIAS_SEMANA, UFS } from "/src/scripts/base/dominio.js";
import { api } from "../nucleo/api.js";
import { cabecalhoPagina, carregandoPagina, erroPagina } from "../componentes/pagina.js";
import { ligarImagens, ligarPerguntas, paginaImagens, paginaLegal, paginaPerguntas } from "../componentes/config-extras.js";
import { ligarIntegracoes, paginaIntegracoes } from "../componentes/config-integracoes.js";
import { ligarAparencia, paginaAparencia } from "../componentes/config-aparencia.js";

const ABAS = [["loja", "Loja e textos", "home"], ["aparencia", "Aparência", "paleta"], ["horarios", "Horários", "relogio"], ["pedidos", "Pedidos", "pacote"], ["pagamento", "Pagamento", "dinheiro"],
  ["integracoes", "Integrações", "mensagem"], ["imagens", "Imagens", "imagem"], ["perguntas", "Perguntas", "ajuda"], ["legal", "Privacidade e termos", "documento"]];

/** Liga um formulário à API: `preparar` ajusta os dados antes de enviar. */
function ligar(form, secao, { preparar = (d) => d, aoSalvar }) {
  ativarCampos(form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await ocupado(form.querySelector("[type=submit]"), async () => {
      try {
        const { configuracoes } = await api.put(`/configuracoes/${secao}`, preparar(dadosDe(form)));
        aoSalvar(configuracoes);
        toast("Configurações salvas!");
      } catch (erro) { mostrarErros(form, erro, (m) => toast(m, "erro")); }
    });
  });
}

const cartaoForm = (id, titulo, corpo, botao = "Salvar") => html`
  <form class="cartao" id="${id}" novalidate>
    <div class="cartao__cab"><h2>${titulo}</h2></div>
    <div class="form-erro" data-erro-geral hidden></div>
    ${corpo}
    <div class="cartao__rodape"><button type="submit" class="btn btn--primario">${botao}</button></div>
  </form>`;

export async function configuracoes(ctx) {
  montar(ctx.raiz, carregandoPagina);
  let cfg;
  try { cfg = (await api.get("/configuracoes")).configuracoes; }
  catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
  if (!ctx.ativo()) return;

  const aba = ABAS.some(([id]) => id === ctx.params.secao) ? ctx.params.secao : "loja";
  const atualizar = (nova) => { cfg = nova; };
  let integ = null;
  if (aba === "integracoes") {
    try { integ = { gateway: await api.get("/gateway"), avisos: await api.get("/avisos") }; }
    catch (erro) { montar(ctx.raiz, erroPagina(erro.message)); return; }
    if (!ctx.ativo()) return;
  }

  const paginas = {
    loja: () => html`
      ${cartaoForm("f-loja", "Dados da loja", html`
        <input type="hidden" name="lat" value="${cfg.loja.lat ?? ""}"><input type="hidden" name="lng" value="${cfg.loja.lng ?? ""}"><input type="hidden" name="logo" value="${cfg.loja.logo ?? ""}">
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "nome", rotulo: "Nome da loja", valor: cfg.loja.nome, obrigatorio: true, atributos: 'maxlength="80"' })}
          ${campo({ nome: "slogan", rotulo: "Slogan", valor: cfg.loja.slogan, atributos: 'maxlength="120"' })}
          ${campo({ nome: "whatsapp", rotulo: "WhatsApp da loja", valor: telefone(cfg.loja.whatsapp), tipo: "tel", mascara: "telefone", ajuda: "Os clientes falam com você por este número." })}
          ${campo({ nome: "instagram", rotulo: "Instagram (sem @)", valor: cfg.loja.instagram })}
          ${campo({ nome: "email", rotulo: "E-mail de contato", valor: cfg.loja.email, tipo: "email" })}
        </div>
        ${campo({ nome: "endereco", rotulo: "Endereço (rua e número)", valor: cfg.loja.endereco, atributos: 'maxlength="150"' })}
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "cidade", rotulo: "Cidade", valor: cfg.loja.cidade })}
          ${campo({ nome: "uf", rotulo: "UF", tipo: "select", valor: cfg.loja.uf, opcoes: UFS.map((u) => ({ valor: u, texto: u })) })}
        </div>
        <p class="texto-suave">${icone("pino", { tamanho: 14 })} A posição no mapa (para calcular o frete) é definida em <a href="#/entrega" class="link">Entrega e mapa</a>.</p>`)}
      ${cartaoForm("f-textos", "Textos do site", html`
        <input type="hidden" name="hero_imagem" value="${cfg.textos.hero_imagem ?? ""}"><input type="hidden" name="sobre_imagem" value="${cfg.textos.sobre_imagem ?? ""}">
        ${campo({ nome: "hero_titulo", rotulo: "Título da página inicial", valor: cfg.textos.hero_titulo, obrigatorio: true, atributos: 'maxlength="120"' })}
        ${campo({ nome: "hero_subtitulo", rotulo: "Subtítulo", tipo: "textarea", valor: cfg.textos.hero_subtitulo, linhas: 2, atributos: 'maxlength="300"' })}
        ${campo({ nome: "sobre_titulo", rotulo: "Título da seção “sobre”", valor: cfg.textos.sobre_titulo })}
        ${campo({ nome: "sobre_texto", rotulo: "Texto “sobre”", tipo: "textarea", valor: cfg.textos.sobre_texto, linhas: 6, atributos: 'maxlength="1500"', ajuda: "Separe parágrafos com uma linha em branco." })}`)}`,

    horarios: () => cartaoForm("f-horarios", "Horário de funcionamento", html`
      <p class="texto-suave">Define os dias e horários em que os clientes conseguem agendar retirada ou entrega.</p>
      <div class="horarios-editor">${[1, 2, 3, 4, 5, 6, 0].map((d) => { const h = cfg.horarios[d]; return html`
        <div class="horarios-editor__linha">
          <label class="interruptor interruptor--tabela"><input type="checkbox" name="aberto${d}" ${h.aberto && "checked"}><span class="interruptor__trilho"></span></label>
          <strong>${DIAS_SEMANA[d]}</strong>
          <input type="time" class="entrada entrada--curta" name="abre${d}" value="${h.abre}" aria-label="Abre — ${DIAS_SEMANA[d]}">
          <span class="texto-suave">até</span>
          <input type="time" class="entrada entrada--curta" name="fecha${d}" value="${h.fecha}" aria-label="Fecha — ${DIAS_SEMANA[d]}">
        </div>`; })}</div>`),

    pedidos: () => cartaoForm("f-pedidos", "Regras de pedido", html`
      ${interruptor({ nome: "pausados", rotulo: "Pausar novos pedidos", marcado: cfg.pedidos.pausados, ajuda: "A loja continua visível, mas ninguém consegue finalizar pedido. Boa para férias ou dias de muito movimento." })}
      ${campo({ nome: "mensagem_pausa", rotulo: "Mensagem exibida na pausa", valor: cfg.pedidos.mensagem_pausa, atributos: 'maxlength="200"' })}
      <div class="grade-campos grade-campos--2">
        ${campo({ nome: "antecedencia_horas", rotulo: "Antecedência mínima (horas)", valor: cfg.pedidos.antecedencia_horas, tipo: "number", atributos: 'min="0" max="720"', ajuda: "Ex.: 24 = pedido para o dia seguinte. Produtos podem ter antecedência própria." })}
        ${campo({ nome: "pedido_minimo", rotulo: "Pedido mínimo (R$)", valor: emReais(cfg.pedidos.pedido_minimo), mascara: "moeda", ajuda: "0,00 = sem mínimo." })}
        ${campo({ nome: "intervalo_min", rotulo: "Intervalo entre horários (min)", valor: cfg.pedidos.intervalo_min, tipo: "number", atributos: 'min="10" max="240"' })}
        ${campo({ nome: "dias_maximos", rotulo: "Agendar com até (dias)", valor: cfg.pedidos.dias_maximos, tipo: "number", atributos: 'min="1" max="365"' })}
      </div>`),

    pagamento: () => html`${cartaoForm("f-pagamento", "Formas de pagamento", html`
      ${interruptor({ nome: "pix_ativo", rotulo: "Aceitar PIX", marcado: cfg.pagamento.pix_ativo, ajuda: "O cliente recebe o código “copia e cola” com o valor do pedido." })}
      ${campo({ nome: "pix_chave", rotulo: "Chave PIX", valor: cfg.pagamento.pix_chave, placeholder: "CPF, CNPJ, e-mail, telefone ou chave aleatória", atributos: 'maxlength="80"' })}
      <div class="grade-campos grade-campos--2">
        ${campo({ nome: "pix_nome", rotulo: "Nome do recebedor", valor: cfg.pagamento.pix_nome, atributos: 'maxlength="25"', ajuda: "Como aparece no banco do cliente (até 25 letras)." })}
        ${campo({ nome: "pix_cidade", rotulo: "Cidade do recebedor", valor: cfg.pagamento.pix_cidade, atributos: 'maxlength="15"', ajuda: "Até 15 letras, sem acentos." })}
      </div>
      <div class="aviso aviso--info">${icone("info", { tamanho: 16 })}<span>O PIX é conferido por você: o pedido só deve ser confirmado depois de o valor cair na sua conta.</span></div>
      <hr class="divisor">
      ${interruptor({ nome: "dinheiro_ativo", rotulo: "Aceitar dinheiro (pagar na entrega/retirada)", marcado: cfg.pagamento.dinheiro_ativo })}
      ${interruptor({ nome: "cartao_ativo", rotulo: "Aceitar cartão (maquininha na entrega/retirada)", marcado: cfg.pagamento.cartao_ativo })}`)}
      ${cartaoForm("f-sinal", "Sinal para garantir a data", html`
        <p class="texto-suave">Uma parte do valor paga antes, por PIX, para reservar a data (comum em bolos e encomendas grandes). O cliente vê o valor do sinal ao finalizar e o PIX já sai com ele. Só funciona com o PIX ativo.</p>
        <div class="grade-campos grade-campos--2">
          ${campo({ nome: "percentual", rotulo: "Sinal (% do pedido)", tipo: "number", valor: cfg.sinal?.percentual ?? 0, atributos: 'min="0" max="100"', ajuda: "0 = não pedir sinal." })}
          ${campo({ nome: "acima_de", rotulo: "Pedir sinal em pedidos a partir de (R$)", valor: emReais(cfg.sinal?.acima_de ?? 0), mascara: "moeda", ajuda: "0,00 = em todos os pedidos." })}
        </div>`)}`,

    aparencia: () => paginaAparencia(cfg),
    integracoes: () => paginaIntegracoes(integ),
    imagens: () => paginaImagens(cfg),
    perguntas: () => paginaPerguntas(),
    legal: () => paginaLegal(cfg),
  };

  montar(ctx.raiz, html`
    ${cabecalhoPagina({ titulo: "Configurações", descricao: "Tudo o que a loja mostra e como ela recebe pedidos." })}
    <nav class="abas-status" aria-label="Seções">${ABAS.map(([id, texto, ic]) => html`
      <a href="#/configuracoes/${id}" class="aba-status ${id === aba && "aba-status--ativa"}">${icone(ic, { tamanho: 16 })} ${texto}</a>`)}</nav>
    <div class="coluna-form ${aba === "aparencia" && "coluna-form--larga"}">${paginas[aba]()}</div>`);

  const $ = (s) => ctx.raiz.querySelector(s);
  if (aba === "loja") {
    ligar($("#f-loja"), "loja", { aoSalvar: atualizar });
    ligar($("#f-textos"), "textos", { aoSalvar: atualizar });
  } else if (aba === "horarios") {
    ligar($("#f-horarios"), "horarios", {
      aoSalvar: atualizar,
      preparar: (d) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [i, { aberto: d[`aberto${i}`], abre: d[`abre${i}`], fecha: d[`fecha${i}`] }])),
    });
  } else if (aba === "pedidos") {
    ligar($("#f-pedidos"), "pedidos", { aoSalvar: atualizar, preparar: (d) => ({ ...d, pedido_minimo: paraCentavos(d.pedido_minimo) }) });
  } else if (aba === "pagamento") {
    ligar($("#f-pagamento"), "pagamento", { aoSalvar: atualizar });
    ligar($("#f-sinal"), "sinal", { aoSalvar: atualizar, preparar: (d) => ({ percentual: Number(d.percentual) || 0, acima_de: paraCentavos(d.acima_de) }) });
  } else if (aba === "aparencia") {
    ligarAparencia(ctx, cfg, atualizar);
  } else if (aba === "integracoes") {
    ligarIntegracoes(ctx, integ);
  } else if (aba === "imagens") {
    ligarImagens(ctx, cfg);
  } else if (aba === "perguntas") {
    ligarPerguntas(ctx, cfg);
  } else {
    ligar($("#f-legal"), "legal", { aoSalvar: atualizar });
  }
}
