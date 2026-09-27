/* COMPONENTE — entrada suave dos blocos ao rolar a página (elementos com a classe "revelar") */

let observador = null;

export function revelarAoRolar(raiz = document) {
  const itens = raiz.querySelectorAll(".revelar:not(.revelar--visivel)");
  if (!itens.length) return;
  if (!("IntersectionObserver" in window)) { itens.forEach((el) => el.classList.add("revelar--visivel")); return; }

  document.documentElement.classList.add("anima");
  observador ??= new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("revelar--visivel");
      observador.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

  itens.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min((i % 4) * 70, 210)}ms`;
    observador.observe(el);
  });
}
