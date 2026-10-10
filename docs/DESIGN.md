# MASTER DESIGN SYSTEM — "SOFT CLAY & CALM BENTO" (POP STICKER EDITION)

> **MASTER UI/UX DESIGN SYSTEM SPECIFICATION**  
> **Source Project Reverse-Engineered:** Trizpyy / hackpill  
> **Target Audience:** Frontend Engineers, UI/UX Designers, and Autonomous AI Coding Agents  
> **Purpose:** Reusable Design Blueprint for AI SaaS, Hackathons, Dashboards, Mobile Web, and Enterprise Portals  
> **Core Principle:** Transfer the **VISUAL LANGUAGE, COMPONENT DESIGN, AND POLISH** — never the business logic.

---

## 1. Design Philosophy

The design system blends three distinct visual traditions into a coherent, tactile, and delightful product experience:

1. **"Soft Clay" (Consumer / End-User Persona)**:
   - Tactile, friendly, welcoming, and physical.
   - Dual-layer claymorphism: deep diffuse outer drop-shadows combined with subtle white inner highlights (`inset 0 6px 12px rgba(255,255,255,0.9)`) and darker bottom deboss (`inset 0 -6px 12px rgba(40,22,96,0.07)`).
   - Generous organic curves (`rounded-[24px]` to `rounded-full`) that evoke physical game pieces, clay stamps, or premium stationery.

2. **"Calm Bento" (Operator / Professional Dashboard Persona)**:
   - Dense, high-legibility, structured modularity.
   - 1px crisp borders (`#e3e7ef`), soft drop-shadows (`0 1px 2px rgba(28,27,43,0.05), 0 8px 24px -14px rgba(28,27,43,0.16)`), and structured column grids.
   - Cool slate backgrounds (`#eef1f6`) ensuring operator focus during data-dense or high-stress operational tasks.

3. **"Ink Stickers & Pop Shadows" (Comic Reference & Micro-Interactions)**:
   - High-contrast 2px solid `#1c1b2b` ink borders.
   - Hard, unblurred offset pop shadows (`3px 3px 0 #1c1b2b` or `5px 5px 0 #1c1b2b`).
   - Playful tilted sticker kickers (`-rotate-1` to `-rotate-2`), comic burst stickers (`ZAP!`, `NEW!`, `YOU!`), and physical button press mechanics (`active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`).

---

## 2. Visual Identity

| Trait | Specification (Verified from Source) |
| :--- | :--- |
| **Aesthetic Mood** | Premium Tactile Playful · Editorial Modern · Comic-Sticker Polish |
| **Key Metaphor** | Physical stationery, tactile clay badges, and comic stickers on linen paper |
| **Border Philosophy** | Dual-mode: Soft clay/bento borders (1px `#e8e2d6` / `#e3e7ef`) OR high-impact sticker borders (2px solid `#1c1b2b`) |
| **Corner Curvature** | Hyper-rounded capsule buttons (`rounded-full`), squircle tiles (`rounded-[30%]`), and cards (`rounded-2xl` to `rounded-[44px]`) |
| **Depth Strategy** | Layered canvas (`bg-dots`), elevated clay cards, floating pill navigation bars, and hard pop drop-shadows |

---

## 3. Color System

### 3.1 Base Surfaces & Ink Neutral Hierarchy

All colors extracted directly from [frontend/app/globals.css](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/app/globals.css):

```css
/* Base Canvas & Ink */
--color-canvas: #f5f1e8;       /* Warm linen paper / clay background */
--color-canvas-cool: #eef1f6;  /* Cool slate canvas for operator dashboards */
--color-ink: #1c1b2b;          /* Primary dark ink black/navy for text & borders */
--color-ink-soft: #3a3850;     /* Secondary dark neutral for body paragraphs */
--color-muted: #625f78;        /* Slate muted for subtitles, metadata & captions */
--color-faint: #9794ab;        /* Placeholder text, disabled glyphs */
--color-line: #e8e2d6;         /* Warm border line for cards and dividers */
--color-line-cool: #e3e7ef;    /* Cool border line for bento cards and tables */
--color-pill: #1c1b22;         /* Dark badge pill background */
```

### 3.2 Chromatic 7-Tone Palette (Triad Tone System)

Every chromatic color in the system follows a 3-tier hierarchy: **Solid / Soft Background / Deep Text**.

| Tone Key | Solid (`bg-[tone]`) | Soft Surface (`bg-[tone]-soft`) | Deep Text / Accent (`text-[tone]-deep`) | Semantic Intent |
| :--- | :--- | :--- | :--- | :--- |
| **Purple** *(Primary)* | `#7b5cf0` | `#ece5fe` (`lavender-soft`) | `#5a3dd4` | Primary actions, brand identity, AI agent status |
| **Lavender** | `#c6b5f6` | `#ece5fe` | `#5a3dd4` | Assistant highlights, secondary tags, creative steps |
| **Sun** | `#fad47f` | `#fef3d6` | `#a86f00` | Highlighters, active map pins, floating AI button, warning |
| **Coral** | `#f08a6c` | `#fde3d9` | `#c4502f` | Urgent badges, hot alerts, high-energy accents |
| **Mint** | `#d0e8ba` | `#e8f4dc` | `#3f8a2e` | Success confirmations, green live beacons, budget safety |
| **Sky** | `#c4def8` | `#e3effc` | `#2f6fbf` | Informational cards, analytics lines, weather pill |
| **Pink** | `#f9cbc9` | `#fde4e2` | `#c9544f` | Critical friction, error notifications, user delight |
| **Cream** | `#fdeedc` | `#fdeedc` | `#a86f00` | Warm secondary fill, prompt pill rows |
| **Star** | `#ffc23d` | `#fef3d6` | `#a86f00` | Review stars, gold badges |

