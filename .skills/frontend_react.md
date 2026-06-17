---
name: frontend_react
description: >
  Architectural rules for React UI development within the Ultrakey Invoice SaaS platform.
  Covers Vite configuration, CSS design token patterns, React Context state management,
  component conventions, and animation guidelines. Load this skill when building or
  modifying any frontend component.
triggers:
  - "create component"
  - "update UI"
  - "add page"
  - "fix styling"
  - "react context"
---

# Frontend React Architecture Skill

## Stack
- **Framework**: React 18 (functional components, hooks only)
- **Build Tool**: Vite 5 (ESM, HMR)
- **Styling**: Vanilla CSS with HSL-based design tokens (NO Tailwind unless explicitly requested)
- **Icons**: lucide-react
- **HTTP**: Native `fetch` via `src/api.js` client (localStorage mock fallback for offline dev)

---

## Design System Tokens (from `src/index.css` `:root`)

```css
--bg-primary: hsl(230, 16%, 7%);
--bg-secondary: hsl(230, 16%, 10%);
--bg-card: rgba(22, 25, 37, 0.7);
--border-color: rgba(255, 255, 255, 0.08);
--text-primary: hsl(210, 40%, 98%);
--text-secondary: hsl(215, 20%, 75%);
--text-muted: hsl(215, 12%, 55%);
--accent-primary: hsl(217, 91%, 60%);   /* Electric Blue */
--accent-secondary: hsl(262, 83%, 58%); /* Violet */
--accent-success: hsl(142, 72%, 45%);   /* Emerald */
--accent-warning: hsl(37, 90%, 50%);    /* Amber */
--accent-danger: hsl(350, 89%, 60%);    /* Ruby */
--font-display: 'Outfit', sans-serif;
--font-body: 'Inter', sans-serif;
```

**Rule**: Always use CSS variables — never hardcode hex/RGB color values in components.

---

## Global Settings Context Pattern

The app uses a `SettingsContext` at `src/context/SettingsContext.jsx`.

```jsx
// Consuming settings in any component:
import { useSettings } from '../context/SettingsContext';

const MyComponent = () => {
  const { settings, loading, refreshSettings } = useSettings();
  const currencySymbol = settings?.tax_config?.currencySymbol || '₹';
  // ...
};
```

**Rule**: NEVER call `api.getSettings()` directly inside a component. Always use the context.

---

## Component Conventions

### File Structure
```
src/
  components/
    ComponentName.jsx   ← named export + default export
  context/
    SettingsContext.jsx
  utils/
    sanitize.js
  api.js
  App.jsx
  main.jsx
  index.css
```

### Standard Component Template
```jsx
import React, { useState, useEffect } from 'react';
import { IconName } from 'lucide-react';
import api from '../api';
import { useSettings } from '../context/SettingsContext';

export const ComponentName = ({ prop1, prop2 }) => {
  const { settings } = useSettings();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const res = await api.getSomething();
      setData(res.data || []);
    } catch (err) {
      console.error('Load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>;

  return (
    <div className="fade-in">
      {/* content */}
    </div>
  );
};

export default ComponentName;
```

---

## CSS Class Utilities (defined in `index.css`)

| Class | Purpose |
|---|---|
| `.glass-card` | Glassmorphism card panel with backdrop blur |
| `.btn.btn-primary` | Electric blue CTA button with glow |
| `.btn.btn-secondary` | Ghost button with border |
| `.btn.btn-danger` | Ruby red destructive action |
| `.form-input` | Text input with focus glow |
| `.form-select` | Dropdown select |
| `.form-textarea` | Resizable textarea |
| `.form-label` | Section label above inputs |
| `.form-group` | Input wrapper with bottom margin |
| `.data-table` | Full-width table with hover rows |
| `.badge.badge-{status}` | Status pill (draft, published, paid, accepted, overdue, sent, voided) |
| `.fade-in` | Entrance animation (opacity 0→1, translateY 10→0) |
| `.dashboard-grid` | Auto-fill responsive grid for metric cards |
| `.metric-card` | Flex row metric display card |
| `.settings-tabs-header` | Horizontal tab navigation bar |
| `.settings-tab-btn` | Individual tab button (`.active` state = blue bg) |
| `.parsed-grid` | Grid for pre-defined line item cards |
| `.info-alert` | Alert/notification box |

---

## Modal Pattern

All modal overlays use this structure:
```jsx
{showModal && (
  <div style={{
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000
  }}>
    <div className="glass-card" style={{ width: '480px', maxHeight: '90vh', overflowY: 'auto' }}>
      {/* modal content */}
    </div>
  </div>
)}
```

---

## PDF Print Pattern

To enable browser print-to-PDF on document previews:
1. The document preview div gets `id="print-area"`.
2. Use `window.print()` on button click.
3. CSS `@media print` in `index.css` hides sidebar, buttons, and sets white background.

```jsx
<button className="btn btn-secondary" onClick={() => window.print()}>
  <Printer size={16} /> Download PDF
</button>
```

---

## Animation Guidelines

- **Page entrance**: `.fade-in` class (keyframe: opacity 0→1, translateY 10px→0, 300ms)
- **Button hover**: `transform: translateY(-2px)` (all `.btn` already have this)
- **Card hover**: `border-color` transition (all `.glass-card` already have this)
- **Loading state**: Render `<p style={{ color: 'var(--text-secondary)' }}>Loading...</p>` — no spinners needed for MVP
- **Success feedback**: Inline `.info-alert` with green border colors, auto-dismiss after 4 seconds

---

## Sidebar Navigation Items (in order)
1. Dashboard (`dashboard`) — LayoutDashboard icon
2. Clients (`clients`) — Users icon
3. Documents (`documents`) — FileText icon
4. Vendors (`vendors`) — Store icon
5. Settings (`settings`) — Settings icon
6. Client Portal (`portal`) — Globe icon
