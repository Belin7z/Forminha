/* ==========================================================
   EQUIPE — funcionários da Forminha e o que cada função pode fazer.
   • Cada pessoa entra com um usuário próprio da Forminha, nunca com
     e-mail: "FM" + a letra da função + um número (FMV-0427 = vendedor).
     Se a função mudar, muda só a letra; o número fica.
   • Nasce com uma senha temporária (mostrada uma vez para você) e
     cria a própria senha no primeiro acesso.
   • Nome cifrado; da senha, só o resumo. Desativar ou gerar senha
     nova derruba as sessões abertas na hora.
   • Toda ação importante vai para "atividades": quem, o quê, quando.
   ========================================================== */
import { randomInt, randomUUID } from "node:crypto";
import { SENHA_MINIMA, conferirSenha, resumirSenha } from "./sessao.js";
import { ErroHttp } from "./erros.js";

export const PERMISSOES = {
  "clientes.ver": "Ver clientes e fichas",
  "clientes.cadastrar": "Cadastrar cliente e gerar a cobrança",
  "clientes.editar": "Editar os dados da cliente",
  "clientes.notas": "Anotar na ficha",
  "pagamentos.cobrar": "Reenviar cobrança e gerar cobrança nova",
  "pagamentos.confirmar": "Confirmar pagamento recebido",
  "pagamentos.cancelar": "Cancelar cadastro",
  "lojas.ver": "Ver as lojas",
  "lojas.suporte": "Suporte da loja: convite, link novo, redefinir senha da dona, retomar criação, atualizar e reativar",
  "lojas.criar": "Criar loja sem cobrança",
  "lojas.excluir": "Excluir loja",
  "configuracoes": "Configurações da Central",
  "equipe": "Equipe",
};
export const TODAS = Object.keys(PERMISSOES);

export const FUNCOES = {
  gerente: {
    nome: "Gerente", letra: "G", descricao: "Clientes, pagamentos e lojas.",
    permissoes: ["clientes.ver", "clientes.cadastrar", "clientes.editar", "clientes.notas", "pagamentos.cobrar", "pagamentos.confirmar", "pagamentos.cancelar", "lojas.ver", "lojas.suporte", "lojas.criar"],
  },
  vendedor: {
    nome: "Vendedor", letra: "V", descricao: "Cadastra clientes e cobra.",
    permissoes: ["clientes.ver", "clientes.cadastrar", "clientes.editar", "clientes.notas", "pagamentos.cobrar"],
  },
  suporte: {
    nome: "Suporte", letra: "S", descricao: "Atende as donas de loja.",
    permissoes: ["clientes.ver", "clientes.editar", "clientes.notas", "lojas.ver", "lojas.suporte"],
  },
  financeiro: {
    nome: "Financeiro", letra: "F", descricao: "Confirma e cancela pagamentos.",
    permissoes: ["clientes.ver", "clientes.notas", "pagamentos.cobrar", "pagamentos.confirmar", "pagamentos.cancelar"],
  },
};

const PADRAO_USUARIO = /^FM([GVSF])-?(\d{4})$/;
export const usuarioDe = (funcao, numero) => `FM${FUNCOES[funcao].letra}-${String(numero).padStart(4, "0")}`;
/** "fmv 0427", "FMV0427" e "FMV-0427" viram { letra: "V", numero: 427 }; outra coisa, null. */
export function lerUsuario(texto) {
  const m = PADRAO_USUARIO.exec(String(texto ?? "").toUpperCase().replace(/\s+/g, ""));
  return m ? { letra: m[1], numero: Number(m[2]) } : null;
}

// senha temporária fácil de ditar: sem letras que confundem (0/O, 1/l/I)
const LETRAS = "abcdefghjkmnpqrstuvwxyz23456789";
export const senhaTemporaria = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + LETRAS[randomInt(LETRAS.length)]).join("");

