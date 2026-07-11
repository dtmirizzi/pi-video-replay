import { readFileSync } from "node:fs";
import type { SessionConverter, ConvertedSession, ConvertedEntry } from "./types.js";

/**
 * Converter for native Pi session files (JSONL format).
 * This is a pass-through that reads the Pi session format and normalizes
 * entries for the rendering engine.
 */
export class PiSessionConverter implements SessionConverter {
  readonly name = "pi";

  async canHandle(filePath: string): Promise<boolean> {
    try {
      const firstLine = readFileSync(filePath, "utf8").split("\n")[0] ?? "";
      const parsed = JSON.parse(firstLine);
      return parsed.type === "session" && parsed.cwd !== undefined;
    } catch {
      return false;
    }
  }

  async convert(filePath: string): Promise<ConvertedSession> {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.trim().split("\n");

    const header = JSON.parse(lines[0]!);

    // Build an id→entry map and track parent→child relationships
    const byId = new Map<string, Record<string, unknown>>();
    const children = new Map<string | null, string[]>();

    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.id !== undefined && entry.type !== "session") {
        byId.set(entry.id as string, entry);
        const pid = entry.parentId as string | null;
        const key = pid ?? "__root__";
        if (!children.has(key)) children.set(key, []);
        children.get(key)!.push(entry.id as string);
      }
    }

    // Find the leaf: entry with no children
    let leafId: string | null = null;
    for (const id of byId.keys()) {
      if (!children.has(id) || children.get(id)!.length === 0) {
        leafId = id;
        break;
      }
    }

    if (!leafId) {
      return { cwd: header.cwd as string, entries: [] };
    }

    // Walk from leaf to root
    const path: Record<string, unknown>[] = [];
    let current: string | null = leafId;
    while (current) {
      const entry = byId.get(current);
      if (!entry) break;
      path.unshift(entry);
      current = entry.parentId as string | null;
    }

    // Convert path entries to normalized format
    const entries = this.normalizePath(path);

    return {
      cwd: (header.cwd as string) || process.cwd(),
      title: `Pi session: ${new Date(header.timestamp as string).toLocaleDateString()}`,
      entries,
    };
  }

  private normalizePath(path: Record<string, unknown>[]): ConvertedEntry[] {
    const entries: ConvertedEntry[] = [];

    for (let i = 0; i < path.length; i++) {
      const entry = path[i]!;
      const type = entry.type as string;

      switch (type) {
        case "message": {
          const msg = entry.message as Record<string, unknown>;
          const role = msg.role as string;

          if (role === "user") {
            entries.push({
              type: "user-message",
              text: this.extractText(msg.content),
              timestamp: entry.timestamp as string,
            });
          } else if (role === "assistant") {
            const content = msg.content as Array<Record<string, unknown>>;
            const textBlocks: string[] = [];
            const thinkingBlocks: string[] = [];
            const toolCalls: Array<{
              id: string;
              name: string;
              arguments: Record<string, unknown>;
              result?: {
                content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
                isError: boolean;
                details?: unknown;
              };
            }> = [];

            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                textBlocks.push(block.text);
              } else if (block.type === "thinking" && typeof block.thinking === "string") {
                thinkingBlocks.push(block.thinking);
              } else if (block.type === "toolCall") {
                toolCalls.push({
                  id: block.id as string,
                  name: block.name as string,
                  arguments: block.arguments as Record<string, unknown>,
                });
              }
            }

            // Look ahead for tool results matching these calls
            if (toolCalls.length > 0) {
              const pendingIds = new Set(toolCalls.map((tc) => tc.id));
              let j = i + 1;
              while (j < path.length && pendingIds.size > 0) {
                const nextEntry = path[j]!;
                if (nextEntry.type === "message") {
                  const nextMsg = nextEntry.message as Record<string, unknown>;
                  if (nextMsg.role === "toolResult") {
                    const toolCallId = nextMsg.toolCallId as string;
                    if (pendingIds.has(toolCallId)) {
                      const tc = toolCalls.find((t) => t.id === toolCallId);
                      if (tc) {
                        tc.result = {
                          content: (nextMsg.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>) || [],
                          isError: nextMsg.isError as boolean,
                          details: nextMsg.details,
                        };
                      }
                      pendingIds.delete(toolCallId);
                    }
                  } else {
                    // Hit a non-toolResult message; stop looking
                    break;
                  }
                } else if (nextEntry.type !== "message") {
                  // Skip non-message entries between tool results
                  j++;
                  continue;
                } else {
                  break;
                }
                j++;
              }
            }

            entries.push({
              type: "assistant-message",
              content: {
                textBlocks,
                thinkingBlocks,
                toolCalls,
                stopReason: (msg.stopReason as "stop" | "length" | "toolUse" | "error" | "aborted") || undefined,
                errorMessage: msg.errorMessage as string | undefined,
                model: msg.model as string | undefined,
                provider: msg.provider as string | undefined,
              },
            });
          }
          // Skip toolResult messages — they're handled inline with tool calls
          break;
        }

        case "model_change":
          entries.push({
            type: "annotation",
            text: `Model: ${entry.provider}/${entry.modelId}`,
            annotationType: "model-change",
          });
          break;

        case "thinking_level_change":
          entries.push({
            type: "annotation",
            text: `Thinking: ${entry.thinkingLevel}`,
            annotationType: "thinking-change",
          });
          break;

        case "compaction":
          entries.push({
            type: "annotation",
            text: `Context compacted (was ${entry.tokensBefore} tokens)`,
            annotationType: "compaction",
          });
          break;

        case "branch_summary":
          entries.push({
            type: "annotation",
            text: `Branch summary: ${(entry.summary as string).slice(0, 80)}...`,
            annotationType: "branch-summary",
          });
          break;

        case "label":
          if (entry.label) {
            entries.push({
              type: "annotation",
              text: `Label: ${entry.label}`,
              annotationType: "label",
            });
          }
          break;

        case "session_info":
          if (entry.name) {
            entries.push({
              type: "annotation",
              text: `Session: ${entry.name}`,
              annotationType: "info",
            });
          }
          break;

        // Skip: session header, custom entries, etc.
      }
    }

    return entries;
  }

  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c: Record<string, unknown>) => c.type === "text")
        .map((c: Record<string, unknown>) => (c.text as string) || "")
        .join("\n");
    }
    return String(content || "");
  }
}