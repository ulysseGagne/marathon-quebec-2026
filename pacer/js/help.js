// "How it works" and the race-day checklist, shown in the Help sheet. First: location,
// with the steps for the phone and browser in use (env from app.js).
export function helpHtml(version, env = {}) {
  return `${locationHtml(env)}
<h3>The number</h3>
<p><b>+3</b> = 3 seconds ahead of the ghost: time in the bank you can lose. <b>−3</b> = 3 seconds behind. <b>0</b> = right on it.
From 100 s it switches to minutes: −1:40.</p>
<p>It is measured where you are: your time on the clock minus the ghost's time at the same spot on the course.</p>
<p>A <b>~</b> and diagonal stripes mean no GPS (tunnel): the app is estimating from your pace over the last minute and resyncs a few seconds after the GPS returns.</p>
<p>Bottom row: time since the start, official km, and the <b>ghost's pace for the stretch you are on</b> (the pace to hold right now). Top right: how and when the clock started, to the second (<b>LIVE · CHIP 8:00:05</b>: it counts from your start-line crossing at 8:00:05; <b>START 8:00:03</b>: from your tap), and the projected finish = target + gap, in the accent colour once it is over 3:00:00.</p>

<h3>The ghost</h3>
<p>The ghost is the <b>white arrow</b>; you are the <b>yellow arrow</b>. The course is bright from the ghost on and thin behind it, so the ghost eats the line as it runs.
White arrow ahead of you: you are behind. White arrow behind you: you are ahead.</p>
<p><b>Where it starts:</b> the white bar across the road with START is the official start line, taken from the start-area map in the runner's guide (the app's km 0 is 1 m from it). The thin grey line behind it is the corral: it is there so the app can follow you up to the line. Kilometres count from the start line, and the ghost waits on it until the clock starts (at the gun, then your chip time), so it starts exactly where you cross. The white bar at the other end is the finish line.</p>
<p>The ghost runs the exact course at <b>even effort</b> and crosses the finish line exactly at your target (Settings). It slows up Côte Dinan and Rue des Remparts (km 11.4–13), gains on the descents towards the river, and runs about 4:10/km on the flat for 2:59:30.</p>
<p>Effort model: Minetti's energy cost of running uphill; real-world data for descents (you cannot run a descent as fast as the treadmill formula says, and trying wrecks your quads); a little air drag. Optional race-morning wind (Settings) moves time between the exposed river stretch and the sheltered upper town, same finish.</p>

<h3>Why it does not drift</h3>
<p>Watches add up the distance between GPS points, so their errors pile up (0.5 % is 200 m, ~50 s, by km 40). This app snaps every GPS point onto the course line and reads the official distance straight from it: the error stays around 5 m (≈1 s) the whole race.</p>
<p>The course is built on real street centrelines, with the start and finish lines from the official start-area map, and distance measured along the shortest legal line through the corners, as the certified measurement is (42,195 m).</p>

<h3>Wind</h3>
<p>Optional. Settings → “Use the forecast for race morning” reads the hourly forecast for Oct 4, 8:00–11:00 (Open-Meteo) and gives it to the ghost, which then eases into headwinds and uses tailwinds, same finish time. On race morning the start screen also looks once by itself and offers it on a chip (tap to use it). Without a connection nothing happens: still air is a fine plan.</p>

<h3>Starting</h3>
<p><b>START</b>: the clock starts when you tap. Tap as you cross the start mat.</p>
<p><b>LIVE</b> (recommended): nothing to time yourself.</p>
<ol>
<li>Around 7:45 in the corral, press LIVE (it works from 5:00). The number counts down to 8:00:00 (phone time) and so does the voice, to tell you it is working: “Start in 10 minutes”… every 5 minutes from half an hour before, every minute from 10, then 2 and a half, 2, a minute and a half, 1, 45, 30 and 15 seconds. <b>Check</b> (top left) shows everything at a glance.</li>
<li>At 8:00:00 the voice says “<b>Gun time: 8 a.m. exactly</b>” and the clock starts by itself (LIVE · GUN 8:00:00). It stays quiet about the gap until chip time takes over.</li>
<li>About 15 s after you run over the start line, the voice says your chip time to the second, “<b>Chip time: 8 a.m. and 40 seconds</b>”, and the label becomes LIVE · CHIP 8:00:40. From then on the exact moment of the gun no longer matters.</li>
</ol>
<p><b>How it finds your crossing:</b> not when you reach the line, but when you leave it for good. Standing at the line, GPS drift moves you back and forth across it by a few metres; that does not count. It counts once you are 60 m past the line, and takes the moment you crossed it on the way, from the GPS points on either side (one a second). If GPS had put you just past the line while you stood there, it takes the moment you started moving. It looks from 30 s before the gun, so leaving at 7:59:55 counts. In simulations of standing right at the line for 10 minutes, then starting, it was within 2 s every time (half a second typically). If it never sees a crossing, it stays on gun time: off by your few seconds to the line, on the safe side.</p>
<p>Pressed LIVE only after starting to run? It counts from the gun and says so, “Gun time: 8 a.m. exactly” (or the gun time set in Settings, if you moved it), and still finds your start-line crossing in the last 20 minutes if the app was open. Started later in the race, it stays on gun time. <b>START</b> says the time you tapped: “Start time: 8:03 a.m. and 12 seconds”.</p>
<p>Try it this week: <b>Practice → LIVE rehearsal</b> runs the same thing on your practice route, with the gun one minute after you press it (the voice says “Go!”) and a start line 30 m along the route.</p>
<p>Tapped START too early or too late? Hold the <b>gear</b> (bottom right) for 5 seconds, then hold “start the clock at your start-line crossing”. The label at the top right then says CHIP and the time you crossed, and the voice says it.</p>

<h3>Very hard to stop</h3>
<p>Nothing on the running screen reacts to a tap. Three things take a long hold, and while you hold, a fill slides across the whole screen with a countdown; let go early (or slide your finger) and nothing happens:</p>
<ul>
<li>the bottom row (the <b>gear</b>), <b>5 seconds</b>: the run settings;</li>
<li>the <b>map</b>, <b>5 seconds</b>: the map unlocks (below);</li>
<li><b>End run</b> in the run settings, <b>10 seconds</b>, in red.</li>
</ul>
<p>Every change in the run settings needs a 1-second hold. If the page reloads, crashes or gets swiped away, open it again: the run continues from the saved start time.</p>

<h3>Lost? Unlock the map</h3>
<p>Hold the map 5 seconds: it stops following you, lies flat with north up, and you can drag and pinch it to find your way; you are where the GPS says. The ◎ button (bottom right of the map) follows you again.</p>

<h3>Off course</h3>
<p>When you are clearly off the course (a wrong turn), the voice says “<b>Off course: 90 meters from the course</b>” (again past 100 m, 200 m, 500 m, 1 km), the number shows how far (“90 m”, OFF COURSE), and the map shows where the GPS has you, flat, with the course in view. There is no gap until you are back on it; then “<b>Back on course</b>”, and the gap is measured from where you rejoined. It only counts once you are more than 40 m from every part of the course (and well beyond the GPS's own error) for 12 seconds straight, and never around the tunnels: in the city a GPS point can land 20 to 50 m off for a few seconds, and that is not you. In simulated races with tunnels, stray points and a poorer GPS it never went off.</p>

<h3>Tunnel Joseph-Samson</h3>
<p>Km 10.7–11.3 and km 36.2–36.7: about 580 m each time without GPS. The number keeps going (with ~) and catches up after the exit.</p>

<h3>Voice</h3>
<p><b>When off pace</b> (default): warnings start 5 s from the ghost, either way, then come as the gap gets worse at 10, 15, 20, 25, 30, 45 seconds, 1 minute, 90 seconds, 2, 3, 4 and 5 minutes (nothing past 5 minutes), and as it gets better at the step below the last one: after “45 seconds behind”, “30”, then “25”, “20”… “5” as you come back. Right after a warning, it says “<b>on pace</b>” the moment you meet the ghost again, and only then: drifting 2 s off and back says nothing. The same ahead: “5 seconds ahead”… then “on pace” when the ghost catches you. A wobble around a step is not repeated. In simulated races with a runner who glances at the number and eases back, that is about one call every 10 minutes (a “5 seconds behind” and later its “on pace”), and you stay within 5 s about 90 % of the time. Settings → Voice → “Warn from 10 s” if you want it quieter.</p>
<p>Or <b>every</b> 250 m, 500 m, 1 km or 2 km of official distance: “3 seconds behind”, “1 second ahead” or “on pace”. Or off. Settings, or the run settings (hold the gear). In the tunnel it says “about…”.</p>
<p>In every mode but off it also says “<b>Take caffeinated bar</b>” or “<b>Take regular bar</b>” at your bars (1 km before an aid station), “<b>Water in 200 meters</b>” before every aid station (“<b>Gel in 200 meters</b>” at km 15.1 and 27), the gun, chip or start time to the second, and “off course” when you are. Nothing else.</p>
<p><b>With Apple Music</b>: the voice is the iPhone's own. The music gets quieter while it talks and comes back right after. It speaks with the side switch on silent too, and Do Not Disturb keeps calls quiet.</p>

<h3>Screen off, pocket mode</h3>
<p><b>Do not lock the phone</b> (side button) during the run: iOS freezes web apps while the phone is locked, so there is no GPS, no voice and no logic until you unlock it. Only a native app could keep running. When you unlock, the app catches up on its own and says the gap as soon as the GPS has you again (a few seconds; in “when off pace”, only if you are 5 s or more off, or “on pace” if you met the ghost after a warning). The app keeps the screen from locking by itself.</p>
<p>For a phone in a pocket or an armband, use <b>Pocket mode</b> (Settings, or the run settings): the screen goes black (black pixels on the iPhone screen use almost no power) and the map stops drawing, but GPS and the voice keep going. Tap the screen to look for 12 seconds. Whenever it goes black, the run settings close, so a touch in the pocket cannot change anything. If the voice was off, pocket mode speaks when off pace.</p>

<h3>Fuel: bars and gels</h3>
<p>The suggested plan (Settings → Fuel): one bar before the start, four on the course, and both race gels. A fuel stop every 21 to 29 minutes from km 4.8 to km 31.9.</p>
<ul>
<li><b>Before the start</b>, about 7:20 (30 to 45 min before the gun): <b>CAF</b>. Its caffeine peaks 45 to 60 minutes later, around the start, and lasts the whole race.</li>
<li><b>km 4.8</b> (0:20): <b>REG</b>. Water at 5.8.</li>
<li><b>km 10.1</b> (0:42): <b>REG</b>. Flat along the river, water at 11.1 (in the tunnel). The last food before the Côte Dinan climb (km 11.4 to 13): eaten on the flat, and it arrives as energy on the climb.</li>
<li><b>km 15.1</b> (1:05): the race's gel.</li>
<li><b>km 21.9</b> (1:34): <b>CAF</b>. A gentle downhill (−3.9 %, easy breathing), water at 22.9. Its caffeine works from about km 30 to the finish.</li>
<li><b>km 27</b> (1:55): the race's gel.</li>
<li><b>km 31.9</b> (2:16): <b>CAF</b>, for the last 10 km. Flat on Boulevard Champlain, water at 32.9. Nothing after it: food that late has little time left to help.</li>
</ul>
<p>How much: an XACT bar is 30 g with 25 g of carbs (100 kcal); the Performance ones (CAF) add 50 mg of caffeine from guarana. The race's gels are counted as ~25 g each (Krono gels are 24 to 30 g). In the race that is 4 bars + 2 gels ≈ 150 g of carbs, about 50 g an hour, plus 25 g before the start. Guidelines allow up to 90 g an hour for efforts over 2.5 hours, but with gels and drinks and a trained gut; a chewy bar takes 2 minutes to eat at 4:15/km, and each extra one is one more chance for a sore stomach. So 5 of your 6 bars: 3 CAF and 2 REG (CAF = caffeinated, the Performance ones; REG = regular); the sixth, a REG, is a spare (a missed gel, a bad patch).</p>
<p>Caffeine: 3 × 50 = 150 mg, about 2.4 mg per kg at 63.5 kg. The usual range is 3 to 6 mg/kg, but the smallest dose that helps may be as low as 2 mg/kg, and small doses taken late in a long effort have helped in studies. A usual cup of coffee at breakfast is fine on top. If the gels handed out are caffeinated too (Krono citrus 50 mg, maple-coffee 25 mg), swap the km 31.9 CAF for the spare REG. Try a CAF bar on a long run before race day.</p>
<p>When: each bar is announced exactly <b>1 km before an aid station</b>: about 2 minutes to eat it, 2 more to put things away and get ready, then “Water in 200 meters”, so your hands are free and your head is on the station when you get there. The spots are on flat ground or a gentle downhill, never uphill or in a tunnel, and not right before a gel station. On the map, bars are small <b>CAF</b> (caffeinated) and <b>REG</b> (regular) labels (the one before the start is at the start line); under the number “CAF bar in 240 m”, then “CAF bar now”, then “Water in 180 m”. Settings checks any spot you type the same way (the station 1 km on, slope, tunnel) and adds up carbs and caffeine.</p>

<h3>Aid stations</h3>
<p>km 3.2 (water only) · 5.8 · 8.4 · 11.1 · 12.6 · <b>15.1 gels</b> · 19.3 · 22.9 · 24.7 sponges · <b>27 gels</b> · 28.9 · 32.9 · 36.3 · 37.4 oranges · 40.6. Water and Krono electrolytes at every station but the first, toilets at all of them (runner's guide). The voice announces each one 200 m before it: “Water in 200 meters”, or “Gel in 200 meters” at km 15.1 and 27 (when the gels are in your plan). On the map they are small circles with a drop, like the km markers, marked “gels”, “sponges” or “oranges” when they have them; also listed in Settings and in the Splits.</p>

<h3>Colours</h3>
<p>Settings → Colours. <b>B&amp;W</b> (default): white on black with one yellow accent, your arrow; the most contrast in sunlight. <b>Amber</b>: everything in one warm yellow. On the map, in both: round badges with a number are the kilometres, round badges with a drop are aid stations, CAF and REG labels are your bars.</p>

<h3>Practice this week</h3>
<ol>
<li><b>Practice</b> has two routes, one way each: <b>Sommet → DKN</b> (Sommet 3V, 937 avenue Roland-Beaudin, to Pavillon Charles-De Koninck) and <b>DKN → Sommet</b>, 2.8 km on the streets. Standing at one end picks the route that starts there; it says so if you are far from the start. Choose the ghost's average pace.</li>
<li>Same screen and same ghost logic as race day, including even effort on the hills.</li>
<li><b>Free run</b> works anywhere without a route (distance from GPS, so it drifts like a normal app — it is only for trying the display).</li>
</ol>

<h3>Race-day checklist</h3>
<p><b>Night before</b></p>
<ol>
<li>Charge to 100 %. Open the app once on Wi-Fi: the chip must say <b>Works offline</b>. The first time, “Before you start” asks for <b>Location</b> (needed) and the <b>Compass</b> (optional): tap each, then Allow.</li>
<li>Settings: check your target, your <b>fuel plan</b>, and tap a Voice button to hear it with Apple Music playing. Pack the bars in the order you eat them: REG, REG, CAF, CAF (and the spare REG).</li>
<li>Safari → Share → <b>Add to Home Screen</b>, and start it from there (full screen).</li>
<li>Settings → Privacy &amp; Security → Location Services: on; Safari Websites (and the Pacer icon if listed) → While Using, <b>Precise Location on</b>.</li>
<li>Settings → Display &amp; Brightness → <b>Auto-Lock → Never</b> for the morning (the app also keeps the screen on). Do not press the side button during the run: locking pauses the app.</li>
<li>Optional, strongest: Settings → Accessibility → <b>Guided Access</b> on with a passcode. Triple-click the side button in the app to lock the phone into it; in Options you can turn off the side button and touch.</li>
<li>Look at the Splits: where the ghost slows, where your bars are.</li>
</ol>
<p><b>Race morning</b></p>
<ol>
<li>Keep the phone warm inside your clothes: cold drains old batteries fast.</li>
<li><b>Do Not Disturb</b> (or Airplane mode — GPS keeps working) so no call or notification covers the screen.</li>
<li>About 7:20: the pre-start bar (CAF), with a few sips of water. The start screen reminds you.</li>
<li>Open the app in the corral 10 minutes early to get a GPS lock (chip ±5 m).</li>
<li>Wind: tap the “Forecast wind” chip if it shows (or Settings → Use the forecast). Brightness up.</li>
<li>Around 7:45: press <b>LIVE</b>, then tap <b>Pre-race check</b> (top left): everything should have a ✓. Listen for the countdown. Guided Access if you use it.</li>
</ol>
<p><b>After the finish</b>: the finish time pops up with Export GPX (Strava, etc.). Later: hold the gear 5 s → Export GPX.</p>

<h3>Limits</h3>
<p>The official course PDF could not be downloaded while this was built. The course was rebuilt from the earlier trace (checked against the official 2026 map) snapped onto real streets; its shortest-route length came out within 0.2 % of the certified 42,195 m, and the start and finish lines come from the official start-area map. The physical km signs may be a few tens of metres off from the app: trust the app. Elevation comes from ~20 m terrain models, so small bumps are approximate.</p>
<p class="muted small">Version ${version}. Map data © OpenStreetMap contributors and Overture Maps Foundation; terrain from AWS Terrain Tiles (CDEM).</p>
`;
}

