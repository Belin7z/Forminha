/* TEMA DA CENTRAL — claro ou escuro, aplicado ANTES de a página aparecer (sem piscar).
   Vale a escolha feita no botão (guardada no aparelho); sem escolha, segue o do computador/celular. */
(function () {
  var escolha = null;
  try { escolha = localStorage.getItem("forminha:central-tema"); } catch (e) { /* modo privado */ }
  var escuro = escolha ? escolha === "escuro" : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
})();
