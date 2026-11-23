# AffinMail: UI/UX & Design System Specification

---

## 1. Design Principles & Anti-Bloat Policy

AffinMail's interface is built on the philosophy of **"Gmail-grade simplicity with zero aesthetic pollution."**
* **Strict Two-Theme System:** Only two themes exist: **Enterprise Light** and **Enterprise Dark**. Novelty themes (synthwave, cyberpunk, cupcake) are banned to preserve a clean, professional aesthetic.
* **Instant Keyboard Navigation:** Every core action can be executed without touching a mouse.
* **Dockable Multitasking Compose:** The compose modal stays accessible and dockable at the bottom right, allowing users to browse their inbox while drafting replies.
* **Plan-Driven Attachment Guard:** Immediate client-side validation prevents failed uploads and wasted bandwidth.

---

## 2. Design Tokens & Palette Specifications

| Token Name | Light Mode Value | Dark Mode Value | Usage / Semantic Role |
| :--- | :--- | :--- | :--- |
| `--color-bg-base` | `#FFFFFF` | `#0B0F19` | Main application background and sidebar canvas |
| `--color-bg-surface` | `#F8FAFC` (Slate 50) | `#111827` (Gray 900) | Email thread cards, compose window, and modals |
| `--color-bg-hover` | `#F1F5F9` (Slate 100) | `#1F2937` (Gray 800) | Row hover state in email list |
| `--color-border` | `#E2E8F0` (Slate 200) | `#1F2937` (Gray 800) | Card boundaries, dividers, and table borders |
| `--color-text-primary` | `#0F172A` (Slate 900) | `#F9FAFB` (Gray 50) | Message body text, headers, and active thread subject |
| `--color-text-secondary`| `#475569` (Slate 600) | `#9CA3AF` (Gray 400) | Snippet previews, timestamps, and secondary labels |
| `--color-text-muted` | `#94A3B8` (Slate 400) | `#6B7280` (Gray 500) | Inactive folder icons, placeholders, and hotkeys |
| `--color-primary` | `#2563EB` (Blue 600) | `#3B82F6` (Blue 500) | Compose button, Send button, active navigation item |
| `--color-primary-hover`| `#1D4ED8` (Blue 700) | `#2563EB` (Blue 600) | Primary button hover state |
| `--color-accent` | `#0D9488` (Teal 600) | `#14B8A6` (Teal 500) | Verified security badge, SPF/DKIM pass badge |
| `--color-danger` | `#DC2626` (Red 600) | `#EF4444` (Red 500) | Delete action, Spam button, size limit error toast |
| `--color-star` | `#F59E0B` (Amber 500) | `#FBBF24` (Amber 400) | Starred email indicator |

---

## 3. Tailwind CSS & DaisyUI Configuration

```javascript
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        light: {
          "primary": "#2563EB",
          "primary-content": "#FFFFFF",
          "secondary": "#475569",
          "accent": "#0D9488",
          "neutral": "#1E293B",
          "base-100": "#FFFFFF",
          "base-200": "#F8FAFC",
          "base-300": "#F1F5F9",
          "base-content": "#0F172A",
          "info": "#0284C7",
          "success": "#16A34A",
          "warning": "#D97706",
          "error": "#DC2626",
        },
        dark: {
          "primary": "#3B82F6",
          "primary-content": "#FFFFFF",
          "secondary": "#9CA3AF",
          "accent": "#14B8A6",
          "neutral": "#0F172A",
          "base-100": "#111827",
          "base-200": "#0B0F19",
          "base-300": "#1F2937",
          "base-content": "#F9FAFB",
          "info": "#38BDF8",
          "success": "#22C55E",
          "warning": "#F59E0B",
          "error": "#EF4444",
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
  },
};
```

---

## 4. Webmail Core Component Hierarchy

```
App.tsx
├── HeaderBar (Logo, Search Input, Theme Switcher, User Dropdown)
├── MainLayout (Grid: Sidebar + Main Content)
│   ├── NavigationSidebar
│   │   ├── PrimaryComposeButton (Triggers Docked Compose)
│   │   ├── MailboxFolderList (Inbox, Starred, Sent, Drafts, Archive, Spam, Trash)
│   │   ├── CustomLabelList (Tags with color badges)
│   │   └── QuotaIndicatorWidget (Progress bar: 3.2 GB / 10 GB + Attachment limit: 25MB)
│   ├── ActionToolbar (Select All, Archive, Spam, Delete, Mark Read, Move To, Pagination)
│   └── EmailThreadList / EmailThreadDetail
│       ├── ThreadRow (Star toggle, Checkbox, Sender, Badge, Subject, Snippet, Time)
│       └── ConversationView (Header, Security Badges, Message Stream, Quick Reply)
└── DockedComposeManager
    └── ComposeModal (Minimized / Maximized / Normal state)
        ├── Header (Subject, Minimize, Expand, Close)
        ├── RecipientInputs (To, Cc, Bcc pills)
        ├── TipTapRichTextEditor (WYSIWYG Toolbar: Bold, Italic, Link, Lists, Code)
        ├── AttachmentDropzone & List (Plan validation, progress bar, remove)
        └── BottomActionBar (Send button, Discard, Attachment button)
```

---

## 5. Docked Compose & Plan-Driven Attachment Guard

### 5.1 Client-Side Byte Inspection Flow
```typescript
interface PlanAttachmentRule {
  maxAttachmentSizeMb: number; // e.g. 25 MB
}

export function validateAttachment(file: File, planLimitMb: number): { valid: boolean; error?: string } {
  const maxBytes = planLimitMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds your plan limit of ${planLimitMb} MB.`
    };
  }
  return { valid: true };
}
```

### 5.2 TipTap WYSIWYG Integration
* TipTap provides clean HTML output while sanitizing unsafe tags.
* Native drag-and-drop support: Dropping images directly inside editor embeds inline previews with instant base64/blob conversion.

---

## 6. Keyboard Shortcut Engine Specification

Global keyboard listener hook (`useKeyboardShortcuts`):
* `c`: Opens new docked Compose window.
* `j` / `k`: Moves active cursor down / up through thread list.
* `o` or `Enter`: Expands and opens selected thread.
* `e`: Archives email (removes `inbox` label via optimistic update).
* `#`: Deletes active thread (moves to Trash).
* `s`: Toggles Star status.
* `r`: Quick reply inside active thread.
* `a`: Reply all.
* `/`: Focuses global search input.
* `Escape`: Closes compose modal or search focus.
