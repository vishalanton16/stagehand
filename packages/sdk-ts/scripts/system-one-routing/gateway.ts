import type { DecisionQuestion, JsonValue } from "../../../extension/services/decisions/client.js";

export const GATEWAY_ROOT = "https://ai-gateway.vercel.sh";
export const GATEWAY_MODELS = ["openai/gpt-6-luna-decisions", "microsoft/decision-1.1"] as const;

const text = (value: JsonValue) => (typeof value === "string" ? value : JSON.stringify(value));

// Keep the staged policy and validated client intact while translating its wire format for replay.
export function encodeGatewayDecision(body: string): string {
  const request = JSON.parse(body) as {
    model: string;
    state: JsonValue;
    questions: Record<string, DecisionQuestion>;
  };
  if (!GATEWAY_MODELS.some((model) => model === request.model))
    throw new Error("Unexpected Gateway model");
  const questions = Object.entries(request.questions).map(([name, question]) => {
    const instructions = text(question.instructions);
    switch (question.type) {
      case "choice":
        return {
          name,
          instructions,
          type: "choice",
          choices: Object.entries(question.criteria).map(([value, description]) => ({
            value,
            ...(description === null ? {} : { description: text(description) }),
          })),
        };
      case "noul":
        return {
          name,
          type: "predicate",
          instructions: question.criteria
            ? `${instructions}\nTrue when: ${text(question.criteria.true)}\nFalse when: ${text(question.criteria.false)}`
            : instructions,
        };
      case "locate":
        throw new Error("Gateway replay covers choice and predicate");
    }
  });
  return JSON.stringify({ model: request.model, input: text(request.state), questions });
}

export async function decodeGatewayDecision(response: Response): Promise<Response> {
  if (!response.ok) return response;
  type GatewayAnswer = { name: string } & (
    | { type: "predicate"; probability: number }
    | {
        type: "choice";
        choice: string;
        confidence: number;
        probabilities: { value: string; probability: number }[];
      }
    | { type: "refusal" }
  );
  const result = (await response.json()) as {
    model: string;
    answers: GatewayAnswer[];
    usage?: unknown;
  };
  if (
    !Array.isArray(result.answers) ||
    new Set(result.answers.map(({ name }) => name)).size !== result.answers.length
  ) {
    throw new Error("Invalid Gateway answer names");
  }
  const answers = Object.fromEntries(
    result.answers.map((answer) => {
      if (answer.type === "predicate")
        return [answer.name, { type: "noul", noul: answer.probability }];
      if (answer.type === "choice")
        return [
          answer.name,
          {
            type: "choice",
            choice: answer.choice,
            confidence: answer.confidence,
            probabilities: Object.fromEntries(
              answer.probabilities.map(({ value, probability }) => [value, probability]),
            ),
          },
        ];
      return [answer.name, answer];
    }),
  );
  return Response.json({ model: result.model, usage: result.usage, answers });
}
