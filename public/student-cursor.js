(function () {
  if (window.matchMedia("(hover: none)").matches) return;
  const cur = document.createElement("div");
  cur.id = "student-cursor";
  cur.setAttribute("aria-hidden", "true");
  document.body.appendChild(cur);
  let cx = 0, cy = 0, tx = 0, ty = 0, expanded = false;
  document.addEventListener("mousemove", (e) => {
    tx = e.clientX;
    ty = e.clientY;
  });
  function loop() {
    cx += (tx - cx) * 0.22;
    cy += (ty - cy) * 0.22;
    cur.style.left = cx + "px";
    cur.style.top = cy + "px";
    requestAnimationFrame(loop);
  }
  loop();
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("button, a, input, textarea, select, [role='button'], .sp-interactive");
    expanded = !!t;
    cur.classList.toggle("is-expanded", expanded);
  });
  document.addEventListener("mouseout", (e) => {
    const rel = e.relatedTarget;
    if (rel && rel.closest && rel.closest("button, a, input, textarea, select, [role='button'], .sp-interactive")) return;
    expanded = false;
    cur.classList.remove("is-expanded");
  });
})();
