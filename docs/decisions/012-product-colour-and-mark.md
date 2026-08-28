# ADR-012 — Monaparté carries its own colour and its own mark

- **Date**: 2026-08-29
- **Status**: accepted
- **Context**: until now the product overrode no colour at all: brass and plum came
  from `@aparte/core`'s defaults, so Monaparté wore the library's identity. With
  several products built on aparté, each on its own framework, they were
  indistinguishable — and the library's identity was being spent on one of them.
- **Decision**: each product takes the colour of the framework it is built on.
  Monaparté is Angular, so it is magenta-violet: `--aparte-primary` `#a21caf` in
  light, `#d946ef` in dark, overridden in `styles.scss`. The library keeps
  brass/plum. The product mark is the mascot **at home**: a closed pentagon —
  no door, no window — around the `('.')` face, and the only light is inside.
- **Consequences**:
  - Two overridden masters are enough: aparté re-anchors its derived layer on
    `[data-aparte-theme]`, so the 66 values computed from `--aparte-primary`
    follow. The dark block needs the higher specificity (`:root[data-aparte-theme='dark']`),
    otherwise our light `:root`, declared after the library's sheet, wins there too.
  - The gradient (`#e90066 → #a21caf`) is the **mark's**, never the interface's:
    `--aparte-primary` is read by `oklch(from …)` and `color-mix(…)`, which take a
    colour. A gradient is an image; every derived value would fail to substitute,
    silently.
  - The house lives where it is an image: the PWA icons, the social card, and three
    mounts — the home screen (110), the corner mascot (64) and the sidebar wordmark
    (14, so the mark is 42 px wide beside an 18 px word). It is NOT in the favicon:
    at 16-32 px the walls and the face fight for the same pixels and neither wins
    (tried, unreadable in the tab), so the favicon keeps the bare face, big, and
    says the state through its colour. Nor is it in the library's status and error
    renderers, which are plain text where a drawing cannot follow.
  - Inside the house the state is told by the light, which changes by **transition**,
    never by a looping animation: `body.bp-generating .bp-decorative` freezes
    decorative animations during GPU decoding — exactly while the mascot thinks or
    talks.
- **Evidence / references**: `src/styles.scss`, `src/app/mascotte/mascotte.component.ts`,
  `public/icons/mascotte*.svg`, `tools/og-card.html`. Supersedes the founding note
  "the library's light and dark defaults ARE the palette → zero colour override"
  (implementation journal, 2026-07-24).