// env: {status: 'ok' | 'blocked' | 'nosignal' | 'waiting', acc, ios, chrome, firefox, android,
// standalone}. When location works this is one line and a closed "if it gets blocked";
// when it is blocked, the steps for this phone and browser come first, open.
const IPHONE_BASE = `<li>Settings → Privacy &amp; Security → <b>Location Services</b>: on.</li>`;
const STEPS = {
  iosApp: `<p>On this iPhone, in the app from your Home Screen:</p><ol>
${IPHONE_BASE}
<li>Same screen, scroll down to <b>Safari Websites</b>: <b>While Using the App</b>, and <b>Precise Location</b> on. If <b>Pacer</b> is in that list too, set it the same way.</li>
<li>Settings → Apps → Safari → <b>Location</b> (under Settings for Websites): <b>Ask</b> or <b>Allow</b>, not Deny. If this site (ulyssegagne.github.io) is listed there as Deny, change it.</li>
<li>Come back here and tap <b>Try again</b> (the app also tries by itself when you come back). Choose <b>Allow</b> if it asks.</li>
<li>Still blocked: close the app completely (swipe it up in the app switcher) and open it again.</li>
<li>Still blocked here but fine in Safari: some iOS versions block location in Home Screen apps. Open the same address in Safari and use it from there on race day: everything works the same.</li>
</ol>`,
  iosSafari: `<p>On this iPhone, in Safari:</p><ol>
${IPHONE_BASE}
<li>Same screen, scroll down to <b>Safari Websites</b>: <b>While Using the App</b>, and <b>Precise Location</b> on.</li>
<li>Back in Safari, on this page: tap the page menu in the address bar (<b>aA</b>, or the icon at the left of the address) → <b>Website Settings</b> → <b>Location</b> → <b>Allow</b>.</li>
<li>Settings → Apps → Safari → <b>Location</b> (under Settings for Websites): <b>Ask</b> or <b>Allow</b>, not Deny.</li>
<li>Reload the page, or tap <b>Try again</b>. Choose <b>Allow</b> if it asks.</li>
</ol>`,
  iosChrome: `<p>On this iPhone, in Chrome:</p><ol>
${IPHONE_BASE}
<li>Settings → Apps → <b>Chrome</b> → <b>Location</b>: <b>While Using the App</b>, and <b>Precise Location</b> on.</li>
<li>In Chrome, tap the icon at the left of the address → site settings or permissions → <b>Location</b>: allow.</li>
<li>Reload the page, or tap <b>Try again</b>.</li>
</ol>`,
  android: `<p>On Android:</p><ol>
<li>Phone Settings → <b>Location</b>: on.</li>
<li>In Chrome, tap the icon at the left of the address → <b>Permissions</b> → <b>Location</b> → <b>Allow</b> (or <b>Reset permissions</b>), then reload.</li>
<li>From a Home Screen icon: long-press it → <b>App info</b> → Permissions → <b>Location</b> → Allow, Precise on.</li>
<li>Settings → Apps → Chrome → Permissions → Location: <b>Allow only while using the app</b>.</li>
</ol>`,
  computer: `<p>On a computer:</p><ol>
<li>Chrome or Edge: click the icon at the left of the address → Site settings → <b>Location</b> → Allow, then reload.</li>
<li>Safari on a Mac: Safari → Settings → Websites → <b>Location</b> → this site: Allow. Also System Settings → Privacy &amp; Security → Location Services: Safari on.</li>
<li>Firefox: click the icon at the left of the address, remove the blocked location permission, reload.</li>
</ol>`,
};
const LAST_RESORT = `<p><b>Last resort</b>, if it never asks again (iPhone): Settings → Apps → Safari → Advanced → Website Data → search “github” → delete <b>ulyssegagne.github.io</b>. This also clears this app's settings (target, fuel plan) and its offline copy: do it at home on Wi-Fi, never on race morning. Then open the address in Safari, allow location, and add it to the Home Screen again.</p>`;

