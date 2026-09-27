/* ==========================================================
   CONTEÚDO VISUAL — ícone das categorias, imagens do site
   (logo, foto de destaque, galeria), perguntas frequentes e
   textos legais. Só administrador altera; visitante só lê.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let emu, painel, visitante, cliente;
const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }

before(async () => {
  emu = await iniciarEmulador();
  const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
  painel = criarApiPainel(novoCliente());
  await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
  visitante = criarApiLoja(novoCliente());
  cliente = criarApiLoja(novoCliente());
  await cliente.post("/auth/cadastro", { nome: "Cliente Comum", email: "comum@teste.com", telefone: "11999998888", senha: "Senha1234" });
});
after(async () => { await emu?.fechar(); });

describe("categorias com ícone", () => {
  it("aceita um ícone da lista, devolve na loja e recusa ícone inventado", async () => {
    const r = await painel.post("/categorias", { nome: "Macarons", icone: "macaron", ativa: true });
    const c = r.categorias.find((x) => x.nome === "Macarons");
    assert.equal(c.icone, "macaron");
    assert.equal((await visitante.get("/catalogo")).categorias.find((x) => x.nome === "Macarons").icone, "macaron");

    const e = await falha(painel.post("/categorias", { nome: "Estranha", icone: "<script>", ativa: true }));
    assert.equal(e.status, 422);
    assert.ok(e.campos?.icone, "o erro aponta o campo ícone");

    const padrao = await painel.post("/categorias", { nome: "Sem ícone", ativa: true });
    assert.equal(padrao.categorias.find((x) => x.nome === "Sem ícone").icone, "bolo", "sem escolha, usa o bolo");
  });
});

describe("imagens do site", () => {
  let url;
  it("administrador envia a imagem para o Storage e a logo aparece na loja", async () => {
    ({ url } = await painel.post("/site/imagem", { imagem: PNG }));
    assert.match(url, /\/storage\/v1\/object\/public\/site\/.+\.png$/);
    assert.equal((await fetch(url)).status, 200, "a imagem abre pelo link público");

    const cfg = (await painel.get("/configuracoes")).configuracoes;
    await painel.put("/configuracoes/loja", { ...cfg.loja, logo: url });
    assert.equal((await visitante.get("/config")).loja.logo, url);
    await painel.put("/configuracoes/textos", { ...cfg.textos, hero_imagem: url, sobre_imagem: url });
    const publica = await visitante.get("/config");
    assert.equal(publica.textos.hero_imagem, url);
    assert.equal(publica.textos.sobre_imagem, url);
  });

  it("recusa endereços de fora do bucket do site (não dá para pôr link de terceiros)", async () => {
    const cfg = (await painel.get("/configuracoes")).configuracoes;
    for (const ruim of ["https://exemplo.com/logo.png", "javascript:alert(1)", url.replace("/public/site/", "/public/produtos/")]) {
      const e = await falha(painel.put("/configuracoes/loja", { ...cfg.loja, logo: ruim }));
      assert.equal(e.status, 422, `deveria recusar ${ruim}`);
    }
    await painel.put("/configuracoes/loja", { ...cfg.loja, logo: "" }); // remover é permitido
    assert.equal((await visitante.get("/config")).loja.logo, "");
  });

  it("cliente comum não consegue enviar nem apagar imagens do site", async () => {
    const storage = cliente.supabase.storage.from("site");
    const enviar = await storage.upload("intruso.png", new Blob([Buffer.from(PNG.split(",")[1], "base64")], { type: "image/png" }), { contentType: "image/png" });
    assert.ok(enviar.error, "upload de quem não é administrador precisa falhar");
    const visit = await visitante.supabase.storage.from("site").remove([url.split("/site/")[1]]);
    assert.equal((visit.data ?? []).length, 0, "visitante não apaga nada");
    assert.equal((await fetch(url)).status, 200, "a imagem continua lá");
  });

  it("apagar pelo Dashboard remove o arquivo", async () => {
    const { url: outra } = await painel.post("/site/imagem", { imagem: PNG });
    assert.equal((await fetch(outra)).status, 200);
    await painel.post("/site/imagem/apagar", { url: outra });
    assert.equal((await fetch(outra)).status, 404);
  });

  it("galeria: até 8 fotos do site, todas validadas", async () => {
    const fotos = [];
    for (let i = 0; i < 3; i++) fotos.push((await painel.post("/site/imagem", { imagem: PNG })).url);
    const salvo = await painel.put("/configuracoes/galeria", { itens: fotos });
    assert.deepEqual(salvo.configuracoes.galeria.itens, fotos);
    assert.deepEqual((await visitante.get("/config")).galeria, fotos);

    assert.equal((await falha(painel.put("/configuracoes/galeria", { itens: [...fotos, ...fotos, ...fotos] }))).status, 422, "mais de 8");
    assert.equal((await falha(painel.put("/configuracoes/galeria", { itens: ["https://evil.example/x.png"] }))).status, 422);
    await painel.put("/configuracoes/galeria", { itens: [] });
    assert.deepEqual((await visitante.get("/config")).galeria, []);
  });
});

describe("perguntas frequentes e textos legais", () => {
  it("salva perguntas, valida e mostra na loja; vazio volta às respostas automáticas", async () => {
    await painel.put("/configuracoes/faq", { itens: [{ p: "Vocês entregam?", r: "Sim, na região." }, { p: "Aceitam PIX?", r: "Aceitamos." }] });
    const faq = (await visitante.get("/config")).faq;
    assert.equal(faq.length, 2);
    assert.equal(faq[0].p, "Vocês entregam?");
    assert.equal((await falha(painel.put("/configuracoes/faq", { itens: [{ p: "Sem resposta", r: "" }] }))).status, 422);
    assert.equal((await falha(painel.put("/configuracoes/faq", { itens: Array.from({ length: 13 }, (_, i) => ({ p: "P" + i, r: "R" })) }))).status, 422);
    await painel.put("/configuracoes/faq", { itens: [] });
    assert.deepEqual((await visitante.get("/config")).faq, []);
  });

  it("textos legais editáveis; texto com HTML é guardado como texto", async () => {
    await painel.put("/configuracoes/legal", { privacidade: "# Dados\nNão vendemos dados.", termos: "<img src=x onerror=alert(1)>" });
    const legal = (await visitante.get("/config")).legal;
    assert.match(legal.privacidade, /Não vendemos/);
    assert.equal(legal.termos, "<img src=x onerror=alert(1)>", "guardado literal — a tela escapa ao exibir");
    assert.equal((await falha(painel.put("/configuracoes/legal", { privacidade: "x".repeat(12001), termos: "" }))).status, 422);
  });

  it("cliente comum não altera nenhuma configuração", async () => {
    const painelDoCliente = criarApiPainel(cliente.supabase);
    assert.equal((await falha(painelDoCliente.put("/configuracoes/faq", { itens: [] }))).status, 403);
    assert.equal((await falha(painelDoCliente.put("/configuracoes/legal", { privacidade: "", termos: "" }))).status, 403);
  });
});
