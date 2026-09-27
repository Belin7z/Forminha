/* ==========================================================
   ROTEADOR — navegação por hash (#/caminho?filtro=1) sem recarregar.
   Cada rota é uma função que desenha a página e pode devolver
   uma função de limpeza (parar timers, destruir mapas…).
   ========================================================== */

function compilar(padrao) {
  const nomes = [];
  const regex = padrao
    .replace(/\/:([a-zA-Z]+)\?/g, (_, n) => (nomes.push(n), "(?:/([^/]+))?"))
    .replace(/:([a-zA-Z]+)/g, (_, n) => (nomes.push(n), "([^/]+)"));
  return { nomes, regex: new RegExp(`^${regex}/?$`) };
}

/**
 * rotas: { "/": fn, "/pedido/:codigo": fn, "/conta/:aba?": fn }
 * Cada fn recebe { params, consulta, ativo, ir } e usa `raiz` do contexto.
 */
export function criarRoteador({ rotas, raiz, aoTrocar, naoEncontrada }) {
  const tabela = Object.entries(rotas).map(([padrao, vista]) => ({ vista, ...compilar(padrao) }));
  let limpeza = null;
  let versao = 0;

  const caminhoAtual = () => {
    const [caminho, consulta = ""] = (location.hash.slice(1) || "/").split("?");
    return { caminho: caminho || "/", consulta: Object.fromEntries(new URLSearchParams(consulta)) };
  };

  async function resolver() {
    const minha = ++versao;
    const { caminho, consulta } = caminhoAtual();

    try { limpeza?.(); } catch (e) { console.error(e); }
    limpeza = null;

    let escolhida = null;
    let params = {};
    for (const rota of tabela) {
      const m = rota.regex.exec(caminho);
      if (m) {
        escolhida = rota;
        params = Object.fromEntries(rota.nomes.map((n, i) => [n, m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined]));
        break;
      }
    }

    // cada página ganha um contêiner NOVO: os ouvintes de eventos da página anterior
    // morrem junto com o contêiner antigo e nunca disparam na página seguinte
    const recipiente = document.createElement("div");
    recipiente.className = "vista";
    raiz.replaceChildren(recipiente);

    const contexto = {
      raiz: recipiente, caminho, params, consulta,
      ativo: () => minha === versao, // false se o usuário já foi para outra página
      ir,
    };
    aoTrocar?.(contexto);
    window.scrollTo({ top: 0 });

    const vista = escolhida?.vista ?? naoEncontrada;
    const retorno = await vista(contexto);
    if (minha === versao) limpeza = typeof retorno === "function" ? retorno : null;
    else if (typeof retorno === "function") retorno(); // a página mudou durante o carregamento
  }

  function ir(caminho, { substituir = false } = {}) {
    const destino = `#${caminho}`;
    if (location.hash === destino) return resolver();
    if (substituir) history.replaceState(null, "", destino);
    else location.hash = destino;
    if (substituir) return resolver();
  }

  window.addEventListener("hashchange", resolver);
  return { iniciar: resolver, ir, atualizar: resolver, caminhoAtual };
}
