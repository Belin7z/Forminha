/* ==========================================================
   SEGURANÇA DA CENTRAL
     - senha errada 5 vezes bloqueia, e o bloqueio fica no banco:
       vale para todas as cópias da Central (e por conta, mesmo
       vindo de outro endereço);
     - esqueci a senha: link por e-mail, 30 min, uma vez só;
     - verificação em duas etapas: QR Code, primeiro código, códigos
       de reserva de uso único, o mesmo código não vale duas vezes, o
       "desafio" não serve como sessão; o dono desliga a de alguém da
       equipe (celular perdido);
     - alertas de erro para o dono (juntados) e e-mail;
     - cópias de segurança da Central e de uma loja, e o lembrete.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { criarEmail } from "../../lib/email.js";
import { codigo as codigoTotp } from "../../lib/totp.js";
import { minutosDeBloqueio } from "../../lib/protecao.js";
import { bancoDeTeste, criarSimulado, emailDeTeste } from "../simulado.js";

const SENHA = "senha-do-dono";
let sim, banco, correio, a, b, quebrado = false;
let dono;

async function subir(extra = {}) {
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: hashSenha, SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: chave, URL_CENTRAL: "https://forminha.vercel.app", SMTP_USUARIO: "forminha@teste.local", ...extra,
  };
  // um Supabase que pode "cair" (para o alerta de erro)
  const fetchFn = (url, init) => (quebrado && String(url).includes("/organizations/")
    ? Promise.resolve(new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } }))
    : sim.fetchFn(url, init));
  const central = criarCentral(env, { fetchFn, banco, esperaBancoMs: 1, email: criarEmail({ usuario: "forminha@teste.local", transporte: correio.transporte }), mercadoPago: null, agendar: () => {} });
  const servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  async function api(metodo, caminho, corpo, { cookie = dono, ip = "10.0.0.1" } = {}) {
    const r = await fetch(`${base}/api/${caminho}`, {
      method: metodo,
      headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), "x-forwarded-for": ip },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, dados: texto ? JSON.parse(texto) : null, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  }
  return { servidor, api };
}
let chave, hashSenha; // as cópias da Central na Vercel compartilham a mesma configuração

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  correio = emailDeTeste();
  chave = novaChave();
  hashSenha = await resumirSenha(SENHA);
  a = await subir();
  b = await subir(); // outra cópia da Central, o mesmo banco
  dono = (await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: SENHA }, { cookie: null })).cookie;
});
after(async () => { a?.servidor.close(); b?.servidor.close(); await sim?.fechar(); await banco?.fechar(); });

describe("tentativas de senha", () => {
  it("o tempo de bloqueio cresce: 1, 2, 4, 8… até 15 min", () => {
    assert.deepEqual([4, 5, 10, 15, 20, 25, 30].map(minutosDeBloqueio), [0, 1, 2, 4, 8, 15, 15]);
  });

  it("5 erros bloqueiam — também na outra cópia da Central e para a conta vinda de outro endereço", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await a.api("POST", "entrar", { usuario: "alguem@teste.local", senha: "errada" }, { cookie: null, ip: "10.0.0.9" });
      assert.equal(r.status, 401);
    }
    const bloqueado = await b.api("POST", "entrar", { usuario: "outra@teste.local", senha: "errada" }, { cookie: null, ip: "10.0.0.9" });
    assert.equal(bloqueado.status, 429, "mesmo endereço, outra cópia");
    assert.match(bloqueado.dados.erro, /Muitas tentativas/);
    assert.equal((await b.api("POST", "entrar", { usuario: "alguem@teste.local", senha: "errada" }, { cookie: null, ip: "10.9.9.9" })).status, 429, "mesma conta, outro endereço");
    assert.equal((await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: SENHA }, { cookie: null, ip: "10.0.0.2" })).status, 200, "quem não errou entra normalmente");
  });
});

describe("esqueci a senha (dono)", () => {
  it("e-mail que não é o da conta: mesma resposta, nenhum e-mail", async () => {
    const antes = correio.enviados.length;
    const r = await a.api("POST", "senha/esqueci", { email: "estranho@teste.local" }, { cookie: null, ip: "10.1.0.1" });
    assert.equal(r.status, 200);
    assert.match(r.dados.mensagem, /Se esse for o e-mail da conta/);
    assert.equal(correio.enviados.length, antes);
  });

  it("o link chega por e-mail, cria a senha nova e não vale de novo", async () => {
    await a.api("POST", "senha/esqueci", { email: "Dono@Teste.local" }, { cookie: null, ip: "10.1.0.2" });
    const m = correio.enviados.at(-1);
    assert.equal(m.to, "dono@teste.local");
    const token = /#\/nova-senha\/([A-Za-z0-9_-]+)/.exec(m.text)[1];
    assert.equal((await b.api("POST", "senha/nova", { token, nova: "curta", repita: "curta" }, { cookie: null })).status, 422);
    const r = await b.api("POST", "senha/nova", { token, nova: "senha-nova-123", repita: "senha-nova-123" }, { cookie: null });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal((await a.api("GET", "eu")).dados.logado, false, "quem estava logado sai");
    assert.equal((await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: SENHA }, { cookie: null, ip: "10.1.0.3" })).status, 401);
    dono = (await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: "senha-nova-123" }, { cookie: null, ip: "10.1.0.3" })).cookie;
    assert.ok(dono);
    assert.equal((await b.api("POST", "senha/nova", { token, nova: "outra-senha-9", repita: "outra-senha-9" }, { cookie: null })).status, 410, "uma vez só");
  });
});

describe("verificação em duas etapas", () => {
  let segredo, reservas, desafio, ligadaEm;
  const agoraMais = (s) => Date.now() + s * 1000;

  it("ligar: QR Code, primeiro código e 8 códigos de reserva", async () => {
    let r = await a.api("POST", "seguranca/duas-etapas/iniciar", {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.match(r.dados.qr, /^data:image\/svg\+xml;base64,/);
    segredo = r.dados.segredo.replace(/\s/g, "");
    assert.match(segredo, /^[A-Z2-7]{32}$/);
    assert.equal((await a.api("POST", "seguranca/duas-etapas/ativar", { codigo: "000000" })).status, 422);
    ligadaEm = Date.now();
    r = await a.api("POST", "seguranca/duas-etapas/ativar", { codigo: codigoTotp(segredo, { agora: ligadaEm }) });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    reservas = r.dados.codigos;
    assert.equal(reservas.length, 8);
    assert.ok(reservas.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c)));
    assert.deepEqual((await a.api("GET", "seguranca")).dados.duas_etapas.ligada, true);
  });

  it("login pede o código; o desafio não serve como sessão", async () => {
    const r = await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: "senha-nova-123" }, { cookie: null, ip: "10.2.0.1" });
    assert.equal(r.status, 200);
    assert.equal(r.dados.etapa, "codigo");
    assert.equal(r.cookie, undefined, "sem sessão antes do código");
    desafio = r.dados.desafio;
    assert.equal((await a.api("GET", "eu", undefined, { cookie: `forminha_sessao=${desafio}` })).dados.logado, false);
  });

  it("código errado não entra; o mesmo código não vale duas vezes", async () => {
    assert.equal((await a.api("POST", "entrar/codigo", { desafio, codigo: "123456" }, { cookie: null, ip: "10.2.0.1" })).status, 401);
    assert.equal((await a.api("POST", "entrar/codigo", { desafio, codigo: codigoTotp(segredo, { agora: ligadaEm }) }, { cookie: null, ip: "10.2.0.1" })).status, 401,
      "o código usado para ligar não serve de novo");
    const certo = codigoTotp(segredo, { agora: Math.max(agoraMais(0), ligadaEm + 30_000) });
    const r = await b.api("POST", "entrar/codigo", { desafio, codigo: certo }, { cookie: null, ip: "10.2.0.1" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.ok(r.cookie);
    dono = r.cookie;
    assert.equal((await b.api("POST", "entrar/codigo", { desafio, codigo: certo }, { cookie: null, ip: "10.2.0.1" })).status, 401, "o mesmo de novo: não");
  });

  it("código de reserva vale uma vez", async () => {
    const d = (await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: "senha-nova-123" }, { cookie: null, ip: "10.2.0.5" })).dados.desafio;
    let r = await a.api("POST", "entrar/codigo", { desafio: d, codigo: reservas[0].toUpperCase() }, { cookie: null, ip: "10.2.0.5" });
    assert.equal(r.status, 200);
    assert.equal(r.dados.reservas_restantes, 7);
    r = await a.api("POST", "entrar/codigo", { desafio: d, codigo: reservas[0] }, { cookie: null, ip: "10.2.0.5" });
    assert.equal(r.status, 401);
  });

  it("desligar pede a senha e um código", async () => {
    assert.equal((await a.api("POST", "seguranca/duas-etapas/desligar", { senha: "errada", codigo: reservas[1] })).status, 422);
    const r = await a.api("POST", "seguranca/duas-etapas/desligar", { senha: "senha-nova-123", codigo: reservas[1] });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal((await a.api("POST", "entrar", { usuario: "dono@teste.local", senha: "senha-nova-123" }, { cookie: null, ip: "10.2.0.6" })).dados.ok, true);
  });

  it("o dono desliga a de alguém da equipe (celular perdido) e vê quem usa", async () => {
    const { dados } = await a.api("POST", "equipe", { nome: "Sara Suporte", funcao: "suporte" });
    const temp = await a.api("POST", "entrar", { usuario: dados.funcionario.usuario, senha: dados.senha_temporaria }, { cookie: null, ip: "10.3.0.1" });
    const sara = (await a.api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: "senha-da-sara", repita: "senha-da-sara" }, { cookie: temp.cookie })).cookie;
    const s = (await a.api("POST", "seguranca/duas-etapas/iniciar", {}, { cookie: sara })).dados.segredo.replace(/\s/g, "");
    assert.equal((await a.api("POST", "seguranca/duas-etapas/ativar", { codigo: codigoTotp(s) }, { cookie: sara })).status, 200);
    let lista = (await a.api("GET", "equipe")).dados.funcionarios;
    assert.equal(lista.find((f) => f.id === dados.funcionario.id).duas_etapas, true);
    assert.equal((await a.api("POST", `equipe/${dados.funcionario.id}/duas-etapas/desligar`, {}, { cookie: sara })).status, 403);
    assert.equal((await a.api("POST", `equipe/${dados.funcionario.id}/duas-etapas/desligar`, {})).status, 200);
    lista = (await a.api("GET", "equipe")).dados.funcionarios;
    assert.equal(lista.find((f) => f.id === dados.funcionario.id).duas_etapas, false);
  });
});

describe("alertas e cópias", () => {
  it("erro de um serviço vira aviso para o dono e e-mail — juntados", async () => {
    const antes = correio.enviados.length;
    quebrado = true;
    assert.equal((await a.api("GET", "lojas")).status, 502);
    assert.equal((await a.api("GET", "lojas")).status, 502);
    quebrado = false;
    const avisos = (await a.api("GET", "avisos")).dados.avisos.filter((x) => x.tipo === "erro");
    assert.equal(avisos.length, 1, "o mesmo erro não repete");
    assert.equal(avisos[0].titulo, "Supabase com problema");
    assert.equal(correio.enviados.length, antes + 1);
    assert.match(correio.enviados.at(-1).subject, /Supabase com problema/);
  });

  it("cópia da Central: só o dono, com os dados ainda criptografados", async () => {
    const r = await a.api("GET", "backup");
    assert.equal(r.status, 200);
    assert.equal(r.dados.forminha, "central");
    assert.ok(Array.isArray(r.dados.tabelas.funcionarios) && r.dados.tabelas.funcionarios.length >= 1);
    assert.doesNotMatch(JSON.stringify(r.dados.tabelas.funcionarios), /Sara Suporte/, "nomes continuam criptografados");
    assert.ok((await a.api("GET", "backup/situacao")).dados.ultimo_em);
  });

  it("cópia de uma loja: todas as tabelas do banco dela", async () => {
    const loja = (await a.api("POST", "lojas", { nome: "Doce da Bia", email: "bia@doceria.com" })).dados;
    let r; do { r = await a.api("POST", `lojas/${loja.ref}/preparar`, { email: "bia@doceria.com" }); } while (r.dados.etapa === "tabelas");
    const copia = await a.api("GET", `lojas/${loja.ref}/backup`);
    assert.equal(copia.status, 200, JSON.stringify(copia.dados).slice(0, 200));
    assert.equal(copia.dados.loja.nome, "Doce da Bia");
    for (const t of ["pedidos", "produtos", "configuracoes"]) assert.ok(Array.isArray(copia.dados.tabelas[t]), t);
    assert.ok(copia.dados.tabelas.configuracoes.length > 0, "a loja nasce com as configurações (e sem produtos)");
  });
});
