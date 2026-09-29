/* ==========================================================
   MULTILOJA — duas lojas no MESMO banco (migração 24).
     - cada loja vê só a própria configuração, cardápio e pedidos,
       seja pelo código, seja pelo endereço no cabeçalho x-loja;
     - a administradora de uma loja não administra a outra;
     - trocar o cabeçalho não mostra pedidos nem dados de outra loja;
     - uma conta só serve nas duas lojas (o perfil nasce no 1º acesso);
     - cada loja tem a sua numeração de pedidos;
     - ligações entre tabelas não cruzam lojas;
     - apagar a conta numa loja não apaga o login da outra;
     - imagens: cada loja na sua pasta;
     - estrutura: toda tabela com loja, toda função no papel certo
       (protege as próximas migrações).
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";

const BIA = { codigo: "x6u-BC4-4Bz", nome: "Doce da Bia", prefixo: "DB", enderecos: ["bia.forminha.test", "bia-painel.forminha.test"] };
let emu, idA, idB;
/** Um navegador de uma loja: o site manda a loja (código ou endereço) em todas as chamadas. */
const navegador = (loja) => createClient(emu.url, emu.chaveAnon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { "x-loja": loja } },
});
const lojaDe = (loja) => criarApiLoja(navegador(loja));
const painelDe = (loja) => criarApiPainel(navegador(loja));
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const q = async (texto, params) => (await emu.db.query(texto, params)).rows;

let painelA, painelB, visitanteA, visitanteB, quando;

async function horarioLivre(visitante) {
  const cfg = await visitante.get("/config");
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[0] };
  }
  throw new Error("sem horário");
}

before(async () => {
  emu = await iniciarEmulador({ exemplo: true }); // a loja "principal" já vem com o cardápio de exemplo
  idA = (await q("select id from public.lojas where codigo = 'principal'"))[0].id;
  idB = await emu.criarLoja(BIA);
  await emu.criarAdmin("dona.a@teste.local", "Admin12345", { loja: "principal" });
  await emu.criarAdmin("dona.b@teste.local", "Admin12345", { loja: BIA.codigo });
  painelA = painelDe("principal");
  await painelA.post("/auth/entrar", { email: "dona.a@teste.local", senha: "Admin12345" });
  painelB = painelDe("bia-painel.forminha.test");
  await painelB.post("/auth/entrar", { email: "dona.b@teste.local", senha: "Admin12345" });
  visitanteA = lojaDe("principal");
  visitanteB = lojaDe("bia.forminha.test");
  quando = await horarioLivre(visitanteA);
});
after(async () => { await emu?.fechar(); });

describe("cada loja no seu canto", () => {
  it("sem dizer a loja, um banco com várias lojas não responde nada", async () => {
    const e = await falha(criarApiLoja(createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false } })).get("/config"));
    assert.equal(e.status, 404);
    assert.match(e.message, /Loja não encontrada/);
    assert.equal((await falha(lojaDe("loja-que-nao-existe.test").get("/config"))).status, 404);
  });

  it("a loja nova nasce com os dados iniciais e o cardápio vazio", async () => {
    const cfg = await visitanteB.get("/config");
    assert.equal(cfg.loja.nome, "Minha Doceria");
    assert.equal((await visitanteB.get("/catalogo")).produtos.length, 0);
    assert.ok((await visitanteA.get("/catalogo")).produtos.length > 0, "a outra loja continua com o cardápio dela");
  });

  it("a aparência de uma não muda a da outra (pelo código ou pelo endereço)", async () => {
    await painelA.put("/configuracoes/aparencia", { tema: "pistache", fonte: "delicado" });
    await painelB.put("/configuracoes/aparencia", { tema: "menta", fonte: "moderno" });
    assert.equal((await visitanteA.get("/config")).aparencia.tema, "pistache");
    assert.equal((await visitanteB.get("/config")).aparencia.tema, "menta");
    assert.equal((await lojaDe(BIA.codigo).get("/config")).aparencia.tema, "menta", "o código e o endereço levam à mesma loja");
  });

  it("cardápio: cada painel só vê e só mexe no que é seu", async () => {
    const cat = (await painelB.post("/categorias", { nome: "Bolos da Bia", emoji: "🎂", ativa: true })).categoria ?? (await painelB.get("/categorias")).categorias[0];
    const r = await painelB.post("/produtos", { categoria_id: cat.id, nome: "Bolo da Bia", descricao: "", preco: 4500, unidade: "bolo", min_qtd: 1, emoji: "🎂", ativo: true, destaque: false });
    assert.equal(r.produto.nome, "Bolo da Bia");
    assert.deepEqual((await visitanteB.get("/catalogo")).produtos.map((p) => p.nome), ["Bolo da Bia"]);
    assert.ok(!(await visitanteA.get("/catalogo")).produtos.some((p) => p.nome === "Bolo da Bia"));
    assert.ok(!(await painelA.get("/produtos")).produtos.some((p) => p.id === r.produto.id));
    // a dona A tenta editar e apagar o produto da B pelo número
    assert.ok((await falha(painelA.put(`/produtos/${r.produto.id}`, { categoria_id: cat.id, nome: "Invadido", preco: 1, unidade: "x", min_qtd: 1, emoji: "x", ativo: true, destaque: false }))).status >= 400);
    await painelA.del?.(`/produtos/${r.produto.id}`).catch(() => {});
    assert.deepEqual((await visitanteB.get("/catalogo")).produtos.map((p) => p.nome), ["Bolo da Bia"]);
  });

  it("produto não aponta para a categoria de outra loja", async () => {
    const catA = (await painelA.get("/categorias")).categorias[0];
    const e = await falha(painelB.post("/produtos", { categoria_id: catA.id, nome: "Cruzado", descricao: "", preco: 100, unidade: "un", min_qtd: 1, emoji: "x", ativo: true, destaque: false }));
    assert.ok(e.status >= 400);
    // nem por baixo, direto no banco como o papel das funções
    await emu.db.query("begin");
    try {
      await emu.db.query(`select set_config('forminha.loja', $1, true)`, [idB]);
      await emu.db.query("set local role forminha_app");
      await assert.rejects(emu.db.query("insert into public.produtos (categoria_id, nome, preco) values ($1, 'Cruzado', 100)", [catA.id]), /foreign key|violates/);
    } finally { await emu.db.query("rollback"); }
  });
});

