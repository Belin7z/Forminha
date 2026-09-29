/* ==========================================================
   TELAS PÚBLICAS — Termos de uso e Política de privacidade da
   Forminha (#/termos e #/privacidade). O nome, o CPF/CNPJ, o e-mail
   e a cidade da empresa vêm de Configurações → Empresa.
   O texto é um modelo claro e completo; vale a revisão de um
   advogado antes de crescer.
   ========================================================== */
import { html, montar } from "/src/scripts/base/html.js";
import { api, marca, raiz } from "../nucleo.js";
import { botaoTema } from "../claro-escuro.js";

const documentoBonito = (d) => {
  const n = String(d ?? "");
  if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return n;
};
const dataBR = (iso) => String(iso ?? "").split("-").reverse().join("/");

function termos(e) {
  const empresa = e.nome || "Forminha";
  return html`
    <h1>Termos de uso</h1>
    <p class="legal__versao">Versão de ${dataBR(e.termos_versao)}</p>
    <p>Estes termos valem entre a <strong>${empresa}</strong>${e.documento && html` (${documentoBonito(e.documento)})`} e a doceria que contrata a loja online (“você”). Ao pagar a criação da loja ou uma mensalidade, você concorda com eles.</p>
    <h2>1. O que a Forminha oferece</h2>
    <p>Uma loja online para a sua doceria (cardápio, pedidos, pagamentos por PIX e cartão quando ligados) e um painel para você cuidar de pedidos, agenda, produção, estoque, clientes e relatórios. A loja é criada depois que o pagamento da criação é confirmado.</p>
    <h2>2. Pagamentos, mensalidade e suspensão</h2>
    <p>A criação da loja e a mensalidade são cobradas por PIX, pelos valores combinados. A mensalidade vence todo mês na data informada; a cobrança chega por e-mail alguns dias antes. Com a mensalidade em atraso por mais tempo que o prazo de tolerância informado, a loja deixa de receber pedidos pelo site até o pagamento — o seu painel e os seus dados continuam disponíveis. Pagando, a loja volta na hora. Créditos de indicação são abatidos das mensalidades e não são trocados por dinheiro.</p>
    <h2>3. Cancelamento</h2>
    <p>Você pode cancelar quando quiser, pelo contato abaixo. Antes, dá para pedir uma cópia dos dados da sua loja. Depois do cancelamento, a loja sai do ar e os dados são apagados em até 90 dias, exceto o que a lei mandar guardar (como registros de pagamento e notas fiscais). Valores já pagos não são devolvidos por período parcial, salvo o que a lei garantir.</p>
    <h2>4. O que é responsabilidade sua</h2>
    <p>Os produtos, preços, fotos, textos, prazos e entregas da sua loja; o atendimento aos seus clientes; as regras do Código de Defesa do Consumidor, sanitárias e fiscais do seu negócio; e guardar com segurança a senha do seu painel. Você é a controladora dos dados pessoais dos seus clientes (veja a Política de privacidade).</p>
    <h2>5. O que é responsabilidade da Forminha</h2>
    <p>Manter a loja e o painel funcionando, com segurança, cópias de segurança e suporte pelo contato abaixo. Fazemos o possível para o serviço não parar, mas podem acontecer interrupções (manutenção, provedores de internet e de nuvem). A Forminha não responde por perdas indiretas nem por problemas causados por serviços de terceiros (bancos, Mercado Pago, WhatsApp) ou por uso indevido do painel.</p>
    <h2>6. Uso proibido</h2>
    <p>Não é permitido usar a loja para produtos ilegais, conteúdo ofensivo ou enganoso, spam ou para tentar invadir o sistema. Nesses casos a loja pode ser suspensa.</p>
    <h2>7. Mudanças nestes termos</h2>
    <p>Quando os termos mudarem, avisamos por e-mail com antecedência. Continuar usando depois do aviso é concordar com a versão nova.</p>
    <h2>8. Contato e foro</h2>
    <p>${e.email ? html`Fale com a gente em <a class="link" href="mailto:${e.email}">${e.email}</a>.` : "Fale com a gente pelo contato informado na sua cobrança."}
      Fica eleito o foro${e.cidade ? ` de ${e.cidade}` : " da sede da empresa"} para qualquer questão, salvo o que a lei do consumidor determinar.</p>`;
}

