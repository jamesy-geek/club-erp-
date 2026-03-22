# Ennovate Website — Canonical Design & Implementation Spec
**Version:** 4.0 (Consolidated)  
**Last Updated:** March 22, 2026  
**Stack:** Next.js 14 (App Router), CSS Modules, Framer Motion  
**Deployment:** Vercel  

> **IMPORTANT:** This is the **only** design document. All previous versioned docs (V2.0, V3.0, V3.1) are superseded by this file. Use git history for version tracking.

---

## Changelog

| Date | Change |
|---|---|
| Mar 22 | Consolidated V2.0 + V3.0 + V3.1 into single canonical doc. Added EyeSection spec, shutter effect, accessibility notes. Removed stale Lenis references. |
| Mar 21 | v3.1 refinements: native scroll revert, logotype fitting, interactive eye, grain reduction. |
| Mar 21 | v3.0: Added Cassette Header, text scramble, magnetic buttons, film grain. |
| Mar 20 | v2.0: Initial spec — Hero, Pillars, Stats, Challenges, Manifesto, CTA, Footer, RobotEye. |

---

## 1. Project Overview

**Club:** Ennovate — a college innovation and technology club, Est. 2022, Mandya, India.  
**Tagline:** *"Innovation for Living. And Fun."*  
**Hero Tagline:** *"We don't wait for the future. We build it."*  
**Site Purpose:** Public-facing club homepage. Goals: communicate identity, showcase challenges, and recruit new members.

---

## 2. Design Philosophy

**Core Aesthetic:** *Editorial Brutalism + Technical Precision*

- Strict black and white palette. Zero color.
- Industrial condensed display typography (Bebas Neue).
- Monospace fonts (JetBrains Mono) for all labels, metadata, and UI chrome.
- Subtle animated grid overlay as background texture.
- Contrast is the only design luxury.

---

## 3. Color System

| Token | Value | Usage |
|---|---|---|
| `--black` | `#090909` | Primary background |
| `--white` | `#F4F4EF` | Primary text, inverted section backgrounds |
| `--mid` | `#141414` | Card backgrounds |
| `--dim` | `#555555` | Muted text, labels |
| `--border` | `rgba(255,255,255,0.1)` | Dividers, outlines |

**Rules:** No gradients. No accent colors. Only `mix-blend-mode: difference` on cursor.

---

## 4. Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| Hero Display | Bebas Neue | 400 | `clamp(72px, 13vw, 180px)` |
| Cassette Logotype | Bebas Neue | 400 | `clamp(80px, 18vw, 240px)` |
| Section Headings | Bebas Neue | 400 | `44px` |
| Pillar Titles | Bebas Neue | 400 | `clamp(48px, 7vw, 92px)` |
| Card Titles | Barlow Condensed | 700 | `clamp(22px, 3vw, 32px)` |
| Body | Barlow | 400 | `15–16px` |
| Labels/Metadata | JetBrains Mono | 400 | `9–12px` |
| Stats Numbers | Bebas Neue | 400 | `clamp(52px, 7vw, 96px)` |

Fonts loaded via `next/font/google` in `layout.jsx` — no external `<link>` tags.

---

## 5. Global Components

### 5.1 Custom Cursor
- `10px` white circle, `mix-blend-mode: difference`, expands to `40px` on interactive elements.
- Disabled on touch via `@media (hover: none)`.

### 5.2 Background Grid
- `body::before`, fixed, `60px × 60px` grid lines at `rgba(255,255,255,0.025)`.
- Animated drift: `80s linear infinite`.

### 5.3 Navigation Bar
- Fixed, `60px` height, blur backdrop (`blur(14px)`), scroll-triggered border-bottom.
- Logo: `/assets/ennovate-logo.png`, `filter: invert(1)`.
- Desktop: `About`, `Challenges`, `Join Us` links.
- Mobile: `[ ≡ ]` toggle → full-width drawer.

### 5.4 Scroll Behavior
- **Native browser scrolling** — no smooth-scroll library.
- `html { scroll-behavior: smooth; }` for anchor transitions.
- Scroll reveals via Framer Motion `whileInView` with `threshold: 0.08`.

---

## 6. Page Sections (in order)

