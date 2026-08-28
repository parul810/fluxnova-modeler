import { spawn } from 'child_process';
import { trace, truncate, redactHeaders } from './log.js';

const PROTOCOL_VERSION = '2024-11-05';

/**
 * Minimal MCP client: JSON-RPC 2.0 over either a spawned stdio subprocess
 * (messages newline-delimited on stdin/stdout) or a remote HTTP endpoint
 * (one POST per request, response either a plain JSON body or a single
 * `text/event-stream` frame). Streaming/partial results aren't handled —
 * this worker only ever needs the final result of `tools/list`/`tools/call`.
 */
export class McpClient {

  constructor({ serverName, transport, url, headers, command, args }) {
    this.serverName = serverName;
    this.transport = transport;
    this.url = url;
    this.headers = headers || {};
    this.command = command;
    this.args = args || [];
    this._nextId = 1;
    this._child = null;
    this._pending = new Map();
    this._buffer = '';
  }

  _tag() {
    return `MCP:${this.serverName}:${this.transport}`;
  }

  async connect() {
    if (this.transport === 'stdio') {
      if (!this.command) {
        throw new Error(`MCP server "${this.serverName}": stdio transport requires a Command`);
      }
      trace(this._tag(), `spawn ${this.command} ${this.args.join(' ')}`);
      this._child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this._child.stdout.on('data', (chunk) => this._onStdout(chunk));
      this._child.stderr.on('data', (chunk) => {
        console.error(`mcp[${this.serverName}] stderr: ${chunk.toString().trim()}`);
      });
      this._child.on('error', (err) => this._rejectAllPending(err));
      this._child.on('exit', (code) => {
        trace(this._tag(), `subprocess exited (code ${code})`);
        if (this._pending.size) {
          this._rejectAllPending(new Error(`MCP server "${this.serverName}" exited (code ${code}) with requests still pending`));
        }
      });
    } else if (!this.url) {
      throw new Error(`MCP server "${this.serverName}": http transport requires a Server URL`);
    } else {
      trace(this._tag(), `connecting to ${this.url} headers=${truncate(redactHeaders(this.headers))}`);
    }

    await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'fluxnova-agent-task-worker', version: '1.0.0' }
    });
    this._notify('notifications/initialized', {});
  }

  async listTools() {
    const result = await this._request('tools/list', {});
    const tools = result.tools || [];
    trace(this._tag(), `discovered ${tools.length} tool(s): ${tools.map((t) => t.name).join(', ')}`);
    return tools;
  }

  async callTool(name, args) {
    const result = await this._request('tools/call', { name, arguments: args });
    const text = this._extractText(result);
    if (result.isError) {
      throw new Error(text || `MCP tool "${name}" reported an error`);
    }
    return text;
  }

  close() {
    if (this._child) {
      trace(this._tag(), 'terminating subprocess');
      this._child.kill();
      this._child = null;
    }
    this._rejectAllPending(new Error(`MCP client "${this.serverName}" closed`));
  }

  _extractText(result) {
    const content = result?.content || [];
    return content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
  }

  _rejectAllPending(err) {
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
  }

  _onStdout(chunk) {
    this._buffer += chunk.toString();
    let idx;
    while ((idx = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);
      if (!line) continue;
      try {
        this._handleMessage(JSON.parse(line));
      } catch (err) {
        console.error(`mcp[${this.serverName}] could not parse message, ignoring:`, err.message);
      }
    }
  }

  _handleMessage(msg) {
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message || 'MCP error'));
    else pending.resolve(msg.result);
  }

  async _request(method, params) {
    const id = this._nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const transportLabel = this.transport === 'stdio' ? 'stdin/stdout' : 'HTTP POST';

    trace(this._tag(), `-> [${transportLabel}] id=${id} method=${method} params=${truncate(params)}`);

    if (this.transport === 'stdio') {
      const promise = new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
      this._child.stdin.write(JSON.stringify(payload) + '\n');
      const result = await promise;
      trace(this._tag(), `<- [${transportLabel}] id=${id} method=${method} result=${truncate(result)}`);
      return result;
    }

    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...this.headers },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) {
      trace(this._tag(), `<- [${transportLabel}] id=${id} method=${method} HTTP ${res.status} (error)`);
      throw new Error(`MCP server "${this.serverName}" HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = this._parseHttpResponse(text, res.headers.get('content-type'));
    if (json.error) {
      trace(this._tag(), `<- [${transportLabel}] id=${id} method=${method} error=${truncate(json.error)}`);
      throw new Error(json.error.message || 'MCP error');
    }
    trace(this._tag(), `<- [${transportLabel}] id=${id} method=${method} result=${truncate(json.result)}`);
    return json.result;
  }

  _notify(method, params) {
    const payload = { jsonrpc: '2.0', method, params };
    const transportLabel = this.transport === 'stdio' ? 'stdin' : 'HTTP POST';
    trace(this._tag(), `-> [${transportLabel}] notify method=${method}`);

    if (this.transport === 'stdio') {
      this._child.stdin.write(JSON.stringify(payload) + '\n');
    } else {
      fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
  }

  _parseHttpResponse(text, contentType) {
    if (contentType && contentType.includes('text/event-stream')) {
      const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
      return JSON.parse(dataLine ? dataLine.slice(5).trim() : '{}');
    }
    return JSON.parse(text);
  }
}
