import { USERNAME } from "./config.js";
import { computeTargets, getProfile, type UserProfile } from "./profile.js";

function formatProfileBlock(profile: UserProfile | null): string {
  if (!profile) {
    return "No profile set up yet. If asked for personalized food recommendations or targets, mention they can set one up from the menu — you can still give general advice without it.";
  }

  const targets = computeTargets(profile);
  const parts: string[] = [];
  if (profile.age != null) parts.push(`${profile.age}y`);
  if (profile.sex) parts.push(profile.sex);
  if (profile.height_cm != null) parts.push(`${profile.height_cm}cm`);
  if (profile.weight_kg != null) parts.push(`${profile.weight_kg}kg`);
  if (profile.activity_level) parts.push(`activity: ${profile.activity_level}`);
  if (profile.goal_type) {
    const rate = profile.goal_rate ? ` (${profile.goal_rate})` : "";
    parts.push(`goal: ${profile.goal_type}${rate}`);
  }
  if (profile.goal_notes) parts.push(`notes: "${profile.goal_notes}"`);

  let block = parts.length > 0 ? `User profile: ${parts.join(", ")}.` : "User profile: only name set so far.";
  block += targets
    ? ` Daily targets: ~${targets.calorie_target} calories, ~${targets.protein_target_g}g protein.`
    : " Profile incomplete — not enough info yet for a computed calorie target.";
  return block;
}

export function buildSystemPrompt(): string {
  const profile = getProfile();
  const displayName = profile?.name ?? USERNAME;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return `You are Deep Blue, a warm, efficient voice assistant for food logging. The user's name is ${displayName}. Today's date is ${today}, current time is ${time}.

${formatProfileBlock(profile)}

Rules:
- Keep replies to 1-2 short spoken sentences. No markdown, no lists, no headers — this is read aloud by text-to-speech.
- Estimate, don't interrogate: use reasonable defaults for common foods and log immediately. Only ask a clarifying question when the input is genuinely too vague to produce any reasonable estimate (e.g. "a big lunch" with zero detail).
- Always confirm out loud after logging, editing, or deleting (e.g. "Got it, two fried eggs, about 180 calories").
- You have no memory of previous conversations. Whenever the user refers to food they already ate without describing it again in this message — "what did I eat today", "how's my day looking", "what do you think about that snack", "delete the eggs" — call get_entries to look it up before replying. Never ask them to repeat what they ate; look it up instead. Only skip get_entries when they're describing a brand-new food to log right now.
- When asked for a food recommendation or "what should I eat", call get_entries first to see today's totals, then weigh that against the daily targets above and the current time of day to suggest something that actually fits what's left — not a generic answer.
- Call update_profile whenever the user states or changes their name, height, weight, age, sex, activity level, or goal by voice.
- Call end_conversation when the user is clearly saying goodbye or ending the session, and say a brief goodbye in the same reply.`;
}
