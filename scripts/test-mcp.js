#!/usr/bin/env node
// End-to-end check of the MCP server over stdio, in a throw-away WorkFlow folder (your real projects are never touched).
//   node scripts/test-mcp.js                 → runs the server with this Node
//   node scripts/test-mcp.js --exe <Autumn>  → runs it with Autumn.exe as Node (ELECTRON_RUN_AS_NODE=1), and tests PDF export
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exeIdx = process.argv.indexOf('--exe'), exe = exeIdx > 0 ? process.argv[exeIdx + 1] : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-mcp-test-'));
const wf = path.join(tmp, 'WorkFlow'); fs.mkdirSync(wf);
const env = { ...process.env, AUTUMN_WORKFLOW: wf, APPDATA: path.join(tmp, 'appdata') };
if (exe) env.ELECTRON_RUN_AS_NODE = '1';
const server = path.join(__dirname, '..', 'mcp', 'server.js');
const child = spawn(exe || process.execPath, [server], { env, stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '', seq = 0; const waiting = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); waiting.delete(m.id); } });
const rpc = (method, params) => new Promise(res => { const id = ++seq; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result.content[0].text; if (r.result.isError) throw new Error(`${name}: ${t}`); return t; };

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${info && !ok ? ' — ' + info : ''}`); };

(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  check('initialize', init.result.serverInfo.name === 'autumn');
  const list = await rpc('tools/list');
  const names = list.result.tools.map(t => t.name);
  check('tools/list has 21 tools', names.length === 21, names.join(','));
  check('new project', /Created/.test(await call('autumn_new_project', { name: 'Test App' })));
  check('file exists in WorkFlow', fs.existsSync(path.join(wf, 'Test App.autumn.json')));
  check('list projects', /Test App/.test(await call('autumn_list_projects')));
  const st = await call('autumn_status', { file: 'Test App' });
  check('status shows AI Rules', /AI Rules/.test(st) && /Never hard-code secrets/.test(st));
  await call('autumn_update_node', { file: 'Test App', node: 'Test App', body: 'A tiny CLI that greets people.', spec: { stack: 'Node 20', output: '~/code/greet', run: 'node index.js' } });
  const add = await call('autumn_add_nodes', { file: 'Test App', nodes: [
    { type: 'feature', title: 'Greet by name', body: 'Read the name from argv and print "Hello, <name>!"', after: 'Test App', spec: { acceptance: '- prints the greeting\n- no name → usage text' } },
    { type: 'condition', title: 'Name given?', after: 'Greet by name', spec: { expr: 'process.argv[2]' } },
    { type: 'function', title: 'greet', after: 'Name given?', port: 'True', spec: { signature: 'greet(name: string): string' } },
    { type: 'ending', title: 'v1', after: 'greet' },
    { type: 'prompt', title: 'No dependencies', body: 'Use only the Node standard library.' },
  ] });
  check('add nodes with after/port', /Added 5 nodes/.test(add) && /Name given\? \[True\]/.test(add), add);
  check('link prompt → node (auto ai)', /\(ai,/.test(await call('autumn_link', { file: 'Test App', from: 'No dependencies', to: 'greet' })));
  await call('autumn_set_data', { file: 'Test App', node: 'greet', data: { maxLength: 40, polite: true } });
  const plan = await call('autumn_build_plan', { file: 'Test App' });
  check('build plan: rules + settings', /AI Rules/.test(plan) && /Output folder:\*\* ~\/code\/greet/.test(plan), plan.slice(0, 400));
  check('build plan: steps in order', plan.indexOf('Greet by name') < plan.indexOf('Name given?') && plan.indexOf('Name given?') < plan.indexOf('### 4. [Function] greet'), '');
  check('build plan: linked prompt under step', /No dependencies/.test(plan.slice(plan.indexOf('[Function] greet'))));
  check('build plan: data as JSON', /"maxLength": 40/.test(plan));
  check('read board outline', /\[Function\] greet/.test(await call('autumn_read_board', { file: 'Test App' })));
  check('search', /Greet by name/.test(await call('autumn_search', { file: 'Test App', query: 'argv' })));
  check('status done', /done/.test(await call('autumn_update_node', { file: 'Test App', node: 'Greet by name', status: 'done' })));
  await call('autumn_add_nodes', { file: 'Test App', nodes: [{ type: 'lang', title: 'Language', spec: { language: 'JavaScript', version: 'Node 20' } }] });
  check('programming language in plan', /Programming language:\*\* JavaScript \(Node 20\)/.test(await call('autumn_build_plan', { file: 'Test App' })));
  const res = await call('autumn_report_result', { file: 'Test App', node: 'greet', status: 'pass', value: 'Hello, Ann!', output: '$ node index.js Ann\nHello, Ann!', by: 'test' });
  check('report result (creates Result node)', /new Result node/.test(res) && /✓ Pass — Hello, Ann!/.test(res), res);
  const res2 = await call('autumn_report_result', { file: 'Test App', node: 'greet', status: 'fail', value: 'crash' });
  check('report again reuses the Result node', !/new Result node/.test(res2) && /✗ Fail — crash/.test(res2), res2);
  check('result in outline + plan', /result: ✗ Fail — crash/.test(await call('autumn_read_board', { file: 'Test App' })) && /Last result:\*\* ✗ Fail — crash/.test(await call('autumn_build_plan', { file: 'Test App' })));
  const fx = await call('autumn_report_result', { file: 'Test App', node: 'greet', status: 'fail', value: 'TypeError', fixes: ['greet(name) → greet(String(name))'] });
  const pj = () => JSON.parse(fs.readFileSync(path.join(wf, 'Test App.autumn.json'), 'utf8')).boards[0];
  const iss = pj().nodes.find(n => n.type === 'bug');
  check('wrong result → fixes in an Issue node next to it', /Issue node "Fix: Result: greet"/.test(fx) && iss && iss.body === 'greet(name) → greet(String(name))' && pj().nodes.find(n => n.title === 'greet').spec.signature === 'greet(name: string): string', fx);
  const ok2 = await call('autumn_report_result', { file: 'Test App', node: 'greet', status: 'pass', value: 'Hello, Ann!' });
  check('passing result marks that Issue done', /marked done/.test(ok2) && pj().nodes.filter(n => n.type === 'bug').length === 1 && pj().nodes.find(n => n.type === 'bug').status === 'done', ok2);
  const g1 = await call('autumn_group', { file: 'Test App', nodes: ['Greet by name', 'Name given?'], title: 'Input' });
  check('group: create around nodes', /Group created: \[Group\] Input/.test(g1) && /2 nodes: Greet by name, Name given\?/.test(g1), g1);
  let gErr = ''; try { await call('autumn_group', { file: 'Test App', nodes: ['Test App', 'greet'], title: 'Ends' }); } catch (e) { gErr = e.message; }
  check('group: refuses to catch other nodes', /would also take in/.test(gErr), gErr);
  const g2 = await call('autumn_group', { file: 'Test App', nodes: ['Test App', 'greet'], title: 'Ends', arrange: true });
  check('group: arrange moves the nodes into a block', /2 nodes: /.test(g2) && /nodes arranged/.test(g2), g2);
  check('group: link to "group:Input"', /\[Group\] Input \(2 nodes\)/.test(await call('autumn_link', { file: 'Test App', from: 'No dependencies', to: 'group:Input' })));
  const g3 = await call('autumn_update_group', { file: 'Test App', group: 'Ends', title: 'Edges', remove: ['greet'] });
  check('group: update (rename, take out)', /Updated \[Group\] Edges/.test(g3) && /1 node: Test App/.test(g3), g3);
  const gd = await call('autumn_delete', { file: 'Test App', groups: ['Edges'] });
  check('group: delete keeps the nodes', /1 group\(s\)/.test(gd) && /Deleted 0 node/.test(gd), gd);
  check('group in outline', /\[Group\] Input/.test(await call('autumn_read_board', { file: 'Test App' })));
  await call('autumn_add_board', { file: 'Test App', name: 'Later' });
  check('markdown export', /# Test App/.test(await call('autumn_export', { file: 'Test App', format: 'markdown' })));
  let errText = ''; try { await call('autumn_update_node', { file: 'Test App', node: 'does not exist' }); } catch (e) { errText = e.message; }
  check('error is reported, not thrown away', /Node not found/.test(errText), errText);
  const proj = JSON.parse(fs.readFileSync(path.join(wf, 'Test App.autumn.json'), 'utf8'));
  check('saved format', proj.app === 'autumn' && proj.boards.length === 2 && proj.boards[0].nodes.find(n => n.title === 'greet').spec.signature);
  if (exe) {
    const out = await call('autumn_export', { file: 'Test App', format: 'pdf' });
    const pdf = path.join(wf, 'Test App.pdf');
    check('pdf export', fs.existsSync(pdf) && fs.readFileSync(pdf).slice(0, 4).toString() === '%PDF', out);
  }
  child.stdin.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); child.kill(); process.exit(1); });
