# CERP Student Portal — Design & Implementation Spec
**Version:** 1.0  
**Last Updated:** March 2026  
**For use with:** Antigravity (AI coding agent, VS Code)  
**Read alongside:** `ennovate-design-doc.md`, `ennovate-stack-spec.md`, `ennovate-join-page-spec.md`  
**Built on top of:** Existing CERP backend (`server.js`, Turso/libsql, v1.3-detailed-login)

---

## 0. How to Read This Document

This document is the single source of truth for the **student-facing frontend** of CERP — the Club Equipment Resource Portal. The admin-facing frontend (`dashboard.html`, `components.html`, `transactions.html`, `students.html`, `reports.html`) is **explicitly out of scope** and must not be touched.

The implementation strategy is a clean rebuild — strip the existing student HTML files to their functional skeleton (API calls, form logic, session checks) and rebuild the visual layer from scratch using this spec. Do not attempt to incrementally style the old markup.

---

## 1. Relationship to the Ennovate Website

The student portal is not a separate product. It is an **internal tool that belongs to the same design world as the public-facing Ennovate website**. A student who has seen the main site should open the portal and immediately recognise it as part of the same family.

This is achieved through three things:
1. Identical color system, typography, and grid texture
2. The **Identity Strip** (see Section 5) appearing on every page
3. The same border language, button style, and monospace metadata voice

The portal does not try to look like a standard SaaS dashboard. It looks like a terminal built by the same people who built the public site.

---

## 2. Design Philosophy

**Aesthetic:** *Editorial Brutalism + Technical Precision* — inherited directly from the Ennovate website.

**Portal-specific tone shift:** The homepage is aggressive and declarative. The portal is calm and precise. Less shouting, more readout. The UI should feel like a piece of engineering equipment — everything is functional, nothing is decorative, but the craft is visible in the details.

**The one rule above all others:** A student opens this portal, browses components, submits a request, and comes back to check its status. Every design decision must serve that loop. Nothing that slows it down survives.

---

## 3. Color System

**Strict inheritance from the Ennovate website. No new colors.**

| CSS Token | Value | Usage |
|---|---|---|
| `--black` | `#060606` | Primary background, sidebar |
| `--white` | `#F4F4EF` | Primary text, filled buttons |
| `--mid` | `#0C0C0C` | Card backgrounds |
| `--surface` | `#0E0E0E` | Secondary surfaces, inputs |
| `--dim` | `#444444` | Muted text, labels, inactive nav links |
| `--border` | `rgba(255,255,255,0.065)` | All dividers, card outlines, input borders |
| `--border-strong` | `rgba(255,255,255,0.22)` | Hover states, focused inputs, strong outlines |

**The only color exceptions — component/request status only:**

| Status | Color | Token | Usage |
|---|---|---|---|
| Available / Approved / Confirmed | Green | `--status-green: #4ade80` | In-stock badge, approved badge, active borrow indicator |
| Pending / Warning / Low stock | Amber | `--status-amber: #fbbf24` | Pending badge, pending requests |
| Out of Stock / Rejected / Withdrawn | Red | `--status-red: #f87171` | Out-of-stock badge, rejected badge, delete actions |

**Rules:**
- These three status colors appear ONLY as text or thin borders on dark backgrounds. Never as solid fills.
- Pattern: `background: rgba(COLOR, 0.08); color: COLOR; border: 1px solid rgba(COLOR, 0.18)`
- No other colors appear anywhere in the UI. Not in charts, not in stats, not in decorative elements.
- Stats, charts, count-up numbers, bars — all in `--white` or `--dim`. Not blue, not teal.
- The only "color" effect outside of status is `mix-blend-mode: difference` on the custom cursor.

---

## 4. Typography

Identical to the Ennovate website. Loaded via `next/font/google` or a single Google Fonts `<link>` tag.