### 3.3 Semantic Feedback Colors

| State | Solid Hex | Soft Background | Border / Text |
| :--- | :--- | :--- | :--- |
| **Success** | `#23864b` | `#dcf2e4` | Text `#23864b` / Dot `#23864b` |
| **Warning** | `#a4660a` | `#fff0d4` | Text `#a4660a` / Dot `#a4660a` |
| **Danger / Error** | `#c93535` | `#fde2e2` | Text `#c93535` / Dot `#c93535` |
| **Info** | `#2f6fbf` | `#e3effc` | Text `#2f6fbf` / Dot `#2f6fbf` |

### 3.4 Color Harmony & Usage Rules

1. **The 60-30-10 Rule**:
   - **60%**: Background Canvas (`#f5f1e8` or `#eef1f6`).
   - **30%**: Crisp white card surfaces (`#ffffff`) with `#1c1b2b` typography and 1px `#e8e2d6` borders.
   - **10%**: Controlled chromatic accents (`#7b5cf0`, `#fad47f`, `#f08a6c`, `#d0e8ba`).
2. **Never Stack More Than Two Chromatic Tones on a Single Card**:
   - Pair one soft background (e.g. `bg-lavender-soft`) with its corresponding deep text (`text-purple-deep`) or a single contrast badge (e.g. `bg-sun text-ink`).
3. **No Pure Grays**:
   - Neutral grays are tinted with ink undertones (`#3a3850`, `#625f78`). Avoid cold digital grays like `#666666` or `#cccccc`.

---

## 4. Typography System

### 4.1 Fonts

Extracted from [frontend/app/layout.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/app/layout.tsx):
- **Display Font**: `Unbounded` (weights: `500`, `600`, `700`, `800`, display: `swap`)
  - Applied to all headings `h1, h2, h3, h4`, key statistics, brand logo, and burst badges.
  - Tracking: `letter-spacing: -0.02em`.
- **Body & Sans Font**: `Poppins` (weights: `400`, `500`, `600`, `700`, display: `swap`)
  - Applied to standard copy, form labels, inputs, table cells, and buttons.
- **Monospace Font**: System `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas`
  - Applied to reference codes, IDs (e.g. `TRZ-2071`), CLI snippets, and timestamp digits.

### 4.2 Typography Scale & Hierarchy

| Element | Font Family | Size | Weight | Line Height | Letter Spacing | Source Example |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero H1** | Unbounded | `2.6rem` (mobile) → `4.1rem` (desktop) | 800 (`extrabold`) | `1.02` | `-0.03em` | `Landing hero title` |
| **Section H2** | Unbounded | `1.875rem` (30px) → `2.5rem` (40px) | 800 (`extrabold`) | `1.1` | `-0.02em` | `SectionHead title` |
| **Card H3** | Unbounded / Sans | `1.25rem` (20px) → `1.5rem` (24px) | 700 (`bold`) | `1.2` | `-0.01em` | `Feature & Panel titles` |
| **Item H4** | Sans | `0.9375rem` (15px) → `1rem` (16px) | 700 (`bold`) | `1.3` | `normal` | `Activity / Item title` |
| **Kicker / Pill** | Sans | `0.75rem` (12px) | 700 (`bold`) | `1.0` | `+0.14em` uppercase | `Kicker tag / section label` |
| **Body Large** | Sans | `1.0625rem` (17px) → `1.125rem` (18px) | 400 (`regular`) / 500 | `1.6` | `normal` | `Lead paragraph` |
| **Body Regular** | Sans | `0.875rem` (14px) → `0.9375rem` (15px) | 500 (`medium`) | `1.5` | `normal` | `Card text, chat notes` |
| **Caption / Sub** | Sans | `0.75rem` (12px) | 500 / 600 | `1.4` | `normal` | `Metadata, hints, dates` |
| **Micro Badge** | Sans | `0.6875rem` (11px) / `0.625rem` (10px) | 700 (`bold`) | `1.0` | `+0.05em` | `Status dot, counter pill` |
| **Tabular Stat** | Unbounded | `1.5rem` (24px) → `2rem` (32px) | 800 (`extrabold`) | `1.0` | `-0.02em` | `StatCard value, live price` |

### 4.3 Highlighter & Text Balance Effects

1. **Highlighter Stroke Effect**:
   ```tsx
   <span className="relative inline-block">
     <span className="relative z-10">We handle</span>
     <span className="absolute inset-x-0 bottom-1 z-0 h-4 -rotate-1 rounded-full bg-sun sm:h-5" aria-hidden />
   </span>
   ```
