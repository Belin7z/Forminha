/* ==========================================================
   LOJA — ponto de entrada.
   Carrega configuração, sessão e catálogo, monta o cabeçalho,
   o carrinho e o roteador das páginas.
   ========================================================== */
import { montar } from "/src/scripts/base/html.js";
import { criarRoteador } from "/src/scripts/base/roteador.js";
import { toast } from "/src/scripts/base/ui.js";
import { api } from "./nucleo/api.js";
import { emitir, estado } from "./nucleo/estado.js";
import { carregarCatalogo } from "./nucleo/catalogo.js";
import { limparIndisponiveis } from "./nucleo/carrinho.js";
import { carregarSessao, tratarLinkDoEmail } from "./nucleo/sessao.js";
import { iniciarCabecalho } from "./componentes/cabecalho.js";
import { iniciarGaveta } from "./componentes/gaveta-carrinho.js";
import { desenharRodape } from "./componentes/rodape.js";
import { carregando, erroDePagina } from "./componentes/carregando.js";
import { inicio } from "./paginas/inicio.js";
import { cardapio, paginaDoProduto } from "./paginas/cardapio.js";
import { favoritos } from "./paginas/favoritos.js";
import { paginaCadastrar, paginaEntrar, paginaRecuperar, paginaRedefinir } from "./paginas/autenticacao.js";
import { checkout } from "./paginas/checkout.js";
import { conta } from "./paginas/conta.js";
import { pedido } from "./paginas/pedido.js";
import { contato } from "./paginas/contato.js";
import { naoEncontrada } from "./paginas/nao-encontrada.js";
import { paginaPrivacidade, paginaTermos } from "./paginas/legal.js";
import { aplicarSeo, registrarApp } from "./nucleo/seo.js";
import { aplicarAparencia } from "/src/scripts/base/tema.js";
import { produtoDoCaminho } from "/src/scripts/base/dominio.js";
import { iniciarWhatsFlutuante } from "./componentes/whats-flutuante.js";

const pagina = document.getElementById("pagina");

// link próprio do produto (/p/12-bolo-de-ninho): vira a rota #/produto/12, sem recarregar a página
const produtoDoLink = produtoDoCaminho(location.pathname);
if (produtoDoLink) history.replaceState(null, "", `/#/produto/${produtoDoLink}`);

async function iniciar() {
  montar(pagina, carregando);
  try {
    const [config] = await Promise.all([api.get("/config"), carregarSessao()]);
    estado.config = config;
    aplicarAparencia(config.aparencia);
    await carregarCatalogo();
    limparIndisponiveis();
  } catch (erro) {
    montar(pagina, erroDePagina(erro.message));
    return;
  }

  aplicarSeo(estado.config);

  tratarLinkDoEmail();

  const rotas = {
    "/": inicio,
    "/cardapio": cardapio,
    "/produto/:id": paginaDoProduto,
    "/favoritos": favoritos,
    "/entrar": paginaEntrar,
    "/cadastrar": paginaCadastrar,
    "/recuperar": paginaRecuperar,
    "/redefinir": paginaRedefinir,
    "/finalizar": checkout,
    "/conta/:aba?": conta,
    "/pedido/:codigo": pedido,
    "/contato": contato,
    "/privacidade": paginaPrivacidade,
    "/termos": paginaTermos,
  };

  let cabecalho;
  const roteador = criarRoteador({
    raiz: pagina, rotas, naoEncontrada,
    aoTrocar: (ctx) => cabecalho?.marcarAtivo(ctx.caminho),
  });

  desenharRodape();
  iniciarGaveta(roteador);
  iniciarWhatsFlutuante();
  registrarApp();
  cabecalho = iniciarCabecalho(roteador);

  // sessão vencida no meio do uso: avisa e deixa o cliente entrar de novo
  api.aoExpirarSessao = () => {
    if (!estado.usuario) return;
    estado.usuario = null;
    emitir("usuario");
    toast("Sua sessão expirou. Entre novamente para continuar.", "info");
  };

  await roteador.iniciar();
}

iniciar();
