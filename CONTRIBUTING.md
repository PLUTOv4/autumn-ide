# Contributing

Bug reports, fixes and translations are welcome. For anything larger than a small fix, please open an issue first so we can agree on the approach before you spend time on it.

## Setting up

You need Windows 10 or 11 (x64) and Node.js 18 or newer.

```bash
npm start
```

This runs Autumn straight from the source. The first run downloads Electron into `%LOCALAPPDATA%\Autumn-build`; later runs start right away. `npm run build` (or `Build.bat`) makes the packaged app, and `node scripts/build.js portable` makes the single `Autumn.exe` used for releases.

## How the code is organized

- `src/` is the editor. `catalog.js`, `fields.js` and `spec.js` are shared with the MCP server, so they must not touch the DOM.
- `electron/` is the main process: files, the WorkFlow folder, PDF export, and starting AI tools for Result nodes.
- `mcp/` is the MCP server. It has no dependencies and talks JSON-RPC over stdio.
- `scripts/` holds the build, the Korean translation step, the manual renderer and the tests.

The project uses plain JavaScript with no framework and no runtime dependencies. Please keep it that way; a new dependency needs a good reason.

Two-space indentation and LF line endings, as set in `.editorconfig`.

## User interface text

Write UI text in English in `src/`. The Korean interface is generated at build time from `i18n/ko.json`.

1. Run `node scripts/i18n.js extract ko` to list text that has no Korean yet. CSS selectors and ids show up in that list too; ignore them.
2. Add the missing entries to `i18n/ko.json`. Exact strings go under `"text"`. Template literals go under `"templates"`, with `{0}`, `{1}` in place of the `${...}` parts.
3. `node scripts/i18n.js check ko` must pass.

## Tests

```bash
npm test
```

This starts the MCP server and runs it end to end in a temporary folder. With a packaged build you can also check the PDF export:

```bash
node scripts/test-mcp.js --exe "C:\path\to\Autumn\app\Autumn.exe"
```

For UI changes, describe what you checked by hand in the pull request.

## Screenshots and the manual

- `node scripts/build.js capture out.png --capture-eval-file=script.js` opens the app off screen, runs the script and saves a screenshot.
- The Korean manual is `docs/manual-ko.html`. `node scripts/build.js manual` renders it to PDF.
- Before committing a screenshot, check it for personal information. The *Connect AI* dialog, for example, shows real folder paths.

## Never commit

- API keys, tokens or passwords, not even in tests or sample projects.
- Personal paths, user names or email addresses in code, docs or screenshots.
- Build output (`app/`, `src-ko/`, PDFs). `.gitignore` already covers these.

## Pull requests

- Keep one topic per pull request.
- Say what changed and how you tested it.
- Update `README.md`, `README.ko.md` and `CHANGELOG.md` when behaviour changes.

By sending a pull request you agree that your contribution is published here under the PolyForm Noncommercial License 1.0.0, and that the copyright holder may also license it to others, including for commercial use.