2. **Text Balance Wrap**:
   - Apply `text-balance` (`text-wrap: balance`) to all H1 and H2 headings to prevent typographic orphans.
3. **Tabular Numerics**:
   - Always append `tabular` (`font-variant-numeric: tabular-nums`) to numeric prices, times, ratings, and countdowns to prevent jitter during live updates.

---

## 5. Spacing System

Derived from the Tailwind 4 visual rhythm:

```yaml
spacing:
  2xs: "0.25rem"   # 4px   - Badge padding, micro gap
  xs:  "0.5rem"    # 8px   - Chip gap, compact item gap
  sm:  "0.75rem"   # 12px  - Input padding, card internal gap
  md:  "1rem"      # 16px  - Standard card padding, list gap
  lg:  "1.25rem"   # 20px  - Panel padding, container gutter
  xl:  "1.5rem"    # 24px  - Section title gap, dialog padding
  2xl: "2rem"      # 32px  - Large card padding (sm:p-8)
  3xl: "3.5rem"    # 56px  - Intermediate section spacing
  4xl: "5rem"      # 80px  - Major section padding (py-20)
  5xl: "6rem"      # 96px  - Landing hero padding (py-24)
```

- **Mobile Page Margin**: `px-4` (16px).
- **Tablet Page Margin**: `px-6` (24px).
- **Desktop Max Container**: `max-w-6xl` (traveler / consumer) or `max-w-7xl` (operator console).

---

## 6. Layout System & Surfaces

### 6.1 Background Dot Patterns & Speed Lines

The application never sits on plain white or flat gray. It uses patterned canvas utilities:

1. **Warm Canvas Dots (`bg-dots`)**:
   ```css
   @utility bg-dots {
     background-color: var(--color-canvas);
     background-image: radial-gradient(rgb(28 27 43 / 0.09) 1.1px, transparent 1.2px);
     background-size: 22px 22px;
   }
   ```
2. **Cool Slate Dots (`bg-dots-cool`)**:
   ```css
   @utility bg-dots-cool {
     background-color: var(--color-canvas-cool);
     background-image: radial-gradient(rgb(28 27 43 / 0.05) 1px, transparent 1.1px);
     background-size: 24px 24px;
   }
   ```
3. **Comic Speed Lines (`bg-speed`)**:
   ```css
   @utility bg-speed {
     background-image: repeating-linear-gradient(0deg, rgb(0 0 0 / 0.035) 0 2px, transparent 2px 7px);
   }
   ```

### 6.2 Three Master Layout Shells

1. **Public / Consumer Layout Shell**:
   - Top sticky header (`h-16 max-w-6xl px-4 sm:px-6 bg-canvas/85 backdrop-blur-md`).
   - Centered content container (`max-w-6xl mx-auto`).
   - Floating pill navigation bar in header on desktop; floating bottom pill navigation on mobile (`fixed inset-x-3 bottom-3 md:hidden`).
   - Floating interactive assistant button at `bottom-6 right-6`.

2. **Operator / Enterprise Dashboard Layout Shell**:
   - Expanded container: `max-w-7xl mx-auto px-4 sm:px-6`.
   - Top pill bar with live pulsing status dots (`animate-pulse bg-purple`) and numerical badges (`bg-coral text-white`).
   - Sub-tab secondary navigation bar rendered directly below the main header when a section has child views.
   - Dual-persona switch menu in the profile dropdown ("Switch account / Open consumer app").

3. **Split Authentication Layout Shell**:
   - Grid layout: `grid min-h-dvh lg:grid-cols-[1fr_1.05fr]`.
   - Left side (Desktop): Colored billboard (`bg-lavender border-r-2 border-ink`) with logo, rotated sticker showcase cards (`-rotate-2` and `rotate-5`), and animated mascot.
   - Right side: Clean, centered single-column form container (`max-w-md mx-auto py-8`).

---

## 7. Navigation System

### 7.1 Desktop Floating Pill Header

```tsx
<header className="sticky top-0 z-40 border-b border-ink/5 bg-canvas/85 backdrop-blur-md">
  <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
    <Logo href="/" />
    {/* Floating Pill Menu */}
    <nav className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-clay-sm md:flex">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "relative inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
            active ? "text-white" : "text-ink-soft hover:text-ink"
          )}
        >
          {active && (
            <motion.span
              layoutId="nav-pill"
              className="absolute inset-0 rounded-full bg-pill"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          <Icon size={18} weight={active ? "fill" : "regular"} className="relative" />
          <span className="relative">{item.label}</span>
        </Link>
      ))}
    </nav>
    <div className="flex items-center gap-2">
      {/* Notifications, Action CTAs, Avatar */}
    </div>
  </div>
</header>
```

### 7.2 Mobile Bottom Dock Navigation Bar

