---
name: Technical Neo-Brutalist
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1b1b1b'
  on-surface-variant: '#424655'
  inverse-surface: '#303030'
  inverse-on-surface: '#f1f1f1'
  outline: '#737687'
  outline-variant: '#c2c6d8'
  surface-tint: '#0055d5'
  primary: '#0052d0'
  on-primary: '#ffffff'
  primary-container: '#1f6bfa'
  on-primary-container: '#fefcff'
  inverse-primary: '#b3c5ff'
  secondary: '#705d00'
  on-secondary: '#ffffff'
  secondary-container: '#fdd400'
  on-secondary-container: '#6f5c00'
  tertiary: '#b9003f'
  on-tertiary: '#ffffff'
  tertiary-container: '#e51152'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae1ff'
  primary-fixed-dim: '#b3c5ff'
  on-primary-fixed: '#001849'
  on-primary-fixed-variant: '#003fa4'
  secondary-fixed: '#ffe170'
  secondary-fixed-dim: '#e9c400'
  on-secondary-fixed: '#221b00'
  on-secondary-fixed-variant: '#544600'
  tertiary-fixed: '#ffd9dc'
  tertiary-fixed-dim: '#ffb2ba'
  on-tertiary-fixed: '#400010'
  on-tertiary-fixed-variant: '#910030'
  background: '#f9f9f9'
  on-background: '#1b1b1b'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Anton
    fontSize: 72px
    fontWeight: '400'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Anton
    fontSize: 48px
    fontWeight: '400'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Anton
    fontSize: 32px
    fontWeight: '400'
    lineHeight: '1.2'
  headline-sm:
    fontFamily: Anton
    fontSize: 24px
    fontWeight: '400'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.2'
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Anton
    fontSize: 36px
    fontWeight: '400'
    lineHeight: '1.1'
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
  container-max: 1280px
---

## Brand & Style

This design system adopts a **Neo-Brutalist** aesthetic, characterized by a raw, functional, and unapologetically technical atmosphere. It is designed to feel like a "lab environment" or a high-end developer terminal—prioritizing information density and structural clarity over decorative flourishes.

The brand personality is authoritative, precise, and radical. It targets a technical audience that values utility and "no-fluff" interfaces. Key visual drivers include:
- **Structural Integrity:** Heavy 2px-3px black borders define every module.
- **High-Contrast:** A stark interplay between neutral backgrounds and saturated accents.
- **Functional Decoration:** Visual interest is derived from grid lines, monospaced data, and status indicators rather than imagery or soft gradients.

## Colors

The palette is rooted in a "Terminal High-Contrast" philosophy. The primary surface is a clinical off-white, providing a neutral stage for high-intensity accents.

- **Primary (Electric Blue):** Used for primary actions and "Era 2" thematic markers.
- **Secondary (Warning Yellow):** Reserved for "Era 1" markers, warnings, and high-priority highlights.
- **Tertiary (Magenta):** Used for "Critical" statuses, "Era 3" accents, and destructive actions.
- **Accent Green:** Used for "Success" states and "Final Era" markers.
- **Neutral:** Deep black (#000000) is the absolute foundation for all borders, text, and structural dividers.

The design system supports a "Dark Mode" where the background shifts to a deep charcoal/black and borders flip to stark white or high-contrast grays, maintaining the 2px-3px stroke weight.

## Typography

The typography strategy employs a "Modular/Technical" split. 

**Headlines** use **Anton** for a heavy, condensed, and impactful presence that mimics industrial signage. All major headlines should be treated with tight tracking and a commanding scale.

**Body copy** uses **Inter** for maximum legibility in dense technical contexts. It provides a clean, neutral balance to the aggressive headlines.

**Data and UI Labels** use **JetBrains Mono**. This reinforces the "lab" aesthetic, ensuring that metadata, status tags, and code snippets feel distinct from narrative text. All labels should be uppercase to enhance the "terminal" feel.

## Layout & Spacing

The layout is governed by a **Strict Modular Grid**. Elements are not just placed; they are "contained" within visible or implied boxes.

- **Grid Model:** A 12-column fluid grid for desktop, collapsing to 4 columns for mobile.
- **Rhythm:** An 8px baseline grid is used to align all components and text, ensuring a disciplined, mathematical feel.
- **Gaps:** Unlike traditional modern UI, gutters are often replaced by shared borders (border-collapse style) to create a unified technical mesh.
- **Margins:** Generous outer margins (40px+) are used to frame the "terminal" window, while internal component padding is kept tight (16px-24px) to maintain density.

## Elevation & Depth

This design system rejects shadows and blurs in favor of **Hard-Edge Depth** and **Tonal Layering**.

- **No Shadows:** Physicality is represented by 2px-3px solid black borders.
- **Stark Stacking:** Depth is achieved through "hard-pop" offsets. An active card or button may shift 4px down and 4px right, revealing a solid black "shadow" box underneath.
- **Visible Seams:** Use 1px dotted or dashed lines for secondary dividers that are internal to a module, reserving the 3px solid line for the primary structural container.
- **The "Glass" Exception:** While mostly opaque, an occasional 100% transparent surface with a heavy border can be used for "Overlay" states (like a terminal prompt).

## Shapes

The shape language is strictly **Geometric and Sharp**. 

- **Corners:** Use 0px (Sharp) radius for all primary containers, buttons, and input fields. This communicates precision and a "built" quality.
- **Minimal Softening:** A 2px radius is permitted only for micro-elements like checkboxes or "pill" status chips if necessary for touch targets, but the default preference is always 90-degree angles.
- **Borders:** Every shape must have a defined stroke. Never use a "borderless" card or button.

## Components

### Buttons
- **Base:** Sharp corners, 2px black border, JetBrains Mono bold text (all caps).
- **Primary:** Background in Electric Blue or Yellow. On hover, the button should "sink" (remove the hard-offset shadow or shift position by 2px).
- **Ghost:** Transparent background with heavy black borders.

### Input Fields
- **Style:** 2px solid black bottom border or full box. 
- **Focus:** Background shifts to a very light tint of the primary accent color (e.g., 5% Electric Blue).
- **Placeholder:** JetBrains Mono in 50% opacity black.

### Cards & Modules
- **Header:** Cards should feature a distinct "Header Bar" with a solid black background and white JetBrains Mono text to label the module's function.
- **Body:** Off-white background with a 3px border framing the entire module.

### Chips & Status Era Markers
- **Form:** Small, sharp-cornered rectangles.
- **Logic:** Color-coded based on the Era (Yellow = Era 1, Blue = Era 2, Green = Era 3).
- **Typography:** JetBrains Mono, 10px-12px.

### Lists
- **Style:** Divided by 1px solid black lines. Each row should have a "hover" state that fills the background with the Secondary (Yellow) color.