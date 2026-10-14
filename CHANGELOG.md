# Changelog

## 1.1.2 (2026-10-14)

### Added

- A single `Autumn.exe` download. It unpacks itself into `%LOCALAPPDATA%\Autumn` on the first start and keeps projects in `Documents\Autumn\WorkFlow`. Build it with `node scripts/build.js portable`.
- Result node: **Ask the AI for this result** runs the AI tool you choose (Claude Code, Codex or Gemini CLI) and fills in the status, a one-line value, the output and a short reason.
- When a result is wrong, the fix is written into an Issue node next to the Result node as `before → after`, one line per change. The nodes before the Result node are never edited. A later passing result marks that issue as done.
- `autumn_report_result` accepts `note` and `fixes`. Fixes go into the same Issue node.

### Changed

- Autumn is now licensed under the PolyForm Noncommercial License 1.0.0 instead of MIT.
- Each Result node remembers which AI tool it uses.
- *Copy request* is now a separate button, for an AI in a terminal that can really run the program.
- The released build uses Electron's FFmpeg without the H.264 and AAC decoders. Autumn plays no audio or video.

## 1.1.1 (2026-10-14)

### Added

- MCP tools `autumn_group` and `autumn_update_group`. A group is created around the given nodes; if other nodes would end up inside the frame, the tool says so, and `arrange` moves the nodes into a block first.
- `autumn_delete` can delete groups. The nodes inside are kept.
- License notices for html-to-image and the icon set, and a rewritten THIRD_PARTY_NOTICES.md.

### Changed

- The Korean manual uses the bundled Pretendard font.

## 1.1.0 (2026-10-14)

### Added

- Result node, a check point that shows what the steps before it produce, and the MCP tool `autumn_report_result`.
- Programming language node. Unlinked it applies to the whole project; linked it applies to those nodes or groups only.
- Korean user interface and a Korean manual.
- The Run summary counts results and lists failed ones as warnings.

## 1.0.0 (2026-10-14)

First release.

- Node editor with features, tasks, modules, functions, APIs, data models, screens, tests, prompts and AI Rules.
- Build plan in flow order, as Markdown or PDF.
- Run (F11), neighbor highlighting and flow trace.
- MCP server with 18 tools. Changes made by the AI show up on the canvas right away.
- Projects stored as JSON in the WorkFlow folder.