```tsx
<nav className="fixed inset-x-3 bottom-3 z-40 rounded-[28px] border-2 border-ink bg-white/95 px-2 py-1.5 shadow-pop backdrop-blur md:hidden">
  <ul className="flex items-center justify-around">
    {navItems.map((item) => (
      <li key={item.href}>
        <Link href={item.href} className="flex min-w-14 flex-col items-center gap-0.5 rounded-2xl px-2 py-1">
          <span className={cn(
            "grid h-9 w-12 place-items-center rounded-full transition-colors",
            active ? "bg-pill text-white" : "text-ink-soft"
          )}>
            <item.Icon size={20} weight={active ? "fill" : "regular"} />
          </span>
          <span className={cn("text-[10px] font-semibold", active ? "text-ink" : "text-muted")}>
            {item.label}
          </span>
        </Link>
      </li>
    ))}
  </ul>
</nav>
```

---

## 8. Button Design Language

Verified from [frontend/components/ui/Button.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/ui/Button.tsx):

All buttons share the base style:
```css
relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50
```

### 8.1 Button Variants & States

| Variant | Visual Classes | Hover Behavior | Active Press Behavior | Typical Usage |
| :--- | :--- | :--- | :--- | :--- |
| **`primary`** | `bg-pill text-white border-2 border-pill shadow-[3px_3px_0_#7b5cf0]` | `hover:shadow-[4px_4px_0_#7b5cf0] hover:-translate-y-0.5` | `active:translate-x-[2px] active:translate-y-[2px] active:shadow-none` | Main action, checkout, submit, book |
| **`purple`** | `bg-purple text-white border-2 border-ink shadow-pop` | `hover:-translate-y-0.5` | `active:translate-x-[2px] active:translate-y-[2px] active:shadow-none` | Hero CTAs, agent triggers |
| **`secondary`** | `bg-white text-ink shadow-clay-sm` | `hover:-translate-y-0.5` | `active:scale-[0.97]` | Clay secondary action, cancel, filter |
| **`outline`** | `bg-white text-ink border-2 border-ink shadow-pop` | `hover:-translate-y-0.5` | `active:translate-x-[2px] active:translate-y-[2px] active:shadow-none` | Comic sticker secondary, watch demo |
| **`soft`** | `bg-lavender-soft text-purple-deep` | `hover:bg-lavender/60` | `active:scale-[0.97]` | In-card lightweight action, tag action |
| **`danger`** | `bg-danger text-white` | `hover:brightness-110` | `active:scale-[0.97]` | Destructive actions, reset, clear |
| **`success`** | `bg-success text-white` | `hover:brightness-110` | `active:scale-[0.97]` | Confirm, approve change, paid |
| **`ghost`** | `bg-transparent text-ink` | `hover:bg-ink/5` | `active:scale-[0.97]` | Header text links, dismiss |

### 8.2 Button Sizes

| Size | Height | Padding | Font Size | Gap | Icon Size |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`sm`** | `h-9` (36px) | `px-3.5` (14px) | `text-[13px]` | `gap-1.5` | 16px |
| **`md`** | `h-11` (44px) | `px-5` (20px) | `text-sm` (14px) | `gap-2` | 18px |
| **`lg`** | `h-14` (56px) | `px-7` (28px) | `text-base` (16px) | `gap-2.5` | 20px |
| **`icon`** | `h-11 w-11` | `p-0` | N/A | Center | 20px |
| **`icon-sm`** | `h-9 w-9` | `p-0` | N/A | Center | 16px |

---

## 9. Card Design Language

Verified from [frontend/components/ui/Card.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/ui/Card.tsx):

### 9.1 Card Variants

| Variant | Tailwind Classes | Border Radius | Shadow / Border | Intent |
| :--- | :--- | :--- | :--- | :--- |
| **`clay`** | `bg-white shadow-clay rounded-[28px]` | 28px | Dual-layer clay shadow | Primary consumer cards, itinerary days |
| **`bento`** | `bg-white border border-line-cool shadow-soft rounded-2xl` | 16px | 1px cool border + subtle drop | Operator console panels, analytics rows |
| **`sticker`** | `bg-white border-2 border-ink shadow-pop-lg rounded-[24px]` | 24px | 2px ink + 5px pop shadow | High-importance callouts, modals, hero items |
| **`soft`** | `rounded-[24px] bg-[tone]-soft` | 24px | Borderless tinted surface | Colored feature groupings |
| **`flat`** | `bg-white rounded-2xl border border-line` | 16px | 1px warm border, no shadow | Nested sub-cards, secondary parameter lists |

### 9.2 Interactive Card Behavior

```css
interactive: transition-all duration-200 hover:-translate-y-1 hover:shadow-clay-lg cursor-pointer
```

---

## 10. Forms & Input Fields

Verified from [frontend/components/ui/primitives.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/ui/primitives.tsx):

### 10.1 Input & Textarea
- **Input Height**: `h-12` (48px) with `rounded-2xl`.
- **Background & Border**: `bg-white border-2 border-transparent shadow-clay-sm`.
- **Focus State**: `focus:border-purple outline-none`.
- **Invalid / Error State**: `aria-[invalid=true]:border-danger`.
- **Textarea**: `min-h-28 w-full resize-none rounded-2xl border-2 border-transparent bg-white px-4 py-3 shadow-clay-sm focus:border-purple`.

