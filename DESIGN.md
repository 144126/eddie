---
version: alpha
name: xAI
website: "https://x.ai"
description: An inspired interpretation of xAI's design language — Elon Musk's frontier-AI company whose web surface is a strict near-black canvas broken only by white pill outlines, occasional warm sunset / dusk gradient accents, a custom geometric sans (Universal Sans) for display, and an uppercase tracked monospace caption face; the whole system reads as engineered-cosmic, unmarketed.
colors:
  primary: "#ffffff"
  on-primary: "#0a0a0a"
  ink: "#ffffff"
  ink-hover: "#fafaf7"
  body: "#dadbdf"
  body-mid: "#7d8187"
  mute: "#7d8187"
  hairline: "#212327"
  canvas: "#0a0a0a"
  canvas-soft: "#1a1c20"
  canvas-card: "#191919"
  canvas-mid: "#363a3f"
  accent-sunset: "#ff7a17"
  accent-sunset-soft: "#ffc285"
  accent-dusk: "#7c3aed"
  accent-twilight: "#c4b5fd"
  accent-breeze: "#a0c3ec"
  accent-midnight: "#0d1726"
typography:
  display-xl: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 96px, fontWeight: 400, lineHeight: 96px, letterSpacing: -2.4px }
  display-lg: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 72px, fontWeight: 400, lineHeight: 72px, letterSpacing: -1.8px }
  display-md: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 48px, fontWeight: 400, lineHeight: 48px, letterSpacing: -1.2px }
  display-sm: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 32px, fontWeight: 400, lineHeight: 36px, letterSpacing: -0.6px }
  display-xs: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 20px, fontWeight: 400, lineHeight: 28px }
  body-lg: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 18px, fontWeight: 400, lineHeight: 28px }
  body-md: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 16px, fontWeight: 400, lineHeight: 24px }
  body-sm: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 14px, fontWeight: 400, lineHeight: 20px }
  caption-mono: { fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace", fontSize: 14px, fontWeight: 400, lineHeight: 20px, letterSpacing: 1.4px, textTransform: uppercase }
  caption-mono-sm: { fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12px, fontWeight: 400, lineHeight: 16px, letterSpacing: 1.2px, textTransform: uppercase }
  button-md: { fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 14px, fontWeight: 400, lineHeight: 20px }
spacing:
  xxs: 2px | xs: 4px | sm: 8px | md: 12px | lg: 16px | xl: 24px | 2xl: 32px | 3xl: 48px | 4xl: 64px
rounded:
  none: 0 | sm: 8px | pill: 9999px | full: 9999px
components:
  button-primary: { bg: primary, text: on-primary, border: primary, pill, px: md, py: xs }
  button-outline: { bg: canvas, text: ink, border: hairline, pill, px: lg, py: sm }
  button-outline-sm: { bg: canvas, text: ink, border: hairline, pill, px: md, py: xs }
  text-input: { bg: canvas-soft, text: ink, border: hairline, radius: sm, px: lg, py: md }
  card-content: { bg: canvas-card, text: ink, border: hairline, radius: sm, p: xl }
  nav-bar: { bg: canvas, text: ink, px: xl, py: md }
  nav-link: { text: ink, body-sm }
  footer: { bg: canvas, text: body, px: xl, py: 3xl }
  hero-band: { bg: canvas, text: ink, px: xl, py: 4xl }
  content-band: { bg: canvas, text: ink, px: xl, py: 4xl }
  eyebrow-mono: { text: ink, caption-mono }
  divider-hairline: { border: hairline }
known-gaps:
  - "Runtime border on outline pills uses rgba(255,255,255,0.25), not solid hairline"
  - "Sunset-to-dusk gradient stops not captured per-token"
  - "No loading states / skeleton screens documented"
  - "Focus-ring treatment not visible on captured surfaces"
