/* ==========================================================
   TESTE DE PONTA A PONTA — banco + API da Loja e do Dashboard
   Sobe o mini-Supabase (Postgres real + as migrações do projeto)
   e usa a biblioteca oficial `supabase-js` com as MESMAS rotas que
   a loja e o painel usam. Percorre o fluxo real: cadastro → endereço
   → orçamento → pedido → painel → status → avaliação, além das
   regras de segurança.
   Rodar:  npm test
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";
import { criarApiPainel } from "../../src/scripts/base/api/painel.js";
import { gerarHorarios, dataISO } from "../../../Loja/src/scripts/base/agendamento.js";
import { gerarPix } from "../../../Loja/src/scripts/base/pix.js";

let emu;
const clienteSupabase = () => createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
/** Cada "navegador" é um cliente Supabase independente (sessão própria). */
const navegadorLoja = () => criarApiLoja(clienteSupabase(), { urlRecuperacao: "http://loja.exemplo/#/redefinir" });
const navegadorPainel = () => criarApiPainel(clienteSupabase(), { urlLoja: "http://loja.exemplo" });

/** Espera uma falha da API e devolve o erro para conferir status/mensagem. */
async function falha(promessa) {
  try { await promessa; } catch (e) { return e; }
  assert.fail("era esperado um erro, mas a chamada funcionou");
}

/** Primeira data (a partir de +4 dias) com horário livre, para agendar. */
function proximoAgendamento(cfg) {
  const minimo = new Date(Date.now() + 96 * 3600_000);
  for (let i = 0; i < 20; i++) {
    const d = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate() + i);
    const horas = gerarHorarios(cfg.horarios, dataISO(d), minimo, cfg.pedidos.intervalo_min);
    if (horas.length) return { data: dataISO(d), hora: horas[Math.min(2, horas.length - 1)] };
  }
  throw new Error("sem data disponível");
}

let loja, outro, visitante, painel;
before(async () => {
  emu = await iniciarEmulador();
  loja = navegadorLoja();
  outro = navegadorLoja();
  visitante = navegadorLoja();
  painel = navegadorPainel();
});
after(async () => { await emu?.fechar(); });

let pedido, enderecoId, bolo, agenda, cfgPublica;