function locationHtml(env) {
  const mine = env.ios ? (env.chrome || env.firefox ? 'iosChrome' : env.standalone ? 'iosApp' : 'iosSafari')
    : env.android ? 'android' : 'computer';
  const others = ['iosApp', 'iosSafari', 'iosChrome', 'android', 'computer'].filter((k) => k !== mine).map((k) => STEPS[k]).join('');
  const blocked = env.status === 'blocked';
  const status = {
    ok: `Location is on${env.acc ? ` · GPS ±${Math.round(env.acc)} m` : ''}.`,
    blocked: 'Location is <b>blocked</b> for this app. The steps below turn it back on.',
    nosignal: 'Location is allowed, but there is no GPS signal right now: step outside, away from tall buildings.',
    waiting: 'Waiting for the first GPS position…',
  }[env.status] || 'Waiting for the first GPS position…';
  const steps = `${STEPS[mine]}${LAST_RESORT}<details class="more"><summary>Other phones and browsers</summary>${others}</details>`;
  return `
<h3>Location</h3>
<p class="loc-status ${blocked ? 'bad' : env.status === 'ok' ? 'ok' : ''}">${status}</p>
${blocked || env.status !== 'ok' ? `<button type="button" class="wide" id="loc-retry">Try again</button>` : ''}
${blocked ? steps : `<details class="more"><summary>If location ever gets blocked</summary>${steps}</details>`}`;
}
