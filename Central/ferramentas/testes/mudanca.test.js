/* ==========================================================
   MUDANÇA PARA O BANCO ÚNICO — uma loja de projeto próprio, com
   dados de verdade, muda para um banco único que JÁ TEM outra loja:
     - começar exige o código; o banco único precisa estar pronto;
     - vem tudo: cardápio, pedidos (com os itens e pagamentos),
       estoque (sem duplicar o histórico de preço), clientes, logins
       (mesma senha; e-mail que já existia vira a mesma conta), fotos;
     - os números mudam sem bater nos da outra loja, e as ligações
       acompanham; o sinal combinado do pedido não é recalculado;
     - os MESMOS endereços (vercel.app e domínio próprio) passam para
       os sites do banco único; os sites antigos saem;
     - os pedidos voltam a entrar; pagamento online fica para
       reconectar; o cadastro da cliente acompanha;
     - o banco antigo fica guardado e pode ser excluído depois.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

let sim, banco, servidor, base, cookie, bia, unico, idAna, principal, clienteId;
const q = async (ref, texto, params) => (await sim.estado.projetos.get(ref).db.query(texto, params)).rows;

async function api(metodo, caminho, corpo) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo, headers: { ...(corpo !== undefined && { "content-type": "application/json" }), cookie },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, texto };
}
const site = (nome) => [...sim.estado.sites.values()].find((s) => s.nome === nome);
const dominiosDo = (nome) => [...(site(nome)?.dominios?.keys() ?? [])].sort();
async function ate(caminho, corpo, pronto) {
  let r;
  for (let i = 0; i < 80; i++) { r = await api("POST", caminho, corpo); assert.equal(r.status, 200, r.texto); if (pronto(r.dados)) return r.dados; }
  assert.fail(`não terminou: ${caminho}`);
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

  // 1. uma loja antiga, com projeto próprio, publicada e com domínio próprio
  bia = (await api("POST", "lojas", { nome: "Doce da Bia", email: "bia@doceria.test" })).dados;
  await ate(`lojas/${bia.ref}/preparar`, { email: "bia@doceria.test" }, (d) => d.etapa !== "tabelas");
  await api("POST", `lojas/${bia.ref}/publicar`, {});
  sim.configurarDns("docedabia.com.br", "www.docedabia.com.br", "painel.docedabia.com.br");
  assert.equal((await api("POST", `lojas/${bia.ref}/dominio`, { dominio: "docedabia.com.br" })).dados.endereco_loja, "https://docedabia.com.br");

  // ... com dados: dona, cliente, cardápio, estoque, pedido pago, foto e pagamento online ligado
  const A = bia.ref;
  principal = (await q(A, "select id from public.lojas"))[0].id;
  await q(A, "insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('bia@doceria.test', 'hash-da-bia', '{\"nome\":\"Bia\"}'), ('carla@teste.com', 'hash-velho-da-carla', '{\"nome\":\"Carla\"}')");
  await q(A, "update public.perfis set papel = 'admin' where email = 'bia@doceria.test'");
  const [cat] = await q(A, "insert into public.categorias (nome) values ('Bolos') returning id");
  const foto = `https://${A}.supabase.co/storage/v1/object/public/produtos/${principal}/bolo.png`;
  const [prod] = await q(A, "insert into public.produtos (categoria_id, nome, preco, imagem) values ($1, 'Bolo de Pote', 1500, $2) returning id", [cat.id, foto]);
  const [ing] = await q(A, "insert into public.ingredientes (nome, unidade, embalagem_qtd, embalagem_preco) values ('Leite', 'ml', 1000, 800) returning id");
  const [carla] = await q(A, "select id from public.perfis where email = 'carla@teste.com'");
  const [ped] = await q(A, `insert into public.pedidos (usuario_id, cliente_nome, tipo, data_agendada, hora_agendada, pagamento, subtotal, total, sinal)
    values ($1, 'Carla', 'retirada', current_date + 3, '10:00', 'pix', 1500, 1500, 777) returning id`, [carla.id]);
  await q(A, "update public.pedidos set codigo = 'LA' || id, sinal = 777 where id = $1", [ped.id]); // o sinal combinado com a cliente
  await q(A, "update public.lojas set ultimo_pedido = $1", [ped.id]);
  await q(A, "insert into public.pedido_itens (pedido_id, produto_id, nome, unidade, preco_unit, qtd, total) values ($1, $2, 'Bolo de Pote', 'un', 1500, 1, 1500)", [ped.id, prod.id]);
  await q(A, "insert into public.pagamentos_pedido (pedido_id, valor, forma, usuario_id) values ($1, 500, 'pix', $2)", [ped.id, carla.id]);
  await q(A, "insert into public.favoritos (usuario_id, produto_id) values ($1, $2)", [carla.id, prod.id]);
  await q(A, "insert into storage.buckets (id, name, public) values ('produtos', 'produtos', true), ('site', 'site', true) on conflict do nothing");
  await q(A, "insert into storage.objects (bucket_id, name) values ('produtos', $1)", [`${principal}/bolo.png`]);
  sim.estado.arquivos.set(`${A}/produtos/${principal}/bolo.png`, { tipo: "image/png", bytes: Buffer.from("foto-do-bolo") });
  await api("POST", `lojas/${A}/pagamento`, { token: `APP_USR-${"1".repeat(30)}` });
  bia.antes = { ingrediente: ing.id, precos: (await q(A, "select count(*)::int n from public.ingrediente_precos"))[0].n, pedido: ped.id };

  // a cliente dona dela no cadastro da Central
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
  clienteId = (await api("POST", "clientes", { nome: "Bia Lima", email: "bia@doceria.test", nome_loja: "Doce da Bia", valor_centavos: 19900 })).dados.cliente.id;
  await banco.consultar("update clientes set loja_ref = $2, loja_url = 'https://docedabia.com.br' where id = $1", [clienteId, A]);

  // 2. o banco único, já com outra loja (Ana) que tem os seus números e uma cliente com o MESMO e-mail da Carla
  await ate("banco-unico/preparar", {}, (d) => d.etapa === "pronto" && !d.aplicada);
  unico = [...sim.estado.projetos.values()].find((p) => p.nome === "Forminha · Lojas").ref;
  const ana = (await api("POST", "lojas", { nome: "Ana Doces", email: "ana@doceria.test" })).dados;
  await ate(`lojas/${ana.ref}/preparar`, { email: "ana@doceria.test" }, (d) => d.etapa !== "tabelas");
  await api("POST", `lojas/${ana.ref}/publicar`, {});
  idAna = (await q(unico, "select id from public.lojas where codigo = $1", [ana.ref]))[0].id;
  for (let i = 0; i < 3; i++) await q(unico, "insert into public.categorias (loja_id, nome) values ($1, $2)", [idAna, `Da Ana ${i}`]);
  await q(unico, "insert into auth.users (email, encrypted_password) values ('carla@teste.com', 'hash-atual-da-carla')");
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("mudar para o banco único", () => {
  it("começar exige o código da loja", async () => {
    const r = await api("POST", `lojas/${bia.ref}/mudar`, { codigo: "errado" });
    assert.equal(r.status, 422);
    assert.ok(r.dados.campos.codigo);
  });

  it("vai por etapas até ficar pronta", async () => {
    const etapas = new Set();
    let d;
    for (let i = 0; i < 80; i++) {
      const r = await api("POST", `lojas/${bia.ref}/mudar`, { codigo: bia.codigo });
      assert.equal(r.status, 200, r.texto);
      d = r.dados;
      etapas.add(d.etapa);
      if (d.etapa === "pronta") break;
    }
    assert.equal(d.etapa, "pronta");
    assert.ok(["dados", "fotos", "pronta"].every((e) => etapas.has(e)), [...etapas].join(","));
    assert.deepEqual(d.reconectar, ["pagamento"]);
    assert.equal(d.loja, "https://docedabia.com.br", "o endereço principal continua o mesmo");
    bia.nova = (await q(unico, "select id, prefixo_pedido, ultimo_pedido from public.lojas where codigo = $1", [bia.codigo]))[0];
  });

  it("veio tudo, com as ligações certas e sem bater nos números da Ana", async () => {
    const id = bia.nova.id;
    const [p] = await q(unico, "select id, nome, imagem from public.produtos where loja_id = $1", [id]);
    assert.equal(p.nome, "Bolo de Pote");
    assert.equal(p.imagem, `https://${unico}.supabase.co/storage/v1/object/public/produtos/${id}/${principal}/bolo.png`, "a foto aponta para a pasta da loja");
    const itens = await q(unico, `select i.nome from public.pedido_itens i join public.pedidos pe on pe.loja_id = i.loja_id and pe.id = i.pedido_id
      join public.produtos pr on pr.loja_id = i.loja_id and pr.id = i.produto_id where i.loja_id = $1`, [id]);
    assert.deepEqual(itens.map((x) => x.nome), ["Bolo de Pote"]);
    const [pe] = await q(unico, "select codigo, sinal, pago from public.pedidos where loja_id = $1", [id]);
    assert.equal(pe.codigo, `LA${bia.antes.pedido}`, "o código do pedido não muda");
    assert.equal(pe.sinal, 777, "o sinal combinado não é recalculado");
    assert.equal((await q(unico, "select count(*)::int n from public.pagamentos_pedido where loja_id = $1", [id]))[0].n, 1);
    assert.equal((await q(unico, "select count(*)::int n from public.ingrediente_precos where loja_id = $1", [id]))[0].n, bia.antes.precos, "o histórico de preço não duplica");
    assert.equal((await q(unico, "select count(*)::int n from public.categorias where loja_id = $1", [idAna]))[0].n, 3, "a Ana não foi mexida");
    assert.deepEqual([bia.nova.prefixo_pedido, Number(bia.nova.ultimo_pedido)], ["LA", bia.antes.pedido], "os pedidos novos continuam a numeração");
  });

  it("logins: a dona com a mesma senha; o e-mail que já existia vira a mesma conta", async () => {
    const id = bia.nova.id;
    const [dona] = await q(unico, "select u.encrypted_password s, p.papel from public.perfis p join auth.users u on u.id = p.id where p.loja_id = $1 and p.email = 'bia@doceria.test'", [id]);
    assert.deepEqual([dona.s, dona.papel], ["hash-da-bia", "admin"]);
    const carlas = await q(unico, "select id from auth.users where email = 'carla@teste.com'");
    assert.equal(carlas.length, 1, "não duplicou a conta");
    const [perfil] = await q(unico, "select id from public.perfis where loja_id = $1 and email = 'carla@teste.com'", [id]);
    assert.equal(perfil.id, carlas[0].id);
    const [fav] = await q(unico, "select usuario_id from public.favoritos where loja_id = $1", [id]);
    assert.equal(fav.usuario_id, carlas[0].id, "o favorito acompanha a conta");
  });

  it("fotos copiadas para a pasta da loja", () => {
    const f = sim.estado.arquivos.get(`${unico}/produtos/${bia.nova.id}/${principal}/bolo.png`);
    assert.equal(f?.bytes.toString(), "foto-do-bolo");
  });

  it("os mesmos endereços agora nos sites do banco único; os sites antigos saíram", async () => {
    assert.equal(site("doce-da-bia"), undefined);
    assert.equal(site("doce-da-bia-painel"), undefined);
    assert.ok(dominiosDo("forminha-lojas").includes("doce-da-bia.vercel.app"));
    assert.ok(dominiosDo("forminha-lojas").includes("docedabia.com.br"));
    assert.ok(dominiosDo("forminha-paineis").includes("doce-da-bia-painel.vercel.app"));
    assert.ok(dominiosDo("forminha-paineis").includes("painel.docedabia.com.br"));
    const hosts = (await q(unico, "select host from public.loja_enderecos where loja_id = $1 order by host", [bia.nova.id])).map((x) => x.host);
    assert.ok(hosts.includes("docedabia.com.br") && hosts.includes("doce-da-bia.vercel.app"));
    assert.match(sim.estado.projetos.get(unico).auth.uri_allow_list, /https:\/\/docedabia\.com\.br\/\*\*/);
    const [{ endereco }] = await q(unico, "select endereco from public.lojas where id = $1", [bia.nova.id]);
    assert.equal(endereco, "https://docedabia.com.br");
  });

  it("pedidos voltam a entrar; pagamento online fica para reconectar", async () => {
    const id = bia.nova.id;
    const [ped] = await q(unico, "select valor from public.configuracoes where loja_id = $1 and chave = 'pedidos'", [id]);
    assert.equal(ped.valor.pausados, false);
    const [g] = await q(unico, "select valor from public.configuracoes where loja_id = $1 and chave = 'gateway'", [id]);
    assert.deepEqual([g.valor.ativo, g.valor.cartao, "segredo_hash" in g.valor], [false, false, false]);
    const [ficha] = await q(unico, "select valor from public.configuracoes where loja_id = $1 and chave = 'forminha'", [id]);
    assert.equal(ficha.valor.loja.id, site("forminha-lojas").id);
    assert.equal("migracao" in ficha.valor, false);
    const [velha] = await q(bia.ref, "select valor from public.configuracoes where chave = 'pedidos'");
    assert.equal(velha.valor.pausados, true, "a loja antiga fica parada (não recebe pedido no lugar errado)");
  });

  it("a Central acompanha: cadastro da cliente, lista e o banco antigo para excluir", async () => {
    const c = (await banco.consultar("select loja_ref from clientes where id = $1", [clienteId]))[0];
    assert.equal(c.loja_ref, bia.codigo);
    const lista = (await api("GET", "lojas")).dados.lojas;
    assert.equal(lista.find((l) => l.ref === bia.ref).etapa, "migrada");
    const nova = lista.find((l) => l.ref === bia.codigo);
    assert.deepEqual([nova.etapa, nova.banco_unico, nova.loja], ["pronta", true, "https://docedabia.com.br"]);
    assert.equal((await api("POST", `lojas/${bia.ref}/mudar`, {})).dados.etapa, "pronta", "chamar de novo não refaz nada");
    const r = await api("DELETE", `lojas/${bia.ref}`, { codigo: bia.codigo });
    assert.equal(r.status, 200, r.texto);
    assert.equal(sim.estado.projetos.has(bia.ref), false, "o banco antigo foi excluído");
    assert.equal((await api("GET", "lojas")).dados.lojas.find((l) => l.ref === bia.codigo)?.etapa, "pronta", "a loja nova continua");
  });
});
