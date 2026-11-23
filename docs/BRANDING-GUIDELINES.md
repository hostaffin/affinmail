# AffinMail: Brand Identity & Logo Guidelines

> **Tagline:** *"Optimized Workspace of Efficient Business."*  
> **Brand Classification:** Sovereign Enterprise Email & Cloud Communications Suite  
> **Ecosystem:** Hostaffin Cloud Infrastructure  

---

## 1. Brand Essence & Philosophy

AffinMail represents a new era in enterprise business communication. Built upon a high-performance **Rust Stalwart core engine** with zero container overhead (100% native systemd), AffinMail merges raw infrastructure power with refined, Gmail-grade webmail simplicity.

### Core Pillars
1. **Velocity & Memory Safety:** Powered by native compiled Rust, operating with sub-100MB RAM consumption.
2. **Sovereign Privacy & Security:** Bank-grade TLS 1.3, automated SPF/DKIM/DMARC/ARC signing, and absolute customer data ownership.
3. **Anti-Bloat Simplicity:** Clean, uncluttered UI/UX strictly governed by two enterprise themes (Light and Dark) with instant keyboard navigation.
4. **Affinity & Connectivity:** The bridge between hosting infrastructure, multi-domain clusters, and high-velocity business teams.

---

## 2. The Sovereign Wing Logomark

The AffinMail logomark is known as **"The Sovereign Wing"**. It features a 3D folded ribbon geometry combining the capital letter **"A"** with a crisp white origami envelope flap:

```
          ▲           Apex / Origami Ribbon Crest
        /   \
       / / \ \        Origami Envelope Flap (Pure White Mail Heart)
      / / ▲ \ \       Aero Wing Dynamic (Electric Cyan Speed Accent)
     /_/       \_\     Anchored Letter "A" Foundation (Royal Blue Ribbon)
```

