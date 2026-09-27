/* PÁGINA — início: apresentação, categorias, queridinhos, como pedir, entrega, galeria, depoimentos, perguntas e sobre */
import { html, montar } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { brl, horasTexto, plural } from "/src/scripts/base/formatacao.js";
import { api } from "../nucleo/api.js";
import { estado } from "../nucleo/estado.js";
import { maisPedidos } from "../nucleo/catalogo.js";
import { cartaoProduto } from "../componentes/cartao-produto.js";
import { ligarProdutos } from "../componentes/acoes-produto.js";
import { estrelas } from "../componentes/estrelas.js";
import { ilustracaoBolo } from "../componentes/ilustracoes.js";
import { revelarAoRolar } from "../componentes/revelar.js";
import { linkWhats } from "../componentes/rodape.js";

const PASSOS = [
  ["Escolha", "Navegue pelo cardápio e monte seu pedido com as opções que você gosta."],
  ["Agende", "Diga quando quer receber e se prefere entrega ou retirada."],
  ["Acompanhe", "Veja cada etapa do preparo em tempo real, do forno até a sua porta."],
  ["Aproveite", "Receba fresquinho, lindo e feito com carinho. Depois, conte o que achou!"],
];

const DIFERENCIAIS = [
  ["faisca", "Ingredientes selecionados", "Chocolate de verdade, frutas frescas e nada de essências artificiais."],
  ["chef", "Feito à mão", "Cada receita é preparada em pequenos lotes, com o cuidado de um ateliê."],
  ["caixa", "Embalagem cuidadosa", "Caixas especiais para o doce chegar perfeito até você."],
  ["presente", "Do seu jeito", "Escolha tamanhos, recheios e adicionais direto no pedido."],
];

/** Perguntas frequentes: as cadastradas no Dashboard ou, se não houver, respostas montadas com os dados da loja. */
function perguntas(config) {
  if (Array.isArray(config.faq) && config.faq.length) return config.faq;
  const { pedidos, entrega, pagamento } = config;
  const formas = [pagamento.pix_ativo && "PIX", pagamento.dinheiro_ativo && "dinheiro", pagamento.cartao_ativo && "cartão (na entrega ou na retirada)"].filter(Boolean);
  return [
    { p: "Com quanta antecedência preciso encomendar?", r: `Trabalhamos com encomendas: pedimos ao menos ${horasTexto(pedidos.antecedencia_horas)} de antecedência (alguns produtos pedem mais, e o aviso aparece no carrinho). Você escolhe a data e o horário direto no pedido.` },
    { p: "Vocês entregam?", r: entrega.entrega_ativa ? `Sim! O frete é calculado pela distância até o seu endereço.${entrega.retirada_ativa ? " Se preferir, também é possível retirar no ateliê, sem custo." : ""}` : "No momento atendemos somente com retirada no ateliê." },
    { p: "Como posso pagar?", r: formas.length ? `Aceitamos ${formas.join(", ").replace(/, ([^,]*)$/, " e $1")}. Ao finalizar o pedido, você vê as instruções de pagamento.` : "As formas de pagamento aparecem ao finalizar o pedido." },
    { p: "Posso personalizar o meu pedido?", r: "Sim. Muitos produtos têm opções de tamanho, recheio e adicionais, e há um campo de observações para contar o tema, as cores e a dedicatória." },
    { p: "Como acompanho o meu pedido?", r: "Depois de criar a sua conta, em “Meus pedidos” você vê cada etapa, do recebimento até a entrega, com atualização automática." },
  ];
}

