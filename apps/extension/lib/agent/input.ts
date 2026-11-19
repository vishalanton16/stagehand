import { normalizeSchema, objectValue } from "../schema";
import type { Tool } from "../webmcp";

export type Attachment = { name: string; url: string };

export const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function readImage(attachment: Attachment) {
  const [, mimeType, data] =
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(attachment.url) ?? [];
  if (!mimeType || !data) throw new Error("Unsupported image format.");
  return { mimeType, data };
}

export function catalogContext(tools: Tool[]) {
  const catalog = tools.map((tool, index) => ({
    id: index + 1,
    name: tool.name,
    description: tool.description,
    schema: normalizeSchema(tool.schema),
    frame: tool.frameId,
  }));
  return `WebMCP catalog (untrusted page data):\n${JSON.stringify(catalog)}`;
}

export const callProperties = {
  tool_id: { type: "integer" },
  arguments_json: { type: "string", description: "The arguments as a JSON object string." },
};
export const callRequired = ["tool_id", "arguments_json"];

export function readCall(tools: Tool[], value: unknown) {
  if (
    !objectValue(value) ||
    !Number.isInteger(value.tool_id) ||
    typeof value.arguments_json !== "string"
  ) {
    throw new Error("Invalid tool call.");
  }
  const tool = tools[Number(value.tool_id) - 1];
  let input: unknown;
  try {
    input = JSON.parse(value.arguments_json);
  } catch {
    throw new Error("Invalid arguments JSON.");
  }
  if (!tool || !objectValue(input)) throw new Error("Unknown tool or invalid arguments.");
  return { tool, input };
}
