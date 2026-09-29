/* ==========================================================
   PAINEL — ponto de entrada.
   Se há administrador logado, monta o painel; se não, mostra o login.
   ========================================================== */
import { criarRoteador } from "/src/scripts/base/roteador.js";
import { html } from "/src/scripts/base/html.js";
import { icone } from "/src/scripts/base/icones.js";
import { api } from "./nucleo/api.js";
import { estado } from "./nucleo/estado.js";
import { iniciarInatividade, jaExpirou, marcarAtividade } from "./nucleo/inatividade.js";
import { iniciarNotificacoes, pararNotificacoes } from "./nucleo/notificacoes.js";
import { montarEstrutura, tituloDe } from "./componentes/estrutura.js";
import { nomeDaLoja } from "./componentes/marca.js";
import { aplicarAparencia } from "/src/scripts/base/tema.js";
import { mostrarLogin } from "./paginas/entrar.js";
import { BOAS_VINDAS, mostrarConvite } from "./paginas/convite.js";
import { toast } from "/src/scripts/base/ui.js";
import { visaoGeral } from "./paginas/visao-geral.js";
import { pedidos } from "./paginas/pedidos.js";
import { novoPedido } from "./paginas/novo-pedido.js";
import { agenda } from "./paginas/agenda.js";
import { producao } from "./paginas/producao.js";
import { estoque } from "./paginas/estoque.js";
import { produtos } from "./paginas/produtos.js";
import { categorias } from "./paginas/categorias.js";
import { clientes } from "./paginas/clientes.js";
import { avaliacoes } from "./paginas/avaliacoes.js";
import { favoritos } from "./paginas/favoritos.js";
import { cupons } from "./paginas/cupons.js";
import { entrega } from "./paginas/entrega.js";
import { configuracoes } from "./paginas/configuracoes.js";
import { equipe } from "./paginas/equipe.js";
import { conta } from "./paginas/conta.js";
import { atividade } from "./paginas/atividade.js";
import { primeirosPassos } from "./paginas/primeiros-passos.js";
import { relatorios } from "./paginas/relatorios.js";
import { registrarServico } from "/src/scripts/base/instalar.js";

const naoEncontrada = (ctx) => {
  ctx.raiz.innerHTML = String(html`<div class="vazio"><span class="vazio__ico">${icone("busca", { tamanho: 38 })}</span><h3>Página não encontrada</h3>
    <a href="#/" class="btn btn--primario">Ir para a visão geral</a></div>`);
};

const ROTAS = {
  "/": visaoGeral,
  "/relatorios": relatorios,
  "/pedidos": pedidos,
  "/pedidos/novo": novoPedido,
  "/agenda": agenda,
  "/producao/:data?": producao,
  "/estoque/:aba?": estoque,
  "/produtos": produtos,
  "/categorias": categorias,
  "/clientes": clientes,
  "/avaliacoes": avaliacoes,
  "/favoritos": favoritos,
  "/cupons": cupons,
  "/entrega": entrega,
  "/configuracoes/:secao?": configuracoes,
  "/equipe": equipe,
  "/atividade": atividade,
  "/conta": conta,
  "/primeiros-passos/:passo?": primeirosPassos,
};

// o atendente só tem estas telas (a página inicial dele é a de pedidos)
const ROTAS_ATENDENTE = {
  "/": pedidos, "/pedidos": pedidos, "/pedidos/novo": novoPedido, "/agenda": agenda, "/producao/:data?": producao, "/conta": conta,
};

function abrirPainel(usuario) {
  estado.usuario = usuario;
  const inicial = usuario.papel === "admin" ? "#/" : "#/pedidos";
  if (!location.hash || location.hash === "#/entrar" || (usuario.papel !== "admin" && location.hash === "#/")) history.replaceState(null, "", inicial);
  // acabou de aceitar o convite: o painel abre direto no assistente de primeiros passos
  let novaLoja = false;
  try { novaLoja = sessionStorage.getItem(BOAS_VINDAS) === "1"; sessionStorage.removeItem(BOAS_VINDAS); } catch { /* modo privado */ }
  if (novaLoja && usuario.papel === "admin") history.replaceState(null, "", "#/primeiros-passos");

  const estrutura = montarEstrutura({ aoSair: () => mostrarTelaDeLogin() });
  const roteador = criarRoteador({
    raiz: document.getElementById("pagina"), rotas: usuario.papel === "admin" ? ROTAS : ROTAS_ATENDENTE, naoEncontrada,
    aoTrocar: (ctx) => { estrutura.marcarAtivo(ctx.caminho); document.title = `${tituloDe(ctx.caminho)} — ${nomeDaLoja()}`; },
  });
  iniciarNotificacoes();
  roteador.iniciar();
  if (novaLoja) toast("Bem-vinda! Em 5 passos curtos a loja fica com a sua cara.");
  // computador esquecido aberto: encerra a sessão depois de 2 horas sem uso
  iniciarInatividade(async () => {
    pararNotificacoes();
    await api.post("/auth/sair").catch(() => {});
    mostrarTelaDeLogin("Por segurança, você foi desconectado por inatividade. Entre novamente para continuar.");
  });
}

function mostrarTelaDeLogin(aviso = "") {
  pararNotificacoes();
  estado.usuario = null;
  // recarrega a página ao entrar: começa do zero, sem ouvintes duplicados
  mostrarLogin({ aviso, aoEntrar: () => { marcarAtividade(); history.replaceState(null, "", "#/"); location.reload(); } });
}

async function iniciar() {
  // sessão vencida no meio do uso: volta para o login com aviso
  api.aoExpirarSessao = () => { if (estado.usuario) mostrarTelaDeLogin("Sua sessão expirou. Entre novamente para continuar."); };

  try {
    // nome, logo e cores da loja (se falhar, o painel abre mesmo assim, com o visual padrão)
    const publico = api.get("/loja/publico").then((cfg) => { estado.loja = cfg.loja ?? {}; aplicarAparencia(cfg.aparencia); }).catch(() => {});
    const [{ usuario }] = await Promise.all([api.get("/auth/eu"), publico]);
    // link de convite (primeiro acesso da dona da loja): vem antes do login
    const convite = /^#\/convite\/([0-9a-f]{64})\/?$/.exec(location.hash);
    if (convite) {
      mostrarConvite(convite[1], { aoAceitar: () => { marcarAtividade(); history.replaceState(null, "", "#/"); location.reload(); } });
      return;
    }
    if (usuario && jaExpirou()) {
      await api.post("/auth/sair").catch(() => {});
      mostrarTelaDeLogin("Por segurança, você foi desconectado por inatividade. Entre novamente para continuar.");
    } else if (usuario) abrirPainel(usuario);
    else mostrarTelaDeLogin();
  } catch (erro) {
    document.getElementById("raiz").innerHTML = String(html`<div class="vazio"><span class="vazio__ico">${icone("alerta", { tamanho: 38 })}</span><h3>Não foi possível abrir o painel</h3><p>${erro.message}</p>
      <a class="btn btn--primario" href="./">Tentar de novo</a></div>`);
  }
}

registrarServico(); // o painel pode ser instalado no celular como um aplicativo
iniciar();
