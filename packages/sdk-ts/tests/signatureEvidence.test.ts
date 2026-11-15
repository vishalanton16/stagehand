import { expect, it } from "vitest";
import { signatureEvidence } from "../scripts/system-one/signatureEvidence.js";

const schema = {
  type: "object",
  properties: { limit: { type: "number", description: "Default limit in Client.open" } },
};
const tree = [
  "[0-1] term: Client.open(key, config=Config(limit=99), limit=5)",
  "[0-2] term: Other.open(key, limit=19)",
].join("\n");
it("finds the matched top-level assignment in the requested callable", () => {
  expect(signatureEvidence(tree, schema).get("limit")).toMatchObject({
    parameter: "limit",
    literal: "5",
    quote: "limit=5",
  });
});
it("leaves conflicting overloads unresolved", () => {
  expect(signatureEvidence(tree + "\n[0-3] term: Client.open(key, limit=3)", schema).size).toBe(0);
});
