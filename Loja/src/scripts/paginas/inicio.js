/*
 * PÁGINA — início: apresentação da loja, como funciona, categorias, mais pedidos, entrega, galeria,
 * avaliações, perguntas e (quando a dona escreve) a história da loja.
 * Tudo sai dos dados da própria loja: nada de desenho de bolo nem promessa genérica. Enquanto a dona
 * não envia fotos, o topo mostra um painel neutro com as iniciais da loja; seções sem conteúdo não aparecem.
 */
import { bruto, html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, horasTexto, plural } from "/src/scripts/base/formatacao.js";
import { situacaoAgora } from "/src/scripts/base/agendamento.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";
import { maisPedidos } from "../nucleo/catalogo.js";
import { cartaoProduto } from "../componentes/cartao-produto.js";
import { ligarProdutos } from "../componentes/acoes-produto.js";
import { estrelas } from "../componentes/estrelas.js";
import { revelarAoRolar } from "../componentes/revelar.js";
import { linkWhats } from "../componentes/rodape.js";
import { monograma } from "../componentes/cabecalho.js";

const NOVA_ABA = bruto('target="_blank" rel="noopener"'); // links do WhatsApp abrem fora da loja
const listaEmTexto = (itens) => itens.join(", ").replace(/, ([^,]*)$/, " e $1");

/** Frase padrão do topo, conforme a loja entrega, deixa retirar ou os dois. */
function subtituloPadrao({ entrega }) {
  if (entrega.entrega_ativa && entrega.retirada_ativa) return "Faça o seu pedido online e escolha receber em casa ou retirar na loja.";
  if (entrega.entrega_ativa) return "Faça o seu pedido online e receba em casa, no horário que preferir.";
  return "Faça o seu pedido online e retire na loja, no horário que preferir.";
}

/** O lado direito do topo: a foto da loja; senão, as fotos dos produtos; senão, um painel com as iniciais. */
function arteDoTopo(config, produtos) {
  const selo = html`<div class="hero__selo">${icone("calendario", { tamanho: 20 })}<span><strong>Encomende online</strong><small>Você escolhe o dia e o horário</small></span></div>`;
  if (config.textos.hero_imagem) return html`<figure class="hero__foto"><img src="${config.textos.hero_imagem}" alt="${config.loja.nome}"></figure>${selo}`;
  const fotos = produtos.filter((p) => p.imagem).slice(0, 3).map((p) => p.imagem);
  if (fotos.length === 1) return html`<figure class="hero__foto"><img src="${fotos[0]}" alt=""></figure>${selo}`;
  if (fotos.length > 1) return html`<div class="hero__colagem hero__colagem--${fotos.length}">${fotos.map((u) => html`<figure><img src="${u}" alt=""></figure>`)}</div>${selo}`;
  return html`
    <div class="hero__painel" aria-hidden="true">
      <span class="hero__monograma">${config.loja.logo ? html`<img src="${config.loja.logo}" alt="">` : monograma(config.loja.nome)}</span>
      <span class="hero__assinatura">${config.loja.nome}</span>
    </div>${selo}`;
}

/** Como funciona: o que é verdade para ESTA loja (antecedência, entrega ou retirada, formas de pagamento). */
function comoFunciona({ pedidos, entrega, pagamento }) {
  const formas = [pagamento.pix_ativo && "PIX", pagamento.cartao_ativo && "cartão", pagamento.dinheiro_ativo && "dinheiro"].filter(Boolean);
  const receber = entrega.entrega_ativa && entrega.retirada_ativa ? ["Entrega ou retirada", "Receba em casa ou retire na loja, como for melhor para você."]
    : entrega.entrega_ativa ? ["Entrega", "Receba em casa, no dia e no horário que você escolheu."]
    : ["Retirada", "Retire na loja, no dia e no horário que você escolheu."];
  return [
    ["sacola", "Escolha", "Monte o seu pedido pelo cardápio, com as opções que preferir."],
    ["calendario", "Agende", `Escolha o dia e o horário${pedidos.antecedencia_horas ? `, com ${horasTexto(pedidos.antecedencia_horas)} de antecedência` : ""}.`],
    ["caminhao", ...receber],
    ["cartao", "Pague como preferir", formas.length ? `Aceitamos ${listaEmTexto(formas)}.` : "As formas de pagamento aparecem ao finalizar o pedido."],
  ];
}