### 10.2 Custom Styled Select
- Height: `h-11`, `rounded-2xl`, `shadow-clay-sm`.
- Embedded Custom SVG Chevron Down:
  ```css
  bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 256 256%22><path fill=%22%231c1b2b%22 d=%22M213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32Z%22/></svg>')]
  bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-9
  ```

### 10.3 Selection Chip
- Size SM: `h-8 px-3 text-xs`. Size MD: `h-10 px-4 text-sm`.
- **Selected**: `cn(toneBg[tone], "text-ink ring-2 ring-ink shadow-pop")`. Includes Checkmark icon.
- **Unselected**: `bg-white text-ink-soft shadow-clay-sm hover:-translate-y-0.5`.
- **Active press**: `active:scale-95`.

### 10.4 Radix Switch & Slider
- **Switch Root**: `h-7 w-12 rounded-full`. Active: `bg-purple`, inactive: `bg-ink/15`.
- **Switch Thumb**: `h-5 w-5 bg-white shadow-md rounded-full translate-x-1 data-[state=checked]:translate-x-6`.
- **Slider Track**: `h-3 rounded-full bg-ink/10 shadow-inner`.
- **Slider Range**: `bg-gradient-to-r from-lavender to-purple`.
- **Slider Thumb**: `h-7 w-7 rounded-full border-2 border-ink bg-white shadow-pop hover:scale-110`.

---

## 11. Feedback, Overlays & Notifications

### 11.1 Toaster System

Verified from [frontend/components/shell/Toaster.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/shell/Toaster.tsx):
- **Position**: `fixed inset-x-3 top-3 z-[90] sm:inset-x-auto sm:right-4 sm:top-4`.
- **Toast Card**: `flex w-full max-w-sm items-start gap-3 rounded-[22px] border-2 border-ink bg-white p-3 pr-2 shadow-pop-lg`.
- **Left Icon Badge**: `grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-ink` with tone background (`bg-mint` for success, `bg-pink` for error, `bg-sky` for info, `bg-sun` for warning, `bg-lavender` for AI).
- **Motion**: Spring transition (`stiffness: 420, damping: 32`). Entrance: `initial={{ opacity: 0, y: -16, scale: 0.96 }}`. Exit: `exit={{ opacity: 0, x: 40, scale: 0.96 }}`.

### 11.2 Adaptive Modal / Sheet System

Verified from [frontend/components/ui/Sheet.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/ui/Sheet.tsx):
- **Backdrop Overlay**: `fixed inset-0 z-[60] bg-ink/40 backdrop-blur-[2px]`.
- **Phone (Mobile)**: Anchored bottom sheet (`inset-x-0 bottom-0 rounded-t-[32px] max-h-[92dvh]`), top drag pill handle (`mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-ink/15`).
- **Desktop (Screen >= 640px)**: Floating side drawer (`sm:top-3 sm:bottom-3 sm:right-3 sm:rounded-[32px] shadow-float`) OR centered modal (`sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2`).
- **Close Button**: `grid h-10 w-10 place-items-center rounded-full bg-white shadow-clay-sm transition hover:rotate-90`.

### 11.3 Empty, Error & Loading States

Verified from [frontend/components/ui/States.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/ui/States.tsx):
- **Empty State**: `rounded-[28px] bg-white/60 p-8 sm:p-14 text-center`, featuring an expressive character illustration, `font-display text-lg font-bold`, and primary CTA button.
- **Error State**: `role="alert" rounded-[28px] border-2 border-dashed border-danger/30 bg-danger-soft/40 px-6 py-10 text-center`, retry button with `ArrowClockwiseIcon`.
- **Skeleton Shimmer**:
  ```css
  @utility skeleton {
    background: linear-gradient(90deg, #ece7dd 0, #f7f3ec 40%, #ece7dd 80%);
    background-size: 800px 100%;
    animation: shimmer 1.6s linear infinite;
  }
  ```

---

## 12. Iconography & Art Tiles

### 12.1 Icon Libraries & Styles
- **Primary System Icons**: `@phosphor-icons/react`.
  - Icon weights: `duotone` for badges and cards; `bold` for buttons and interactive controls; `fill` for active states and ratings; `regular` for inactive navigation.
  - Standard sizes: `14px` (micro), `16px` (button), `18px` (nav), `20px` (badge/row), `24px` (feature header).
- **Secondary Tooling Icons**: `lucide-react` (used within specialized AI chat/dock widgets).

### 12.2 The 3D Clay "ArtTile" Component

Verified from [frontend/components/art/ArtTile.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/art/ArtTile.tsx):

```tsx
export function ArtTile({ icon, tone, size = 48 }) {
  const Icon = iconFor(icon);
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[30%] shadow-clay-sm",
        toneBg[tone]
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* Specular White Top Reflection creating the 3D clay look */}
      <span className="absolute inset-x-1 top-0.5 h-1/2 rounded-full bg-white/45 blur-[2px]" />
      
      {/* Duotone Glyph with debossed white drop-shadow */}
      <Icon
        size={size * 0.52}
        weight="duotone"
        color={toneDeepHex[tone]}
        className="relative drop-shadow-[0_2px_0_rgba(255,255,255,0.6)]"
      />
    </span>
  );
}
```

---

## 13. AI & Chatbot UI System

