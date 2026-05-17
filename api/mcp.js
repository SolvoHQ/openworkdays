'use strict';

// OpenWorkdays MCP server — remote, anonymous, zero-signup.
// Single zero-dependency Node serverless function. Implements the MCP
// Streamable HTTP transport in STATELESS JSON mode: every POST gets a single
// application/json JSON-RPC 2.0 response. No sessions, no SSE streaming.
//
// Lets autonomous AI agents call OpenWorkdays as a tool with no account/key —
// an agent has no human to do a signup.

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const UPSTREAM = 'https://openworkdays.vercel.app/api/businessdays';

const SERVER_INFO = { name: 'openworkdays', version: '0.1.0' };

const BUSINESSDAYS_TOOL = {
  name: 'businessdays',
  description:
    'Business-day date math. Three modes inferred from params: add ' +
    '(start+days -> the date N business days away, negative days = before), ' +
    'diff (start+end -> count of business days between, inclusive of both ' +
    'endpoints), is (date -> is it a business day). Optional weekend ' +
    '(default sat,sun) and holidays (comma list of YYYY-MM-DD you supply). ' +
    'No signup, no API key. Pure UTC date-only math; no ' +
    'time-of-day/DST/timezone.',
  inputSchema: {
    type: 'object',
    properties: {
      start: {
        type: 'string',
        description: 'Start date YYYY-MM-DD (add & diff modes)',
      },
      days: {
        type: 'integer',
        description:
          'Business days to add (add mode); negative subtracts',
      },
      end: {
        type: 'string',
        description: 'End date YYYY-MM-DD (diff mode)',
      },
      date: {
        type: 'string',
        description: 'Date YYYY-MM-DD to test (is mode)',
      },
      weekend: {
        type: 'string',
        description: 'Comma list of weekend days, e.g. "sat,sun" (default sat,sun)',
      },
      holidays: {
        type: 'string',
        description: 'Comma list of YYYY-MM-DD dates treated as non-working',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
};

// --- helpers ---------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    // Vercel may have already parsed/buffered the body.
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') {
        try {
          resolve(req.body.length ? JSON.parse(req.body) : undefined);
        } catch (e) {
          resolve({ __parseError: true });
        }
        return;
      }
      if (Buffer.isBuffer(req.body)) {
        const s = req.body.toString('utf8');
        try {
          resolve(s.length ? JSON.parse(s) : undefined);
        } catch (e) {
          resolve({ __parseError: true });
        }
        return;
      }
      if (typeof req.body === 'object') {
        resolve(req.body);
        return;
      }
    }
    // Otherwise read the raw stream.
    let data = '';
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      resolve(val);
    };
    try {
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data.length) return finish(undefined);
        try {
          finish(JSON.parse(data));
        } catch (e) {
          finish({ __parseError: true });
        }
      });
      req.on('error', () => finish({ __parseError: true }));
    } catch (e) {
      finish({ __parseError: true });
    }
  });
}

function jsonRpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: err };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolResult(text, structuredContent, isError) {
  const r = { content: [{ type: 'text', text }], isError: !!isError };
  if (structuredContent !== undefined) r.structuredContent = structuredContent;
  return r;
}

