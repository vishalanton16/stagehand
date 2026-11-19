import { defineConfig } from "wxt";

const icons = {
  16: "icons/16.png",
  32: "icons/32.png",
  48: "icons/48.png",
  128: "icons/128.png",
};

export default defineConfig({
  outDir: "dist",
  webExt: { disabled: true },
  vite: () => ({ build: { rolldownOptions: { experimental: { lazyBarrel: true } } } }),
  manifest: {
    name: "Stagehand WebMCP",
    description: "Discover, run, and debug WebMCP tools on the current page.",
    minimum_chrome_version: "155",
    permissions: ["activeTab", "scripting", "webNavigation", "storage"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    optional_host_permissions: [
      "https://ai-gateway.vercel.sh/*",
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://generativelanguage.googleapis.com/*",
    ],
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+W", mac: "MacCtrl+Shift+W" },
      },
    },
    action: { default_title: "Open Stagehand WebMCP", default_icon: icons },
    icons,
  },
});
