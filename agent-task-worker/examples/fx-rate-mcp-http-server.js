// Standalone demo MCP server (remote HTTP transport, no dependencies). Same
// tool and rate table as fx-rate-mcp-server.js (the stdio version) — this one
// just answers JSON-RPC over a plain HTTP POST endpoint instead of
// stdin/stdout, for exercising an "Agent Tool (MCP)" element with
// Transport: Remote (HTTP), Server URL: http://localhost:<PORT>.

import http from 'http';

const PORT = Number(process.env.PORT || 4180);

const RATES = {
  'USD/EUR': 0.9186,
  'USD/GBP': 0.7842,
  'USD/JPY': 149.32,
  'EUR/USD': 1.0886,
  'GBP/USD': 1.2752,
  'JPY/USD': 0.0067
};

function handle(msg) {
  if (msg.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fx-rate-mcp-http-demo', version: '1.0.0' }
    };
  }

  if (msg.method === 'tools/list') {
    return {
      tools: [
        {
          name: 'get_rate',
          description: 'Get the current exchange rate between two currencies (ISO 4217 codes, e.g. USD, EUR, GBP, JPY).',
          inputSchema: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Base currency code' },
              to: { type: 'string', description: 'Quote currency code' }
            },
            required: ['from', 'to']
          }
        }
      ]
    };
  }

  if (msg.method === 'tools/call' && msg.params?.name === 'get_rate') {
    const { from, to } = msg.params.arguments || {};
    const key = `${String(from).toUpperCase()}/${String(to).toUpperCase()}`;
    const rate = RATES[key];

    return rate === undefined
      ? { isError: true, content: [{ type: 'text', text: `No rate available for ${key}` }] }
      : { content: [{ type: 'text', text: `1 ${from.toUpperCase()} = ${rate} ${to.toUpperCase()}` }] };
  }

  if (msg.method === 'tools/call') {
    return { isError: true, content: [{ type: 'text', text: `No such tool: ${msg.params?.name}` }] };
  }

  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body || '{}');
    } catch (err) {
      res.writeHead(400).end();
      return;
    }

    console.log(`<- ${msg.method} ${JSON.stringify(msg.params || {})}`);

    if (msg.method === 'notifications/initialized') {
      // notification, no response body expected
      res.writeHead(202).end();
      return;
    }

    const result = handle(msg);
    const payload = { jsonrpc: '2.0', id: msg.id, result };
    console.log(`-> ${JSON.stringify(payload)}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(PORT, () => console.log(`fx-rate-mcp-http-server listening on http://localhost:${PORT}`));