| Role | Font | Weight | Size |
|---|---|---|---|
| Page titles, large numbers | Bebas Neue | 400 | `clamp(40px, 5vw, 64px)` for titles; `40px` for stat numbers; `22px` for USN display |
| Card / section headings | Bebas Neue | 400 | `18–22px` |
| Body text, descriptions | Barlow | 400 / 600 | `13–15px` |
| All labels, metadata, tags, buttons, nav links, badges | JetBrains Mono | 400 | `7–10px`, `letter-spacing: 1.5–3px`, `text-transform: uppercase` |

**Import string:**
```
Bebas+Neue&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500
```

---

## 5. The Identity Strip

This is the most important cross-cutting element. It appears on **every page** of the student portal, anchoring it within the Ennovate design language.

**What it is:** A full-width horizontal text strip — inherited directly from the Cassette-style header on the Ennovate homepage, adapted for the portal context.

**Position:** Fixed at the very bottom of the viewport. `position: fixed; bottom: 0; left: 0; right: 0; z-index: 50`.

This placement was chosen over top-of-page because:
- The top is occupied by the mobile menu toggle on small screens
- Bottom placement never conflicts with the sidebar or content header
- It reads as a status bar — a terminal footer — which is conceptually correct for a tool UI
- It does not interrupt the content reading flow

**Dimensions:** `height: 32px`. Full viewport width.

**Background:** `var(--black)` with `backdrop-filter: blur(8px)` for when content scrolls behind it.

**Border:** `border-top: 1px solid var(--border)` only.

**Content:** Five items spaced evenly across the full width using `display: flex; justify-content: space-between`.

```
ennovate          CERP · v1.3          // student portal          EST. 2022          MANDYA
```

Left-most item `ennovate` is in Bebas Neue, `13px`, `letter-spacing: 3px`. All other items are JetBrains Mono, `7px`, `letter-spacing: 2.5px`, uppercase, `color: var(--dim)`.

**Padding:** `0 40px` desktop. `0 20px` mobile.

**Mobile (`<= 768px`):** Show only `ennovate` (left) and `// student portal` (right). Hide the middle three items.

**Page body offset:** Add `padding-bottom: 32px` to every page body to prevent content from being hidden behind the strip.

**File location:** Extract into a reusable `IdentityStrip` component. Import on every page. Never inline it.

---

## 6. Global Components

### 6.1 Background Grid Texture
- `body::before`, `position: fixed; inset: 0`
- Two perpendicular `linear-gradient` lines at `rgba(255,255,255,0.016)`, `52px × 52px` spacing
- Animates: `background-position` drifts from `0 0` to `52px 52px` over `90s linear infinite`
- `pointer-events: none; z-index: 0`

### 6.2 Film Grain
- Generated procedurally in JavaScript on mount — no asset file needed
- Canvas element, `position: fixed; inset: 0; pointer-events: none; z-index: 99`
- A new 200×200px noise image is drawn every 60ms via `setInterval + requestAnimationFrame`
- `opacity: 0.04` desktop. `opacity: 0.025` mobile.
- Generation code:
```javascript
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 200;
const ctx = canvas.getContext('2d');
function frame() {
  const img = ctx.createImageData(200, 200);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i+1] = img.data[i+2] = v;
    img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--grain-url', `url(${canvas.toDataURL()})`);
  setTimeout(() => requestAnimationFrame(frame), 60);
}
frame();
```
Apply via CSS: `background-image: var(--grain-url); background-size: 200px 200px; background-repeat: repeat`

### 6.3 Navigation Sidebar
- `width: 200px` fixed, `height: 100vh`, `position: sticky; top: 0`
- `background: var(--black); border-right: 1px solid var(--border)`
- **Header:** Ennovate logo mark (`/assets/ennovate-logo.png`, `filter: invert(1)`, `width: 26px`) + `CERP` wordmark in Bebas Neue, `15px`, `letter-spacing: 4px`
- **Nav links:** JetBrains Mono, `8px`, `letter-spacing: 2px`, uppercase, `color: var(--dim)`. Padding `11px 18px`. `border-left: 2px solid transparent`. Active: `border-left-color: var(--white); color: var(--white); background: rgba(255,255,255,0.035)`. Hover: `color: rgba(255,255,255,0.6)`.
- **Footer:** Pushed to bottom with `margin-top: auto`. Contains logo mark at low opacity + "Student Portal" + "Built by Jishnu Abbhay D" in JetBrains Mono, `7px`, `color: rgba(255,255,255,0.13)`
- **Mobile:** Hidden. Triggered by `[ ≡ ]` toggle in a sticky top bar.

