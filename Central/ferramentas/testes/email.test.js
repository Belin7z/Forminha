/* ==========================================================
   E-MAIL PROFISSIONAL (Resend) E GMAIL
     - pelo Resend: remetente do seu domínio, respostas para o
       e-mail que você lê;
     - com os dois ligados, o Gmail é a reserva se o Resend falhar;
     - sem Gmail, os alertas vão para o e-mail da sua conta;
     - Configurações mostra qual está ligado.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { criarEmail } from "../../lib/email.js";
import { resumirSenha } from "../../lib/sessao.js";
import { criarSimulado, emailDeTeste } from "../simulado.js";

/** Um Resend de mentira: guarda o que chegou; `falhar` responde erro. */
function resendDeTeste() {
  const r = { enviados: [], falhar: false };
  r.fetchFn = async (url, init) => {
    if (String(url) !== "https://api.resend.com/emails") return null;
    if (r.falhar) return new Response(JSON.stringify({ statusCode: 403, message: "The forminha.test domain is not verified." }), { status: 403 });
    r.enviados.push({ cabecalhos: init.headers, corpo: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: `m${r.enviados.length}` }), { status: 200 });
  };
  return r;
}
const MENSAGEM = { para: "ana@doceria.com", assunto: "Sua loja está pronta", texto: "Olá!", html: "<p>Olá!</p>" };

describe("carteiro", () => {
  it("sem nada configurado, não há e-mail", () => {
    assert.equal(criarEmail({}), null);
    assert.equal(criarEmail({ resend: "re_abc12345678" }), null, "chave sem remetente não serve");
  });

  it("pelo Resend: remetente do domínio, nome e respostas para você", async () => {
    const resend = resendDeTeste();
    const email = criarEmail({ resend: "re_abc12345678", remetente: "contato@forminha.test", nome: "Forminha <Doces>", responderPara: "voce@exemplo.test", fetchFn: resend.fetchFn });
    assert.equal(email.provedor, "resend");
    assert.equal(email.reserva, null);
    await email.enviar(MENSAGEM);
    const [m] = resend.enviados;
    assert.equal(m.cabecalhos.authorization, "Bearer re_abc12345678");
    assert.deepEqual(m.corpo, {
      from: "Forminha Doces <contato@forminha.test>", to: ["ana@doceria.com"], subject: "Sua loja está pronta",
      text: "Olá!", html: "<p>Olá!</p>", reply_to: "voce@exemplo.test",
    });
  });

  it("Resend recusou e não há Gmail: o erro diz o motivo", async () => {
    const resend = resendDeTeste();
    resend.falhar = true;
    const email = criarEmail({ resend: "re_abc12345678", remetente: "contato@forminha.test", fetchFn: resend.fetchFn });
    await assert.rejects(email.enviar(MENSAGEM), /Resend recusou o e-mail \(403\): The forminha\.test domain is not verified/);
  });

  it("com os dois, o Gmail é a reserva", async () => {
    const resend = resendDeTeste();
    const correio = emailDeTeste();
    const email = criarEmail({ resend: "re_abc12345678", remetente: "contato@forminha.test", fetchFn: resend.fetchFn, usuario: "forminha@teste.local", transporte: correio.transporte });
    assert.equal(email.provedor, "resend");
    assert.equal(email.reserva, "gmail");
    await email.enviar(MENSAGEM);
    assert.equal(resend.enviados.length, 1);
    assert.equal(correio.enviados.length, 0, "com o Resend no ar, o Gmail não é usado");
    resend.falhar = true;
    const erro = console.error;
    console.error = () => {}; // o aviso de "tentando o próximo" não suja a saída do teste
    try { await email.enviar(MENSAGEM); } finally { console.error = erro; }
    assert.equal(correio.enviados.length, 1);
    assert.equal(correio.enviados[0].to, "ana@doceria.com");
  });
});

describe("Central só com o Resend", () => {
  let sim, servidor, base, cookie, resend;
  const SENHA = "senha-da-central-2026";
  const api = async (metodo, caminho, { cabecalhos = {}, comCookie = true } = {}) => {
    const r = await fetch(`${base}/api/${caminho}`, { method: metodo, headers: { ...(comCookie && cookie && { cookie }), ...cabecalhos } });
    return { status: r.status, dados: await r.json() };
  };
  const daqui = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

  before(async () => {
    sim = criarSimulado();
    resend = resendDeTeste();
    const fetchFn = async (url, init) => (await resend.fetchFn(url, init)) ?? sim.fetchFn(url, init);
    const env = {
      ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha(SENHA), SEGREDO_SESSAO: "s".repeat(48), CRON_SECRET: "cron",
      RESEND_API_KEY: "re_abc12345678", EMAIL_REMETENTE: "contato@forminha.test", EMAIL_NOME: "Forminha", SUPABASE_CHAVE_VENCE: daqui(3),
    };
    const central = criarCentral(env, { fetchFn });
    servidor = createServer((req, res) => central.tratar(req, res));
    await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${servidor.address().port}`;
    const r = await fetch(`${base}/api/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usuario: "dono@teste.local", senha: SENHA }) });
    cookie = r.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { servidor?.close(); await sim?.fechar(); });

  it("Configurações sabe que o e-mail é o profissional", async () => {
    const { recursos } = (await api("GET", "eu")).dados;
    assert.equal(recursos.email, true);
    assert.equal(recursos.email_provedor, "resend");
    assert.equal(recursos.email_reserva, null);
  });

  it("sem Gmail, o aviso da chave vai para o e-mail da sua conta", async () => {
    const r = await api("GET", "manter-ativo", { cabecalhos: { authorization: "Bearer cron" }, comCookie: false });
    assert.equal(r.status, 200);
    assert.equal(r.dados.aviso_de_chave, true);
    const m = resend.enviados.at(-1).corpo;
    assert.deepEqual(m.to, ["dono@teste.local"]);
    assert.equal(m.from, "Forminha <contato@forminha.test>");
    assert.match(m.subject, /chave do Supabase vence em 3 dias/);
  });
});
