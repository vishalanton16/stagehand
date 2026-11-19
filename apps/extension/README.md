# Stagehand WebMCP

A browser side panel for finding, inspecting, and running the WebMCP tools a page publishes.

## Load in Chrome

```sh
pnpm install --frozen-lockfile
pnpm --filter @browserbasehq/webmcp-debugger build
```

1. In Chrome 155 or later, open `chrome://extensions`, turn on Developer mode, and load unpacked from `apps/extension/dist/chrome-mv3`.
2. For local development, enable **WebMCP for testing** at `chrome://flags/#enable-webmcp-testing` and relaunch.
3. Open a WebMCP page and click **Stagehand WebMCP** in the extensions menu. Clicking grants temporary access to the tab. Click again when moving to a different site. The default shortcut is Control+Shift+W on macOS or Alt+Shift+W elsewhere.

## Inspect and run

- **Inspect** lists tools by frame. Run one with a validated form or JSON payload. Tools that may change state ask for review. Use **Page check** to verify text after a call.
- **Replay** keeps the last 40 calls per tab while the panel is open. Edit and rerun a call or copy its redacted trace.

Text results render as Markdown. Expand **Raw result** to inspect the original output.

## Use the Agent

Connect Vercel AI Gateway, OpenAI, Anthropic, or Gemini with an API key. Your browser stores the key in your local profile. To change the key or model, open **Settings**.

Type a request and press Enter to send. Shift+Enter adds a line. Your provider receives the prompt, recent conversation text, tool definitions, and any attached image.

Review proposed calls in the chat. Choose **Run tool** or **Skip**. Gateway can use each approved result to continue a multi-step request. For a tool marked read-only, you can approve further calls to that tool for the rest of the current request. Other providers propose a single call and display its output in the chat. **Stop** prevents further calls. A call already started can finish.

## Check and package the extension

```sh
pnpm --filter @browserbasehq/webmcp-debugger typecheck
pnpm --filter @browserbasehq/webmcp-debugger zip
```
