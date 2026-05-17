# OpenWorkdays

**A zero-signup business-day / working-day date-arithmetic API. No account, no API key — one GET request.**

Add or subtract working days, count business days between two dates, or test
whether a date is a business day — with **your own** holiday list. Pure UTC date
math, returned as JSON. Built so autonomous AI agents get a deterministic date
endpoint — an agent has no human to do a signup, and LLMs are measurably
unreliable at date arithmetic.

Live: **https://openworkdays.vercel.app**

## Quick start

```sh
curl "https://openworkdays.vercel.app/api/businessdays?start=2026-05-15&days=5"
```

Sample response:

```json
{
  "mode": "add",
  "start": "2026-05-15",
  "days": 5,
  "result": "2026-05-22",
  "resultWeekday": "fri",
  "startIsBusinessDay": true,
  "weekend": ["sat", "sun"],
  "holidaysApplied": 0,
  "engine": "date-utc-v0.1",
  "computedAt": "2026-05-17T00:00:00.000Z"
}
```

Any error returns JSON with an `error` key and an appropriate HTTP status
(`400` bad params, `429` rate limited, `405` wrong method).

## The three modes

The endpoint is always `GET /api/businessdays`. The mode is inferred from the
params you pass.

### `add` — add/subtract working days

Params: `start=YYYY-MM-DD`, `days=N` (integer, `+`/`-` ok, `|N| <= 10000`),
optional `weekend=`, optional `holidays=`.

```sh
curl "https://openworkdays.vercel.app/api/businessdays?start=2026-05-15&days=5"
```

`N=0` returns `start` unchanged (even if `start` is itself non-working).

### `diff` — count business days between two dates

Params: `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, optional `weekend=`, optional
`holidays=`. Inclusive of **both** endpoints. Result is negative if
`end` < `start`.

```sh
curl "https://openworkdays.vercel.app/api/businessdays?start=2026-05-15&end=2026-06-15&holidays=2026-05-25"
```

### `is` — is this date a business day?

Params: `date=YYYY-MM-DD`, optional `weekend=`, optional `holidays=`.

```sh
curl "https://openworkdays.vercel.app/api/businessdays?date=2026-05-16"
```

Returns `isBusinessDay` plus a `reason` of `"weekend"`, `"holiday"`, or `null`.

### Shared params

- **`weekend`** (default `sat,sun`) — comma list. Tokens are case-insensitive
  from `{sun,mon,tue,wed,thu,fri,sat}`, or numeric `0-6` where `0=Sunday` …
  `6=Saturday` (matches JS `getUTCDay()`). Cannot mark all 7 days as weekend.
- **`holidays`** — comma list of `YYYY-MM-DD` dates treated as non-working
  (max 1000). Strictly validated.

## Errors

Errors are JSON with an `error` key:

- `400` — bad/missing params (`missing start`, `invalid days (must be integer)`,
  `invalid weekend token`, `invalid holiday date`, `invalid date`,
  `specify a mode` (includes a `usage` object), …)
- `429` — rate limited (`Retry-After` header + `retryAfterSec`)
- `405` — wrong HTTP method (only `GET`/`OPTIONS` allowed)

## JavaScript

```js
const base = "https://openworkdays.vercel.app";
const r = await fetch(
  base + "/api/businessdays?start=2026-05-15&days=5"
);
const out = await r.json(); // { mode:"add", result:"2026-05-22", resultWeekday:"fri", ... }
```

## Why

Every public business-day API gates behind an account or API key:
[workingdays.org](https://workingdays.org) is test-only / subscription;
[API Ninjas](https://api-ninjas.com) and [Holiday API](https://holidayapi.com)
need keys; [timeanddate](https://www.timeanddate.com) is a $299 product;
the RapidAPI business-day APIs need a RapidAPI key; Microsoft's "Calculate
Working Day" connector is Power-Platform-framework-gated and UK-bank-holidays
only. OpenWorkdays is a single anonymous `GET` — no signup, no key. That is
especially useful to autonomous agents, which have no human in the loop to
complete a signup. And because LLMs are measurably unreliable at date
arithmetic, an agent needs a deterministic endpoint rather than guessing.

## Limitations

- **Date-only, pure UTC arithmetic** — no time-of-day, no DST, no timezones
  (that is recurrence-rule territory, intentionally out of scope for v0.1).
- **Caller-supplied holidays only** — there is no built-in country holiday
  database. This is deliberate: we do not fake-compete on the
  7000-holiday-DB axis where funded incumbents win. You pass the
  `holidays=` list you care about.
- **Best-effort per-instance IP rate limit** — a soft abuse brake, not a
  guarantee (serverless instances are ephemeral and not shared).
- **MIT licensed and self-hostable** — see below.

## Self-host — it's zero-dependency files

The entire API is one single zero-dependency Node serverless function:
[`api/businessdays.js`](api/businessdays.js). No `npm install`, no deps at all.
Deploy the folder to Vercel (zero-config `/api` detection) or drop the handler
into any Node serverless runtime.

```sh
git clone https://github.com/SolvoHQ/openworkdays
cd openworkdays
npx vercel --prod
```

## License

MIT — see [LICENSE](LICENSE).
