'use strict';

// OpenWorkdays v0.1 — anonymous, zero-signup business-day date-arithmetic API.
// Single zero-dependency Node serverless function. Pure UTC date math only.

// --- In-memory per-instance best-effort IP rate limiter ---------------------
// NOTE: This is per-instance / best-effort only. Serverless instances are
// ephemeral and not shared, so this is a soft abuse brake, NOT a guarantee.
const RL_WINDOW_SEC = 600;
const RL_MAX = 120;
const rlMap = new Map(); // ip -> number[] (timestamps in ms)

function rateLimit(ip) {
  const now = Date.now();
  const windowMs = RL_WINDOW_SEC * 1000;
  const hits = (rlMap.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rlMap.set(ip, hits);
  if (hits.length > RL_MAX) {
    const oldest = hits[0];
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { limited: true, retryAfterSec };
  }
  return { limited: false };
}

// --- Date helpers -----------------------------------------------------------
const DAY = 86400000;
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Parse YYYY-MM-DD strictly into UTC ms, or null if invalid.
function isoToUTC(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  if (y < 1000 || y > 9999) return null;
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

function toISO(ms) {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWorking(ms, weekendSet, holidaySet) {
  const d = new Date(ms).getUTCDay();
  if (weekendSet.has(d)) return false;
  if (holidaySet.has(toISO(ms))) return false;
  return true;
}

const WEEKEND_TOKENS = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// --- Handler ----------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  const ip = (req.headers['x-forwarded-for'] || 'ip').split(',')[0].trim() || 'ip';

  const logHit = (mode, ok) => {
    try {
      console.log(
        JSON.stringify({
          evt: 'workdays_hit',
          mode: mode || null,
          ip,
          ua: req.headers['user-agent'] || null,
          ok: !!ok,
          ts: Date.now(),
        })
      );
    } catch (e) {
      /* ignore logging errors */
    }
  };

  // Rate limit
  const rl = rateLimit(ip);
  if (rl.limited) {
    logHit(null, false);
    res.statusCode = 429;
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.end(
      JSON.stringify({ error: 'rate limited', retryAfterSec: rl.retryAfterSec })
    );
  }

  // Parse query (prefer req.query, fallback to URL parsing).
  const q = (name) => {
    try {
      if (req.query && Object.prototype.hasOwnProperty.call(req.query, name)) {
        const v = req.query[name];
        return Array.isArray(v) ? v[0] : v;
      }
      const u = new URL(req.url, 'http://x');
      return u.searchParams.get(name);
    } catch (e) {
      return null;
    }
  };

  const bad = (mode, obj) => {
    logHit(mode, false);
    res.statusCode = 400;
    return res.end(JSON.stringify(obj));
  };

  // --- Shared params: weekend ----------------------------------------------
  const weekendRaw = q('weekend');
  const weekendSet = new Set();
  {
    const src =
      weekendRaw == null || weekendRaw === '' ? 'sat,sun' : String(weekendRaw);
    const toks = src.split(',');
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i].trim();
      if (tok === '') continue;
      const low = tok.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(WEEKEND_TOKENS, low)) {
        weekendSet.add(WEEKEND_TOKENS[low]);
      } else if (/^[0-6]$/.test(tok)) {
        weekendSet.add(+tok);
      } else {
        return bad(null, { error: 'invalid weekend token', value: tok });
      }
    }
    if (weekendSet.size >= 7) {
      return bad(null, { error: 'weekend cannot include all 7 weekdays' });
    }
  }

  // --- Shared params: holidays ---------------------------------------------
  const holidaysRaw = q('holidays');
  const holidaySet = new Set();
  if (holidaysRaw != null && holidaysRaw !== '') {
    const toks = String(holidaysRaw).split(',');
    const cleaned = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i].trim();
      if (tok === '') continue;
      cleaned.push(tok);
    }
    if (cleaned.length > 1000) {
      return bad(null, { error: 'too many holidays (max 1000)' });
    }
    for (let i = 0; i < cleaned.length; i++) {
      const tok = cleaned[i];
      const ms = isoToUTC(tok);
      if (ms == null) {
        return bad(null, { error: 'invalid holiday date', value: tok });
      }
      holidaySet.add(toISO(ms));
    }
  }

  const weekendOut = Array.from(weekendSet)
    .sort((a, b) => a - b)
    .map((i) => WD[i]);

  // --- Mode resolution ------------------------------------------------------
  const daysParam = q('days');
  const endParam = q('end');
  const dateParam = q('date');
  const startParam = q('start');

  let mode;
  if (daysParam != null) {
    mode = 'add';
  } else if (endParam != null) {
    mode = 'diff';
  } else if (dateParam != null) {
    mode = 'is';
  } else {
    return bad(null, {
      error: 'specify a mode',
      usage: {
        add: '?start=YYYY-MM-DD&days=N[&weekend=sat,sun][&holidays=YYYY-MM-DD,...]',
        diff: '?start=YYYY-MM-DD&end=YYYY-MM-DD[&weekend=][&holidays=]',
        is: '?date=YYYY-MM-DD[&weekend=][&holidays=]',
      },
      docs: 'https://openworkdays.vercel.app',
    });
  }

  try {
    if (mode === 'add') {
      if (startParam == null) return bad('add', { error: 'missing start' });
      const startMs = isoToUTC(startParam);
      if (startMs == null) {
        return bad('add', {
          error: 'invalid date',
          param: 'start',
          value: startParam,
        });
      }
      if (!/^[+-]?\d+$/.test(String(daysParam))) {
        return bad('add', { error: 'invalid days (must be integer)' });
      }
      const N = parseInt(daysParam, 10);
      if (Math.abs(N) > 10000) {
        return bad('add', { error: 'days out of range (max 10000)' });
      }

      let result;
      if (N === 0) {
        result = startMs;
      } else {
        let cursor = startMs;
        let rem = Math.abs(N);
        const step = N > 0 ? DAY : -DAY;
        const cap = Math.abs(N) * 7 + 14;
        let iter = 0;
        while (rem > 0) {
          if (++iter > cap) {
            throw new Error('compute guard');
          }
          cursor += step;
          if (isWorking(cursor, weekendSet, holidaySet)) rem--;
        }
        result = cursor;
      }

      logHit('add', true);
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          mode: 'add',
          start: toISO(startMs),
          days: N,
          result: toISO(result),
          resultWeekday: WD[new Date(result).getUTCDay()],
          startIsBusinessDay: isWorking(startMs, weekendSet, holidaySet),
          weekend: weekendOut,
          holidaysApplied: holidaySet.size,
          engine: 'date-utc-v0.1',
          computedAt: new Date().toISOString(),
        })
      );
    }

    if (mode === 'diff') {
      if (startParam == null) return bad('diff', { error: 'missing start' });
      const startMs = isoToUTC(startParam);
      if (startMs == null) {
        return bad('diff', {
          error: 'invalid date',
          param: 'start',
          value: startParam,
        });
      }
      const endMs = isoToUTC(endParam);
      if (endMs == null) {
        return bad('diff', {
          error: 'invalid date',
          param: 'end',
          value: endParam,
        });
      }
      const lo = Math.min(startMs, endMs);
      const hi = Math.max(startMs, endMs);
      const spanDays = (hi - lo) / DAY;
      if (spanDays > 36600) {
        return bad('diff', { error: 'date range too large (max 36600 days)' });
      }
      let count = 0;
      for (let ms = lo; ms <= hi; ms += DAY) {
        if (isWorking(ms, weekendSet, holidaySet)) count++;
      }
      const sign = endMs < startMs ? -1 : 1;
      const businessDays = count * sign;

      logHit('diff', true);
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          mode: 'diff',
          start: toISO(startMs),
          end: toISO(endMs),
          businessDays,
          inclusive: 'both endpoints',
          weekend: weekendOut,
          holidaysApplied: holidaySet.size,
          engine: 'date-utc-v0.1',
          computedAt: new Date().toISOString(),
        })
      );
    }

    // mode === 'is'
    const dateMs = isoToUTC(dateParam);
    if (dateMs == null) {
      return bad('is', {
        error: 'invalid date',
        param: 'date',
        value: dateParam,
      });
    }
    const d = new Date(dateMs).getUTCDay();
    const weekendHit = weekendSet.has(d);
    const holidayHit = holidaySet.has(toISO(dateMs));
    const isBiz = !weekendHit && !holidayHit;
    const reason = weekendHit ? 'weekend' : holidayHit ? 'holiday' : null;

    logHit('is', true);
    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        mode: 'is',
        date: toISO(dateMs),
        weekday: WD[d],
        isBusinessDay: isBiz,
        reason,
        weekend: weekendOut,
        holidaysApplied: holidaySet.size,
        engine: 'date-utc-v0.1',
        computedAt: new Date().toISOString(),
      })
    );
  } catch (e) {
    logHit(mode, false);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'internal compute guard' }));
  }
};
