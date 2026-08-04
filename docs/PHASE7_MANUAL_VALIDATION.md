# Phase 7 manual validation

Automated Chromium, Firefox, and WebKit tests cover node selection, atom
deletion asymmetry, atom-adjacent composition, zero composing DOM writes,
semantic roles, required image alternatives, and axe. They do not prove the
quality of screen-reader speech or physical-device IME sequences.

## Run the surface

From the repository root:

```sh
pnpm --dir packages/react/playground dev
```

Open `http://127.0.0.1:5173/?canonical=1&atoms=1`.

## VoiceOver + Safari or NVDA + Chrome

1. Navigate through the paragraph containing text, a formula, and an image.
   Confirm the formula is announced as math and the image uses its alternative,
   rather than reading raw DOM internals.
2. Click the inline atom. Confirm selection is announced once and ordinary
   arrow navigation does not repeatedly flood the announcement.
3. Use Backspace adjacent to the inline atom and confirm it deletes directly.
4. Select the block image. Confirm the first Backspace selects it and the second
   deletes it.
5. In the product editor, insert an image. Confirm insertion asks for an
   alternative. Leave it empty deliberately and inspect that
   `data-smart-type="image"` carries the decorative state.
6. With an image selected, reach the resize controls by keyboard and use
   Left/Right Arrow. Confirm the control has an accessible name and the resize is
   one undo step.

Record browser, operating system, screen reader/version, and any wording that is
ambiguous or excessively repeated.

## Physical-device IME residual

With Gboard Hindi/Tamil, Safari Indic input, or a CJK candidate window, compose
immediately before and after the inline formula/image. Confirm text is neither
duplicated nor dropped and the atom remains present. This is a residual hardware
validation item; synthetic browser events already pass in all three engines.

## Media captions and tracks

Native audio/video controls and accessible player names are implemented.
Caption/track authoring and persistence are explicitly deferred; the Phase 7
schema does not pretend they are supported.

