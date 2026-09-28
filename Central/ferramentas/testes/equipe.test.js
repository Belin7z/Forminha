/* ==========================================================
   EQUIPE — funcionários da Forminha com usuário próprio e função:
     - usuário FM + letra da função + número (FMV-0427), sem e-mail;
     - senha temporária: no 1º acesso só dá para criar a própria senha;
     - cada função só faz o que pode (o banco de rotas recusa o resto);
     - o histórico da cliente e as atividades dizem quem fez o quê;
     - mudar a função, gerar senha nova, desativar e excluir valem na hora.
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarCentral } from "../../lib/central.js";
import { resumirSenha } from "../../lib/sessao.js";
import { novaChave } from "../../lib/cofre.js";
import { FUNCOES, lerUsuario, senhaTemporaria, usuarioDe } from "../../lib/equipe.js";
import { bancoDeTeste, criarSimulado } from "../simulado.js";

const SENHA_DONO = "senha-do-dono-2026";
let sim, banco, servidor, base, dono;

async function api(metodo, caminho, corpo, cookie = dono) {
  const r = await fetch(`${base}/api/${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, dados: texto ? JSON.parse(texto) : null, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const entrar = (usuario, senha) => api("POST", "entrar", { usuario, senha }, null);
/** Cria o funcionário e faz o 1º acesso dele (senha temporária -> senha própria). Devolve o cookie. */
async function contratar(nome, funcao, senha = "minha-senha-123") {
  const { dados } = await api("POST", "equipe", { nome, funcao });
  const temp = await entrar(dados.funcionario.usuario, dados.senha_temporaria);
  const troca = await api("POST", "minha-senha", { atual: dados.senha_temporaria, nova: senha, repita: senha }, temp.cookie);
  assert.equal(troca.status, 200, JSON.stringify(troca.dados));
  return { ...dados.funcionario, cookie: troca.cookie, senha };
}

before(async () => {
  sim = criarSimulado();
  banco = await bancoDeTeste();
  const env = {
    ...sim.env, CENTRAL_EMAIL: "dono@teste.local", CENTRAL_SENHA_HASH: await resumirSenha(SENHA_DONO), SEGREDO_SESSAO: "s".repeat(48),
    CRON_SECRET: "cron", CHAVE_CRIPTOGRAFIA: novaChave(), URL_CENTRAL: "https://forminha.vercel.app",
  };
  const central = criarCentral(env, { fetchFn: sim.fetchFn, banco, esperaBancoMs: 1, email: null, mercadoPago: null, agendar: () => {} });
  servidor = createServer((req, res) => central.tratar(req, res));
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  dono = (await entrar("dono@teste.local", SENHA_DONO)).cookie;
  await api("PUT", "configuracoes", { valor_padrao_centavos: 19900, pix: { chave: "pix@forminha.test", nome: "Forminha", cidade: "Sao Paulo" } });
});
after(async () => { servidor?.close(); await sim?.fechar(); await banco?.fechar(); });

