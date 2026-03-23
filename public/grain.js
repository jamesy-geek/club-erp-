(function () {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const grainOverlay = document.createElement("div");
  grainOverlay.id = "static-grain";
  grainOverlay.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.04;
    background-image: url(${canvas.toDataURL()});
    background-repeat: repeat;
    background-size: 256px 256px;
  `;

  function updateOpacity() {
    grainOverlay.style.opacity = window.innerWidth <= 768 ? "0.025" : "0.04";
  }

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.body.appendChild(grainOverlay);
    updateOpacity();
    window.addEventListener("resize", updateOpacity);
  }
})();
