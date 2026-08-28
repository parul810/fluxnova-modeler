import { trace, truncate } from './log.js';

const ENGINE_REST_URL = process.env.ENGINE_REST_URL || 'http://localhost:8080/engine-rest';
const PORTFOLIO_API_URL = process.env.PORTFOLIO_API_URL || 'http://localhost:4200';
const WORKER_ID = process.env.WORKER_ID || 'portfolio-task-worker';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const LOCK_DURATION_MS = Number(process.env.LOCK_DURATION_MS || 60000);
const MAX_TASKS = Number(process.env.MAX_TASKS || 5);
const FLAG_THRESHOLD_PCT = Number(process.env.FLAG_THRESHOLD_PCT || 5);

const TOPICS = ['fetch-portfolio', 'fetch-market-data', 'compute-risk-metrics', 'build-routine-summary', 'publish-briefing'];

// --- engine REST -----------------------------------------------------

async function fetchAndLock() {
  const res = await fetch(`${ENGINE_REST_URL}/external-task/fetchAndLock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workerId: WORKER_ID,
      maxTasks: MAX_TASKS,
      usePriority: true,
      topics: TOPICS.map((topicName) => ({ topicName, lockDuration: LOCK_DURATION_MS }))
    })
  });

  if (!res.ok) {
    throw new Error(`fetchAndLock failed: ${res.status} ${await res.text()}`);
  }

  const tasks = await res.json();
  if (tasks.length) {
    trace('ENGINE', `<- POST /external-task/fetchAndLock locked ${tasks.length} task(s): ${tasks.map((t) => `${t.id} (${t.topicName})`).join(', ')}`);
  }
  return tasks;
}

function toTypedVariables(variables) {
  const typed = {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === 'boolean') {
      typed[name] = { value, type: 'Boolean' };
    } else if (typeof value === 'number') {
      typed[name] = { value, type: 'Double' };
    } else {
      typed[name] = { value: String(value), type: 'String' };
    }
  }
  return typed;
}

async function complete(taskId, variables) {
  trace('ENGINE', `-> POST /external-task/${taskId}/complete variables=${truncate(Object.keys(variables))}`);
  const res = await fetch(`${ENGINE_REST_URL}/external-task/${taskId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: WORKER_ID, variables: toTypedVariables(variables) })
  });

  if (!res.ok) {
    throw new Error(`complete failed: ${res.status} ${await res.text()}`);
  }
  trace('ENGINE', `<- POST /external-task/${taskId}/complete 204`);
}

