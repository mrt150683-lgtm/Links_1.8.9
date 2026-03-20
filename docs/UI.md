\# UI.md — Obsidian + Gold “Memory Hive” Style Guide (Reusable)



This document defines a \*\*dark, minimal, futuristic\*\* UI theme inspired by the uploaded reference screens/icons: \*\*obsidian backgrounds\*\*, \*\*brushed-gold accents\*\*, \*\*soft glassy panels\*\*, and \*\*clean grid layouts\*\*.  

Use this as the UI contract for a \*different app\* (different name/features), while keeping the same look/feel.



---



\## 1) Design North Star



\*\*Vibe:\*\* “Quiet command center.” Dark, calm, premium, slightly sci-fi — not neon cyberpunk.  

\*\*Rules:\*\*

\- Darkness is the base. Gold is the \*accent\*, not a floodlight.

\- Surfaces are subtle “glass” panels with gentle gradients and soft borders.

\- Typography is clean and modern, with \*\*small caps\*\* / letter spacing for brand touches.

\- Layouts are \*\*grid-first\*\*, low clutter, high scanability.

\- Icons are \*\*emoji placeholders\*\* (easy swap), but presented inside \*\*gold/brass UI frames\*\* so they still match the theme.



---



\## 2) Color System (Tokens)



\### Core palette (derived from references)

\- \*\*bg-0 (Obsidian):\*\* `#10141A`  (very dark blue/charcoal)

\- \*\*bg-1:\*\* `#131A21`

\- \*\*surface-0 (Panel):\*\* `#171E26`

\- \*\*surface-1 (Raised Panel):\*\* `#1B232C`

\- \*\*border-subtle:\*\* `#2A333D`

\- \*\*text-0 (Primary):\*\* `#E8EEF6`

\- \*\*text-1 (Secondary):\*\* `#A9B4C0`

\- \*\*text-2 (Muted):\*\* `#7D8A98`



\### Gold / Brass accents

Use gold in \*\*borders, icons, selected states, and key headings\*\*.

\- \*\*gold-0 (Highlight):\*\* `#F0E1B0`

\- \*\*gold-1 (Primary):\*\* `#D6BF74`

\- \*\*gold-2 (Deep):\*\* `#A88340`

\- \*\*gold-3 (Shadow):\*\* `#6B5328`



\### State colors (keep muted)

\- \*\*success:\*\* `#4FB06D` (small indicators only)

\- \*\*warning:\*\* `#D6BF74` (reuse gold)

\- \*\*danger:\*\* `#D06A6A` (rare, never neon)



\### Background gradients

\- App background: `linear-gradient(180deg, #0E1217 0%, #10141A 45%, #0C1015 100%)`

\- Panels: `linear-gradient(180deg, #171E26 0%, #141B22 100%)`



---



\## 3) Typography



\### Font stack (safe, clean, “dashboard”)

\- \*\*UI / body:\*\* `Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`

\- \*\*Brand / small-caps accent (optional):\*\* `Cinzel, "Trajan Pro", "Times New Roman", serif`  

&nbsp; (Only for logo/wordmark, not body paragraphs.)



\### Sizes \& weights (suggested)

\- \*\*H1 / Page Title:\*\* 24–28px, 700

\- \*\*H2 / Section:\*\* 18–20px, 600

\- \*\*Card Title:\*\* 16–18px, 600

\- \*\*Body:\*\* 13–14px, 450–500

\- \*\*Micro / Meta:\*\* 11–12px, 500



\### Signature styling

\- Brand text can use: \*\*small caps + letter spacing\*\*

&nbsp; - `letter-spacing: 0.18em;`

&nbsp; - `text-transform: uppercase;`

\- Secondary text should be muted and slightly tighter:

&nbsp; - `line-height: 1.35;`



---



\## 4) Layout \& Spacing



\### Spacing scale (8pt grid)

`4, 8, 12, 16, 24, 32, 48`



\### Radius

\- \*\*Cards / panels:\*\* 16px

\- \*\*Inputs / chips:\*\* 12px

\- \*\*Icon buttons:\*\* 10–12px



\### Default dashboard layout patterns

1\. \*\*Landing grid:\*\* 3 columns (desktop), 2 (tablet), 1 (mobile)

2\. \*\*App shell:\*\* top bar + tab row + content

3\. \*\*Content header:\*\* search + filters + view toggles on one line where possible



---



\## 5) Surfaces, Borders, Shadows



\### Panels (“glass cards”)

\- Background: `surface-0` gradient

\- Border: `1px solid border-subtle`

\- Shadow: subtle, soft, \*not\* harsh

&nbsp; - `0 12px 30px rgba(0,0,0,0.35)`



\### Hover/active behavior (premium feel)

\- Hover: slightly brighter border + tiny lift

&nbsp; - translateY: `-2px`

&nbsp; - border: shift toward `#3A4653`

\- Active/selected: gold border + faint gold glow

&nbsp; - `0 0 0 1px rgba(214,191,116,0.55), 0 12px 30px rgba(0,0,0,0.35)`



---



\## 6) Components (Must Match the Reference Feel)



\### 6.1 Top Bar

\- Left: App icon/emoji + app name in \*\*gold\*\*

\- Right: connection status (small dot + “Connected”), and 1–2 icon buttons