/** Perguntas frequentes: as cadastradas no Dashboard ou, se não houver, respostas montadas com os dados da loja. */
function perguntas(config) {
  if (Array.isArray(config.faq) && config.faq.length) return config.faq;
  const { pedidos, entrega, pagamento } = config;
  const formas = [pagamento.pix_ativo && "PIX", pagamento.dinheiro_ativo && "dinheiro", pagamento.cartao_ativo && "cartão (na entrega ou na retirada)"].filter(Boolean);
  return [
    { p: "Com quanta antecedência preciso encomendar?", r: `Pedimos ao menos ${horasTexto(pedidos.antecedencia_horas)} de antecedência (alguns produtos pedem mais, e o aviso aparece no carrinho). Você escolhe a data e o horário direto no pedido.` },
    { p: "Vocês entregam?", r: entrega.entrega_ativa ? `Sim. O frete é calculado pelo seu endereço e aparece no carrinho.${entrega.retirada_ativa ? " Se preferir, também dá para retirar na loja, sem custo." : ""}` : "No momento atendemos somente com retirada na loja." },
    { p: "Como posso pagar?", r: formas.length ? `Aceitamos ${listaEmTexto(formas)}. Ao finalizar o pedido, você vê as instruções de pagamento.` : "As formas de pagamento aparecem ao finalizar o pedido." },
    { p: "Posso personalizar o meu pedido?", r: "Sim. Muitos produtos têm opções de tamanho e adicionais, e há um campo de observações para contar os detalhes." },
    { p: "Como acompanho o meu pedido?", r: "Depois de criar a sua conta, em “Meus pedidos” você vê cada etapa, do recebimento até a entrega, com atualização automática." },
  ];
}

function avaliacoesHtml({ avaliacoes, media, total }) {
  if (!avaliacoes.length) return "";
  return html`
    <section class="secao">
      <div class="container">
        <header class="secao__cab revelar">
          <span class="rotulo">Avaliações</span>
          <h2>O que dizem os clientes</h2>
          ${total > 0 && html`<p class="texto-suave">${estrelas(media, { tamanho: 18 })} <strong>${String(media).replace(".", ",")}</strong> · ${plural(total, "avaliação", "avaliações")}</p>`}
        </header>
        <div class="depoimentos">
          ${avaliacoes.map((a) => html`
            <figure class="depoimento revelar">
              ${estrelas(a.nota)}
              <blockquote>${a.comentario}</blockquote>
              <figcaption><span class="avatar">${a.nome[0]}</span> ${a.nome}</figcaption>
              ${a.resposta && html`<p class="depoimento__resposta"><strong>Resposta da loja:</strong> ${a.resposta}</p>`}
            </figure>`)}
        </div>
      </div>
    </section>`;
}