### 6.4 Cards
- `background: var(--mid)`
- `border: 1px solid var(--border)`
- `border-radius: 0` — hard edges throughout
- `padding: 20–28px`
- Hover: `border-color: rgba(255,255,255,0.12)`
- Top accent on hover: `::before` pseudo-element, `height: 2px`, `background: var(--white)`, `scaleX(0 → 1)` from left, `0.35s cubic-bezier(0.16,1,0.3,1)`

### 6.5 Buttons
- **Primary (filled):** `background: var(--white); color: var(--black)`. JetBrains Mono, `8–9px`, `letter-spacing: 2px`, uppercase. `border: none`. Text format: `[ Action Name ]`
- **Secondary (outline):** `background: transparent; color: var(--white); border: 1px solid var(--border-strong)`
- **Danger:** `background: transparent; color: var(--status-red); border: 1px solid rgba(248,113,113,0.2)`
- No border-radius on any button. Hard edges.
- Hover: primary dims slightly. Outline fills `rgba(255,255,255,0.04)`. No `transform: translateY`.

### 6.6 Inputs
- `background: rgba(255,255,255,0.018); border: 1px solid var(--border); border-radius: 0`
- `color: var(--white); font-family: 'Barlow'; font-size: 14px; padding: 11px 13px`
- Placeholder: JetBrains Mono, `10px`, `letter-spacing: 1px`, `color: var(--dim)`
- Focus: `border-color: rgba(255,255,255,0.28)`. No box-shadow.
- Labels: JetBrains Mono, `7px`, `letter-spacing: 2px`, uppercase, `color: var(--dim)`. `margin-bottom: 5px`.

### 6.7 Status Badges
All badges: JetBrains Mono, `7px`, `letter-spacing: 2px`, uppercase. No border-radius.

| Status | Background | Text | Border |
|---|---|---|---|
| Available / Approved / Confirmed / Active | `rgba(74,222,128,0.08)` | `#4ade80` | `rgba(74,222,128,0.18)` |
| Pending / Low Stock | `rgba(245,158,11,0.08)` | `#fbbf24` | `rgba(245,158,11,0.18)` |
| Out of Stock / Rejected / Withdrawn | `rgba(248,113,113,0.08)` | `#f87171` | `rgba(248,113,113,0.18)` |
| Completed / Expired / Neutral | `rgba(255,255,255,0.03)` | `#444` | `rgba(255,255,255,0.07)` |

### 6.8 Toast Notifications
- `position: fixed; bottom: 52px; right: 24px` (above the Identity Strip)
- `background: var(--mid); border: 1px solid; padding: 10px 18px`
- JetBrains Mono, `8px`, `letter-spacing: 2px`, uppercase
- Success: `border-color: rgba(74,222,128,0.35); color: #4ade80`
- Error: `border-color: rgba(248,113,113,0.35); color: #f87171`
- No border-radius. Fades in/out (`opacity 0.2s`). Auto-dismisses after `2500ms`.

### 6.9 Custom Cursor
- `10px` white circle, `mix-blend-mode: difference`
- Expands to `40px` on interactive elements
- Disabled on `@media (hover: none)` touch devices

---

## 7. Page Specs

### 7.1 Student Login (`/student-login.html`)

**Layout:** Full viewport, no sidebar. Content centered vertically and horizontally. Grid texture and film grain active. Identity Strip at bottom.

**Above the card:**
- Ennovate logo mark, `filter: invert(1)`, `width: 52px`
- Eyebrow: `// Student Portal · CERP` — JetBrains Mono, `8px`, `letter-spacing: 3px`, `color: var(--dim)`

