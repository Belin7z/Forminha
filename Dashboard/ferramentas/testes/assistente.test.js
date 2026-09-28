/* ==========================================================
   ASSISTENTE DE PRIMEIROS PASSOS — o caminho que a dona faz na
   loja nova, pelo mesmo código que a página usa:
     - a chave PIX é reconhecida e vai no formato do banco;
     - categoria nova ganha o ícone que combina com o nome;
     - loja, logo, cores, primeiro doce e PIX salvam de verdade
       e os primeiros passos do banco ficam marcados.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { cnpjValido, cpfValido, normalizarChavePix, tipoDaChave } from "../../src/scripts/base/chave-pix.js";
import { iconeDaCategoria } from "../../src/scripts/base/sugestoes.js";
import {
  aparenciaEscolhida, passosFeitos, salvarCores, salvarDoce, salvarLogo, salvarLoja, salvarPix,
} from "../../src/scripts/base/assistente.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CPF = "529.982.247-25";  // CPF de exemplo com dígitos válidos
const CNPJ = "11.222.333/0001-81";

async function falha(promessa) { try { await promessa; } catch (e) { return e; } assert.fail("era esperado um erro"); }

describe("chave PIX", () => {
  it("confere os dígitos de CPF e CNPJ", () => {
    assert.equal(cpfValido("52998224725"), true);
    assert.equal(cpfValido("52998224724"), false);
    assert.equal(cpfValido("11111111111"), false);
    assert.equal(cnpjValido("11222333000181"), true);
    assert.equal(cnpjValido("11222333000182"), false);
  });

  it("reconhece o tipo pelo jeito que foi escrita", () => {
    assert.equal(tipoDaChave(CPF), "documento");
    assert.equal(tipoDaChave(CNPJ), "documento");
    assert.equal(tipoDaChave("(11) 98765-4321"), "celular");
    assert.equal(tipoDaChave("+55 11 98765-4321"), "celular");
    assert.equal(tipoDaChave("Ana@Email.com"), "email");
    assert.equal(tipoDaChave("123E4567-E89B-12D3-A456-426614174000"), "aleatoria");
    assert.equal(tipoDaChave("12345"), null);
  });

  it("deixa a chave no formato que o banco espera", () => {
    assert.equal(normalizarChavePix(CPF), "52998224725");
    assert.equal(normalizarChavePix(CNPJ), "11222333000181");
    assert.equal(normalizarChavePix("(11) 98765-4321"), "+5511987654321");
    assert.equal(normalizarChavePix("11987654321", "celular"), "+5511987654321");
    assert.equal(normalizarChavePix("+55 (11) 98765-4321", "celular"), "+5511987654321");
    assert.equal(normalizarChavePix(" Ana@Email.com "), "ana@email.com");
    assert.equal(normalizarChavePix("123E4567-E89B-12D3-A456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
  });

  it("explica o que está errado em vez de salvar uma chave que o banco recusaria", () => {
    assert.throws(() => normalizarChavePix(""), /Informe a chave/);
    assert.throws(() => normalizarChavePix("529.982.247-24"), /CPF não confere/);
    assert.throws(() => normalizarChavePix("123456", "documento"), /11 números/);
    assert.throws(() => normalizarChavePix("3222-1111", "celular"), /DDD/);
    assert.throws(() => normalizarChavePix("ana@", "email"), /e-mail/);
    assert.throws(() => normalizarChavePix("abc", "aleatoria"), /32 letras/);
    assert.throws(() => normalizarChavePix("12345"), /Não reconheci/);
  });
});

describe("sugestões", () => {
  it("categoria nova ganha um ícone que combina com o nome", () => {
    assert.equal(iconeDaCategoria("Bolos de pote"), "bolo");
    assert.equal(iconeDaCategoria("Docinhos"), "brigadeiro");
    assert.equal(iconeDaCategoria("Kits e presentes"), "presente");
    assert.equal(iconeDaCategoria("Ovos de Páscoa"), "chocolate");
    assert.equal(iconeDaCategoria("Novidades"), "bolo"); // "novidades" não é "ovo"
  });

  it("tema novo leva a letra dele; o mesmo tema mantém a letra que ela escolheu", () => {
    assert.deepEqual(aparenciaEscolhida({ tema: "neutro", fonte: "elegante" }, "menta"), { tema: "menta", fonte: "moderno" });
    assert.deepEqual(aparenciaEscolhida({ tema: "menta", fonte: "classico" }, "menta"), { tema: "menta", fonte: "classico" });
    const minhas = aparenciaEscolhida({ tema: "personalizado", fonte: "delicado", cores: { marca: "#aabbcc", escura: "#112233", detalhe: "#c0874a" } }, "personalizado");
    assert.deepEqual(minhas.cores, { marca: "#aabbcc", escura: "#112233", detalhe: "#c0874a" });
  });
});

describe("loja nova pelo assistente", () => {
  let emu, painel, visitante, cfg, categorias;
  const novoCliente = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const feitos = async () => passosFeitos(cfg, (await painel.get("/checklist")).itens);

  before(async () => {
    emu = await iniciarEmulador({ exemplo: false });
    const admin = await emu.criarAdmin("dona@teste.local", "Admin12345");
    painel = criarApiPainel(novoCliente());
    await painel.post("/auth/entrar", { email: admin.email, senha: admin.senha });
    visitante = criarApiLoja(novoCliente());
    cfg = (await painel.get("/configuracoes")).configuracoes;
    categorias = (await painel.get("/categorias")).categorias;
  });
  after(async () => { await emu?.fechar(); });

  it("começa com tudo por fazer", async () => {
    assert.deepEqual(await feitos(), { loja: false, logo: false, cores: false, produto: false, pix: false });
    assert.equal(categorias.length, 0);
  });

  it("passo 1: nome e WhatsApp são obrigatórios; o resto dos dados da loja fica como estava", async () => {
    let e = await falha(salvarLoja(painel, cfg, { nome: " ", whatsapp: "11987654321" }));
    assert.ok(e.campos.nome);
    e = await falha(salvarLoja(painel, cfg, { nome: "Doces da Ana", whatsapp: "" }));
    assert.ok(e.campos.whatsapp);
    cfg = await salvarLoja(painel, cfg, { nome: "  Doces da Ana ", whatsapp: "(11) 98765-4321", cidade: "Campinas", uf: "SP", slogan: "" });
    assert.equal(cfg.loja.nome, "Doces da Ana");
    assert.equal(cfg.loja.cidade, "Campinas");
    assert.equal((await visitante.get("/config")).loja.nome, "Doces da Ana");
    assert.equal((await feitos()).loja, true);
  });

  it("passo 2: a logo sobe, fica na loja e a antiga é trocada", async () => {
    cfg = await salvarLogo(painel, cfg, PNG);
    const primeira = cfg.loja.logo;
    assert.match(primeira, /\/storage\/v1\/object\/public\//);
    cfg = await salvarLogo(painel, cfg, PNG);
    assert.notEqual(cfg.loja.logo, primeira);
    assert.equal((await visitante.get("/config")).loja.logo, cfg.loja.logo);
    assert.equal(cfg.loja.nome, "Doces da Ana"); // não apagou o que o passo 1 salvou
  });

  it("passo 3: o tema escolhido vale na loja e marca o passo", async () => {
    cfg = await salvarCores(painel, cfg, "pistache");
    assert.deepEqual((await visitante.get("/config")).aparencia, { tema: "pistache", fonte: "elegante" });
    assert.equal((await feitos()).cores, true);
  });

  it("passo 4: o primeiro doce cria a categoria, vai para os destaques e aparece no cardápio", async () => {
    let e = await falha(salvarDoce(painel, { categorias, dados: { nome: "Bolo de brigadeiro", preco: "0,00", unidade: "bolo 1 kg", categoria: "Bolos" } }));
    assert.ok(e.campos.preco);
    e = await falha(salvarDoce(painel, { categorias, dados: { nome: "Bolo de brigadeiro", preco: "90,00", unidade: "", categoria: "" } }));
    assert.ok(e.campos.categoria);

    categorias = await salvarDoce(painel, {
      categorias, destaque: true, foto: PNG,
      dados: { nome: "Bolo de brigadeiro", preco: "90,00", unidade: "bolo 1 kg", categoria: "Bolos", descricao: "Massa de chocolate." },
    });
    assert.deepEqual(categorias.map((c) => [c.nome, c.icone]), [["Bolos", "bolo"]]);
    const { produtos } = await visitante.get("/catalogo");
    assert.equal(produtos.length, 1);
    assert.equal(produtos[0].nome, "Bolo de brigadeiro");
    assert.equal(produtos[0].preco, 9000);
    assert.equal(produtos[0].destaque, true);
    assert.ok(produtos[0].imagem);
    assert.equal((await feitos()).produto, true);
  });

  it("mais um doce na mesma categoria (escrita diferente) não cria categoria repetida", async () => {
    categorias = await salvarDoce(painel, { categorias, dados: { nome: "Bolo de ninho", preco: "85", unidade: "", categoria: " bolos " } });
    assert.equal(categorias.length, 1);
    const { produtos } = await visitante.get("/catalogo");
    assert.equal(produtos.find((p) => p.nome === "Bolo de ninho").unidade, "unidade");
  });

  it("passo 5: o PIX liga com a chave no formato do banco", async () => {
    const e = await falha(salvarPix(painel, cfg, { tipo: "celular", pix_chave: "3222-1111", pix_nome: "Ana", pix_cidade: "Campinas" }));
    assert.ok(e.campos.pix_chave);
    cfg = await salvarPix(painel, cfg, { tipo: "celular", pix_chave: "(11) 98765-4321", pix_nome: "Ana Souza", pix_cidade: "Campinas", dinheiro_ativo: true, cartao_ativo: false });
    assert.equal(cfg.pagamento.pix_ativo, true);
    assert.equal(cfg.pagamento.pix_chave, "+5511987654321");
    assert.equal(cfg.pagamento.dinheiro_ativo, true);
    assert.equal(cfg.pagamento.cartao_ativo, false);
    assert.deepEqual(await feitos(), { loja: true, logo: true, cores: true, produto: true, pix: true });
  });
});
