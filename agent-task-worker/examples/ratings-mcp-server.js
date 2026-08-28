// Standalone demo MCP server (stdio transport, no dependencies). Exposes one
// tool, get_analyst_rating, backed by a small fixed set of canned rating
// changes per ticker. Used by the Morning Portfolio Review demo's AI
// Briefing step.

const RATINGS = {
  TSLA: { firm: 'Morgan Stanley', rating: 'Hold', priorRating: 'Buy', changedDate: '2026-08-27' },
  NVDA: { firm: 'Goldman Sachs', rating: 'Buy', priorRating: 'Buy', changedDate: '2026-08-20', note: 'price target raised' }
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
        serverInfo: { name: 'ratings-mcp-demo', version: '1.0.0' }
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
            name: 'get_analyst_rating',
            description: 'Get the most recent analyst rating and any rating change for a stock ticker symbol.',
            inputSchema: {
              type: 'object',
              properties: { symbol: { type: 'string', description: 'Stock ticker symbol, e.g. TSLA' } },
              required: ['symbol']
            }
          }
        ]
      }
    });
  } else if (msg.method === 'tools/call' && msg.params.name === 'get_analyst_rating') {
    const symbol = String(msg.params.arguments?.symbol || '').toUpperCase();
    const rating = RATINGS[symbol];

    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{
          type: 'text',
          text: rating
            ? `${rating.firm}: ${rating.rating}${rating.priorRating && rating.priorRating !== rating.rating ? ` (downgraded from ${rating.priorRating})` : ''} as of ${rating.changedDate}${rating.note ? ` - ${rating.note}` : ''}`
            : `No recent analyst rating changes found for ${symbol}.`
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
