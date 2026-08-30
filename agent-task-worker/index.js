import OpenAI from 'openai';
import { XMLParser } from 'fast-xml-parser';
import { McpClient } from './mcp-client.js';
import { trace, truncate, redactHeaders } from './log.js';

const ENGINE_REST_URL = process.env.ENGINE_REST_URL || 'http://localhost:8080/engine-rest';
const TOPIC_NAME = process.env.TOPIC_NAME || 'agent-task';
const WORKER_ID = process.env.WORKER_ID || 'agent-task-worker';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const LOCK_DURATION_MS = Number(process.env.LOCK_DURATION_MS || 60000);
const MAX_TASKS = Number(process.env.MAX_TASKS || 1);
const DEFAULT_MODEL = 'gpt-4.1';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_MAX_ITERATIONS = 6;
const AGENT_TOOL_HTTP_TEMPLATE_ID = 'org.fluxnova.example.AgentToolHttp';
const AGENT_TOOL_MCP_TEMPLATE_ID = 'org.fluxnova.example.AgentToolMcp';
const TOOL_RESULT_CHAR_LIMIT = 4000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. See .env.example.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['bpmn:serviceTask', 'bpmn:adHocSubProcess', 'camunda:inputParameter'].includes(name)
});

// processDefinitionId -> parsed BPMN XML. A deployed definition's XML never
// changes, so this is safe to keep for the lifetime of the process.
const processXmlCache = new Map();

