/* ==========================================================
   CADASTRO COM "CONFIRMAR E-MAIL" LIGADO NO SUPABASE
   Nesse modo o cadastro não abre sessão: o cliente precisa clicar
   no link recebido. A loja deve avisar isso (confirmar_email) em
   vez de tratar como erro. Rodar:  npm test
   ========================================================== */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { iniciarEmulador } from "./emulador/servidor.js";
import { sql } from "./emulador/banco.js";
import { criarApiLoja } from "../../../Loja/src/scripts/base/api/loja.js";

let emu;
before(async () => { emu = await iniciarEmulador({ confirmarEmail: true }); });
after(async () => { await emu?.fechar(); });

describe("cadastro com confirmação de e-mail", () => {
  it("não abre sessão e pede a confirmação; a conta nasce como cliente", async () => {
    const supabase = createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const loja = criarApiLoja(supabase);

    const r = await loja.post("/auth/cadastro", { nome: "Joana Lima", email: "joana@teste.com", telefone: "11955554444", senha: "Senha1234" });
    assert.deepEqual(r, { usuario: null, confirmar_email: true });

    assert.equal((await loja.get("/auth/eu")).usuario, null, "sem sessão até confirmar");

    const { rows } = await sql(emu.db, "select papel, ativo, nome from public.perfis where email = 'joana@teste.com'");
    assert.equal(rows.length, 1, "o perfil é criado pelo gatilho do banco");
    assert.equal(rows[0].papel, "cliente");
    assert.equal(rows[0].nome, "Joana Lima");
  });

  it("e-mail repetido continua sendo recusado", async () => {
    const supabase = createClient(emu.url, emu.chaveAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const loja = criarApiLoja(supabase);
    await assert.rejects(
      loja.post("/auth/cadastro", { nome: "Joana Lima", email: "joana@teste.com", telefone: "11955554444", senha: "Senha1234" }),
      (e) => e.status === 409 || e.status === 422 || e.status === 400
    );
  });

  it("conta criada sem nome (ex.: pelo painel do Supabase) usa o começo do e-mail", async () => {
    const r = await fetch(`${emu.url}/auth/v1/signup`, { method: "POST", headers: { apikey: emu.chaveAnon, "content-type": "application/json" }, body: JSON.stringify({ email: "sem.nome@teste.com", password: "Senha1234" }) });
    assert.ok(r.ok);
    const { rows } = await sql(emu.db, "select nome, papel from public.perfis where email = 'sem.nome@teste.com'");
    assert.deepEqual(rows[0], { nome: "sem.nome", papel: "cliente" });
  });
});
