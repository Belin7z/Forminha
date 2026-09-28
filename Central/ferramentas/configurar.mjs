/* ==========================================================
   CONFIGURAR — guarda na Vercel as chaves e a senha da Central.
     npm run configurar      (na pasta Central, no SEU terminal)
   Menu:
     1. Senha da Central + chaves do Supabase e da Vercel
     2. E-mail (Gmail, com "senha de app")
     3. PIX automático (Mercado Pago)
     4. Tudo
   A chave de criptografia dos dados é criada UMA vez, sozinha. Nada do
   que você digita aparece na tela nem fica salvo no computador: vai
   direto para as variáveis secretas do projeto "forminha" na Vercel.
   ========================================================== */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { resumirSenha } from "../lib/sessao.js";
import { novaChave } from "../lib/cofre.js";

const PROJETO = process.env.PROJETO_VERCEL || "forminha";
// o projeto na Vercel usa a pasta "Central" como raiz: os comandos precisam rodar da RAIZ do repositório
const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

function perguntar(texto, { secreto = false } = {}) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (secreto) rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); else rl.output.write(s.includes("\n") ? "\n" : "•"); };
    rl.question(texto, (resposta) => { rl.close(); if (secreto) process.stdout.write("\n"); ok(resposta.trim()); });
  });
}

