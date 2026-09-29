/* ==========================================================
   EXTRAS DOS PRODUTOS — alérgenos, fotos extras, limite de
   unidades por dia e período de venda. As regras valem no banco
   (não só na tela) e as fotos extras ficam no Storage.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let emu, painel, visitante, cliente, doCliente, categoriaId, quando;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const soma = (iso, n) => { const [a, m, d] = iso.split("-").map(Number); return dataISO(new Date(a, m - 1, d + n)); };

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}
const base = (extra = {}) => ({ categoria_id: categoriaId, nome: "Bolo Extra " + Math.random().toString(36).slice(2, 7), descricao: "Teste", preco: 5000, unidade: "bolo", min_qtd: 1,
  emoji: "🍰", tag: "", antecedencia_horas: 24, ativo: true, destaque: false, opcoes: [], ...extra });
const pedir = (produto, qtd, data = quando) => cliente.post("/pedidos", { itens: [{ produto_id: produto.id, qtd }], tipo: "retirada", ...data, pagamento: "dinheiro" });

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Extras", email: "extras@teste.com", telefone: "11999998888", senha: "Senha1234" });
  doCliente = criarApiPainel(cliente.supabase);
  categoriaId = (await painel.get("/categorias")).categorias[0].id;
  quando = proximaData(await visitante.get("/config"));
});
after(async () => { await emu?.fechar(); });

describe("alérgenos e fotos extras", () => {
  let produto;
  it("salva alérgenos (ordenados, sem repetir) e fotos extras no Storage; a vitrine mostra", async () => {
    produto = (await painel.post("/produtos", base({ alergenos: ["ovos", "leite", "ovos"], galeria: [PNG, PNG] }))).produto;
    assert.deepEqual(produto.alergenos, ["leite", "ovos"]);
    assert.equal(produto.galeria.length, 2);
    for (const url of produto.galeria) {
      assert.match(url, /\/storage\/v1\/object\/public\/produtos\/[0-9a-f-]{36}\/[\w-]+\.png$/);
      assert.equal((await fetch(url)).status, 200);
    }
    const publico = (await visitante.get("/catalogo")).produtos.find((p) => p.id === produto.id);
    assert.deepEqual(publico.alergenos, ["leite", "ovos"]);
    assert.deepEqual(publico.galeria, produto.galeria);
  });

  it("recusa valores inválidos e não deixa nada pela metade", async () => {
    const antes = (await painel.get("/produtos")).produtos.length;
    assert.ok((await falha(painel.post("/produtos", base({ alergenos: ["poeira"] })))).campos.alergenos);
    assert.ok((await falha(painel.post("/produtos", base({ galeria: [PNG, PNG, PNG, PNG, PNG] })))).campos.galeria, "no máximo 4 fotos");
    assert.equal((await falha(painel.post("/produtos", base({ galeria: ["https://evil.example/x.png"] })))).status, 422);
    assert.equal((await falha(painel.post("/produtos", base({ limite_diario: 0 })))).status, 422);
    assert.ok((await falha(painel.post("/produtos", base({ disponivel_de: "2026-12-20", disponivel_ate: "2026-12-10" })))).campos.disponivel_ate);
    assert.equal((await painel.get("/produtos")).produtos.length, antes, "os produtos recusados não foram criados");
  });

  it("editar sem mandar os extras mantém tudo; tirar uma foto apaga o arquivo", async () => {
    const { alergenos, galeria, limite_diario, disponivel_de, disponivel_ate, ...semExtras } = produto;
    const mesmo = (await painel.put(`/produtos/${produto.id}`, { ...semExtras, preco: 5500 })).produto;
    assert.equal(mesmo.preco, 5500);
    assert.deepEqual(mesmo.alergenos, ["leite", "ovos"]);
    assert.deepEqual(mesmo.galeria, galeria);

    const [ficar, sair] = galeria;
    const menos = (await painel.put(`/produtos/${produto.id}`, { ...semExtras, galeria: [ficar] })).produto;
    assert.deepEqual(menos.galeria, [ficar]);
    assert.equal((await fetch(sair)).status, 404, "a foto removida saiu do Storage");
    assert.equal((await fetch(ficar)).status, 200);
    produto = menos;
  });

  it("excluir o produto apaga também as fotos extras", async () => {
    const url = produto.galeria[0];
    await painel.delete(`/produtos/${produto.id}`);
    assert.equal((await fetch(url)).status, 404);
  });

  it("só administrador altera os extras", async () => {
    assert.equal((await falha(doCliente.post("/produtos", base({ alergenos: ["leite"] })))).status, 403);
  });
});

describe("limite de unidades por dia", () => {
  let doce;
  it("mostra quanto resta, recusa o excesso e libera a vaga ao cancelar", async () => {
    doce = (await painel.post("/produtos", base({ nome: "Doce Limitado", limite_diario: 3 }))).produto;
    assert.equal((await visitante.get("/catalogo")).produtos.find((p) => p.id === doce.id).limite_diario, 3);

    const primeiro = await pedir(doce, 2);
    const e = await falha(pedir(doce, 2));
    assert.equal(e.status, 422);
    assert.match(e.campos.itens, /restam apenas 1 unidade/);

    await pedir(doce, 1);
    assert.match((await falha(pedir(doce, 1))).campos.itens, /esgotado para este dia/);
    const orc = await cliente.post("/pedidos/orcamento", { itens: [{ produto_id: doce.id, qtd: 1 }], tipo: "retirada", ...quando, pagamento: "dinheiro" });
    assert.ok(orc.problemas.some((p) => p.campo === "itens"), "o orçamento já avisa");

    await cliente.post(`/pedidos/${primeiro.pedido.codigo}/cancelar`, { motivo: "teste" });
    await pedir(doce, 2); // as 2 unidades voltaram
  });

  it("o limite vale por dia: outra data continua livre", async () => {
    const outra = proximaData({ ...(await visitante.get("/config")) });
    let dia2 = { data: soma(quando.data, 1), hora: quando.hora };
    // acha um dia seguinte com horário válido
    for (let i = 1; i < 10; i++) {
      const d = soma(quando.data, i);
      const horas = gerarHorarios((await visitante.get("/config")).horarios, d, new Date(Date.now() + 96 * 3600_000), 30);
      if (horas.length) { dia2 = { data: d, hora: horas[0] }; break; }
    }
    assert.notEqual(dia2.data, outra.data);
    await pedir(doce, 3, dia2);
  });

  it("a equipe pode lançar acima do limite (decisão dela)", async () => {
    const r = await painel.post("/pedidos", { nome: "Cliente Balcão", tipo: "retirada", ...quando, pagamento: "dinheiro", itens: [{ produto_id: doce.id, qtd: 10 }] });
    assert.equal(r.pedido.itens[0].qtd, 10);
  });
});

describe("período de venda", () => {
  it("só aceita datas dentro do período (a partir de / até)", async () => {
    const depois = (await painel.post("/produtos", base({ nome: "Ovo de Páscoa", disponivel_de: soma(quando.data, 5), disponivel_ate: soma(quando.data, 20) }))).produto;
    assert.equal(depois.disponivel_de, soma(quando.data, 5));
    assert.match((await falha(pedir(depois, 1))).campos.data, /a partir de/);

    const antes = (await painel.post("/produtos", base({ nome: "Panetone", disponivel_ate: soma(quando.data, -1) }))).produto;
    assert.match((await falha(pedir(antes, 1))).campos.data, /até/);

    const dentro = (await painel.post("/produtos", base({ nome: "Bolo de Verão", disponivel_de: soma(quando.data, -3), disponivel_ate: soma(quando.data, 3) }))).produto;
    assert.equal((await pedir(dentro, 1)).pedido.itens.length, 1);
  });

  it("limpar o período libera o produto", async () => {
    const p = (await painel.post("/produtos", base({ nome: "Sazonal", disponivel_de: soma(quando.data, 30) }))).produto;
    assert.equal((await falha(pedir(p, 1))).status, 422);
    const { alergenos, galeria, limite_diario, disponivel_de, disponivel_ate, ...semExtras } = p;
    const livre = (await painel.put(`/produtos/${p.id}`, { ...semExtras, disponivel_de: "", disponivel_ate: "" })).produto;
    assert.equal(livre.disponivel_de, null);
    await pedir(livre, 1);
  });
});