function privacidade(e) {
  const empresa = e.nome || "Forminha";
  return html`
    <h1>Política de privacidade</h1>
    <p class="legal__versao">Versão de ${dataBR(e.termos_versao)}</p>
    <p>Esta política explica como a <strong>${empresa}</strong>${e.documento && html` (${documentoBonito(e.documento)})`} trata os dados pessoais das docerias que contratam a Forminha e das pessoas que compram nas lojas, seguindo a Lei Geral de Proteção de Dados (LGPD).</p>
    <h2>1. Dados das docerias (clientes da Forminha)</h2>
    <p>Guardamos nome, e-mail, WhatsApp, CPF ou CNPJ, o nome da loja e os pagamentos. Usamos para criar e manter a loja, cobrar, emitir nota fiscal, dar suporte e avisar sobre a conta. Base legal: execução do contrato e cumprimento de obrigações legais.</p>
    <h2>2. Dados de quem compra nas lojas</h2>
    <p>Nome, e-mail, telefone, endereço de entrega e pedidos ficam no banco da própria loja. Nesses dados, a doceria é a <strong>controladora</strong> (decide para que usa) e a Forminha é a <strong>operadora</strong> (guarda e processa em nome dela). Cada loja tem a sua própria política, na página de privacidade do site dela.</p>
    <h2>3. Com quem compartilhamos</h2>
    <p>Só com quem precisa para o serviço funcionar: hospedagem e banco de dados (Vercel, Supabase, Neon), pagamentos (Mercado Pago e o seu banco, no PIX), envio de e-mails e mensagens (provedor de e-mail e WhatsApp, quando ligados). Não vendemos dados.</p>
    <h2>4. Segurança</h2>
    <p>Os dados pessoais das docerias ficam <strong>criptografados</strong> no banco da Forminha. O acesso da equipe é por usuário e senha, com verificação em duas etapas disponível e registro de quem fez o quê. Cada loja tem um banco separado.</p>
    <h2>5. Por quanto tempo guardamos</h2>
    <p>Enquanto a loja estiver ativa e, depois do cancelamento, por até 90 dias — exceto registros que a lei manda guardar por mais tempo (pagamentos e notas fiscais, em geral 5 anos).</p>
    <h2>6. Seus direitos</h2>
    <p>Você pode pedir para ver, corrigir, levar (portabilidade) ou apagar os seus dados, e saber com quem foram compartilhados. ${e.email ? html`Peça em <a class="link" href="mailto:${e.email}">${e.email}</a>.` : "Peça pelo contato informado na sua cobrança."} Respondemos em até 15 dias.</p>
    <h2>7. Cookies</h2>
    <p>A Central usa só o cookie necessário para manter você conectado. As lojas usam o armazenamento do navegador para o carrinho e o login do cliente. Não usamos cookies de propaganda.</p>`;
}

/** Mostra os termos (qual = "termos") ou a política de privacidade (qual = "privacidade"). */
export async function telaLegal(qual) {
  document.title = `${qual === "termos" ? "Termos de uso" : "Privacidade"} — Forminha`;
  montar(raiz, html`
    <main class="legal">
      <header class="pagar__topo">${marca}${botaoTema()}</header>
      <article class="legal__texto" data-texto><div class="carregando-pagina"><div class="spinner"></div></div></article>
      <p class="legal__rodape"><a class="link" href="#/termos">Termos de uso</a> · <a class="link" href="#/privacidade">Privacidade</a></p>
    </main>`);
  let e = { nome: "", documento: "", email: "", cidade: "", termos_versao: "" };
  try { e = await api("GET", "publico/empresa"); } catch { /* sem banco: o texto sai com o nome padrão */ }
  montar(raiz.querySelector("[data-texto]"), qual === "termos" ? termos(e) : privacidade(e));
  window.scrollTo(0, 0);
}