**Login card:**
- `background: var(--mid); border: 1px solid rgba(255,255,255,0.085); padding: 30px; width: 300px`
- Top edge: a single gradient shimmer line (`background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent); height: 1px`) at the very top border
- Scanline: `::after` pseudo-element, `height: 1px`, `background: rgba(255,255,255,0.04)`, sweeps from `top: 0` to `top: 100%` over `4s linear infinite`
- Title: Bebas Neue, `30px`, `letter-spacing: 3px`
- Sub: JetBrains Mono, `8px`, `letter-spacing: 2px`, uppercase, `color: var(--dim)`
- Fields: standard input spec
- Submit button: full width, primary style
- Error message: JetBrains Mono, `8px`, `color: var(--status-red)`, prefixed with `//`

**Below the card:**
- `Admin Login →` — JetBrains Mono, `8px`, `letter-spacing: 2px`, `color: var(--dim)`, hover: `color: var(--white)`
- `// Built by Jishnu Abbhay D` — `color: rgba(255,255,255,0.1)`

---

### 7.2 Student Dashboard (`/student-dashboard`)

**Page title:** `DASHBOARD`
**Sub:** `// Welcome, [student_name] · [usn]`

**Quick action:** `[ Browse & Request Components ]` primary button, links to catalog.

**Three cards (stacked, full-width):**

**Active Borrows card** — `border-left: 2px solid rgba(74,222,128,0.38)`:
- Each borrow as an item row: component name (Barlow 600, 13px) + remaining count in Bebas Neue, `34px`, `color: var(--white)` floated right. **Not colored.** The status badge next to the name carries the green signal.
- `// no active borrows` in JetBrains Mono if empty

**Pending Requests card** — `border-left: 2px solid rgba(245,158,11,0.38)`:
- Each request: name × qty + amber badge + date meta
- `// no pending requests` if empty

**Request History card** — no colored border:
- Compact list: name × qty + status badge + date
- Most recent first

---

### 7.3 Component Catalog (`/student-catalog`)

**Page title:** `CATALOG`
**Sub:** `// Browse available components & add to cart`

**Search bar + cart toggle:** Side by side in a card. Search input (flex: 1). Desktop cart button `[ Cart N ]` appears only when cart has items.

**Component grid:** `display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1px; background: var(--border)` — the gap creates the 1px line between cards without needing individual borders.

**Component card anatomy:**
- `background: var(--mid)`. No outer border (the grid gap provides separation).
- Top accent on hover (same as global card spec)
- Photo: `width: 100%; height: 100px; object-fit: cover; filter: brightness(0.85)`. If no photo, show a `background: #111` placeholder with `// NO IMG` in JetBrains Mono.
- Component name: Barlow, `14px`, `font-weight: 600`, `color: var(--white)`
- Availability badge: green/amber/red per status rules
- Meta: `total: N · available: N` in JetBrains Mono, `8px`, `color: var(--dim)`
- **Out of stock:** Disabled button, `background: transparent; border: 1px solid rgba(255,255,255,0.05); color: var(--dim); cursor: not-allowed`
- **In stock, not in cart:** `[ Add to Cart ]` primary button, full width
- **In cart:** Quantity control row (`−`, count in Bebas Neue `22px`, `+`) + `[ Remove ]` danger outline below

**Cart Drawer:**
- Slides in from right on `right: -420px → 0`. Overlay behind it: `rgba(0,0,0,0.6)` with `backdrop-filter: blur(4px)`.
- `background: var(--black); border-left: 1px solid var(--border)`
- Header: `CART` in Bebas Neue, `28px`, `letter-spacing: 3px` + `×` close button (outline secondary)
- Cart items: same item-row style as dashboard borrows
- Purpose note: standard textarea
- Submit button: `[ Submit Request ]`, full width, primary. Disabled until cart has items.
- Grain and grid texture continue inside the drawer.

**Floating cart FAB (mobile):**
- `background: var(--white)`. Icon inverted. Badge: `background: var(--status-red); color: var(--white)`.
- Pulses `scale(1.12)` for 200ms when an item is added.

---

### 7.4 My Requests (`/student-requests-page`)

