// Types shared across the pi-video-replay tool

/**
 * A single asciinema cast event.
 * interval = seconds since previous event (relative for internal use; v2 output uses absolute).
 */
export interface CastEvent {
  interval: number;
  code: "o" | "i" | "r" | "m" | "x";
  data: string;
}

export type { CastEvent as default };

/**
 * Content type classification for timing decisions.
 */
export type ContentType =
  | "user-message"
  | "assistant-text"
  | "assistant-thinking"
  | "code-block"
  | "tool-header"
  | "tool-result"
  | "bash-command"
  | "bash-output"
  | "summary"
  | "annotation"
  | "divider";

/**
 * A chunk of rendered content with its type (for timing engine).
 */
export interface RenderedChunk {
  lines: string[];
  type: ContentType;
}

/**
 * Timing options for the replay.
 */
export interface TimingOptions {
  /** Speed multiplier: 1.0 = normal, 2.0 = double speed */
  speed: number;
  /** Typing mode: "user-only" | "all" | "none" */
  typing: "user-only" | "all" | "none" | "scene";
  /** Character delay in ms (scaled by speed) */
  charDelayMs: number;
  /** Paragraph delay in ms (scaled by speed) */
  paragraphDelayMs: number;
  /** Chunk delay for streaming output in ms */
  chunkDelayMs: number;
  /** Lines per chunk for streaming output */
  chunkLines: number;
  /** Pause between messages in ms */
  messagePauseMs: number;
}

export const DEFAULT_TIMING: TimingOptions = {
  speed: 1.0,
  typing: "user-only",
  charDelayMs: 60,
  paragraphDelayMs: 200,
  chunkDelayMs: 80,
  chunkLines: 5,
  messagePauseMs: 500,
};