async function fail(taskId, errorMessage, errorDetails, retries = 0, retryTimeout = 5000) {
  trace('ENGINE', `-> POST /external-task/${taskId}/failure errorMessage=${truncate(errorMessage)}`);
  const res = await fetch(`${ENGINE_REST_URL}/external-task/${taskId}/failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workerId: WORKER_ID,
      errorMessage: String(errorMessage).slice(0, 500),
      errorDetails: String(errorDetails || errorMessage),
      retries,
      retryTimeout
    })
  });

  if (!res.ok) {
    console.error(`failure report failed: ${res.status} ${await res.text()}`);
  }
}

function variableValue(variables, name) {
  const variable = variables?.[name];
  return variable ? variable.value : undefined;
}

// --- topic handlers ----------------------------------------------------
//
// Every handler here is plain, deterministic code — no LLM involved. The
// only AI step in this process (AI Briefing) is a separate Agent Task
// container handled entirely by the existing agent-task-worker on the
// "agent-task" topic; this worker never touches that topic.

async function handleFetchPortfolio() {
  trace('PORTFOLIO-API', `-> GET ${PORTFOLIO_API_URL}/portfolio`);
  const res = await fetch(`${PORTFOLIO_API_URL}/portfolio`);
  if (!res.ok) throw new Error(`portfolio-api /portfolio failed: ${res.status}`);
  const data = await res.json();
  trace('PORTFOLIO-API', `<- GET /portfolio ${data.positions.length} position(s)`);
  return { portfolio: JSON.stringify(data.positions) };
}

async function handleFetchMarketData(task) {
  const portfolio = JSON.parse(variableValue(task.variables, 'portfolio') || '[]');
  const symbols = portfolio.map((p) => p.symbol).join(',');
  trace('PORTFOLIO-API', `-> GET ${PORTFOLIO_API_URL}/quotes?symbols=${symbols}`);
  const res = await fetch(`${PORTFOLIO_API_URL}/quotes?symbols=${encodeURIComponent(symbols)}`);
  if (!res.ok) throw new Error(`portfolio-api /quotes failed: ${res.status}`);
  const data = await res.json();
  trace('PORTFOLIO-API', `<- GET /quotes ${truncate(data.quotes)}`);
  return { quotes: JSON.stringify(data.quotes) };
}

function handleComputeRiskMetrics(task) {
  const portfolio = JSON.parse(variableValue(task.variables, 'portfolio') || '[]');
  const quotes = JSON.parse(variableValue(task.variables, 'quotes') || '{}');

  let totalValue = 0;
  let prevTotalValue = 0;

  const positionsMetrics = portfolio
    .filter((pos) => quotes[pos.symbol])
    .map((pos) => {
      const q = quotes[pos.symbol];
      const marketValue = pos.quantity * q.price;
      const prevValue = pos.quantity * q.prevClose;
      totalValue += marketValue;
      prevTotalValue += prevValue;

      return {
        symbol: pos.symbol,
        name: pos.name,
        quantity: pos.quantity,
        price: q.price,
        prevClose: q.prevClose,
        changePct: q.changePct,
        marketValue: Number(marketValue.toFixed(2)),
        unrealizedPnl: Number(((q.price - pos.avgCost) * pos.quantity).toFixed(2)),
        flagged: Math.abs(q.changePct) >= FLAG_THRESHOLD_PCT
      };
    });

  positionsMetrics.forEach((p) => {
    p.weightPct = Number((p.marketValue / totalValue * 100).toFixed(1));
  });

  const flagged = positionsMetrics.filter((p) => p.flagged);
  const portfolioDayChangePct = Number(((totalValue - prevTotalValue) / prevTotalValue * 100).toFixed(2));

  trace('RISK-ENGINE', `computed metrics for ${positionsMetrics.length} position(s), ${flagged.length} flagged (>${FLAG_THRESHOLD_PCT}% move): ${flagged.map((p) => p.symbol).join(', ') || '(none)'}`);

  return {
    positionsMetrics: JSON.stringify(positionsMetrics),
    flaggedSymbols: flagged.map((p) => p.symbol).join(','),
    hasFlaggedPositions: flagged.length > 0,
    portfolioTotalValue: Number(totalValue.toFixed(2)),
    portfolioDayChangePct
  };
}

function handleBuildRoutineSummary(task) {
  const positionsMetrics = JSON.parse(variableValue(task.variables, 'positionsMetrics') || '[]');
  const totalValue = Number(variableValue(task.variables, 'portfolioTotalValue') || 0);
  const dayChangePct = Number(variableValue(task.variables, 'portfolioDayChangePct') || 0);

  const moves = positionsMetrics.map((p) => `${p.symbol} ${p.changePct >= 0 ? '+' : ''}${p.changePct}%`).join(', ');
  const finalBriefing = `Routine morning check - no positions moved more than ${FLAG_THRESHOLD_PCT}% overnight. `
    + `Portfolio value $${totalValue.toLocaleString('en-US')}, day change ${dayChangePct >= 0 ? '+' : ''}${dayChangePct}%. `
    + `Moves: ${moves}.`;

  trace('RISK-ENGINE', `no flagged positions - built routine summary, skipping AI briefing and analyst review`);
  return { finalBriefing, requiresReview: false };
}

function handlePublishBriefing(task) {
  const finalBriefing = variableValue(task.variables, 'finalBriefing') || '(no briefing content)';
  trace('PUBLISH', `briefing published: ${truncate(finalBriefing)}`);
  return { publishedAt: new Date().toISOString() };
}

async function handleTask(task) {
  trace('AGENT-TASK', `task ${task.id} (topic ${task.topicName})`);

  try {
    let outputVariables;
    switch (task.topicName) {
      case 'fetch-portfolio':
        outputVariables = await handleFetchPortfolio();
        break;
      case 'fetch-market-data':
        outputVariables = await handleFetchMarketData(task);
        break;
      case 'compute-risk-metrics':
        outputVariables = handleComputeRiskMetrics(task);
        break;
      case 'build-routine-summary':
        outputVariables = handleBuildRoutineSummary(task);
        break;
      case 'publish-briefing':
        outputVariables = handlePublishBriefing(task);
        break;
      default:
        throw new Error(`no handler for topic "${task.topicName}"`);
    }

    await complete(task.id, outputVariables);
    console.log(`Completed task ${task.id} (topic=${task.topicName})`);
  } catch (err) {
    console.error(`Task ${task.id} (topic=${task.topicName}) failed:`, err.message);
    await fail(task.id, `${task.topicName} failed`, err.message);
  }
}

async function pollOnce() {
  const tasks = await fetchAndLock();
  for (const task of tasks) {
    await handleTask(task);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`portfolio-task-worker polling ${ENGINE_REST_URL} for topics: ${TOPICS.join(', ')}`);
  console.log(`  mock data at ${PORTFOLIO_API_URL}, flag threshold ${FLAG_THRESHOLD_PCT}%`);

  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      console.error('poll cycle failed:', err.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main();
