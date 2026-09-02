---
name: Civic Intelligence System
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#40484d'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0f0'
  outline: '#70787e'
  outline-variant: '#bfc8ce'
  surface-tint: '#136685'
  primary: '#00455d'
  on-primary: '#ffffff'
  primary-container: '#005e7d'
  on-primary-container: '#92d6f9'
  inverse-primary: '#8ccff3'
  secondary: '#815504'
  on-secondary: '#ffffff'
  secondary-container: '#fdc26c'
  on-secondary-container: '#774e00'
  tertiary: '#3f403f'
  on-tertiary: '#ffffff'
  tertiary-container: '#565756'
  on-tertiary-container: '#cdcdcb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c1e8ff'
  primary-fixed-dim: '#8ccff3'
  on-primary-fixed: '#001e2b'
  on-primary-fixed-variant: '#004d67'
  secondary-fixed: '#ffddb2'
  secondary-fixed-dim: '#f7bc67'
  on-secondary-fixed: '#291800'
  on-secondary-fixed-variant: '#624000'
  tertiary-fixed: '#e3e2e0'
  tertiary-fixed-dim: '#c7c6c5'
  on-tertiary-fixed: '#1a1c1b'
  on-tertiary-fixed-variant: '#464746'
  background: '#fcf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e1'
typography:
  display:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  data-label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
  caption:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  panel-gap: 1px
  section-padding: 1.5rem
  element-gap: 0.75rem
  sidebar-width: 360px
  inspector-width: 320px
---

## Brand & Style

This design system is engineered for the high-stakes environment of urban planning, where precision and trust are paramount. The visual language blends **Modern Minimalism** with a **Tactile Information** layer, prioritizing spatial clarity and intellectual calm. 

The aesthetic is "Analog-Digital"—it mimics the reliability of architectural vellum and physical drafting tables through warm neutrals, while employing sophisticated, glass-like overlays for AI-driven data layers. The goal is to reduce cognitive load during complex decision-making, moving away from "software-as-a-tool" toward "software-as-a-partner." 

Key attributes include:
- **Spatial Hierarchy:** A map-first philosophy where UI elements feel like integrated physical panels rather than floating digital objects.
- **Evidence-Based Visuals:** Every AI suggestion is anchored by a visible "logic chain" or confidence marker.
- **Architectural Polish:** Precise 1px lines, generous internal padding within dense data sets, and a focus on structural alignment.

## Colors

The palette is rooted in a warm, architectural off-white (`#F9F8F6`) to prevent screen fatigue during long working sessions. 

- **The Intelligence Blue (`#005E7D`):** Reserved strictly for AI-generated insights, active agent processing, and automated suggestions.
- **The Human Amber (`#7D5200`):** A sophisticated, muted gold used to denote manual overrides, human decisions, and final approvals—creating a clear visual contrast between machine logic and human agency.
- **Data Layers:** GIS information uses a semi-transparent functional palette (Emerald, Amber, Indigo) with 20% opacity fills and 100% opacity strokes to ensure map legibility remains high.
- **Typography:** Charcoal (`#2D2D2D`) provides high legibility without the harshness of pure black.

## Typography

The system utilizes **Geist** for its technical precision and neutral, modern character. It feels engineered yet approachable. 

For data-heavy panels and GIS attributes, **JetBrains Mono** is introduced at small scales (`data-label`). This monospaced choice ensures that numerical data and coordinates align perfectly in tables and inspector panels, reinforcing the sense of "Calculated Analysis."

- **Hierarchy:** Large display titles are rare, used only for project headers. 
- **Compactness:** In sidebars, use `body-sm` to maximize information density without sacrificing legibility.
- **Case Styling:** Use all-caps for `data-label` to distinguish metadata from content.

## Layout & Spacing

This is a **Map-First Integrated Layout**. The map serves as the canvas (the lowest layer), while UI elements exist as docked panels or drawers. 

- **Grid:** A 12-column underlying grid is used for the "Dashboard" view, but the primary "Workspace" view uses a fixed-sidebar model.
- **Panel Logic:** Panels are separated by 1px borders (`border_subtle`) rather than large gaps. This creates a "unified instrument" feel.
- **Responsiveness:** 
    - **Desktop:** Persistent left navigation and right-side inspector.
    - **Tablet:** Sidebars collapse into icons; panels slide over the map as 75% width drawers.
    - **Mobile:** Not recommended for heavy planning; focus on "View Only" or "Status Update" modes.

## Elevation & Depth

To maintain a professional, spatial feel, this system avoids traditional drop shadows. Depth is communicated through:

- **Tonal Layering:** The map is the base. Integrated panels use the primary neutral (`#F9F8F6`). Active popovers use a slight background blur (12px) with a 1px border.
- **Inset Shadows:** Used sparingly inside data containers to indicate scrollable areas or nested content.
- **AI "Glow":** AI-active areas or "Processing" states use a subtle, inner-glow of Intelligence Blue rather than an external shadow. This makes the panel feel "energized" rather than "floating."
- **Glassmorphism:** Used only for map-overlay controls (zoom, layer toggle) to ensure the underlying map data is partially visible.

## Shapes

The shape language is **Professional/Soft**. 

A radius of `0.25rem` (4px) is the standard for most interface elements like input fields and buttons, providing a clean, architectural edge. Larger containers or cards (if used) may go up to `0.5rem`, but never beyond. Buttons should never be fully pill-shaped, as it clashes with the "precise tool" aesthetic.

## Components

### AI Confidence Indicators
Small, 4px-high "logic bars" at the top of AI recommendation cards. The bar fills based on a percentage of "Confidence Evidence."

### Status Chips
- **Observed:** Outline-only, charcoal stroke.
- **Calculated:** Solid light-grey fill.
- **AI Recommendation:** Solid Intelligence Blue fill, white text.
- **Decision:** Solid Human Amber fill, white text.

### Integrated Panels
Panels do not have shadows. They are separated by `1px` borders. Header areas within panels use a subtle `#F0EEEB` background to distinguish from the content area.

### Input Fields
Inputs are "Minimalist/Architectural": a simple bottom border that transforms into a full outline on focus. Labels are always `data-label` (monospaced) sitting above the field.

### Agent Activity Feed
A specialized component showing a stream of "Thoughts" and "Actions." Each step is timestamped in monospaced font, with Intelligence Blue thread-lines connecting sequential logic steps.

### Buttons
- **Primary:** Intelligence Blue for AI-triggering actions.
- **Secondary:** Charcoal for standard system actions.
- **Manual Override:** Human Amber for final project approvals.