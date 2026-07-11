/**
 * Timing engine: converts rendered ANSI chunks into asciinema cast events.
 *
 * Two modes:
 *   - applyTiming(): character-by-character typing + paragraph chunking (terminal playback)
 *   - applySceneTiming(): clean scene-level events with reading-time holds (video/gif output)
 */
import type { RenderedChunk, CastEvent, TimingOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Interactive mode: character-by-character typing + paragraph streaming
// ---------------------------------------------------------------------------

export function applyTiming(
  chunks: RenderedChunk[],
  options: TimingOptions,
): CastEvent[] {
  const events: CastEvent[] = [];

  for (const chunk of chunks) {
    if (chunk.lines.length === 0) continue;

    switch (chunk.type) {
      case "user-message":
      case "bash-command":
        events.push(...renderUserTyping(chunk.lines, options));
        break;
      case "assistant-text":
      case "summary":
        events.push(...renderParagraphChunks(chunk.lines, options));
        break;
      case "code-block":
        events.push(...renderInstant(chunk.lines));
        break;
      case "tool-header":
        events.push(...renderQuickFade(chunk.lines, options));
        break;
      case "bash-output":
      case "tool-result":
        events.push(...renderStreamingChunks(chunk.lines, options));
        break;
      default:
        events.push(...renderInstant(chunk.lines));
    }
  }

  return events;
}

function renderUserTyping(lines: string[], options: TimingOptions): CastEvent[] {
  if (options.typing === "none") {
    const text = lines.map((l) => l + "\r\n").join("");
    return [{ interval: 0.01, code: "o" as const, data: text }];
  }

  const events: CastEvent[] = [];
  const delay = (options.charDelayMs / options.speed) / 1000;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const tokens = tokenizeAnsi(line);

    for (let ti = 0; ti < tokens.length; ti++) {
      const prefix = tokens.slice(0, ti + 1).join("");
      const isFirst = li === 0 && ti === 0;
      events.push({
        interval: isFirst ? 0.01 : delay,
        code: "o",
        data: isFirst ? prefix : (ti === 0 ? "\r\n" + prefix : tokens[ti]!),
      });
    }
    events.push({ interval: delay * 2, code: "o", data: "\r\n" });
  }

  return events;
}

/** Split string into tokens: ANSI escapes stay atomic, chars are individual */
function tokenizeAnsi(s: string): string[] {
  const tokens: string[] = [];
  const re = /(\x1b\[[0-9;]*[a-zA-Z]|\x1b][0-9;]*[^\x07]*\x07|\r\n|\r|\n)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    for (const ch of s.slice(lastIdx, m.index)) tokens.push(ch);
    tokens.push(m[0]);
    lastIdx = re.lastIndex;
  }
  for (const ch of s.slice(lastIdx)) tokens.push(ch);
  return tokens;
}

function renderParagraphChunks(lines: string[], options: TimingOptions): CastEvent[] {
  const delay = (options.paragraphDelayMs / options.speed) / 1000;
  const paragraphs: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l.trim() === "" && cur.length > 0) { paragraphs.push(cur); cur = []; }
    else cur.push(l);
  }
  if (cur.length > 0) paragraphs.push(cur);

  const events: CastEvent[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    events.push({
      interval: i === 0 ? 0.1 : delay,
      code: "o",
      data: paragraphs[i]!.map((l) => l + "\r\n").join(""),
    });
  }
  return events;
}

function renderStreamingChunks(lines: string[], options: TimingOptions): CastEvent[] {
  const delay = (options.chunkDelayMs / options.speed) / 1000;
  const n = options.chunkLines;
  const events: CastEvent[] = [];
  for (let i = 0; i < lines.length; i += n) {
    events.push({
      interval: i === 0 ? 0.05 : delay,
      code: "o",
      data: lines.slice(i, i + n).map((l) => l + "\r\n").join(""),
    });
  }
  return events;
}

function renderQuickFade(lines: string[], options: TimingOptions): CastEvent[] {
  const delay = (150 / options.speed) / 1000;
  return lines.map((l, i) => ({
    interval: i === 0 ? delay : 0.01,
    code: "o" as const,
    data: l + "\r\n",
  }));
}

