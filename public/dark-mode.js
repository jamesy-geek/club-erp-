// Dark Mode Toggle — shared across all pages
(function() {
  // Apply saved preference immediately to prevent flash
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark');
  }

  // Create toggle button
  var btn = document.createElement('button');
  btn.className = 'dark-mode-toggle';
  if (document.body.classList.contains('student-portal')) btn.classList.add('no-magnetic');
  btn.title = 'Toggle Dark Mode';
  btn.innerHTML = document.body.classList.contains('dark') ? '☀️' : '🌙';
  btn.onclick = function() {
    document.body.classList.toggle('dark');
    var isDark = document.body.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
    btn.innerHTML = isDark ? '☀️' : '🌙';
  };
  document.body.appendChild(btn);
})();
