(function () {
  // --- Staggered Reveals ---
  function applyReveals() {
    const reveals = document.querySelectorAll('.sp-card, .sp-title, .sp-sub, .sp-btn, .sp-cat-card');
    reveals.forEach((el, index) => {
      el.classList.add('sp-reveal');
      el.style.setProperty('--delay', `${index * 0.08}s`);
    });
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
    if (el.dataset.tiltBound) return;
    el.dataset.tiltBound = "1";
    el.classList.add('sp-tilt');
    
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const angleX = (y - centerY) / 8;
      const angleY = (centerX - x) / 8;
      el.style.transform = `rotateX(${angleX}deg) rotateY(${angleY}deg) scale(1.02)`;
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = `rotateX(0deg) rotateY(0deg) scale(1)`;
    });
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
    
    // Custom typing effect for dashboard
    const sub = document.getElementById('welcomeSub');
    if (sub && !sub.dataset.typed) {
      sub.dataset.typed = "1";
      const fullText = sub.innerText;
      typeSubtitle(sub, fullText);
    }
    
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
