/**
 * Baseline tests for pi-video-replay.
 * Run with: npx vitest run
 */
import { describe, it, expect } from "vitest";
import { ansi, stripAnsi } from "../ansi.js";
import { applyTiming, applySceneTiming } from "../typing.js";
import { PiSessionConverter } from "../converters/pi.js";
import { renderSession } from "../renderer.js";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

describe("ansi helpers", () => {
  it("stripAnsi removes escape codes", () => {
    const input = "\x1b[38;2;138;190;183mHello\x1b[0m";
    expect(stripAnsi(input)).toBe("Hello");
  });

  it("stripAnsi removes OSC sequences", () => {
    const input = "\x1b]133;A\x07Hello";
    expect(stripAnsi(input)).toBe("Hello");
  });

  it("accent wraps in color codes", () => {
    const result = ansi.accent("test");
    expect(result).toContain("\x1b[38;2;138;190;183m");
    expect(result).toContain("\x1b[0m");
  });

  it("bold wraps in bold code", () => {
    const result = ansi.bold("test");
    expect(result).toContain("\x1b[1m");
  });

  it("bgToolPending uses correct background", () => {
    const result = ansi.bgToolPending("test");
    expect(result).toContain("\x1b[48;2;40;40;50m");
    expect(result).toContain("test");
  });

  it("bgToolError uses correct background", () => {
    const result = ansi.bgToolError("test");
    expect(result).toContain("\x1b[48;2;60;40;40m");
  });

  it("bgToolSuccess uses correct background", () => {
    const result = ansi.bgToolSuccess("test");
    expect(result).toContain("\x1b[48;2;40;50;40m");
  });
});

// ---------------------------------------------------------------------------
// Session converter
// ---------------------------------------------------------------------------

describe("PiSessionConverter", () => {
  const converter = new PiSessionConverter();

  it("detects a Pi session file", async () => {
    const tmp = join(tmpdir(), `pi-test-${Date.now()}.jsonl`);
    writeFileSync(tmp, '{"type":"session","version":3,"id":"test","timestamp":"2024-01-01T00:00:00Z","cwd":"/test"}\n');
    const result = await converter.canHandle(tmp);
    unlinkSync(tmp);
    expect(result).toBe(true);
  });

  it("rejects non-Pi files", async () => {
    const tmp = join(tmpdir(), `pi-test-${Date.now()}.txt`);
    writeFileSync(tmp, "not a pi session\n");
    const result = await converter.canHandle(tmp);
    unlinkSync(tmp);
    expect(result).toBe(false);
  });

  it("converts a simple session", async () => {
    const tmp = join(tmpdir(), `pi-test-${Date.now()}.jsonl`);
    const sessionData = [
      '{"type":"session","version":3,"id":"test","timestamp":"2024-01-01T00:00:00Z","cwd":"/test"}',
      '{"type":"message","id":"a","parentId":null,"timestamp":"2024-01-01T00:00:01Z","message":{"role":"user","content":"hello","timestamp":1}}',
      '{"type":"message","id":"b","parentId":"a","timestamp":"2024-01-01T00:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}],"model":"test","provider":"test","stopReason":"stop","timestamp":2,"api":"test","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}',
    ].join("\n") + "\n";
    writeFileSync(tmp, sessionData);
    const result = await converter.convert(tmp);
    unlinkSync(tmp);
    expect(result.cwd).toBe("/test");
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]!.type).toBe("user-message");
    expect(result.entries[1]!.type).toBe("assistant-message");
  });
});

// ---------------------------------------------------------------------------
// Timing engine
// ---------------------------------------------------------------------------

describe("applySceneTiming", () => {
  it("produces timed events from chunks", () => {
    const chunks = [
      { lines: ["hello"], type: "user-message" as const },
      { lines: ["world"], type: "assistant-text" as const },
    ];
    const events = applySceneTiming(chunks, {
      speed: 1,
      typing: "scene",
      charDelayMs: 60,
      paragraphDelayMs: 200,
      chunkDelayMs: 80,
      chunkLines: 5,
      messagePauseMs: 500,
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.code).toBe("o");
    expect(events[0]!.interval).toBeGreaterThan(0);
  });

  it("skips empty chunks", () => {
    const chunks = [
      { lines: [], type: "divider" as const },
      { lines: ["text"], type: "user-message" as const },
    ];
    const events = applySceneTiming(chunks, {
      speed: 1, typing: "scene",
      charDelayMs: 60, paragraphDelayMs: 200,
      chunkDelayMs: 80, chunkLines: 5, messagePauseMs: 500,
    });
    expect(events.length).toBe(1);
  });
});

describe("applyTiming", () => {
  it("produces character-level events for user messages", () => {
    const chunks = [
      { lines: ["ab"], type: "user-message" as const },
    ];
    const events = applyTiming(chunks, {
      speed: 1,
      typing: "user-only",
      charDelayMs: 60,
      paragraphDelayMs: 200,
      chunkDelayMs: 80,
      chunkLines: 5,
      messagePauseMs: 500,
    });
    // Should have multiple events per character + line endings
    expect(events.length).toBeGreaterThan(2);
    expect(events[0]!.code).toBe("o");
  });
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

describe("renderSession", () => {
  it("renders a title and user message", () => {
    const chunks = renderSession({
      cwd: "/test",
      title: "Test Session",
      entries: [
        {
          type: "user-message",
          text: "Hello world",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ],
    }, { width: 80 });
    expect(chunks.length).toBeGreaterThan(0);
    // Should have a title annotation
    expect(chunks.some(c => c.type === "annotation")).toBe(true);
    // Should have the user message
    expect(chunks.some(c => c.type === "user-message")).toBe(true);
  });

  it("renders assistant messages with thinking hidden", () => {
    const chunks = renderSession({
      cwd: "/test",
      entries: [
        {
          type: "assistant-message",
          content: {
            textBlocks: ["Response text"],
            thinkingBlocks: ["Internal reasoning"],
            toolCalls: [],
          },
        },
      ],
    }, { width: 80, showThinking: false });
    expect(chunks.some(c => c.type === "assistant-text")).toBe(true);
  });

  it("hides tool calls when showTools is false", () => {
    const chunks = renderSession({
      cwd: "/test",
      entries: [
        {
          type: "assistant-message",
          content: {
            textBlocks: ["text"],
            thinkingBlocks: [],
            toolCalls: [
              { id: "1", name: "bash", arguments: { command: "ls" } },
            ],
          },
        },
      ],
    }, { width: 80, showTools: false });
    // Should NOT have tool-header chunks
    expect(chunks.some(c => c.type === "tool-header")).toBe(false);
  });
});