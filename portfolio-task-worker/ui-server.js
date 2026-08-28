import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UI_PORT = Number(process.env.UI_PORT || 4290);
const ENGINE_REST_URL = process.env.ENGINE_REST_URL || 'http://localhost:8080/engine-rest';
const PORTFOLIO_API_URL = process.env.PORTFOLIO_API_URL || 'http://localhost:4200';
const PROCESS_DEFINITION_KEY = process.env.PROCESS_DEFINITION_KEY || 'morning-portfolio-review';
const REVIEW_TASK_KEY = 'AnalystReview';
const INDEX_FILE = path.join(__dirname, 'ui', 'index.html');

// tail both this worker's log AND the AI worker's log into one merged
// stream, each line tagged with which process emitted it.
const LOG_SOURCES = [
  { name: 'portfolio', file: path.join(__dirname, 'worker.log') },
  { name: 'agent', file: path.join(__dirname, '..', 'agent-task-worker', 'worker.log') }
];
const TAIL_INITIAL_LINES = 150;
const TAIL_POLL_MS = 400;

// --- log tailing ---------------------------------------------------------

const sseClients = new Set();
const offsets = new Map(LOG_SOURCES.map((s) => [s.file, 0]));

function broadcast(line) {
  for (const res of sseClients) res.write(`data: ${line}\n\n`);
}

function pollSource(source) {
  fs.stat(source.file, (err, stats) => {
    if (err) return;
    let offset = offsets.get(source.file) ?? 0;
    if (stats.size < offset) offset = 0;
    if (stats.size === offset) return;

    const stream = fs.createReadStream(source.file, { start: offset, end: stats.size - 1, encoding: 'utf8' });
    let buffer = '';
    stream.on('data', (chunk) => { buffer += chunk; });
    stream.on('end', () => {
      offsets.set(source.file, stats.size);
      buffer.split('\n').filter(Boolean).forEach((line) => broadcast(`[${source.name}] ${line}`));
    });
  });
}

setInterval(() => LOG_SOURCES.forEach(pollSource), TAIL_POLL_MS);

function tailInitialLines(callback) {
  const all = [];
  let pending = LOG_SOURCES.length;

  LOG_SOURCES.forEach((source) => {
    fs.readFile(source.file, 'utf8', (err, content) => {
      if (!err) {
        content.split('\n').filter(Boolean).slice(-TAIL_INITIAL_LINES).forEach((line) => {
          all.push(`[${source.name}] ${line}`);
        });
      }
      if (--pending === 0) callback(all);
    });
  });
}

// --- engine + mock-data proxy --------------------------------------------

async function startProcessInstance() {
  const res = await fetch(`${ENGINE_REST_URL}/process-definition/key/${PROCESS_DEFINITION_KEY}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function fetchInstanceState(processInstanceId) {
  const res = await fetch(`${ENGINE_REST_URL}/history/process-instance/${processInstanceId}`);
  if (!res.ok) return { state: 'UNKNOWN' };
  return res.json();
}

async function fetchVariable(processInstanceId, name) {
  const res = await fetch(`${ENGINE_REST_URL}/history/variable-instance?processInstanceIdIn=${processInstanceId}&variableName=${name}`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.value ?? null;
}

async function fetchPendingReviews() {
  const res = await fetch(`${ENGINE_REST_URL}/task?processDefinitionKey=${PROCESS_DEFINITION_KEY}&taskDefinitionKey=${REVIEW_TASK_KEY}`);
  if (!res.ok) return [];
  const tasks = await res.json();

  return Promise.all(tasks.map(async (task) => {
    const [aiDraftBriefing, flaggedSymbols] = await Promise.all([
      fetchVariable(task.processInstanceId, 'aiDraftBriefing'),
      fetchVariable(task.processInstanceId, 'flaggedSymbols')
    ]);
    return { taskId: task.id, processInstanceId: task.processInstanceId, created: task.created, aiDraftBriefing, flaggedSymbols };
  }));
}

async function completeReview(taskId, decision, text) {
  const finalBriefing = decision === 'approved' ? text : 'Dismissed by analyst - no briefing published.';
  const res = await fetch(`${ENGINE_REST_URL}/task/${taskId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workerId: 'portfolio-ui',
      variables: {
        finalBriefing: { value: finalBriefing, type: 'String' },
        reviewDecision: { value: decision, type: 'String' }
      }
    })
  });
  return { ok: res.ok, status: res.status };
}

async function fetchRecentBriefings() {
  const res = await fetch(
    `${ENGINE_REST_URL}/history/process-instance?processDefinitionKey=${PROCESS_DEFINITION_KEY}&finished=true&sortBy=startTime&sortOrder=desc&maxResults=8`
  );
  if (!res.ok) return [];
  const instances = await res.json();

  return Promise.all(instances.map(async (instance) => {
    const [finalBriefing, hasFlaggedPositions, publishedAt] = await Promise.all([
      fetchVariable(instance.id, 'finalBriefing'),
      fetchVariable(instance.id, 'hasFlaggedPositions'),
      fetchVariable(instance.id, 'publishedAt')
    ]);
    return { processInstanceId: instance.id, endTime: instance.endTime, finalBriefing, hasFlaggedPositions, publishedAt };
  }));
}

async function getRegime() {
  const res = await fetch(`${PORTFOLIO_API_URL}/regime`);
  return res.json();
}

async function setRegime(mode) {
  const res = await fetch(`${PORTFOLIO_API_URL}/regime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  return { ok: res.ok, body: await res.json() };
}

// --- HTTP server -----------------------------------------------------

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${UI_PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    fs.readFile(INDEX_FILE, (err, content) => {
      if (err) { res.writeHead(500).end('index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
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
    if (!processInstanceId) { sendJson(res, 400, { error: 'processInstanceId is required' }); return; }
    try {
      const [instance, finalBriefing, hasFlaggedPositions] = await Promise.all([
        fetchInstanceState(processInstanceId),
        fetchVariable(processInstanceId, 'finalBriefing'),
        fetchVariable(processInstanceId, 'hasFlaggedPositions')
      ]);
      sendJson(res, 200, { state: instance.state || 'UNKNOWN', finalBriefing, hasFlaggedPositions });
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/pending-reviews') {
    try {
      sendJson(res, 200, await fetchPendingReviews());
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/review/')) {
    const taskId = url.pathname.split('/')[3];
    try {
      const { decision, text } = JSON.parse(await readBody(req));
      const result = await completeReview(taskId, decision, text);
      sendJson(res, result.ok ? 200 : 502, { ok: result.ok });
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/recent') {
    try {
      sendJson(res, 200, await fetchRecentBriefings());
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/regime') {
    try {
      sendJson(res, 200, await getRegime());
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/regime') {
    try {
      const { mode } = JSON.parse(await readBody(req));
      const result = await setRegime(mode);
      sendJson(res, result.ok ? 200 : 502, result.body);
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(UI_PORT, () => {
  console.log(`portfolio-task-worker UI: http://localhost:${UI_PORT}`);
  console.log(`  proxying engine at ${ENGINE_REST_URL}, process definition key "${PROCESS_DEFINITION_KEY}"`);
  console.log(`  proxying mock data at ${PORTFOLIO_API_URL}`);
  console.log(`  tailing: ${LOG_SOURCES.map((s) => s.file).join(', ')}`);
});