function avaliacoesHtml({ avaliacoes, media, total }) {
  if (!avaliacoes.length) return "";
  return html`
    <section class="secao">
      <div class="container">
        <header class="secao__cab revelar">
          <span class="rotulo">Quem provou, aprovou</span>
          <h2>O que dizem nossos <span class="script">clientes</span></h2>
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
  const paragrafos = config.textos.sobre_texto.split(/\n\s*\n/);
  const temCardapio = produtos.length > 0; // cardápio novo, ainda sem produtos cadastrados
  const galeria = (Array.isArray(config.galeria) ? config.galeria : []).slice(0, 8);
  const whats = linkWhats();
  const heroImagem = config.textos.hero_imagem;
  const sobreImagem = config.textos.sobre_imagem;

  montar(ctx.raiz, html`
    <section class="hero">
      <div class="container hero__in">
        <div class="hero__txt">
          <span class="rotulo">${config.loja.slogan}</span>
          <h1>${config.textos.hero_titulo}</h1>
          <p>${config.textos.hero_subtitulo}</p>
          <div class="hero__botoes">
            <a href="#/cardapio" class="btn btn--primario btn--grande">Ver cardápio</a>
            <a href="#/contato" class="btn btn--contorno btn--grande">Onde entregamos</a>
          </div>
          <ul class="hero__provas">
            <li>${icone("caminhao", { tamanho: 18 })} Entrega e retirada</li>
            <li>${icone("calendario", { tamanho: 18 })} Encomende com ${horasTexto(config.pedidos.antecedencia_horas)} de antecedência</li>
            <li id="nota-media" hidden></li>
          </ul>
        </div>
        <div class="hero__arte">
          <div class="hero__moldura">
            <div class="arco">
              ${heroImagem
                ? html`<img src="${heroImagem}" alt="${config.loja.nome}" fetchpriority="high">`
                : html`<div class="arco__ilustracao">${ilustracaoBolo()}</div>`}
            </div>
            <span class="faisca faisca--1" aria-hidden="true">${icone("faisca", { tamanho: 30 })}</span>
            <span class="faisca faisca--2" aria-hidden="true">${icone("faisca", { tamanho: 22 })}</span>
            <span class="faisca faisca--3" aria-hidden="true">${icone("faisca", { tamanho: 16 })}</span>
            <div class="hero__nota">
              <span class="hero__nota__ico">${icone("chef", { tamanho: 22 })}</span>
              <div><strong>Feito à mão</strong><small>sob encomenda, com carinho</small></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="container diferenciais revelar">
      ${DIFERENCIAIS.map(([ic, titulo, texto]) => html`<article class="diferencial"><span class="diferencial__ico">${icone(ic, { tamanho: 26 })}</span><h3>${titulo}</h3><p>${texto}</p></article>`)}
    </section>

    ${!temCardapio && html`
    <section class="secao">
      <div class="container">
        <div class="vazio">
          <span class="vazio__ico">${icone("bolo", { tamanho: 38 })}</span>
          <h3>Estamos preparando o nosso cardápio</h3>
          <p>Em breve você poderá escolher seus doces por aqui. Enquanto isso, fale com a gente para encomendar.</p>
          <a href="#/contato" class="btn btn--primario">Falar com a loja</a>
        </div>
      </div>
    </section>`}

    ${temCardapio && categorias.length > 0 && html`
    <section class="secao">
      <div class="container">
        <header class="secao__cab revelar">
          <span class="rotulo">Categorias</span>
          <h2>O que você procura <span class="script">hoje?</span></h2>
          <div class="ornamento" aria-hidden="true"><i></i></div>
        </header>
        <div class="categorias">
          ${categorias.map((c) => html`
            <a class="categoria revelar" href="#/cardapio?cat=${c.id}">
              <span class="categoria__ico">${icone(c.icone || "bolo", { tamanho: 30 })}</span>
              <strong>${c.nome}</strong>
              <small>${plural(contagem(c.id), "opção", "opções")}</small>
            </a>`)}
        </div>
      </div>
    </section>`}

    ${temCardapio && html`
    <section class="secao secao--rosa">
      <div class="container">
        <header class="secao__cab revelar">
          <span class="rotulo">Os queridinhos</span>
          <h2>Mais pedidos da <span class="script">casa</span></h2>
          <div class="ornamento" aria-hidden="true"><i></i></div>
        </header>
        <div class="grade-produtos" id="queridinhos">${queridinhos.map((p, i) => cartaoProduto(p, i))}</div>
        <p class="texto-centro"><a href="#/cardapio" class="btn btn--escuro">Ver cardápio completo ${icone("direita", { tamanho: 18 })}</a></p>
      </div>
    </section>`}

    <section class="secao">
      <div class="container">
        <header class="secao__cab revelar"><span class="rotulo">Passo a passo</span><h2>Como <span class="script">pedir</span></h2><div class="ornamento" aria-hidden="true"><i></i></div></header>
        <ol class="passos">
          ${PASSOS.map(([titulo, texto], i) => html`<li class="passo revelar"><b>0${i + 1}</b><h3>${titulo}</h3><p>${texto}</p></li>`)}
        </ol>
      </div>
    </section>

    <section class="container revelar">
      <div class="faixa-entrega">
        <div>
          <span class="rotulo">Entrega e retirada</span>
          <h2>Levamos até <span class="script">você</span></h2>
          <p>${config.entrega.entrega_ativa
            ? html`Entregamos ${zonas.length ? `em até ${Math.max(...zonas.map((z) => z.ate_km))} km da loja` : "na região"}${menorFrete != null ? html`, com frete a partir de <strong>${brl(menorFrete)}</strong>` : ""}.`
            : "No momento atendemos somente retirada no ateliê."}
            ${config.entrega.retirada_ativa && " Prefere buscar? A retirada é sem custo."}
            ${config.entrega.gratis_acima > 0 && html` Frete grátis em pedidos acima de <strong>${brl(config.entrega.gratis_acima)}</strong>.`}</p>
          <a href="#/contato" class="btn btn--primario">${icone("pino", { tamanho: 18 })} Ver no mapa</a>
        </div>
        <div class="faixa-entrega__ico" aria-hidden="true">${icone("caminhao", { tamanho: 62 })}</div>
      </div>
    </section>

    ${galeria.length > 0 && html`
    <section class="secao">
      <div class="container">
        <header class="secao__cab revelar"><span class="rotulo">Galeria</span><h2>Um pouco do nosso <span class="script">ateliê</span></h2><div class="ornamento" aria-hidden="true"><i></i></div></header>
        <div class="galeria">${galeria.map((url) => html`<figure class="galeria__foto revelar"><img src="${url}" alt="Doces da ${config.loja.nome}" loading="lazy"></figure>`)}</div>
        ${config.loja.instagram && html`<p class="galeria__insta"><a class="btn btn--contorno" href="https://instagram.com/${config.loja.instagram}" target="_blank" rel="noopener">${icone("instagram", { tamanho: 18 })} Ver mais no Instagram</a></p>`}
      </div>
    </section>`}

    <div id="avaliacoes"></div>

    <section class="secao secao--rosa">
      <div class="container">
        <header class="secao__cab revelar"><span class="rotulo">Dúvidas</span><h2>Perguntas <span class="script">frequentes</span></h2><div class="ornamento" aria-hidden="true"><i></i></div></header>
        <div class="faq revelar">
          ${perguntas(config).map((q) => html`<details class="faq__item"><summary>${q.p}${icone("mais", { tamanho: 22 })}</summary><p>${q.r}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="secao">
      <div class="container sobre">
        <div class="sobre__arte revelar" aria-hidden="${sobreImagem ? "false" : "true"}"><div class="moldura">${sobreImagem ? html`<img src="${sobreImagem}" alt="${config.loja.nome}" loading="lazy">` : html`<span class="moldura__ico">${icone("chef", { tamanho: 64 })}</span>`}</div></div>
        <div class="sobre__txt revelar">
          <span class="rotulo">Conheça a confeiteira</span>
          <h2>${config.textos.sobre_titulo}</h2>
          ${paragrafos.map((p) => html`<p>${p}</p>`)}
          <a href="#/cardapio" class="btn btn--primario">Fazer meu pedido</a>
        </div>
      </div>
    </section>

    <section class="container revelar">
      <div class="chamada-final">
        <span class="rotulo">Encomendas</span>
        <h2>Vamos adoçar o seu <span class="script">dia?</span></h2>
        <p>Escolha o que você mais gosta, agende a data e receba tudo feito com carinho.</p>
        <a href="${temCardapio ? "#/cardapio" : "#/contato"}" class="btn btn--primario btn--grande">${temCardapio ? "Fazer meu pedido" : "Falar com a loja"}</a>
        ${whats && html` <a href="${whats}" target="_blank" rel="noopener" class="btn btn--contorno btn--grande" style="color:#fff;border-color:rgba(255,255,255,.4)">${icone("whatsapp", { tamanho: 18 })} WhatsApp</a>`}
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
      nota.innerHTML = String(html`${icone("estrela", { tamanho: 18, preenchido: true })} ${String(dados.media).replace(".", ",")} (${dados.total})`);
    }
  }).catch(() => {});

  return desligar;
}