describe("usuário da Forminha", () => {
  it("FM + letra da função + número, lido de qualquer jeito que a pessoa digitar", () => {
    assert.equal(usuarioDe("vendedor", 427), "FMV-0427");
    assert.equal(usuarioDe("suporte", 1234), "FMS-1234");
    for (const escrito of ["FMV-0427", "fmv-0427", "FMV0427", " fmv 0427 "]) assert.deepEqual(lerUsuario(escrito), { letra: "V", numero: 427 });
    assert.equal(lerUsuario("ana@gmail.com"), null);
    assert.equal(lerUsuario("FMX-1234"), null, "letra de função que não existe");
    assert.equal(new Set(Object.values(FUNCOES).map((f) => f.letra)).size, Object.keys(FUNCOES).length, "cada função tem a sua letra");
  });
  it("senha temporária fácil de ditar (sem 0/O nem 1/l/I)", () => {
    for (let i = 0; i < 200; i++) assert.match(senhaTemporaria(), /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
  });
});

describe("cadastrar e primeiro acesso", () => {
  let ana, temporaria;

  it("você cadastra: sai o usuário e a senha temporária (o nome fica cifrado)", async () => {
    const r = await api("POST", "equipe", { nome: "Ana Souza", funcao: "vendedor" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    ana = r.dados.funcionario;
    temporaria = r.dados.senha_temporaria;
    assert.match(ana.usuario, /^FMV-\d{4}$/);
    assert.equal(ana.funcao_nome, "Vendedor");
    assert.equal(ana.trocar_senha, true);
    const [linha] = await banco.consultar("select nome, senha_hash from funcionarios where id = $1", [ana.id]);
    assert.doesNotMatch(linha.nome, /Ana/);
    assert.doesNotMatch(linha.senha_hash, new RegExp(temporaria));
    const errado = await api("POST", "equipe", { nome: "A", funcao: "chefe" });
    assert.equal(errado.status, 422);
    assert.ok(errado.dados.campos.nome && errado.dados.campos.funcao);
  });

  it("com a senha temporária, só dá para criar a própria senha", async () => {
    const r = await entrar(ana.usuario.toLowerCase().replace("-", " "), temporaria);
    assert.equal(r.status, 200);
    assert.equal(r.dados.trocar_senha, true);
    const eu = (await api("GET", "eu", undefined, r.cookie)).dados;
    assert.equal(eu.quem.usuario, ana.usuario);
    assert.equal(eu.quem.trocar_senha, true);
    assert.equal((await api("GET", "clientes", undefined, r.cookie)).status, 403);
    let t = await api("POST", "minha-senha", { atual: "errada", nova: "nova-senha-1", repita: "nova-senha-1" }, r.cookie);
    assert.equal(t.status, 422); assert.ok(t.dados.campos.atual);
    t = await api("POST", "minha-senha", { atual: temporaria, nova: temporaria, repita: temporaria }, r.cookie);
    assert.equal(t.status, 422); assert.ok(t.dados.campos.nova);
    t = await api("POST", "minha-senha", { atual: temporaria, nova: "nova-senha-1", repita: "nova-senha-1" }, r.cookie);
    assert.equal(t.status, 200);
    assert.equal((await api("GET", "clientes", undefined, t.cookie)).status, 200, "com a senha própria, entra");
    assert.equal((await entrar(ana.usuario, temporaria)).status, 401, "a temporária não vale mais");
    assert.equal((await entrar(ana.usuario, "nova-senha-1")).status, 200);
    assert.equal((await entrar(ana.usuario.replace("FMV", "FMS"), "nova-senha-1")).status, 401, "o usuário tem que ser o da função certa");
  });
});

describe("cada função faz só o que pode", () => {
  let vendedora, financeiro, suporte, clienteId;

  before(async () => {
    vendedora = await contratar("Bia Lima", "vendedor");
    financeiro = await contratar("Carla Dias", "financeiro");
    suporte = await contratar("Davi Reis", "suporte");
  });

  it("vendedor cadastra cliente, mas não confirma pagamento nem mexe em lojas, equipe ou configurações", async () => {
    const r = await api("POST", "clientes", { nome: "Maria Doces", email: "maria@teste.local", telefone: "11987654321", nome_loja: "Doce da Maria", valor_centavos: 19900 }, vendedora.cookie);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    clienteId = r.dados.cliente.id;
    assert.equal((await api("POST", `clientes/${clienteId}/pagamento-recebido`, {}, vendedora.cookie)).status, 403);
    assert.equal((await api("POST", `clientes/${clienteId}/cancelar`, {}, vendedora.cookie)).status, 403);
    assert.equal((await api("GET", "lojas", undefined, vendedora.cookie)).status, 403);
    assert.equal((await api("GET", "equipe", undefined, vendedora.cookie)).status, 403);
    assert.equal((await api("GET", "atividades", undefined, vendedora.cookie)).status, 403);
    assert.equal((await api("PUT", "configuracoes", { valor_padrao_centavos: 1 }, vendedora.cookie)).status, 403);
    assert.equal((await api("POST", "senha", { atual: "x", nova: "y", repita: "y" }, vendedora.cookie)).status, 403, "a senha do dono é só dele");
    assert.equal((await api("GET", "configuracoes", undefined, vendedora.cookie)).status, 200, "vê o valor padrão para cadastrar");
    const eu = (await api("GET", "eu", undefined, vendedora.cookie)).dados;
    assert.deepEqual(eu.permissoes, FUNCOES.vendedor.permissoes);
    assert.deepEqual(eu.faltando, [], "o que falta configurar é assunto do dono");
  });

  it("financeiro confirma o pagamento; o histórico e o pagamento dizem quem foi", async () => {
    assert.equal((await api("POST", "clientes", { nome: "X", email: "x@teste.local", nome_loja: "X", valor_centavos: 100 }, financeiro.cookie)).status, 403);
    const r = await api("POST", `clientes/${clienteId}/pagamento-recebido`, {}, financeiro.cookie);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const ficha = (await api("GET", `clientes/${clienteId}`, undefined, financeiro.cookie)).dados;
    const quemFinanceiro = `${financeiro.usuario} · Carla`;
    assert.equal(ficha.pagamentos.find((p) => p.situacao === "aprovado").confirmado_por, quemFinanceiro);
    const textos = ficha.historico.map((h) => h.texto).join("\n");
    assert.match(textos, new RegExp(`Cliente cadastrada\\. \\(${vendedora.usuario} · Bia\\)`));
    assert.match(textos, new RegExp(`confirmado manualmente\\. \\(${quemFinanceiro}\\)`));
  });

  it("suporte vê as lojas e ajuda a dona, mas não cadastra nem cobra", async () => {
    assert.equal((await api("GET", "lojas", undefined, suporte.cookie)).status, 200);
    assert.equal((await api("POST", "clientes", { nome: "Y", email: "y@teste.local", nome_loja: "Y", valor_centavos: 100 }, suporte.cookie)).status, 403);
    assert.equal((await api("POST", `clientes/${clienteId}/cobrar`, {}, suporte.cookie)).status, 403);
    assert.equal((await api("POST", `clientes/${clienteId}/reenviar`, { tipo: "cobranca" }, suporte.cookie)).status, 403);
    const nota = await api("POST", `clientes/${clienteId}/notas`, { texto: "Liguei para a Maria." }, suporte.cookie);
    assert.equal(nota.status, 200);
    assert.ok(nota.dados.historico.some((h) => h.texto === `Liguei para a Maria. (${suporte.usuario} · Davi)`));
    assert.equal((await api("DELETE", "lojas/abcdefghijklmnopqrst", { codigo: "x" }, suporte.cookie)).status, 403, "excluir loja é só do dono");
  });

  it("as atividades mostram quem fez o quê (e dá para filtrar por pessoa)", async () => {
    const { atividades } = (await api("GET", "atividades")).dados;
    const linhas = atividades.map((a) => `${a.usuario} | ${a.acao} | ${a.alvo}`);
    assert.ok(linhas.includes(`${vendedora.usuario} | Cadastrou cliente | Doce da Maria`), linhas.join("\n"));
    assert.ok(linhas.includes(`${financeiro.usuario} | Confirmou pagamento | Doce da Maria`));
    assert.ok(linhas.includes(`${suporte.usuario} | Anotou na ficha | Doce da Maria`));
    assert.ok(linhas.includes(`${suporte.usuario} | Entrou | `));
    assert.ok(linhas.some((l) => l.startsWith(`Dono | Cadastrou funcionário | ${vendedora.usuario}`)));
    const soDela = (await api("GET", `atividades?quem=${vendedora.id}`)).dados.atividades;
    assert.ok(soDela.length > 0 && soDela.every((a) => a.usuario === vendedora.usuario));
    assert.ok(!JSON.stringify(atividades).includes("maria@teste.local"), "sem dados pessoais nas atividades");
  });
});

describe("mudanças valem na hora", () => {
  let eva;
  before(async () => { eva = await contratar("Eva Nunes", "vendedor", "senha-da-eva-1"); });

  it("mudar a função troca a letra do usuário (o número fica) e as permissões", async () => {
    const r = await api("PUT", `equipe/${eva.id}`, { funcao: "suporte" });
    assert.equal(r.status, 200);
    assert.equal(r.dados.usuario, eva.usuario.replace("FMV", "FMS"));
    assert.equal((await entrar(eva.usuario, eva.senha)).status, 401, "o usuário antigo não entra mais");
    assert.equal((await entrar(r.dados.usuario, eva.senha)).status, 200);
    assert.equal((await api("GET", "lojas", undefined, eva.cookie)).status, 200, "a sessão aberta já tem as permissões novas");
    eva = { ...eva, usuario: r.dados.usuario };
  });

  it("senha temporária nova (esqueceu): derruba a sessão e pede senha própria de novo", async () => {
    const r = await api("POST", `equipe/${eva.id}/nova-senha`, {});
    assert.equal(r.status, 200);
    assert.equal((await api("GET", "eu", undefined, eva.cookie)).dados.logado, false);
    assert.equal((await entrar(eva.usuario, eva.senha)).status, 401);
    const temp = await entrar(eva.usuario, r.dados.senha_temporaria);
    assert.equal(temp.dados.trocar_senha, true);
    const troca = await api("POST", "minha-senha", { atual: r.dados.senha_temporaria, nova: "outra-senha-2", repita: "outra-senha-2" }, temp.cookie);
    eva = { ...eva, senha: "outra-senha-2", cookie: troca.cookie };
  });

  it("desativar derruba na hora e impede entrar; reativar devolve o acesso", async () => {
    await api("POST", `equipe/${eva.id}/ativo`, { ativo: false });
    assert.equal((await api("GET", "eu", undefined, eva.cookie)).dados.logado, false);
    assert.equal((await entrar(eva.usuario, eva.senha)).status, 401);
    const lista = (await api("GET", "equipe")).dados.funcionarios;
    assert.equal(lista.find((f) => f.id === eva.id).ativo, false);
    await api("POST", `equipe/${eva.id}/ativo`, { ativo: true });
    assert.equal((await entrar(eva.usuario, eva.senha)).status, 200);
  });

  it("excluir tira o acesso de vez (as atividades antigas continuam)", async () => {
    const r = await api("DELETE", `equipe/${eva.id}`, {});
    assert.equal(r.status, 200);
    assert.equal((await entrar(eva.usuario, eva.senha)).status, 401);
    assert.equal((await api("GET", "equipe")).dados.funcionarios.some((f) => f.id === eva.id), false);
    assert.ok((await api("GET", `atividades?quem=${eva.id}`)).dados.atividades.length > 0);
  });

  it("o dono não pode pegar um usuário no formato da equipe", async () => {
    const r = await api("PUT", "conta", { email: "dono@teste.local", usuario: "FMV-1234", senha: SENHA_DONO });
    assert.equal(r.status, 422);
    assert.ok(r.dados.campos.usuario);
  });
});
