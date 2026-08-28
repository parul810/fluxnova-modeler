// Standalone demo MCP server (stdio transport, no dependencies). Exposes one
// tool, get_headlines, backed by a small fixed set of canned headlines per
// ticker. Used by the Morning Portfolio Review demo's AI Briefing step.

const HEADLINES = {
  TSLA: [
    'Tesla misses Q3 delivery estimates, cites production line retooling for next-gen model',
    'Analysts flag margin pressure after Tesla price cuts across key markets'
  ],
  NVDA: [
    'NVIDIA beats revenue estimates on strong data-center GPU demand',
    'Major cloud providers reportedly increasing multi-year NVIDIA chip orders'
  ]
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
        serverInfo: { name: 'news-mcp-demo', version: '1.0.0' }
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
            name: 'get_headlines',
            description: 'Get recent news headlines for a stock ticker symbol.',
            inputSchema: {
              type: 'object',
              properties: { symbol: { type: 'string', description: 'Stock ticker symbol, e.g. TSLA' } },
              required: ['symbol']
            }
          }
        ]
      }
    });
  } else if (msg.method === 'tools/call' && msg.params.name === 'get_headlines') {
    const symbol = String(msg.params.arguments?.symbol || '').toUpperCase();
    const headlines = HEADLINES[symbol];

    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{
          type: 'text',
          text: headlines ? headlines.join('\n') : `No notable headlines found for ${symbol} in the last 24 hours.`
        }]
      }
    });
  } else if (msg.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { isError: true, content: [{ type: 'text', text: `No such tool: ${msg.params.name}` }] }
    });
  }
}