**Page title:** `MY REQUESTS`
**Sub:** `// View and manage your component requests`
**Top right:** `[ + New Request ]` primary button, links to catalog.

**Filter row:**
- Five filter buttons: `All`, `Pending`, `Approved`, `Rejected`, `Withdrawn`
- Active filter: `background: var(--white); color: var(--black); border-color: var(--white)`
- Inactive Pending: `color: var(--status-amber); border-color: rgba(245,158,11,0.22)`
- Inactive Approved: `color: var(--status-green); border-color: rgba(74,222,128,0.22)`
- Inactive Rejected: `color: var(--status-red); border-color: rgba(248,113,113,0.22)`
- Inactive Withdrawn: `color: var(--dim); border-color: var(--border)`

**Request rows:**
- `background: var(--mid); border: 1px solid var(--border); border-left: 2px solid [status-color]`
- Status left border colors: approved → `rgba(74,222,128,0.4)`, pending → `rgba(245,158,11,0.4)`, rejected → `rgba(248,113,113,0.35)`, confirmed → `rgba(255,255,255,0.2)`, withdrawn/other → `rgba(255,255,255,0.08)`
- Component name: Barlow 600, `14px` + status badge inline
- Date: JetBrains Mono, `8px`, `color: var(--dim)`, right-aligned
- Purpose note: JetBrains Mono, `8px`, `color: var(--dim)` below name
- Rejection reason: same size, `color: rgba(248,113,113,0.6)`, prefixed `reason:`
- Confirmed timestamp: `color: rgba(255,255,255,0.4)`, prefixed `confirmed:`
- Edit + Withdraw buttons appear only for `PENDING` and `DRAFT` status. Both small secondary/danger style.

**Edit Modal:**
- Standard modal overlay: `rgba(0,0,0,0.75)`, `backdrop-filter: blur(6px)`
- Modal box: `background: var(--surface); border: 1px solid rgba(255,255,255,0.14); padding: 32px`
- Title: Bebas Neue, `28px`, `letter-spacing: 3px`
- Component field: readonly, `opacity: 0.5; cursor: not-allowed`
- No border-radius on modal box.

---

### 7.5 My Profile (`/student-my-profile`)

**Page title:** `MY PROFILE`
**Sub:** `// Your account details`

**Read-only by design.** The profile page shows information, not forms (except password change). Every interaction is exploratory, not editorial.

**Avatar block (top-left):**
- Square, `80px × 80px`, `background: var(--mid); border: 1px solid rgba(255,255,255,0.1)`
- Student initials in Bebas Neue, `28px`
- Three concentric square rings radiating outward: `inset: -8px`, `-16px`, `-24px`. Pulse animation, `3s ease-in-out infinite`, staggered `0.6s`. All white at decreasing opacity.
- Online indicator dot: `8px × 8px`, `background: var(--status-green)`. Pulses opacity `1 ↔ 0.3` over `2s`.
- No colored avatar background — the initials and rings are the identity marker.

**Above the stats:** Name in Bebas Neue, `42px`. USN, department, semester, club as monochrome tag pills (bordered, `color: var(--dim)`).

**Stats row:** 4-column grid. `background: var(--border)` gap between cells.
- Total Borrowed · Returned · Active Holds · Requests Made
- Numbers in Bebas Neue, `40px`, `color: var(--white)` — no color tinting
- Count-up animation on load (staggered 120ms each)

**Profile fields:** 2-column grid of field tiles.
- Each tile: `background: rgba(255,255,255,0.018); border: 1px solid var(--border); padding: 13px`
- Label: JetBrains Mono, `7px`, `letter-spacing: 2px`, uppercase, `color: var(--dim)`, prefixed `//`
- Value: Barlow 600, `14px` (USN uses Bebas Neue, `22px`, `letter-spacing: 2px`)
- Hover: `border-color: rgba(255,255,255,0.1)`. A bottom-edge line sweeps in `scaleX(0 → 1)`.
- **USN and Email fields:** Show `[ copy ]` hint on hover (JetBrains Mono, `7px`, right edge). Click copies to clipboard. Field flashes green border + label color briefly. Toast confirms.