describe("vitrine pública e permissões", () => {
  it("entrega configuração e catálogo sem login, e a chave PIX não vaza", async () => {
    cfgPublica = await visitante.get("/config");
    assert.equal(cfgPublica.loja.nome, "Doceria Exemplo");
    assert.ok(!("pix_chave" in cfgPublica.pagamento), "a chave PIX não pode vazar");
    assert.equal(cfgPublica.zonas.length, 3);

    const cat = await visitante.get("/catalogo");
    assert.ok(cat.produtos.length >= 20 && cat.categorias.length >= 6);
    assert.deepEqual(cat.favoritos, []);
    bolo = cat.produtos.find((p) => p.nome === "Bolo Ninho com Morango");
    assert.equal(bolo.opcoes.length, 2);
  });

  it("visitante só executa 7 funções (vitrine, agenda, conferir convite e, protegidos por chave, o registro do gateway e as chaves do servidor); usuário logado nunca executa as internas", async () => {
    const executaveis = async (papel) => (await sql(emu.db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('${papel}', p.oid, 'execute') order by 1`)).rows.map((r) => r.proname);
    assert.deepEqual(await executaveis("anon"), ["convite_consultar", "gateway_registrar_pagamento", "loja_agenda", "loja_avaliacoes", "loja_catalogo", "loja_config", "servidor_segredos"]);
    const logado = await executaveis("authenticated");
    assert.ok(!logado.some((n) => n.startsWith("_") || n === "novo_usuario"), "função interna exposta");
  });

  it("as tabelas não podem ser lidas diretamente (só pelas funções)", async () => {
    const r = (await sql(emu.db, `select has_table_privilege('anon','public.pedidos','select') a,
      has_table_privilege('authenticated','public.pedidos','select') b, has_table_privilege('authenticated','public.perfis','select') c,
      has_table_privilege('authenticated','public.configuracoes','update') d`)).rows[0];
    assert.deepEqual(r, { a: false, b: false, c: false, d: false });
    // e pelo endpoint de tabelas do PostgREST também não
    const pg = await fetch(`${emu.url}/rest/v1/pedidos?select=*`, { headers: { apikey: emu.chaveAnon } });
    assert.ok(pg.status >= 400);
  });

  it("visitante e cliente comum não acessam funções do painel nem do cliente", async () => {
    assert.equal((await falha(visitante.get("/pedidos"))).status, 401);
    assert.equal((await falha(visitante.get("/enderecos"))).status, 401);
  });
});

describe("cadastro e login do cliente", () => {
  it("valida os campos do cadastro", async () => {
    const e = await falha(loja.post("/auth/cadastro", { nome: "A", email: "ruim", telefone: "1", senha: "123" }));
    assert.equal(e.status, 422);
    assert.ok(e.campos.email && e.campos.senha && e.campos.telefone && e.campos.nome);
  });

  it("cadastra, mantém a sessão, cria o perfil como 'cliente' e impede e-mail repetido", async () => {
    const dados = { nome: "Maria Souza", email: "Maria@Teste.com", telefone: "(11) 91234-5678", senha: "Senha1234" };
    const r = await loja.post("/auth/cadastro", dados);
    assert.equal(r.usuario.telefone, "11912345678");
    assert.equal(r.usuario.papel, "cliente");
    assert.equal(r.usuario.email, "maria@teste.com");
    assert.equal((await loja.get("/auth/eu")).usuario.email, "maria@teste.com");
    assert.equal((await falha(outro.post("/auth/cadastro", dados))).status, 409);
  });

  it("não dá para virar administrador pelos metadados do cadastro", async () => {
    const hacker = navegadorLoja();
    await hacker.supabase.auth.signUp({ email: "hacker@teste.com", password: "Senha1234", options: { data: { nome: "Hacker", telefone: "11999998888", papel: "admin" } } });
    const usuario = (await hacker.get("/auth/eu")).usuario;
    assert.equal(usuario.papel, "cliente");
    assert.equal((await falha(criarApiPainel(hacker.supabase).get("/pedidos/contagem"))).status, 403, "o banco barra quem não é admin");
  });

  it("login com senha errada falha e com senha certa funciona", async () => {
    assert.equal((await falha(outro.post("/auth/entrar", { email: "maria@teste.com", senha: "errada123" }))).status, 401);
    assert.equal((await outro.post("/auth/entrar", { email: "maria@teste.com", senha: "Senha1234" })).usuario.nome, "Maria Souza");
  });

  it("atualiza o perfil e valida o telefone", async () => {
    assert.equal((await falha(loja.put("/conta", { nome: "Maria", telefone: "123" }))).status, 422);
    const r = await loja.put("/conta", { nome: "Maria Souza", telefone: "(11) 98888-7777" });
    assert.equal(r.usuario.telefone, "11988887777");
  });

  it("recuperação de senha: pede o e-mail (sem revelar se existe) e define a nova senha", async () => {
    assert.deepEqual(await visitante.post("/auth/recuperar", { email: "naoexiste@teste.com" }), { ok: true });
    await visitante.post("/auth/recuperar", { email: "maria@teste.com" });
    assert.ok(emu.emails.some((m) => m.email === "maria@teste.com" && m.redirecionar === "http://loja.exemplo/#/redefinir"));
    assert.equal((await falha(visitante.post("/auth/redefinir", { senha: "NovaSenha123" }))).status, 401, "sem link válido não redefine");
    // com a sessão de recuperação aberta (o link do e-mail), a nova senha vale
    await outro.post("/auth/redefinir", { senha: "OutraSenha123" });
    assert.equal((await falha(navegadorLoja().post("/auth/entrar", { email: "maria@teste.com", senha: "Senha1234" }))).status, 401);
    assert.equal((await navegadorLoja().post("/auth/entrar", { email: "maria@teste.com", senha: "OutraSenha123" })).usuario.nome, "Maria Souza");
    await outro.put("/conta/senha", { atual: "OutraSenha123", nova: "Senha1234" });
  });

  it("troca de senha exige a senha atual correta e uma senha forte", async () => {
    assert.equal((await falha(loja.put("/conta/senha", { atual: "errada000", nova: "NovaSenha123" }))).campos.atual.length > 0, true);
    assert.ok((await falha(loja.put("/conta/senha", { atual: "Senha1234", nova: "fraca" }))).campos.nova);
  });
});

describe("endereços e entrega", () => {
  it("salva endereço perto da loja; o primeiro vira principal", async () => {
    const r = await loja.post("/enderecos", {
      apelido: "Casa", cep: "01001-000", rua: "Praça da Sé", numero: "10", complemento: "", bairro: "Sé",
      cidade: "São Paulo", uf: "SP", referencia: "", lat: -23.552, lng: -46.634, principal: false,
    });
    assert.equal(r.enderecos.length, 1);
    assert.equal(r.enderecos[0].principal, true);
    assert.equal(r.enderecos[0].cep, "01001-000");
    enderecoId = r.enderecos[0].id;
  });

  it("valida o endereço e edita/exclui só os seus", async () => {
    const e = await falha(loja.post("/enderecos", { apelido: "", cep: "123", rua: "x", numero: "", bairro: "", cidade: "", uf: "SPP" }));
    assert.equal(e.status, 422);
    // um OUTRO usuário (o "outro" acima está logado como a própria Maria)
    const estranho = navegadorLoja();
    await estranho.post("/auth/cadastro", { nome: "Estranho Silva", email: "estranho@teste.com", telefone: "11955554444", senha: "Senha1234" });
    const roubo = { apelido: "Roubado", cep: "01001-000", rua: "Rua Nova", numero: "1", bairro: "Bairro", cidade: "Cidade", uf: "SP" };
    assert.equal((await falha(estranho.put(`/enderecos/${enderecoId}`, roubo))).status, 404);
    assert.equal((await falha(estranho.delete(`/enderecos/${enderecoId}`))).status, 404);
    assert.equal((await estranho.get("/enderecos")).enderecos.length, 0, "não vê endereços alheios");
  });

  it("recusa endereço fora da área de entrega", async () => {
    const longe = await loja.post("/enderecos", {
      apelido: "Praia", cep: "11010-000", rua: "Rua Longe", numero: "1", complemento: "", bairro: "Centro",
      cidade: "Santos", uf: "SP", referencia: "", lat: -23.96, lng: -46.33, principal: false,
    });
    const idLonge = longe.enderecos.find((e) => e.apelido === "Praia").id;
    agenda = proximoAgendamento(cfgPublica);
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "entrega", endereco_id: idLonge, ...agenda, pagamento: "dinheiro",
    });
    assert.ok(o.problemas.some((p) => p.campo === "endereco" && /fora da nossa área/.test(p.mensagem)));
    await loja.delete(`/enderecos/${idLonge}`);
  });
});

describe("orçamento e pedido", () => {
  it("calcula preço com opções, taxa e cupom de primeira compra", async () => {
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 2, opcoes: { g1: ["g1i2"], g2: ["g2i1", "g2i3"] }, obs: "Sem nozes" }],
      tipo: "entrega", endereco_id: enderecoId, ...agenda, pagamento: "dinheiro", cupom: "bemvindo10",
    });
    assert.deepEqual(o.problemas, [], JSON.stringify(o.problemas));
    assert.equal(o.subtotal, 32980); // (8990 + 4500 + 2500 + 500) × 2
    assert.equal(o.taxa_entrega, 600);
    assert.equal(o.desconto, 3298);
    assert.equal(o.total, 32980 + 600 - 3298);
    assert.equal(o.zona.nome, "Até 3 km");
    assert.ok(!("cupom_id" in o), "detalhe interno não pode sair");
  });

  it("aponta problemas: opção obrigatória e horário muito próximo", async () => {
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: {} }], tipo: "retirada", data: dataISO(new Date()), hora: "10:00", pagamento: "dinheiro",
    });
    const campos = o.problemas.map((p) => p.campo);
    assert.ok(campos.includes("itens") && (campos.includes("hora") || campos.includes("data")), campos.join());
  });

  it("cupom inexistente é apontado sem derrubar o orçamento", async () => {
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "dinheiro", cupom: "NAOEXISTE",
    });
    assert.deepEqual(o.problemas.map((p) => p.campo), ["cupom"]);
    assert.equal(o.desconto, 0);
  });

  it("não aceita preço vindo do navegador (o banco recalcula)", async () => {
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] }, preco: 1, preco_unit: 1, total: 1 }],
      tipo: "retirada", ...agenda, pagamento: "dinheiro", subtotal: 1, total: 1,
    });
    assert.equal(o.subtotal, 8990);
    assert.equal(o.total, 8990);
  });

  it("recusa opção que não existe e quantidade abaixo do mínimo", async () => {
    const brig = (await visitante.get("/catalogo")).produtos.find((p) => p.nome === "Brigadeiro Tradicional");
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i9"] } }, { produto_id: brig.id, qtd: 3 }],
      tipo: "retirada", ...agenda, pagamento: "dinheiro",
    });
    const msgs = o.problemas.map((p) => p.mensagem).join(" | ");
    assert.match(msgs, /opção inválida/);
    assert.match(msgs, /pedido mínimo de 10 un/);
  });

  it("cria o pedido, gera código e devolve o histórico", async () => {
    const r = await loja.post("/pedidos", {
      itens: [{ produto_id: bolo.id, qtd: 2, opcoes: { g1: ["g1i2"], g2: ["g2i1", "g2i3"] }, obs: "Sem nozes" }],
      tipo: "entrega", endereco_id: enderecoId, ...agenda, pagamento: "dinheiro", troco_para: 50000,
      cupom: "BEMVINDO10", observacoes: "Tocar o interfone",
    });
    pedido = r.pedido;
    assert.match(pedido.codigo, /^LA\d{4,}$/);
    assert.equal(pedido.status, "novo");
    assert.equal(pedido.total, 30282);
    assert.equal(pedido.itens[0].opcoes.length, 2);
    assert.equal(pedido.itens[0].opcoes[1].itens.length, 2);
    assert.equal(pedido.historico.length, 1);
    assert.equal(pedido.endereco.rua, "Praça da Sé");
    assert.equal(pedido.cliente.nome, "Maria Souza");
    assert.match(pedido.criado_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("um pedido inválido é recusado com o motivo", async () => {
    const e = await falha(loja.post("/pedidos", { itens: [], tipo: "retirada", ...agenda, pagamento: "dinheiro" }));
    assert.equal(e.status, 422);
    assert.equal(e.message, "Seu carrinho está vazio.");
    assert.ok(e.campos.itens);
  });

  it("cupom de primeira compra não vale para a segunda", async () => {
    const o = await loja.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "dinheiro", cupom: "BEMVINDO10",
    });
    assert.ok(o.problemas.some((p) => p.campo === "cupom"));
  });

  it("um cliente não enxerga nem cancela o pedido de outro", async () => {
    const intruso = navegadorLoja();
    await intruso.post("/auth/cadastro", { nome: "Outro Cliente", email: "outro@teste.com", telefone: "11999998888", senha: "Senha1234" });
    assert.equal((await falha(intruso.get(`/pedidos/${pedido.codigo}`))).status, 404);
    assert.equal((await falha(intruso.post(`/pedidos/${pedido.codigo}/cancelar`, { motivo: "x" }))).status, 404);
    assert.equal((await intruso.get("/pedidos")).pedidos.length, 0);
  });

  it("o endereço de outro cliente não serve para a entrega", async () => {
    const intruso = navegadorLoja();
    await intruso.post("/auth/entrar", { email: "outro@teste.com", senha: "Senha1234" });
    const o = await intruso.post("/pedidos/orcamento", {
      itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "entrega", endereco_id: enderecoId, ...agenda, pagamento: "dinheiro",
    });
    assert.ok(o.problemas.some((p) => p.campo === "endereco" && /Escolha o endereço/.test(p.mensagem)));
  });
});

describe("painel administrativo", () => {
  it("cliente não acessa o painel; admin entra", async () => {
    await emu.criarAdmin("admin@teste.local", "Admin12345");
    assert.equal((await falha(painel.post("/auth/entrar", { email: "admin@teste.local", senha: "errada" }))).status, 401);
    assert.equal((await falha(painel.post("/auth/entrar", { email: "maria@teste.com", senha: "Senha1234" }))).status, 403);
    assert.equal((await painel.post("/auth/entrar", { email: "admin@teste.local", senha: "Admin12345" })).usuario.papel, "admin");
    const comoCliente = navegadorPainel();
    await comoCliente.supabase.auth.signInWithPassword({ email: "maria@teste.com", password: "Senha1234" });
    assert.equal((await falha(comoCliente.get("/pedidos/contagem"))).status, 403, "cliente logado é barrado pelo banco");
    assert.equal((await comoCliente.get("/auth/eu")).usuario, null);
  });

  it("lista o pedido novo, a contagem por status e os avisos de pedido novo", async () => {
    const l = await painel.get("/pedidos?status=ativos");
    assert.equal(l.itens[0].codigo, pedido.codigo);
    assert.equal(l.itens[0].qtd_itens, 2);
    assert.equal((await painel.get("/pedidos/contagem")).novo, 1);
    const n = await painel.get("/pedidos/novos?desde=0");
    assert.equal(n.novos.length, 1);
    assert.equal((await painel.get(`/pedidos/novos?desde=${n.ultimo_id}`)).novos.length, 0);
    assert.equal((await painel.get(`/pedidos?status=todos&busca=${pedido.codigo}`)).total, 1);
    assert.equal((await painel.get("/pedidos?status=todos&busca=zzzz")).total, 0);
  });

  it("configura PIX e o pedido passa a trazer os dados do copia-e-cola", async () => {
    const ruim = await falha(painel.put("/configuracoes/pagamento", { pix_ativo: true, pix_chave: "", pix_nome: "", pix_cidade: "", dinheiro_ativo: true, cartao_ativo: true }));
    assert.equal(ruim.status, 422);
    assert.ok(ruim.campos.pix_chave);
    await painel.put("/configuracoes/pagamento", { pix_ativo: true, pix_chave: "loja@teste.com", pix_nome: "Doceria Exemplo", pix_cidade: "Sao Paulo", dinheiro_ativo: true, cartao_ativo: true });
    assert.equal((await visitante.get("/config")).pagamento.pix_ativo, true);

    const r = await loja.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "pix" });
    const pix = gerarPix(r.pedido.pix);
    assert.match(pix, /^000201.*br\.gov\.bcb\.pix.*6304[0-9A-F]{4}$/);
    assert.ok(pix.includes("540589.90"), "valor do pedido no BR Code");
    assert.ok(pix.includes("LA" + r.pedido.id));
    const c = await loja.post(`/pedidos/${r.pedido.codigo}/cancelar`, { motivo: "Mudei de ideia" });
    assert.equal(c.pedido.status, "cancelado");
    assert.equal(c.pedido.pix, undefined, "PIX some depois de cancelado");
  });

  it("segue o fluxo de status e recusa transições inválidas", async () => {
    const mudar = (status, nota = "") => painel.patch(`/pedidos/${pedido.id}/status`, { status, nota });
    assert.equal((await falha(mudar("entregue"))).status, 409);
    const semMotivo = await falha(mudar("cancelado"));
    assert.equal(semMotivo.status, 422);
    for (const s of ["confirmado", "em_preparo", "pronto", "saiu_entrega", "entregue"]) await mudar(s);
    const final = (await loja.get(`/pedidos/${pedido.codigo}`)).pedido;
    assert.equal(final.status, "entregue");
    assert.equal(final.historico.length, 6);
    assert.equal((await falha(mudar("confirmado"))).status, 409);
  });

  it("cliente avalia o pedido entregue; admin aprova e a avaliação aparece na vitrine", async () => {
    assert.equal((await falha(loja.post(`/pedidos/${pedido.codigo}/avaliar`, { nota: 9, comentario: "" }))).status, 422);
    const a = await loja.post(`/pedidos/${pedido.codigo}/avaliar`, { nota: 5, comentario: "Bolo maravilhoso!" });
    assert.equal(a.pedido.avaliacao.nota, 5);
    assert.equal((await falha(loja.post(`/pedidos/${pedido.codigo}/avaliar`, { nota: 4, comentario: "de novo" }))).status, 409);

    assert.equal((await visitante.get("/avaliacoes")).avaliacoes.length, 0, "não aprovada ainda");
    const lista = await painel.get("/avaliacoes");
    await painel.patch(`/avaliacoes/${lista.avaliacoes[0].id}`, { aprovada: true, resposta: "Obrigada, Maria!" });
    const pub = await visitante.get("/avaliacoes");
    assert.equal(pub.avaliacoes[0].nome, "Maria");
    assert.equal(pub.avaliacoes[0].resposta, "Obrigada, Maria!");
    assert.equal(pub.total, 1);
  });

  it("não deixa avaliar pedido que ainda não foi entregue", async () => {
    const novo = await loja.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "dinheiro" });
    assert.equal((await falha(loja.post(`/pedidos/${novo.pedido.codigo}/avaliar`, { nota: 5, comentario: "cedo" }))).status, 409);
    await loja.post(`/pedidos/${novo.pedido.codigo}/cancelar`, { motivo: "teste" });
  });
});

describe("cardápio no painel", () => {
  let novoId, urlFoto;
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("cria produto com foto no Storage e opções, e ele aparece na loja", async () => {
    const cats = (await painel.get("/categorias")).categorias;
    const r = await painel.post("/produtos", {
      categoria_id: cats[0].id, nome: "Bolo de Teste", descricao: "Só para testar", preco: 5000, unidade: "bolo", min_qtd: 1,
      emoji: "🧪", tag: "Novo", antecedencia_horas: 48, ativo: true, destaque: true, imagem_nova: PNG,
      opcoes: [{ nome: "Cobertura", tipo: "unica", obrigatorio: true, itens: [{ nome: "Chocolate", preco: 0 }, { nome: "Morango", preco: 300 }] }],
    });
    novoId = r.produto.id;
    urlFoto = r.produto.imagem;
    assert.match(urlFoto, /\/storage\/v1\/object\/public\/produtos\/[0-9a-f-]{36}\/[\w-]+\.png$/);
    assert.equal(r.produto.opcoes[0].itens[1].id, "g1i2");
    assert.equal((await fetch(urlFoto)).status, 200);
    assert.ok((await visitante.get("/catalogo")).produtos.some((p) => p.id === novoId));
  });

  it("só administrador envia fotos (o Storage recusa cliente e visitante)", async () => {
    const cliente = navegadorLoja();
    await cliente.supabase.auth.signInWithPassword({ email: "maria@teste.com", password: "Senha1234" });
    const blob = new Blob([Buffer.from("x")], { type: "image/png" });
    assert.ok((await cliente.supabase.storage.from("produtos").upload("invasor.png", blob, { contentType: "image/png" })).error);
    assert.ok((await visitante.supabase.storage.from("produtos").upload("invasor2.png", blob, { contentType: "image/png" })).error);
  });

  it("recusa foto inválida, tipo não permitido e preço/nome inválidos", async () => {
    const cats = (await painel.get("/categorias")).categorias;
    const base = { categoria_id: cats[0].id, nome: "X Falso", descricao: "", preco: 100, unidade: "un", min_qtd: 1, emoji: "x", ativo: true, destaque: false };
    assert.equal((await falha(painel.post("/produtos", { ...base, imagem_nova: "data:text/plain;base64,aGVsbG8=" }))).status, 422);
    assert.equal((await falha(painel.post("/produtos", { ...base, imagem_nova: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }))).status, 422);
    assert.equal((await falha(painel.post("/produtos", { ...base, preco: -5 }))).status, 422);
    assert.equal((await falha(painel.post("/produtos", { ...base, nome: "a" }))).campos.nome.length > 0, true);
    assert.equal((await falha(painel.post("/produtos", { ...base, categoria_id: 99999 }))).status, 422);
    assert.equal((await falha(painel.post("/produtos", { ...base, opcoes: [{ nome: "Sem opções", itens: [] }] }))).status, 422);
  });

  it("só aceita imagem que está no nosso Storage", async () => {
    const cats = (await painel.get("/categorias")).categorias;
    const e = await falha(painel.put(`/produtos/${novoId}`, {
      categoria_id: cats[0].id, nome: "Bolo de Teste", descricao: "", preco: 5000, unidade: "bolo", min_qtd: 1, emoji: "x", ativo: true, destaque: false,
      opcoes: [], imagem: "https://site-malicioso.com/foto.png",
    }));
    assert.equal(e.status, 422);
  });

  it("a antecedência própria do produto vale no pedido; desativar tira da loja", async () => {
    const perto = await loja.post("/pedidos/orcamento", { itens: [{ produto_id: novoId, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "dinheiro" });
    assert.deepEqual(perto.problemas, []);
    assert.equal(perto.antecedencia_horas, 48);

    await painel.patch(`/produtos/${novoId}`, { ativo: false });
    assert.ok(!(await visitante.get("/catalogo")).produtos.some((p) => p.id === novoId));
    const sem = await loja.post("/pedidos/orcamento", { itens: [{ produto_id: novoId, qtd: 1 }], tipo: "retirada", ...agenda, pagamento: "dinheiro" });
    assert.ok(sem.problemas.some((p) => /não está mais disponível/.test(p.mensagem)));
  });

  it("trocar a foto apaga a antiga; excluir o produto apaga a foto", async () => {
    const cats = (await painel.get("/categorias")).categorias;
    const base = { categoria_id: cats[0].id, nome: "Bolo de Teste", descricao: "", preco: 5000, unidade: "bolo", min_qtd: 1, emoji: "x", ativo: true, destaque: false, opcoes: [] };
    const trocado = await painel.put(`/produtos/${novoId}`, { ...base, imagem_nova: PNG });
    assert.notEqual(trocado.produto.imagem, urlFoto);
    assert.equal((await fetch(urlFoto)).status, 404, "foto antiga removida");
    assert.equal((await fetch(trocado.produto.imagem)).status, 200);

    await painel.delete(`/produtos/${novoId}`);
    assert.equal((await fetch(trocado.produto.imagem)).status, 404, "foto do produto excluído removida");
  });

  it("não deixa apagar categoria com produtos; cria, reordena e apaga categoria vazia", async () => {
    const cats = (await painel.get("/categorias")).categorias;
    assert.equal((await falha(painel.delete(`/categorias/${cats[0].id}`))).status, 409);
    const nova = (await painel.post("/categorias", { nome: "Salgados", emoji: "🥐", ativa: true })).categorias.find((c) => c.nome === "Salgados");
    const ids = (await painel.get("/categorias")).categorias.map((c) => c.id);
    const reord = await painel.put("/categorias/ordem", { ids: [nova.id, ...ids.filter((i) => i !== nova.id)] });
    assert.equal(reord.categorias[0].nome, "Salgados");
    assert.equal((await painel.delete(`/categorias/${nova.id}`)).categorias.some((c) => c.nome === "Salgados"), false);
  });

  it("texto com aspas e código é guardado como texto (sem injeção)", async () => {
    const cats = (await painel.get("/categorias")).categorias;
    const nome = `Bolo '); drop table produtos; -- <img src=x onerror=alert(1)>`;
    const r = await painel.post("/produtos", { categoria_id: cats[0].id, nome, descricao: "", preco: 100, unidade: "un", min_qtd: 1, emoji: "x", ativo: true, destaque: false });
    assert.equal(r.produto.nome, nome);
    assert.ok((await painel.get("/produtos")).produtos.length > 20, "a tabela continua de pé");
    await painel.delete(`/produtos/${r.produto.id}`);
  });
});

describe("favoritos, clientes, resumo e configurações", () => {
  it("favorita, aparece no catálogo do cliente e no ranking do painel", async () => {
    assert.deepEqual(await loja.put(`/favoritos/${bolo.id}`), { favorito: true });
    assert.deepEqual((await loja.get("/catalogo")).favoritos, [bolo.id]);
    assert.equal((await falha(loja.put("/favoritos/999999"))).status, 404);
    const rank = await painel.get("/favoritos");
    assert.equal(rank.ranking[0].id, bolo.id);
    assert.equal(rank.ranking[0].favoritos, 1);
    assert.equal(rank.total_favoritos, 1);
    assert.deepEqual(await loja.delete(`/favoritos/${bolo.id}`), { favorito: false });
    await loja.put(`/favoritos/${bolo.id}`);
  });

  it("lista clientes com totais, bloqueia (efeito imediato) e desbloqueia; envia e-mail de redefinição", async () => {
    const lista = (await painel.get("/clientes?busca=maria")).clientes;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].pedidos, 1); // os cancelados não contam
    assert.equal(lista[0].gasto, 30282);
    const det = await painel.get(`/clientes/${lista[0].id}`);
    assert.equal(det.enderecos.length, 1);
    assert.equal(det.pedidos.length >= 1, true);
    assert.equal(det.favoritos.length, 1);

    await painel.patch(`/clientes/${lista[0].id}`, { ativo: false });
    assert.equal((await falha(loja.get("/pedidos"))).status, 401, "cliente bloqueado cai na hora");
    assert.equal((await falha(navegadorLoja().post("/auth/entrar", { email: "maria@teste.com", senha: "Senha1234" }))).status, 401);
    await painel.patch(`/clientes/${lista[0].id}`, { ativo: true });
    assert.equal((await loja.get("/pedidos")).pedidos.length >= 1, true);

    await painel.post(`/clientes/${lista[0].id}/senha`, { email: "maria@teste.com" });
    assert.ok(emu.emails.some((m) => m.email === "maria@teste.com" && m.redirecionar === "http://loja.exemplo"));
  });

  it("resumo traz KPIs coerentes e série completa", async () => {
    const r = await painel.get("/resumo?dias=14");
    assert.equal(r.serie.length, 14);
    assert.equal(r.kpis.pedidos_hoje, 1);
    assert.equal(r.kpis.faturamento_hoje, 30282);
    assert.equal(r.kpis.ticket_medio_mes, 30282);
    assert.ok(r.top_produtos.length >= 1);
    assert.equal(r.serie.at(-1).total, 30282);
    assert.equal((await painel.get("/resumo?dias=90")).serie.length, 90);
  });

  it("cupons, faixas de entrega e horários validam e persistem", async () => {
    const dup = await falha(painel.post("/cupons", { codigo: "bemvindo10", descricao: "", tipo: "percentual", valor: 5, minimo: 0, validade: "", limite_uso: "", primeira_compra: false, ativo: true }));
    assert.equal(dup.status, 409);
    const criado = await painel.post("/cupons", { codigo: "promo5", descricao: "5 reais", tipo: "valor", valor: 500, minimo: 0, validade: "", limite_uso: 1, primeira_compra: false, ativo: true });
    assert.ok(criado.cupons.some((c) => c.codigo === "PROMO5" && c.limite_uso === 1));
    assert.equal((await falha(painel.post("/cupons", { codigo: "X", descricao: "", tipo: "percentual", valor: 150, minimo: 0, primeira_compra: false, ativo: true }))).status, 422);
    assert.equal((await falha(painel.post("/cupons", { codigo: "OKOK", descricao: "", tipo: "percentual", valor: 150, minimo: 0, primeira_compra: false, ativo: true }))).campos.valor.length > 0, true);

    const z = await painel.post("/zonas", { nome: "Até 15 km", ate_km: 15, taxa: 2000, prazo_min: 120, ativa: true });
    assert.equal(z.zonas.length, 4);
    assert.equal((await visitante.get("/config")).zonas.length, 4);
    assert.equal((await falha(painel.post("/zonas", { nome: "Ruim", ate_km: 0, taxa: 1, prazo_min: 60, ativa: true }))).status, 422);

    const dias = (aberto, abre, fecha) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { aberto, abre, fecha }]));
    const h = await painel.put("/configuracoes/horarios", dias(true, "10:00", "17:00"));
    assert.equal(h.configuracoes.horarios[1].abre, "10:00");
    assert.equal((await falha(painel.put("/configuracoes/horarios", dias(true, "18:00", "09:00")))).status, 422);
    assert.equal((await falha(painel.put("/configuracoes/horarios", dias(true, "9h", "17:00")))).status, 422);
    await painel.put("/configuracoes/horarios", { ...dias(true, "09:00", "18:00"), 0: { aberto: false, abre: "09:00", fecha: "15:00" }, 6: { aberto: true, abre: "09:00", fecha: "15:00" } });
    assert.equal((await falha(painel.put("/configuracoes/entrega", { entrega_ativa: false, retirada_ativa: false, gratis_acima: 0, taxa_padrao: 0 }))).status, 422);
    assert.equal((await falha(painel.put("/configuracoes/inexistente", {}))).status, 422);
  });

  it("dados da loja e textos do site são salvos e validados", async () => {
    const cfg = (await painel.get("/configuracoes")).configuracoes;
    const salvo = await painel.put("/configuracoes/loja", { ...cfg.loja, whatsapp: "(11) 91234-5678", instagram: "@minhaloja", email: "" });
    assert.equal(salvo.configuracoes.loja.whatsapp, "11912345678");
    assert.equal(salvo.configuracoes.loja.instagram, "minhaloja");
    assert.equal(salvo.configuracoes.loja.lat, cfg.loja.lat, "a localização não se perde");
    assert.equal((await falha(painel.put("/configuracoes/loja", { ...cfg.loja, nome: "A" }))).status, 422);
    const t = await painel.put("/configuracoes/textos", { ...cfg.textos, hero_titulo: "Doces para todo mundo", sobre_texto: "Primeiro parágrafo.\n\nSegundo parágrafo." });
    assert.equal((await visitante.get("/config")).textos.hero_titulo, "Doces para todo mundo");
    assert.ok(t.configuracoes.textos.sobre_texto.includes("\n"), "quebras de parágrafo preservadas");
  });

  it("pausar pedidos bloqueia novas compras com a mensagem da loja", async () => {
    await painel.put("/configuracoes/pedidos", { pausados: true, mensagem_pausa: "Voltamos logo", antecedencia_horas: 24, pedido_minimo: 0, intervalo_min: 30, dias_maximos: 45 });
    const e = await falha(loja.post("/pedidos", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "dinheiro" }));
    assert.equal(e.status, 422);
    assert.match(e.message, /Voltamos logo/);
    await painel.put("/configuracoes/pedidos", { pausados: false, mensagem_pausa: "Voltamos logo", antecedencia_horas: 24, pedido_minimo: 0, intervalo_min: 30, dias_maximos: 45 });
  });

  it("pedido mínimo e frete grátis são aplicados", async () => {
    await painel.put("/configuracoes/pedidos", { pausados: false, mensagem_pausa: "", antecedencia_horas: 24, pedido_minimo: 20000, intervalo_min: 30, dias_maximos: 45 });
    const baixo = await loja.post("/pedidos/orcamento", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "retirada", ...agenda, pagamento: "dinheiro" });
    assert.ok(baixo.problemas.some((p) => /pedido mínimo é de R\$ 200,00/.test(p.mensagem)));
    await painel.put("/configuracoes/pedidos", { pausados: false, mensagem_pausa: "", antecedencia_horas: 24, pedido_minimo: 0, intervalo_min: 30, dias_maximos: 45 });

    await painel.put("/configuracoes/entrega", { entrega_ativa: true, retirada_ativa: true, gratis_acima: 5000, taxa_padrao: 0 });
    const gratis = await loja.post("/pedidos/orcamento", { itens: [{ produto_id: bolo.id, qtd: 1, opcoes: { g1: ["g1i1"] } }], tipo: "entrega", endereco_id: enderecoId, ...agenda, pagamento: "dinheiro" });
    assert.equal(gratis.taxa_entrega, 0);
    await painel.put("/configuracoes/entrega", { entrega_ativa: true, retirada_ativa: true, gratis_acima: 0, taxa_padrao: 0 });
  });

  it("equipe: dá acesso de admin a quem já tem conta e protege o último administrador", async () => {
    assert.equal((await falha(painel.post("/equipe", { email: "ninguem@teste.com" }))).status, 404);
    await painel.post("/equipe", { email: "outro@teste.com" });
    const equipe = (await painel.get("/equipe")).equipe;
    assert.equal(equipe.length, 2);
    const outroAdmin = equipe.find((u) => u.email === "outro@teste.com");
    const eu = equipe.find((u) => u.email === "admin@teste.local");
    assert.equal((await falha(painel.patch(`/equipe/${eu.id}`, { ativo: false }))).status, 409, "não desativa a si mesmo");
    await painel.patch(`/equipe/${outroAdmin.id}`, { ativo: false });
    await sql(emu.db, "update public.perfis set papel = 'cliente' where lower(email) = 'outro@teste.com'");
  });

  it("troca de senha do admin: a antiga deixa de valer e a nova funciona", async () => {
    assert.equal((await falha(painel.put("/conta/senha", { atual: "errada", nova: "Nova12345" }))).status, 422);
    await painel.put("/conta/senha", { atual: "Admin12345", nova: "Nova12345" });
    assert.equal((await falha(navegadorPainel().post("/auth/entrar", { email: "admin@teste.local", senha: "Admin12345" }))).status, 401);
    assert.equal((await navegadorPainel().post("/auth/entrar", { email: "admin@teste.local", senha: "Nova12345" })).usuario.email, "admin@teste.local");
    const r = await painel.put("/conta", { nome: "Dona da Loja" });
    assert.equal(r.usuario.nome, "Dona da Loja");
  });
});
