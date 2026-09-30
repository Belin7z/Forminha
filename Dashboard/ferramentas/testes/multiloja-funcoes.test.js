/* ==========================================================
   FUNÇÕES DO SERVIDOR NO BANCO ÚNICO (migração 26).
     - as chaves de cada loja ficam cifradas no banco; só abrem com
       o SEGREDO_SERVIDOR (e quem vê o banco não consegue usá-las);
     - o PIX da loja B sai com a chave do Mercado Pago da B, e o aviso
       do pagamento volta com o código da B (?loja=);
     - o aviso registra o pagamento só na loja certa;
     - sem o segredo das funções, o banco não entrega nada.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { executarNaLoja } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarClienteSupabase } from "../../src/scripts/base/api/nucleo.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";
import { cabecalhosCors, cifrarSegredo, decifrarSegredo, envDaLoja } from "../../supabase/functions/_shared/comum.js";
import { createHash } from "node:crypto";

const SEGREDO = "s".repeat(64);
const BIA = { codigo: "x6u-BC4-4Bz", nome: "Doce da Bia", prefixo: "DB", enderecos: ["bia.forminha.test", "bia-painel.forminha.test"] };
const TOKEN_A = `TEST-loja-a-${"a".repeat(24)}`, TOKEN_B = `TEST-loja-b-${"b".repeat(24)}`;
const GATEWAY_A = "g".repeat(40), GATEWAY_B = "h".repeat(40);
let emu, idA, idB, cliente, pedido;
const navegador = (loja) => criarClienteSupabase({ url: emu.url, chave: emu.chaveAnon, storageKey: "t", fabrica: createClient, loja,
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const q = async (texto, params) => (await emu.db.query(texto, params)).rows;

async function prepararLoja(id, { token, gateway, endereco }) {
  const valores = [["mp_token", await cifrarSegredo(token, SEGREDO)], ["segredo_gateway", await cifrarSegredo(gateway, SEGREDO)]];
  await executarNaLoja(emu.db, id, `
    select public.central_conectar_gateway('${JSON.stringify({ segredo: gateway, conta: "CONTA", cartao: true })}'::jsonb);
    ${valores.map(([k, v]) => `insert into public.loja_segredos (chave, valor) values ('${k}', '${v}');`).join("\n")}`);
  await q("update public.lojas set endereco = $2 where id = $1", [id, endereco]);
}

before(async () => {
  emu = await iniciarEmulador({ exemplo: false });
  idA = (await q("select id from public.lojas where codigo = 'principal'"))[0].id;
  idB = await emu.criarLoja(BIA);
  Object.assign(emu.funcoes, { MULTILOJA: "1", SEGREDO_SERVIDOR: SEGREDO, MP_ACCESS_TOKEN: "", SEGREDO_GATEWAY: "" });
  await q("insert into public.forminha_servidor (segredo_hash) values ($1)", [createHash("sha256").update(SEGREDO).digest("hex")]);
  await prepararLoja(idA, { token: TOKEN_A, gateway: GATEWAY_A, endereco: "https://principal.forminha.test" });
  await prepararLoja(idB, { token: TOKEN_B, gateway: GATEWAY_B, endereco: "https://bia.forminha.test" });

  // um bolo na loja B e uma cliente dela com um pedido
  await emu.criarAdmin("dona.b@teste.local", "Admin12345", { loja: BIA.codigo });
  const painelB = navegador("bia-painel.forminha.test");
  await painelB.auth.signInWithPassword({ email: "dona.b@teste.local", password: "Admin12345" });
  const cat = (await painelB.rpc("admin_salvar_categoria", { p: { nome: "Bolos", emoji: "🎂", ativa: true } })).data;
  const catId = cat?.categoria?.id ?? (await painelB.rpc("admin_categorias")).data.categorias[0].id;
  const prod = (await painelB.rpc("admin_salvar_produto", { p: { categoria_id: catId, nome: "Bolo da Bia", descricao: "", preco: 5000, unidade: "bolo", min_qtd: 1, emoji: "🎂", ativo: true, destaque: false } }));
  assert.ok(!prod.error, prod.error?.message);
  cliente = criarApiLoja(navegador("bia.forminha.test"), { loja: "bia.forminha.test" });
  await cliente.post("/auth/cadastro", { nome: "Carla", email: "carla@teste.com", telefone: "11988887777", senha: "Senha1234", aceite: true });
  const cfg = await cliente.get("/config");
  const minimo = new Date(Date.now() + 96 * 3600_000);
  let quando;
  for (let i = 0; i < 30 && !quando; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) quando = { data: dataISO(d), hora: horas[0] };
  }
  const bolo = (await cliente.get("/catalogo")).produtos[0];
  pedido = (await cliente.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1 }], tipo: "retirada", ...quando, pagamento: "dinheiro" })).pedido;
});
after(async () => { await emu?.fechar(); });

describe("chaves de cada loja", () => {
  it("cifradas: quem vê o banco não vê a chave", async () => {
    const guardadas = await q("select valor from public.loja_segredos where loja_id = $1 and chave = 'mp_token'", [idB]);
    assert.ok(!guardadas[0].valor.includes("TEST-loja-b"));
    assert.equal(await decifrarSegredo(guardadas[0].valor, SEGREDO), TOKEN_B);
    await assert.rejects(decifrarSegredo(guardadas[0].valor, "outro-segredo"));
  });

  it("o banco só entrega com o segredo das funções, e só da loja pedida", async () => {
    const pedir = (chave, loja) => fetch(`${emu.url}/rest/v1/rpc/servidor_segredos`, {
      method: "POST", headers: { apikey: emu.chaveAnon, Authorization: `Bearer ${emu.chaveAnon}`, "Content-Type": "application/json", "x-loja": loja },
      body: JSON.stringify({ p: { chave } }),
    });
    assert.equal((await pedir("errado", BIA.codigo)).status, 403);
    const r = await (await pedir(SEGREDO, "bia.forminha.test")).json();
    assert.equal(r.codigo, BIA.codigo);
    assert.deepEqual(r.enderecos, ["bia-painel.forminha.test", "bia.forminha.test"]);
    assert.deepEqual(Object.keys(r.segredos).sort(), ["mp_token", "segredo_gateway"]);
  });

  it("o ambiente da função vira o da loja", async () => {
    const rpc = async (nome, p) => (await (await fetch(`${emu.url}/rest/v1/rpc/${nome}`, {
      method: "POST", headers: { apikey: emu.chaveAnon, Authorization: `Bearer ${emu.chaveAnon}`, "Content-Type": "application/json", "x-loja": BIA.codigo }, body: JSON.stringify({ p }),
    })).json());
    const env = await envDaLoja({ env: { MULTILOJA: "1", SEGREDO_SERVIDOR: SEGREDO, SUPABASE_URL: "x" }, rpc, loja: BIA.codigo });
    assert.deepEqual([env.LOJA_CODIGO, env.MP_ACCESS_TOKEN, env.SEGREDO_GATEWAY, env.URL_LOJA], [BIA.codigo, TOKEN_B, GATEWAY_B, "https://bia.forminha.test"]);
    assert.equal(env.ORIGENS_PERMITIDAS, "https://bia-painel.forminha.test,https://bia.forminha.test");
    await assert.rejects(envDaLoja({ env: { MULTILOJA: "1" }, rpc, loja: "" }), (e) => e.status === 404);
    assert.equal(await envDaLoja({ env: { MP_ACCESS_TOKEN: "x" }, rpc, loja: "" }).then((e) => e.MP_ACCESS_TOKEN), "x", "banco de uma loja só: nada muda");
  });

  it("o navegador pode mandar a loja para as funções (CORS)", () => {
    assert.match(cabecalhosCors("https://bia.forminha.test")["Access-Control-Allow-Headers"], /x-loja/);
  });
});

describe("PIX da loja B no banco único", () => {
  let id;
  it("sai com a chave do Mercado Pago da B e o aviso volta com o código da B", async () => {
    assert.match(pedido.codigo, /^DB\d+$/);
    const r = await cliente.post("/pix/gerar", { codigo: pedido.codigo });
    assert.ok(r.qr_code, JSON.stringify(r));
    const chamada = emu.externos.estado.mpChamadas.findLast((c) => c.caminho === "/v1/payments" && c.metodo === "POST");
    assert.equal(chamada.cabecalhos.Authorization, `Bearer ${TOKEN_B}`);
    assert.equal(chamada.corpo.notification_url, `${emu.url}/functions/v1/pix-webhook?loja=${encodeURIComponent(BIA.codigo)}`);
    id = r.id;
  });

  it("o aviso registra o pagamento na loja B (e numa loja errada é ignorado)", async () => {
    emu.externos.aprovar(id);
    const avisar = (loja) => fetch(`${emu.url}/functions/v1/pix-webhook?loja=${encodeURIComponent(loja)}&data.id=${id}&type=payment`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "payment", data: { id: String(id) } }),
    }).then((r) => r.json());
    const errada = await avisar("principal");
    assert.equal(errada.ignorado, true, JSON.stringify(errada));
    const certa = await avisar(BIA.codigo);
    assert.equal(certa.ok, true, JSON.stringify(certa));
    assert.ok(certa.aplicado > 0);
    const [p] = await q("select pago, loja_id from public.pedidos where codigo = $1", [pedido.codigo]);
    assert.deepEqual([p.loja_id, p.pago > 0], [idB, true]);
    assert.equal((await avisar("loja-que-nao-existe")).ignorado, true);
  });

  it("sem o segredo certo, a função não gera o PIX", async () => {
    emu.funcoes.SEGREDO_SERVIDOR = "errado";
    try {
      const e = await cliente.post("/pix/gerar", { codigo: pedido.codigo }).catch((x) => x);
      assert.equal(e.status, 403);
    } finally { emu.funcoes.SEGREDO_SERVIDOR = SEGREDO; }
  });
});