**Active Holds panel:**
- Lists current borrows: component name + a white progress bar showing proportion of total stock held + count in Bebas Neue + `of N held` meta.
- Bars animate width `0 → target%` on load (400ms delay, `1s transition`).
- Hover on each row: `padding-left: 4px` nudge.
- Bar color: `var(--white)` — no blue or other color.

**Identity Pattern:**
- Deterministic pixel pattern (8×8 grid, 10px per cell) generated from USN as seed.
- Each cell: on or off based on `Math.sin(seed + index)` — same USN always produces the same pattern.
- Pattern is mirrored horizontally for visual symmetry.
- No color. White cells on dark background.
- Label: `// Identity Pattern · [USN]` in JetBrains Mono, `7px`, `color: var(--dim)`

**Activity Chart:**
- 8-month bar chart of request history
- Bar fill: `var(--white)`. Current month bar: same white but slightly higher opacity.
- No colors on bars — the count is the information, not the color.
- Bars animate height `0 → target%` staggered 80ms on load.
- Hover on bar: tooltip appears above showing `N request(s)` — `background: var(--mid); border: 1px solid rgba(255,255,255,0.15)`

**Password Change block:**
- `border-left: 2px solid rgba(248,113,113,0.32)`
- Two password fields + `[ Update Password ]` danger-style button
- Only interactive form element on this page

---

### 7.6 Confirm Receipt (`/confirm-receipt.html`)

**Layout:** Full viewport, centered. No sidebar. Grid + grain active. Identity Strip at bottom.

- Ennovate logo mark above card
- Card: `background: var(--mid); border: 1px solid var(--border); padding: 48px 36px; max-width: 440px`
- States: Loading (animated dots), Success, Already Confirmed, Error
- State headings: Bebas Neue, `32px`. No color on headings.
- Success icon: SVG checkmark with `stroke-dashoffset` draw animation, `0.6s`. White stroke.
- Message body: JetBrains Mono, `10px`, `color: var(--dim)`

---

## 8. The Identity Strip — Integration

The strip must be present and visible on every page. Here is how it behaves on each:

| Page | Sidebar present? | Strip position | Notes |
|---|---|---|---|
| Login | No | `position: fixed; bottom: 0` | Spans full viewport width |
| Dashboard | Yes | `position: fixed; bottom: 0` | Spans full viewport width including sidebar |
| Catalog | Yes | `position: fixed; bottom: 0` | Same |
| Requests | Yes | `position: fixed; bottom: 0` | Same |
| Profile | Yes | `position: fixed; bottom: 0` | Same |
| Confirm Receipt | No | `position: fixed; bottom: 0` | Same as login |

**Why fixed and not static:** A static footer would require the page to scroll to its full extent before the strip is visible. Fixed ensures it is always visible — a persistent identity anchor.

**Body padding:** Every page must have `padding-bottom: 32px` (the height of the strip) on the scrollable content area so content is never hidden behind it.

**Z-index:** `50` — above content and sidebar, below modals (`10000`) and toasts (`9999`).

---

## 9. Film Grain — Integration

The grain canvas must be appended to `<body>` on every page via a shared script (`grain.js`). Call it from a `<script src="/grain.js">` tag in each HTML file.

`/grain.js`:
```javascript
(function() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99;opacity:0.04;';
  canvas.width = canvas.height = 200;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  function frame() {
    const img = ctx.createImageData(200, 200);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i+1] = img.data[i+2] = v;
      img.data[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    canvas.style.backgroundImage = `url(${canvas.toDataURL()})`;
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.backgroundSize = '200px 200px';
    setTimeout(() => requestAnimationFrame(frame), 60);
  }
  frame();
})();
```

On mobile (`window.innerWidth <= 768`), reduce `opacity` to `0.025`.

---

## 10. Motion Summary

