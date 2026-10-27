# Codex Yard identity

The Y is a junction: two streams of work meet in one shared workspace. Its two arms remain legible at favicon size.

| Color | Use |
| --- | --- |
| `#193B65` | App tile and wordmark |
| `#F4F8FF` | Main path on the tile |
| `#85B5FF` | Joining path on the tile |
| `#3579ED` | Joining path on a light surface |

`icon.svg` is the editable app icon. `mark.svg` is the transparent mark for light backgrounds; `wordmark.svg` is the horizontal lockup. Keep at least one stem-width of space around the mark. Use the app tile at small sizes or on dark surfaces.

The browser uses the SVG favicon and PNG icons at 192 and 512 pixels. The 180-pixel Apple touch icon and the 512-pixel maskable icon use a square background, so the OS applies its own shape. Their artwork fits inside the central maskable safe area. The UI retains its existing fonts; the standalone wordmark uses DejaVu Sans with a sans-serif fallback.

PNG exports were rendered from `icon.svg` with `@resvg/resvg-js` 2.6.2. For Apple/maskable exports, set the background rectangle's `rx` to `0`; keep the 64 × 64 viewBox and scale to the named pixel size. No font or third-party logo is embedded in the app icons.
