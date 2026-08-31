import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Interactions } from "@google/genai";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, GEMINI_MODEL, MODEL } from "./config.js";

// One-shot title+summary generation for a feedback report's own text — a
// separate, tool-free, non-conversational LLM call outside the main
// chat.ts/chatGemini.ts pipeline (2026-08-30, requested explicitly to speed
// up triage). Tries whichever provider has a key configured, Gemini first
// since it's the cheaper/faster of the two for this trivial a task; either
// missing key or a call failure just means no title/summary — the report
// itself already works fully without one.

export interface FeedbackSummary {
  title: string;
  summary: string;
}

const PROMPT_PREFIX =
  'You are triaging a bug/feedback report for a voice food-logging app called Deep Blue. ' +
  'Given the report text below, respond with ONLY a JSON object: {"title": "...", "summary": "..."}. ' +
  "title: 3-6 words, specific, no trailing punctuation. summary: one plain sentence describing what the " +
  "person actually said or wants. No markdown, no extra text outside the JSON object.\n\nReport:\n";

// Reports are short by construction (a spoken aside or a typed note); this
// is just a hard ceiling against something unexpectedly huge, not a normal
// truncation path.
const MAX_INPUT_CHARS = 2000;

function buildPrompt(text: string): string {
  return PROMPT_PREFIX + text.trim().slice(0, MAX_INPUT_CHARS);
}

function parseJsonLoose(text: string): FeedbackSummary | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { title?: unknown; summary?: unknown };
    if (typeof obj.title === "string" && typeof obj.summary === "string" && obj.title.trim() && obj.summary.trim()) {
      return { title: obj.title.trim(), summary: obj.summary.trim() };
    }
  } catch {
    /* not valid JSON — treated as a failed attempt, caller falls through */
  }
  return null;
}

const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const anthropicClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 }) : null;

function extractGeminiText(steps: Interactions.Step[]): string {
  return steps
    .filter((s): s is Interactions.ModelOutputStep => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c): c is Interactions.Content & { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .trim();
}

async function tryGemini(prompt: string): Promise<FeedbackSummary | null> {
  if (!geminiClient) return null;
  try {
    const interaction = await geminiClient.interactions.create(
      {
        model: GEMINI_MODEL,
        input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }],
        store: false,
        generation_config: { max_output_tokens: 150 },
      },
      { timeout: 15000 },
    );
    return parseJsonLoose(extractGeminiText(interaction.steps ?? []));
  } catch (err) {
    console.error("[feedbackSummary] Gemini failed:", err);
    return null;
  }
}

async function tryAnthropic(prompt: string): Promise<FeedbackSummary | null> {
  if (!anthropicClient) return null;
  try {
    const response = await anthropicClient.messages.create({
      model: MODEL,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find((c) => c.type === "text");
    return block && block.type === "text" ? parseJsonLoose(block.text) : null;
  } catch (err) {
    console.error("[feedbackSummary] Anthropic failed:", err);
    return null;
  }
}

export async function summarizeFeedback(text: string): Promise<FeedbackSummary | null> {
  if (!text.trim()) return null;
  const prompt = buildPrompt(text);
  return (await tryGemini(prompt)) ?? (await tryAnthropic(prompt));
}
