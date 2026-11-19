export const providers = {
  gateway: {
    name: "Vercel AI Gateway",
    model: "openai/gpt-6-luna",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    keysUrl:
      "https://vercel.com/d?title=AI+Gateway+API+Keys&to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys",
  },
  openai: {
    name: "OpenAI",
    model: "gpt-6-luna",
    baseUrl: "https://api.openai.com/v1",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    name: "Anthropic",
    model: "claude-haiku-5.5",
    baseUrl: "https://api.anthropic.com/v1",
    keysUrl: "https://platform.claude.com/settings/keys",
  },
  gemini: {
    name: "Gemini",
    model: "gemini-3.8-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keysUrl: "https://aistudio.google.com/api-keys",
  },
} as const;

export type Provider = keyof typeof providers;
export type Connection = {
  [P in Provider]: { provider: P; model: string; key: string };
}[Provider];
export type Connections = Partial<Record<Provider, Connection>>;

const providerIds = Object.keys(providers) as Provider[];
const selectionKey = "agent-provider";
const connectionKey = (provider: Provider) => `agent-connection:${provider}`;

export async function loadConnections(): Promise<{
  provider: Provider;
  saved: Connections;
}> {
  const stored = await chrome.storage.local.get([selectionKey, ...providerIds.map(connectionKey)]);
  const saved: Connections = {};
  for (const provider of providerIds) {
    const connection = stored[connectionKey(provider)] as Connection | undefined;
    if (connection) saved[provider] = connection;
  }
  const selected = stored[selectionKey] as Provider | undefined;
  return { provider: selected ?? "gateway", saved };
}

export function saveConnection(connection: Connection) {
  return chrome.storage.local.set({
    [selectionKey]: connection.provider,
    [connectionKey(connection.provider)]: connection,
  });
}

export function disconnect(provider: Provider) {
  return chrome.storage.local.remove(connectionKey(provider));
}

export function providerPermission(provider: Provider) {
  const { protocol, hostname } = new URL(providers[provider].baseUrl);
  return { origins: [`${protocol}//${hostname}/*`] };
}
