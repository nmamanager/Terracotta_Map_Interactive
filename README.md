# Terracotta_Map_Interactive

Source for the Qin Mausoleum map interactive in the Terracotta Warriors exhibition, 2026–27.

A 3D-printed map of the mausoleum sits under a projector, with three touch screens around it. A visitor picks a place on a touch screen. The screen shows text and images about it. The projector draws a glowing line from that screen's edge to the place on the map, and the place glows. Cloud shadows drift across the map the whole time.

The content, line artwork, base map, and cloud video come from the Western Australian Museum's version of this exhibit. NMA rebuilt the applications.

## What runs where

Four Windows PCs share one network.

| PC | Runs | Opens |
| --- | --- | --- |
| Projector PC | `server/hub.mjs` (Node.js) and Chrome in kiosk mode | `http://localhost:8080/projector/` |
| Touch PC 1 (north side) | Chrome in kiosk mode | `app/touch/index.html?screen=1&hub=<projector IP>:8080` |
| Touch PC 2 (east side) | Chrome in kiosk mode | `...?screen=2...` |
| Touch PC 3 (west side) | Chrome in kiosk mode | `...?screen=3...` |

The hub keeps one record: which place each touch screen is showing. The touch screens send changes to the hub. The hub sends the whole record to the projector every time it changes, so a restart on any PC puts the map back into the right state.

## Try it on one PC

1. Install Node.js LTS: `winget install OpenJS.NodeJS.LTS`.
2. Double-click `start_test.bat`.

Your browser opens a test page with the projector and all three touch screens side by side. See [docs/TESTING.md](docs/TESTING.md) for testing on a single touch screen and for the automated checks.

## Folders

| Path | Contents |
| --- | --- |
| `app/touch/` | The touch screen app |
| `app/projector/` | The projector app and the install-day calibration mode (`calibrate.js`) |
| `app/dev/` | The four-pane test page |
| `app/shared/` | Generated content (`content.js`), the hub client, the kiosk guard, and fonts |
| `app/assets/` | Generated images, icons, minimaps, base map, and cloud video. Do not edit these. |
| `content/` | NMA-made source assets, such as the Canberra size comparison |
| `server/` | The hub and its tests |
| `config/` | `layout.json`, written by calibration on the projector PC |
| `kiosk/` | Windows install, lockdown, and startup scripts |
| `tools/` | The asset importer, the Canberra overlay generator, and the end-to-end verify script |
| `docs/` | Install, testing, and content guides, plus the build decision log |

## Guides

- [Install the exhibit on the four PCs](docs/INSTALL.md)
- [Test the exhibit](docs/TESTING.md)
- [Change text, images, or the Canberra comparison](docs/CONTENT.md)
- [Build decision log](docs/decisions.tsv)
