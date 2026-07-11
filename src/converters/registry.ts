import type { SessionConverter } from "./types.js";
import { PiSessionConverter } from "./pi.js";
import { readFileSync } from "node:fs";

// Placeholder for future converters (Claude Code, etc.)
// import { ClaudeCodeConverter } from "./claude-code.js";

/**
 * Registry of available converters.
 * Order matters: earlier converters get first chance to handle a file.
 */
const converters: SessionConverter[] = [
  new PiSessionConverter(),
  // new ClaudeCodeConverter(),  // future
];

/**
 * Auto-detect the appropriate converter for a file, or return the default.
 */
export async function detectConverter(filePath: string): Promise<SessionConverter> {
  for (const converter of converters) {
    if (await converter.canHandle(filePath)) {
      return converter;
    }
  }
  // Default to Pi format
  return converters[0]!;
}

/**
 * Get a converter by name.
 */
export function getConverter(name: string): SessionConverter | undefined {
  return converters.find((c) => c.name === name);
}

/**
 * List available converter names.
 */
export function listConverters(): string[] {
  return converters.map((c) => c.name);
}
