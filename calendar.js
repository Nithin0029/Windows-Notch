// Calendar from private ICS links (Google Calendar "Secret address in iCal format", Outlook "Publish a calendar"
// ICS link, iCloud public calendar, ...). No sign-in: the link itself is the key, so it only ever lives in the
// local settings file and is never logged. Parsing, time zones and recurring events are handled by ical.js
// (Mozilla's iCalendar library, the one Thunderbird uses).
const { net } = require('electron');
const ICAL = require('ical.js');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_STEPS = 20000;          // safety cap when walking a long-running recurring event

/** Accept https/http/webcal links only; webcal:// is just https:// for calendar apps. */
function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(s.replace(/^webcals?:\/\//i, 'https://')); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return u.toString();
}

/** A short, non-secret label for a link (host only), for status messages. */
function hostOf(url) { try { return new URL(url).host; } catch { return 'calendar'; } }

async function fetchIcs(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/calendar, */*' } });
    if (res.status === 401 || res.status === 403) throw new Error('The link was refused. It may have been reset; copy it again.');
    if (res.status === 404) throw new Error('Nothing found at that link (404). Check you copied the whole address.');
    if (!res.ok) throw new Error(`The calendar server answered HTTP ${res.status}.`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('That calendar is too large to load.');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('That calendar is too large to load.');
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new Error('That link isn’t a calendar (ICS) file. Use the iCal/ICS address, not the web page.');
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The calendar took too long to answer.');
    if (/net::|fetch failed|ENOTFOUND|ECONN/i.test(err.message)) throw new Error('Couldn’t reach the calendar (are you offline?).');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ meeting links
const LINK_RE = new RegExp([
  'https://meet\\.google\\.com/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}',
  'https://teams\\.microsoft\\.com/l/meetup-join/[^\\s"<>]+',
  'https://teams\\.live\\.com/meet/[^\\s"<>]+',
  'https://(?:[\\w-]+\\.)?zoom\\.us/(?:j|my|w)/[^\\s"<>]+',
  'https://[\\w-]+\\.webex\\.com/[^\\s"<>]+',
  'https://whereby\\.com/[^\\s"<>]+',
  'https://app\\.slack\\.com/huddle/[^\\s"<>]+',
  'https://(?:[\\w-]+\\.)?gotomeeting\\.com/join/[^\\s"<>]+',
  'https://meet\\.jit\\.si/[^\\s"<>]+',
].join('|'), 'i');

function meetingLink(item) {
  const c = item.component;
  const fields = ['x-google-conference', 'x-microsoft-skypeteamsmeetingurl', 'x-microsoft-onlinemeetingconflink', 'url', 'location', 'description'];
  for (const f of fields) {
    for (const p of c.getAllProperties(f)) {
      const v = String(p.getFirstValue() ?? '');
      const m = LINK_RE.exec(v);
      if (m) return m[0].replace(/[)>.,;'"\]]+$/, '');
    }
  }
  return null;
}

// ------------------------------------------------------------------ time zones
// Most calendars include a definition for every zone they use, and ical.js handles those. Some don't (or name a
// zone ical.js doesn't know), so a time like "08:00 America/New_York" would be read as local time. For those we
// convert with the IANA database built into Windows/Chromium, mapping Outlook's Windows zone names first.
const WINDOWS_ZONES = {
  'Dateline Standard Time': 'Etc/GMT+12', 'Hawaiian Standard Time': 'Pacific/Honolulu', 'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles', 'Mountain Standard Time': 'America/Denver', 'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago', 'Eastern Standard Time': 'America/New_York', 'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota', 'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Buenos_Aires',
  'UTC': 'Etc/UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
  'GTB Standard Time': 'Europe/Bucharest', 'FLE Standard Time': 'Europe/Kiev', 'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Egypt Standard Time': 'Africa/Cairo', 'Israel Standard Time': 'Asia/Jerusalem',
  'Turkey Standard Time': 'Europe/Istanbul', 'Russian Standard Time': 'Europe/Moscow', 'Arab Standard Time': 'Asia/Riyadh',
  'Arabian Standard Time': 'Asia/Dubai', 'Iran Standard Time': 'Asia/Tehran', 'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata', 'Sri Lanka Standard Time': 'Asia/Colombo', 'Nepal Standard Time': 'Asia/Katmandu',
  'Bangladesh Standard Time': 'Asia/Dhaka', 'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore', 'Taipei Standard Time': 'Asia/Taipei', 'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'AUS Central Standard Time': 'Australia/Darwin',
  'Cen. Australia Standard Time': 'Australia/Adelaide', 'E. Australia Standard Time': 'Australia/Brisbane', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
};
const zoneOk = new Map();
function toIana(id) {
  if (!id) return null;
  let z = String(id).replace(/^"|"$/g, '').trim();
  if (WINDOWS_ZONES[z]) z = WINDOWS_ZONES[z];
  const m = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(z);   // e.g. "/mozilla.org/20050126_1/America/New_York"
  if (m && z.includes('mozilla.org')) z = m[1];
  if (!zoneOk.has(z)) {
    let ok = false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: z }); ok = true; } catch { /* unknown zone */ }
    zoneOk.set(z, ok);
  }
  return zoneOk.get(z) ? z : null;
}
const fmtCache = new Map();
function zoneOffset(ms, zone) {   // zone's UTC offset at instant ms, in ms
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmtCache.set(zone, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
function wallToUtc(t, zone) {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  let ms = wall - zoneOffset(wall, zone);
  ms = wall - zoneOffset(ms, zone);            // second pass settles DST edges
  return ms;
}
/** Milliseconds for an ical.js time; `tzid` is the event's TZID (occurrences of recurring events lose it). */
function msOf(t, tzid) {
  if (t.isDate) return t.toJSDate().getTime();                         // all-day: local midnight
  const known = t.zone && t.zone.tzid && t.zone.tzid !== 'floating';
  if (known) return t.toJSDate().getTime();                            // UTC or a zone defined in the file
  const iana = toIana(t.timezone || tzid);
  return iana ? wallToUtc(t, iana) : t.toJSDate().getTime();           // truly floating: local time
}

// ------------------------------------------------------------------ parsing
/**
 * Events from one ICS text that overlap [from, to] (ms). Recurring events are expanded,
 * moved/cancelled occurrences are respected.
 * Returns { name, events: [{ id, title, start, end, allDay, location, link }] }.
 */
function eventsBetween(text, from, to) {
  const root = new ICAL.Component(ICAL.parse(text));
  // Make the calendar's own time zone definitions known (Outlook uses names like "India Standard Time").
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { if (!ICAL.TimezoneService.has(tz.getFirstPropertyValue('tzid'))) ICAL.TimezoneService.register(tz); } catch { /* bad tz block */ }
  }
  const name = root.getFirstPropertyValue('x-wr-calname') || null;

  const masters = [];
  const byUid = new Map();
  const exceptions = [];
  for (const v of root.getAllSubcomponents('vevent')) {
    let e;
    try { e = new ICAL.Event(v); } catch { continue; }
    if (!e.startDate) continue;
    if (e.isRecurrenceException()) exceptions.push(e);
    else { masters.push(e); if (e.uid) byUid.set(e.uid, e); }
  }
  for (const ex of exceptions) {
    const m = byUid.get(ex.uid);
    if (m && m.isRecurring()) { try { m.relateException(ex); } catch { /* ignore */ } } else masters.push(ex);
  }

  const out = [];
  const push = (item, startDate, endDate, tzid) => {
    if (String(item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const start = msOf(startDate, item.startDate && item.startDate.timezone || tzid);
    let end = endDate ? msOf(endDate, (item.endDate && item.endDate.timezone) || (item.startDate && item.startDate.timezone) || tzid) : start;
    if (end <= start) end = start + (startDate.isDate ? 86400000 : 30 * 60000);
    if (end <= from || start >= to) return;
    out.push({
      id: `${item.uid || item.summary || 'ev'}@${start}`,
      title: String(item.summary || '(No title)').trim().slice(0, 200),
      start, end,
      allDay: !!startDate.isDate,
      location: String(item.location || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      link: meetingLink(item),
    });
  };

  for (const e of masters) {
    try {
      const tzid = e.startDate.timezone;
      if (!e.isRecurring()) { push(e, e.startDate, e.endDate, tzid); continue; }
      const it = e.iterator();
      const durMs = Math.max(0, e.endDate ? e.endDate.toJSDate() - e.startDate.toJSDate() : 0);
      for (let i = 0, t = it.next(); t && i < MAX_STEPS; t = it.next(), i++) {
        const ms = msOf(t, tzid);
        if (ms + durMs + 2 * 86400000 < from) continue;  // long before the window: keep walking
        if (ms - 2 * 86400000 >= to) break;               // (2-day slack: a moved occurrence may land inside)
        const d = e.getOccurrenceDetails(t);
        push(d.item, d.startDate, d.endDate, tzid);
      }
    } catch { /* one broken event never hides the rest */ }
  }
  out.sort((a, b) => a.start - b.start);
  return { name, events: out };
}

module.exports = { normalizeUrl, hostOf, fetchIcs, eventsBetween, LINK_RE };
