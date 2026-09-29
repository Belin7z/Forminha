/* ==========================================================
   RELATÓRIO DE VENDAS (painel da dona): contas certas no período,
   cancelados à parte, comparação com o período anterior, pela data
   do pedido ou da entrega, gráfico com todos os pedaços (hora, dia,
   mês), produtos, categorias, pagamentos, recebido, cupons, lucro
   estimado pela receita, lista da planilha e as travas.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";
import { PERIODOS, periodo, rotulosDe, variacao } from "../../src/scripts/base/periodo.js";

let emu, painel, atendente, visitante, bolo, quando, pedidos = [];
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // dia de hoje em São Paulo
const diasAtras = (n) => new Date(Date.now() - 3 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);
const relatorio = (q = "") => painel.get(`/relatorios/vendas${q ? `?${q}` : ""}`);

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}

async function pedidoDe(nome, email, { qtd, pagamento = "dinheiro", tipo = "retirada" }) {
  const c = criarApiLoja(novoCliente());
  await c.post("/auth/cadastro", { nome, email, telefone: "11999990000", senha: "Senha1234" });
  const { pedido } = await c.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd, opcoes: { g1: ["g1i1"] } }], tipo, ...quando, pagamento });
  return pedido;
}

before(async () => {
  emu = await iniciarEmulador();
  const dados = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: dados.email, senha: dados.senha });
  visitante = criarApiLoja(novoCliente());
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  quando = proximaData(await visitante.get("/config"));
  // uma receita para o lucro: 400 g de farinha (R$ 5,00 o kg) + 4 ovos (R$ 12,00 a dúzia) = R$ 6,00 por bolo
  const farinha = (await painel.post("/ingredientes", { nome: "Farinha", unidade: "g", estoque: 99999, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 })).ingrediente;
  const ovos = (await painel.post("/ingredientes", { nome: "Ovos", unidade: "un", estoque: 999, embalagem_qtd: 12, embalagem_nome: "cartela", embalagem_preco: 1200 })).ingrediente;
  await painel.put(`/receitas/${bolo.id}`, { linhas: [{ ingrediente_id: farinha.id, quantidade: 400 }, { ingrediente_id: ovos.id, quantidade: 4 }] });

  const min = bolo.min_qtd ?? 1;
  pedidos.push(await pedidoDe("Ana Lima", "ana.rel@teste.com", { qtd: min, pagamento: "cartao_entrega" }));
  pedidos.push(await pedidoDe("Bia Souza", "bia.rel@teste.com", { qtd: min + 1, pagamento: "dinheiro" }));
  pedidos.push(await pedidoDe("Caio Reis", "caio.rel@teste.com", { qtd: min, pagamento: "cartao_entrega" }));
  pedidos.push(await pedidoDe("Duda Alves", "duda.rel@teste.com", { qtd: min })); // vai para o período anterior
  pedidos.push(await pedidoDe("Enzo Dias", "enzo.rel@teste.com", { qtd: min, pagamento: "dinheiro" })); // vai ser cancelado

  const [, , caio, duda, enzo] = pedidos;
  // Caio usou cupom (desconto de R$ 5,00 no pedido)
  await sql(emu.db, "update public.pedidos set cupom = 'doce5', desconto = 500, total = total - 500 where id = $1", [caio.id]);
  // Duda comprou há 40 dias (fora do mês atual e dos últimos 30 dias)
  await sql(emu.db, "update public.pedidos set criado_em = now() - interval '40 days' where id = $1", [duda.id]);
  await painel.patch(`/pedidos/${enzo.id}/status`, { status: "cancelado", nota: "Cliente desistiu" });
  // Ana pagou metade no PIX
  const ana = (await sql(emu.db, "select total from public.pedidos where id = $1", [pedidos[0].id])).rows[0];
  await painel.post(`/pedidos/${pedidos[0].id}/pagamentos`, { valor: Math.floor(ana.total / 2), forma: "pix" });

  const conta = criarApiLoja(novoCliente());
  await conta.post("/auth/cadastro", { nome: "Téo Atendente", email: "teo.rel@teste.com", telefone: "11955554444", senha: "Senha1234" });
  await painel.post("/equipe", { email: "teo.rel@teste.com", papel: "atendente" });
  atendente = criarApiPainel(novoCliente());
  await atendente.post("/auth/entrar", { email: "teo.rel@teste.com", senha: "Senha1234" });
});
after(async () => { await emu?.fechar(); });

const totalDe = async (ids) => (await sql(emu.db, "select coalesce(sum(total), 0)::int as t from public.pedidos where id = any($1)", [ids])).rows[0].t;

describe("travas", () => {
  it("só o administrador vê o relatório", async () => {
    assert.equal((await falha(atendente.get("/relatorios/vendas"))).status, 403);
    const semLogin = criarApiPainel(novoCliente());
    assert.ok([401, 403].includes((await falha(semLogin.get("/relatorios/vendas"))).status));
  });

  it("recusa período invertido, longo demais e base desconhecida", async () => {
    assert.equal((await falha(relatorio(`de=${hoje()}&ate=${diasAtras(3)}`))).status, 422);
    assert.equal((await falha(relatorio("de=2000-01-01&ate=2020-01-01"))).status, 422);
    assert.equal((await falha(relatorio("base=qualquer"))).status, 422);
  });
});

describe("contas do período (últimos 30 dias, pela data do pedido)", () => {
  let r;
  before(async () => { r = await relatorio(`de=${diasAtras(29)}&ate=${hoje()}`); });

  it("faturamento, pedidos e ticket só com os que valem (cancelado fica à parte)", async () => {
    const [ana, bia, caio, , enzo] = pedidos;
    const esperado = await totalDe([ana.id, bia.id, caio.id]);
    assert.equal(r.totais.faturamento, esperado);
    assert.equal(r.totais.pedidos, 3);
    assert.equal(r.totais.ticket, Math.round(esperado / 3));
    assert.equal(r.totais.cancelados, 1);
    assert.equal(r.totais.cancelados_total, await totalDe([enzo.id]));
    assert.equal(r.totais.descontos, 500);
    assert.equal(r.totais.clientes, 3);
    assert.equal(r.totais.clientes_novos, 3);
    assert.equal(r.totais.itens, (bolo.min_qtd ?? 1) * 3 + 1);
  });

  it("recebido = o que foi registrado; o resto fica a receber", async () => {
    const ana = (await sql(emu.db, "select total, pago from public.pedidos where id = $1", [pedidos[0].id])).rows[0];
    assert.equal(r.totais.recebido, ana.pago);
    assert.deepEqual(r.recebimentos.map((x) => [x.forma, x.texto, x.valor]), [["pix", "PIX", ana.pago]]);
  });

  it("compara com os 30 dias antes (onde está a compra da Duda)", async () => {
    assert.equal(r.anterior.pedidos, 1);
    assert.equal(r.anterior.faturamento, await totalDe([pedidos[3].id]));
    assert.equal(r.anterior.ate, diasAtras(30));
  });

  it("gráfico com todos os dias do período e a soma batendo", () => {
    assert.equal(r.agrupar, "dia");
    assert.equal(r.serie.length, 30);
    assert.equal(r.serie.at(-1).chave, hoje());
    assert.equal(r.serie.reduce((s, x) => s + x.total, 0), r.totais.faturamento);
    assert.equal(r.serie.reduce((s, x) => s + x.pedidos, 0), 3);
  });

  it("produtos, categorias, pagamentos, entrega/retirada, semana, horários, clientes e cupons", () => {
    assert.equal(r.produtos[0].nome, bolo.nome);
    assert.equal(r.produtos[0].pedidos, 3);
    assert.equal(r.produtos[0].qtd, r.totais.itens);
    assert.equal(r.produtos[0].receita, r.totais.faturamento - r.totais.frete, "já com o desconto do cupom");
    assert.equal(r.categorias.length, 1);
    assert.deepEqual(r.pagamentos.map((x) => x.pagamento).sort(), ["cartao_entrega", "dinheiro"]);
    assert.deepEqual(r.tipos.map((x) => [x.tipo, x.pedidos]), [["retirada", 3]]);
    assert.equal(r.semana.length, 7);
    assert.equal(r.horarios.length, 24);
    assert.equal(r.semana.reduce((s, x) => s + x.pedidos, 0), 3);
    assert.equal(r.clientes.length, 3);
    assert.equal(r.clientes[0].nome, "Bia Souza", "quem comprou mais vem primeiro");
    assert.deepEqual(r.cupons.map((c) => [c.cupom, c.usos, c.desconto]), [["DOCE5", 1, 500]]);
    assert.ok(r.status.some((s) => s.status === "cancelado" && s.n === 1), "situação mostra os cancelados");
  });

  it("lucro estimado pela receita cadastrada (R$ 6,00 de custo por bolo)", () => {
    assert.equal(r.totais.custo, r.totais.itens * 600);
    assert.equal(r.totais.lucro, r.totais.receita_com_custo - r.totais.custo);
    assert.ok(r.totais.margem_pct > 0 && r.totais.margem_pct < 100);
  });

  it("a lista da planilha tem todos, até o cancelado, com o que já foi pago", () => {
    assert.equal(r.lista.length, 4);
    assert.ok(r.lista.some((p) => p.status === "cancelado"));
    assert.equal(r.lista.find((p) => p.id === pedidos[0].id).pago > 0, true);
    assert.equal(r.lista_cortada, false);
  });
});

describe("outros jeitos de ver", () => {
  it("hoje: por hora, 24 pedaços", async () => {
    const r = await relatorio(`de=${hoje()}&ate=${hoje()}`);
    assert.equal(r.agrupar, "hora");
    assert.equal(r.serie.length, 24);
    assert.match(r.serie[0].chave, /^\d{4}-\d{2}-\d{2} 00$/);
    assert.equal(r.totais.pedidos, 3);
  });

  it("12 meses: por mês", async () => {
    const p = periodo("12m");
    const r = await relatorio(`de=${p.de}&ate=${p.ate}&agrupar=mes`);
    assert.equal(r.agrupar, "mes");
    assert.equal(r.serie.length, 12);
    assert.equal(r.totais.pedidos, 4, "inclui a compra da Duda");
  });

  it("pela data da entrega: os pedidos estão marcados para o futuro", async () => {
    const passado = await relatorio(`de=${diasAtras(29)}&ate=${hoje()}&base=entrega`);
    assert.equal(passado.totais.pedidos, 0);
    const futuro = await relatorio(`de=${hoje()}&ate=${quando.data}&base=entrega`);
    assert.equal(futuro.base, "entrega");
    assert.equal(futuro.totais.pedidos, 4, "entrega não depende de quando foi pedido");
    assert.ok(futuro.horarios.some((h) => h.hora === Number(quando.hora.slice(0, 2)) && h.pedidos === 4), "horário das entregas");
  });
});

describe("períodos e rótulos (tela)", () => {
  const dia = new Date(2026, 8, 29); // 29/09/2026
  it("atalhos de período", () => {
    assert.deepEqual(periodo("hoje", dia), { de: "2026-09-29", ate: "2026-09-29", agrupar: "hora" });
    assert.deepEqual(periodo("7d", dia), { de: "2026-09-23", ate: "2026-09-29", agrupar: "dia" });
    assert.deepEqual(periodo("mes", dia), { de: "2026-09-01", ate: "2026-09-29", agrupar: "dia" });
    assert.deepEqual(periodo("mes-passado", dia), { de: "2026-08-01", ate: "2026-08-31", agrupar: "dia" });
    assert.deepEqual(periodo("mes-passado", new Date(2026, 0, 10)), { de: "2025-12-01", ate: "2025-12-31", agrupar: "dia" }, "janeiro olha dezembro do ano anterior");
    assert.deepEqual(periodo("12m", dia), { de: "2025-10-01", ate: "2026-09-29", agrupar: "mes" });
    assert.equal(PERIODOS.length, 8);
  });
  it("rótulos e variação", () => {
    assert.deepEqual(rotulosDe("2026-09-29", "dia"), { curto: "29/09", longo: "ter, 29/09/2026" });
    assert.deepEqual(rotulosDe("2026-09", "mes"), { curto: "set/26", longo: "setembro de 2026" });
    assert.equal(rotulosDe("2026-09-29 14", "hora").curto, "14h");
    assert.deepEqual(variacao(150, 100), { pct: 50, sobe: true });
    assert.deepEqual(variacao(50, 100), { pct: 50, sobe: false });
    assert.equal(variacao(10, 0), null);
  });
});