### Section 0 — Cassette Header

Full-viewport cinematic intro. First thing visitors see.

**Structure:**
```
[ ennovate — logotype, fits within viewport width              ]
[ .ennovate logo mark                                         ]
[ MANDYA   EST. 2022   INNOVATION FOR LIVING. AND FUN.  INDIA ]  ← metadata strip (text scramble)
[                                                              ]
[            RobotEye (CSS, swappable for sprite sheet)        ]
[                                                              ]
[ ↓ scroll                                   SYS_ONLINE · V3.0]
```

- **Height:** `100svh`, `min-height: 700px`.
- **Logotype:** `clamp(80px, 18vw, 240px)`, `letter-spacing: 0.15em`, fits within viewport (no bleed).
- **Logo Mark:** Below logotype, `height: 28px`, `filter: invert(1)`, `opacity: 0.45`.
- **Metadata Strip:** Text scramble animation on load. Mobile: show `MANDYA` + `EST. 2022` only.
- **Eye Area:** Currently uses `<RobotEye />` as fallback. Clearly marked as swappable for sprite sheet.
- **Film Grain:** Procedural JS canvas (200×200px), `opacity: 0.05` desktop, `0.03` mobile. Rapid `background-position` shift at `0.08s steps(1)`.
- **Footer Strip:** `↓ scroll` (left), `SYS_ONLINE · V3.0` (right, hidden on mobile).

---

### Section 1 — Hero (WE. BUILD. REAL.)

Full viewport height, content bottom-left.

- **Ghost Watermark:** `"03"`, `rgba(255,255,255,0.03)`, hidden on mobile.
- **Eyebrow:** Typewriter effect — `"Club Ennovate · Est. 2022"`.
- **Title:** Three stacked clip-reveal lines: `WE.` → `BUILD.` → `REAL.` (outlined).
- **Sub-Copy:** `"Robots, code, and real-world problems. Three years of building things that actually matter."`
- **CTAs:** `[ What We Do ]` (outlined) + `[ Join the Club ]` (filled, magnetic effect).
- **Right side:** Currently empty — planned for future enhancement.

---

### Section 2 — What We Do (3 Pillars)

Three full-width alternating bands (black/white/black).

| # | Title | Tags |
|---|---|---|
| 01 | ROBOTICS | ROS, Arduino, Inverse Kinematics, OpenCV, 3D Printing |
| 02 | REAL PROBLEMS | Deployed, Field Tested, Impact Driven, Cross-disciplinary |
| 03 | SIDE PROJECTS | AI Agents, Embedded Systems, Web Apps, Hardware Hacks |

Hover: left edge accent bar scales in from top.

---

### Section 3 — Stats Bar

4-column grid with count-up animation on scroll.

| Stat | Label | Target |
|---|---|---|
| `3+` | Years Active | 3 |
| `40+` | Members | 40 |
| `20+` | Projects Shipped | 20 |
| `∞` | Ideas Left | Static |

Mobile: wraps to 2×2 grid.

---

### Section 4 — Upcoming Challenges

3-column card grid. Featured card spans 2 columns (1 on mobile).

---

### Section 5 — Manifesto

Two-column layout. Left: pull quote with outlined `build`. Right: three body paragraphs.

---

### Section 6 — Join Us CTA

Inverted section (`--white` bg, `--black` text). Ghost "BUILD" watermark. Magnetic CTA button.

---


### Section 6b — Borrow Components CTA Strip

A full-width strip inserted between the Join Us CTA section and the Interactive Eye section. This bridges the public-facing site to the CERP student portal.

**Container:** `border-top: 1px solid var(--border)`, `border-bottom: 1px solid var(--border)`. Background: `var(--black)`. Height: auto, `padding: 48px 60px`.

**Layout:** Split row — left side text, right side button.

**Left side:**
- Eyebrow: `// Club Members` — JetBrains Mono, `9px`, `letter-spacing: 3px`, uppercase, `color: var(--dim)`
- Heading: `BORROW COMPONENTS` — Bebas Neue, `clamp(40px, 6vw, 72px)`, `color: var(--white)`, `line-height: 0.9`
- Sub-text: Barlow, `14px`, `color: var(--dim)`, `max-width: 400px`:  
  `"Club members can browse and borrow hardware, electronics, and fabrication materials from the CERP inventory. Log in with your student account to get started."`

