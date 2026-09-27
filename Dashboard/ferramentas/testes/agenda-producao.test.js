/* ==========================================================
   AGENDA E PRODUÇÃO — datas bloqueadas, limite de pedidos por dia
   e a lista "o que produzir". O limite vale de verdade no banco
   (não só na tela): pedido em dia bloqueado ou lotado é recusado.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, painel, visitante, cliente, bolo, datas;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }

/** Duas datas diferentes (a partir de +4 dias) que têm horário livre. */
function duasDatas(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000), achadas = [];
  for (let i = 0; i < 30 && achadas.length < 2; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) achadas.push({ data: dataISO(d), hora: horas[0] });
  }
  return achadas;
}
const pedir = (quando, qtd = 1) => cliente.post("/pedidos", {
  itens: [{ produto_id: bolo.id, qtd, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "dinheiro",
});

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Agenda", email: "agenda@teste.com", telefone: "11999998888", senha: "Senha1234" });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  datas = duasDatas(await visitante.get("/config"));
});
after(async () => { await emu?.fechar(); });

describe("limite de pedidos por dia", () => {
  it("sem limite configurado, a agenda não bloqueia nada", async () => {
    const a = await visitante.get("/agenda");
    assert.equal(a.max_pedidos_dia, 0);
    assert.deepEqual(a.indisponiveis, []);
  });

  it("validação: só administrador altera e o valor precisa ser razoável", async () => {
    assert.equal((await falha(painel.put("/configuracoes/agenda", { max_pedidos_dia: 501 }))).status, 422);
    assert.equal((await falha(painel.put("/configuracoes/agenda", { max_pedidos_dia: -1 }))).status, 422);
    const doCliente = criarApiPainel(cliente.supabase);
    assert.equal((await falha(doCliente.put("/configuracoes/agenda", { max_pedidos_dia: 3 }))).status, 403);
  });

  it("o dia lota, some da lista de datas e o banco recusa o pedido extra", async () => {
    const salvo = await painel.put("/configuracoes/agenda", { max_pedidos_dia: 2 });
    assert.equal(salvo.configuracoes.agenda.max_pedidos_dia, 2);

    const [dia, outroDia] = datas;
    await pedir(dia);
    assert.deepEqual((await visitante.get("/agenda")).indisponiveis, [], "com 1 de 2 ainda há vaga");
    const segundo = await pedir(dia);

    const agenda = await visitante.get("/agenda");
    assert.deepEqual(agenda.indisponiveis, [{ data: dia.data, motivo: "lotada" }]);

    const e = await falha(pedir(dia));
    assert.equal(e.status, 422);
    assert.match(e.campos.data, /agenda deste dia/i);
    const orc = await cliente.post("/pedidos/orcamento", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...dia, pagamento: "dinheiro" });
    assert.ok(orc.problemas.some((x) => x.campo === "data"), "o orçamento já avisa do dia cheio");

    await pedir(outroDia); // outra data segue livre

    // cancelar libera a vaga
    await cliente.post(`/pedidos/${segundo.pedido.codigo}/cancelar`, { motivo: "teste" });
    assert.deepEqual((await visitante.get("/agenda")).indisponiveis, []);
    await pedir(dia);
  });

  it("pedidos em rajada: entram só as vagas que restam", async () => {
    await painel.put("/configuracoes/agenda", { max_pedidos_dia: 3 });
    const dia = datas[1]; // já tem 1 pedido
    const resultados = await Promise.allSettled([pedir(dia), pedir(dia), pedir(dia), pedir(dia)]);
    const ok = resultados.filter((r) => r.status === "fulfilled").length;
    assert.equal(ok, 2, "1 já existia + 2 novos = limite de 3");
    assert.equal((await visitante.get("/agenda")).indisponiveis.some((x) => x.data === dia.data && x.motivo === "lotada"), true);
  });
});

describe("datas bloqueadas", () => {
  it("bloquear um dia o tira da loja e recusa pedidos; desbloquear devolve", async () => {
    await painel.put("/configuracoes/agenda", { max_pedidos_dia: 0 });
    const [dia] = datas;
    const r = await painel.put("/agenda/data", { data: dia.data, bloquear: true, motivo: "Feriado" });
    assert.equal(r.bloqueada, true);
    assert.deepEqual((await visitante.get("/agenda")).indisponiveis, [{ data: dia.data, motivo: "bloqueada" }]);

    const e = await falha(pedir(dia));
    assert.equal(e.status, 422);
    assert.match(e.campos.data, /Não estamos agendando/);

    await painel.put("/agenda/data", { data: dia.data, bloquear: false });
    assert.deepEqual((await visitante.get("/agenda")).indisponiveis, []);
    await pedir(dia);
  });

  it("calendário do mês mostra pedidos e bloqueios de cada dia", async () => {
    const [dia] = datas;
    await painel.put("/agenda/data", { data: dia.data, bloquear: true, motivo: "Férias" });
    const mes = dia.data.slice(0, 7);
    const cal = await painel.get(`/agenda?mes=${mes}`);
    assert.equal(cal.mes, mes);
    const linha = cal.dias.find((x) => x.data === dia.data);
    assert.equal(linha.bloqueada, true);
    assert.equal(linha.motivo, "Férias");
    assert.ok(linha.pedidos >= 1);
    assert.ok(cal.dias.length >= 28 && cal.dias.length <= 31);
    assert.equal((await falha(painel.get("/agenda?mes=2026-13"))).status, 422);
    await painel.put("/agenda/data", { data: dia.data, bloquear: false });
  });

  it("cliente e visitante não bloqueiam datas nem abrem o calendário", async () => {
    const doCliente = criarApiPainel(cliente.supabase);
    assert.equal((await falha(doCliente.put("/agenda/data", { data: datas[0].data, bloquear: true, motivo: "x" }))).status, 403);
    assert.equal((await falha(doCliente.get("/agenda"))).status, 403);
    assert.equal((await falha(criarApiPainel(visitante.supabase).get("/agenda"))).status, 401);
  });
});

describe("lista de produção", () => {
  it("soma os itens da data, ignora cancelados e traz os pedidos por horário", async () => {
    const dia = { data: datas[0].data, hora: datas[0].hora };
    const antes = (await painel.get(`/producao?data=${dia.data}`)).itens.find((i) => i.nome === bolo.nome)?.qtd ?? 0;
    const a = await pedir(dia, 2);
    const b = await pedir(dia, 3);
    await cliente.post(`/pedidos/${b.pedido.codigo}/cancelar`, { motivo: "teste" });

    const r = await painel.get(`/producao?data=${dia.data}`);
    assert.equal(r.data, dia.data);
    const item = r.itens.find((i) => i.nome === bolo.nome);
    assert.equal(Number(item.qtd), Number(antes) + 2, "o cancelado (3 unidades) não conta");
    assert.ok(r.pedidos.some((x) => x.codigo === a.pedido.codigo));
    assert.ok(!r.pedidos.some((x) => x.codigo === b.pedido.codigo));
    assert.ok(r.pedidos.every((x, i, l) => i === 0 || l[i - 1].hora <= x.hora), "ordenados por horário");
  });

  it("sem data, mostra o dia seguinte; data inválida é recusada; cliente não vê", async () => {
    const r = await painel.get("/producao");
    assert.match(r.data, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await falha(painel.get("/producao?data=31/12/2026"))).status, 422);
    assert.equal((await falha(criarApiPainel(cliente.supabase).get("/producao"))).status, 403);
  });
});
