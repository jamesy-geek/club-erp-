(function () {
  // --- Staggered Reveals ---
  function applyReveals() {
    // Disabled to prevent elements from staying hidden due to animation delays
    return;
  }

  // --- Typing Effect ---
  function typeSubtitle(element, fullText, speed = 40) {
    if (!element) return;
    element.textContent = "";
    element.classList.add('sp-typing');
    let i = 0;
    const interval = setInterval(() => {
      element.textContent += fullText.charAt(i);
      i++;
      if (i >= fullText.length) {
        clearInterval(interval);
        setTimeout(() => element.classList.remove('sp-typing'), 2000);
      }
    }, speed);
  }

  // --- 3D Tilt Effect ---
  function applyTilt(el) {
    // Disabled to solve click registration issues at different angles
    return;
  }

  // --- Number Counter ---
  function animateCounter(el, target, duration = 1500) {
    if (!el || isNaN(target)) return;
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      el.innerText = Math.floor(progress * target);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }

  // --- Konami Code ---
  let konamiIndex = 0;
  const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  
  document.addEventListener('keydown', (e) => {
    if (e.key === konamiCode[konamiIndex]) {
      konamiIndex++;
      if (konamiIndex === konamiCode.length) {
        triggerEasterEgg();
        konamiIndex = 0;
      }
    } else {
      konamiIndex = 0;
    }
  });

  function triggerEasterEgg() {
    const glitch = document.createElement('div');
    glitch.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,255,100,0.1);pointer-events:none;backdrop-filter:invert(1) contrast(200%);animation: sp-glitch 0.1s linear infinite;";
    document.body.appendChild(glitch);
    setTimeout(() => glitch.remove(), 1000);
    console.log("Easter egg activated! // KONAMI_SEQ_DETECTED");
  }

  // --- Initialization ---
  window.initStudentInteractivity = function () {
    applyReveals();
    
    // Auto-bind tilt to catalog cards and stats
    document.querySelectorAll('.sp-cat-card, .sp-stat-cell').forEach(applyTilt);
    
    // Animate counters if present
    document.querySelectorAll('.sp-stat-num').forEach(el => {
      const val = parseInt(el.innerText);
      if (!isNaN(val)) animateCounter(el, val);
    });
  };

  document.addEventListener('DOMContentLoaded', () => window.initStudentInteractivity());
  
  // Re-run for dynamic content (like catalog renders)
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.sp-cat-card:not([data-tilt-bound])').forEach(applyTilt);
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
