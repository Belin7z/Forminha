/* ==========================================================
   E-MAILS DO LOGIN DAS LOJAS — o que o Supabase manda para as
   clientes das docerias ("esqueci a senha", trocar o e-mail…).
   • Os textos em português (o padrão do Supabase é em inglês).
   • Com o e-mail profissional ligado (Resend), saem do seu domínio,
     sem o limite de poucos e-mails por hora do Supabase.
   Aplicado no login de cada loja (projeto próprio) e no banco único.
   ========================================================== */

/** Muda quando os textos ou o envio mudam: a Central reaplica sozinha. */
export const VERSAO_DOS_EMAILS = "2026-09-30";

const caixa = (titulo, texto, botao) => `<div style="margin:0;padding:24px;background:#f6f3ef;font-family:Arial,Helvetica,sans-serif;color:#2b2320">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:20px">${titulo}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${texto}</p>
    <p style="margin:0 0 20px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#2b2320;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">${botao}</a></p>
    <p style="margin:0;font-size:13px;color:#7a6f6a;line-height:1.5">Se não foi você quem pediu, ignore este e-mail: nada muda na sua conta.</p>
  </div>
</div>`;

/** Assuntos e textos (HTML) dos e-mails, com {{ .ConfirmationURL }} do Supabase. */
export function modelosDoLogin() {
  return {
    mailer_subjects_recovery: "Crie uma senha nova",
    mailer_templates_recovery_content: caixa("Senha nova", "Recebemos um pedido para criar uma senha nova para a sua conta. O link vale por pouco tempo.", "Criar senha nova"),
    mailer_subjects_confirmation: "Confirme o seu e-mail",
    mailer_templates_confirmation_content: caixa("Confirme o seu e-mail", "Falta só confirmar o seu e-mail para terminar o cadastro.", "Confirmar e-mail"),
    mailer_subjects_email_change: "Confirme o seu novo e-mail",
    mailer_templates_email_change_content: caixa("Novo e-mail", "Confirme que este é o seu novo e-mail para entrar na sua conta.", "Confirmar novo e-mail"),
    mailer_subjects_magic_link: "Seu link para entrar",
    mailer_templates_magic_link_content: caixa("Entrar na sua conta", "Use o botão abaixo para entrar. O link vale por pouco tempo.", "Entrar"),
    mailer_subjects_invite: "Você foi convidada",
    mailer_templates_invite_content: caixa("Convite", "Você recebeu um convite. Use o botão abaixo para criar a sua senha.", "Aceitar o convite"),
  };
}

/**
 * Envio pelo Resend (SMTP), se a Central tiver o e-mail profissional ligado (RESEND_API_KEY + EMAIL_REMETENTE).
 * Sem ele, devolve {} e o Supabase continua enviando pelo servidor dele (com limite por hora).
 */
export function envioDoLogin({ resend, remetente, nome = "Forminha" } = {}) {
  if (!resend || !remetente) return {};
  return {
    smtp_admin_email: remetente, smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: resend,
    smtp_sender_name: String(nome).replace(/[<>"]/g, "").slice(0, 60) || "Forminha", smtp_max_frequency: 30, rate_limit_email_sent: 200,
  };
}

/** Tudo o que vai para a configuração do login (Management API: PATCH /config/auth). */
export const configuracaoDosEmails = (envio) => ({ ...modelosDoLogin(), ...envioDoLogin(envio) });
