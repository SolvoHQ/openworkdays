'use strict';

// Zero-dependency test harness for api/businessdays.js.
// Drives the handler with a fake req/res, asserts on parsed JSON.

const handler = require('../api/businessdays.js');

function makeRes() {
  return {
    statusCode: 200,
    _body: '',
    setHeader() {},
    end(body) {
      this._body = body == null ? '' : String(body);
      return this;
    },
  };
}

async function call(qs) {
  const req = {
    method: 'GET',
    headers: {},
    url: '/api/businessdays' + (qs ? '?' + qs : ''),
  };
  const res = makeRes();
  await handler(req, res);
  let json = null;
  try {
    json = res._body ? JSON.parse(res._body) : null;
  } catch (e) {
    json = null;
  }
  return { status: res.statusCode, json };
}

const cases = [
  {
    qs: 'start=2026-05-15&days=1',
    check: (r) =>
      r.status === 200 &&
      r.json.result === '2026-05-18' &&
      r.json.resultWeekday === 'mon',
  },
  {
    qs: 'start=2026-05-15&days=5',
    check: (r) => r.status === 200 && r.json.result === '2026-05-22',
  },
  {
    qs: 'start=2026-05-15&days=1&holidays=2026-05-18',
    check: (r) => r.status === 200 && r.json.result === '2026-05-19',
  },
  {
    qs: 'start=2026-05-15&days=0',
    check: (r) => r.status === 200 && r.json.result === '2026-05-15',
  },
  {
    qs: 'start=2026-05-18&days=-1',
    check: (r) => r.status === 200 && r.json.result === '2026-05-15',
  },
  {
    qs: 'start=2026-05-15&end=2026-05-22',
    check: (r) => r.status === 200 && r.json.businessDays === 6,
  },
  {
    qs: 'start=2026-05-15&end=2026-05-22&holidays=2026-05-20',
    check: (r) => r.status === 200 && r.json.businessDays === 5,
  },
  {
    qs: 'start=2026-05-22&end=2026-05-15',
    check: (r) => r.status === 200 && r.json.businessDays === -6,
  },
  {
    qs: 'date=2026-05-16',
    check: (r) =>
      r.status === 200 &&
      r.json.isBusinessDay === false &&
      r.json.reason === 'weekend',
  },
  {
    qs: 'date=2026-05-15',
    check: (r) =>
      r.status === 200 &&
      r.json.isBusinessDay === true &&
      r.json.reason === null,
  },
  {
    qs: 'date=2026-05-15&holidays=2026-05-15',
    check: (r) =>
      r.status === 200 &&
      r.json.isBusinessDay === false &&
      r.json.reason === 'holiday',
  },
  {
    qs: 'date=2026-02-30',
    check: (r) => r.status === 400,
  },
  {
    qs: 'weekend=sun,mon,tue,wed,thu,fri,sat&start=2026-05-15&days=1',
    check: (r) => r.status === 400,
  },
  {
    qs: 'start=2026-05-15&days=1&holidays=2026-13-01',
    check: (r) => r.status === 400,
  },
  {
    qs: '',
    check: (r) =>
      r.status === 400 && r.json && Object.prototype.hasOwnProperty.call(r.json, 'usage'),
  },
  {
    qs: 'start=2026-05-15&days=abc',
    check: (r) => r.status === 400,
  },
];

(async () => {
  let failed = 0;
  for (let i = 0; i < cases.length; i++) {
    const n = i + 1;
    const c = cases[i];
    let r;
    try {
      r = await call(c.qs);
    } catch (e) {
      console.log('FAIL ' + n + '/16: threw ' + (e && e.message));
      failed++;
      continue;
    }
    let ok = false;
    try {
      ok = !!c.check(r);
    } catch (e) {
      ok = false;
    }
    if (ok) {
      console.log('PASS ' + n + '/16');
    } else {
      failed++;
      console.log(
        'FAIL ' +
          n +
          '/16: qs="' +
          c.qs +
          '" status=' +
          r.status +
          ' body=' +
          JSON.stringify(r.json)
      );
    }
  }
  if (failed > 0) {
    console.log('\n' + failed + ' failed');
    process.exit(1);
  }
  console.log('\nall 16 passed');
  process.exit(0);
})();
