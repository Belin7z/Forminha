/* ==========================================================
   PROTEÇÃO CONTRA FLOOD E ABUSO
   Limite de chamadas por IP (visitante) e por conta (logado),
   recusa de pedidos gigantes e teto de pedidos em aberto.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";

let emu, painel, bolo;
const cliente = (cabecalhos = {}) => createClient(emu.url, emu.chaveAnon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: cabecalhos },
});
const loja = (cabecalhos) => criarApiLoja(cliente(cabecalhos));
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
/** Repete até o servidor responder 429 (a janela é de 1 minuto: se o minuto virar no meio, o contador recomeça, então damos folga). */
async function ate429(chamada, limite) {
  let ok = 0;
  for (let i = 0; i < limite * 2 + 5; i++) {
    try { await chamada(); ok++; } catch (e) { return { ok, erro: e }; }
  }
  return { ok, erro: null };
}
const limpar = () => sql(emu.db, "delete from public.limites");
const ORCAMENTO = () => ({ itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", data: "2030-01-01", hora: "10:00", pagamento: "dinheiro" });

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(cliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  bolo = (await loja().get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
});
after(async () => { await emu?.fechar(); });

describe("limite por IP (visitante)", () => {
  it("passa de 300 leituras por minuto do mesmo IP e recebe 429; outro IP segue normal", async () => {
    await limpar();
    const atacante = loja({ "cf-connecting-ip": "203.0.113.10" });
    const r = await ate429(() => atacante.get("/agenda"), 300);
    assert.equal(r.erro?.status, 429, "o excesso é barrado");
    assert.ok(r.ok >= 1 && r.ok <= 600, `passaram ${r.ok} chamadas antes do bloqueio`);
    assert.match(r.erro.message, /Aguarde/);
    assert.equal((await loja({ "cf-connecting-ip": "203.0.113.11" }).get("/agenda")).max_pedidos_dia, 0, "outra pessoa não é afetada");
  });

  it("depois que a janela vence, volta a funcionar (o bloqueio vem mesmo do limitador)", async () => {
    await limpar();
    assert.equal((await loja({ "cf-connecting-ip": "203.0.113.10" }).get("/agenda")).max_pedidos_dia, 0);
  });

  it("a vitrine inteira (config, catálogo, avaliações) tem a mesma proteção", async () => {
    await limpar();
    const v = loja({ "cf-connecting-ip": "198.51.100.7" });
    const r = await ate429(() => v.get("/config"), 300);
    assert.equal(r.erro?.status, 429);
    assert.ok((await loja({ "cf-connecting-ip": "198.51.100.7" }).get("/catalogo")).produtos.length > 0, "cada função tem o seu próprio contador");
  });
});

describe("identificação de quem chama", () => {
  const quem = async (cabecalhos) => {
    await sql(emu.db, "select set_config('request.headers', $1, false)", [JSON.stringify(cabecalhos)]);
    const q = (await sql(emu.db, "select public._quem() as q")).rows[0].q;
    await sql(emu.db, "select set_config('request.headers', '', false)");
    return q;
  };
  it("prefere o IP da Cloudflare; sem ele, usa o ÚLTIMO endereço do x-forwarded-for", async () => {
    assert.equal(await quem({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "9.9.9.9" }), "ip:203.0.113.5");
    assert.equal(await quem({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 9.9.9.9" }), "ip:9.9.9.9");
    assert.equal(await quem({ "x-real-ip": "10.1.1.1" }), "ip:10.1.1.1");
    assert.equal(await quem({}), "ip:desconhecido");
  });
});

describe("limite por conta (cliente logado)", () => {
  let ana, beto;
  it("orçamentos em excesso são barrados por conta, sem atrapalhar os outros clientes", async () => {
    ana = loja({ "cf-connecting-ip": "192.0.2.1" });
    beto = loja({ "cf-connecting-ip": "192.0.2.1" }); // mesmo IP, contas diferentes
    await ana.post("/auth/cadastro", { nome: "Ana Teste", email: "ana@teste.com", telefone: "11999998888", senha: "Senha1234" });
    await beto.post("/auth/cadastro", { nome: "Beto Teste", email: "beto@teste.com", telefone: "11999997777", senha: "Senha1234" });
    await limpar();
    const r = await ate429(() => ana.post("/pedidos/orcamento", ORCAMENTO()), 30);
    assert.equal(r.erro?.status, 429);
    assert.ok(r.ok <= 60);
    assert.ok((await beto.post("/pedidos/orcamento", ORCAMENTO())).itens.length === 1, "outra conta segue normal");
    assert.equal((await loja().get("/config")).loja.nome.length > 0, true, "e o visitante também");
  });

  it("pedido gigante é recusado antes de qualquer processamento", async () => {
    await limpar();
    const e = await falha(ana.post("/pedidos", { ...ORCAMENTO(), observacoes: "x".repeat(300000) }));
    assert.equal(e.status, 413);
    const e2 = await falha(ana.put("/conta", { nome: "Ana", telefone: "11999998888", extra: "y".repeat(300000) }));
    assert.equal(e2.status, 413);
  });

  it("um cliente não acumula mais de 15 pedidos em aberto", async () => {
    await limpar();
    const usuario = (await ana.get("/auth/eu")).usuario;
    await sql(emu.db, `insert into public.pedidos (usuario_id, cliente_nome, tipo, data_agendada, hora_agendada, pagamento, subtotal, total)
      select $1, 'Ana Teste', 'retirada', current_date + 10, '10:00', 'dinheiro', 1000, 1000 from generate_series(1, 15)`, [usuario.id]);
    const e = await falha(ana.post("/pedidos", { ...ORCAMENTO(), data: "2031-01-01" }));
    assert.equal(e.status, 409);
    assert.match(e.message, /muitos pedidos em andamento/);
    // concluídos e cancelados não contam
    await sql(emu.db, "update public.pedidos set status = 'cancelado' where usuario_id = $1", [usuario.id]);
    const r = await falha(ana.post("/pedidos", { ...ORCAMENTO(), data: "2001-01-01" })); // só falha por outro motivo (data), não pelo teto
    assert.notEqual(r.status, 409);
  });
});

describe("equipe e permissões", () => {
  it("exportações têm limite por minuto (planilhas pesadas não podem ser repetidas em rajada)", async () => {
    await limpar();
    const r = await ate429(() => painel.get("/exportar/clientes"), 10);
    assert.equal(r.erro?.status, 429);
    await limpar();
  });

  it("as peças internas do limitador e as funções originais não são acessíveis de fora", async () => {
    const rpc = async (nome) => (await fetch(`${emu.url}/rest/v1/rpc/${nome}`, { method: "POST", headers: { apikey: emu.chaveAnon, "content-type": "application/json" }, body: "{}" })).status;
    for (const nome of ["_limitar", "_quem", "_base_loja_catalogo", "_base_cliente_criar_pedido", "_base_admin_exportar_clientes"]) {
      assert.ok((await rpc(nome)) >= 400, `${nome} não pode ser chamada de fora`);
    }
    const tabela = await fetch(`${emu.url}/rest/v1/limites?select=*`, { headers: { apikey: emu.chaveAnon } });
    assert.ok(tabela.status >= 400, "a tabela de contadores não é legível");
  });

  it("consultas têm tempo máximo (visitante 3 s, logado 8 s)", async () => {
    const r = (await sql(emu.db, "select rolname, rolconfig::text as cfg from pg_roles where rolname in ('anon','authenticated') order by 1")).rows;
    assert.match(r.find((x) => x.rolname === "anon").cfg, /statement_timeout=3s/);
    assert.match(r.find((x) => x.rolname === "authenticated").cfg, /statement_timeout=8s/);
  });
});