| Element | Trigger | Animation |
|---|---|---|
| Login card scanline | Continuous | `top: 0 → 100%`, `4s linear infinite` |
| Nav link active state | Route change | Instant — no transition |
| Card top accent | Hover | `scaleX(0 → 1)`, `0.35s cubic-bezier(0.16,1,0.3,1)` |
| Field bottom line | Hover | `scaleX(0 → 1)`, `0.3s ease` |
| Catalog card accent | Hover | Same as card |
| Hold row nudge | Hover | `padding-left: 0 → 4px`, `0.15s` |
| Stats count-up | Page load | Increments over ~40 steps, 120ms stagger between stats |
| Hold bars | Page load | `width: 0 → target`, `1s cubic-bezier(0.16,1,0.3,1)`, `400ms` delay |
| Chart bars | Page load | `height: 0 → target`, staggered `80ms` each, `0.7s` transition |
| Avatar rings | Continuous | Pulse scale+opacity, `3s`, staggered `0.6s` |
| Active indicator dot | Continuous | Opacity `1 ↔ 0.3`, `2s ease infinite` |
| Copy field | Click | Border + label flash green, `1800ms`, then revert |
| Identity pattern | Page load | Instant render — no animation |
| Cart FAB | Item added | `scale(1.12)` for `200ms` then back |
| Cart drawer | Toggle | `right: -420px → 0`, `0.3s cubic-bezier(0.4,0,0.2,1)` |
| Toast | Show/hide | `opacity 0.2s` |
| Film grain | Continuous | New frame every `60ms` |
| Grid texture | Continuous | `background-position` drift, `90s linear infinite` |
| Modal | Open/close | `opacity + visibility 0.2s`, box `translateY(16px → 0)` |

---

## 11. File Structure

All student files exist at the root of the project (same level as admin files). The `student-style.css` file is separate from `style.css` — admin pages use `style.css`, student pages use `student-style.css`.

```
/ (project root)
├── student-login.html
├── student-dashboard.html      (served at /student-dashboard)
├── student-catalog.html        (served at /student-catalog)
├── student-requests.html       (served at /student-requests-page)
├── student-my-profile.html     (served at /student-my-profile)
├── confirm-receipt.html
├── student-style.css           ← Student portal styles (this spec)
├── grain.js                    ← Shared film grain script
├── identity-strip.js           ← Shared Identity Strip injector
├── dark-mode.js                ← Existing, keep
├── club-branding.js            ← Existing, keep
├── style.css                   ← Admin styles — do not touch
└── ennovate-logo.png
```

`identity-strip.js` — injects the strip HTML and its styles on every student page:
```javascript
(function() {
  const strip = document.createElement('div');
  strip.id = 'identity-strip';
  strip.innerHTML = `
    <span class="is-brand">ennovate</span>
    <span class="is-item">CERP · v1.3</span>
    <span class="is-item is-hide-mobile">// student portal</span>
    <span class="is-item is-hide-mobile">EST. 2022</span>
    <span class="is-item">MANDYA</span>
  `;
  document.body.appendChild(strip);
})();
```

Styles for the strip are included in `student-style.css`.

---

## 12. Accessibility Notes

- Custom cursor disabled on `(hover: none)` devices
- All images have `alt` attributes
- Interactive elements (`[ copy ]`, qty buttons, filter buttons) use `<button>` or `<div role="button" tabindex="0">`
- Color is never the only differentiator — status badges always show text, not just color
- **TODO:** Add `prefers-reduced-motion` media query to disable continuous animations (grain, rings, drift)
- **TODO:** Verify `#444` on `#060606` meets WCAG AA for small text (it does not at `7px` — ensure no critical information relies solely on `var(--dim)` text at that size)

---

## 13. What Makes This Portal Unforgettable

1. The Identity Strip — a student in the portal is never fully separated from the Ennovate world.
2. Film grain on every page — the same texture as the main site header, now everywhere.
3. The identity pattern on the profile — your USN generates a unique visual fingerprint.
4. `[ Square bracket buttons ]` — the same terminal syntax as the public site, in a tool.
5. JetBrains Mono everywhere for metadata — the portal reads like engineering equipment.
6. No color except status — when green appears, it means something. When red appears, pay attention.
7. Zero border-radius — every edge is hard. Every element is precise.
