/* ==========================================================
   BANCO ÚNICO — a Central cria lojas num projeto Supabase só.
     - preparado uma vez, por etapas: o projeto, as tabelas e os DOIS
       sites de todas as lojas (com MULTILOJA=1);
     - loja nova = uma linha no banco: pronta em segundos, com os seus
       endereços (nome.vercel.app e nome-painel.vercel.app) nos sites de
       todas as lojas, registrados no banco e aceitos pelo login;
     - nome repetido ganha outro endereço; endereço de uma loja não vai
       para outra;
     - convite, cópia (só os dados da loja), a dona pelo painel (pelo
       endereço), a criação automática depois do pagamento, excluir;
     - o serviço diário mantém o banco único acordado.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { PADRAO_CODIGO } from "../../lib/codigo.js";
import { comParametros, prefixoDosPedidos } from "../../lib/banco-unico.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

let sim, banco, servidor, base, cookie, unico, bia, bia2;

async function api(metodo, caminho, corpo, { semCookie = false, cabecalhos = {} } = {}) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(!semCookie && cookie && { cookie }), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, texto };
}
const site = (nome) => [...sim.estado.sites.values()].find((s) => s.nome === nome);
const dominiosDo = (nome) => [...(site(nome).dominios?.keys() ?? [])].sort();
const db = () => sim.estado.projetos.get(unico).db;
const q = async (texto, params) => (await db().query(texto, params)).rows;

async function lojaPronta(nome, email) {
  const loja = (await api("POST", "lojas", { nome, email })).dados;
  let r;
  for (let i = 0; i < 60; i++) { r = await api("POST", `lojas/${loja.ref}/preparar`, { email }); if (r.dados.etapa !== "tabelas") break; }
  assert.equal(r.status, 200, r.texto);
  const p = await api("POST", `lojas/${loja.ref}/publicar`, {});
  assert.equal(p.status, 200, p.texto);
  return { ...loja, ...p.dados };
}

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_SENHA_HASH: await resumirSenha("senha-do-dono"), SEGREDO_SESSAO: "s".repeat(48), CRON_SECRET: "cron",
    CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, email: null, mercadoPago: null, esperaBancoMs: 1, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cookie = (await fetch(`${base}/api/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: "senha-do-dono" }) }))
    .headers.get("set-cookie").split(";")[0];
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("peças", () => {
  it("valores entram no SQL com as aspas certas (e $10 não vira $1)", () => {
    assert.equal(comParametros("select $1, $2, $10", ["it's", null, 5, 6, 7, 8, 9, 10, 11, true]), "select 'it''s', null, true");
    assert.equal(comParametros("select $1::jsonb", [JSON.stringify({ a: "b'c" })]), `select '{"a":"b''c"}'::jsonb`);
  });
  it("prefixo dos pedidos: as iniciais do nome", () => {
    assert.equal(prefixoDosPedidos("Doce da Bia"), "DB");
    assert.equal(prefixoDosPedidos("Ana"), "AN");
    assert.equal(prefixoDosPedidos("Açúcar & Afeto Confeitaria"), "AAC");
    assert.equal(prefixoDosPedidos("!!"), "P");
  });
});

describe("preparar o banco único", () => {
  it("antes de preparar, nada muda", async () => {
    assert.equal((await api("GET", "banco-unico")).dados.etapa, "nao_preparado");
    assert.equal((await api("POST", "banco-unico/preparar", {}, { semCookie: true })).status, 401);
  });

  it("prepara por etapas: projeto, tabelas, os 2 sites de todas as lojas e o login", async () => {
    let r;
    for (let i = 0; i < 80; i++) {
      r = await api("POST", "banco-unico/preparar", {});
      assert.equal(r.status, 200, r.texto);
      if (r.dados.etapa === "pronto") break;
    }
    assert.equal(r.dados.etapa, "pronto");
    assert.equal(r.dados.feitas, r.dados.total);
    const projetos = [...sim.estado.projetos.values()];
    assert.deepEqual(projetos.map((p) => p.nome), ["Forminha · Lojas"]);
    unico = projetos[0].ref;
    for (const [nome, pasta] of [["forminha-lojas", "Loja"], ["forminha-paineis", "Dashboard"]]) {
      assert.equal(site(nome).pasta, pasta);
      assert.equal(site(nome).variaveis.MULTILOJA, "1");
      assert.equal(site(nome).variaveis.SUPABASE_URL, `https://${unico}.supabase.co`);
    }
    assert.equal(site("forminha-paineis").variaveis.URL_CENTRAL, "https://forminha.vercel.app");
    assert.equal(sim.estado.publicacoes.length, 2);
    assert.deepEqual(await q("select codigo from public.lojas"), [], "a loja 'principal' dos bancos antigos não fica");
    assert.equal(sim.estado.projetos.get(unico).auth.mailer_autoconfirm, true);
  });
});

describe("lojas no banco único", () => {
  it("loja nova: uma linha no banco, pronta em segundos, com os seus endereços", async () => {
    bia = await lojaPronta("Doce da Bia", "bia@doceria.test");
    assert.match(bia.ref, PADRAO_CODIGO, "o ref da loja do banco único é o código");
    assert.equal(bia.loja, "https://doce-da-bia.vercel.app");
    assert.equal(bia.painel, "https://doce-da-bia-painel.vercel.app");
    assert.equal(sim.estado.projetos.size, 1, "nenhum projeto novo no Supabase");
    assert.equal(sim.estado.sites.size, 2, "nenhum site novo na Vercel");
    assert.deepEqual(dominiosDo("forminha-lojas"), ["doce-da-bia.vercel.app"]);
    assert.deepEqual(dominiosDo("forminha-paineis"), ["doce-da-bia-painel.vercel.app"]);
    const [l] = await q("select id, prefixo_pedido from public.lojas where codigo = $1", [bia.codigo]);
    assert.equal(l.prefixo_pedido, "DB");
    assert.deepEqual((await q("select host from public.loja_enderecos where loja_id = $1 order by host", [l.id])).map((e) => e.host),
      ["doce-da-bia-painel.vercel.app", "doce-da-bia.vercel.app"]);
    const semeada = await q("select valor ->> 'nome' as nome from public.configuracoes where loja_id = $1 and chave = 'loja'", [l.id]);
    assert.equal(semeada[0].nome, "Doce da Bia");
    assert.match(sim.estado.projetos.get(unico).auth.uri_allow_list, /https:\/\/doce-da-bia\.vercel\.app\/\*\*/);
  });

  it("outra loja com o mesmo nome ganha outro endereço (o primeiro já é da Bia)", async () => {
    bia2 = await lojaPronta("Doce da Bia", "bia2@doceria.test");
    assert.notEqual(bia2.loja, bia.loja);
    assert.match(bia2.loja, /^https:\/\/doce-da-bia-[a-z0-9]+\.vercel\.app$/);
    assert.equal(bia2.painel, bia2.loja.replace(".vercel.app", "-painel.vercel.app"), "o painel segue a regra do -painel");
  });

  it("endereço já usado por outra conta na Vercel: tenta o próximo", async () => {
    sim.estado.tomados.add("ana-doces.vercel.app");
    const ana = await lojaPronta("Ana Doces", "ana@doceria.test");
    assert.match(ana.loja, /^https:\/\/ana-doces-[a-z0-9]+\.vercel\.app$/);
  });

  it("a lista mostra as lojas do banco único prontas", async () => {
    const lista = (await api("GET", "lojas")).dados.lojas;
    const minha = lista.find((l) => l.ref === bia.ref);
    assert.deepEqual([minha.etapa, minha.banco_unico, minha.loja, minha.painel], ["pronta", true, bia.loja, bia.painel]);
  });

  it("convite: link do painel da loja, guardado no banco DELA", async () => {
    const r = await api("POST", `lojas/${bia.ref}/convite`, { email: "bia@doceria.test" });
    assert.equal(r.status, 200, r.texto);
    assert.match(r.dados.link, /^https:\/\/doce-da-bia-painel\.vercel\.app\/#\/convite\/[a-f0-9]{64}$/);
    const [l] = await q("select id from public.lojas where codigo = $1", [bia.ref]);
    assert.equal((await q("select count(*)::int n from public.convites where loja_id = $1", [l.id]))[0].n, 1);
  });

  it("cópia de segurança: só os dados da própria loja", async () => {
    const [b2] = await q("select id from public.lojas where codigo = $1", [bia2.ref]);
    await q("insert into public.categorias (loja_id, nome) values ($1, 'Só da Bia 2')", [b2.id]);
    const r = await api("GET", `lojas/${bia.ref}/backup`);
    assert.equal(r.status, 200, r.texto);
    assert.ok(!("lojas" in r.dados.tabelas), "a lista de lojas não entra");
    assert.ok(!r.dados.tabelas.categorias.some((c) => c.nome === "Só da Bia 2"), "nada de outra loja");
    assert.ok(r.dados.tabelas.configuracoes.length > 0);
    assert.ok(r.dados.tabelas.configuracoes.every((c) => c.loja_id === r.dados.tabelas.configuracoes[0].loja_id));
  });

  it("a dona chama a Central pelo painel: a loja vem do endereço", async () => {
    const token = sim.tokenDaLoja(unico, "admin", bia.ref);
    const comEndereco = await api("GET", "loja/dominio", undefined, { semCookie: true, cabecalhos: { authorization: `Bearer ${token}`, "x-loja": "doce-da-bia-painel.vercel.app" } });
    assert.equal(comEndereco.status, 200, comEndereco.texto);
    assert.equal(comEndereco.dados.endereco_loja, bia.loja);
    const semEndereco = await api("GET", "loja/dominio", undefined, { semCookie: true, cabecalhos: { authorization: `Bearer ${token}` } });
    assert.equal(semEndereco.status, 401);
    const outraLoja = await api("GET", "loja/dominio", undefined, { semCookie: true, cabecalhos: { authorization: `Bearer ${token}`, "x-loja": new URL(bia2.painel).host } });
    assert.equal(outraLoja.status, 403, "a dona da Bia não mexe na loja da Bia 2");
  });

  it("domínio próprio de uma loja não vai para outra", async () => {
    sim.configurarDns("docedabia.com.br", "www.docedabia.com.br", "painel.docedabia.com.br");
    const r = await api("POST", `lojas/${bia.ref}/dominio`, { dominio: "docedabia.com.br" });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.dados.endereco_loja, "https://docedabia.com.br");
    assert.ok((await q("select 1 from public.loja_enderecos where host = 'docedabia.com.br'")).length, "o banco reconhece o domínio");
    const outra = await api("POST", `lojas/${bia2.ref}/dominio`, { dominio: "docedabia.com.br" });
    assert.equal(outra.status, 409);
    assert.match(outra.dados.erro, /outra loja/);
  });

  it("pagamento online: avisa que chega na próxima atualização", async () => {
    const r = await api("POST", `lojas/${bia.ref}/pagamento`, { token: `APP_USR-${"1".repeat(30)}` });
    assert.equal(r.status, 409);
  });

  it("o serviço diário mantém o banco único acordado", async () => {
    const antes = sim.estado.cutucadas.filter((r) => r === unico).length;
    const r = await api("GET", "manter-ativo", undefined, { semCookie: true, cabecalhos: { authorization: "Bearer cron" } });
    assert.equal(r.status, 200, r.texto);
    assert.equal(sim.estado.cutucadas.filter((x) => x === unico).length, antes + 1);
  });

  it("excluir: a loja some do banco e dos sites; as outras continuam", async () => {
    const [b2] = await q("select id from public.lojas where codigo = $1", [bia2.ref]);
    const hosts = [new URL(bia2.loja).host, new URL(bia2.painel).host];
    const r = await api("DELETE", `lojas/${bia2.ref}`, { codigo: bia2.codigo });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(await q("select 1 from public.lojas where id = $1", [b2.id]), []);
    assert.deepEqual(await q("select 1 from public.categorias where loja_id = $1", [b2.id]), [], "os dados foram junto");
    for (const h of hosts) assert.ok(!dominiosDo("forminha-lojas").includes(h) && !dominiosDo("forminha-paineis").includes(h));
    assert.ok(!sim.estado.projetos.get(unico).auth.uri_allow_list.includes(hosts[0]));
    assert.ok((await api("GET", "lojas")).dados.lojas.some((l) => l.ref === bia.ref), "a Bia continua");
  });
});

describe("criação automática depois do pagamento", () => {
  it("a cliente paga e a loja nasce no banco único", async () => {
    await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
    const id = (await api("POST", "clientes", { nome: "Carla Souza", email: "carla@doceria.test", nome_loja: "Doces da Carla", valor_centavos: 19900 })).dados.cliente.id;
    assert.equal((await api("POST", `clientes/${id}/pagamento-recebido`, {})).status, 200);
    let c;
    for (let i = 0; i < 60; i++) {
      const r = await api("POST", `clientes/${id}/avancar`, {});
      assert.equal(r.status, 200, r.texto);
      c = r.dados.cliente;
      if (c.etapa === "pronta") break;
    }
    assert.equal(c.etapa, "pronta");
    assert.match(c.loja_ref, PADRAO_CODIGO);
    assert.equal(c.loja_url, "https://doces-da-carla.vercel.app");
    assert.equal(sim.estado.projetos.size, 1, "continua um banco só");
  });
});