function renderInstant(lines: string[]): CastEvent[] {
  return [{ interval: 0.01, code: "o" as const, data: lines.map((l) => l + "\r\n").join("") }];
}

// ---------------------------------------------------------------------------
// Scene mode: clean, well-spaced events for video/gif output
// ---------------------------------------------------------------------------

/**
 * Apply scene-level timing: each chunk becomes one event with a calculated
 * hold time based on content length. No character-by-character typing.
 * Produces clean frames for video conversion.
 */
export function applySceneTiming(
  chunks: RenderedChunk[],
  options: TimingOptions,
): CastEvent[] {
  const speed = options.speed;
  const merged = mergeAdjacentChunks(chunks);
  const events: CastEvent[] = [];

  for (const chunk of merged) {
    if (chunk.lines.length === 0) continue;
    const text = chunk.lines.map((l) => l + "\r\n").join("");
    events.push({
      interval: calculateHold(chunk, speed),
      code: "o" as const,
      data: text,
    });
  }

  return events;
}

/**
 * Merge chunks into coherent video scenes.
 * - Removes dividers between scenes
 * - Groups tool call + result into single scenes
 * - Merges adjacent same-type chunks
 */
function mergeAdjacentChunks(chunks: RenderedChunk[]): RenderedChunk[] {
  // First pass: combine tool-header with following tool-result
  const combined: RenderedChunk[] = [];
  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i]!;
    if (chunk.type === "tool-header") {
      // Look ahead for tool-result(s) to merge
      const merged: RenderedChunk = { lines: [...chunk.lines], type: "tool-header" };
      i++;
      while (i < chunks.length && (chunks[i]!.type === "tool-result" || chunks[i]!.type === "bash-output" || chunks[i]!.type === "code-block")) {
        merged.lines.push(...chunks[i]!.lines);
        i++;
      }
      combined.push(merged);
    } else {
      combined.push({ lines: [...chunk.lines], type: chunk.type });
      i++;
    }
  }

  // Second pass: merge adjacent same-type, but never merge tool-headers (each is a scene)
  const merged: RenderedChunk[] = [];
  for (const chunk of combined) {
    if (chunk.lines.length === 0) continue;
    if (chunk.type === "divider") continue;
    // Keep title-style annotations (borders), skip internal model/thinking change notifications
    if (chunk.type === "annotation") {
      const text = chunk.lines.join(" ").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      // Keep: title cards, spinner loading indicators
      if (text.includes("─") || text.includes("Pi Session") || text.includes("⠋")) {
        merged.push({ lines: [...chunk.lines], type: chunk.type });
      }
      continue;
    }

    const last = merged[merged.length - 1];
    // Don't merge tool-headers - each tool call is its own visual scene
    const mergeable = chunk.type !== "tool-header" && chunk.type !== "user-message";
    if (last && last.type === chunk.type && mergeable) {
      last.lines = [...last.lines, "", ...chunk.lines];
    } else {
      merged.push({ lines: [...chunk.lines], type: chunk.type });
    }
  }

  return merged;
}

function calculateHold(chunk: RenderedChunk, speed: number): number {
  // Count visible characters only: strip ANSI, trailing whitespace, and OSC markers
  const plainLines = chunk.lines.map((l) =>
    l
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\x1b][^\x07]*\x07/g, "")
      .replace(/\s+$/, "")
  );
  const visibleText = plainLines.filter((l) => l.trim()).join(" ");
  const plainLen = visibleText.length;

  // Empty/whitespace-only chunks: minimal hold
  if (plainLen === 0) return 0.2 / speed;
  switch (chunk.type) {
    case "user-message":   return Math.min(5, Math.max(2, plainLen / 20)) / speed;
    case "assistant-text": return Math.min(5, Math.max(1.5, plainLen / 25)) / speed;
    case "tool-header":    return Math.min(5, 1.5) / speed;
    case "tool-result":
    case "bash-output":    return Math.min(5, Math.max(1, plainLen / 30)) / speed;
    case "code-block":     return Math.min(5, Math.max(2, plainLen / 15)) / speed;
    case "annotation":     return 0.5 / speed;
    case "divider":        return 0.2 / speed;
    default:               return Math.min(5, Math.max(1, plainLen / 25)) / speed;
  }
}