import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests for the parts of the conversation state machine that
// don't need real audio hardware — auth, navigation, and screen rendering.
// Deliberately NOT covering the voice pipeline's own ordering guarantees
// (permission-before-speech, echo-guard epochs, no-listening-while-speaking)
// yet — that needs mocking getUserMedia/MediaRecorder/AudioContext
// realistically enough to drive SpeechCapture's actual state transitions,
// which is real, separate work (see BACKLOG.md). This is the foundation:
// a real browser, a real backend, real auth, real navigation.
export default defineConfig({
  testDir: "./e2e",
  // Serial, not parallel: the backend hashes passwords with scryptSync
  // (auth.ts), which is deliberately slow and synchronous — it blocks the
  // single dev-server process's entire event loop. A handful of tests
  // registering accounts in parallel queue up behind each other and time
  // out; running one at a time against this single local process is both
  // simpler and actually reliable. Revisit if this suite grows enough for
  // the serial runtime to matter, or once there's a dedicated test server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: "list",
  // A bit more generous than Playwright's 30s/5s defaults — this hits a
  // real backend doing real (deliberately slow) scrypt password hashing on
  // every register/login, so a loaded dev machine has less margin than a
  // typical static-page test suite.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Starts both halves of the app — the backend must be running for auth
  // and every API call to actually work, not just the frontend dev server.
  // reuseExistingServer means this plays nicely with .claude/launch.json's
  // "web"/"server" configs already running during normal dev.
  webServer: [
    {
      command: "npm run dev",
      cwd: "../server",
      port: 3001,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