async function fetchAndLock() {
  const res = await fetch(`${ENGINE_REST_URL}/external-task/fetchAndLock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workerId: WORKER_ID,
      maxTasks: MAX_TASKS,
      usePriority: true,
      // No `variables` filter: the set of variables an Agent Task cares about
      // (memory, tool config, etc.) keeps growing, so fetch everything.
      topics: [
        {
          topicName: TOPIC_NAME,
          lockDuration: LOCK_DURATION_MS
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`fetchAndLock failed: ${res.status} ${await res.text()}`);
  }

  const tasks = await res.json();
  if (tasks.length) {
    trace('ENGINE', `<- POST /external-task/fetchAndLock locked ${tasks.length} task(s): ${tasks.map((t) => `${t.id} (${t.activityId})`).join(', ')}`);
  }
  return tasks;
}

function toTypedVariables(variables) {
  const typed = {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === 'boolean') {
      typed[name] = { value, type: 'Boolean' };
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
    body: JSON.stringify({
      workerId: WORKER_ID,
      variables: toTypedVariables(variables)
    })
  });

  if (!res.ok) {
    throw new Error(`complete failed: ${res.status} ${await res.text()}`);
  }
  trace('ENGINE', `<- POST /external-task/${taskId}/complete 204`);
}

async function fail(taskId, errorMessage, errorDetails, retries = 2, retryTimeout = 5000) {
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

function parseIntWithFallback(raw, fallback, { allowZero = true } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (!allowZero && n === 0) return fallback;
  return Math.floor(n);
}

// --- Tool discovery -----------------------------------------------------
//
// Tool children live inside the same Agent Task container as plain BPMN
// service tasks, but the engine never schedules them (they're excluded from
// the container's activeTasksCollection). We read the deployed process XML
// once per process definition, find the ad-hoc sub-process that contains
// this orchestrator task, and treat every *other* service task in it that
// carries the "Agent Tool (HTTP)" element template as a callable tool.

function collectByTag(node, tag, acc = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectByTag(item, tag, acc);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === tag) {
      for (const item of Array.isArray(value) ? value : [value]) acc.push(item);
    }
    collectByTag(value, tag, acc);
  }
  return acc;
}

async function getParsedProcessXml(processDefinitionId) {
  if (processXmlCache.has(processDefinitionId)) {
    trace('ENGINE', `process definition XML for ${processDefinitionId} (cache hit)`);
    return processXmlCache.get(processDefinitionId);
  }

  trace('ENGINE', `-> GET /process-definition/${processDefinitionId}/xml`);
  const res = await fetch(`${ENGINE_REST_URL}/process-definition/${processDefinitionId}/xml`);
  if (!res.ok) {
    throw new Error(`fetching process definition XML failed: ${res.status} ${await res.text()}`);
  }

  const { bpmn20Xml } = await res.json();
  trace('ENGINE', `<- GET /process-definition/${processDefinitionId}/xml (${bpmn20Xml.length} chars, cached for this process definition)`);
  const parsed = xmlParser.parse(bpmn20Xml);
  processXmlCache.set(processDefinitionId, parsed);
  return parsed;
}

function extractInputParameters(serviceTaskNode) {
  const list = serviceTaskNode?.['bpmn:extensionElements']?.['camunda:inputOutput']?.['camunda:inputParameter'] || [];
  const params = {};
  for (const entry of list) {
    const name = entry?.['@_name'];
    if (!name) continue;
    params[name] = typeof entry === 'object' ? (entry['#text'] ?? '') : String(entry);
  }
  return params;
}

function buildHttpToolFromServiceTask(taskNode) {
  const params = extractInputParameters(taskNode);
  if (!params.toolName || !params.url) return null;

  let parameters;
  try {
    parameters = JSON.parse(params.inputSchema || '{}');
  } catch (err) {
    console.error(`Tool "${params.toolName}": invalid Input Schema JSON, using an empty schema:`, err.message);
    parameters = { type: 'object', properties: {} };
  }

  return {
    kind: 'http',
    name: params.toolName,
    description: params.toolDescription || '',
    parameters,
    method: (params.httpMethod || 'GET').toUpperCase(),
    url: params.url,
    headersTemplate: params.headers,
    bodyTemplate: params.bodyTemplate
  };
}

function buildMcpGatewayFromServiceTask(taskNode) {
  const params = extractInputParameters(taskNode);
  if (!params.mcpServerName) return null;

  let headers;
  if (params.mcpHeaders) {
    try {
      headers = JSON.parse(params.mcpHeaders);
    } catch (err) {
      console.error(`MCP server "${params.mcpServerName}": invalid Headers JSON, ignoring:`, err.message);
    }
  }

  return {
    serverName: params.mcpServerName,
    transport: (params.mcpTransport || 'http').toLowerCase(),
    url: params.mcpServerUrl,
    headers,
    command: params.mcpCommand,
    args: (params.mcpArgs || '').split(' ').filter(Boolean)
  };
}

async function discoverTools(processDefinitionId, orchestratorActivityId) {
  if (!processDefinitionId || !orchestratorActivityId) return { httpTools: [], mcpGateways: [] };

  const xmlDoc = await getParsedProcessXml(processDefinitionId);
  const adHocSubProcesses = collectByTag(xmlDoc, 'bpmn:adHocSubProcess');

  const container = adHocSubProcesses.find((sp) =>
    collectByTag(sp, 'bpmn:serviceTask').some((t) => t['@_id'] === orchestratorActivityId)
  );
  if (!container) return { httpTools: [], mcpGateways: [] };

  const toolTasks = collectByTag(container, 'bpmn:serviceTask').filter((t) => t['@_id'] !== orchestratorActivityId);

  const httpTools = toolTasks
    .filter((t) => t['@_camunda:modelerTemplate'] === AGENT_TOOL_HTTP_TEMPLATE_ID)
    .map(buildHttpToolFromServiceTask)
    .filter(Boolean);

  const mcpGateways = toolTasks
    .filter((t) => t['@_camunda:modelerTemplate'] === AGENT_TOOL_MCP_TEMPLATE_ID)
    .map(buildMcpGatewayFromServiceTask)
    .filter(Boolean);

  return { httpTools, mcpGateways };
}

// --- MCP tool expansion -----------------------------------------------
//
// Each MCP gateway child represents one server, not one tool: we connect
// once, call tools/list, and flatten every tool it reports into a normal
// callable tool (name-prefixed with the server name to avoid collisions
// across servers). Connections are kept open for the lifetime of the one
// external-task handling that discovered them and closed in handleTask's
// `finally`, since a stdio gateway owns a live child process.

async function expandMcpGateways(gateways) {
  const expandedTools = [];
  const clients = [];

  for (const gateway of gateways) {
    trace('AGENT-TASK', `connecting to MCP gateway "${gateway.serverName}" (${gateway.transport})`);
    const client = new McpClient(gateway);
    try {
      await client.connect();
      const remoteTools = await client.listTools();
      clients.push(client);

      for (const remoteTool of remoteTools) {
        expandedTools.push({
          kind: 'mcp',
          name: `${gateway.serverName}__${remoteTool.name}`,
          description: remoteTool.description || '',
          parameters: remoteTool.inputSchema || { type: 'object', properties: {} },
          client,
          remoteName: remoteTool.name
        });
      }
    } catch (err) {
      console.error(`MCP server "${gateway.serverName}": connect/discover failed, skipping:`, err.message);
      client.close();
    }
  }

  return { expandedTools, clients };
}

// --- Tool invocation ------------------------------------------------------

function interpolate(template, args) {
  if (!template) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (args[key] !== undefined ? String(args[key]) : ''));
}

async function invokeTool(tool, args) {
  if (tool.kind === 'mcp') {
    trace('AGENT-TASK', `dispatching "${tool.name}" -> MCP gateway "${tool.client.serverName}" tools/call "${tool.remoteName}" args=${truncate(args)}`);
    const text = await tool.client.callTool(tool.remoteName, args);
    return text.slice(0, TOOL_RESULT_CHAR_LIMIT);
  }

  const url = interpolate(tool.url, args);
  const body = ['GET', 'DELETE'].includes(tool.method) ? undefined : interpolate(tool.bodyTemplate, args);

  let headers = { 'Content-Type': 'application/json' };
  if (tool.headersTemplate) {
    try {
      headers = { ...headers, ...JSON.parse(interpolate(tool.headersTemplate, args)) };
    } catch (err) {
      console.error(`Tool "${tool.name}": invalid Headers JSON, ignoring:`, err.message);
    }
  }

  trace('HTTP-TOOL', `-> ${tool.method} ${url} headers=${truncate(redactHeaders(headers))} body=${truncate(body)}`);
  const res = await fetch(url, { method: tool.method, headers, body });
  const text = await res.text();
  trace('HTTP-TOOL', `<- ${tool.method} ${url} HTTP ${res.status} body=${truncate(text)}`);

  if (!res.ok) {
    return `Tool call failed with HTTP ${res.status}: ${text.slice(0, TOOL_RESULT_CHAR_LIMIT)}`;
  }
  return text.slice(0, TOOL_RESULT_CHAR_LIMIT);
}

// --- Memory -----------------------------------------------------------
//
// Only plain user/assistant turns are persisted, never the raw tool-call
// plumbing — replaying a stored assistant message with tool_calls without
// fresh matching tool results would violate the chat API's message-sequence
// rules. Memory is scoped to the process instance via the agentMessages
// variable, the same mechanism outputVariable already uses.
//
// The serialized result also has to fit in a plain engine String variable
// (commonly a ~4000-char DB column) — a single verbose prompt or reply is
// enough to blow that budget on its own, and it only gets worse turn over
// turn, so this both truncates individual messages and, as a last resort,
// drops the oldest ones until the whole thing fits.

const MEMORY_MESSAGE_CHAR_LIMIT = 1200;
const MEMORY_JSON_CHAR_BUDGET = 3500;

function cleanConversationMessages(messages) {
  return messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls && m.content))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' && m.content.length > MEMORY_MESSAGE_CHAR_LIMIT
        ? `${m.content.slice(0, MEMORY_MESSAGE_CHAR_LIMIT)}…(truncated for memory)`
        : m.content
    }));
}

function trimToWindow(cleanMessages, windowSize) {
  let windowed = cleanMessages.slice(-(windowSize * 2));
  while (windowed.length > 0 && JSON.stringify(windowed).length > MEMORY_JSON_CHAR_BUDGET) {
    windowed = windowed.slice(1);
  }
  return windowed;
}

// --- Task handling ------------------------------------------------------

async function handleTask(task) {
  const { id, variables, processDefinitionId, activityId } = task;

  const prompt = variableValue(variables, 'prompt');
  const systemPrompt = variableValue(variables, 'systemPrompt');
  const model = variableValue(variables, 'model') || DEFAULT_MODEL;
  const maxTokensRaw = variableValue(variables, 'maxTokens');
  const outputVariable = variableValue(variables, 'outputVariable') || 'agentResponse';
  const maxIterations = parseIntWithFallback(variableValue(variables, 'maxIterations'), DEFAULT_MAX_ITERATIONS, { allowZero: false });
  const memoryWindowSize = parseIntWithFallback(variableValue(variables, 'memoryWindowSize'), 0);
  const priorMessagesRaw = variableValue(variables, 'agentMessages');

  if (!prompt || !prompt.trim()) {
    await fail(id, 'Agent Task is missing a prompt', 'The "prompt" input parameter was empty', 0);
    return;
  }

  const maxTokens = Number.isFinite(Number(maxTokensRaw)) && Number(maxTokensRaw) > 0
    ? Number(maxTokensRaw)
    : DEFAULT_MAX_TOKENS;

  let tools = [];
  let mcpClients = [];
  try {
    const { httpTools, mcpGateways } = await discoverTools(processDefinitionId, activityId);
    const { expandedTools, clients } = await expandMcpGateways(mcpGateways);
    tools = [...httpTools, ...expandedTools];
    mcpClients = clients;
  } catch (err) {
    console.error(`Task ${id}: tool discovery failed, continuing without tools:`, err.message);
  }

  const openAiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (memoryWindowSize > 0 && priorMessagesRaw) {
    try {
      messages.push(...JSON.parse(priorMessagesRaw));
    } catch (err) {
      console.error(`Task ${id}: could not parse prior agentMessages, starting fresh:`, err.message);
    }
  }
  messages.push({ role: 'user', content: prompt });

  let finalText = '';
  let hitMaxIterations = false;

  trace('AGENT-TASK', `task ${id} (activity ${activityId}): starting loop with ${tools.length} tool(s) available: ${tools.map((t) => t.name).join(', ') || '(none)'}`);

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      trace('LLM', `-> POST /chat/completions iteration=${iteration + 1}/${maxIterations} model=${model} messages=${messages.length} tools=${openAiTools.length}`);
      const response = await openai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages,
        ...(openAiTools.length ? { tools: openAiTools, tool_choice: 'auto' } : {})
      });

      const message = response.choices[0]?.message;
      if (!message) break;

      const toolCalls = message.tool_calls || [];
      trace('LLM', `<- POST /chat/completions iteration=${iteration + 1}/${maxIterations} finish_reason=${response.choices[0]?.finish_reason} tool_calls=${toolCalls.map((c) => c.function.name).join(', ') || '(none)'} content=${truncate(message.content)}`);

      if (toolCalls.length === 0) {
        finalText = message.content || '';
        messages.push(message);
        break;
      }

      messages.push(message);

      for (const call of toolCalls) {
        const tool = tools.find((t) => t.name === call.function.name);
        let resultText;

        if (!tool) {
          trace('AGENT-TASK', `model called unknown tool "${call.function.name}"`);
          resultText = `No such tool: ${call.function.name}`;
        } else {
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch (err) {
            console.error(`Task ${id}: model sent malformed arguments for tool "${tool.name}":`, err.message);
          }
          try {
            resultText = await invokeTool(tool, args);
            trace('AGENT-TASK', `tool "${tool.name}" -> result=${truncate(resultText)}`);
          } catch (err) {
            resultText = `Tool call failed: ${err.message}`;
            trace('AGENT-TASK', `tool "${tool.name}" -> error=${err.message}`);
          }
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: resultText });
      }

      if (iteration === maxIterations - 1) {
        hitMaxIterations = true;
      }
    }

    if (hitMaxIterations) {
      messages.push({ role: 'assistant', content: finalText });
    }

    const outputVariables = { [outputVariable]: finalText };
    if (hitMaxIterations) {
      outputVariables.agentHitMaxIterations = true;
    }
    if (memoryWindowSize > 0) {
      outputVariables.agentMessages = JSON.stringify(trimToWindow(cleanConversationMessages(messages), memoryWindowSize));
    }

    await complete(id, outputVariables);
    console.log(`Completed task ${id} (topic=${TOPIC_NAME}), wrote "${outputVariable}"${hitMaxIterations ? ' [hit max iterations]' : ''}`);
  } catch (err) {
    console.error(`Task ${id} failed:`, err.message);
    await fail(id, 'LLM call failed', err.message);
  } finally {
    if (mcpClients.length) {
      trace('AGENT-TASK', `closing ${mcpClients.length} MCP client connection(s)`);
    }
    mcpClients.forEach((client) => client.close());
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
  console.log(`agent-task-worker polling ${ENGINE_REST_URL} for topic "${TOPIC_NAME}"`);

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
