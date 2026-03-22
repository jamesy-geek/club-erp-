(function () {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99;opacity:0.04;";
  canvas.width = canvas.height = 200;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  function setOpacity() {
    canvas.style.opacity = window.innerWidth <= 768 ? "0.025" : "0.04";
  }
  setOpacity();
  window.addEventListener("resize", setOpacity);
  function frame() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTimeout(() => requestAnimationFrame(frame), 500);
      return;
    }
    const img = ctx.createImageData(200, 200);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    canvas.style.backgroundImage = `url(${canvas.toDataURL()})`;
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.backgroundSize = "200px 200px";
    setTimeout(() => requestAnimationFrame(frame), 60);
  }
  frame();
})();
