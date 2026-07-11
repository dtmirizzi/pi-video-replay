/**
 * asciinema .cast file writer (v2 format, widely compatible).
 * v2 uses absolute timestamps and a simpler header.
 */
import { writeFileSync } from "node:fs";
import type { CastEvent } from "./types.js";

/**
 * Write an asciinema v2 .cast file.
 * v2 is the most widely supported format (asciinema CLI, agg, asciinema2video, etc.)
 */
export function writeCastFile(
  path: string,
  options: {
    width?: number;
    height?: number;
    title?: string;
    cwd?: string;
  },
  events: CastEvent[],
): void {
  const width = options.width ?? 100;
  const height = options.height ?? 30;

  // v2 header (simpler than v3)
  const header = {
    version: 2,
    width,
    height,
    timestamp: Math.floor(Date.now() / 1000),
    title: options.title,
    env: {
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
    },
  };

  const lines: string[] = [];
  lines.push(JSON.stringify(header));

  // v2 uses absolute timestamps, not relative intervals
  let elapsed = 0;
  for (const event of events) {
    elapsed += event.interval;
    // Round to 6 decimal places for v2 compatibility
    const t = Math.round(elapsed * 1_000_000) / 1_000_000;
    lines.push(JSON.stringify([t, event.code, event.data]));
  }

  // Add exit event if not present
  const lastEvent = events[events.length - 1];
  if (!lastEvent || lastEvent.code !== "x") {
    elapsed += 0.1;
    lines.push(JSON.stringify([Math.round(elapsed * 1_000_000) / 1_000_000, "x", "0"]));
  }

  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}