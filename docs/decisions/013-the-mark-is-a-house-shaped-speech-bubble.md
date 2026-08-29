# ADR-013 — The mark is a house-shaped speech bubble, and the mascot keeps its brass

- **Date**: 2026-08-29
- **Status**: accepted. Supersedes the *mark* and *motion* parts of ADR-012; its
  *colour* part (Angular's magenta-violet as the product accent) stands.
- **Context**: ADR-012 drew the mascot at home as a thin pentagon outline around a
  cream face, the state told by a light at 7 % opacity, the face bobbing in
  `steps(24)` inside an immobile house. Seen in the tab, the launcher and the
  sidebar it was flat — no body, no light — and it had already drifted into four
  drawings (the component, the two icons and the social card each had their own
  geometry, the card's nearly square). `index.html` declared a housed SVG favicon
  the ADR said the favicon must not have, and `FaviconService` rewrote the `.ico`
  link instead; `favicon.ico` was July's brass face; the wordmark still read
  "aparté". The bob jittered at 14 px, snapped when the state changed, and froze
  mid-bob during the decode. The sibling product, aparté Spaces (Svelte), draws the
  mascot piloting a saucer with matter and light; next to it the house looked like
  clip-art. And aimi's robot (talk-core) showed what a mascot with real states is.
- **Decision**:
  1. **The silhouette** is a house whose floor carries the tail of a speech bubble,
     on the left — the side the assistant speaks from. One shape says both things:
     it is a conversation, and it happens at home. Its path is written once, in
     `src/app/mascotte/mark.ts` (`MARK_PATH`, a 120×100 box), and `mark.spec.ts`
     checks that the two launcher icons, the static favicon and the social card
     draw that exact `d`. The face is 40/120 of the house, baseline 71 — sized so
     the widest faces clear the walls (see 5).
  2. **Matter and light.** The house has a body (the theme's surface), walls in the
     product's accent, and a warm light behind the face — the mascot's own brass,
     a radial gradient clipped to the walls, so it never crosses them. In the icons
     the scene is a night: dark ground, a few brass stars, a magenta glow under the
     house.
  3. **The mascot keeps the library's brass**, everywhere it appears
     (`--bp-mascotte`, `--bp-mascotte-ink` in `styles.scss`; the lib renderers, the
     tool cards, the sheets' glyphs, the noscript page). It is aparté's mascot,
     visiting an Angular product: the product colours the house, never the face —
     as Spaces colours its saucer's lights in Svelte orange and keeps the pilot in
     brass. That is the family rule: a place per product, the same inhabitant.
  4. **The favicon carries the silhouette, solid**, its colour the state (accent,
     red for error, muted for sleep) on the theme's ground. At 16 px an outline
     turns to mush and a bare face to a speck; the solid shape is the one drawing
     that survives — checked at 16, 32 and 48. `icons/favicon.svg` is the static
     one, `FaviconService` redraws *that* link, and `favicon.ico` is packed from
     the same SVG by `tools/render-assets.mjs`.
  5. **Real states, typographic.** Idle: the eyes blink. Thinking: `…` in the attic
     (the gable above the face), the eyes look around, the light breathes.
     Talking: the nose flaps at ~13 fps (`steps(6)`), the light is full, the tail
     is lit and pulses — the words leave the house through it. Happy: `(ˆ.ˆ)`, a
     bounce; a boop adds hearts. Error: `(x.x)`, red walls, the light off, a shake
     on the way in. Sleeping: `(-.-)`, grey walls, the light off, z's rising to the
     apex. Wake: a stretch. Surprised (hover): `(°.°)`, a jolt. Searching (the
     cursor gone quiet): `?`, the eyes sweep. The eyes follow the cursor on mounts
     that ask (`follow`; `interactive` adds hover, click, a wink or a side glance
     every 8-15 s). The glyphs are chosen by width as much as by look: Georgia's
     `^` is 0.64 em and `o` 0.54 against 0.22 for the apostrophe, and `(^.^)` ran
     into the walls; the modifier circumflex `ˆ` (0.5) and the degree sign `°`
     (0.42) fit. The eyes are the straight apostrophe, as the icons draw them.
  6. **The mascot is not frozen during the decode.** It no longer carries
     `.bp-decorative`: everything animated is a transform or an opacity on a small
     element, every loop is capped with `steps()`, the moving parts carry
     `will-change` — aimi's second lesson (talk-core `styles.scss`: "the mascot is
     NOT frozen anymore, its animations were reworked to be cheap"). The typing
     dots and the minimap stay frozen.
  7. **The wordmark is "Monaparté"**, beside a face of 15 (a 45 px house).
- **Consequences**:
  - Mounts: home screen 110 `interactive` (the playground), corner 64 `follow`,
    onboarding 72, privacy 64, model update 56, sidebar 15. `GeneratingService`
    holds `celebrating` for 1.5 s after a generation: the corner's happy beat, and
    the favicon's.
  - `/debug/mascotte` shows every state in the real component without a model —
    `talking` otherwise needs a decode.
  - Measured, not guessed: Georgia puts the parentheses' ink centre 0.554 em down
    a 1 em line box (baseline at 0.849, parentheses 0.75 up and 0.16 down); the
    first guess, 0.6, rode 5 % high. The numbers live in `mark.ts` and the
    component's styles (written out: `ngc` needs the styles to be a literal).
  - Seen in Chrome (headless, driven over CDP against `ng serve`, light and dark):
    the nine states at 64, zoomed ×3, every face inside the walls; the sidebar mark
    beside the wordmark; the playground's look, hover and boop with hearts; the
    onboarding mount at 72; the favicon SVG and the `.ico` decoded at 16/32/48;
    the 512 icon and the social card re-rendered.
- **Evidence / references**: `src/app/mascotte/mark.ts`, `mark.spec.ts`,
  `mascotte.component.ts`, `mascotte-states.ts`, `favicon.service.ts`,
  `public/icons/*.svg`, `tools/og-card.html`, `tools/render-assets.mjs`,
  `../talk-core-workspace/apps/home/src/app/shared/mascot/` (the reference for
  the states and the freeze), `../spaces` (the saucer).
