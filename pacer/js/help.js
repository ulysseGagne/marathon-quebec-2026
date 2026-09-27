// "How it works" and the race-day checklist, shown in the Help sheet.
export function helpHtml(version) {
  return `
<h3>The number</h3>
<p><b>+3</b> = 3 seconds ahead of the ghost: time in the bank you can lose. <b>−3</b> = 3 seconds behind. <b>0</b> = right on it.
From 100 s it switches to minutes: −1:40.</p>
<p>It is measured where you are: your time on the clock minus the ghost's time at the same spot on the course.</p>
<p>A <b>~</b> and diagonal stripes mean no GPS (tunnel): the app is estimating from your pace over the last minute and resyncs a few seconds after the GPS returns.</p>
<p>Bottom row: time since the start, official km, and the <b>ghost's pace for the stretch you are on</b> (the pace to hold right now). Top right: projected finish = target + gap, in the accent colour once it is over 3:00:00.</p>

<h3>The ghost</h3>
<p>The ghost is the <b>white arrow</b>; you are the <b>yellow arrow</b>. The course is bright from the ghost on and thin behind it, so the ghost eats the line as it runs.
White arrow ahead of you: you are behind. White arrow behind you: you are ahead.</p>
<p>The ghost runs the exact course at <b>even effort</b> and crosses the finish line exactly at your target (Settings). It slows up Côte Dinan and Rue des Remparts (km 11.4–13), gains on the descents towards the river, and runs about 4:10/km on the flat for 2:59:30.</p>
<p>Effort model: Minetti's energy cost of running uphill; real-world data for descents (you cannot run a descent as fast as the treadmill formula says, and trying wrecks your quads); a little air drag. Optional race-morning wind (Settings) moves time between the exposed river stretch and the sheltered upper town, same finish.</p>

<h3>Why it does not drift</h3>
<p>Watches add up the distance between GPS points, so their errors pile up (0.5 % is 200 m, ~50 s, by km 40). This app snaps every GPS point onto the course line and reads the official distance straight from it: the error stays around 5 m (≈1 s) the whole race.</p>
<p>The course is built on real street centrelines, with the start and finish lines from the official start-area map, and distance measured along the shortest legal line through the corners, as the certified measurement is (42,195 m).</p>

<h3>Starting</h3>
<p><b>START</b>: the clock starts when you tap. Tap as you cross the start mat.</p>
<p><b>LIVE</b> (recommended): nothing to time yourself.</p>
<ol>
<li>From 5:00 on race morning, press LIVE in the corral. The number counts down to 8:00:00 (phone time).</li>
<li>At 8:00:00 the clock starts by itself (LIVE · GUN). The line under the number counts down the metres to the start line.</li>
<li>As you run over the start line, the app switches to your chip time by itself (LIVE · CHIP) and the voice says “Chip time”. From then on the exact moment of the gun no longer matters: a gun a few seconds early or late is corrected at the line.</li>
</ol>
<p>Pressed LIVE only after starting to run? It still counts from 8:00:00 and finds your start-line crossing in the last 20 minutes if the app was open.</p>
<p>Try it this week: <b>Practice → LIVE rehearsal</b> runs the same thing on your practice route, with the gun one minute after you press it (the voice says “Go!”) and a start line 30 m ahead of where you stand.</p>
<p>Tapped START too early or too late? Hold <b>•••</b> (bottom right) for 5 seconds, then hold “start the clock at your start-line crossing”.</p>

<h3>Very hard to stop</h3>
<p>Nothing on the running screen reacts to a tap. Hold the bottom row (<b>•••</b>) for <b>5 seconds</b> to open the run menu: a bar fills across the row and the line above counts down; let go early and nothing happens. Every change in the menu needs a 1-second hold, and stopping needs a 5-second hold. If the page reloads, crashes or gets swiped away, open it again: the run continues from the saved start time.</p>

<h3>Tunnel Joseph-Samson</h3>
<p>Km 10.7–11.3 and km 36.2–36.7: about 580 m each time without GPS. The number keeps going (with ~) and catches up after the exit.</p>

<h3>Voice</h3>
<p>Every 250 m, 500 m, 1 km (default) or 2 km of official distance, your choice in Settings or the run menu: “3 seconds behind”, “1 second ahead” or “on pace”; in the tunnel, “about 3 seconds behind”; “time for a bar” at your bars; “chip time” at the start line in LIVE. Nothing else.</p>
<p><b>With Apple Music</b>: by default a recorded voice talks over your music, which keeps playing. That needs the <b>side switch on ring</b> (no orange showing): on silent, iOS mutes this voice. Do Not Disturb keeps calls quiet. The other choice (Settings) is the iPhone's own voice, which works on silent but pauses Apple Music while it talks, and the music may not restart.</p>

<h3>Screen off, pocket mode</h3>
<p><b>Do not lock the phone</b> (side button) during the run: iOS freezes web apps while the phone is locked, so there is no GPS, no voice and no logic until you unlock it. Only a native app could keep running. When you unlock, the app catches up on its own and says the gap as soon as the GPS has you again (a few seconds). The app keeps the screen from locking by itself.</p>
<p>For a phone in a pocket or an armband, use <b>Pocket mode</b> (Settings, or the run menu): the screen goes black (black pixels on the iPhone screen use almost no power) and the map stops drawing, but GPS and the voice keep going. Tap the screen to look for 12 seconds. If the voice was off, pocket mode speaks every 1 km.</p>

<h3>Bars</h3>
<p>Settings → Bars: the official km where you want to eat a bar (for example 8.1, 14.8, 24.4, 32.6). Each shows on the map as a green BAR label; the line under the number counts down the last 300 m (“Bar in 240 m”), and the voice says “Time for a bar” as you pass it. They are also in the Splits. The race hands out Krono gels at km 15.1 and 27, oranges at 37.4 and water everywhere, so a bar just before an aid station can be washed down.</p>

<h3>Colours</h3>
<p>Settings → Colours. <b>B&amp;W</b> (default): white on black with one yellow accent, your arrow; the most contrast in sunlight. <b>Amber</b> and <b>Ice</b>: everything in one colour. <b>Signal</b>: the number panel and the line ahead turn red when behind, green when ahead. On the map, in every theme: white drops are aid stations (with “gels”, “sponges” or “oranges” when they have them), round badges are the kilometres, BAR labels are your bars.</p>

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
<li>Settings: check your target, your <b>bars</b>, and tap a Voice button to hear it with Apple Music playing.</li>
<li>Safari → Share → <b>Add to Home Screen</b>, and start it from there (full screen).</li>
<li>Settings → Privacy &amp; Security → Location Services: on; Safari Websites (and the Pacer icon if listed) → While Using, <b>Precise Location on</b>.</li>
<li>Settings → Display &amp; Brightness → <b>Auto-Lock → Never</b> for the morning (the app also keeps the screen on). Do not press the side button during the run: locking pauses the app.</li>
<li>Optional, strongest: Settings → Accessibility → <b>Guided Access</b> on with a passcode. Triple-click the side button in the app to lock the phone into it; in Options you can turn off the side button and touch.</li>
<li>Look at the Splits: where the ghost slows, where your bars are.</li>
</ol>
<p><b>Race morning</b></p>
<ol>
<li>Keep the phone warm inside your clothes: cold drains old batteries fast.</li>
<li><b>Do Not Disturb</b> (or Airplane mode — GPS keeps working) so no call or notification covers the screen. <b>Side switch on ring</b>, so the voice can talk over your music.</li>
<li>Open the app in the corral 10 minutes early to get a GPS lock (chip ±5 m).</li>
<li>Optional: wind forecast in Settings. Brightness up.</li>
<li>Press LIVE in the corral (or START as you cross the mat). Guided Access if you use it.</li>
</ol>
<p><b>After the finish</b>: the finish time pops up with Export GPX (Strava, etc.). Later: hold ••• 5 s → Export GPX.</p>

<h3>Limits</h3>
<p>The official course PDF could not be downloaded while this was built. The course was rebuilt from the earlier trace (checked against the official 2026 map) snapped onto real streets; its shortest-route length came out within 0.2 % of the certified 42,195 m, and the start and finish lines come from the official start-area map. The physical km signs may be a few tens of metres off from the app: trust the app. Elevation comes from ~20 m terrain models, so small bumps are approximate.</p>
<p class="muted small">Version ${version}. Map data © OpenStreetMap contributors and Overture Maps Foundation; terrain from AWS Terrain Tiles (CDEM).</p>
`;
}