Verified from [frontend/components/travel-guru/components/TravelGuruFloatingWidget.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/travel-guru/components/TravelGuruFloatingWidget.tsx) & [TravelGuruChatbot.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/travel-guru/components/TravelGuruChatbot.tsx):

### 13.1 Floating Trigger Launcher
- Position: `fixed bottom-6 right-6 z-50`.
- Button: `w-14 h-14 rounded-full border-2 border-ink bg-sun text-ink shadow-pop hover:-translate-y-1 hover:shadow-pop-lg active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`.
- Rotating Icon: Compass / Sparkle icon with `group-hover:rotate-45 transition-transform duration-300`.
- Live Beacon: Green online indicator (`-top-1 -right-1 h-4 w-4 bg-emerald-500 border-2 border-ink animate-ping`).

### 13.2 Dual-Mode Architecture

1. **Mode A: Compact Docked Concierge (Pop-up)**:
   - Dimensions: `bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[480px] h-[640px] max-h-[calc(100vh-7.5rem)]`.
   - Card: `rounded-[32px] border-2 border-ink bg-canvas shadow-[8px_8px_0_#1c1b2b]`.
   - Segmented Tabs: 4-button pill row (`💬 Chat`, `📅 Plan`, `🧭 Guide`, `🆘 SOS`).

2. **Mode B: Expanded Studio Workspace (Full Power Overlay)**:
   - Dimensions: `fixed inset-0 z-50 p-3 sm:p-5 bg-ink/50 backdrop-blur-sm` containing `max-w-5xl h-[88vh] rounded-[32px] shadow-[10px_10px_0_#1c1b2b]`.
   - Split 2-Column Grid:
     - Left: Stream of chat messages, horizontal quick prompt chips, and voice input bar.
     - Right: Live Workspace Drawer (`w-80 md:w-92 border-l-2 border-ink bg-canvas-cool`) displaying structured artifacts, plans, and budget estimations.

### 13.3 Chat Bubble Styles
- **Assistant Bubble**: `bg-white text-ink border-2 border-ink rounded-[24px] rounded-tl-sm p-4 shadow-pop font-medium`.
- **User Bubble**: `bg-ink text-white border-2 border-ink rounded-[24px] rounded-tr-sm p-4 shadow-pop font-semibold`.
- **Quick Prompt Chips**: `bg-white border-2 border-ink px-3 py-1 rounded-full text-xs font-bold shadow-[2px_2px_0_#1c1b2b] hover:bg-sun hover:shadow-pop`.

---

## 14. Data Visualization & Tables

### 14.1 Recharts Styling Specs

Verified from [frontend/components/ops/Charts.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/components/ops/Charts.tsx):
- **Container**: `ResponsiveContainer width="100%" height={220}`.
- **Tooltip**: `{ borderRadius: 14, border: "1px solid #e3e7ef", boxShadow: "0 8px 24px -12px rgba(28,27,43,.25)", fontSize: 12 }`.
- **Cursor Fill**: `#f5f1e8` (linen paper hover highlight).
- **Grid Lines**: `stroke="#eef1f6" vertical={false}` (horizontal-only dividers).
- **Gradients**:
  - Primary `#rev`: `#7b5cf0` with opacity `0.35` down to `0`.
  - Secondary `#pay`: `#f08a6c` with opacity `0.3` down to `0`.
- **Bar Shape**: `radius={[8, 8, 0, 0]}` (rounded caps) with `maxBarSize={36}`.

### 14.2 High-Density Data Tables

