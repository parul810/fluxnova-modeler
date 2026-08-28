// Standalone mock market-data/portfolio API (no dependencies). Stands in for
// a real broker + market-data feed for the Morning Portfolio Review demo.
// GET /portfolio       -> current holdings
// GET /quotes?symbols=AAPL,TSLA -> price + prevClose per symbol

import http from 'http';
import { URL } from 'url';

const PORT = Number(process.env.PORT || 4200);

// Fixed day-change % per symbol so the demo reliably exercises both the
// "flagged" and "routine" branches, plus a little jitter so re-runs aren't
// bit-for-bit identical. TSLA/NVDA are deliberately big movers.
const HOLDINGS = [
  { symbol: 'AAPL', name: 'Apple Inc.', quantity: 400, avgCost: 178.20, prevClose: 226.10, baseChangePct: 0.8 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', quantity: 150, avgCost: 310.50, prevClose: 421.30, baseChangePct: -1.2 },
  { symbol: 'TSLA', name: 'Tesla Inc.', quantity: 300, avgCost: 205.00, prevClose: 258.40, baseChangePct: -7.4 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', quantity: 250, avgCost: 410.00, prevClose: 486.90, baseChangePct: 6.1 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', quantity: 200, avgCost: 142.80, prevClose: 186.20, baseChangePct: 0.3 },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', quantity: 180, avgCost: 155.40, prevClose: 214.70, baseChangePct: -0.5 },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', quantity: 220, avgCost: 98.60, prevClose: 118.30, baseChangePct: 1.1 }
];

// Runtime-toggleable so the demo can exercise both BPMN branches on demand
// without a restart: 'volatile' (default) lets TSLA/NVDA hit their big
// scripted moves; 'quiet' clamps every symbol to a small move so nothing
// crosses the flag threshold.
let regime = 'volatile';

function jitter(pct) {
  return pct + (Math.random() - 0.5) * 0.6; // +/- 0.3pp
}

function effectiveChangePct(baseChangePct) {
  const pct = regime === 'quiet' ? Math.max(-1.5, Math.min(1.5, baseChangePct * 0.2)) : baseChangePct;
  return jitter(pct);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/portfolio') {
    sendJson(res, 200, {
      asOf: new Date().toISOString(),
      positions: HOLDINGS.map(({ symbol, name, quantity, avgCost }) => ({ symbol, name, quantity, avgCost }))
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/quotes') {
    const symbols = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const quotes = {};

    for (const symbol of symbols) {
      const holding = HOLDINGS.find((h) => h.symbol === symbol);
      if (!holding) continue;
      const changePct = effectiveChangePct(holding.baseChangePct);
      const price = Number((holding.prevClose * (1 + changePct / 100)).toFixed(2));
      quotes[symbol] = { price, prevClose: holding.prevClose, changePct: Number(changePct.toFixed(2)) };
    }

    sendJson(res, 200, { asOf: new Date().toISOString(), quotes });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/regime') {
    sendJson(res, 200, { regime });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/regime') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { mode } = JSON.parse(body || '{}');
        if (mode !== 'volatile' && mode !== 'quiet') {
          sendJson(res, 400, { error: 'mode must be "volatile" or "quiet"' });
          return;
        }
        regime = mode;
        console.log(`regime set to "${regime}"`);
        sendJson(res, 200, { regime });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => console.log(`portfolio-api listening on http://localhost:${PORT}`));
