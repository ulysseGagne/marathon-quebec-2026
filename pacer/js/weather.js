// Race-morning wind from the Open-Meteo forecast (free, no key, open to web pages).
// Fetched only when asked (Settings) or once on race morning to suggest it; the pacer never
// depends on it and never checks again during the run.

const API = 'https://api.open-meteo.com/v1/forecast';

// date: 'YYYY-MM-DD' in Québec time.
export function forecastUrl(lat, lon, date) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kmh', timezone: 'America/Toronto', start_date: date, end_date: date,
  });
  return `${API}?${q}`;
}

/**
 * Average wind over the race hours (local time, both ends included) from an Open-Meteo
 * hourly forecast: mean speed, and the direction it blows FROM averaged as vectors.
 * Returns {fromDeg, kmh, gust, dir8} or null.
 */
export function raceWind(json, fromHour = 8, toHour = 11) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return null;
  let n = 0, sum = 0, x = 0, y = 0, gust = 0;
  for (let i = 0; i < h.time.length; i++) {
    const hour = Number(String(h.time[i]).slice(11, 13));
    if (!(hour >= fromHour && hour <= toHour)) continue;
    const s = Number(h.wind_speed_10m?.[i]), d = Number(h.wind_direction_10m?.[i]);
    if (!Number.isFinite(s) || !Number.isFinite(d)) continue;
    n++; sum += s;
    x += s * Math.sin((d * Math.PI) / 180);
    y += s * Math.cos((d * Math.PI) / 180);
    const g = Number(h.wind_gusts_10m?.[i]);
    if (Number.isFinite(g)) gust = Math.max(gust, g);
  }
  if (!n) return null;
  const kmh = sum / n;
  const fromDeg = kmh > 0.5 ? ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 : 0;
  return { fromDeg, kmh, gust, dir8: (Math.round(fromDeg / 45) % 8) * 45 };
}

export async function fetchRaceWind({ lat, lon, date, timeoutMs = 8000 }) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(forecastUrl(lat, lon, date), { signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
    if (!res.ok) throw new Error(`forecast ${res.status}`);
    const w = raceWind(await res.json());
    if (!w) throw new Error('no forecast for the race hours yet');
    return w;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
