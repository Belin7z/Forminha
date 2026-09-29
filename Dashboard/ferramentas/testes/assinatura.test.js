/* ==========================================================
   ASSINATURA (mensalidade da Forminha) no banco da loja:
   a Central escreve a situação na ficha "forminha"; a dona vê no
   painel; com a loja suspensa, o site não aceita pedidos (aparece
   como pausado, com recado) e a dona continua usando o painel.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

let emu, painel, cliente, visitante, bolo, quando;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const ficha = (assinatura) => sql(emu.db, `insert into public.configuracoes (chave, valor) values ('forminha', $1::jsonb)
  on conflict (chave) do update set valor = public.configuracoes.valor || excluded.valor`, [JSON.stringify({ assinatura })]);
const pedir = () => cliente.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "dinheiro" });

before(async () => {
  emu = await iniciarEmulador();
  const dados = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: dados.email, senha: dados.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Assinatura", email: "assinatura@teste.com", telefone: "11999998888", senha: "Senha1234" });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  const cfg = await visitante.get("/config");
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30 && !quando; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) quando = { data: dataISO(d), hora: horas[0] };
  }
});
after(async () => { await emu?.fechar(); });

describe("assinatura no banco da loja", () => {
  it("sem nada escrito: em dia, e a dona vê isso", async () => {
    const a = await painel.get("/assinatura");
    assert.deepEqual(a, { situacao: "em_dia", vencimento: null, valor_centavos: 0, link: null, suspensa: false });
  });

  it("só o administrador lê a situação (nada disso vai para a vitrine)", async () => {
    assert.ok([401, 403].includes((await falha(criarApiPainel(novoCliente()).get("/assinatura"))).status));
    await ficha({ situacao: "aberta", vencimento: "2026-10-05", valor_centavos: 9900, link: "https://forminha.vercel.app/#/pagar/abc", suspensa: false });
    const cfg = await visitante.get("/config");
    assert.doesNotMatch(JSON.stringify(cfg), /forminha\.vercel\.app\/#\/pagar|assinatura/);
    assert.equal((await painel.get("/assinatura")).situacao, "aberta");
  });

  it("em dia ou só atrasada: o site recebe pedidos normalmente", async () => {
    await ficha({ situacao: "atrasada", vencimento: "2026-09-01", valor_centavos: 9900, link: "x", suspensa: false });
    assert.ok((await pedir()).pedido.codigo);
  });

  it("suspensa: pedidos pausados com recado, e o servidor recusa pedido novo", async () => {
    await ficha({ situacao: "suspensa", vencimento: "2026-09-01", valor_centavos: 9900, link: "x", suspensa: true });
    const cfg = await visitante.get("/config");
    assert.equal(cfg.pedidos.pausados, true);
    assert.match(cfg.pedidos.mensagem_pausa, /WhatsApp/);
    const e = await falha(pedir());
    assert.equal(e.status, 423);
    assert.equal((await painel.get("/assinatura")).suspensa, true, "o painel continua funcionando");
    assert.ok(Array.isArray((await painel.get("/pedidos")).pedidos ?? []), "a dona continua vendo os pedidos");
  });

  it("paga: volta ao normal sozinha", async () => {
    await ficha({ situacao: "em_dia", vencimento: "2026-10-01", valor_centavos: 9900, link: null, suspensa: false });
    assert.equal((await visitante.get("/config")).pedidos.pausados, false);
    assert.ok((await pedir()).pedido.codigo);
  });
});
