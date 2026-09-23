# Change text, images, or the Canberra comparison

All content reaches the apps through one generated file, `app/shared/content.js`. `tools/import-assets.mjs` builds it, together with everything in `app/assets/`. Change the inputs and rerun the importer. Do not edit `content.js` or `app/assets/` by hand, because the next import overwrites them.

## Where the content comes from

| Content | Source |
| --- | --- |
| Place titles, text, image order, and credits | WAM's saved web page, inside `Website.zip` |
| Full-size images, icons, and minimaps | `Website.zip` |
| Line and glow artwork | `svgs/mainmap/5693x-<place>-connector.svg` and `-glow.svg` |
| Line positions on the projector | WAM's `style.css` inside `Website.zip`, rebuilt onto WAM's 1920 × 1200 projector frame |
| Projector base map | `mausoleum_lit_filledkiosks_darklinesV1.png` |
| Cloud shadows | `mausoleum_cloudshadow_5mloop_slowfade.webm` |
| Canberra size comparison | `content/size/canberra-comparison.png`, made by `tools/make-canberra-overlay.mjs` |
| Screen assignment, zone names, and the size card text | The `SCREENS` and `SIZE_CARD` constants at the top of `tools/import-assets.mjs` |

The WAM source files live in the folder passed to the importer. The default is `C:\Users\Digital PC\Documents\TW Map Interactive files`.

## Rebuild the content

```
node tools/import-assets.mjs "<folder with WAM's files>"
```

The importer stops with an error if a file is missing. It also stops if a line's glow artwork no longer matches the end of its line, or if a place's text differs from WAM's `Text.txt`. Then run `npm run verify` and check the screenshots in `artifacts/`.

## Change a place's text

1. Edit the text in WAM's saved page, or replace the entity's `<h1>` and `<p>` in the extracted HTML and zip it again.
2. Update the matching `Text.txt` in `OneDrive_*.zip`, because the importer checks that the two agree. To change text on purpose without WAM's copy, remove that place from `ONEDRIVE_FOLDERS` in `tools/import-assets.mjs`.
3. Rebuild the content.

## Change the zone names or move a place to another screen

Edit `SCREENS` in `tools/import-assets.mjs` and rebuild. Each screen shows up to four places. A place's line always starts from the screen that WAM drew it for. If you move a place to another screen, its line still starts at its original edge until you redraw its connector SVG.

## Regenerate the Canberra comparison

```
node tools/make-canberra-overlay.mjs
node tools/import-assets.mjs
```

The generator downloads 25 OpenStreetMap tiles once, into `.cache/osm/`, and draws the mausoleum plan over them at true scale, north up, with Qin Shihuang's pyramid over Parliament House. Change `PARLIAMENT_HOUSE` in the script to centre the pyramid somewhere else.

The plan comes from WAM's site minimap (`minimap_pyramid.png`). Its scale comes from the outer wall: 334 pixels on the minimap for 2,165 metres north to south. As a check, the outer wall's east–west width then measures about 920 metres, close to the 940 metres in the commonly quoted 2,165 × 940 m outer-wall figure. The Terracotta Army pits land about 1.56 km east of the pyramid, against about 1.5 km in the place text.

A 2,165 × 940 m wall has a perimeter of 6.2 km. The "Mausoleum of the First Qin Emperor" article on English Wikipedia gives the outer wall's circumference as 6.3 km, and puts the Terracotta Army about 1.5 km east of the tomb mound. Ask the curators to confirm the 2,165 m figure before the exhibition opens, because the whole comparison's scale rests on it. The size card text and the Parliament House placement are NMA choices and also need curator sign-off.

The image caption credits OpenStreetMap, as its licence requires: "Canberra map data © OpenStreetMap contributors (openstreetmap.org/copyright)".

## Change the fonts

Headings use Cinzel. Body text uses Source Sans 3, because Cinzel has only capital letterforms and is hard to read in paragraphs. Both are open-licence fonts in `app/shared/fonts/`, and the `@font-face` rules at the top of `app/touch/touch.css` load them. To use other fonts, replace the `.woff2` files and update those rules. To set body text in Cinzel as well, change `--body` in `touch.css` to `var(--heading)`.
