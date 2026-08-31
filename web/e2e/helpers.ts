import type { Page } from "@playwright/test";

// A fresh, collision-free username per test run/worker — usernames are
// unique in the DB, so re-running the suite (or running workers in
// parallel) must never reuse one.
export function uniqueUsername(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export const TEST_PASSWORD = "e2e-test-password-123";

// Every session prefetches a spoken greeting (App.tsx, once authed) — a
// real TTS call to Murf otherwise. Each test's username is unique (see
// uniqueUsername), which defeats the server's greeting-text cache and would
// mean every single test run pays for a real synthesis it doesn't need for
// anything this suite actually checks. Stubbed here instead: same JSON
// shape the real endpoint returns, no audio, no network call, no cost.
async function stubGreeting(page: Page): Promise<void> {
  await page.route("**/greeting", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ text: "Hello", audio_base64: null, audio_mime: "audio/mpeg", lang: "en-US" }),
    }),
  );
}

// Registers a brand-new account and waits for the home screen (the orb) to
// confirm the whole register -> authed -> home round trip actually worked,
// not just that the request didn't throw.
export async function registerAndLogin(page: Page, username: string): Promise<void> {
  await stubGreeting(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByText("Tap to talk").waitFor();
}

// Same shape as the real /transcribe response ({ text }) — no real STT call,
// no network dependency, no cost.
export async function stubTranscribe(page: Page, text: string): Promise<void> {
  await page.route("**/transcribe", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ text }) }),
  );
}

// Same shape as the real /chat response (ChatResponse). delayMs lets a test
// hold the response open to exercise what happens while a turn is still
// in flight (e.g. ending the session before it resolves).
export async function stubChat(
  page: Page,
  overrides: Partial<{
    reply_text: string;
    ended: boolean;
    mutated: boolean;
    audio_base64: string | null;
    audio_mime: string;
    lang: string;
  }> = {},
  delayMs = 0,
): Promise<void> {
  await page.route("**/chat", async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        reply_text: "Got it.",
        ended: false,
        mutated: false,
        audio_base64: null,
        audio_mime: "audio/mpeg",
        lang: "en-US",
        ...overrides,
      }),
    });
  });
}
