/* ==========================================================
   ESTOQUE — custos, margem, preço sugerido, histórico de preço,
   lucro real por período e o aviso de estoque por WhatsApp
   (a função do servidor pergunta ao banco se há o que avisar).
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarExternos } from "./emulador/externos.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";
import { criarRpc } from "../../supabase/functions/_shared/comum.js";
import { avisarWhatsapp } from "../../supabase/functions/whatsapp-avisar/logica.js";

let emu, ext, painel, visitante, cliente, atendente, bolo, quando, farinha, ovos, deps, env;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const perto = (a, b, folga = 0.5) => assert.ok(Math.abs(a - b) <= folga, `${a} deveria ser ≈ ${b}`);
const jwtDe = async (api) => (await api.supabase.auth.getSession()).data.session.access_token;
const dia = (mais = 0) => new Date(Date.now() - 3 * 3600_000 + mais * 86400_000).toISOString().slice(0, 10);
const editarIng = (i, extra) => painel.put(`/ingredientes/${i.id}`, { nome: i.nome, unidade: i.unidade, embalagem_qtd: i.embalagem_qtd, embalagem_nome: i.embalagem_nome, embalagem_preco: i.embalagem_preco, ...extra });

function proximaData(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem data disponível");
}
const requisicao = (jwt, corpo) => ({ metodo: "POST", url: "http://funcao.local/x", corpoTexto: JSON.stringify(corpo), cabecalhos: jwt ? { authorization: `Bearer ${jwt}` } : {} });
const avisar = async (jwt = null, d = deps) => avisarWhatsapp(requisicao(jwt ?? (await jwtDe(painel)), { tipo: "estoque" }), d);
const liberarAviso = (extra = "") => sql(emu.db, `update public.estoque_config set aviso_tentativa_em = now() - interval '2 hours' ${extra} where id = 1`);
const configAviso = () => painel.get("/estoque/aviso");

before(async () => {
  emu = await iniciarEmulador();
  ext = criarExternos();
  const dados = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: dados.email, senha: dados.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Custos", email: "custos@teste.com", telefone: "11999998888", senha: "Senha1234" });
  const conta = criarApiLoja(novoCliente());
  await conta.post("/auth/cadastro", { nome: "Ana Atendente", email: "ana@teste.com", telefone: "11955554444", senha: "Senha1234" });
  await painel.post("/equipe", { email: "ana@teste.com", papel: "atendente" });
  atendente = criarApiPainel(novoCliente());
  await atendente.post("/auth/entrar", { email: "ana@teste.com", senha: "Senha1234" });
  bolo = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
  quando = proximaData(await visitante.get("/config"));
  env = { SUPABASE_URL: emu.url, WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_ID: "1234567890", URL_LOJA: "https://loja.exemplo/" };
  deps = { env, fetchFn: ext.fetchFn, rpc: criarRpc({ url: emu.url, chaveAnon: emu.chaveAnon, fetchFn: fetch }) };

  farinha = (await painel.post("/ingredientes", { nome: "Farinha de trigo", unidade: "g", estoque: 5000, embalagem_qtd: 1000, embalagem_nome: "pacote", embalagem_preco: 500 })).ingrediente;
  ovos = (await painel.post("/ingredientes", { nome: "Ovos", unidade: "un", estoque: 6, embalagem_qtd: 12, embalagem_nome: "cartela", embalagem_preco: 1200 })).ingrediente;
  await painel.put(`/receitas/${bolo.id}`, { linhas: [{ ingrediente_id: farinha.id, quantidade: 400 }, { ingrediente_id: ovos.id, quantidade: 4 }] });
});
after(async () => { await emu?.fechar(); });

describe("permissões", () => {
  it("só o administrador vê custos, lucro e aviso", async () => {
    const chamadas = (api) => [
      () => api.get("/estoque/custos"), () => api.put("/estoque/custos", { margem_alvo: 50 }), () => api.get(`/estoque/precos/${farinha.id}`),
      () => api.put(`/estoque/preco-produto/${bolo.id}`, { preco: 100 }), () => api.get("/estoque/lucro"), () => api.get("/estoque/aviso"), () => api.put("/estoque/aviso", { aviso_ativo: false }),
    ];
    for (const [api, status] of [[criarApiPainel(visitante.supabase), 401], [criarApiPainel(cliente.supabase), 403], [atendente, 403]]) {
      for (const chamar of chamadas(api)) assert.equal((await falha(chamar())).status, status);
    }
    assert.equal((await avisar(await jwtDe(atendente))).status, 403, "o aviso de estoque também é só da dona");
    assert.equal((await avisarWhatsapp({ ...requisicao(null, { tipo: "estoque" }) }, deps)).status, 401);
  });
});

describe("custos, margem e preço sugerido", () => {
  it("mostra custo, margem e se está abaixo da margem desejada", async () => {
    const r = await painel.get("/estoque/custos");
    assert.equal(r.margem_alvo, 60);
    const p = r.produtos.find((x) => x.id === bolo.id);
    assert.equal(p.custo_unit, 600, "400 g de farinha (200) + 4 ovos (400)");
    assert.equal(p.margem, 8390);
    perto(p.margem_pct, 93.3, 0.05);
    assert.equal(p.abaixo, false);
    assert.equal(r.produtos.length, 1, "só produtos com receita entram");
  });

  it("com margem desejada maior, sugere o preço e o produto fica 'abaixo'", async () => {
    assert.deepEqual(await painel.put("/estoque/custos", { margem_alvo: 95, alerta_alta_pct: 5 }), { margem_alvo: 95, alerta_alta_pct: 5 });
    const p = (await painel.get("/estoque/custos")).produtos[0];
    assert.equal(p.abaixo, true);
    assert.equal(p.preco_sugerido, 12000, "600 ÷ 5% = 12000, já em múltiplo de R$ 0,50");
    assert.ok((await falha(painel.put("/estoque/custos", { margem_alvo: 96 }))).campos.margem_alvo);
    assert.ok((await falha(painel.put("/estoque/custos", { margem_alvo: 50, alerta_alta_pct: 0 }))).campos.alerta_alta_pct);
  });

  it("aplicar o preço sugerido muda o produto na loja e fica registrado", async () => {
    const r = await painel.put(`/estoque/preco-produto/${bolo.id}`, { preco: 12000 });
    assert.equal(r.produto.preco, 12000);
    assert.equal((await visitante.get("/catalogo")).produtos.find((x) => x.id === bolo.id).preco, 12000);
    const p = (await painel.get("/estoque/custos")).produtos[0];
    assert.equal(p.abaixo, false);
    perto(p.margem_pct, 95, 0.05);
    const a = (await painel.get("/auditoria?limite=50")).itens;
    assert.ok(a.some((x) => x.tabela === "produtos" && x.detalhes?.preco));
    assert.ok((await falha(painel.put(`/estoque/preco-produto/${bolo.id}`, { preco: 0 }))).campos.preco);
    assert.equal((await falha(painel.put("/estoque/preco-produto/999999", { preco: 100 }))).status, 404);
    await painel.put(`/estoque/preco-produto/${bolo.id}`, { preco: 8990 });
    await painel.put("/estoque/custos", { margem_alvo: 60, alerta_alta_pct: 5 });
  });
});

describe("lucro real", () => {
  let p1, p2;
  const periodo = () => `de=${dia(0)}&ate=${dia(60)}`;

  it("por padrão olha os últimos 30 dias (pedidos futuros ficam de fora)", async () => {
    p1 = (await cliente.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 2, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "dinheiro" })).pedido;
    const r = await painel.get("/estoque/lucro");
    assert.equal(r.totais.pedidos, 0);
    assert.equal(r.de, dia(-29));
    assert.equal(r.ate, dia(0));
  });

  it("calcula receita, custo e lucro com desconto repartido; item avulso fica sem custo", async () => {
    p2 = (await painel.post("/pedidos", { nome: "Dona Marta", telefone: "11988887777", tipo: "retirada", ...quando, pagamento: "dinheiro", desconto: 500,
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }, { nome: "Topo de bolo personalizado", preco: 6000, qtd: 1 }] })).pedido;
    const r = await painel.get(`/estoque/lucro?${periodo()}`);
    const t = r.totais;
    assert.equal(t.pedidos, 2);
    assert.equal(t.custo, 1800, "3 bolos × R$ 6,00");
    assert.equal(t.receita_sem_custo, 5800, "o topo avulso (R$ 60,00 menos a parte do desconto)");
    perto(t.receita_com_custo, 26670);
    perto(t.receita, 32470);
    perto(t.lucro, 24870);
    perto(t.margem_pct, 93.3, 0.05);
  });

  it("detalha por dia, por produto e por pedido", async () => {
    const r = await painel.get(`/estoque/lucro?${periodo()}`);
    assert.equal(r.serie.length, 1);
    assert.equal(r.serie[0].dia, quando.data);
    perto(r.serie[0].lucro, 24870);

    const b = r.produtos.find((x) => x.produto_id === bolo.id);
    assert.equal(b.qtd, 3);
    assert.equal(b.custo, 1800);
    perto(b.lucro, 24870);
    perto(b.margem_pct, 93.3, 0.05);
    const avulso = r.produtos.find((x) => x.nome === "Topo de bolo personalizado");
    assert.equal(avulso.produto_id, null);
    assert.equal(avulso.margem_pct, null, "sem receita não há margem");
    assert.equal(avulso.lucro, 0);
    assert.equal(r.produtos[0].nome, "Bolo Ninho com Morango", "o mais lucrativo primeiro");

    const o1 = r.pedidos.find((x) => x.codigo === p1.codigo), o2 = r.pedidos.find((x) => x.codigo === p2.codigo);
    assert.equal(o1.parcial, false);
    assert.equal(o2.parcial, true, "tem item sem receita");
    perto(o1.lucro, 16780);
    perto(o2.lucro, 8090);
  });

  it("cancelado não conta; 'só entregues' filtra; muda com o preço do ingrediente", async () => {
    assert.equal((await painel.get(`/estoque/lucro?${periodo()}&so_entregues=true`)).totais.pedidos, 0);
    await painel.patch(`/pedidos/${p2.id}/status`, { status: "cancelado", nota: "teste" });
    assert.equal((await painel.get(`/estoque/lucro?${periodo()}`)).totais.pedidos, 1);
    await editarIng(farinha, { embalagem_preco: 1000 }); // farinha dobra de preço
    assert.equal((await painel.get(`/estoque/lucro?${periodo()}`)).totais.custo, 2 * 800, "2 × (400 g a 2 centavos + 4 ovos)");
    await editarIng(farinha, { embalagem_preco: 500 });
    await painel.patch(`/pedidos/${p1.id}/status`, { status: "cancelado", nota: "teste" }); // limpa a agenda para os próximos testes
  });

  it("valida o período", async () => {
    assert.ok((await falha(painel.get("/estoque/lucro?de=2026-05-10&ate=2026-05-01"))).campos.ate);
    assert.ok((await falha(painel.get("/estoque/lucro?de=2020-01-01&ate=2026-01-01"))).campos.ate);
    assert.equal((await falha(painel.get("/estoque/lucro?de=2026-13-45&ate=2026-14-01"))).status, 422);
    assert.equal((await falha(painel.get("/estoque/lucro?de=abc"))).status, 422);
  });
});

describe("histórico de preço e alta de custo", () => {
  it("guarda cada mudança de preço (cadastro, edição e compra), com a variação", async () => {
    let h = (await painel.get(`/estoque/precos/${farinha.id}`)).precos;
    assert.equal(h.length, 3, "cadastro (500), edição (1000) e volta (500) do teste anterior");
    await editarIng(farinha, { embalagem_preco: 600 });
    await editarIng(farinha, { embalagem_preco: 600, fornecedor: "Outro" });
    await painel.post("/estoque/movimentos", { ingrediente_id: farinha.id, tipo: "compra", embalagens: 2, valor: 1400 });
    h = (await painel.get(`/estoque/precos/${farinha.id}`)).precos;
    assert.equal(h.length, 5, "mudar só o fornecedor não cria linha");
    assert.equal(h[0].embalagem_preco, 700, "R$ 14,00 por 2 pacotes");
    perto(h[0].variacao_pct, 16.7, 0.05);
    assert.equal(h[1].embalagem_preco, 600);
    perto(h[1].variacao_pct, 20, 0.05);
    assert.equal(h.at(-1).variacao_pct, null, "o primeiro preço não tem com o que comparar");
    assert.equal((await falha(painel.get("/estoque/precos/999999"))).status, 404);
  });

  it("avisa os ingredientes que subiram e os produtos afetados, respeitando o limite do alerta", async () => {
    let r = await painel.get("/estoque/custos");
    const f = r.altas.find((a) => a.ingrediente_id === farinha.id);
    assert.ok(f, "a farinha subiu de 0,5 para 0,7 centavo o grama");
    perto(f.variacao_pct, 40, 0.05);
    assert.deepEqual(f.produtos.map((x) => x.nome), ["Bolo Ninho com Morango"]);
    assert.equal(r.altas.some((a) => a.ingrediente_id === ovos.id), false, "ovos não mudaram de preço");
    await painel.put("/estoque/custos", { margem_alvo: 60, alerta_alta_pct: 50 });
    assert.equal((await painel.get("/estoque/custos")).altas.length, 0, "40% não passa do limite de 50%");
    await painel.put("/estoque/custos", { margem_alvo: 60, alerta_alta_pct: 5 });
    await editarIng(farinha, { embalagem_preco: 300 });
    assert.equal((await painel.get("/estoque/custos")).altas.length, 0, "preço que caiu não gera alerta de alta");
    await editarIng(farinha, { embalagem_preco: 500 });
  });
});

describe("aviso de estoque por WhatsApp", () => {
  let pedido;
  const config = { aviso_ativo: true, aviso_telefone: "(11) 91234-5678", aviso_das: 0, aviso_ate: 24 };

  it("nasce desligado e valida o que a dona informa", async () => {
    const c = await configAviso();
    assert.equal(c.aviso_ativo, false);
    assert.equal(c.aviso_modelo, "estoque_alerta");
    assert.equal(c.avisos.length, 0);
    assert.deepEqual((await avisar()).corpo, { enviado: false, motivo: "desligado" });
    assert.ok((await falha(painel.put("/estoque/aviso", { ...config, aviso_telefone: "" }))).campos.aviso_telefone);
    assert.ok((await falha(painel.put("/estoque/aviso", { ...config, aviso_modelo: "Nome Ruim" }))).campos.aviso_modelo);
    assert.ok((await falha(painel.put("/estoque/aviso", { ...config, aviso_das: 20, aviso_ate: 10 }))).campos.aviso_ate);
    assert.equal((await configAviso()).aviso_ativo, false, "config recusada não muda nada");
  });

  it("ligado, sem nada em risco não manda", async () => {
    await painel.put("/estoque/aviso", config);
    assert.equal((await configAviso()).aviso_telefone, "11912345678");
    assert.deepEqual((await avisar()).corpo, { enviado: false, motivo: "nada" });
    assert.equal(ext.estado.metaEnvios.length, 0);
  });

  it("quando algo vai faltar, manda o modelo com o nome e o resumo, e registra", async () => {
    pedido = (await cliente.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 3, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "dinheiro" })).pedido;
    const r = await avisar();
    assert.deepEqual(r.corpo, { enviado: true });
    const envio = ext.estado.metaEnvios[0];
    assert.equal(envio.corpo.to, "5511912345678");
    assert.equal(envio.corpo.template.name, "estoque_alerta");
    const ps = envio.corpo.template.components[0].parameters.map((x) => x.text);
    assert.equal(ps.length, 2);
    assert.equal(ps[0], "Administrador");
    assert.match(ps[1], /vão faltar: Ovos/, "3 bolos usam 12 ovos e só há 6");
    const c = await configAviso();
    assert.equal(c.avisos[0].estado, "enviado");
    assert.match(c.avisos[0].detalhe, /^wamid\./);
    assert.match(c.avisos[0].resumo, /Ovos/);
  });

  it("não repete: espera uma hora e só volta a avisar por algo novo ou no dia seguinte", async () => {
    assert.equal((await avisar()).corpo.motivo, "aguardando");
    await liberarAviso();
    assert.equal((await avisar()).corpo.motivo, "ja_avisado");
    assert.equal(ext.estado.metaEnvios.length, 1);

    // um segundo ingrediente passa a estar abaixo do mínimo: aviso novo
    await editarIng(farinha, { minimo: 999999 });
    await liberarAviso();
    const r = await avisar();
    assert.equal(r.corpo.enviado, true);
    const texto = ext.estado.metaEnvios[1].corpo.template.components[0].parameters[1].text;
    assert.match(texto, /vão faltar: Ovos/);
    assert.match(texto, /abaixo do mínimo: Farinha de trigo/);
    await editarIng(farinha, { minimo: 0 });

    // no dia seguinte, mesmo sem novidade, lembra de novo
    await liberarAviso(", aviso_ultimo_em = now() - interval '2 days'");
    assert.equal((await avisar()).corpo.enviado, true);
    assert.equal(ext.estado.metaEnvios.length, 3);
  });

  it("respeita o horário escolhido e o desligar", async () => {
    const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date())) % 24;
    const das = (h + 2) % 24;
    await painel.put("/estoque/aviso", { ...config, aviso_das: das, aviso_ate: das + 1 });
    await liberarAviso(", aviso_ultimo_em = now() - interval '2 days'");
    assert.equal((await avisar()).corpo.motivo, "fora_do_horario");
    await painel.put("/estoque/aviso", { ...config, aviso_ativo: false });
    assert.equal((await avisar()).corpo.motivo, "desligado");
    await painel.put("/estoque/aviso", config);
  });

  it("erro da Meta vira frase em português, fica no histórico e espera uma hora antes de tentar de novo", async () => {
    await liberarAviso(", aviso_ultimo_em = now() - interval '2 days'");
    ext.estado.falhas.meta = { code: 132001, message: "Template name does not exist" };
    const r = await avisar();
    assert.equal(r.corpo.enviado, false);
    assert.match(r.corpo.erro, /modelo de mensagem não existe/);
    ext.estado.falhas.meta = null;
    const c = await configAviso();
    assert.equal(c.avisos[0].estado, "erro");
    assert.match(c.avisos[0].detalhe, /modelo de mensagem não existe/);
    assert.equal((await avisar()).corpo.motivo, "aguardando");
  });

  it("ligado sem as chaves no Supabase: explica e registra o erro (sem ficar tentando toda hora)", async () => {
    await liberarAviso(", aviso_ultimo_em = now() - interval '2 days'");
    const r = await avisar(null, { ...deps, env: { ...env, WHATSAPP_TOKEN: "" } });
    assert.equal(r.status, 503);
    assert.match((await configAviso()).avisos[0].detalhe, /ainda não foi configurado/);
    assert.equal((await avisar()).corpo.motivo, "aguardando");
  });

  it("atividade: ligar/desligar e o telefone ficam no registro; os envios não", async () => {
    const a = (await painel.get("/auditoria?limite=200")).itens.filter((x) => x.tabela === "estoque_config");
    assert.ok(a.some((x) => x.detalhes.aviso_ativo));
    assert.ok(a.some((x) => x.detalhes.margem_alvo));
    assert.ok(!a.some((x) => x.detalhes.aviso_ultimo_em || x.detalhes.aviso_tentativa_em || x.detalhes.aviso_itens), "as datas de envio não poluem a atividade");
    await painel.patch(`/pedidos/${pedido.id}/status`, { status: "cancelado", nota: "fim" });
  });
});
