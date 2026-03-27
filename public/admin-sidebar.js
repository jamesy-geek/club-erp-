/**
 * Centralized Admin Sidebar Renderer
 * Ensures absolute consistency across all admin pages.
 */

const sidebarLinks = [
  { id: 'nav-dashboard', label: 'Dashboard', href: '/', icon: '📊' },
  { id: 'nav-components', label: 'Components', href: '/components-page', icon: '🔌' },
  { id: 'nav-transactions', label: 'Transactions', href: '/transactions-page', icon: '📝' },
  { id: 'nav-reports', label: 'Reports', href: '/reports-page', icon: '📈' },
  { id: 'nav-students', label: 'Students', href: '/students-page', icon: '🎓' },
  { id: 'nav-profile', label: 'Student Profile', href: '/student_profile.html', icon: '👤' },
  { id: 'nav-requests', label: 'Request Queue', href: '/admin-requests-page', icon: '📋' },
  { id: 'nav-damage', label: 'Damage Log', href: '/admin-damage-log.html', icon: '⚠️' }
];

const restrictedForSubAdmin = ['nav-settings', 'nav-students', 'nav-components'];

async function initSidebar() {
  const container = document.getElementById("admin-sidebar-placeholder");
  if (!container) return;

  try {
    const res = await fetch("/api/admin/me?v=1.4");
    if (!res.ok) throw new Error("Not logged in");
    const me = await res.json();

    const currentPath = window.location.pathname;
    
    let html = `
      <div class="sidebar" id="sidebar">
        <h2><img src="/ennovate-logo.png" alt=""> CERP</h2>
    `;

    sidebarLinks.forEach(link => {
      // Role-based masking
      if (me.role === 'SUB_ADMIN' && restrictedForSubAdmin.includes(link.id)) return;
      
      const isActive = currentPath === link.href || (link.href === '/' && currentPath === '/dashboard.html') || (link.href === '/admin-requests-page' && currentPath === '/admin-requests.html');
      html += `<a href="${link.href}" id="${link.id}" class="${isActive ? 'active' : ''}">${link.label}</a>`;
    });

    html += `
        <hr>
        ${me.role === 'ADMIN' ? `<a href="/admin-settings.html" id="nav-settings" class="${currentPath === '/admin-settings.html' ? 'active' : ''}">Admin Settings</a>` : ''}
        <a href="#" onclick="logout()">Logout</a>

        <div class="sidebar-footer">
          <img src="/ennovate-logo.png" alt="">
          <span>Built by Jishnu Abbhay D</span>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    console.error("Sidebar init failed:", err);
  }
}

// Support mobile toggle
function toggleMenu() {
  const sb = document.getElementById("sidebar");
  if (sb) sb.classList.toggle("active");
}

async function logout() {
  await fetch("/logout", { method: "POST" });
  window.location.href = "/login.html";
}

document.addEventListener("DOMContentLoaded", initSidebar);
