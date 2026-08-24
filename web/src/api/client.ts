export interface ChatResponse {
  reply_text: string;
  ended: boolean;
  mutated: boolean;
}

export interface FoodEntry {
  id: string;
  raw_transcript: string;
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
  edited: boolean;
}

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalType = "lose" | "maintain" | "gain";
export type GoalRate = "gentle" | "moderate" | "aggressive";

export interface UserProfile {
  name: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  age: number | null;
  sex: Sex | null;
  activity_level: ActivityLevel | null;
  goal_type: GoalType | null;
  goal_rate: GoalRate | null;
  goal_notes: string | null;
  updated_at: string;
}

export interface Targets {
  bmr: number;
  tdee: number;
  calorie_target: number;
  protein_target_g: number;
}

export interface ProfileResponse {
  profile: UserProfile | null;
  targets: Targets | null;
}

export class ApiError extends Error {}

const ACCESS_CODE_STORAGE_KEY = "deepblue_access_code";
// Fired whenever the server rejects the stored code, so the app can fall
// back to the AccessGate screen without prop-drilling auth state everywhere.
export const ACCESS_CODE_INVALIDATED_EVENT = "deepblue:access-code-invalidated";

export function getStoredAccessCode(): string | null {
  return localStorage.getItem(ACCESS_CODE_STORAGE_KEY);
}

export function setStoredAccessCode(code: string): void {
  localStorage.setItem(ACCESS_CODE_STORAGE_KEY, code);
}

function clearStoredAccessCode(): void {
  localStorage.removeItem(ACCESS_CODE_STORAGE_KEY);
}

// Every API call routes through here so the access code (if any is stored)
// is attached, and a 401 uniformly clears it and surfaces the gate again.
// In local dev, where the server has no ACCESS_CODE configured, this is a
// no-op passthrough — the gate is never shown because no request ever 401s.
async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const code = getStoredAccessCode();
  const headers = new Headers(options.headers);
  if (code) headers.set("X-Access-Code", code);

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearStoredAccessCode();
    window.dispatchEvent(new Event(ACCESS_CODE_INVALIDATED_EVENT));
  }
  return res;
}

export async function sendChat(sessionId: string, userText: string): Promise<ChatResponse> {
  const res = await apiFetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, user_text: userText }),
  });
  if (!res.ok) {
    throw new ApiError("Something went wrong. Try again.");
  }
  return res.json();
}

export async function fetchEntries(date?: string): Promise<FoodEntry[]> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await apiFetch(`/entries${qs}`);
  if (!res.ok) throw new ApiError("Could not load entries.");
  return res.json();
}

export async function editEntry(id: string, fields: Partial<Pick<FoodEntry, "description" | "calories">>): Promise<FoodEntry> {
  const res = await apiFetch(`/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new ApiError("Could not save changes.");
  return res.json();
}

export async function removeEntry(id: string): Promise<void> {
  const res = await apiFetch(`/entries/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError("Could not delete entry.");
}

export async function fetchProfile(): Promise<ProfileResponse> {
  const res = await apiFetch("/profile");
  if (!res.ok) throw new ApiError("Could not load profile.");
  return res.json();
}

export async function saveProfile(fields: Partial<Omit<UserProfile, "updated_at">>): Promise<ProfileResponse> {
  const res = await apiFetch("/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new ApiError("Could not save profile.");
  return res.json();
}
