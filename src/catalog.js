/* Autumn — catalog: node types, link types, statuses and the structured fields of each node kind.
 * Shared by the editor (browser: window.Catalog), the MCP server and the plan / PDF generator (Node: require).
 * Pure data — no DOM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Catalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // body: what the node's main text is called · ph: placeholder for it. Code nodes are written as prompts for the AI.
  const P = 'Prompt';
  const TYPES = {
    // flow
    start:     { name: 'Start',      icon: 'tStart',     color: '#6aa84f', outs: ['Begin'],      body: 'Goal', ph: 'What are we building? Who is it for? What must it do?', desc: 'Entry point · the program or plan itself', kw: 'start begin project program app root' },
    feature:   { name: 'Feature',    icon: 'tFeature',   color: '#e8743b', outs: ['Next'],       body: P, ph: 'Describe the feature as a prompt: what it does, who uses it, edge cases…', desc: 'Something the program must do', kw: 'feature story requirement capability epic' },
    task:      { name: 'Task',       icon: 'tTask',      color: '#d4a72c', outs: ['Next'],       body: P, ph: 'One concrete step for the AI: what to create or change…', desc: 'A concrete implementation step', kw: 'task step todo job work item' },
    event:     { name: 'Event',      icon: 'tEvent',     color: '#a06cd5', outs: ['Next'],       body: 'Content', ph: 'What happens, and what triggers it…', desc: 'Trigger · event · cutscene', kw: 'event trigger hook signal incident cutscene' },
    ending:    { name: 'Release',    icon: 'tEnding',    color: '#8a8076', outs: [],             body: 'Content', ph: 'What is delivered at this point…', desc: 'Milestone · end of a flow (no outputs)', kw: 'release milestone ending end deliver version ship' },
    // logic
    choice:    { name: 'Branch',     icon: 'tChoice',    color: '#d0503f', outs: ['Option A', 'Option B'], body: 'Content', ph: 'What is being chosen…', desc: 'Splits on a user choice', kw: 'choice branch option menu split' },
    condition: { name: 'Condition',  icon: 'tCondition', color: '#c79a2e', outs: ['True', 'False'], body: 'Content', ph: 'What is checked…', desc: 'If / else', kw: 'condition if else check guard' },
    loop:      { name: 'Loop',       icon: 'tLoop',      color: '#3f95c9', outs: ['Each', 'After'], body: P, ph: 'What repeats, and when it stops…', desc: 'Repeat · iterate · retry', kw: 'loop repeat for each while iterate retry' },
    quest:     { name: 'Goal',       icon: 'tQuest',     color: '#93a83a', outs: ['Reached'],    body: 'Content', ph: 'What counts as reaching this goal…', desc: 'Objective · quest · mission', kw: 'goal quest mission objective target okr' },
    // code
    lang:      { name: 'Programming language', icon: 'tLang', color: '#f2c14e', outs: ['Applies to'], body: 'Content', ph: 'Anything else about how the code should be written…', desc: 'Pick the language the AI writes in · unlinked = whole project', kw: 'language programming python javascript typescript c# java go rust code lang' },
    module:    { name: 'Module',     icon: 'tModule',    color: '#5677d6', outs: ['Uses'],       body: P, ph: 'What this module is responsible for, and what it must not do…', desc: 'File · package · component', kw: 'module file package component class service library' },
    function:  { name: 'Function',   icon: 'tFunction',  color: '#2fb2c4', outs: ['Calls'],      body: P, ph: 'What the function does, step by step…', desc: 'Function · method · handler', kw: 'function method handler procedure routine fn' },
    api:       { name: 'API',        icon: 'tApi',       color: '#c9508f', outs: ['Responds'],   body: P, ph: 'What this endpoint / interface does…', desc: 'Endpoint · external interface · IPC', kw: 'api endpoint route rest http ipc interface integration' },
    data:      { name: 'Data Model', icon: 'tData',      color: '#b9853e', outs: ['Used by'],    body: P, ph: 'What this data represents and its rules…', desc: 'Schema · table · type · file format', kw: 'data model schema table type entity database json struct' },
    ui:        { name: 'Screen',     icon: 'tUi',        color: '#3fae78', outs: ['Navigates'],  body: P, ph: 'What the user sees and can do on this screen…', desc: 'Screen · page · dialog · view', kw: 'ui screen page view dialog window layout component frontend' },
    test:      { name: 'Test',       icon: 'tTest',      color: '#7cbf4a', outs: ['Pass', 'Fail'], body: P, ph: 'What to verify…', desc: 'Test · acceptance check', kw: 'test check verify qa acceptance spec unit e2e' },
    result:    { name: 'Result',     icon: 'tResult',    color: '#2ec4a6', outs: ['Next'],       body: 'Content', ph: 'What should show up when the flow reaches this point…', desc: 'Shows the output of everything up to the linked node · filled in by the AI', kw: 'result output preview value console screenshot watch check print' },
    bug:       { name: 'Issue',      icon: 'tBug',       color: '#e0453a', outs: ['Fixed'],      body: P, ph: 'What goes wrong…', desc: 'Bug · problem to fix', kw: 'bug issue error problem fix defect crash' },
    // story & game
    scene:     { name: 'Scene',      icon: 'tScene',     color: '#4a6fd1', outs: ['Next'],       body: 'Content', ph: 'Scene description, lines, settings…', desc: 'A scene · cut · stage', kw: 'scene stage shot cut level' },
    dialogue:  { name: 'Dialogue',   icon: 'tDialogue',  color: '#3b8ad1', outs: ['Next'],       body: 'Content', ph: 'Who says what…', desc: 'Character lines · conversation', kw: 'dialogue talk conversation line script' },
    character: { name: 'Character',  icon: 'tCharacter', color: '#c94a7a', outs: ['Relation'],   body: 'Content', ph: 'Who they are, how they look, what they want…', desc: 'A character · NPC · user persona', kw: 'character npc person persona user actor' },
    location:  { name: 'Location',   icon: 'tLocation',  color: '#2f97a8', outs: ['Link'],       body: 'Content', ph: 'What this place is like…', desc: 'Place · map · area', kw: 'location place map area world' },
    item:      { name: 'Item',       icon: 'tItem',      color: '#b08a3a', outs: ['Use'],        body: 'Content', ph: 'What it is and what it does…', desc: 'Item · clue · key · asset', kw: 'item clue key asset object' },
    lore:      { name: 'Lore',       icon: 'tLore',      color: '#8a7a6b', outs: ['Ref'],        body: 'Content', ph: 'Background knowledge…', desc: 'World · background knowledge', kw: 'lore world background setting' },
    // AI & notes
    prompt:    { name: 'Prompt',     icon: 'tPrompt',    color: '#ff9f43', outs: ['Apply'],      body: P, ph: 'An instruction for the AI. Link it to the nodes or groups it applies to…', desc: 'Instruction for the AI · link it to what it applies to', kw: 'prompt instruction ai command order direction llm' },
    doc:       { name: 'Doc',        icon: 'tDoc',       color: '#7d8c99', outs: ['Ref'],        body: 'Content', ph: 'Spec, requirements, notes the AI should read…', desc: 'Spec · requirements · reference file or URL', kw: 'doc document spec requirement readme reference link url file' },
    note:      { name: 'Note',       icon: 'tNote',      color: '#a89545', outs: ['Link'],       body: 'Note', ph: 'Anything…', desc: 'Free-form note for people', kw: 'note memo sticky comment' },
    ainote:    { name: 'AI Note',    icon: 'tAI',        color: '#8b7cf6', outs: ['Ref'],        body: 'Content', ph: 'What this record is for…', desc: 'Model · prompt · params · reference record', kw: 'ai note prompt model generate image comfy reference record' },
    aiguide:   { name: 'AI Rules',   icon: 'tAIGuide',   color: '#e2a93b', outs: [],             body: 'Rules', ph: '', desc: 'Rules every AI must follow in every task', kw: 'ai guide rule rules must guideline style system prompt fixed policy' },
  };
  const TYPE_GROUPS = [['Flow', ['start', 'feature', 'task', 'event', 'ending']], ['Logic', ['choice', 'condition', 'loop', 'quest']], ['Code', ['lang', 'module', 'function', 'api', 'data', 'ui', 'test', 'result', 'bug']], ['Story & game', ['scene', 'dialogue', 'character', 'location', 'item', 'lore']], ['AI & notes', ['prompt', 'doc', 'note', 'ainote', 'aiguide']]];
  const LINK_TYPES = {
    flow:     { name: 'Flow',     color: '#b9a896', dash: '',    style: '',     desc: 'Continues to the next step' },
    cause:    { name: 'Triggers', color: '#e8894a', dash: '',    style: '',     desc: 'Cause → effect · triggers' },
    require:  { name: 'Requires', color: '#d9b84a', dash: '1 6', style: 'dot',  desc: 'Must exist / be done first (dependency)' },
    uses:     { name: 'Uses',     color: '#4fb3c9', dash: '7 4', style: 'dash', desc: 'Calls · imports · reads or writes' },
    relation: { name: 'Relation', color: '#b07ad6', dash: '8 6', style: 'dash', desc: 'Relation between elements' },
    conflict: { name: 'Conflict', color: '#e0605a', dash: '4 5', style: 'dash', desc: 'Opposition · conflict' },
    ref:      { name: 'Ref',      color: '#8a7d72', dash: '3 5', style: 'dot',  desc: 'Refers to notes · docs' },
    ai:       { name: 'AI Ref',   color: '#9d8cff', dash: '',    style: 'ai',   desc: 'Prompts, AI notes and rules for the AI (link anywhere)' },
  };
  /** Types that carry an AI record (ai): AI Note (record) and AI Rules (project-wide rules) */
  const AI_TYPES = new Set(['ainote', 'aiguide']);
  /** Prompts · AI Notes · AI Rules are material for the AI, so they are not steps of the flow */
  const AI_SIDE = new Set(['ainote', 'aiguide', 'prompt', 'lang']);
  const isAiNode = n => !!n && AI_SIDE.has(n.type);
  const CODE_TYPES = new Set(['module', 'function', 'api', 'data', 'ui', 'test', 'bug']);
  const CHOICE_LINKS = new Set(['flow', 'cause', 'require']);
  const STATUS = {
    idea:  { name: 'Idea',        color: '#8f8377' },
    draft: { name: 'In progress', color: '#e0a531' },
    done:  { name: 'Done',        color: '#6dbb5a' },
    hold:  { name: 'Blocked',     color: '#e0573f' },
  };
  /** Structured spec fields per node type (stored in node.spec). The AI reads them as part of the build plan. */
  /** Choices of the Programming language node (anything else can be typed into Version / Framework) */
  const LANGUAGES = ['JavaScript', 'TypeScript', 'Python', 'C#', 'C++', 'C', 'Java', 'Kotlin', 'Go', 'Rust', 'Swift', 'Dart', 'PHP', 'Ruby', 'Lua', 'GDScript', 'HTML / CSS', 'SQL', 'PowerShell', 'Bash', 'Other'];
  const SPEC_FIELDS = {
    start:     [{ k: 'stack', name: 'Tech stack', ph: 'e.g. Electron + vanilla JS · Python 3.12 + FastAPI' }, { k: 'output', name: 'Output folder', ph: 'Where the AI writes the code, e.g. D:\\code\\my-app', mono: true }, { k: 'run', name: 'Run / build command', ph: 'e.g. npm start', mono: true }, { k: 'constraints', name: 'Constraints', ph: 'e.g. no external services · must run offline · Windows only', long: true }],
    feature:   [{ k: 'acceptance', name: 'Done when', ph: 'Acceptance criteria — one per line', long: true }],
    task:      [{ k: 'files', name: 'Files', ph: 'Files to create or change — one per line', long: true, mono: true }, { k: 'acceptance', name: 'Done when', ph: 'How to tell it is finished', long: true }],
    condition: [{ k: 'expr', name: 'Expression', ph: 'e.g. user.isAdmin && !user.banned', mono: true }],
    loop:      [{ k: 'over', name: 'Iterates over', ph: 'e.g. every file in the input folder' }, { k: 'until', name: 'Stops when', ph: 'e.g. queue is empty · 3 retries' }],
    module:    [{ k: 'path', name: 'Path', ph: 'e.g. src/auth/index.js', mono: true }, { k: 'lang', name: 'Language', ph: 'e.g. TypeScript' }, { k: 'exports', name: 'Exports / interface', ph: 'Public functions, classes, events — one per line', long: true, mono: true }],
    function:  [{ k: 'signature', name: 'Signature', ph: 'e.g. login(email: string, password: string): Promise<User>', mono: true }, { k: 'returns', name: 'Returns / errors', ph: 'What it returns, what it throws', long: true }],
    api:       [{ k: 'method', name: 'Method', ph: 'GET · POST · IPC · CLI…' }, { k: 'route', name: 'Route', ph: 'e.g. /api/users/:id', mono: true }, { k: 'request', name: 'Request', ph: 'Body / params', long: true, mono: true }, { k: 'response', name: 'Response', ph: 'Shape of the result · status codes', long: true, mono: true }],
    data:      [{ k: 'schema', name: 'Schema', ph: 'id: string\nemail: string\ncreatedAt: Date', long: true, mono: true }, { k: 'storage', name: 'Storage', ph: 'e.g. SQLite table users · JSON file · in memory' }],
    ui:        [{ k: 'path', name: 'Route / file', ph: 'e.g. src/screens/Login.jsx', mono: true }, { k: 'layout', name: 'Layout', ph: 'What goes where', long: true }],
    test:      [{ k: 'steps', name: 'Steps', ph: 'One step per line', long: true }, { k: 'expected', name: 'Expected', ph: 'What should happen', long: true }],
    bug:       [{ k: 'repro', name: 'Steps to reproduce', ph: 'One step per line', long: true }, { k: 'expected', name: 'Expected', ph: 'What should happen instead', long: true }],
    lang:      [{ k: 'language', name: 'Language', options: LANGUAGES }, { k: 'version', name: 'Version / runtime', ph: 'e.g. Python 3.12 · Node 20 · .NET 8' }, { k: 'framework', name: 'Framework / libraries', ph: 'e.g. FastAPI · React · Unity · Electron' }, { k: 'style', name: 'Code style', ph: 'e.g. PEP 8 with type hints · ESLint standard · comments in Korean', long: true }],
    result:    [{ k: 'expected', name: 'Expected', ph: 'What should appear, e.g. 3 tasks listed, the first one struck through', long: true }, { k: 'how', name: 'How to get it', ph: 'e.g. npm test · node index.js Ana · open the app and click Add', long: true, mono: true }],
    prompt:    [{ k: 'output', name: 'Expected output', ph: 'What the AI should produce', long: true }],
    doc:       [{ k: 'refs', name: 'References', ph: 'One per line: file path or URL', long: true, mono: true }],
  };
  const specFieldsOf = n => SPEC_FIELDS[n.type] || [];

  /** AI Note record fields (which model · prompt · settings · references were used) */
  const AI_FIELDS = [
    { k: 'model',    name: 'Model / tool',     ph: 'e.g. Claude Code · Codex · Flux.1 dev + LoRA' },
    { k: 'prompt',   name: 'Prompt',           ph: 'The prompt that was used', long: true, mono: true },
    { k: 'negative', name: 'Avoid / negative', ph: 'What to leave out', long: true, mono: true },
    { k: 'params',   name: 'Settings',         ph: 'e.g. temperature 0.2 · seed 1234 · 30 steps · 1024×1536' },
    { k: 'mood',     name: 'Style · feel',     ph: 'e.g. small pure functions, no frameworks · warm autumn palette', long: true },
    { k: 'refs',     name: 'References',       ph: 'One per line (file path, URL or note)\ne.g. docs/spec.md', long: true, mono: true },
  ];
  /** AI Rules fields (same keys as AI_FIELDS — the meaning is "always applied") */
  const GUIDE_FIELDS = [
    { k: 'prompt',   name: 'Always do',              ph: 'Applied to every prompt and task\ne.g. TypeScript strict mode, small modules, comments in English', long: true, mono: true },
    { k: 'negative', name: 'Never do',               ph: 'e.g. hard-coded API keys or passwords, new dependencies without asking', long: true, mono: true },
    { k: 'mood',     name: 'Style · tone',           ph: 'e.g. clean minimal UI, warm autumn colors', long: true },
    { k: 'model',    name: 'Default model / tool',   ph: 'e.g. Claude Code (Opus) · Codex' },
    { k: 'params',   name: 'Default settings',       ph: 'e.g. Node 20 · npm · Windows 11' },
    { k: 'refs',     name: 'Must-read references',   ph: 'One per line (file path or URL)\ne.g. docs/spec.md', long: true, mono: true },
  ];
  const DEFAULT_RULES = [
    '- Read the AI Rules and the whole build plan before writing code; follow the flow from Start.',
    '- Build exactly what the nodes describe. If something is unclear, ask instead of guessing.',
    '- Never hard-code secrets (API keys, tokens, passwords). Read them from environment variables or a git-ignored local config.',
    '- Keep the code readable and commented; match the existing style.',
    '- When a node is implemented, set its status to done.',
  ].join('\n');

  /** Result node states: written by the AI (autumn_report_result) after running — or predicting — the flow up to that point */
  const RESULT_STATUS = {
    pass:      { name: 'Pass',      color: '#5fd38a', icon: '✓' },
    fail:      { name: 'Fail',      color: '#ff6b5b', icon: '✗' },
    info:      { name: 'Output',    color: '#7fc8ff', icon: '▸' },
    predicted: { name: 'Predicted', color: '#c9a2ff', icon: '≈' },
  };

  return { LANGUAGES, RESULT_STATUS, P, TYPES, TYPE_GROUPS, LINK_TYPES, AI_TYPES, AI_SIDE, CODE_TYPES, CHOICE_LINKS, STATUS, SPEC_FIELDS, AI_FIELDS, GUIDE_FIELDS, DEFAULT_RULES, isAiNode, specFieldsOf };
});
