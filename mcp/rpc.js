// Autumn — MCP JSON-RPC handling (initialize, tools/list, tools/call)
//   createHandler({ TOOLS, SERVER, instructions }) → async handle(msg) → response object (null for notifications)
//   A tool's run() returns text, or { content: [...] } for other content types.
'use strict';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

module.exports = function createHandler({ TOOLS, SERVER, instructions }) {
  const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  return async function handle(msg) {
    const { id, method, params } = msg || {};
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize': {
          const want = params && params.protocolVersion;
          return reply(id, { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions });
        }
        case 'notifications/initialized': case 'notifications/cancelled': return null;
        case 'ping': return reply(id, {});
        case 'tools/list': return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
        case 'tools/call': {
          const tool = TOOLS.find(t => t.name === (params && params.name));
          if (!tool) return fail(id, -32602, 'Unknown tool: ' + (params && params.name));
          try {
            const out = await tool.run((params && params.arguments) || {});
            if (out && typeof out === 'object' && Array.isArray(out.content)) return reply(id, out);
            return reply(id, { content: [{ type: 'text', text: String(out) }] });
          } catch (e) { return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }); }
        }
        case 'resources/list': return reply(id, { resources: [] });
        case 'prompts/list': return reply(id, { prompts: [] });
        default: return isRequest ? fail(id, -32601, 'Method not found: ' + method) : null;
      }
    } catch (e) { return isRequest ? fail(id, -32603, e.message) : null; }
  };
};
