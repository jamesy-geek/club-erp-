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
  window.initStudentMagnetic = function (root) {
    // Disabled to ensure 100% reliable click registration
    return;
  };
  document.addEventListener("DOMContentLoaded", () => window.initStudentMagnetic());
})();
