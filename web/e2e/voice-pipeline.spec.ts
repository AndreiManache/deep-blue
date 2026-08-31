import { expect, test, type Page } from "@playwright/test";
import { getFakeAudioEvents, installFakeAudioDevice, setFakeRms } from "./fakeDevice";
import { registerAndLogin, stubChat, stubTranscribe, uniqueUsername } from "./helpers";

// Covers the voice pipeline's own ordering guarantees (BACKLOG.md
// "Engineering hygiene" item) — permission before speech, no listening while
// the AI talks, and the epoch guard that discards a stale network result
// after the session has already moved on. registerAndLogin's greeting stub
// has no audio, so the greeting "speaks" via the browser's speechSynthesis
// fallback (speech/synthesis.ts's speakLocal) — its own ~3s watchdog fires
// onEnd even where headless Chromium has no real voices/audio output, which
// is what every wait below is actually timed against.

test.beforeEach(async ({ page }) => {
  await installFakeAudioDevice(page);
  await registerAndLogin(page, uniqueUsername("e2e_voice"));
});

async function tapOrb(page: Page) {
  await page.getByText("Tap to talk").click();
}

// Drives the fake mic through one full speech-then-silence cycle: loud
// enough to cross START_RMS (onSpeechStart), then quiet past END_SILENCE_MS
// (1200ms, capture.ts) so the VAD ends the turn and delivers onResult.
async function speakOneTurn(page: Page) {
  await setFakeRms(page, 0.1);
  await page.waitForTimeout(150);
  await setFakeRms(page, 0.005);
  await page.waitForTimeout(1400);
}

test("acquires mic permission before any recording starts", async ({ page }) => {
  await tapOrb(page);
  // Greeting speaks first (watchdog ~3s for "Hello there") before the mic
  // actually opens for listening — generous wait matches that budget.
  await expect(page.getByText("I'm listening")).toBeVisible({ timeout: 6000 });

  const events = await getFakeAudioEvents(page);
  const names = events.map((e) => e.name);
  expect(names).toContain("getUserMedia-resolved");
  expect(names).toContain("recorder-start");

  const permissionAt = events.find((e) => e.name === "getUserMedia-resolved")!.t;
  const firstRecorderStart = events.find((e) => e.name === "recorder-start")!.t;
  expect(firstRecorderStart).toBeGreaterThanOrEqual(permissionAt);
});

test("never opens the mic while the AI is still speaking", async ({ page }) => {
  await tapOrb(page);
  // Right after the tap the app is acquiring the mic and then speaking the
  // greeting — recording must not start until that's over and the UI
  // actually reaches "listening".
  await expect(page.getByText("Talking")).toBeVisible({ timeout: 2000 });
  const eventsWhileSpeaking = await getFakeAudioEvents(page);
  expect(eventsWhileSpeaking.map((e) => e.name)).not.toContain("recorder-start");

  await expect(page.getByText("I'm listening")).toBeVisible({ timeout: 6000 });
  const eventsOnceListening = await getFakeAudioEvents(page);
  expect(eventsOnceListening.map((e) => e.name)).toContain("recorder-start");
});

test("a /chat reply that arrives after the session ends is discarded, not spoken or reopened", async ({
  page,
}) => {
  await stubTranscribe(page, "two eggs and coffee");
  // Held open well past when the test ends the session, so the assertions
  // below are checking the *arrival* of a genuinely stale response.
  await stubChat(page, { reply_text: "Logged it." }, 3000);

  await tapOrb(page);
  await expect(page.getByText("I'm listening")).toBeVisible({ timeout: 6000 });
  await speakOneTurn(page);

  // transcribeAndSend -> POST /transcribe -> handleFinalTranscript -> POST
  // /chat, now in flight behind the 3s stub delay.
  await expect(page.getByText("One moment")).toBeVisible({ timeout: 3000 });

  await page.getByRole("button", { name: "End conversation" }).click();
  await expect(page.getByText("Tap to talk")).toBeVisible();

  const eventsAtEnd = await getFakeAudioEvents(page);
  const recorderStartsBeforeEnd = eventsAtEnd.filter((e) => e.name === "recorder-start").length;

  // Now wait past the stub's delay so the stale /chat response actually
  // resolves into the app.
  await page.waitForTimeout(3500);

  // The epoch guard (handleFinalTranscript's `if (epochRef.current !==
  // myEpoch) return`) should have made this a no-op: still on the home
  // screen, no new recording opened to "listen" for a reply to a
  // conversation that's already over.
  await expect(page.getByText("Tap to talk")).toBeVisible();
  const eventsAfterStaleReply = await getFakeAudioEvents(page);
  expect(eventsAfterStaleReply.filter((e) => e.name === "recorder-start").length).toBe(
    recorderStartsBeforeEnd,
  );
});
