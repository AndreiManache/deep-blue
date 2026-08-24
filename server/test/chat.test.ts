import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// Every module below reaches config.ts/db.ts at import time, so the
// environment has to be in place before the dynamic imports further down:
// a throwaway SQLite file, and a fake Anthropic endpoint the SDK talks to
// instead of the real API (the SDK reads ANTHROPIC_BASE_URL on construction).
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.ELEVENLABS_API_KEY = ""; // no synthesis, no network

// Queue of canned Anthropic responses, one per request, plus a record of the
// message arrays the SDK actually sent — that request body is what the real
// API would have to accept, so it's the thing worth asserting on.
const queued: unknown[] = [];
const receivedMessages: { role: string; content: unknown }[][] = [];

const toolUseReply = (id: string) => ({
  id: `msg_${id}`,
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [
    { type: "text", text: "Let me check." },
    { type: "tool_use", id: `toolu_${id}`, name: "get_entries", input: {} },
  ],
});

const textReply = (text: string) => ({
  id: "msg_final",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: "text", text }],
});

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    receivedMessages.push(JSON.parse(body).messages);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(queued.shift() ?? textReply("Done.")));
  });
});

let runTurn: typeof import("../src/chat.js").runTurn;
let getHistory: typeof import("../src/sessions.js").getHistory;
let MAX_TOOL_ITERATIONS: number;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;

  ({ runTurn } = await import("../src/chat.js"));
  ({ getHistory } = await import("../src/sessions.js"));
  ({ MAX_TOOL_ITERATIONS } = await import("../src/config.js"));
});

after(() => {
  server.close();
  // Best-effort: on Windows the open SQLite handle keeps the file locked
  // (node:sqlite has no close on this path), so deletion can fail — a
  // leftover temp dir is not a test failure.
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {
    /* leave the temp dir behind */
  }
});

// A user message whose content is entirely tool_result blocks — the shape
// history must never be left ending on.
function isToolResultCarrier(message: { role: string; content: unknown }): boolean {
  return (
    message.role === "user" &&
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every((block: { type: string }) => block.type === "tool_result")
  );
}

describe("runTurn tool-loop exhaustion", () => {
  it("closes the turn with a real spoken fallback instead of a fabricated 'Okay.'", async () => {
    // Every response asks for another tool call, so the loop can only end by
    // burning the iteration cap.
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) queued.push(toolUseReply(String(i)));

    const result = await runTurn("session-exhausted", "andrei", "what did I eat today?");

    assert.equal(queued.length, 0, "should have used exactly MAX_TOOL_ITERATIONS model calls");
    assert.notEqual(result.reply_text, "Okay.");
    assert.match(result.reply_text, /try again/i);
  });

  it("leaves history ending in a closing assistant turn, not dangling tool results", async () => {
    const history = getHistory("session-exhausted");
    const last = history[history.length - 1];

    assert.equal(last.role, "assistant");
    assert.ok(!isToolResultCarrier(last as { role: string; content: unknown }));
    assert.deepEqual(last.content, [
      { type: "text", text: "Sorry, that got complicated — can you try again?" },
    ]);
  });

  it("leaves the session resumable — the next turn's request still alternates roles", async () => {
    queued.push(textReply("Two eggs, 180 calories."));
    receivedMessages.length = 0;

    await runTurn("session-exhausted", "andrei", "and yesterday?");

    const sent = receivedMessages[0];
    const consecutive = sent.filter((message, i) => i > 0 && sent[i - 1].role === message.role);
    assert.deepEqual(consecutive, [], "no two consecutive messages may share a role");
  });
});

describe("runTurn normal completion", () => {
  it("still stores the model's own final assistant turn verbatim", async () => {
    queued.push(toolUseReply("a"), textReply("Logged it."));

    const result = await runTurn("session-normal", "andrei", "log two eggs");

    assert.equal(result.reply_text, "Logged it.");
    const history = getHistory("session-normal");
    assert.deepEqual(history[history.length - 1], {
      role: "assistant",
      content: [{ type: "text", text: "Logged it." }],
    });
  });
});
