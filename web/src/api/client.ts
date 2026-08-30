export interface ChatResponse {
  reply_text: string;
  ended: boolean;
  mutated: boolean;
  audio_base64: string | null;
  // Reply audio's real MIME — ElevenLabs returns MP3, Gemini TTS can return
  // several formats, so this is never assumed on the client. See PROVIDERS.md.
  audio_mime: string;
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
  // Food-knowledge provenance: 'estimate' | 'yours' | 'verified' | 'barcode'
  // (or null on older entries / foods without a canonical key).
  source: string | null;
  agreement_count: number | null;
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

export interface ImageAttachment {
  base64: string;
  mime: string;
}

export async function sendChat(
  sessionId: string,
  userText: string,
  image?: ImageAttachment | null,
): Promise<ChatResponse> {
  const res = await apiFetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      user_text: userText,
      ...(image ? { image_base64: image.base64, image_mime: image.mime } : {}),
    }),
    // Matches the server's own 60s model timeout (plus one retry's slack) —
    // without this, a hung request strands the UI in "thinking" indefinitely.
    // A vision turn also runs on the slower model, so give it the same room.
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

// Sends a recorded audio turn to the server for transcription (ElevenLabs
// Scribe). The blob's MIME becomes the Content-Type so the server forwards it
// verbatim. Returns the (possibly empty) transcript.
export async function transcribeAudio(blob: Blob): Promise<string> {
  const res = await apiFetch("/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/mp4" },
    body: blob,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError("Could not transcribe the audio.");
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export interface BarcodeProduct {
  name: string;
  brand: string | null;
  nutrition: { calories: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null };
}

// Preview lookup — no side effects, just shows what's on the label before the
// user commits to logging it.
export async function lookupBarcode(code: string): Promise<BarcodeProduct | null> {
  const res = await apiFetch(`/barcode/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError("Could not look up that barcode.");
  return res.json();
}

// Logs a scanned product deterministically — no Claude call involved.
export async function logBarcodeEntry(barcode: string, grams: number): Promise<FoodEntry> {
  const res = await apiFetch("/barcode/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ barcode, grams }),
  });
  if (res.status === 404) throw new ApiError("Could not find that product anymore.");
  if (!res.ok) throw new ApiError("Could not log this item.");
  return res.json();
}

export interface GreetingResponse {
  text: string;
  audio_base64: string | null;
  audio_mime: string;
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

export interface FoodDbStats {
  yours: number;
  verified: number;
}

export async function fetchFoodDbStats(): Promise<FoodDbStats> {
  const res = await apiFetch("/stats/foods");
  if (!res.ok) throw new ApiError("Could not load food database stats.");
  return res.json();
}

export interface SynthesizeResponse {
  audio_base64: string | null;
  audio_mime: string;
}

// Short, server-controlled phrases only (200-char server-side cap) — see
// /synthesize on the server. Callers should treat a thrown/rejected call the
// same as "no audio" and fall back to local speechSynthesis, since this is
// specifically used in error-recovery paths where the network may itself be
// the problem.
export async function synthesizeText(text: string): Promise<SynthesizeResponse> {
  const res = await apiFetch("/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    // Short and bounded — this runs in error-recovery paths, so a slow
    // synthesize call shouldn't make the recovery itself feel broken. Falls
    // back to local speechSynthesis on any failure, including a timeout.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new ApiError("Could not synthesize speech.");
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

export async function fetchMe(): Promise<{ username: string }> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) throw new ApiError("Could not load account.");
  return res.json();
}

export interface SubmitFeedbackInput {
  message: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  log_snapshot: string | null;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<void> {
  const res = await apiFetch("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? "Could not send feedback.");
  }
}

export interface FeedbackItem {
  id: string;
  username: string;
  message: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  log_snapshot: string | null;
  transcript: string | null;
  created_at: string;
  status: string;
  resolution_note: string | null;
}

export async function fetchAdminFeedback(): Promise<FeedbackItem[]> {
  const res = await apiFetch("/admin/feedback");
  if (!res.ok) throw new ApiError("Could not load feedback.");
  return res.json();
}

export async function setFeedbackStatus(id: string, status: "new" | "reviewed"): Promise<void> {
  const res = await apiFetch(`/admin/feedback/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new ApiError("Could not update status.");
}

export async function setFeedbackResolutionNote(id: string, resolution_note: string | null): Promise<void> {
  const res = await apiFetch(`/admin/feedback/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolution_note }),
  });
  if (!res.ok) throw new ApiError("Could not save the note.");
}

export interface MyFeedbackItem {
  id: string;
  message: string | null;
  transcript: string | null;
  has_audio: number;
  created_at: string;
  status: string;
  resolution_note: string | null;
}

export async function fetchMyFeedback(): Promise<MyFeedbackItem[]> {
  const res = await apiFetch("/feedback/mine");
  if (!res.ok) throw new ApiError("Could not load your feedback.");
  return res.json();
}

export async function deleteFeedbackItem(id: string): Promise<void> {
  const res = await apiFetch(`/admin/feedback/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError("Could not delete this report.");
}

export async function transcribeFeedback(id: string): Promise<string> {
  const res = await apiFetch(`/admin/feedback/${id}/transcribe`, { method: "POST" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? "Could not transcribe this voice note.");
  }
  const data = (await res.json()) as { transcript: string };
  return data.transcript;
}

export interface ProvidersSnapshot {
  llm: {
    provider: "anthropic" | "gemini";
    model: string;
    vision_model: string | null;
    thinking_level: string | null;
  };
  tts: {
    default: { provider: "murf" | "elevenlabs" | "gemini"; model: string };
    romanian: { provider: "elevenlabs" | "gemini"; model: string };
  };
  stt: {
    default: { provider: "smallestai" | "elevenlabs"; model: string };
    romanian: { provider: "elevenlabs"; model: string };
  };
}

export async function fetchProviders(): Promise<ProvidersSnapshot> {
  const res = await apiFetch("/admin/providers");
  if (!res.ok) throw new ApiError("Could not load provider info.");
  return res.json();
}

export type FoodBasis = "per_100g" | "per_item";

export interface MyFoodItem {
  food_key: string;
  basis: FoodBasis;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: "estimate" | "correction";
  updated_at: string;
}

export async function fetchMyFoods(): Promise<MyFoodItem[]> {
  const res = await apiFetch("/foods/mine");
  if (!res.ok) throw new ApiError("Could not load your foods.");
  return res.json();
}

export interface UpsertMyFoodInput {
  food_key: string;
  basis: FoodBasis;
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

export async function upsertMyFood(input: UpsertMyFoodInput): Promise<MyFoodItem> {
  const res = await apiFetch("/foods/mine", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? "Could not save this food.");
  }
  return res.json();
}

export async function deleteMyFood(foodKey: string): Promise<void> {
  const res = await apiFetch(`/foods/mine/${encodeURIComponent(foodKey)}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError("Could not delete this food.");
}

// ---- client-side date helpers -------------------------------------------

// Local day key (YYYY-MM-DD) — server day buckets are computed the same way.
export function todayKey(): string {
  return dayKey(new Date());
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
