// The practice route, as drawn by hand: DKN to Sommet 3V (Sommet 3V to DKN is the same
// line reversed). Takes any GPX of that run (gpx.studio, Strava, Garmin) and writes
// pacer/data/practice-route.gpx: the track only, one point per position, 6 decimals.
// Usage: node pacer/tools/practice_route.mjs DKN-to-Sommet.gpx
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(process.argv[2], 'utf8');
const trk = src.slice(src.indexOf('<trk'));
const pts = [];
for (const m of trk.matchAll(/<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"/g)) {
  const p = [(+m[1]).toFixed(6), (+m[2]).toFixed(6)];
  const q = pts[pts.length - 1];
  if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p);
}
if (pts.length < 2) throw new Error('no track points');
const out = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Virtual Pacer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>DKN → Sommet 3V</name><desc>The practice route, drawn by hand. Sommet 3V → DKN is the same line reversed.</desc></metadata>
  <trk><name>DKN → Sommet 3V</name>
    <trkseg>
${pts.map(([la, lo]) => `      <trkpt lat="${la}" lon="${lo}"/>`).join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
const dest = fileURLToPath(new URL('../data/practice-route.gpx', import.meta.url));
writeFileSync(dest, out);
console.log(`${dest}: ${pts.length} points`);