### Visual Master Reference
- **Master 1024x1024 Icon:** [`docs/assets/logo-mark-1024.png`](file:///d:/AffinMail/docs/assets/logo-mark-1024.png)
- **App Icon 512x512:** [`webmail/public/logo-mark.png`](file:///d:/AffinMail/webmail/public/logo-mark.png)
- **Vector Favicon:** [`webmail/public/favicon.svg`](file:///d:/AffinMail/webmail/public/favicon.svg)

### Visual Anatomy
* **The Letter "A" Ribbon:** A continuous, high-definition 3D blue ribbon looping upwards from Royal Blue (`#2563EB`) on the left pillar to Cobalt Deep (`#1E40AF`) at the apex.
* **The Origami Envelope Flap:** An immaculate, folded white envelope sitting directly on the crossbar with subtle directional drop-shadow, representing pure and encrypted digital mail.
* **The Aerodynamic Gradient Tip:** The right wing folds downward, sweeping into an Electric Cyan (`#06B6D4`) accent that symbolizes Rust speed and low latency.
* **Midnight Squircle Shield:** A dark slate-to-midnight container with rounded corners (`rx=28`) providing high-contrast depth and visual authority.

---

## 3. Brand Color Palette & Tokens

AffinMail adheres to a strict, functional color palette engineered for high contrast and executive clarity:

| Color Name | Hex Code | Tailwind / Token | Semantic Purpose |
| :--- | :--- | :--- | :--- |
| **Affin Royal Blue** | `#2563EB` | `blue-600` / `--color-primary` | Primary brand color, primary actions, active compose |
| **Cobalt Deep** | `#1E40AF` | `blue-800` | Logomark foundation gradient, terminal headers |
| **Electric Cyan** | `#06B6D4` | `cyan-500` | Speed accent, forward flap gradient, CLI highlights |
| **Stalwart Teal** | `#0D9488` | `teal-600` / `--color-accent` | Cryptographic seal, verified SPF/DKIM pass badge |
| **Enterprise Slate** | `#0F172A` | `slate-900` | Dark mode primary text, favicon squircle background |
| **Midnight Dark** | `#0B0F19` | `gray-950` / `--color-bg-base` | Dark mode root canvas |
| **Enterprise White** | `#FFFFFF` | `white` | Light mode canvas, negative space apertures |
| **Surface Slate** | `#F8FAFC` | `slate-50` / `--color-bg-surface` | Light mode card backgrounds and sidebar canvas |
| **Control Gold** | `#F59E0B` | `amber-500` | Cluster Admin Console (:2087) "CONTROL" badge |

---

## 4. Typography & Wordmark

### Font Family
AffinMail uses a clean, modern **Geometric Neo-Grotesque Sans-Serif** typography hierarchy:
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

### Wordmark Construction
* **"Affin"**: Rendered in `font-bold tracking-tight text-slate-800 dark:text-slate-100`. Represents sovereign infrastructure and the Hostaffin cloud ecosystem.
* **"Mail"**: Rendered in `font-bold tracking-tight text-blue-600 dark:text-blue-400`. Highlights the core communication utility.

```
+-----------------------------------------------------------+
|  [Icon]  AffinMail  [ ENTERPRISE ]                        |
|          Optimized Workspace of Efficient Business        |
+-----------------------------------------------------------+
```

### Contextual Tier Badges
* **User Webmail (Port 2083 / 443):** Displays the `ENTERPRISE` badge (`bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-600/15`).
* **Admin Control Console (Port 2087):** Displays the `CONTROL` badge (`bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20`).

---

## 5. Size Presets & Component Usage

The official React component is located at [`webmail/src/components/AffinMailLogo.tsx`](file:///d:/AffinMail/webmail/src/components/AffinMailLogo.tsx).

| Size | Icon (px) | Wordmark | Recommended Context |
| :--- | :--- | :--- | :--- |
| **`xs`** | `20px` | `text-base` | Mobile menus, modal headers, dense table rows |
| **`sm`** | `26px` | `text-lg` | Admin top navbar, compact sidebars |
| **`md`** | `34px` | `text-xl` | Main Webmail HeaderBar (default) |
| **`lg`** | `42px` | `text-2xl` | Sign-in portal card, splash overlays |
| **`xl`** | `54px` | `text-3xl` | Hero display, marketing landing screens |

### Code Usage Example
```tsx
import { AffinMailLogo } from './components/AffinMailLogo';

// Standard Webmail Header
<AffinMailLogo variant="full" size="md" />

// Cluster Admin with Tagline
<AffinMailLogo 
  variant="admin" 
  size="sm" 
  tagline="Optimized Workspace of Efficient Business." 
  withGlow 
/>

// App Icon Only (Dock / PWA)
<AffinMailLogo variant="icon" size="lg" />
```

---

## 6. Favicon & Web Manifest Specifications

The master web icon is stored at [`webmail/public/favicon.svg`](file:///d:/AffinMail/webmail/public/favicon.svg).
- **Format:** Pure scalable SVG with embedded linear gradients and drop-shadows.
- **Background:** High-contrast Enterprise Slate squircle (`rx="16"`, `#0F172A`) ensuring maximum legibility across both dark and light browser chrome.
- **Micro-Scale Legibility:** Tested down to 16x16, 24x24, and 32x32 pixel browser tabs.

---

## 7. Terminal CLI & Installer Branding

For system administrators operating in bare-metal Linux terminal environments, AffinMail uses an ANSI 256-color ASCII banner in [`install.sh`](file:///d:/AffinMail/install.sh) and [`scripts/affinmail.sh`](file:///d:/AffinMail/scripts/affinmail.sh):

```
    ___    ____ ____ _       __  ___      _ __
   /   |  / __// __/(_)___  /  |/  /___ _(_) /
  / /| | / /_ / /_ / / __ \/ /|_/ / __ `/ / / 
 / ___ |/ __// __// / / / / /  / / /_/ / / /  
/_/  |_/_/  /_/  /_/_/ /_/_/  /_/\__,_/_/_/   
   AffinMail — Optimized Workspace of Efficient Business
```

---

## 8. Brand Integrity & Rules

* **DO** use the official SVG gradients for digital interfaces.
* **DO** maintain the proportional aspect ratio of the Sovereign Wing icon at all times.
* **DO NOT** apply third-party drop shadows, 3D extrusions, or decorative gradients outside the official color system.
* **DO NOT** change the spelling or capitalization (always `AffinMail`, never `Affinmail` or `affin mail`).
* **DO NOT** introduce neon, synthwave, or pastel themes that violate the Anti-Bloat Enterprise Standard.