async function callBusinessdays(args) {
  try {
    const qs = new URLSearchParams();
    const keys = ['start', 'days', 'end', 'date', 'weekend', 'holidays'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = args[k];
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const r = await fetch(UPSTREAM + '?' + qs.toString(), {
      headers: { Accept: 'application/json' },
    });
    let j;
    try {
      j = await r.json();
    } catch (e) {
      const txt = '{"error":"upstream returned non-JSON"}';
      j = JSON.parse(txt);
    }
    const isError =
      !r.ok || (j && typeof j === 'object' && j.error != null);
    return toolResult(JSON.stringify(j, null, 2), j, isError);
  } catch (e) {
    return toolResult(
      'businessdays upstream request failed: ' +
        (e && e.message ? e.message : 'error'),
      undefined,
      true
    );
  }
}

// Process a single JSON-RPC message. Returns:
//  - a JSON-RPC response object (for requests), or
//  - null (for notifications — no response).
async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return jsonRpcError(null, -32600, 'Invalid Request: expected a JSON-RPC object');
  }

  const { id, method } = msg;
  const params = msg.params;
  const isNotification = id === undefined || id === null;

  if (typeof method !== 'string') {
    if (isNotification) return null;
    return jsonRpcError(id, -32600, 'Invalid Request: missing method');
  }

  // Any notifications/* message → no response (handled as HTTP 202 by caller).
  if (method.indexOf('notifications/') === 0) {
    return null;
  }

  if (method === 'initialize') {
    const reqProto =
      params && typeof params.protocolVersion === 'string'
        ? params.protocolVersion
        : DEFAULT_PROTOCOL_VERSION;
    return jsonRpcResult(id, {
      protocolVersion: reqProto,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: [BUSINESSDAYS_TOOL] });
  }

  if (method === 'tools/call') {
    if (!params || typeof params !== 'object') {
      return jsonRpcError(id, -32602, 'Invalid params: expected an object');
    }
    const name = params.name;
    const args = params.arguments || {};

    if (name !== 'businessdays') {
      return jsonRpcResult(
        id,
        toolResult(
          'Unknown tool "' +
            String(name) +
            '". This server exposes exactly one tool: "businessdays". ' +
            'Call tools/list to see its schema.',
          undefined,
          true
        )
      );
    }

    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).length === 0
    ) {
      return jsonRpcResult(
        id,
        toolResult(
          'Provide at least one mode: add needs start+days, diff needs ' +
            'start+end, is needs date. See https://openworkdays.vercel.app',
          undefined,
          true
        )
      );
    }

    const result = await callBusinessdays(args);
    return jsonRpcResult(id, result);
  }

  // Unknown method
  if (isNotification) return null;
  return jsonRpcError(id, -32601, 'Method not found: ' + String(method));
}

// --- handler ---------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, MCP-Protocol-Version, Mcp-Session-Id'
  );

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0];
  const ua = req.headers['user-agent'] || null;

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    console.log(
      JSON.stringify({ evt: 'mcp_hit', method: 'GET', ip, ua, ts: Date.now() })
    );
    res.statusCode = 405;
    return res.end(
      JSON.stringify({
        error: 'Use POST for MCP JSON-RPC',
        endpoint: 'https://openworkdays.vercel.app/api/mcp',
      })
    );
  }

  if (req.method !== 'POST') {
    console.log(
      JSON.stringify({
        evt: 'mcp_hit',
        method: req.method || null,
        ip,
        ua,
        ts: Date.now(),
      })
    );
    res.statusCode = 405;
    return res.end(
      JSON.stringify({
        error: 'Use POST for MCP JSON-RPC',
        endpoint: 'https://openworkdays.vercel.app/api/mcp',
      })
    );
  }

  const body = await readBody(req);

  // Parse error → -32700
  if (body && body.__parseError) {
    console.log(
      JSON.stringify({
        evt: 'mcp_hit',
        method: 'parse_error',
        ip,
        ua,
        ts: Date.now(),
      })
    );
    res.statusCode = 200;
    return res.end(
      JSON.stringify(jsonRpcError(null, -32700, 'Parse error: invalid JSON'))
    );
  }

  // --- Batch (array of messages) -------------------------------------------
  if (Array.isArray(body)) {
    console.log(
      JSON.stringify({
        evt: 'mcp_hit',
        method: 'batch',
        ip,
        ua,
        ts: Date.now(),
      })
    );
    if (body.length === 0) {
      res.statusCode = 200;
      return res.end(
        JSON.stringify(jsonRpcError(null, -32600, 'Invalid Request: empty batch'))
      );
    }
    const responses = [];
    for (let i = 0; i < body.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await handleMessage(body[i]);
      if (r !== null) responses.push(r);
    }
    if (responses.length === 0) {
      // All notifications → no response bodies.
      res.statusCode = 202;
      return res.end();
    }
    res.statusCode = 200;
    return res.end(JSON.stringify(responses));
  }

  // --- Single message (common case) ----------------------------------------
  if (!body || typeof body !== 'object') {
    console.log(
      JSON.stringify({
        evt: 'mcp_hit',
        method: 'invalid_request',
        ip,
        ua,
        ts: Date.now(),
      })
    );
    res.statusCode = 200;
    return res.end(
      JSON.stringify(
        jsonRpcError(null, -32600, 'Invalid Request: expected a JSON-RPC object')
      )
    );
  }

  const method = typeof body.method === 'string' ? body.method : null;
  console.log(
    JSON.stringify({ evt: 'mcp_hit', method, ip, ua, ts: Date.now() })
  );

  const response = await handleMessage(body);

  // Notification → HTTP 202, no JSON-RPC body.
  if (response === null) {
    res.statusCode = 202;
    return res.end();
  }

  res.statusCode = 200;
  return res.end(JSON.stringify(response));
};