export function criarEquipe({ banco, cofre, preparar = async () => {} }) {
  const sql = async (texto, p = []) => { await preparar(); return banco.consultar(texto, p); };
  const abrir = (f) => ({
    id: f.id, usuario: usuarioDe(f.funcao, f.numero), funcao: f.funcao, funcao_nome: FUNCOES[f.funcao].nome,
    nome: cofre.decifrar(f.nome, `funcionario:${f.id}`), ativo: f.ativo, trocar_senha: f.trocar_senha,
    criado_em: f.criado_em, ultimo_acesso: f.ultimo_acesso, versao: f.versao,
  });
  const publico = ({ versao, ...f }) => f;

  function validar({ nome, funcao }) {
    const campos = {};
    const n = String(nome ?? "").replace(/\s+/g, " ").trim();
    if (n.length < 2 || n.length > 80) campos.nome = "Nome: de 2 a 80 letras.";
    if (!FUNCOES[funcao]) campos.funcao = "Escolha a função.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    return { nome: n, funcao };
  }

  async function linha(id) {
    const [f] = /^[0-9a-f-]{36}$/.test(String(id)) ? await sql("select * from funcionarios where id = $1", [id]) : [];
    if (!f) throw new ErroHttp(404, "Funcionário não encontrado.");
    return f;
  }

  async function listar() {
    return (await sql("select * from funcionarios order by ativo desc, criado_em")).map((f) => publico(abrir(f)));
  }

  async function criar(corpo) {
    const { nome, funcao } = validar(corpo);
    const senha = senhaTemporaria();
    const hash = await resumirSenha(senha);
    for (let tentativa = 0; tentativa < 30; tentativa++) {
      const id = randomUUID();
      const numero = randomInt(1000, 10000);
      const [f] = await sql(`insert into funcionarios (id, numero, funcao, nome, senha_hash) values ($1, $2, $3, $4, $5)
        on conflict (numero) do nothing returning *`, [id, numero, funcao, cofre.cifrar(nome, `funcionario:${id}`), hash]);
      if (f) return { funcionario: publico(abrir(f)), senha_temporaria: senha };
    }
    throw new ErroHttp(409, "Não consegui gerar um usuário livre. Tente de novo.");
  }

  async function editar(id, corpo) {
    const f = await linha(id);
    const { nome, funcao } = validar({ nome: corpo.nome ?? abrir(f).nome, funcao: corpo.funcao ?? f.funcao });
    const [novo] = await sql("update funcionarios set nome = $2, funcao = $3 where id = $1 returning *", [id, cofre.cifrar(nome, `funcionario:${id}`), funcao]);
    return publico(abrir(novo));
  }

  /** Senha temporária nova (esqueceu a senha): derruba as sessões abertas. */
  async function novaSenha(id) {
    await linha(id);
    const senha = senhaTemporaria();
    const [f] = await sql("update funcionarios set senha_hash = $2, trocar_senha = true, versao = versao + 1 where id = $1 returning *", [id, await resumirSenha(senha)]);
    return { funcionario: publico(abrir(f)), senha_temporaria: senha };
  }

  async function definirAtivo(id, ativo) {
    await linha(id);
    const [f] = await sql(`update funcionarios set ativo = $2, versao = versao + (case when $2 then 0 else 1 end) where id = $1 returning *`, [id, Boolean(ativo)]);
    return publico(abrir(f));
  }

  async function excluir(id) {
    const f = await linha(id);
    await sql("delete from funcionarios where id = $1", [id]);
    return { usuario: usuarioDe(f.funcao, f.numero) };
  }

  /** Login com o usuário da Forminha. Devolve o funcionário (ativo) ou null. */
  async function entrar(usuario, senha) {
    const u = lerUsuario(usuario);
    const [f] = u ? await sql("select * from funcionarios where numero = $1", [u.numero]) : [];
    // confere a senha mesmo sem achar ninguém: a resposta demora igual nos dois casos
    const ok = await conferirSenha(String(senha ?? ""), f?.senha_hash ?? "scrypt$00$00");
    if (!f || !ok || !f.ativo || FUNCOES[f.funcao].letra !== u.letra) return null;
    await sql("update funcionarios set ultimo_acesso = now() where id = $1", [f.id]);
    return abrir(f);
  }

  /** Quem está nesta sessão (null se foi desativado, excluído ou a senha mudou depois). */
  async function daSessao(id, versao) {
    const [f] = /^[0-9a-f-]{36}$/.test(String(id)) ? await sql("select * from funcionarios where id = $1", [id]) : [];
    return f && f.ativo && f.versao === versao ? abrir(f) : null;
  }

  /** O próprio funcionário cria/troca a senha (no 1º acesso, a atual é a temporária). */
  async function trocarMinhaSenha(id, { atual, nova, repita }) {
    const f = await linha(id);
    const campos = {};
    if (!(await conferirSenha(String(atual ?? ""), f.senha_hash))) campos.atual = f.trocar_senha ? "Senha temporária incorreta." : "Senha atual incorreta.";
    if (String(nova ?? "").length < SENHA_MINIMA) campos.nova = `Use ${SENHA_MINIMA} caracteres ou mais.`;
    else if (String(nova).length > 200) campos.nova = "Senha longa demais.";
    else if (nova === atual) campos.nova = "Escolha uma senha diferente da atual.";
    else if (nova !== repita) campos.repita = "As duas não conferem.";
    if (Object.keys(campos).length) throw new ErroHttp(422, Object.values(campos)[0], campos);
    const [novo] = await sql("update funcionarios set senha_hash = $2, trocar_senha = false, versao = versao + 1 where id = $1 returning *", [id, await resumirSenha(nova)]);
    return abrir(novo);
  }

  /* ---------- atividades ---------- */
  async function registrar({ quem, usuario, acao, alvo = "" }) {
    await sql("insert into atividades (quem, usuario, acao, alvo) values ($1, $2, $3, $4)", [quem, usuario, acao, String(alvo ?? "").slice(0, 120)]);
  }
  async function atividades({ quem = null, limite = 60 } = {}) {
    return sql(`select id, em, quem, usuario, acao, alvo from atividades ${quem ? "where quem = $2" : ""} order by em desc, id desc limit $1`,
      quem ? [Math.min(200, limite), quem] : [Math.min(200, limite)]);
  }
  /** Nome público da loja de uma cliente (para a atividade dizer "Confirmou pagamento · Doce da Ana"). */
  async function lojaDaCliente(clienteId) {
    const [c] = /^[0-9a-f-]{36}$/.test(String(clienteId)) ? await sql("select nome_loja from clientes where id = $1", [clienteId]) : [];
    return c?.nome_loja ?? "";
  }

  return { listar, criar, editar, novaSenha, definirAtivo, excluir, entrar, daSessao, trocarMinhaSenha, registrar, atividades, lojaDaCliente };
}
