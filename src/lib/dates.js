// Timezone-safe date helpers. Nothing here should ever slice an ISO string by
// hand to get a "day" — that's exactly the bug this module exists to avoid
// (see SKILL.md "Known traps" — timezone drift).

/** 'YYYY-MM-DD' → the epoch ms of local midnight of that date in `timeZone`. */
export function zonedDayStart(dateISO, timeZone) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(utcGuess - tzOffsetMs(utcGuess, timeZone));
}

/** epoch ms → 'YYYY-MM-DD' as that instant reads on a wall clock in `timeZone`. */
export function isoDateInTimeZone(epochMs, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/** Exclusive [startMs, endMs) bounds covering every instant of [fromISO, toISO] in `timeZone`. */
export function dayBoundsMs(fromISO, toISO, timeZone) {
  const startMs = zonedDayStart(fromISO, timeZone).getTime() - 1;
  const endMs = zonedDayStart(addDays(toISO, 1), timeZone).getTime();
  return { startMs, endMs };
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD'. n may be negative. */
export function addDays(dateISO, n) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Today's date as 'YYYY-MM-DD' in `timeZone`. */
export function todayISO(timeZone) {
  return isoDateInTimeZone(Date.now(), timeZone);
}

/** Every 'YYYY-MM-DD' from fromISO to toISO, inclusive. */
export function enumerateDates(fromISO, toISO) {
  const out = [];
  for (let cur = fromISO; cur <= toISO; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

/** 'YYYY-MM-DD' → 'Jul 22' (or 'Jul 22, 2025' if not the current year). */
export function formatShortDate(dateISO, { referenceYear = new Date().getFullYear() } = {}) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return y === referenceYear ? `${month} ${d}` : `${month} ${d}, ${y}`;
}

/** epoch ms → 'HH:MM' (24h) as that instant reads on a wall clock in `timeZone`. */
export function formatTime(epochMs, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epochMs));
}

function tzOffsetMs(epochMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(epochMs)
      .map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - epochMs;
}
