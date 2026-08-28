# agent-task-worker

External task worker that runs an Agent Task — an ad hoc sub-process
marked `isAgentTask` — on a running Fluxnova BPM engine. An Agent Task
behaves like a real agent: Model, Memory, and Tools, in the spirit of
n8n's AI Agent node.

It polls `POST /external-task/fetchAndLock` for topic `agent-task`, runs
a tool-calling loop against the configured LLM, and completes the task
with the final answer (plus, optionally, conversation memory) written
back as process variables. No engine or BPMN-parser changes are
involved — every task here is an ordinary `bpmn:serviceTask` with
`camunda:type="external"`.

## Setup

```sh
cd agent-task-worker
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY
```

## Run

```sh
npm start
```

Or with env vars inline:

```sh
OPENAI_API_KEY=sk-... node index.js
```

## Config

See `.env.example` for all options (engine REST URL, topic name, poll
interval, lock duration).

## How the agent loop works

An Agent Task container holds two kinds of children:

- Exactly **one orchestrator task** — the "Agent LLM Call" template
  (`camunda:topic="agent-task"`), listed in the container's
  `activeTasksCollection`. This is the only child the engine ever
  schedules.
- Any number of **tool tasks** — either an "Agent Tool (HTTP)" template
  or an "Agent Tool (MCP)" template (both `camunda:topic="agent-tool"`),
  left out of `activeTasksCollection` on purpose. The engine never
  starts these; they exist purely as config for the worker to read.

When the worker locks the orchestrator task, it fetches the deployed
process definition's XML (`GET /process-definition/{id}/xml`, cached
in memory per process definition since that XML never changes), finds
the ad-hoc sub-process containing the orchestrator, and turns every
sibling "Agent Tool (HTTP)" task into a callable OpenAI tool. It then
loops — call the model, and if the model asks for a tool, run it and
feed the result back — until the model gives a final answer or
`Max Iterations` is reached, all inside the handling of that one
external task. The engine sees a single `fetchAndLock` → `complete`,
never the individual loop iterations.

If `Max Iterations` is reached without a final answer, the task still
completes (not a `/failure`) with whatever text the model last
produced, plus an `agentHitMaxIterations: true` output variable so a
downstream gateway can branch on it if needed.

### Tool arguments vs. process variables

Because the engine never enters a tool task, it never evaluates its
`camunda:inputParameter` expressions either — a tool's URL/Headers/Body
Template fields are inert text until the worker's own templating
touches them. `{{argName}}` placeholders are substituted from the
arguments the model supplied for that specific call. Referencing
process variables from inside a tool's config is not supported yet —
a deliberate scope cut, not an oversight.

### Memory

If a task's `Memory Window Size` is greater than 0, the worker reads
the process variable `agentMessages` (if present) as the starting
conversation, and writes it back — trimmed to the last N user/assistant
turns — as part of completing the task. Only clean user/assistant
turns are persisted, never the raw tool-call exchanges from inside the
loop, since replaying an assistant message with `tool_calls` without
fresh matching tool results would violate the chat API's message-order
rules.

## Failure handling

If the LLM call fails, or the task is missing a `prompt`, the worker
reports failure via `POST /external-task/{id}/failure` rather than
crashing — this surfaces as a decrementing `retries` count on the
external task and eventually an incident in Cockpit, the same way any
other engine failure would. Hitting `Max Iterations` is treated as a
soft, expected outcome instead — see above.

## MCP tools

An "Agent Tool (MCP)" task is a *gateway*, not a single tool — it
points at one MCP server (Server Name + Transport + either a Server
URL for `http` or a Command/Command Arguments for `stdio`) and, once
per task execution, the worker connects, runs the `initialize`
handshake, and calls `tools/list`. Every tool the server reports is
flattened into a normal callable tool, name-prefixed with the server
name (`fxrate__get_rate`) to avoid collisions across servers or with
plain HTTP tools. From there it's indistinguishable to the model from
an "Agent Tool (HTTP)" tool — the LLM just sees more functions it can
call, discovered dynamically instead of hand-declared via an Input
Schema field.

Calling the tool routes through `tools/call` on the same connection.
For `stdio` this is a spawned child process talking JSON-RPC over
stdin/stdout (`agent-task-worker/mcp-client.js`); for `http` it's a
JSON-RPC POST per call, same connection details reused for every call
within that task execution. Either way, the connection is opened once
when the orchestrator task is picked up and closed in a `finally`
once the task completes or fails — a `stdio` gateway owns a live
subprocess for the lifetime of one task execution, not the whole
worker process.

This mirrors Camunda's own AI Agent + MCP Client connector design
(ad-hoc sub-process, MCP client as a sibling gateway task, tool
discovery via `tools/list`) — same shape, just implemented directly in
this worker instead of via Camunda Connectors.
