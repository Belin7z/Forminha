/* ==========================================================
   CHAVES COM PRAZO — a chave do Supabase (e a da Vercel) vence:
     - a Central conta os dias e mostra o aviso só para você;
     - o serviço diário manda e-mail 15 dias antes e todo dia na
       última semana;
     - chave recusada vira uma mensagem que diz o que fazer.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { criarEmail } from "../../lib/email.js";
import { resumirSenha } from "../../lib/sessao.js";
import { chavesVencendo, mensagemDeChaveRecusada, textoDoPrazo } from "../../lib/chaves.js";
import { criarSimulado, emailDeTeste } from "../simulado.js";

const SENHA = "senha-da-central-2026";
const HOJE = new Date("2026-09-28T15:00:00Z");
const daqui = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

describe("contar os dias", () => {
  it("avisa só o que vence em até 15 dias (ou já venceu) e ignora data inválida", () => {
    const env = { SUPABASE_CHAVE_VENCE: "2026-10-05", VERCEL_CHAVE_VENCE: "2027-01-01" };
    assert.deepEqual(chavesVencendo(env, { hoje: HOJE }), [{ nome: "Supabase", vence: "2026-10-05", dias: 7, opcao: "5" }]);
    assert.deepEqual(chavesVencendo({ SUPABASE_CHAVE_VENCE: "2026-09-20" }, { hoje: HOJE })[0].dias, -8);
    assert.deepEqual(chavesVencendo({ SUPABASE_CHAVE_VENCE: "amanhã" }, { hoje: HOJE }), []);
    assert.deepEqual(chavesVencendo({}, { hoje: HOJE }), [], "sem data guardada, sem aviso");
  });

  it("textos claros", () => {
    assert.equal(textoDoPrazo({ nome: "Supabase", dias: 3 }), "A chave do Supabase vence em 3 dias");
    assert.equal(textoDoPrazo({ nome: "Supabase", dias: 1 }), "A chave do Supabase vence em 1 dia");
    assert.equal(textoDoPrazo({ nome: "Vercel", dias: 0 }), "A chave da Vercel vence hoje");
    assert.equal(textoDoPrazo({ nome: "Supabase", dias: -2 }), "A chave do Supabase venceu");
    assert.match(mensagemDeChaveRecusada("Supabase", 401), /venceu ou foi apagada.*opção 5/);
    assert.match(mensagemDeChaveRecusada("Vercel", 403), /não tem permissão.*opção 6/);
    assert.match(mensagemDeChaveRecusada("Vercel", 403, "Vercel: Not authorized: Trying to access resource under scope"),
      /All Projects.*opção 6\. \(Vercel: Not authorized: Trying to access resource under scope\)/, "diz o escopo certo e o motivo que a Vercel deu");
  });
});

describe("Central com a chave perto de vencer", () => {
  let sim, servidor, base, cookie, correio, recusar = false;
  const api = async (metodo, caminho, { cabecalhos = {}, comCookie = true } = {}) => {
    const r = await fetch(`${base}/api/${caminho}`, { method: metodo, headers: { ...(comCookie && cookie && { cookie }), ...cabecalhos } });
    return { status: r.status, dados: await r.json() };
  };

  before(async () => {
    sim = criarSimulado();
    correio = emailDeTeste();
    // "recusar" faz o Supabase simulado responder como se a chave tivesse vencido
    const fetchFn = (url, init) => (recusar && String(url).startsWith("https://api.supabase.com")
      ? Promise.resolve(new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }))
      : sim.fetchFn(url, init));
    const env = {
      ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha(SENHA), SEGREDO_SESSAO: "segredo-de-teste-".padEnd(48, "x"), CRON_SECRET: "cron-de-teste",
      SMTP_USUARIO: "voce@gmail.com", SUPABASE_CHAVE_VENCE: daqui(3), VERCEL_CHAVE_VENCE: daqui(200),
    };
    const email = criarEmail({ usuario: env.SMTP_USUARIO, transporte: correio.transporte });
    const central = criarCentral(env, { fetchFn, email });
    servidor = createServer((req, res) => central.tratar(req, res));
    await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${servidor.address().port}`;
    const r = await fetch(`${base}/api/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: SENHA }) });
    cookie = r.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { servidor?.close(); await sim?.fechar(); });

  it("o painel mostra o aviso só para quem entrou", async () => {
    const eu = (await api("GET", "eu")).dados;
    assert.equal(eu.chaves.length, 1);
    assert.equal(eu.chaves[0].texto, "A chave do Supabase vence em 3 dias");
    assert.equal(eu.chaves[0].opcao, "5");
    assert.deepEqual((await api("GET", "eu", { comCookie: false })).dados.chaves, [], "visitante não vê nada");
  });

  it("o serviço diário manda o aviso para o seu Gmail", async () => {
    const r = await api("GET", "manter-ativo", { cabecalhos: { authorization: "Bearer cron-de-teste" } });
    assert.equal(r.status, 200);
    assert.equal(r.dados.aviso_de_chave, true);
    const m = correio.enviados.at(-1);
    assert.equal(m.to, "voce@gmail.com");
    assert.match(m.subject, /chave do Supabase vence em 3 dias/);
    assert.match(m.text, /npm run configurar/);
  });

  it("chave recusada: você recebe a instrução; o visitante não", async () => {
    recusar = true;
    try {
      const logado = await api("GET", "lojas");
      assert.equal(logado.status, 502);
      assert.match(logado.dados.erro, /chave do Supabase foi recusada.*npm run configurar.*opção 5/);

      const antes = correio.enviados.length;
      const cron = await api("GET", "manter-ativo", { cabecalhos: { authorization: "Bearer cron-de-teste" }, comCookie: false });
      assert.equal(cron.status, 502);
      assert.doesNotMatch(cron.dados.erro, /npm run configurar/, "a rota do agendador não é você logado");
      assert.equal(correio.enviados.length, antes + 1, "mas o aviso chega por e-mail");
      assert.match(correio.enviados.at(-1).text, /recusada/);
    } finally { recusar = false; }
  });
});
