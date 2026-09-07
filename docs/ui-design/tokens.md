# HRFlow Design Tokens & UI System

**Status:** Canonical Reference  
**Version:** 1.0  
**Scope:** Design tokens, CSS custom properties, and UI component standards across HRFlow.

---

## 1. Color Palette

HRFlow uses an HSL/Hex curated palette centered on a high-trust healthcare tech royal blue (`--accent`), supported by semantic state colors and neutral elevation surfaces.

### Brand & Accents
| Token | Light Mode Value | Dark Mode Value | Usage |
|---|---|---|---|
| `--accent` | `#2056e8` | `#3e72f8` | Primary actions, brand icons, active tabs, links |
| `--accent2` | `#4f7af8` | `#5d86f9` | Gradient companion, secondary highlights |
| `--accent-soft` | `#e8eeff` | `rgba(32, 86, 232, 0.18)` | Soft badge backgrounds, icon pill containers |

### Semantic State Colors
| Token | Light Mode Value | Dark Mode Value | Usage |
|---|---|---|---|
| `--success` | `#0ea966` | `#1fc27a` | Approvals, active status, healthy balances |
| `--success-soft` | `rgba(14, 169, 102, 0.12)` | `rgba(31, 194, 122, 0.18)` | Success pills, positive trends |
| `--warning` | `#e07d10` | `#f09228` | Pending status, near-limit balance warning |
| `--warning-soft` | `rgba(224, 125, 16, 0.12)` | `rgba(240, 146, 40, 0.18)` | Warning pills, alerts |
| `--danger` | `#d63b3b` | `#e25353` | Rejections, terminated status, delete actions |
| `--danger-soft` | `rgba(214, 59, 59, 0.12)` | `rgba(226, 83, 83, 0.18)` | Danger pills, error messages |
| `--info` | `#4f7af8` | `#5d86f9` | Information chips, notice banners |
| `--info-soft` | `rgba(79, 122, 248, 0.12)` | `rgba(93, 134, 249, 0.18)` | Info pills, neutral highlights |

### Surfaces, Backgrounds & Borders
| Token | Light Mode Value | Dark Mode Value | Usage |
|---|---|---|---|
| `--bg` | `#f7f8fb` | `#0f1117` | Canvas / page background |
| `--surface` | `#ffffff` | `#171a24` | Primary cards, modals, dropdowns |
| `--surface2` | `#fafbfd` | `#1d2130` | Sub-cards, table headers, form sections |
| `--border` | `rgba(30, 60, 140, .08)` | `#2a2e3d` | Standard borders, dividers |
| `--border2` | `rgba(30, 60, 140, .15)` | `rgba(255, 255, 255, 0.14)` | Hover borders, emphasized dividers |

### Text & Neutral Hierarchy
| Token | Light Mode Value | Dark Mode Value | Usage |
|---|---|---|---|
| `--text` | `#141e30` | `#f1f2f6` | Primary headings, titles, strong body text |
| `--text2` | `#7a8ea8` | `#9aa0b4` | Secondary labels, descriptions, subheadings |
| `--text3` | `#c2cedc` | `#6b7280` | Placeholder text, disabled labels, micro-dividers |

---

## 2. Typography

HRFlow pairs **Sora** for modern geometric headers with **Inter** for high-legibility UI text and numbers.

### Font Families
- `--font-head`: `'Sora', sans-serif` — Page titles, card headings, KPI numbers, modal titles.
- `--font-body`: `'Inter', sans-serif` — Body text, tables, form inputs, buttons, navigation items.

### Font Size Scale
| Token | Value | Rem Equivalent | Target Elements |
|---|---|---|---|
| `--font-size-2xs` | `10px` | `0.625rem` | Micro tags, uppercase column counters |
| `--font-size-xs` | `11.5px`| `0.72rem`  | Badges, section labels, timestamps |
| `--font-size-sm` | `13px`  | `0.8125rem`| Table cells, input labels, secondary text |
| `--font-size-base`| `14px`  | `0.875rem` | Standard body text, form inputs, button text |
| `--font-size-md`  | `15px`  | `0.9375rem`| Modal subtitles, card subheaders |
| `--font-size-lg`  | `17px`  | `1.0625rem`| Card section titles, modal headers |
| `--font-size-xl`  | `20px`  | `1.25rem`  | Page section headings, large modal titles |
| `--font-size-2xl` | `24px`  | `1.5rem`   | Major headers |
| `--font-size-3xl` | `28px`  | `1.75rem`  | Stat / KPI big numbers (`font-variant-numeric: tabular-nums`) |

---

## 3. Spacing Scale

Based on a strict 4px grid:
| Token | Value | Target Usage |
|---|---|---|
| `--space-1` | `4px`  | Micro gaps, badge inner padding, icon offsets |
| `--space-2` | `8px`  | Button gaps, compact list spacing |
| `--space-3` | `12px` | Input internal padding, card item gaps |
| `--space-4` | `16px` | Standard component padding, toolbar gaps |
| `--space-5` | `20px` | Card internal padding, modal section spacing |
| `--space-6` | `24px` | Large card padding, modal outer padding |
| `--space-8` | `32px` | Section margins, dashboard row separation |

---

## 4. Radii & Elevations

### Radii
| Token | Value | Target Elements |
|---|---|---|
| `--radius-xs` | `6px`   | Pill sort buttons, micro tags |
| `--radius-sm` | `10px`  | Action buttons, text inputs, dropdowns |
| `--radius-md` | `14px`  | Sub-cards, icon pill containers |
| `--radius-lg` | `18px`  | Standard content cards, table containers |
| `--radius-xl` | `22px`  | Modals, login card, major dashboard panels |
| `--radius-full` | `9999px`| User avatars, status badges, toggle switches |

### Shadows
| Token | Light Mode | Dark Mode |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(20, 50, 120, .05)` | `0 1px 3px rgba(0, 0, 0, .3)` |
| `--shadow`    | `0 2px 12px rgba(20, 50, 120, .07)` | `0 2px 12px rgba(0, 0, 0, .35)` |
| `--shadow-lg` | `0 20px 60px rgba(20, 50, 120, .13)`| `0 10px 40px rgba(0, 0, 0, .5)` |

---

## 5. UI Component Standards

### 1. Stat Cards
- Must use `.stat-card` containing `.stat-top` with `.stat-icon` (using `--accent-soft` or semantic soft tints) and `.stat-label`.
- Numbers must render with `.stat-val` (`font-family: var(--font-head)`, tabular numbers).
- Optional trend or subtext tag with `.stat-trend`.

### 2. Status Badges & Pills
- Use `.badge-pill` with semantic classes: `.pill-success`, `.pill-warning`, `.pill-danger`, `.pill-info`.
- Always pair with an icon (e.g. `<i class="fa-solid fa-check"></i> Approved`).

### 3. Modals & Sectioned Forms (`.modal-v2`)
- Group fields under `.form-section` with `.form-section-label` (uppercase icon + label + line).
- Inputs use clean white/neutral background with `1px solid var(--border)` and focus accent border.
- Submit buttons use `setButtonLoading` utility during API roundtrips.

### 4. Tables
- Always enclosed within `.card`.
- Headers `<th>` use uppercase muted typography (`var(--text2)`), with `.th-sortable` where sorting is enabled.
- Empty states use `.empty-state` with a centered icon and descriptive copy.