export function inicio(ctx) {
  const { config, categorias, produtos } = estado;
  const contagem = (id) => produtos.filter((p) => p.categoria_id === id).length;
  const queridinhos = maisPedidos(8);
  const zonas = config.zonas;
  const menorFrete = zonas.length ? Math.min(...zonas.map((z) => z.taxa)) : null;
  const temCardapio = produtos.length > 0; // cardápio novo, ainda sem produtos cadastrados
  const galeria = (Array.isArray(config.galeria) ? config.galeria : []).slice(0, 8);
  const whats = linkWhats();
  const agora = situacaoAgora(config.horarios);
  const titulo = String(config.textos.hero_titulo ?? "").trim() || config.loja.nome;
  const subtitulo = String(config.textos.hero_subtitulo ?? "").trim() || subtituloPadrao(config);
  const chamada = String(config.loja.slogan ?? "").trim() || String(config.loja.cidade ?? "").trim() || "Pedidos online";
  const historia = String(config.textos.sobre_texto ?? "").trim();
  const receber = config.entrega.entrega_ativa && config.entrega.retirada_ativa ? "Entrega e retirada" : config.entrega.entrega_ativa ? "Entrega em casa" : "Retirada na loja";

  montar(ctx.raiz, html`
    <section class="hero">
      <div class="container hero__in">
        <div class="hero__txt">
          <span class="rotulo">${chamada}</span>
          <h1>${titulo}</h1>
          <p>${subtitulo}</p>
          <div class="hero__botoes">
            ${temCardapio
              ? html`<a href="#/cardapio" class="btn btn--primario btn--grande">Ver cardápio ${icone("direita", { tamanho: 18 })}</a>`
              : html`<a href="${whats ?? "#/contato"}" ${whats && NOVA_ABA} class="btn btn--primario btn--grande">${whats ? "Encomendar pelo WhatsApp" : "Falar com a loja"}</a>`}
            ${whats && temCardapio
              ? html`<a href="${whats}" target="_blank" rel="noopener" class="btn btn--contorno btn--grande">${icone("mensagem", { tamanho: 18 })} WhatsApp</a>`
              : html`<a href="#/contato" class="btn btn--contorno btn--grande">Onde estamos</a>`}
          </div>
          <ul class="hero__provas">
            <li class="hero__agora ${agora.aberta && "hero__agora--aberta"}"><span class="hero__ponto" aria-hidden="true"></span>${agora.texto}</li>
            <li>${icone("caminhao", { tamanho: 17 })} ${receber}</li>
            <li id="nota-media" hidden></li>
          </ul>
        </div>
        <div class="hero__arte revelar">${arteDoTopo(config, produtos)}</div>
      </div>
    </section>

    <section class="container como-funciona" aria-label="Como funciona">
      ${comoFunciona(config).map(([ic, t, texto], i) => html`
        <article class="como revelar">
          <span class="como__num">${i + 1}</span>
          <span class="como__ico">${icone(ic, { tamanho: 22 })}</span>
          <h3>${t}</h3>
          <p>${texto}</p>
        </article>`)}
    </section>

    ${!temCardapio && html`
    <section class="secao secao--curta">
      <div class="container">
        <div class="cardapio-vazio revelar">
          <span class="cardapio-vazio__ico">${icone("sacola", { tamanho: 28 })}</span>
          <div>
            <h2>O cardápio está chegando</h2>
            <p>Em breve os produtos aparecem aqui. Enquanto isso, ${whats ? "chame a loja no WhatsApp" : "fale com a loja"} para encomendar.</p>
          </div>
          <a href="${whats ?? "#/contato"}" ${whats && NOVA_ABA} class="btn btn--primario">${whats ? html`${icone("mensagem", { tamanho: 18 })} WhatsApp` : "Falar com a loja"}</a>
        </div>
      </div>
    </section>`}

    ${temCardapio && categorias.length > 0 && html`
    <section class="secao">
      <div class="container">
        <header class="secao__cab secao__cab--linha revelar">
          <div><span class="rotulo">Categorias</span><h2>O que você procura?</h2></div>
          <a href="#/cardapio" class="link-seta">Ver tudo ${icone("direita", { tamanho: 16 })}</a>
        </header>
        <div class="categorias">
          ${categorias.map((c) => html`
            <a class="categoria revelar" href="#/cardapio?cat=${c.id}">
              <span class="categoria__ico">${icone(c.icone || "sacola", { tamanho: 26 })}</span>
              <strong>${c.nome}</strong>
              <small>${plural(contagem(c.id), "opção", "opções")}</small>
            </a>`)}
        </div>
      </div>
    </section>`}

    ${temCardapio && html`
    <section class="secao secao--marca">
      <div class="container">
        <header class="secao__cab secao__cab--linha revelar">
          <div><span class="rotulo">Destaques</span><h2>Mais pedidos</h2></div>
          <a href="#/cardapio" class="link-seta">Cardápio completo ${icone("direita", { tamanho: 16 })}</a>
        </header>
        <div class="grade-produtos" id="queridinhos">${queridinhos.map((p, i) => cartaoProduto(p, i))}</div>
      </div>
    </section>`}

    <section class="container revelar">
      <div class="faixa-entrega">
        <div>
          <span class="rotulo">${receber}</span>
          <h2>${config.entrega.entrega_ativa ? "Levamos até você" : "Retire na loja"}</h2>
          <p>${config.entrega.entrega_ativa
            ? html`${zonas.length ? `Entregamos em até ${Math.max(...zonas.map((z) => z.ate_km))} km da loja` : "Entregamos na região"}${menorFrete != null ? html`, com frete a partir de <strong>${brl(menorFrete)}</strong>` : ". O frete aparece no carrinho"}.`
            : "No momento atendemos somente retirada na loja."}
            ${config.entrega.entrega_ativa && config.entrega.retirada_ativa && " Prefere buscar? A retirada é sem custo."}
            ${config.entrega.gratis_acima > 0 && html` Frete grátis em pedidos acima de <strong>${brl(config.entrega.gratis_acima)}</strong>.`}</p>
          <a href="#/contato" class="btn btn--primario">${icone("pino", { tamanho: 18 })} Ver no mapa</a>
        </div>
        <div class="faixa-entrega__ico" aria-hidden="true">${icone(config.entrega.entrega_ativa ? "caminhao" : "sacola", { tamanho: 56 })}</div>
      </div>
    </section>

    ${galeria.length > 0 && html`
    <section class="secao">
      <div class="container">
        <header class="secao__cab secao__cab--linha revelar">
          <div><span class="rotulo">Galeria</span><h2>Um pouco do nosso trabalho</h2></div>
          ${config.loja.instagram && html`<a class="link-seta" href="https://instagram.com/${config.loja.instagram}" target="_blank" rel="noopener">${icone("instagram", { tamanho: 16 })} @${config.loja.instagram}</a>`}
        </header>
        <div class="galeria">${galeria.map((url) => html`<figure class="galeria__foto revelar"><img src="${url}" alt="Foto da ${config.loja.nome}" loading="lazy"></figure>`)}</div>
      </div>
    </section>`}

    <div id="avaliacoes"></div>

    ${historia && html`
    <section class="secao">
      <div class="container sobre ${!config.textos.sobre_imagem && "sobre--so-texto"}">
        ${config.textos.sobre_imagem && html`<figure class="sobre__foto revelar"><img src="${config.textos.sobre_imagem}" alt="${config.loja.nome}" loading="lazy"></figure>`}
        <div class="sobre__txt revelar">
          <span class="rotulo">Sobre nós</span>
          <h2>${String(config.textos.sobre_titulo ?? "").trim() || config.loja.nome}</h2>
          ${historia.split(/\n\s*\n/).map((p) => html`<p>${p}</p>`)}
        </div>
      </div>
    </section>`}

    <section class="secao secao--marca">
      <div class="container">
        <header class="secao__cab revelar"><span class="rotulo">Dúvidas</span><h2>Perguntas frequentes</h2></header>
        <div class="faq revelar">
          ${perguntas(config).map((q) => html`<details class="faq__item"><summary>${q.p}${icone("mais", { tamanho: 22 })}</summary><p>${q.r}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="container revelar">
      <div class="chamada-final">
        <h2>${temCardapio ? "Pronto para pedir?" : "Quer encomendar?"}</h2>
        <p>${temCardapio ? "Escolha no cardápio, agende o dia e acompanhe tudo por aqui." : "O cardápio está chegando. Enquanto isso, fale com a loja."}</p>
        <div class="chamada-final__botoes">
          <a href="${temCardapio ? "#/cardapio" : whats ?? "#/contato"}" ${!temCardapio && whats && NOVA_ABA} class="btn btn--primario btn--grande">${temCardapio ? "Fazer meu pedido" : whats ? "WhatsApp" : "Falar com a loja"}</a>
          ${whats && temCardapio && html`<a href="${whats}" target="_blank" rel="noopener" class="btn btn--contorno-claro btn--grande">${icone("mensagem", { tamanho: 18 })} WhatsApp</a>`}
        </div>
      </div>
    </section>`);

  const desligar = ligarProdutos(ctx.raiz, ctx);
  revelarAoRolar(ctx.raiz);

  // avaliações reais aprovadas no painel (a seção só aparece se existirem)
  api.get("/avaliacoes").then((dados) => {
    if (!ctx.ativo()) return;
    if (dados.avaliacoes.length) {
      montar(document.getElementById("avaliacoes"), avaliacoesHtml(dados));
      revelarAoRolar(document.getElementById("avaliacoes"));
    }
    const nota = document.getElementById("nota-media");
    if (nota && dados.total > 0) {
      nota.hidden = false;
      nota.innerHTML = String(html`${icone("estrela", { tamanho: 17, preenchido: true })} ${String(dados.media).replace(".", ",")} (${dados.total})`);
    }
  }).catch(() => {});

  return desligar;
}
