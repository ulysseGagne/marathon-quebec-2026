// "How it works" and the race-day checklist, shown in the Help sheet.
export function helpHtml(version) {
  return `
<h3>The number</h3>
<p><b>Red</b> = seconds behind the ghost. <b>Green</b> = seconds ahead. <b>0</b> on black = right on it.
It is measured where you are: your time on the clock minus the ghost's time at the same spot on the course.</p>
<p>A <b>~</b> and diagonal stripes mean no GPS (tunnel): the app is estimating from your pace over the last minute and resyncs a few seconds after the GPS returns.</p>
<p>Bottom row: time since the start, official km, and the <b>ghost's pace for the stretch you are on</b> (the pace to hold right now). Top right: projected finish = target + gap; magenta while it is under 3:00:00.</p>

<h3>The ghost</h3>
<p>The magenta dot runs the exact course at <b>even effort</b> and crosses the finish line exactly at your target (Settings). It slows up Côte Dinan and Rue des Remparts (km 11.4–13), gains on the descents towards the river, and runs about 4:10/km on the flat for 2:59:30.</p>
<p>Effort model: Minetti's energy cost of running uphill; real-world data for descents (you cannot run a descent as fast as the treadmill formula says, and trying wrecks your quads); a little air drag. Optional race-morning wind (Settings) moves time between the exposed river stretch and the sheltered upper town, same finish.</p>

<h3>Why it does not drift</h3>
<p>Watches add up the distance between GPS points, so their errors pile up (0.5 % is 200 m, ~50 s, by km 40). This app snaps every GPS point onto the course line and reads the official distance straight from it: the error stays around 5 m (≈1 s) the whole race.</p>
<p>The course is built on real street centrelines, with the start and finish lines from the official start-area map, and distance measured along the shortest legal line through the corners, as the certified measurement is (42,195 m).</p>

<h3>Starting</h3>
<ul>
<li><b>START</b>: the clock starts when you tap. Tap as you cross the start mat.</li>
<li><b>LIVE</b>: the clock follows the 8:00:00 gun. When the app sees you cross the start line it switches to your chip time on its own (LIVE · CHIP).</li>
<li>Forgot to tap? Press LIVE any time on race morning.</li>
<li>Tapped START too early or too late? Hold <b>•••</b> (bottom right) for a second, then hold “start the clock at your start-line crossing”.</li>
</ul>

<h3>Very hard to stop</h3>
<p>Nothing on the running screen reacts to a tap. Holding <b>•••</b> for a second opens the run menu; every change there needs a 1-second hold, and stopping needs a 5-second hold. If the page reloads, crashes or gets swiped away, open it again: the run continues from the saved start time.</p>

<h3>Tunnel Joseph-Samson</h3>
<p>Km 10.7–11.3 and km 36.2–36.7: about 580 m each time without GPS. The number keeps going (with ~) and catches up after the exit.</p>

<h3>Voice</h3>
<p>At every official kilometre: “3 behind”, “10 ahead” or “on pace”. Nothing else. Switch it off in Settings or in the run menu. iOS may mute it when the phone is on silent: check on a practice run.</p>

<h3>Practice this week</h3>
<ol>
<li><b>Practice</b> builds a route from where you stand to Pavillon Charles-De Koninck (DKN), or to any point you tap on the map. Choose there and back or one way, and the ghost's average pace.</li>
<li>Same screen and same ghost logic as race day, including even effort on the hills.</li>
<li><b>Free run</b> works anywhere without a route (distance from GPS, so it drifts like a normal app — it is only for trying the display).</li>
</ol>

<h3>Race-day checklist</h3>
<p><b>Night before</b></p>
<ol>
<li>Charge to 100 %. Open the app once on Wi-Fi: the chip must say <b>Works offline</b>.</li>
<li>Safari → Share → <b>Add to Home Screen</b>, and start it from there (full screen).</li>
<li>Settings → Privacy &amp; Security → Location Services: on; Safari Websites (and the Pacer icon if listed) → While Using, <b>Precise Location on</b>.</li>
<li>Settings → Display &amp; Brightness → <b>Auto-Lock → Never</b> for the morning (the app also keeps the screen on).</li>
<li>Optional, strongest: Settings → Accessibility → <b>Guided Access</b> on with a passcode. Triple-click the side button in the app to lock the phone into it; in Options you can turn off the side button and touch.</li>
<li>Check your target in Settings and look at the Splits.</li>
</ol>
<p><b>Race morning</b></p>
<ol>
<li>Keep the phone warm inside your clothes: cold drains old batteries fast.</li>
<li><b>Do Not Disturb</b> (or Airplane mode — GPS keeps working) so no call or notification covers the screen.</li>
<li>Open the app in the corral 10 minutes early to get a GPS lock (chip ±5 m).</li>
<li>Optional: wind forecast in Settings. Brightness up.</li>
<li>START as you cross the mat (or LIVE before the gun). Guided Access if you use it.</li>
</ol>
<p><b>After the finish</b>: the finish time pops up. Hold ••• → Export GPX to keep your run (Strava, etc.).</p>

<h3>Limits</h3>
<p>The official course PDF could not be downloaded while this was built. The course was rebuilt from the earlier trace (checked against the official 2026 map) snapped onto real streets; its shortest-route length came out within 0.2 % of the certified 42,195 m, and the start and finish lines come from the official start-area map. The physical km signs may be a few tens of metres off from the app: trust the app. Elevation comes from ~20 m terrain models, so small bumps are approximate.</p>
<p class="muted small">Version ${version}. Map data © OpenStreetMap contributors and Overture Maps Foundation; terrain from AWS Terrain Tiles (CDEM).</p>
`;
}
