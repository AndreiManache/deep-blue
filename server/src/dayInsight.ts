import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Interactions } from "@google/genai";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, GEMINI_MODEL, MODEL } from "./config.js";
import { db } from "./db.js";
import { getEntriesForDate, type FoodEntry } from "./entries.js";
import { computeTargets, getProfile, type Targets } from "./profile.js";

// A short AI-generated comment on how the day's eating is going so far
// (2026-08-31 backlog item) — praise when it's balanced, a specific,
// constructive nudge when one macro is notably off, shown right under the
// progress rings on the Dashboard. One-shot, tool-free LLM call outside the
// main chat pipeline, same shape as feedbackSummary.ts.

export interface DayTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

function sumEntries(entries: FoodEntry[]): DayTotals {
  return {
    calories: entries.reduce((a, e) => a + (e.calories || 0), 0),
    protein_g: entries.reduce((a, e) => a + (e.protein_g || 0), 0),
    carbs_g: entries.reduce((a, e) => a + (e.carbs_g || 0), 0),
    fat_g: entries.reduce((a, e) => a + (e.fat_g || 0), 0),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildPrompt(totals: DayTotals, targets: Targets | null, language: "en" | "ro"): string {
  const lang = language === "ro" ? "Romanian" : "English";
  const targetLine = targets
    ? `Targets: ${Math.round(targets.calorie_target)} kcal, ${Math.round(targets.protein_target_g)}g protein, ${Math.round(targets.carbs_target_g)}g carbs, ${Math.round(targets.fat_target_g)}g fat.`
    : "No targets set yet — just comment on the balance of what's logged.";
  return (
    "You are a friendly, no-nonsense nutrition coach inside a food-logging app called Deep Blue. " +
    `Respond in ${lang}, with ONLY a JSON object: {"insight": "..."}. ` +
    "insight: exactly 1-2 short sentences, second person, coach voice. " +
    "If intake so far is reasonably balanced against the targets, be encouraging and say they're on track. " +
    "If one macro is clearly low or high relative to the targets (or to a roughly even split if there are no targets), " +
    "name that macro specifically and suggest a concrete adjustment for the rest of the day. " +
    "No markdown, no hedging, no repeating the raw numbers back verbatim, no extra text outside the JSON object.\n\n" +
    `Logged so far today: ${round1(totals.calories)} kcal, ${round1(totals.protein_g)}g protein, ${round1(totals.carbs_g)}g carbs, ${round1(totals.fat_g)}g fat. ${targetLine}`
  );
}

function parseJsonLoose(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { insight?: unknown };
    return typeof obj.insight === "string" && obj.insight.trim() ? obj.insight.trim() : null;
  } catch {
    return null;
  }
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

async function tryGemini(prompt: string): Promise<string | null> {
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
    console.error("[dayInsight] Gemini failed:", err);
    return null;
  }
}

async function tryAnthropic(prompt: string): Promise<string | null> {
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
    console.error("[dayInsight] Anthropic failed:", err);
    return null;
  }
}

const getCachedStmt = db.prepare(
  `SELECT entry_count, insight FROM day_insights WHERE user_id = :user_id AND date = :date`,
);
const upsertStmt = db.prepare(`
  INSERT INTO day_insights (user_id, date, entry_count, insight, created_at)
  VALUES (:user_id, :date, :entry_count, :insight, :created_at)
  ON CONFLICT(user_id, date) DO UPDATE SET
    entry_count = excluded.entry_count,
    insight = excluded.insight,
    created_at = excluded.created_at
`);

// Returns null when there's nothing to comment on yet (no entries), or if
// every provider fails — the Dashboard just doesn't show the card then,
// same degrade-gracefully pattern as every other optional AI feature here.
export async function getDayInsight(userId: string, date: string): Promise<string | null> {
  const entries = getEntriesForDate(userId, date);
  if (entries.length === 0) return null;

  const cached = getCachedStmt.get({ user_id: userId, date }) as unknown as
    | { entry_count: number; insight: string }
    | undefined;
  if (cached && cached.entry_count === entries.length) return cached.insight;

  const profile = getProfile(userId);
  const targets = computeTargets(profile);
  const totals = sumEntries(entries);
  const prompt = buildPrompt(totals, targets, profile?.language === "ro" ? "ro" : "en");

  const insight = (await tryGemini(prompt)) ?? (await tryAnthropic(prompt));
  if (!insight) return null;

  upsertStmt.run({
    user_id: userId,
    date,
    entry_count: entries.length,
    insight,
    created_at: new Date().toISOString(),
  });
  return insight;
}
