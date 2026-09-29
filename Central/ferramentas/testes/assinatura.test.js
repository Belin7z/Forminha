/* ==========================================================
   MENSALIDADE (assinatura) — o ciclo inteiro, pelo agendador diário:
   primeira data, cobrança antes do vencimento (com o crédito de
   indicação abatido), lembrete de atraso (uma vez), suspensão depois
   da carência (a loja para de receber pedidos pelo site), pagamento
   (volta na hora e o vencimento avança 1 mês), crédito que cobre
   tudo, isenção e as ações da ficha. A loja fica sabendo pela ficha.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { criarEmail } from "../../lib/email.js";
import { diasEntre, hojeSP, somarDias, somarMes } from "../../lib/clientes.js";
import { bancoDeTeste, criarSimulado, emailDeTeste } from "../simulado.js";

const SENHA = "senha-do-dono";
let sim, banco, correio, servidor, base, dono, vendedora, id, ref;

async function api(metodo, caminho, corpo, cookie = dono, extra = {}) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...extra },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const entrar = (usuario, senha) => api("POST", "entrar", { usuario, senha }, null);
const cron = async () => (await api("GET", "manter-ativo", undefined, null, { authorization: "Bearer cron" })).dados.mensalidades;
const q = (t, p) => banco.consultar(t, p);
const cliente = async () => (await q("select *, to_char(proximo_vencimento, 'YYYY-MM-DD') as venc from clientes where id = $1", [id]))[0];
const pendente = async () => (await q("select *, to_char(vencimento, 'YYYY-MM-DD') as venc from pagamentos where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'pendente'", [id]))[0];
async function fichaDaLoja() {
  const { rows } = await sim.estado.projetos.get(ref).db.query("select valor from public.configuracoes where chave = 'forminha'");
  return rows[0].valor.assinatura;
}
const lojaPausada = async () => (await sim.estado.projetos.get(ref).db.query("select public._base_loja_config('{}'::jsonb) as c")).rows[0].c.pedidos.pausados;

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  correio = emailDeTeste();
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha(SENHA), SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, esperaBancoMs: 1, email: criarEmail({ usuario: "forminha@teste.local", transporte: correio.transporte }), mercadoPago: null, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  dono = (await entrar("dono@teste.local", SENHA)).cookie;
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
  const { dados } = await api("POST", "equipe", { nome: "Vera Vendas", funcao: "vendedor" });
  const temp = await entrar(dados.funcionario.usuario, dados.senha_temporaria);
  vendedora = (await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: "minha-senha-123", repita: "minha-senha-123" }, temp.cookie)).cookie;
  // uma loja no ar
  id = (await api("POST", "clientes", { nome: "Ana Souza", email: "ana@doceria.com", nome_loja: "Doce da Ana", valor_centavos: 19900 })).dados.cliente.id;
  await api("POST", `clientes/${id}/pagamento-recebido`, {});
  for (let i = 0; i < 60; i++) { if ((await api("POST", `clientes/${id}/avancar`, {})).dados.cliente.etapa === "pronta") break; }
  ref = (await cliente()).loja_ref;
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("datas", () => {
  it("+1 mês no mesmo dia (e o último dia quando o mês é mais curto)", () => {
    assert.equal(somarMes("2026-01-31"), "2026-02-28");
    assert.equal(somarMes("2028-01-31"), "2028-02-29");
    assert.equal(somarMes("2026-12-15"), "2027-01-15");
    assert.equal(somarDias("2026-09-29", 3), "2026-10-02");
    assert.equal(diasEntre("2026-09-29", "2026-10-02"), 3);
  });
});

describe("configuração", () => {
  it("todos veem o valor; só o dono muda", async () => {
    assert.equal((await api("GET", "assinatura", undefined, vendedora)).dados.valor_centavos, 0);
    assert.equal((await api("PUT", "assinatura", { valor_centavos: 9900 }, vendedora)).status, 403);
    assert.ok((await api("PUT", "assinatura", { valor_centavos: -1 })).dados.campos.valor);
    const r = await api("PUT", "assinatura", { valor_centavos: 9900, primeira_em_dias: 30, aviso_antes_dias: 5, carencia_dias: 7 });
    assert.deepEqual(r.dados, { valor_centavos: 9900, primeira_em_dias: 30, aviso_antes_dias: 5, carencia_dias: 7 });
  });
});

describe("o ciclo da mensalidade", () => {
  it("1º dia: marca o primeiro vencimento (30 dias depois da loja pronta) e avisa a loja: em dia", async () => {
    const r = await cron();
    assert.equal(r.geradas, 0);
    const c = await cliente();
    assert.equal(c.venc, somarDias(hojeSP(), 30));
    assert.equal((await fichaDaLoja()).situacao, "em_dia");
  });

  it("5 dias antes: gera a cobrança com o crédito de indicação abatido e manda o e-mail", async () => {
    await q("update clientes set proximo_vencimento = $2::date, credito_centavos = 3000 where id = $1", [id, somarDias(hojeSP(), 3)]);
    const r = await cron();
    assert.equal(r.geradas, 1);
    const p = await pendente();
    assert.equal(p.valor_centavos, 6900);
    assert.equal(p.credito_usado_centavos, 3000);
    assert.equal(p.venc, somarDias(hojeSP(), 3));
    assert.match(correio.enviados.at(-1).subject, /Mensalidade da Doce da Ana: vence em/);
    const f = await fichaDaLoja();
    assert.equal(f.situacao, "aberta");
    assert.match(f.link, /#\/pagar\//);
    assert.equal((await cron()).geradas, 0, "no dia seguinte não gera outra");
  });

  it("vencida: um lembrete só; a loja continua recebendo pedidos", async () => {
    await q("update pagamentos set vencimento = $2::date where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'pendente'", [id, somarDias(hojeSP(), -2)]);
    assert.equal((await cron()).lembretes, 1);
    assert.match(correio.enviados.at(-1).subject, /em atraso/);
    assert.equal((await cron()).lembretes, 0);
    assert.equal((await fichaDaLoja()).situacao, "atrasada");
    assert.equal(await lojaPausada(), false);
  });

  it("passou a carência: a loja para de receber pedidos pelo site", async () => {
    await q("update pagamentos set vencimento = $2::date where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'pendente'", [id, somarDias(hojeSP(), -8)]);
    assert.equal((await cron()).suspensas, 1);
    assert.ok((await cliente()).suspensa_em);
    const f = await fichaDaLoja();
    assert.equal(f.suspensa, true);
    assert.equal(f.situacao, "suspensa");
    assert.equal(await lojaPausada(), true);
    assert.match(correio.enviados.at(-1).subject, /parou de receber pedidos/);
    assert.ok((await api("GET", "avisos")).dados.avisos.some((a) => a.titulo === "Loja suspensa: Doce da Ana"));
    assert.equal((await api("GET", "lojas")).dados.lojas.find((l) => l.ref === ref).suspensa, true);
    const resumo = (await api("GET", "resumo")).dados;
    assert.ok(resumo.atencao.some((a) => /Loja suspensa/.test(a.texto)));
  });

  it("pagou: volta na hora, o crédito sai e o vencimento avança 1 mês", async () => {
    const p = await pendente();
    const r = await api("POST", `clientes/${id}/pagamento-recebido`, { pagamento_id: p.id });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const c = await cliente();
    assert.equal(c.suspensa_em, null);
    assert.equal(c.credito_centavos, 0);
    assert.equal(c.venc, somarMes(p.venc));
    assert.equal(c.etapa, "pronta", "pagar mensalidade não mexe na loja");
    const f = await fichaDaLoja();
    assert.deepEqual([f.situacao, f.suspensa, f.link], ["em_dia", false, null]);
    assert.equal(await lojaPausada(), false);
    assert.ok(r.dados.historico.some((h) => /Mensalidade de R\$\s?69,00 .* paga/.test(h.texto)));
  });

  it("a página de pagamento da mensalidade diz que é a mensalidade", async () => {
    const [p] = await q("select id from pagamentos where cliente_id = $1 and tipo = 'mensalidade' and situacao = 'aprovado'", [id]);
    const ficha = (await api("GET", `clientes/${id}`)).dados;
    const pag = ficha.pagamentos.find((x) => x.id === p.id);
    assert.equal(pag.tipo, "mensalidade");
    const token = pag.link.split("/").pop();
    const pagina = (await api("GET", `publico/pagamento/${token}`, undefined, null)).dados;
    assert.deepEqual([pagina.tipo, pagina.situacao], ["mensalidade", "pago"]);
  });

  it("crédito que cobre a mensalidade inteira: conta como paga, sem cobrança", async () => {
    await q("update clientes set proximo_vencimento = $2::date, credito_centavos = 20000 where id = $1", [id, somarDias(hojeSP(), 2)]);
    const r = await cron();
    assert.equal(r.pagas_com_credito, 1);
    const c = await cliente();
    assert.equal(c.credito_centavos, 10100);
    assert.equal(c.venc, somarMes(somarDias(hojeSP(), 2)));
    assert.equal(await pendente(), undefined);
  });
});

describe("ações da ficha", () => {
  it("valor próprio e cobrar agora", async () => {
    let r = await api("PUT", `clientes/${id}/assinatura`, { mensalidade_centavos: 4900 });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.assinatura.valor_centavos, 4900);
    await q("update clientes set credito_centavos = 0 where id = $1", [id]);
    r = await api("POST", `clientes/${id}/assinatura/cobrar`, {});
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.assinatura.situacao, "aberta");
    assert.equal((await pendente()).valor_centavos, 4900);
  });

  it("suspender e reativar à mão (suporte)", async () => {
    assert.equal((await api("POST", `clientes/${id}/assinatura/suspender`, {}, vendedora)).status, 403);
    let r = await api("POST", `clientes/${id}/assinatura/suspender`, {});
    assert.equal(r.dados.assinatura.situacao, "suspensa");
    assert.equal(await lojaPausada(), true);
    r = await api("POST", `clientes/${id}/assinatura/reativar`, {});
    assert.equal(r.dados.assinatura.suspensa, false);
    assert.equal(await lojaPausada(), false);
  });

  it("isenta: cancela a cobrança aberta, não cobra mais e a loja fica sabendo", async () => {
    const r = await api("PUT", `clientes/${id}/assinatura`, { isenta: true });
    assert.equal(r.dados.assinatura.situacao, "isenta");
    assert.equal(await pendente(), undefined);
    await q("update clientes set proximo_vencimento = $2::date where id = $1", [id, somarDias(hojeSP(), 1)]);
    assert.equal((await cron()).geradas, 0);
    assert.equal((await fichaDaLoja()).situacao, "isenta");
  });

  it("a visão geral mostra quanto entra por mês", async () => {
    await api("PUT", `clientes/${id}/assinatura`, { isenta: false });
    const r = (await api("GET", "resumo")).dados;
    assert.equal(r.recorrente.mensal_centavos, 4900);
    assert.equal(r.recorrente.pagantes, 1);
  });
});