**Right side:**
- Primary button: `[ Access CERP Portal ]` — JetBrains Mono, `10px`, `letter-spacing: 2px`, white filled. Links to `/student-dashboard` (or `/student-login.html` if not authenticated).
- Below button: `// cerp · club equipment resource portal` — JetBrains Mono, `8px`, `color: var(--dim)`

**Hover on button:** Magnetic button effect (see Section 12.1 in Advanced Features). This button is the single best place to apply the magnetic effect on the homepage.

**Mobile (`<= 768px`):** Stack to single column. Button full-width. Padding reduces to `32px 20px`.

**Motion:** Scroll reveal — `fadeUp`, `threshold: 0.08`. No delay.

---

### Section 7 — Interactive Eye (Post-CTA)

**Purpose:** A full-section interactive element that creates a moment of surprise before the footer.

**Container:** `60vh` height, centered, `background: var(--black)`.

**Eye Structure:**

| Layer | Description |
|---|---|
| 3× Rings | Concentric circles at `inset: 0`, `15%`, `30%`. Increasing opacity. |
| Iris | Circle at `inset: 35%`. Radial gradient fill. `box-shadow: 0 0 80px rgba(255,255,255,0.08)` (white glow aura). |
| Pupil | `30% × 30%` white circle. Framer Motion spring-based tracking. `box-shadow: 0 0 15px rgba(255,255,255,0.3)`. |
| Shutter | 7 triangular blades (camera aperture). Closes every ~10s for ~0.4s, then reopens. |

**Tracking Behavior:**
- **Desktop:** Pupil follows cursor via `useMotionValue` + `useSpring`. Spring config: `{ damping: 25, stiffness: 120, mass: 0.5 }`. Max travel radius: `0.06 × containerWidth`.
- **Touch:** Gentle random drift every 3 seconds, radius ~10px.

**Shutter Effect:**
- 7 blades using `clip-path: polygon()` forming triangular wedges around center.
- CSS `@keyframes shutterClose`: blades scale from `0.3` (invisible) to `1.15` (fully closed) at the 92% mark of a 10s cycle.
- Staggered `animation-delay` on blades for mechanical feel.

**Sizing:**
- Desktop: `clamp(280px, 35vw, 400px)`.
- Mobile (≤768px): Same clamp — no reduction.

**Label:** `[ INTERACTIVE_EYE_04 ]` below the eye.

---

### Section 8 — Footer

`background: var(--white)`, `color: var(--black)`.

- Left: `Club Ennovate · Est. 2022 · Innovation for Living. And Fun.`
- Right: `Instagram`, `LinkedIn`, `GitHub` links.

---

## 7. Robot Eye Component Spec (Header Eye)

Pure CSS animated component. Used in CassetteHeader (swappable for sprite sheet).

**Container:** `clamp(160px, 22vw, 300px)` square. Mobile (≤768px): `220px × 220px`.

**Layers:**

| # | Class | Animation |
|---|---|---|
| 1 | `.ring` ×3 | Pulse: scale 1↔1.02, opacity 0.5↔1, `4s` staggered |
| 2 | `.crosshair` | Reverse rotation, `12s linear` |
| 3 | `.ticks` | Forward rotation, `20s linear` |
| 4 | `.iris` | Static radial gradient |
| 5 | `.scan` | Scanline sweep, `translateY`, `3s linear` |
| 6 | `.pupil` | 8-position scan loop, `8s ease-in-out` |
| 7 | `.blink` | `clip-path` blink — eye open 95% of time, rare quick blink at 97% mark, `7s` cycle |

---

## 8. Responsive Breakpoints

| Breakpoint | Behavior |
|---|---|
| `> 768px` | Full desktop layout |
| `≤ 768px` | Mobile drawer nav. Ghost watermark hidden. Pillars stack. Stats 2×2. Challenges 1-col. Manifesto 1-col. Grain opacity reduced to `0.03`. Eye scale `1.3×`. Padding `20px`. |
| `≤ 480px` | Logotype font-size reduced. Footer strip right item hidden. |

