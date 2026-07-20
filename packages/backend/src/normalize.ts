import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ReceiptLineItem, ProposedLine } from "@receipt-scanner/shared";
import { getCached } from "./normcache.js";
import { log } from "./log.js";

// Interim model: Amazon Nova Lite, invoked through the Bedrock Converse API.
// Nova is available on-demand with no Anthropic use-case form (Claude Haiku on
// Bedrock requires that form + an inference profile). Converse is model-agnostic,
// so switching back to Claude later is just a model-id change here (Claude's
// profile id: "us.anthropic.claude-haiku-4-5-20251001-v1:0"). Auth + region come
// from the Lambda's IAM role via the standard AWS SDK credential chain.
const MODEL = "amazon.nova-lite-v1:0";
const bedrock = new BedrockRuntimeClient({});

export interface NormalizedName {
  rawName: string;
  canonicalName: string;
  isFood: boolean;
}

/** Builds the batched normalization prompt for a set of raw receipt lines. */
export function buildNormalizationPrompt(rawNames: string[]): string {
  return [
    "You normalize grocery receipt line items to canonical ingredient names.",
    "For each input line return the canonical, lowercase, singular single-ingredient",
    "name with no brand or abbreviations (e.g. \"GV LETTUCE ICEBRG\" -> \"lettuce\").",
    "Set isFood to false for non-food lines like fees, tax, totals, deposits, or discounts.",
    "Respond with ONLY a JSON array, one object per input line in the same order:",
    '[{"rawName": string, "canonicalName": string, "isFood": boolean}]',
    "",
    "Input lines:",
    JSON.stringify(rawNames),
  ].join("\n");
}

/** Parses the model's JSON array back into aligned normalized names (defensive). */
export function parseNormalizationResponse(text: string, rawNames: string[]): NormalizedName[] {
  let parsed: unknown;
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }
  const arr = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  const byRaw = new Map<string, { canonicalName: string; isFood: boolean }>();
  for (const e of arr) {
    if (e && typeof e.rawName === "string" && typeof e.canonicalName === "string") {
      byRaw.set(e.rawName, { canonicalName: e.canonicalName, isFood: e.isFood !== false });
    }
  }
  return rawNames.map((raw, i) => {
    const byName = byRaw.get(raw);
    const byIndex =
      arr[i] && typeof arr[i].canonicalName === "string"
        ? { canonicalName: arr[i].canonicalName as string, isFood: arr[i].isFood !== false }
        : undefined;
    const hit = byName ?? byIndex;
    return hit
      ? { rawName: raw, canonicalName: hit.canonicalName, isFood: hit.isFood }
      : { rawName: raw, canonicalName: raw, isFood: true };
  });
}

export type CallClaude = (prompt: string) => Promise<string>;

const defaultCallClaude: CallClaude = async (prompt) => {
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 1024 },
    }),
  );
  return (res.output?.message?.content ?? []).map((b) => b.text ?? "").join("");
};

export interface NormalizeDeps {
  callClaude?: CallClaude;
  getCachedFn?: typeof getCached;
}

/**
 * Normalizes receipt line items to canonical ingredients. Cache hits resolve for
 * free; misses go to Claude (Bedrock) in one batched call. If the Bedrock call
 * fails (e.g. model access not yet enabled), it degrades to raw names (isFood
 * true, source "claude") so proposals never fail hard.
 */
export async function normalizeLineItems(
  userId: string,
  lines: ReceiptLineItem[],
  deps: NormalizeDeps = {},
): Promise<ProposedLine[]> {
  const callClaude = deps.callClaude ?? defaultCallClaude;
  const getCachedFn = deps.getCachedFn ?? getCached;

  const cached = await getCachedFn(userId, lines.map((l) => l.name));
  const misses = lines.filter((l) => !cached.has(l.name));
  const normalized = new Map<string, NormalizedName>();

  if (misses.length > 0) {
    const missNames = misses.map((l) => l.name);
    try {
      const text = await callClaude(buildNormalizationPrompt(missNames));
      for (const n of parseNormalizationResponse(text, missNames)) normalized.set(n.rawName, n);
    } catch (err) {
      log.warn({ err }, "normalization call failed; returning raw names unnormalized");
    }
  }

  return lines.map((l) => {
    const canon = cached.get(l.name);
    if (canon !== undefined) {
      return {
        rawName: l.name,
        canonicalName: canon,
        quantity: l.quantity,
        unit: l.unit,
        price: l.price,
        isFood: true,
        source: "cache" as const,
      };
    }
    const n = normalized.get(l.name);
    return {
      rawName: l.name,
      canonicalName: n?.canonicalName ?? l.name,
      quantity: l.quantity,
      unit: l.unit,
      price: l.price,
      isFood: n?.isFood ?? true,
      source: "claude" as const,
    };
  });
}
