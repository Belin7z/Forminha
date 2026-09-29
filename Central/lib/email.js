/* ==========================================================
   E-MAIL — mensagens para as clientes da Forminha, pelo Gmail.
   Usa uma "senha de app" do Google (SMTP_USUARIO + SMTP_SENHA),
   nunca a senha normal da conta. Sem isso configurado, a Central
   segue funcionando e mostra os links no painel para você enviar.
   ========================================================== */
import nodemailer from "nodemailer";

export function criarEmail({ usuario, senha, nome = "Forminha", transporte = null }) {
  if (!transporte && (!usuario || !senha)) return null;
  const t = transporte ?? nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: usuario, pass: senha } });
  return {
    async enviar({ para, assunto, texto, html }) {
      await t.sendMail({ from: { name: nome, address: usuario ?? "forminha@teste.local" }, to: para, subject: assunto, text: texto, html });
    },
  };
}

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Moldura única: fundo claro, cartão branco, botão escuro — funciona nos leitores de e-mail comuns. */
function moldura({ titulo, paragrafos, botao, rodape }) {
  const corpo = paragrafos.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3f3c39">${p}</p>`).join("");
  const acao = botao ? `<p style="margin:26px 0 8px"><a href="${esc(botao.link)}" style="display:inline-block;background:#2f2925;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;font-size:15px">${esc(botao.texto)}</a></p>
    <p style="margin:0 0 6px;font-size:12px;color:#757270">Se o botão não abrir, copie este endereço:<br><span style="word-break:break-all">${esc(botao.link)}</span></p>` : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f1ed;font-family:Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ed;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e8e4e0">
      <tr><td style="padding:30px 32px 8px"><p style="margin:0;font-family:Georgia,serif;font-size:22px;color:#2f2925">Forminha</p></td></tr>
      <tr><td style="padding:8px 32px 30px"><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#2f2925">${esc(titulo)}</h1>${corpo}${acao}</td></tr>
    </table>
    <p style="margin:18px 0 0;font-size:12px;color:#8a8580">${rodape ?? "Você recebeu este e-mail porque tem uma loja na Forminha."}</p>
  </td></tr></table></body></html>`;
}

export const modelos = {
  cobranca: ({ nome, nomeLoja, valorCentavos, link }) => ({
    assunto: `Pagamento da sua loja ${nomeLoja}`,
    texto: `Olá, ${nome}!\n\nFalta só o pagamento para a sua loja "${nomeLoja}" ficar pronta: ${brl(valorCentavos)} por PIX.\nPague por este link: ${link}\n\nAssim que o pagamento for confirmado, enviamos o acesso por e-mail.\n\nForminha`,
    html: moldura({
      titulo: "Falta só o pagamento",
      paragrafos: [`Olá, ${esc(nome)}!`, `Sua loja <strong>${esc(nomeLoja)}</strong> fica pronta assim que o PIX de <strong>${esc(brl(valorCentavos))}</strong> for confirmado.`, "Assim que confirmar, enviamos o acesso para este e-mail."],
      botao: { texto: "Pagar com PIX", link },
    }),
  }),
  boasVindas: ({ nome, nomeLoja, convite, loja }) => ({
    assunto: `Sua loja ${nomeLoja} está pronta`,
    texto: `Olá, ${nome}!\n\nPagamento confirmado e sua loja "${nomeLoja}" está no ar: ${loja}\n\nCrie seu acesso ao painel por este link (vale 7 dias e funciona uma vez): ${convite}\n\nForminha`,
    html: moldura({
      titulo: "Sua loja está pronta",
      paragrafos: [`Olá, ${esc(nome)}!`, `Pagamento confirmado. A loja <strong>${esc(nomeLoja)}</strong> já está no ar em <a href="${esc(loja)}" style="color:#6f573c">${esc(String(loja).replace("https://", ""))}</a>.`, "Crie seu acesso ao painel para colocar seu logo, suas cores e seus doces. O link vale 7 dias e funciona uma vez."],
      botao: { texto: "Criar meu acesso", link: convite },
    }),
  }),
  convite: ({ nome, nomeLoja, convite }) => ({
    assunto: `Seu acesso à loja ${nomeLoja}`,
    texto: `Olá, ${nome}!\n\nAqui está o link para criar seu acesso ao painel da loja "${nomeLoja}" (vale 7 dias e funciona uma vez): ${convite}\n\nForminha`,
    html: moldura({
      titulo: "Seu acesso ao painel",
      paragrafos: [`Olá, ${esc(nome)}!`, `Use o botão abaixo para criar seu acesso ao painel da loja <strong>${esc(nomeLoja)}</strong>. O link vale 7 dias e funciona uma vez.`],
      botao: { texto: "Criar meu acesso", link: convite },
    }),
  }),
  redefinirSenha: ({ nome, nomeLoja, link }) => ({
    assunto: `Redefinir sua senha — ${nomeLoja}`,
    texto: `Olá, ${nome}!\n\nPara criar uma senha nova para a loja "${nomeLoja}", use este link (vale por pouco tempo): ${link}\n\nSe você não pediu, ignore este e-mail.\n\nForminha`,
    html: moldura({
      titulo: "Criar uma senha nova",
      paragrafos: [`Olá, ${esc(nome)}!`, `Recebemos um pedido para trocar a senha do painel da loja <strong>${esc(nomeLoja)}</strong>. O link vale por pouco tempo.`, "Se não foi você, ignore este e-mail: sua senha continua a mesma."],
      botao: { texto: "Criar senha nova", link },
    }),
  }),
  /** Para a dona: a mensalidade (vai vencer ou venceu). */
  mensalidade: ({ nome, nomeLoja, valorCentavos, vencimento, link, atrasada = false }) => ({
    assunto: atrasada ? `Mensalidade da ${nomeLoja} em atraso` : `Mensalidade da ${nomeLoja}: vence em ${vencimento}`,
    texto: `Olá, ${nome}!\n\n${atrasada ? `A mensalidade da sua loja "${nomeLoja}" venceu em ${vencimento}. Para a loja continuar recebendo pedidos pelo site, pague por este link:` : `A mensalidade da sua loja "${nomeLoja}" (${brl(valorCentavos)}) vence em ${vencimento}. Pague pelo PIX neste link:`} ${link}\n\nForminha`,
    html: moldura({
      titulo: atrasada ? "Mensalidade em atraso" : "Sua mensalidade",
      paragrafos: [`Olá, ${esc(nome)}!`,
        atrasada ? `A mensalidade da loja <strong>${esc(nomeLoja)}</strong> venceu em <strong>${esc(vencimento)}</strong>. Pague para a loja continuar recebendo pedidos pelo site.`
          : `A mensalidade da loja <strong>${esc(nomeLoja)}</strong> (<strong>${esc(brl(valorCentavos))}</strong>) vence em <strong>${esc(vencimento)}</strong>.`],
      botao: { texto: "Pagar com PIX", link },
    }),
  }),
  /** Para a dona: a loja parou de receber pedidos pelo site (mensalidade muito atrasada). */
  lojaSuspensa: ({ nome, nomeLoja, link }) => ({
    assunto: `A ${nomeLoja} parou de receber pedidos pelo site`,
    texto: `Olá, ${nome}!\n\nA mensalidade da loja "${nomeLoja}" está atrasada e a loja parou de receber pedidos pelo site (o seu painel continua funcionando). Pague por este link e ela volta na hora: ${link}\n\nForminha`,
    html: moldura({
      titulo: "A loja parou de receber pedidos",
      paragrafos: [`Olá, ${esc(nome)}!`, `A mensalidade da loja <strong>${esc(nomeLoja)}</strong> está atrasada e o site parou de receber pedidos. O seu painel continua funcionando.`, "Pague pelo link e a loja volta na hora."],
      botao: { texto: "Pagar e reativar", link },
    }),
  }),
  /** Para você: link para criar uma senha nova da Central (pedido em "Esqueci a senha"). */
  recuperarCentral: ({ link }) => ({
    assunto: "Forminha: criar uma senha nova para a Central",
    texto: `Para criar uma senha nova para a Central da Forminha, use este link (vale 30 minutos e uma vez só): ${link}\n\nSe não foi você, ignore este e-mail: a senha continua a mesma.\n\nForminha`,
    html: moldura({
      titulo: "Criar uma senha nova",
      paragrafos: ["Recebemos um pedido para trocar a senha da Central da Forminha. O link vale 30 minutos e funciona uma vez só.", "Se não foi você, ignore este e-mail: a senha continua a mesma."],
      botao: { texto: "Criar senha nova", link },
    }),
  }),
  /** Para você: algo deu errado na Central (erros parecidos são juntados: no máximo um e-mail a cada 6 horas). */
  alertaErro: ({ titulo, detalhe, urlCentral }) => ({
    assunto: `Forminha: ${titulo}`,
    texto: `${titulo}\n\n${detalhe}\n\nO aviso também aparece no sino da Central: ${urlCentral}`,
    html: moldura({
      titulo,
      paragrafos: [esc(detalhe), "O aviso também aparece no sino da Central. Se continuar acontecendo, confira as chaves em Configurações."],
      botao: { texto: "Abrir a Central", link: urlCentral },
    }),
  }),
  /** Para você (dona da Central): uma chave vai vencer ou foi recusada. `linhas` já vêm prontas. */
  alertaChaves: ({ linhas, urlCentral }) => ({
    assunto: `Forminha: ${linhas[0]}`,
    texto: `${linhas.join("\n")}\n\nEnquanto isso não for resolvido, a Central pode parar de criar lojas.\nCrie uma chave nova e rode "npm run configurar" na pasta Central (opção 5 para o Supabase, 6 para a Vercel).\n\n${urlCentral}`,
    html: moldura({
      titulo: "Hora de trocar uma chave",
      paragrafos: [...linhas.map((l) => `<strong>${esc(l)}</strong>`), "Enquanto isso não for resolvido, a Central pode parar de criar lojas.",
        `Crie uma chave nova e rode <code>npm run configurar</code> na pasta Central: opção 5 para o Supabase, 6 para a Vercel.`],
      botao: { texto: "Abrir a Central", link: urlCentral },
      rodape: "Aviso automático da sua Central da Forminha.",
    }),
  }),
};
