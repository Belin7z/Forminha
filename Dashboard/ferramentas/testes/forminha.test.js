/* ==========================================================
   FORMINHA — aparência da loja e convite de primeiro acesso.
     - só administrador troca a aparência; o banco recusa tema,
       letra ou cor inválidos; a loja recebe a aparência pública;
     - o convite é de uso único, vence, pode ser preso a um e-mail
       e transforma a conta em administradora;
     - gerar convite é só pelo SQL (o site não consegue).
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { iniciarEmulador } from "./emulador/servidor.js";
import { COMO_DONO } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";

let emu, painel, visitante, cliente;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }
const criarConvite = async (email = null, dias = 7) => (await emu.db.query("select public._criar_convite($1, $2) as c", [email, dias])).rows[0].c;
const papelDe = async (email) => (await emu.db.query("select papel from public.perfis where lower(email) = lower($1)", [email])).rows[0]?.papel;

before(async () => {
  emu = await iniciarEmulador({ exemplo: false });
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Comum", email: "comum@teste.com", telefone: "11999998888", senha: "Senha1234" });
});
after(async () => { await emu?.fechar(); });

describe("loja nova", () => {
  it("nasce neutra: nome genérico, sem endereço, sem cardápio e com o tema padrão", async () => {
    const cfg = await visitante.get("/config");
    assert.equal(cfg.loja.nome, "Minha Doceria");
    assert.equal(cfg.loja.lat, null);
    assert.equal(cfg.loja.instagram, "");
    assert.deepEqual(cfg.aparencia, { tema: "neutro", fonte: "moderno" });
    assert.equal(cfg.loja.slogan, "", "sem frase pronta de confeitaria");
    for (const k of ["hero_titulo", "hero_subtitulo", "sobre_titulo", "sobre_texto"]) assert.equal(cfg.textos[k], "", k);
    assert.equal((await visitante.get("/catalogo")).produtos.length, 0);
  });

  it("os primeiros passos começam por escolher a aparência", async () => {
    const { itens } = await painel.get("/checklist");
    assert.equal(itens[0].id, "aparencia");
    assert.equal(itens[0].feito, false);
  });
});

describe("aparência", () => {
  it("administrador escolhe um tema pronto e a loja recebe na hora", async () => {
    const r = await painel.put("/configuracoes/aparencia", { tema: "pistache", fonte: "delicado" });
    assert.deepEqual(r.configuracoes.aparencia, { tema: "pistache", fonte: "delicado" });
    assert.deepEqual((await visitante.get("/config")).aparencia, { tema: "pistache", fonte: "delicado" });
    assert.equal((await painel.get("/checklist")).itens[0].feito, true);
  });

  it("tema personalizado guarda as 3 cores (limpas e em minúsculas)", async () => {
    const r = await painel.put("/configuracoes/aparencia", { tema: "personalizado", fonte: "moderno", cores: { marca: " #AABBCC ", escura: "#112233", detalhe: "#C0874A" } });
    assert.deepEqual(r.configuracoes.aparencia.cores, { marca: "#aabbcc", escura: "#112233", detalhe: "#c0874a" });
  });

  it("recusa tema, letra ou cor inválidos, apontando o campo", async () => {
    let e = await falha(painel.put("/configuracoes/aparencia", { tema: "arco-iris" }));
    assert.equal(e.status, 422); assert.ok(e.campos?.tema);
    e = await falha(painel.put("/configuracoes/aparencia", { tema: "menta", fonte: "comic-sans" }));
    assert.equal(e.status, 422); assert.ok(e.campos?.fonte);
    e = await falha(painel.put("/configuracoes/aparencia", { tema: "personalizado", cores: { marca: "#aabbcc", escura: "red", detalhe: "#aabbcc" } }));
    assert.equal(e.status, 422); assert.ok(e.campos?.escura);
    e = await falha(painel.put("/configuracoes/aparencia", { tema: "personalizado", cores: { marca: "#aabbcc", escura: "#000000", detalhe: "url(javascript:x)" } }));
    assert.equal(e.status, 422); assert.ok(e.campos?.detalhe);
  });

  it("cliente e visitante não trocam a aparência", async () => {
    const rpcCliente = (await falha(cliente.supabase.rpc("admin_salvar_aparencia", { p: { tema: "menta" } }).then((r) => { if (r.error) throw r.error; })));
    assert.ok(rpcCliente, "cliente foi barrado");
    const sb = novoCliente();
    const { error } = await sb.rpc("admin_salvar_aparencia", { p: { tema: "menta" } });
    assert.ok(error, "visitante foi barrado");
    assert.notEqual((await visitante.get("/config")).aparencia.tema, "menta");
  });
});

describe("convite de primeiro acesso", () => {
  it("o site não consegue gerar convite (só o SQL do dono do banco)", async () => {
    for (const sb of [novoCliente(), cliente.supabase]) {
      const { error } = await sb.rpc("_criar_convite", { p_email: null, p_dias: 7, p_papel: "admin" });
      assert.ok(error, "gerar convite pelo site foi barrado");
    }
    const { rows } = await emu.db.query("select has_function_privilege('anon', 'public._criar_convite(text,int,text)', 'execute') a, has_function_privilege('authenticated', 'public._criar_convite(text,int,text)', 'execute') b");
    assert.deepEqual(rows[0], { a: false, b: false });
  });

  it("só o resumo (hash) do código fica guardado", async () => {
    const codigo = await criarConvite();
    assert.match(codigo, /^[0-9a-f]{64}$/);
    const { rows } = await emu.db.query("select count(*)::int n from public.convites where token_hash = $1", [codigo]);
    assert.equal(rows[0].n, 0, "o código puro não está no banco");
  });

  it("link inexistente, vencido ou já usado responde com texto claro", async () => {
    let e = await falha(visitante.supabase.rpc("convite_consultar", { p: { codigo: "0".repeat(64) } }).then((r) => { if (r.error) throw r.error; }));
    assert.match(e.message, /não existe/);
    const vencido = await criarConvite();
    await emu.db.query("update public.convites set expira_em = now() - interval '1 minute' where token_hash = public._hash_convite($1)", [vencido]);
    const pVisitante = criarApiPainel(novoCliente());
    e = await falha(pVisitante.get(`/convite/${vencido}`));
    assert.equal(e.status, 410); assert.match(e.message, /venceu/);
  });

  it("cria a conta pelo convite e já entra como administradora; o convite não vale de novo", async () => {
    const codigo = await criarConvite("ana@doceria.com");
    const nova = criarApiPainel(novoCliente());
    const info = await nova.get(`/convite/${codigo}`);
    assert.equal(info.email, "ana@doceria.com");
    assert.equal(info.loja, "Minha Doceria");

    const r = await nova.post("/convite/usar", { codigo, criar: true, nome: "  Ana   Souza  ", email: "ana@doceria.com", senha: "Doces2026" });
    assert.equal(r.usuario.papel, "admin");
    assert.equal(r.usuario.nome, "Ana Souza", "espaços sobrando são limpos e as letras ficam intactas");
    assert.equal((await nova.get("/auth/eu")).usuario.email, "ana@doceria.com", "entrou no painel");
    await nova.put("/configuracoes/aparencia", { tema: "lavanda" });

    const outra = criarApiPainel(novoCliente());
    const e = await falha(outra.post("/convite/usar", { codigo, criar: true, nome: "Intrusa", email: "intrusa@teste.com", senha: "Doces2026" }));
    assert.equal(e.status, 410, `convite já usado — veio: ${e.status} ${e.message} ${JSON.stringify(e.campos)}`);
    assert.equal(await papelDe("intrusa@teste.com"), "cliente", "a conta da intrusa não virou admin");
    assert.equal((await outra.get("/auth/eu")).usuario, null, "e ficou fora do painel");
  });

  it("convite preso a um e-mail recusa outra conta (e não deixa ninguém logado)", async () => {
    const codigo = await criarConvite("bia@doceria.com");
    const p = criarApiPainel(novoCliente());
    const e = await falha(p.post("/convite/usar", { codigo, criar: true, nome: "Outra Pessoa", email: "outra@doceria.com", senha: "Doces2026" }));
    assert.equal(e.status, 403);
    assert.match(e.message, /bia@doceria\.com/);
    assert.equal((await p.get("/auth/eu")).usuario, null);
    assert.equal(await papelDe("outra@doceria.com"), "cliente");
  });

  it("quem já tem conta (ex.: cliente da loja) entra com ela e vira administradora", async () => {
    const codigo = await criarConvite();
    const p = criarApiPainel(novoCliente());
    const e = await falha(p.post("/convite/usar", { codigo, criar: false, email: "comum@teste.com", senha: "senha-errada" }));
    assert.equal(e.status, 401);
    const r = await p.post("/convite/usar", { codigo, criar: false, email: "comum@teste.com", senha: "Senha1234" });
    assert.equal(r.usuario.papel, "admin");
  });

  it("valida os dados da conta nova antes de criar", async () => {
    const codigo = await criarConvite();
    const p = criarApiPainel(novoCliente());
    const e = await falha(p.post("/convite/usar", { codigo, criar: true, nome: "A", email: "sem-arroba", senha: "123" }));
    assert.equal(e.status, 422);
    assert.ok(e.campos.email && e.campos.nome && e.campos.senha);
  });
});

describe("visual neutro da loja (migração 0028)", () => {
  const TEXTOS_ANTIGOS = {
    hero_titulo: "Doces que transformam momentos em memórias",
    hero_subtitulo: "Bolos, doces e encomendas para festas — feitos sob encomenda, com ingredientes selecionados e muito carinho.",
    sobre_titulo: "Feito à mão, do nosso jeito",
    sobre_texto: "Cada receita é preparada com calma, ingredientes selecionados e atenção aos detalhes — do primeiro brigadeiro ao último confeito.\n\nFaça seu pedido pelo site e combine a entrega ou a retirada no horário que for melhor para você.",
  };
  const rodarMigracao = async () => {
    const texto = readFileSync(new URL("../../supabase/migrations/20260930000028_visual_neutro.sql", import.meta.url), "utf8");
    try { await emu.db.exec(`${COMO_DONO}\n${texto}`); } finally { await emu.db.exec("reset role;"); }
  };

  it("o título da página inicial é opcional (em branco, a loja mostra o nome)", async () => {
    await painel.put("/configuracoes/textos", { hero_titulo: "", hero_subtitulo: "", sobre_titulo: "", sobre_texto: "" });
    assert.equal((await visitante.get("/config")).textos.hero_titulo, "");
  });

  it("apaga os textos prontos antigos só de quem não os trocou, e pode rodar de novo", async () => {
    await emu.db.query("update public.configuracoes set valor = valor || $1::jsonb where chave = 'textos'",
      [JSON.stringify({ ...TEXTOS_ANTIGOS, sobre_titulo: "A nossa história" })]);
    await emu.db.query("update public.configuracoes set valor = valor || '{\"slogan\":\"Doces feitos com carinho\"}'::jsonb where chave = 'loja'");
    await rodarMigracao();
    await rodarMigracao();
    const cfg = await visitante.get("/config");
    assert.equal(cfg.loja.slogan, "");
    assert.equal(cfg.textos.hero_titulo, "");
    assert.equal(cfg.textos.hero_subtitulo, "");
    assert.equal(cfg.textos.sobre_texto, "");
    assert.equal(cfg.textos.sobre_titulo, "A nossa história", "o que a dona escreveu fica");
  });
});
