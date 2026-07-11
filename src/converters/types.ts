// Converter interface for supporting multiple session formats

/**
 * Each converter handles one session format (Pi native, Claude Code, etc.).
 * Converters normalize their format into entries that the rendering engine
 * can process.
 */
export interface SessionConverter {
  /** Human-readable name of the format */
  readonly name: string;

  /**
   * Detect whether this converter can handle the given file.
   * For Pi: check for '{"type":"session"' in first line.
   * For Claude: check for Claude-specific fields.
   */
  canHandle(filePath: string): Promise<boolean>;

  /**
   * Convert a session file into normalized entries for the rendering engine.
   * Returns the session header info and ordered message entries.
   */
  convert(filePath: string): Promise<ConvertedSession>;
}

/**
 * A normalized session ready for rendering.
 * Converters produce this from their native format.
 */
export interface ConvertedSession {
  /** Working directory the session was recorded in */
  cwd: string;
  /** Session title (for cast header) */
  title?: string;
  /** Ordered entries for rendering */
  entries: ConvertedEntry[];
}

/**
 * A normalized entry ready for rendering.
 * This is the common representation that the renderer understands.
 */
export type ConvertedEntry =
  | ConvertedUserMessage
  | ConvertedAssistantMessage
  | ConvertedToolResult
  | ConvertedAnnotation;

export interface ConvertedUserMessage {
  type: "user-message";
  /** User's text (already extracted from content blocks) */
  text: string;
  timestamp: string;
}

export interface ConvertedAssistantMessage {
  type: "assistant-message";
  content: AssistantContent;
}

/**
 * Content of an assistant message, mirroring Pi's AssistantMessage structure
 * but flattened for ease of use.
 */
export interface AssistantContent {
  /** Text content blocks (rendered as markdown) */
  textBlocks: string[];
  /** Thinking content blocks */
  thinkingBlocks: string[];
  /** Tool calls made by this assistant message */
  toolCalls: ToolCallInfo[];
  /** Stop reason */
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
  /** Error message if stopReason is error/aborted */
  errorMessage?: string;
  /** Model info for display */
  model?: string;
  provider?: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** The result for this tool call, if available */
  result?: ToolResultInfo;
}

export interface ToolResultInfo {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError: boolean;
  details?: unknown;
}

export interface ConvertedToolResult {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError: boolean;
  details?: unknown;
}

export interface ConvertedAnnotation {
  type: "annotation";
  text: string;
  annotationType: "model-change" | "thinking-change" | "compaction" | "branch-summary" | "label" | "info";
}