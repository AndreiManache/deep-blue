export interface ChatResponse {
  reply_text: string;
  ended: boolean;
  mutated: boolean;
  audio_base64: string | null;
  lang: string;
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
export type Language = "en" | "ro";

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
  language: Language | null;
  updated_at: string;
}

export interface Targets {
  bmr: number;
  tdee: number;
  calorie_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
}

export interface ProfileResponse {
  profile: UserProfile | null;
  targets: Targets | null;
}

export class ApiError extends Error {}

const SESSION_TOKEN_KEY = "deepblue_session_token";
// Fired whenever the server rejects the stored token (expired or logged out
// elsewhere), so the app can fall back to the login screen without
// prop-drilling auth state everywhere.
export const SESSION_INVALIDATED_EVENT = "deepblue:session-invalidated";

export function getStoredToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

function setStoredToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

function clearStoredToken(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

// Every gated API call routes through here so the session token (if any is
// stored) is attached as a bearer, and a 401 uniformly clears it and surfaces
// the login screen again.
async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearStoredToken();
    window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
  }
  return res;
}

export interface AuthResult {
  token: string;
  username: string;
}

// Login and registration talk to the server directly, not through apiFetch: a
// 401 here is an expected "wrong username or password", not a stale session, so
// it must surface as an error to the form rather than firing the invalidated
// event. On success the token is stored for every subsequent apiFetch.
async function postAuth(path: string, username: string, password: string): Promise<AuthResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthResult> & { error?: string };
  if (!res.ok || !data.token) {
    throw new ApiError(data.error ?? "Something went wrong. Try again.");
  }
  setStoredToken(data.token);
  return { token: data.token, username: data.username ?? username };
}

export function registerAccount(username: string, password: string): Promise<AuthResult> {
  return postAuth("/auth/register", username, password);
}

export function loginAccount(username: string, password: string): Promise<AuthResult> {
  return postAuth("/auth/login", username, password);
}

// Best-effort server-side session deletion, then always clear locally so the
// UI returns to the login screen even if the network call fails.
export async function logout(): Promise<void> {
  const token = getStoredToken();
  try {
    await fetch("/auth/logout", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    /* offline or server down — local clear below is what matters */
  }
  clearStoredToken();
}

export async function sendChat(sessionId: string, userText: string): Promise<ChatResponse> {
  const res = await apiFetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, user_text: userText }),
    // Matches the server's own 60s model timeout (plus one retry's slack) —
    // without this, a hung request strands the UI in "thinking" indefinitely.
    signal: AbortSignal.timeout(90_000),
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

export interface GreetingResponse {
  text: string;
  audio_base64: string | null;
  lang: string;
}

export async function fetchGreeting(): Promise<GreetingResponse> {
  const res = await apiFetch("/greeting");
  if (!res.ok) throw new ApiError("Could not load greeting.");
  return res.json();
}

export interface DailyStat {
  date: string; // YYYY-MM-DD
  calories: number;
  protein_g: number;
  logged: boolean;
}

export interface StatsResponse {
  days: DailyStat[];
  targets: Targets | null;
}

export async function fetchStats(days: number): Promise<StatsResponse> {
  const res = await apiFetch(`/stats?days=${days}`);
  if (!res.ok) throw new ApiError("Could not load stats.");
  return res.json();
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
