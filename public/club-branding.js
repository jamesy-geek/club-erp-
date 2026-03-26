/**
 * Club Branding Script
 * Dynamically updates page titles and sidebars based on Admin Settings
 */
(async function updateClubBranding() {
  try {
    const res = await fetch("/api/public/settings");
    if (!res.ok) return;
    const settings = await res.json();
    
    if (settings.club_name) {
      const name = settings.club_name;
      
      // 1. Update document title (replace "CERP" or "Club ERP")
      document.title = document.title.replace(/CERP|Club ERP/gi, name);
      
      // 2. Update sidebar header (keeping the logo)
      const sidebarHeader = document.querySelector(".sidebar h2");
      if (sidebarHeader) {
        const logo = sidebarHeader.querySelector("img");
        if (logo) {
          sidebarHeader.innerHTML = "";
          sidebarHeader.appendChild(logo);
          sidebarHeader.appendChild(document.createTextNode(" " + name));
        } else {
          sidebarHeader.textContent = name;
        }
      }

      // 3. Update any other specific club name placeholders if needed
      const nameHolders = document.querySelectorAll(".dynamic-club-name");
      nameHolders.forEach(el => el.textContent = name);
    }
    
    if (settings.club_tagline) {
      const tagline = settings.club_tagline;
      const taglineEl = document.getElementById("clubTagline");
      if (taglineEl) {
        taglineEl.textContent = tagline;
      }
    }
    // 4. Role-based Sidebar Masking & Link Injection
    try {
      const meRes = await fetch("/api/admin/me");
      if (meRes.ok) {
        const me = await meRes.json();
        const sidebar = document.getElementById("sidebar") || document.querySelector(".sidebar");
        if (!sidebar) return;

        // 2. Role-based masking
        if (me && me.role === 'SUB_ADMIN') {
          const restrictedTitles = ['Settings', 'Students', 'Components', 'Profile'];
          sidebar.querySelectorAll("a").forEach(a => {
            if (restrictedTitles.some(t => a.textContent.includes(t))) {
              a.style.display = 'none';
            }
          });
        }
      }
    } catch (e) { /* admin only, students skip silently */ }

  } catch (error) {
    console.error("Branding update failed:", error);
  }
})();
