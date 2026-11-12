// Weather from Open-Meteo (https://open-meteo.com): free, no account or API key.
// Only what's needed is sent: the city name you search for, and then that city's coordinates.
const { net } = require('electron');

async function getJSON(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Find places matching a name. Returns [{ name, region, lat, lon }]. */
async function searchCity(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const data = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  return (data.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 1000) / 1000,
    lon: Math.round(r.longitude * 1000) / 1000,
  }));
}

/** Current conditions + today's high/low for a place. */
async function fetchWeather({ lat, lon, units }) {
  const f = units === 'fahrenheit' ? '&temperature_unit=fahrenheit' : '';
  const data = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1${f}`);
  const c = data.current || {};
  const d = data.daily || {};
  if (typeof c.temperature_2m !== 'number') throw new Error('no current weather in response');
  return {
    temp: Math.round(c.temperature_2m),
    code: c.weather_code,
    isDay: c.is_day === 1,
    hi: Array.isArray(d.temperature_2m_max) ? Math.round(d.temperature_2m_max[0]) : null,
    lo: Array.isArray(d.temperature_2m_min) ? Math.round(d.temperature_2m_min[0]) : null,
  };
}

module.exports = { searchCity, fetchWeather };