describe("administração e contas", () => {
  it("a dona de uma loja não administra a outra (nem trocando o cabeçalho)", async () => {
    const intrusa = painelDe("bia-painel.forminha.test");
    await intrusa.post("/auth/entrar", { email: "dona.a@teste.local", senha: "Admin12345" }).catch(() => {});
    assert.ok([401, 403].includes((await falha(intrusa.get("/produtos"))).status));
    assert.ok([401, 403].includes((await falha(intrusa.put("/configuracoes/aparencia", { tema: "cereja" }))).status));
    assert.equal((await visitanteB.get("/config")).aparencia.tema, "menta");
  });

  it("uma conta só: cadastrada na A, entra na B e ganha perfil de cliente lá", async () => {
    const naA = lojaDe("principal");
    await naA.post("/auth/cadastro", { nome: "Carla Cliente", email: "carla@teste.com", telefone: "11988887777", senha: "Senha1234", aceite: true });
    assert.equal((await q("select count(*)::int n from public.perfis where email = 'carla@teste.com'"))[0].n, 1);
    const naB = lojaDe("bia.forminha.test");
    await naB.post("/auth/entrar", { email: "carla@teste.com", senha: "Senha1234" });
    const { usuario } = await naB.get("/auth/eu");
    assert.equal(usuario.email, "carla@teste.com");
    assert.equal(usuario.papel, "cliente");
    const perfis = await q("select loja_id, papel from public.perfis where email = 'carla@teste.com' order by criado_em");
    assert.deepEqual(perfis.map((p) => [p.loja_id, p.papel]), [[idA, "cliente"], [idB, "cliente"]]);
  });

  it("pedidos: numeração de cada loja e ninguém vê o pedido da outra", async () => {
    const naA = lojaDe("principal");
    await naA.post("/auth/entrar", { email: "carla@teste.com", senha: "Senha1234" });
    const bolo = (await naA.get("/catalogo")).produtos.find((p) => p.nome === "Bolo Ninho com Morango");
    const pa = (await naA.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quando, pagamento: "dinheiro" })).pedido;
    assert.match(pa.codigo, /^LA\d+$/);

    const naB = lojaDe("bia.forminha.test");
    await naB.post("/auth/entrar", { email: "carla@teste.com", senha: "Senha1234" });
    const quandoB = await horarioLivre(naB);
    const boloB = (await naB.get("/catalogo")).produtos[0];
    const pb = (await naB.post("/pedidos", { itens: [{ produto_id: boloB.id, qtd: 1 }], tipo: "retirada", ...quandoB, pagamento: "dinheiro" })).pedido;
    assert.equal(pb.codigo, "DB1001", "a Bia começa a própria numeração");

    assert.deepEqual((await naB.get("/pedidos")).pedidos.map((p) => p.codigo), ["DB1001"]);
    assert.ok([403, 404].includes((await falha(naB.get(`/pedidos/${pa.codigo}`))).status), "o pedido da A não aparece na B");
    assert.deepEqual((await painelB.get("/pedidos?status=ativos")).itens.map((p) => p.codigo), ["DB1001"]);
    assert.ok(!(await painelA.get("/pedidos?status=ativos")).itens.some((p) => p.codigo === pb.codigo));
    // a mesma cliente não pede o produto da A pela loja B
    const e = await falha(naB.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...quandoB, pagamento: "dinheiro" }));
    assert.equal(e.status, 422);
  });

  it("apagar a conta numa loja não apaga o login da outra", async () => {
    const cliente = lojaDe("principal");
    await cliente.post("/auth/cadastro", { nome: "Duda", email: "duda@teste.com", telefone: "11977776666", senha: "Senha1234", aceite: true });
    const naBDuda = lojaDe(BIA.codigo);
    await naBDuda.post("/auth/entrar", { email: "duda@teste.com", senha: "Senha1234" });
    await naBDuda.get("/auth/eu");
    await naBDuda.post("/conta/excluir", { confirmar: "EXCLUIR", senha: "Senha1234" }).catch(async (erro) => {
      if (erro.status !== 422) throw erro;
      await naBDuda.post("/conta/excluir", {});
    });
    assert.deepEqual((await q("select loja_id from public.perfis where email = 'duda@teste.com'")).map((p) => p.loja_id), [idA]);
    assert.equal((await q("select count(*)::int n from auth.users where email = 'duda@teste.com'"))[0].n, 1, "o login continua (ainda é cliente da A)");
  });
});

