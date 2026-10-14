# Security

## Supported versions

Fixes go into the latest release only.

## Reporting a problem

Please don't report security problems in a public issue. Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**.

Include the Autumn version, what you did, and what happened. A small project file that shows the problem helps a lot, but remove anything private from it first.

## What Autumn does on your computer

**Network.** Autumn itself makes no network connections. There is no telemetry, no account and no update check.

**Files.** Autumn reads and writes the projects you open, the `WorkFlow` folder, the `autumn-assets` folder next to a project (images), and its settings in `%APPDATA%\Autumn`.

**MCP server.** Your AI tool starts the server and talks to it over standard input and output. The server reads and writes Autumn projects and their images. To export a PDF it starts Autumn itself in the background; it starts no other programs and opens no network connections.

**Result nodes.** *Ask the AI for this result* starts an AI command-line tool that is already installed on your computer (`claude`, `codex` or `gemini`) with fixed arguments. The text of the steps linked to the Result node is passed to it on standard input, and from there it goes to the AI service you signed in to. Claude Code runs with every tool turned off and Codex in a read-only sandbox, so neither can change files. Gemini CLI runs with its default settings. Nothing is sent unless you press the button.

**Secrets.** Autumn stores no API keys or tokens. Keep secrets out of nodes as well: node text ends up in build plans, exports and AI prompts.