Verified from [frontend/app/ops/bookings/page.tsx](file:///c:/Users/yendh/OneDrive/Desktop/pilla/SIH_INDIGO/frontend/app/ops/bookings/page.tsx):
- **Card Shell**: `Panel pad={false}` (`bg-white rounded-[28px] shadow-clay overflow-hidden`).
- **Table Element**: `<table className="w-full min-w-[860px] text-sm">`.
- **Header (`thead`)**: `bg-canvas text-left text-[11px] uppercase tracking-wider text-muted font-bold`.
- **Row (`tr`)**: `cursor-pointer border-t border-line hover:bg-canvas/60 transition-colors`.
- **Cell (`td`)**: `px-4 py-3`.
- **Row Click Action**: Triggers a detailed bottom sheet/drawer (`Sheet`) with structured key-value definitions (`dl` grid of `rounded-2xl bg-white p-3 shadow-clay-sm` tiles).

---

## 15. Animation & Motion Tokens

Verified from `motion/react` configurations:

```yaml
motion_tokens:
  spring:
    stiffness: 400
    damping: 32
  spring_bouncy:
    stiffness: 420
    damping: 24
  spring_smooth:
    stiffness: 120
    damping: 20
  ease_curve: [0.2, 0.8, 0.2, 1]
  durations:
    instant: "0.2s"
    fast: "0.32s"
    standard: "0.55s"
    long: "0.8s"
```

### 15.1 Reusable Motion Components

1. **Scroll Reveal**:
   ```tsx
   <motion.div
     initial={{ opacity: 0, y: 24 }}
     whileInView={{ opacity: 1, y: 0 }}
     viewport={{ once: true, margin: "-60px" }}
     transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
   >
     {children}
   </motion.div>
   ```

2. **Animated Numbers (Live Counter)**:
   - Uses `motion/react` `animate()` from previous value to new value over `0.8s` with `ease: [0.2, 0.8, 0.2, 1]`.

3. **Active Pill Spring Indicator**:
   ```tsx
   <motion.span
     layoutId="unique-tab-id"
     className="absolute inset-0 rounded-full bg-pill"
     transition={{ type: "spring", stiffness: 400, damping: 32 }}
   />
   ```

4. **Floating Ambient Loop**:
   - `animate-float`: 6s ease-in-out infinite (`translateY(0)` → `translateY(-10px)` → `translateY(0)`).

5. **Accessibility / Reduced Motion**:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.001ms !important;
       transition-duration: 0.001ms !important;
     }
   }
   ```

---

## 16. Comprehensive Design Tokens Reference

```yaml
design_tokens:
  colors:
    canvas: "#f5f1e8"
    canvas_cool: "#eef1f6"
    ink: "#1c1b2b"
    ink_soft: "#3a3850"
    muted: "#625f78"
    faint: "#9794ab"
    line: "#e8e2d6"
    line_cool: "#e3e7ef"
    pill: "#1c1b22"
    purple: "#7b5cf0"
    purple_deep: "#5a3dd4"
    lavender: "#c6b5f6"
    lavender_soft: "#ece5fe"
    sun: "#fad47f"
    sun_soft: "#fef3d6"
    sun_deep: "#a86f00"
    coral: "#f08a6c"
    coral_soft: "#fde3d9"
    coral_deep: "#c4502f"
    mint: "#d0e8ba"
    mint_soft: "#e8f4dc"
    mint_deep: "#3f8a2e"
    sky: "#c4def8"
    sky_soft: "#e3effc"
    sky_deep: "#2f6fbf"
    pink: "#f9cbc9"
    pink_soft: "#fde4e2"
    pink_deep: "#c9544f"
    cream: "#fdeedc"
    star: "#ffc23d"
    success: "#23864b"
    success_soft: "#dcf2e4"
    warning: "#a4660a"
    warning_soft: "#fff0d4"
    danger: "#c93535"
    danger_soft: "#fde2e2"
    info: "#2f6fbf"
    info_soft: "#e3effc"

  fonts:
    display: "Unbounded, ui-sans-serif, system-ui, sans-serif"
    sans: "Poppins, ui-sans-serif, system-ui, sans-serif"
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

  radii:
    sm: "8px"
    md: "12px"
    lg: "16px"
    xl: "20px"
    xl2: "24px"
    xl3: "28px"
    xl4: "32px"
    xl5: "44px"
    pill: "9999px"
    squircle: "30%"

  shadows:
    clay: "0 18px 34px -16px rgb(62 44 130 / 0.26), inset 0 -6px 12px rgb(40 22 96 / 0.07), inset 0 6px 12px rgb(255 255 255 / 0.9)"
    clay_sm: "0 10px 20px -12px rgb(62 44 130 / 0.3), inset 0 -3px 6px rgb(40 22 96 / 0.06), inset 0 3px 6px rgb(255 255 255 / 0.85)"
    clay_lg: "0 30px 60px -24px rgb(62 44 130 / 0.32), inset 0 -8px 16px rgb(40 22 96 / 0.07), inset 0 8px 16px rgb(255 255 255 / 0.9)"
    pop: "3px 3px 0 #1c1b2b"
    pop_lg: "5px 5px 0 #1c1b2b"
    soft: "0 1px 2px rgb(28 27 43 / 0.05), 0 8px 24px -14px rgb(28 27 43 / 0.16)"
    float: "0 24px 48px -18px rgb(28 27 43 / 0.35)"

  breakpoints:
    sm: "640px"
    md: "768px"
    lg: "1024px"
    xl: "1280px"