describe("imagens e estrutura", () => {
  const comoUsuario = async (email, fn) => {
    const [u] = await q("select id from auth.users where email = $1", [email]);
    await emu.db.query("begin");
    try {
      await emu.db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, role: "authenticated" })]);
      await emu.db.query("set local role authenticated");
      return await fn();
    } finally { await emu.db.query("rollback"); }
  };
  const pode = (nome) => emu.db.query("select public.e_admin_do_arquivo($1) as ok", [nome]).then((r) => r.rows[0].ok);

  it("cada dona envia imagens só na pasta da própria loja", async () => {
    assert.equal(await comoUsuario("dona.b@teste.local", () => pode(`${idB}/bolo.png`)), true);
    assert.equal(await comoUsuario("dona.b@teste.local", () => pode(`${idA}/bolo.png`)), false);
    assert.equal(await comoUsuario("dona.a@teste.local", () => pode(`${idA}/bolo.png`)), true);
    assert.equal(await comoUsuario("dona.a@teste.local", () => pode("bolo.png")), false, "arquivo sem pasta só vale em banco de uma loja");
    assert.equal(await comoUsuario("carla@teste.com", () => pode(`${idB}/bolo.png`)), false, "cliente não envia");
  });

  it("toda tabela tem loja e a trava de loja", async () => {
    const semLoja = await q(`select t.tablename from pg_tables t where t.schemaname = 'public' and t.tablename not in ('lojas', 'loja_enderecos')
      and not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.tablename and c.column_name = 'loja_id' and c.is_nullable = 'NO')`);
    assert.deepEqual(semLoja, [], "tabela sem loja_id");
    const semTrava = await q(`select t.tablename from pg_tables t where t.schemaname = 'public' and t.tablename not in ('lojas', 'loja_enderecos')
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.policyname = 'so_da_loja')`);
    assert.deepEqual(semTrava, [], "tabela sem a política so_da_loja");
  });

  it("toda função da API roda no papel que só vê a loja da vez", async () => {
    const fora = await q(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and pg_get_userbyid(p.proowner) <> 'forminha_app'
      and p.proname not in ('_loja', '_loja_de', '_loja_atual', '_codigo_pedido', 'novo_usuario', '_apagar_login_sem_lojas', 'e_admin_do_arquivo') order by 1`);
    assert.deepEqual(fora.map((f) => f.proname), [], "função 'security definer' fora do papel forminha_app");
    const comAuth = await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%auth.uid()%'`);
    assert.deepEqual(comAuth, [], "use public._uid() no lugar de auth.uid()");
    const [papel] = await q("select rolbypassrls, rolsuper from pg_roles where rolname = 'forminha_app'");
    assert.deepEqual(papel, { rolbypassrls: false, rolsuper: false });
  });
});