function vercel(args, entrada) {
  const r = spawnSync("vercel", args, { cwd: RAIZ, input: entrada, encoding: "utf8", shell: process.platform === "win32" });
  return { ok: r.status === 0, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function gravar(nome, valor) {
  vercel(["env", "rm", nome, "production", "--yes"]); // se não existia, tudo bem
  const r = vercel(["env", "add", nome, "production"], valor);
  if (!r.ok) { console.error(`\n✖ Não consegui gravar ${nome} na Vercel:\n${r.saida}`); process.exit(1); }
  console.log(`  ✔ ${nome}`);
}

const existe = (nome) => new RegExp(`\\b${nome}\\b`).test(vercel(["env", "ls", "production"]).saida);

async function senhaEChaves() {
  console.log("\nSENHA da Central (mínimo 12 caracteres; use uma frase que só você saiba).");
  let senha = "";
  for (;;) {
    senha = await perguntar("   Senha: ", { secreto: true });
    if (senha.length < 12) { console.log("   Muito curta: use 12 caracteres ou mais."); continue; }
    if ((await perguntar("   Repita: ", { secreto: true })) !== senha) { console.log("   As duas não conferem. De novo."); continue; }
    break;
  }
  console.log("\nCHAVE DO SUPABASE — crie em https://supabase.com/dashboard/account/tokens");
  console.log("   Se aparecer a opção de limitar a chave, deixe só a organização \"Forminha\".");
  const chaveSupabase = await perguntar("   Cole a chave (começa com sbp_): ", { secreto: true });
  if (!/^sbp_/.test(chaveSupabase)) { console.error("✖ Essa não parece uma chave do Supabase (deveria começar com sbp_)."); process.exit(1); }
  console.log("\nCHAVE DA VERCEL — crie em https://vercel.com/account/tokens (validade: sem vencimento ou a mais longa)");
  const chaveVercel = await perguntar("   Cole a chave: ", { secreto: true });
  if (chaveVercel.length < 20) { console.error("✖ Essa chave parece curta demais."); process.exit(1); }
  console.log("\nGravando…");
  gravar("CENTRAL_SENHA_HASH", await resumirSenha(senha));
  gravar("SUPABASE_ACCESS_TOKEN", chaveSupabase);
  gravar("VERCEL_TOKEN", chaveVercel);
  gravar("SEGREDO_SESSAO", randomBytes(32).toString("hex"));
  gravar("CRON_SECRET", randomBytes(24).toString("hex"));
}

async function criptografia() {
  if (existe("CHAVE_CRIPTOGRAFIA")) { console.log("\n✔ A chave de criptografia já existe (não troco: os dados guardados dependem dela)."); return; }
  const chave = novaChave();
  gravar("CHAVE_CRIPTOGRAFIA", chave);
  console.log("\n  IMPORTANTE — guarde esta chave num lugar seguro (gerenciador de senhas ou papel guardado).");
  console.log("  Se ela for apagada da Vercel, os dados das clientes não abrem mais. Ninguém consegue recuperá-la.");
  console.log(`\n     ${chave}\n`);
  await perguntar("  Aperte Enter quando tiver guardado… ");
  console.clear();
}

async function email() {
  console.log("\nE-MAIL pelo Gmail");
  console.log("   1. Ative a verificação em duas etapas da conta Google.");
  console.log("   2. Crie a senha de app em https://myaccount.google.com/apppasswords (nome: Forminha).");
  const usuario = await perguntar("   Seu Gmail (ex.: voce@gmail.com): ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(usuario)) { console.error("✖ E-mail inválido."); process.exit(1); }
  const senhaApp = (await perguntar("   Senha de app (16 letras): ", { secreto: true })).replace(/\s/g, "");
  if (senhaApp.length !== 16) { console.error("✖ A senha de app tem 16 letras (sem espaços)."); process.exit(1); }
  const nome = (await perguntar("   Nome que aparece como remetente [Forminha]: ")) || "Forminha";
  gravar("SMTP_USUARIO", usuario);
  gravar("SMTP_SENHA", senhaApp);
  gravar("EMAIL_NOME", nome);
}

async function mercadoPago() {
  console.log("\nPIX AUTOMÁTICO (Mercado Pago)");
  console.log("   Em https://www.mercadopago.com.br/developers/panel/app → sua aplicação → Credenciais de produção.");
  const token = await perguntar("   Access Token (começa com APP_USR-): ", { secreto: true });
  if (!/^APP_USR-/.test(token)) { console.error("✖ Use o Access Token de PRODUÇÃO (começa com APP_USR-)."); process.exit(1); }
  console.log("   Agora, na mesma aplicação: Webhooks → Modo produção → URL: https://forminha.vercel.app/api/webhook/mercadopago");
  console.log("   Marque o evento \"Pagamentos\", salve e copie a \"Assinatura secreta\".");
  const assinatura = await perguntar("   Assinatura secreta (Enter para pular): ", { secreto: true });
  gravar("MP_ACCESS_TOKEN", token);
  if (assinatura) gravar("MP_WEBHOOK_SECRET", assinatura);
}

console.log("\nCONFIGURAR A CENTRAL DA FORMINHA");
if (!vercel(["whoami"]).ok) { console.error("✖ Entre na Vercel primeiro: rode  vercel login"); process.exit(1); }
const link = vercel(["link", "--yes", "--project", PROJETO]);
if (!link.ok) { console.error(`✖ Não achei o projeto "${PROJETO}" na Vercel:\n${link.saida}`); process.exit(1); }

console.log("\n  1) Senha da Central + chaves do Supabase e da Vercel");
console.log("  2) E-mail (Gmail)");
console.log("  3) PIX automático (Mercado Pago)");
console.log("  4) Tudo");
const opcao = await perguntar("\nEscolha (1-4): ");
if (["1", "4"].includes(opcao)) await senhaEChaves();
await criptografia(); // sempre confere: cria só se ainda não existir
if (["2", "4"].includes(opcao)) await email();
if (["3", "4"].includes(opcao)) await mercadoPago();
if (!existe("DATABASE_URL") && !existe("POSTGRES_URL")) {
  console.log("\n! Falta o banco da Central: na Vercel, projeto forminha → Storage → Create Database → Neon → conectar ao projeto.");
}

console.log("\nPublicando a Central de novo para as mudanças valerem…");
const pub = vercel(["deploy", "--prod", "--yes"]);
console.log(pub.ok ? "\n✔ Pronto! Abra https://forminha.vercel.app\n" : `\n! Gravei tudo, mas a publicação falhou:\n${pub.saida}\n`);
