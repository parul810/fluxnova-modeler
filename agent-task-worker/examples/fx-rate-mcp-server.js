// Standalone demo MCP server (stdio transport, no dependencies). Exposes one
// tool, get_rate, backed by a small fixed rate table. Meant to be spawned by
// an "Agent Tool (MCP)" element (Transport: Local (stdio subprocess),
// Command: node, Command Arguments: examples/fx-rate-mcp-server.js) — not a
// real data source, just enough for a working end-to-end demo.

const RATES = {
  'USD/EUR': 0.9186,
  'USD/GBP': 0.7842,
  'USD/JPY': 149.32,
  'EUR/USD': 1.0886,
  'GBP/USD': 1.2752,
  'JPY/USD': 0.0067
};

process.stdin.setEncoding('utf8');
let buffer = '';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    handle(JSON.parse(line));
  }
});

function handle(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fx-rate-mcp-demo', version: '1.0.0' }
      }
    });
  } else if (msg.method === 'notifications/initialized') {
    // no response expected
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
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
      }
    });
  } else if (msg.method === 'tools/call' && msg.params.name === 'get_rate') {
    const { from, to } = msg.params.arguments || {};
    const key = `${String(from).toUpperCase()}/${String(to).toUpperCase()}`;
    const rate = RATES[key];

    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: rate === undefined
        ? { isError: true, content: [{ type: 'text', text: `No rate available for ${key}` }] }
        : { content: [{ type: 'text', text: `1 ${from.toUpperCase()} = ${rate} ${to.toUpperCase()}` }] }
    });
  } else if (msg.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { isError: true, content: [{ type: 'text', text: `No such tool: ${msg.params.name}` }] }
    });
  }
}
