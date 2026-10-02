# Marathon Beneva de Québec 2026

Sunday, October 4, 2026 · Ulysse on the 42,2 km, Indiana on the 21,1 km.

## Pages

| Page | Link | What it is |
|---|---|---|
| **Map** | <https://ulyssegagne.github.io/marathon-quebec-2026/map/> | *Où seront Ulysse et Indiana?* Where both runners will be through race day, from their race plans: tap the course to see when they pass, with km markers and àVélo bike stations (in French). Source: [`map/index.html`](map/index.html). |
| **Virtual Pacer** | <https://ulyssegagne.github.io/marathon-quebec-2026/pacer/> | Phone app for the marathon: seconds ahead of or behind an even-effort run to the target, on screen and by voice; works offline. Source and docs: [`pacer/`](pacer/README.md). |

The root address, <https://ulyssegagne.github.io/marathon-quebec-2026/>, is a small page linking to both ([`index.html`](index.html)).

Ulysse's course and times on the map come from the Virtual Pacer (its course line and its even-effort plan); after a change to the pacer's course or default target, `node map/tools/sync_pacer.mjs` brings the map up to date.

Both are served by GitHub Pages from `main` (root folder); every push to `main` redeploys them.

## Also here

- [`Marathon Québec 2026.md`](<Marathon Québec 2026.md>): race-day plan (bib pickup, timing, corrals, logistics).
- [`42km.gpx`](42km.gpx), [`21km.gpx`](21km.gpx): the two courses.
- [`guide-coureur.pdf`](guide-coureur.pdf): the official runner's guide.
