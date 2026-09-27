/* ==========================================================
   PERSONALIZAR — na hora do build (Vercel), busca no banco o nome,
   a descrição e a aparência DESTA loja e grava no site publicado:
     • título, descrição e imagem do link compartilhado (WhatsApp,
       Instagram, Facebook leem o HTML sem rodar o JavaScript);
     • cores e letras no config.js (a 1ª visita já abre com o tema);
     • nome e cores do aplicativo instalável e o ícone da aba.
   Se o banco não responder, o site sai com o visual padrão e se
   ajusta sozinho quando o visitante abrir (nada quebra).
   ========================================================== */
import { gerarTokens, pacoteDoTema } from "../src/scripts/base/tema.js";

/** Lê a configuração pública da loja (a mesma que o site lê ao abrir). */
export async function buscarLoja({ supabaseUrl, supabaseAnonKey }, { tempo = 8000 } = {}) {
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/loja_config`, {
    method: "POST",
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(tempo),
  });
  if (!r.ok) throw new Error(`o banco respondeu ${r.status}`);
  const dados = await r.json();
  if (!dados?.loja) throw new Error("resposta sem os dados da loja");
  return dados;
}

const escapar = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Troca o conteúdo de uma <meta> (pelo name/property) — só se ela existir no HTML. */
const trocarMeta = (html, atributo, nome, valor) =>
  html.replace(new RegExp(`(<meta ${atributo}="${nome}" content=")[^"]*(")`), `$1${escapar(valor)}$2`);

/** Monta os textos de compartilhamento a partir da configuração da loja. */
export function textosDaLoja({ loja = {}, textos = {} }) {
  const nome = String(loja.nome ?? "").trim() || "Loja de doces";
  const slogan = String(loja.slogan ?? "").trim();
  return {
    nome,
    titulo: slogan ? `${nome} — ${slogan}` : nome,
    descricao: String(textos.hero_subtitulo ?? "").trim() || slogan || "Faça seu pedido online, com entrega ou retirada.",
    imagem: textos.hero_imagem || loja.logo || "",
  };
}

/** HTML da Loja com título, descrição, imagem e cor da barra desta loja. */
export function personalizarHtmlLoja(html, dados) {
  const t = textosDaLoja(dados);
  const cor = gerarTokens(dados.aparencia)["--escura"];
  let saida = html.replace(/<title>[^<]*<\/title>/, `<title>${escapar(t.titulo)}</title>`);
  saida = trocarMeta(saida, "name", "description", t.descricao);
  saida = trocarMeta(saida, "name", "theme-color", cor);
  saida = trocarMeta(saida, "property", "og:site_name", t.nome);
  saida = trocarMeta(saida, "property", "og:title", t.titulo);
  saida = trocarMeta(saida, "property", "og:description", t.descricao);
  if (t.imagem) saida = saida.replace(/(<meta property="og:locale"[^>]*>)/, `<meta property="og:image" content="${escapar(t.imagem)}">\n  $1`);
  return saida;
}

/** HTML do Dashboard com o nome da loja no título e a cor da barra. */
export function personalizarHtmlPainel(html, dados) {
  const t = textosDaLoja(dados);
  return trocarMeta(html.replace(/<title>[^<]*<\/title>/, `<title>Painel — ${escapar(t.nome)}</title>`), "name", "theme-color", gerarTokens(dados.aparencia)["--escura"]);
}

/** Aplicativo instalável (celular) com o nome e as cores da loja. */
export function manifestoDaLoja(manifesto, dados) {
  const t = textosDaLoja(dados);
  const tokens = gerarTokens(dados.aparencia);
  const curto = t.nome.length <= 12 ? t.nome : t.nome.split(/\s+/).slice(0, 2).join(" ").slice(0, 12);
  return { ...manifesto, name: t.nome, short_name: curto, description: t.descricao.slice(0, 120), background_color: tokens["--fundo"], theme_color: tokens["--escura"] };
}

/** Iniciais para o ícone (2 letras): "Doce da Ana" -> "DA". */
export function iniciaisDaLoja(nome) {
  const partes = String(nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/)
    .filter((p) => p && !/^(da|de|do|das|dos|e|a|o)$/i.test(p));
  const letras = partes.length >= 2 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? "L").slice(0, 2);
  return letras.toUpperCase();
}

/** Ícone da aba do navegador: iniciais da loja nas cores do tema. */
export function faviconDaLoja(dados) {
  const t = gerarTokens(dados.aparencia);
  const letras = escapar(iniciaisDaLoja(textosDaLoja(dados).nome));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${t["--escura"]}"/>`
    + `<circle cx="32" cy="32" r="23" fill="none" stroke="${t["--detalhe"]}" stroke-width="1.6"/>`
    + `<text x="32" y="40.5" text-anchor="middle" font-family="Georgia, serif" font-size="24" font-weight="600" fill="${t["--sobre-profunda"]}">${letras}</text></svg>`;
}

export { pacoteDoTema };
