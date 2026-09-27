/* PÁGINAS — política de privacidade e termos de uso (o texto pode ser editado no Dashboard) */
import { html, montar } from "/src/scripts/base/html.js";
import { estado } from "../nucleo/estado.js";

const DATA = "setembro de 2026";

const PADRAO = {
  privacidade: (loja) => `# Quem somos
A ${loja.nome} é responsável pelo tratamento dos dados pessoais coletados neste site.

# Quais dados coletamos
Nome, e-mail, telefone (WhatsApp), endereços de entrega e o histórico dos seus pedidos. Fotos e mensagens enviadas junto com um pedido também são guardadas.

# Para que usamos
Para criar a sua conta, receber e preparar os pedidos, calcular a entrega, avisar sobre o andamento e falar com você quando necessário. Não vendemos os seus dados.

# Com quem compartilhamos
Apenas com serviços necessários para o site funcionar (hospedagem, banco de dados e envio de e-mails) e, quando você escolhe entrega, com quem a realiza. Esses serviços seguem regras de segurança compatíveis com a LGPD.

# Por quanto tempo guardamos
Enquanto a sua conta existir. Pedidos já realizados podem ser mantidos de forma anônima para fins fiscais e de controle.

# Seus direitos (LGPD)
Você pode acessar e corrigir os seus dados em “Minha conta”, e pode excluir a sua conta a qualquer momento nessa mesma página. Para outras solicitações, fale com a gente${loja.email ? " pelo e-mail " + loja.email : " pelos canais de atendimento do rodapé"}.

# Cookies
Usamos apenas o armazenamento do navegador necessário para manter você conectado(a) e guardar o seu carrinho. Não usamos cookies de publicidade.`,

  termos: (loja) => `# Pedidos
Os pedidos feitos neste site são encomendas: a data e o horário escolhidos dependem da antecedência mínima informada em cada produto e da disponibilidade da agenda.

# Preços e pagamento
Os preços e o frete são calculados no momento do pedido e podem ser alterados sem aviso para pedidos futuros. As formas de pagamento disponíveis aparecem ao finalizar o pedido. Em alguns pedidos pode ser pedido um sinal para confirmar a encomenda.

# Alterações e cancelamentos
Enquanto o pedido está como “Pedido recebido”, você pode cancelá-lo pelo site. Depois de confirmado, entre em contato com a loja: como os produtos são feitos sob encomenda, o cancelamento pode não ser possível.

# Entrega e retirada
A entrega depende do endereço informado estar dentro da nossa área de atendimento. É importante que alguém receba o pedido no horário combinado. Na retirada, o endereço aparece no rodapé do site.

# Cuidados com os produtos
Os doces são produzidos com ingredientes que podem conter leite, ovos, glúten, castanhas e outros alérgenos. Se você tem alguma alergia, avise antes de finalizar o pedido.

# Fale com a gente
${loja.nome}${loja.email ? " — " + loja.email : ""}`,
};

const TITULOS = { privacidade: "Política de privacidade", termos: "Termos de uso" };

function conteudo(texto) {
  const blocos = [];
  for (const linha of texto.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    if (linha.startsWith("# ")) blocos.push(html`<h2>${linha.slice(2)}</h2>`);
    else blocos.push(html`<p>${linha}</p>`);
  }
  return blocos;
}

export const paginaPrivacidade = (ctx) => pagina(ctx, "privacidade");
export const paginaTermos = (ctx) => pagina(ctx, "termos");

function pagina(ctx, tipo) {
  const { loja } = estado.config;
  const escrito = estado.config.legal?.[tipo];
  const texto = escrito && escrito.trim() ? escrito : PADRAO[tipo](loja);
  montar(ctx.raiz, html`
    <section class="container pagina-simples texto-legal">
      <header class="pagina-cab"><h1>${TITULOS[tipo]}</h1><p class="texto-suave">Atualizado em ${DATA}</p></header>
      <article class="cartao-form">${conteudo(texto)}</article>
    </section>`);
}