```

---

## 17. Reusable Page Templates

### 17.1 High-Conversion Landing Page Blueprint

```
[ Sticky Header: Logo | Nav Links (#how, #features, #pricing) | Login / Get Started Button ]
[ Hero Section (Grid lg:grid-cols-[1.15fr_1fr]):
    - Tilted Kicker Sticker (-rotate-1 border-2 border-ink shadow-pop)
    - Giant H1 with yellow highlighter stroke (<span className="bg-sun">)
    - Primary CTA Pill Button + Outline Demo Button
    - 3 Key Micro-Proof Value Items with Phosphor duotone icons
    - Right Side: Interactive Showcase Card + Comic Burst Sticker (ZAP!) ]
[ Continuous Infinite Marquee Carousel: Items inside rounded-[28px] border-2 border-ink shadow-pop ]
[ "How It Works" 4-Step Grid: rounded-[28px] bg-white shadow-clay, large faint step number (01, 02) ]
[ Dark Inverted Showcase Section: bg-ink text-white, live interactive stepper simulator ]
[ Two-Sided Platform Comparison Grid: Left (Consumer/Fun) vs Right (Operator/Calm Bento) ]
[ 8-Feature Bento Grid: Clay cards with squircle ArtTile icons ]
[ Trust & Safety Card: 2-column rounded-[40px] with statistics & checkmark pills ]
[ Big CTA Speed-Line Banner: bg-sun border-2 border-ink shadow-pop-lg with comic speed lines ]
[ Footer: bg-ink text-white with 18vw background watermark text ]
```

### 17.2 Operator Console / Dashboard Blueprint

```
[ Top Header: Logo + Tenant Name | Floating Pill Nav (Sections + sub-tabs) | AI Sparkle | Notification Bell | Avatar ]
[ PageHead: Subtitle + Kicker + Action Buttons ]
[ 4-Column Stat Cards Row:
    - StatCard: rounded-[24px] bg-white shadow-clay-sm
    - Left label + Top-right colored squircle badge with duotone icon
    - Large 28px font-display tabular number + subtext hint ]
[ Live Ripple / Activity Stream or Map Component ]
[ Filter & Search Pill Row: FilterPill capsules + SearchInput rounded-full ]
[ Main Panel: rounded-[28px] bg-white shadow-clay ]
    - Data Table with sticky header and click-to-drawer row action
[ Slide-Over Sheet / Drawer: Opens on row click with detailed key-value metadata ]
[ Floating AI Concierge Widget: Bottom-right docked button ]
```

---

## 18. Do's and Don'ts

### DO:
- **DO** use the canvas background utilities (`bg-dots` or `bg-dots-cool`) instead of flat sterile backgrounds.
- **DO** combine bold 2px ink borders with pop shadows (`border-2 border-ink shadow-pop`) on primary interactive elements.
- **DO** use the physical press mechanic on buttons (`active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`).
- **DO** use `Unbounded` for headings and numerical statistics, with `Poppins` for body and labels.
- **DO** pair every chromatic solid tone with its matching soft background and deep text color.
- **DO** build dual-mode modal dialogs: bottom-sheet on phones, side-drawer or modal on desktop.
- **DO** wrap numbers in `tabular` (`tabular-nums`) to prevent layout shifts during animations.

### DON'T:
- **DON'T** introduce raw un-curated saturated colors (e.g. default bootstrap blues or harsh greens).
- **DON'T** use sharp, 90-degree corners. Everything in this system is softened (`rounded-2xl` to `rounded-full`).
- **DON'T** omit the pop shadow when using a 2px ink border. An ink border without an offset shadow looks unfinished.
- **DON'T** use generic spinner placeholders when a themed mascot, skeleton, or animated progress bar can be used.
- **DON'T** copy the travel/trip domain terminology when building a new project. Apply this visual system to FinTech, EdTech, Developer Tools, or HealthTech.

---

## 19. Instructions for AI Coding Agents

When given a new project prompt alongside this `DESIGN.md`:

1. **Read `DESIGN.md` First**: Treat this document as the visual contract. Never invent a new color palette, button style, or typography scale.
2. **Translate Domain Concepts**:
   - If building a **FinTech app**: The "Trip Fixer Agent" becomes a "Transaction Dispute Agent"; the "Travel DNA" becomes a "Risk & Portfolio DNA"; the "Budget Meter" becomes a "Monthly Burn vs Savings Bar".
   - If building an **EdTech platform**: Sights/Hotels become Courses/Lessons; Itinerary days become Curriculum Modules; Booking vouchers become Verifiable Credentials.
   - If building an **Ops Dashboard**: Maintain the `OpsShell` top pill menu, sub-tabs, `StatCard` 4-column layout, and `Panel` high-density table.
3. **Always Install or Configure**:
   - `motion` (or `framer-motion`) for layout springs and tab sliding pills.
   - `@phosphor-icons/react` for duotone icons and sticker badges.
   - `@radix-ui` primitives for dialogs, popovers, tooltips, and dropdowns.
4. **Preserve the Contrast Philosophy**:
   - White cards on warm linen `bg-dots` canvas.
   - High-contrast 2px ink borders with 3px/5px offset pop shadows.
   - Smooth tactile hover transitions (`hover:-translate-y-1 hover:shadow-clay-lg`).

---

## 20. Quality Checklist for Generated Code

Before marking a frontend implementation complete, verify:

- [ ] **Background**: App uses `bg-dots` or `bg-dots-cool`, not `#ffffff` or `#000000`.
- [ ] **Typography**: Headings use `Unbounded` (or configured display font) with negative letter-spacing (`-0.02em`).
- [ ] **Buttons**: Primary buttons are capsule pills (`rounded-full`) with tactile pop shadow press physics.
- [ ] **Cards**: Cards feature either dual-layer clay shadows or 2px ink sticker borders with pop shadows.
- [ ] **Navigation**: Desktop header contains the floating pill menu with animated layout springs (`layoutId`).
- [ ] **Mobile**: Dedicated floating bottom navigation bar with active capsule highlights.
- [ ] **Modals**: Implemented as bottom sheets on phones, side drawers or centered modals on desktop.
- [ ] **States**: Empty state with expressive mascot/art, error state with dashed border and retry action, skeleton shimmer for loading.
- [ ] **Color Harmony**: Restricted to the 7-tone palette; no un-themed random hex colors.
- [ ] **Zero Logic Leaks**: No accidental mentions of previous domain names (unless explicitly asked).
