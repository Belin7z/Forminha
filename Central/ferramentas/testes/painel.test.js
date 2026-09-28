/* ==========================================================
   VISÃO GERAL E PAGAMENTOS — os números do negócio:
     - clientes, novas no mês, aguardando, lojas prontas;
     - faturamento do mês e dos 6 últimos meses (só para quem vê dinheiro);
     - lista de pagamentos com totais e filtro;
     - o que precisa de atenção (cobrança parada há dias).
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

let sim, banco, servidor, base, dono;

async function api(metodo, caminho, corpo, cookie = dono) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const entrar = (usuario, senha) => api("POST", "entrar", { usuario, senha }, null);
async function contratar(nome, funcao) {
  const { dados } = await api("POST", "equipe", { nome, funcao });
  const temp = await entrar(dados.funcionario.usuario, dados.senha_temporaria);
  return (await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: "senha-nova-123", repita: "senha-nova-123" }, temp.cookie)).cookie;
}
const cadastrar = async (nome, loja, valor) => (await api("POST", "clientes", { nome, email: `${loja.toLowerCase().replace(/\W/g, "")}@teste.local`, nome_loja: loja, valor_centavos: valor })).dados.cliente.id;

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha("senha-do-dono"), SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, esperaBancoMs: 1, email: null, mercadoPago: null, agendar: () => {}, orcamentoMs: 1 });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  dono = (await entrar("dono@teste.local", "senha-do-dono")).cookie;
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("visão geral", () => {
  let paga, esperando;

  before(async () => {
    paga = await cadastrar("Maria Doces", "Doce da Maria", 19900);
    esperando = await cadastrar("Bia Bolos", "Bolos da Bia", 25000);
    await api("POST", `clientes/${paga}/pagamento-recebido`, {});
    // a cobrança da Bia foi criada há 3 dias
    await banco.consultar("update pagamentos set criado_em = now() - interval '3 days' where cliente_id = $1", [esperando]);
  });

  it("números do negócio, faturamento do mês e os 6 últimos meses", async () => {
    const r = await api("GET", "resumo");
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const { numeros, financeiro } = r.dados;
    assert.equal(numeros.clientes, 2);
    assert.equal(numeros.novas_no_mes, 2);
    assert.equal(numeros.aguardando, 1);
    assert.equal(financeiro.mes, 19900);
    assert.equal(financeiro.total, 19900);
    assert.equal(financeiro.pendente, 25000);
    assert.equal(financeiro.vendas, 1);
    assert.equal(financeiro.meses.length, 6);
    assert.equal(financeiro.meses.at(-1).total, 19900, "o mês atual é o último da série");
    assert.ok(financeiro.meses.slice(0, 5).every((m) => m.total === 0));
    assert.deepEqual(r.dados.recentes.map((c) => c.nome_loja), ["Bolos da Bia", "Doce da Maria"]);
    assert.equal(r.dados.recentes[0].nome, "Bia Bolos");
    assert.ok(r.dados.atividades.length > 0, "o dono vê a atividade recente");
  });

  it("aponta o que precisa de atenção", async () => {
    const { atencao } = (await api("GET", "resumo")).dados;
    assert.ok(atencao.some((a) => a.tipo === "pagamento" && a.cliente_id === esperando && a.nome_loja === "Bolos da Bia"));
  });

  it("quem não vê dinheiro recebe os números sem faturamento; pagamentos ficam fechados", async () => {
    const vendedor = await contratar("Vera Lima", "vendedor");
    const r = await api("GET", "resumo", undefined, vendedor);
    assert.equal(r.status, 200);
    assert.equal(r.dados.numeros.clientes, 2);
    assert.equal(r.dados.financeiro, undefined);
    assert.equal(r.dados.atividades, undefined);
    assert.equal((await api("GET", "pagamentos", undefined, vendedor)).status, 403);
  });
});

describe("pagamentos", () => {
  it("lista com totais, quem confirmou e filtro por situação", async () => {
    const financeiro = await contratar("Fábio Reis", "financeiro");
    const r = await api("GET", "pagamentos", undefined, financeiro);
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados.totais, { recebido: 19900, pendente: 25000 });
    const pago = r.dados.pagamentos.find((p) => p.situacao === "aprovado");
    assert.equal(pago.nome_loja, "Doce da Maria");
    assert.equal(pago.cliente, "Maria Doces");
    assert.equal(pago.confirmado_por, "Dono");
    const pendentes = (await api("GET", "pagamentos?situacao=pendente", undefined, financeiro)).dados.pagamentos;
    assert.ok(pendentes.length > 0 && pendentes.every((p) => p.situacao === "pendente"));
  });
});

describe("relatório de vendas", () => {
  const hojeEmBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const menosDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  let hoje, ontem;

  before(async () => {
    hoje = hojeEmBrasilia();
    ontem = menosDias(hoje, 1);
    // uma segunda venda, confirmada ontem
    const id = await cadastrar("Carla Bolos", "Cia do Bolo", 30000);
    await api("POST", `clientes/${id}/pagamento-recebido`, {});
    await banco.consultar("update pagamentos set confirmado_em = now() - interval '1 day' where cliente_id = $1 and situacao = 'aprovado'", [id]);
  });

  it("hoje: por hora, com o que foi vendido e a comparação com ontem", async () => {
    const r = await api("GET", `vendas?de=${hoje}&ate=${hoje}`);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.agrupamento, "hora");
    assert.equal(r.dados.serie.length, 24);
    assert.equal(r.dados.resumo.total, 19900);
    assert.equal(r.dados.resumo.vendas, 1);
    assert.deepEqual(r.dados.resumo.anterior, { de: ontem, ate: ontem, total: 30000, vendas: 1 });
    assert.equal(r.dados.itens[0].nome_loja, "Doce da Maria");
    assert.equal(r.dados.itens[0].cliente, "Maria Doces");
  });

  it("de um dia até outro: por dia, com total e ticket médio", async () => {
    const r = (await api("GET", `vendas?de=${ontem}&ate=${hoje}`)).dados;
    assert.equal(r.agrupamento, "dia");
    assert.deepEqual(r.serie.map((s) => [s.chave, s.total]), [[ontem, 30000], [hoje, 19900]]);
    assert.equal(r.resumo.total, 49900);
    assert.equal(r.resumo.ticket, 24950);
  });

  it("mês a mês e por ano (os meses e anos sem venda aparecem zerados)", async () => {
    const ano = Number(hoje.slice(0, 4));
    const porAno = (await api("GET", `vendas?de=${ano - 4}-01-01&ate=${hoje}&agrupar=ano`)).dados;
    assert.equal(porAno.agrupamento, "ano");
    assert.deepEqual(porAno.serie.map((s) => s.chave), [ano - 4, ano - 3, ano - 2, ano - 1, ano].map(String));
    assert.equal(porAno.serie.reduce((t, s) => t + s.total, 0), 49900);
    const porMes = (await api("GET", `vendas?de=${menosDias(hoje, 330)}&ate=${hoje}`)).dados;
    assert.equal(porMes.agrupamento, "mes");
    assert.ok(porMes.serie.length >= 11 && porMes.serie.length <= 12);
    assert.equal(porMes.serie.reduce((t, s) => t + s.total, 0), 49900);
  });

  it("recusa período errado e fica fechado para quem não vê dinheiro", async () => {
    assert.equal((await api("GET", `vendas?de=${hoje}&ate=${ontem}`)).status, 422);
    assert.equal((await api("GET", "vendas?de=2026-02-31&ate=2026-03-01")).status, 422);
    assert.equal((await api("GET", "vendas")).status, 422);
    const vendedor = await contratar("Vitor Nunes", "vendedor");
    assert.equal((await api("GET", `vendas?de=${hoje}&ate=${hoje}`, undefined, vendedor)).status, 403);
  });

  it("os baldes do gráfico cobrem o período inteiro", async () => {
    const { baldesDoPeriodo } = await import("../../lib/clientes.js");
    assert.deepEqual(baldesDoPeriodo("mes", "2025-11-15", "2026-02-01"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
    assert.deepEqual(baldesDoPeriodo("dia", "2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    assert.equal(baldesDoPeriodo("hora", "2026-09-28", "2026-09-28").length, 24);
  });
});

describe("nome no perfil", () => {
  it("o dono define o nome sem pedir senha; aparece completo no topo", async () => {
    assert.equal((await api("GET", "eu")).dados.quem.nome, "", "sem nome ainda: a tela pergunta");
    assert.equal((await api("PUT", "perfil", { nome: "A" })).status, 422);
    const r = await api("PUT", "perfil", { nome: "  Ana   Maria de Souza " });
    assert.equal(r.status, 200);
    assert.equal((await api("GET", "eu")).dados.quem.nome, "Ana Maria de Souza");
    const vendedor = await contratar("Rita Alves", "vendedor");
    assert.equal((await api("PUT", "perfil", { nome: "Outra" }, vendedor)).status, 403);
  });
});
