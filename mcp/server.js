#!/usr/bin/env node
// Autumn — MCP server (stdio, newline-delimited JSON-RPC 2.0, no dependencies)
// Lets AI tools (Claude Code, Codex, Gemini CLI, Claude Desktop…) read and edit Autumn projects and fetch the build plan.
// Runs on Node.js, or on Autumn.exe itself with ELECTRON_RUN_AS_NODE=1 (no Node install needed).
// When the Autumn app has the same file open, it reloads the changes live.
'use strict';
const M = require('./model');
const { TOOLS, SERVER, instructions } = require('./tools')(M);
const handle = require('./rpc')({ TOOLS, SERVER, instructions });

const send = msg => { if (msg) process.stdout.write(JSON.stringify(msg) + '\n'); };
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).then(send);
  }
});
process.stdin.on('end', () => setTimeout(() => process.exit(0), 50));
