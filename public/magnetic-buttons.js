(function () {
  const strength = 0.12;
  function applyMagnetic(el, e) {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    el.style.setProperty("--sp-mx", x * strength + "px");
    el.style.setProperty("--sp-my", y * strength + "px");
  }
  function clearMagnetic(el) {
    el.style.removeProperty("--sp-mx");
    el.style.removeProperty("--sp-my");
  }
  function bind(el) {
    if (el.dataset.spMagneticBound || el.classList.contains("no-magnetic")) return;
    el.dataset.spMagneticBound = "1";
    el.addEventListener("mousemove", (e) => applyMagnetic(el, e));
    el.addEventListener("mouseleave", () => clearMagnetic(el));
  }
  function scan(root) {
    if (!root) return;
    root.querySelectorAll("button, a.sp-btn, a.sp-interactive, .sp-magnetic").forEach(bind);
  }
  window.initStudentMagnetic = function (root) {
    scan(root || document.querySelector(".student-portal") || document.body);
  };
  document.addEventListener("DOMContentLoaded", () => window.initStudentMagnetic());
})();
