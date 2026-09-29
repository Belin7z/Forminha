/* ==========================================================
   NÚCLEO — conversa do painel com a Central da Forminha (o endereço
   vem de URL_CENTRAL, gravado quando a loja foi criada). A Central
   faz o que exige chaves que a loja não tem: instalar as funções de
   pagamento, guardar a chave do Mercado Pago, ligar domínio próprio.
   A identificação é o login da própria dona (a Central pergunta ao
   banco da loja se ela é administradora).
   ========================================================== */
import { supabase } from "./api.js";

const URL_CENTRAL = String(window.CONFIG_APP?.urlCentral ?? "").replace(/\/+$/, "");

/** Esta loja foi criada pela Central (e sabe falar com ela)? */
export const temCentral = () => Boolean(URL_CENTRAL);

export async function chamarCentral(metodo, caminho, corpo) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw Object.assign(new Error("Sua sessão terminou. Entre de novo."), { status: 401 });
  let r;
  try {
    r = await fetch(`${URL_CENTRAL}/api/loja/${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`, ...(corpo !== undefined && { "Content-Type": "application/json" }),
        // banco único: o login vale para todas as lojas; a Central sabe qual é pelo endereço deste painel
        ...(window.CONFIG_APP?.multiloja && { "x-loja": location.hostname }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch { throw new Error("Sem conexão com a Forminha. Confira a internet e tente de novo."); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dados.erro ?? "Não foi possível agora. Tente de novo em instantes."), { status: r.status, campos: dados.campos });
  return dados;
}