\- Bottom divider line (thin, subtle)



\*\*Connection indicator:\*\*

\- Dot: success green when connected, muted grey when not

\- Text: `text-2`



\### 6.2 Tabs Row (Memories / Calendar / Timeline style)

\- Tabs are text buttons on a dark strip

\- Active tab: gold accent (text + subtle pill highlight OR underline)

\- Inactive: muted text



\### 6.3 Search Bar

\- Full-width on content header row

\- Left search emoji/icon, right clear button

\- Border subtle, background slightly lighter than page



\### 6.4 Filter Chips (“All / Recent / Personal …”)

\- Inactive chip: dark surface + subtle border

\- Active chip: gold border + slightly brighter text

\- Keep chips compact; no chunky padding



\### 6.5 Cards (Primary building block)

Two key card types:



\*\*A) Dashboard Tile Card (Landing screen)\*\*

\- Centered emoji/icon in a small gold frame

\- Title: white

\- Subtitle: muted

\- Hover: lift + border brightening



\*\*B) Content Card (Memory item style)\*\*

\- Title line: gold-highlighted

\- Right: category badge (“INFORMATION”)

\- Body: short preview, muted

\- Footer: tags row + tiny action buttons (approve/reject/etc.)



\### 6.6 Badges (e.g., INFORMATION)

\- Small pill, uppercase, letter-spaced a touch

\- Background: darker than card

\- Border: subtle

\- Text: muted (or gold for “important” states)



\### 6.7 Dropdowns / Selects (Technology / Newest First)

\- Dark surface, subtle border

\- Selected item can show gold dot or gold highlight line

\- Avoid bright blue focus rings; use \*\*gold focus outline\*\*



\### 6.8 Status Pill (Bottom-right “System Operational” style)

\- Rounded pill, dark surface

\- Left dot: gold or green depending on meaning

\- Minimal shadow



---



\## 7) Emoji Icon System (Swap-Friendly)



We use emojis as placeholders, but \*\*never raw-floating\*\*. They must sit inside a consistent frame:



\### Emoji Badge (Standard)

\- Size: 44px (or 36px compact)

\- Shape: circle or rounded square

\- Background: brushed-gold gradient illusion

\- Border: faint gold outline

\- Shadow: soft



\*\*Recommendation:\*\* use monochrome-ish emojis where possible (⚙️ 🧠 📅 🗂️ 🔍 🧪 🧩).  

If an emoji is too colorful, keep it but reduce visual clash by framing it in gold and keeping the surrounding UI calm.



\*\*Optional CSS trick (works in many Chromium builds):\*\*

\- `filter: sepia(0.9) saturate(2.2) hue-rotate(8deg) brightness(1.05);`

Use sparingly; emojis should still be readable.



---



\## 8) Motion \& Interaction (Subtle, Not Arcade)



\- Hover transitions: 120–160ms ease

\- Panel lift: max 2–3px

\- Fade/slide on page transitions: 160–220ms

\- Loading: skeletons (dark shimmer), not spinners everywhere



---



\## 9) Accessibility \& UX Constraints



\- Maintain contrast: gold on obsidian is fine; muted text must remain readable.

\- Keyboard focus: use \*\*gold focus ring\*\*:

&nbsp; - `box-shadow: 0 0 0 2px rgba(214,191,116,0.35);`

\- Never rely on color alone for state (pair with icon/label).

\- Keep density “pro”: compact controls, but not cramped.



---



\## 10) Implementation Starter (CSS Variables)



Drop these into your global CSS and build from them.



```css

:root{

&nbsp; --bg-0:#10141A;

&nbsp; --bg-1:#131A21;



&nbsp; --surface-0:#171E26;

&nbsp; --surface-1:#1B232C;



&nbsp; --border-subtle:#2A333D;



&nbsp; --text-0:#E8EEF6;

&nbsp; --text-1:#A9B4C0;

&nbsp; --text-2:#7D8A98;



&nbsp; --gold-0:#F0E1B0;

&nbsp; --gold-1:#D6BF74;

&nbsp; --gold-2:#A88340;

&nbsp; --gold-3:#6B5328;



&nbsp; --success:#4FB06D;

&nbsp; --danger:#D06A6A;



&nbsp; --r-card:16px;

&nbsp; --r-input:12px;



&nbsp; --shadow-soft:0 12px 30px rgba(0,0,0,0.35);

}



.app-bg{

&nbsp; background: linear-gradient(180deg, #0E1217 0%, var(--bg-0) 45%, #0C1015 100%);

&nbsp; color: var(--text-0);

}



.panel{

&nbsp; background: linear-gradient(180deg, var(--surface-0) 0%, #141B22 100%);

&nbsp; border: 1px solid var(--border-subtle);

&nbsp; border-radius: var(--r-card);

&nbsp; box-shadow: var(--shadow-soft);

}



.panel:hover{

&nbsp; border-color:#3A4653;

&nbsp; transform: translateY(-2px);

&nbsp; transition: transform 140ms ease, border-color 140ms ease;

}



.panel--active{

&nbsp; box-shadow: 0 0 0 1px rgba(214,191,116,0.55), var(--shadow-soft);

&nbsp; border-color: rgba(214,191,116,0.55);

}



.gold{

&nbsp; color: var(--gold-1);

}



