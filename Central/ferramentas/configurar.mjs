/* ==========================================================
   CONFIGURAR — guarda na Vercel as chaves e a senha da Central.
     npm run configurar      (na pasta Central, no SEU terminal)
   Pergunta a senha da Central e as duas chaves (Supabase e Vercel) sem
   mostrar o que você digita, e grava tudo direto nas variáveis secretas
   do projeto "forminha" na Vercel. Nada fica salvo no computador.
   Depois publica a Central de novo para as mudanças valerem.
   ========================================================== */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { resumirSenha } from "../lib/sessao.js";

const PROJETO = process.env.PROJETO_VERCEL || "forminha";

function perguntar(texto, { secreto = false } = {}) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (secreto) rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); else rl.output.write(s.includes("\n") ? "\n" : "•"); };
    rl.question(texto, (resposta) => { rl.close(); if (secreto) process.stdout.write("\n"); ok(resposta.trim()); });
  });
}

function vercel(args, entrada) {
  const r = spawnSync("vercel", args, { input: entrada, encoding: "utf8", shell: process.platform === "win32" });
  return { ok: r.status === 0, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function gravar(nome, valor) {
  vercel(["env", "rm", nome, "production", "--yes"]); // se não existia, tudo bem
  const r = vercel(["env", "add", nome, "production"], valor);
  if (!r.ok) { console.error(`\n✖ Não consegui gravar ${nome} na Vercel:\n${r.saida}`); process.exit(1); }
  console.log(`  ✔ ${nome}`);
}

console.log("\nCONFIGURAR A CENTRAL DA FORMINHA\n");
if (!vercel(["whoami"]).ok) { console.error("✖ Entre na Vercel primeiro: rode  vercel login"); process.exit(1); }
const link = vercel(["link", "--yes", "--project", PROJETO]);
if (!link.ok) { console.error(`✖ Não achei o projeto "${PROJETO}" na Vercel:\n${link.saida}`); process.exit(1); }

console.log("1) A SENHA para entrar na Central (mínimo 12 caracteres; use uma frase que só você saiba).");
let senha = "";
for (;;) {
  senha = await perguntar("   Senha: ", { secreto: true });
  if (senha.length < 12) { console.log("   Muito curta: use 12 caracteres ou mais."); continue; }
  if ((await perguntar("   Repita: ", { secreto: true })) !== senha) { console.log("   As duas não conferem. De novo."); continue; }
  break;
}

console.log("\n2) CHAVE DO SUPABASE — crie em https://supabase.com/dashboard/account/tokens");
console.log("   Se aparecer a opção de limitar a chave, deixe só a organização \"Forminha\".");
const chaveSupabase = await perguntar("   Cole a chave (começa com sbp_): ", { secreto: true });
if (!/^sbp_/.test(chaveSupabase)) { console.error("✖ Essa não parece uma chave do Supabase (deveria começar com sbp_)."); process.exit(1); }

console.log("\n3) CHAVE DA VERCEL — crie em https://vercel.com/account/tokens (validade: sem vencimento ou a mais longa)");
const chaveVercel = await perguntar("   Cole a chave: ", { secreto: true });
if (chaveVercel.length < 20) { console.error("✖ Essa chave parece curta demais."); process.exit(1); }

console.log("\nGravando na Vercel (projeto \"" + PROJETO + "\")…");
gravar("CENTRAL_SENHA_HASH", await resumirSenha(senha));
gravar("SUPABASE_ACCESS_TOKEN", chaveSupabase);
gravar("VERCEL_TOKEN", chaveVercel);
gravar("SEGREDO_SESSAO", randomBytes(32).toString("hex"));
gravar("CRON_SECRET", randomBytes(24).toString("hex"));

console.log("\nPublicando a Central de novo para as chaves valerem…");
const pub = vercel(["deploy", "--prod", "--yes"]);
console.log(pub.ok ? "\n✔ Pronto! Abra https://forminha.vercel.app e entre com a sua senha.\n" : `\n! Gravei tudo, mas a publicação falhou:\n${pub.saida}\n`);
