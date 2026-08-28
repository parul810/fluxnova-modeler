import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UI_PORT = Number(process.env.UI_PORT || 4190);
const ENGINE_REST_URL = process.env.ENGINE_REST_URL || 'http://localhost:8080/engine-rest';
const PROCESS_DEFINITION_KEY = process.env.PROCESS_DEFINITION_KEY || 'fx-rate-agent-demo';
const LOG_FILE = path.join(__dirname, 'worker.log');
const INDEX_FILE = path.join(__dirname, 'ui', 'index.html');
const TAIL_INITIAL_LINES = 200;
const TAIL_POLL_MS = 400;

// --- log tailing, broadcast to every connected SSE client --------------

const sseClients = new Set();
let logOffset = 0;

function broadcast(line) {
  for (const res of sseClients) {
    res.write(`data: ${line}\n\n`);
  }
}

function pollLogFile() {
  fs.stat(LOG_FILE, (err, stats) => {
    if (err) return;
    if (stats.size < logOffset) logOffset = 0; // file was truncated/rotated
    if (stats.size === logOffset) return;

    const stream = fs.createReadStream(LOG_FILE, { start: logOffset, end: stats.size - 1, encoding: 'utf8' });
    let buffer = '';
    stream.on('data', (chunk) => { buffer += chunk; });
    stream.on('end', () => {
      logOffset = stats.size;
      buffer.split('\n').filter(Boolean).forEach(broadcast);
    });
  });
}

setInterval(pollLogFile, TAIL_POLL_MS);

function tailInitialLines(callback) {
  fs.readFile(LOG_FILE, 'utf8', (err, content) => {
    if (err) return callback([]);
    const lines = content.split('\n').filter(Boolean);
    callback(lines.slice(-TAIL_INITIAL_LINES));
  });
}

// --- engine proxy --------------------------------------------------------

async function startProcessInstance() {
  const res = await fetch(`${ENGINE_REST_URL}/process-definition/key/${PROCESS_DEFINITION_KEY}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

async function fetchInstanceState(processInstanceId) {
  const res = await fetch(`${ENGINE_REST_URL}/history/process-instance/${processInstanceId}`);
  if (!res.ok) return { state: 'UNKNOWN' };
  return res.json();
}

async function fetchAgentResponse(processInstanceId) {
  const res = await fetch(
    `${ENGINE_REST_URL}/history/variable-instance?processInstanceIdIn=${processInstanceId}&variableName=agentResponse`
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.value ?? null;
}

// --- HTTP server -----------------------------------------------------

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${UI_PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    fs.readFile(INDEX_FILE, (err, content) => {
      if (err) {
        res.writeHead(500).end('index.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');

    tailInitialLines((lines) => lines.forEach((line) => res.write(`data: ${line}\n\n`)));

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/start') {
    try {
      const result = await startProcessInstance();
      sendJson(res, result.ok ? 200 : 502, result.body);
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const processInstanceId = url.searchParams.get('processInstanceId');
    if (!processInstanceId) {
      sendJson(res, 400, { error: 'processInstanceId is required' });
      return;
    }
    try {
      const [instance, agentResponse] = await Promise.all([
        fetchInstanceState(processInstanceId),
        fetchAgentResponse(processInstanceId)
      ]);
      sendJson(res, 200, { state: instance.state || 'UNKNOWN', agentResponse });
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(UI_PORT, () => {
  console.log(`agent-task-worker UI: http://localhost:${UI_PORT}`);
  console.log(`  proxying engine at ${ENGINE_REST_URL}, process definition key "${PROCESS_DEFINITION_KEY}"`);
  console.log(`  tailing ${LOG_FILE}`);
});
