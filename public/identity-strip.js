(function () {
  const strip = document.createElement("div");
  strip.id = "identity-strip";
  strip.setAttribute("role", "contentinfo");
  strip.innerHTML = `
    <span class="is-brand">ennovate</span>
    <span class="is-item strip-desk-only">CERP · v1.3</span>
    <span class="is-item">// student portal</span>
    <span class="is-item strip-desk-only">EST. 2022</span>
    <span class="is-item strip-desk-only">MANDYA</span>
  `;
  document.body.appendChild(strip);
})();