---

## 9. Motion Summary

| Element | Trigger | Animation |
|---|---|---|
| Logotype | Page load | slideUp clip, `0.3s` delay |
| Logo mark | Page load | fadeUp, `0.6s` delay |
| Metadata strip | Page load | fadeUp + text scramble, `0.7s` |
| Eye animation | Page load | opacity, `1.0s` delay |
| Hero titles | Page load | slideUp per line, `0.5s / 0.65s / 0.8s` |
| Hero sub + CTAs | Page load | fadeUp, `1.1s / 1.3s` |
| All sections | Scroll | fadeUp, `threshold: 0.08` |
| Stats numbers | Scroll | Count-up, `threshold: 0.5` |
| RobotEye pupil | Continuous | 8-position scan, `8s` |
| RobotEye blink | Continuous | clip-path, rare blink, `7s` |
| Interactive eye pupil | Continuous | Spring tracking (desktop) / random drift (touch) |
| Interactive eye shutter | Continuous | Aperture close/open, `10s` cycle |
| Background grid | Continuous | Position drift, `80s` |
| Film grain | Continuous | Position shift, `0.08s steps(1)` |

---

## 10. Accessibility

- Custom cursor disabled on touch devices via `@media (hover: none)`.
- All images use `alt` attributes.
- Semantic HTML: `<section>`, `<nav>`, `<main>`, `<footer>`.
- Interactive elements use `<a>` or `<button>` for keyboard access.
- **TODO:** Add `prefers-reduced-motion` media query to disable continuous animations.
- **TODO:** Verify `--dim` (#555) on `--black` (#090909) meets WCAG AA contrast for small text.

---

## 11. Stack Decisions

| Choice | Why |
|---|---|
| Next.js 14 (App Router) | SSG by default, `next/font`, `next/image`, Vercel integration |
| CSS Modules | Scoped styles, supports custom animations, zero translation from prototype |
| Framer Motion | GPU-accelerated scroll reveals, spring physics, React-native |
| Native Scroll | Lenis was removed — caused perceivable lag. Native is instant. |
| Vercel | Zero-config deploy, CDN edge serving, preview URLs per PR |
| No Tailwind | Design is too bespoke — arbitrary values would dominate |
| No backend | Static site. Join form uses `/api/join` serverless function with Resend. |

---

## 12. File Structure

```
ennovate-website/
├── app/
│   ├── layout.jsx             ← Root: fonts, nav, cursor, metadata
│   ├── page.jsx               ← Homepage section assembly
│   ├── globals.css            ← Tokens, grid, grain, shared keyframes
│   └── join/page.jsx          ← Join page (see join-page-spec.md)
├── components/
│   ├── CassetteHeader/        ← Section 0: cinematic intro
│   ├── Hero/                  ← Section 1: WE.BUILD.REAL.
│   ├── Pillars/               ← Section 2: What We Do
│   ├── Stats/                 ← Section 3: Stats bar
│   ├── Challenges/            ← Section 4: Upcoming challenges
│   ├── Manifesto/             ← Section 5: Pull quote + body
│   ├── CTA/                   ← Section 6: Join CTA
│   ├── EyeSection/            ← Section 7: Interactive eye + shutter
│   ├── Footer/                ← Section 8
│   ├── RobotEye/              ← Reusable CSS eye (header fallback)
│   ├── Nav/                   ← Navigation bar
│   ├── Cursor/                ← Custom cursor
│   └── MagneticButton/        ← Magnetic hover effect
├── hooks/
│   └── useTextScramble.js     ← Text scramble animation hook
└── public/assets/             ← Logo, future sprite sheets
```

---

## 13. What Makes It Unforgettable

1. The full-viewport `ENNOVATE` logotype — confident, fills the screen.
2. The RobotEye in the header — looks back at you, swappable for hand-drawn sprites.
3. Film grain on the header — analogue texture in a digital context.
4. `WE. BUILD. REAL.` — three words, one outlined. Pure aggression.
5. The interactive eye — follows your cursor, has a camera shutter.
6. JetBrains Mono everywhere — the site reads like a terminal.
7. Zero color. Discipline is the identity.
