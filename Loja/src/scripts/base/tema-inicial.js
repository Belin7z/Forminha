/* ==========================================================
   TEMA INICIAL — roda no <head>, ANTES de a página aparecer, para
   o visitante nunca ver a cor errada piscando na tela.
   Usa o tema guardado no aparelho (visitas anteriores) ou, na
   primeira visita, o que o build gravou no config.js. Depois que a
   configuração chega do banco, src/scripts/base/tema.js confirma
   ou corrige. Script comum (sem import) de propósito: precisa rodar
   na hora, e a segurança do site não permite scripts dentro do HTML.
   ========================================================== */
(function () {
  var pacote = null;
  try { pacote = JSON.parse(localStorage.getItem("forminha:tema") || "null"); } catch (e) { /* modo privado */ }
  if (!pacote || !pacote.tokens) pacote = window.CONFIG_APP && window.CONFIG_APP.tema;
  if (!pacote || !pacote.tokens) return;
  var raiz = document.documentElement.style;
  for (var nome in pacote.tokens) raiz.setProperty(nome, pacote.tokens[nome]);
  if (pacote.fonteUrl) {
    var link = document.createElement("link");
    link.id = "fonte-tema"; link.rel = "stylesheet"; link.href = pacote.fonteUrl;
    document.head.appendChild(link);
  }
  var barra = document.querySelector('meta[name="theme-color"]');
  if (barra && pacote.tokens["--escura"]) barra.setAttribute("content", pacote.tokens["--escura"]);
})();
