/**
 * Rendering engine v3: Pi-exact output with visual framing.
 */
import {
  UserMessageComponent, AssistantMessageComponent,
  getMarkdownTheme, initTheme, highlightCode, getLanguageFromPath,
} from "@earendil-works/pi-coding-agent";
import { ansi, stripAnsi } from "./ansi.js";
import type {
  ConvertedSession, ConvertedUserMessage, ConvertedAssistantMessage,
  ToolCallInfo,
} from "./converters/types.js";
import type { RenderedChunk } from "./types.js";

let themeInit = false;
function ensureTheme() { if (!themeInit) { try { initTheme(); } catch {} themeInit = true; } }
const W = 100;

export interface RenderOptions {
  width?: number;
  showThinking?: boolean;
  showTools?: boolean;
}

// ---- Main ----
export function renderSession(s: ConvertedSession, opts: RenderOptions = {}): RenderedChunk[] {
  ensureTheme();
  const w = opts.width ?? W;
  const out: RenderedChunk[] = [];
  out.push({ lines: title(s, w), type: "annotation" });
  for (const e of s.entries) {
    if (e.type === "user-message")        out.push({ lines: user(e, w), type: "user-message" });
    else if (e.type === "assistant-message") out.push(...asst(e, w, opts));
    else if (e.type === "annotation")       out.push({ lines: [ansi.muted(`  ${e.text}`)], type: "annotation" });
  }
  return out;
}

// ---- Title ----
function title(s: ConvertedSession, w: number): string[] {
  const hr = "─".repeat(w - 2);
  const title = (s.title || "Pi Session").slice(0, w - 4).padEnd(w - 4);
  const cwd = s.cwd.slice(0, w - 4).padEnd(w - 4);
  return ["", ansi.accent(`╭${hr}╮`),
    ansi.accent(`│ ${title} │`),
    ansi.muted(`│ ${cwd} │`),
    ansi.accent(`╰${hr}╯`), ""];
}

// ---- User message ----
function user(e: ConvertedUserMessage, w: number): string[] {
  const comp = new UserMessageComponent(e.text, getMarkdownTheme(), 1);
  const raw = comp.render(w);
  // Add ▸ on first visible line. Pi's component adds 1-space padding before text;
  // we replace that leading space with our ▸ prefix to avoid double-spacing.
  let added = false;
  return raw.map(l => {
    const vis = stripAnsi(l).trim();
    if (!added && vis && !vis.startsWith("▸")) { added = true;
      // Find the content start (after ANSI codes + the 1-space Pi padding)
      const afterAnsi = l.replace(/^((\x1b\[[0-9;]*[a-zA-Z]|\x1b][^\x07]*\x07)+)/, "");
      const trimmed = afterAnsi.replace(/^ /, ""); // remove Pi's 1-space padding
      const prefix = l.slice(0, l.length - afterAnsi.length);
      return prefix + ansi.accent(ansi.bold("▸ ")) + trimmed;
    }
    return l;
  });
}

// ---- Assistant message ----
function asst(e: ConvertedAssistantMessage, w: number, opts: RenderOptions): RenderedChunk[] {
  const out: RenderedChunk[] = [];
  const c = e.content;

  // Build content for Pi's component
  const blocks: { type: string; text?: string; thinking?: string }[] = [];
  
  // When thinking is hidden, extract a brief summary from thinking blocks
  // so the response doesn't lose context
  if (!opts.showThinking && c.thinkingBlocks.length > 0) {
    const summary = summarizeThinking(c.thinkingBlocks);
    if (summary) {
      out.push({ lines: [`  ${ansi.muted(ansi.spinnerFrames[0] + " " + summary)}`], type: "annotation" });
    }
  }
  
  // Add thinking blocks to the component (it handles show/hide)
  for (const t of c.thinkingBlocks) blocks.push({ type: "thinking", thinking: t });
  for (const t of c.textBlocks) blocks.push({ type: "text", text: t });

  const msg = {
    role: "assistant" as const, content: blocks,
    model: c.model||"?", provider: c.provider||"?",
    stopReason: (c.stopReason||"stop") as any, errorMessage: c.errorMessage,
    timestamp: Date.now(), api: "?",
    usage: { input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,
      cost:{ input:0,output:0,cacheRead:0,cacheWrite:0,total:0 } },
  };

  const comp = new AssistantMessageComponent(msg as any, !opts.showThinking, getMarkdownTheme(), "Thinking...", 1);
  let lines = comp.render(w);

  // Strip the "Thinking..." label if we added our own summary
  if (!opts.showThinking && c.thinkingBlocks.length > 0) {
    lines = lines.filter(l => stripAnsi(l).trim() !== "Thinking...");
  }

  // Add left border `│` to frame the assistant response
  if (lines.some(l => stripAnsi(l).trim())) {
    const framed = lines.map(l => {
      if (stripAnsi(l).trim()) return ` ${ansi.muted("│")} ${l}`;
      return l;
    });
    out.push({ lines: framed, type: "assistant-text" });
  }

  // Tool calls with background bars
  if (opts.showTools !== false && c.toolCalls.length > 0) {
    for (const tc of c.toolCalls) out.push(...tool(tc, w));
  }

  return out;
}

/** Extract a brief 1-line summary from thinking blocks */
function summarizeThinking(blocks: string[]): string {
  // Take the first non-empty, non-markdown-header line
  for (const b of blocks) {
    const lines = b.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
    for (const l of lines) {
      const clean = l.replace(/[*_`#]/g, "").trim();
      if (clean.length > 10) {
        return clean.length > 100 ? clean.slice(0, 97) + "…" : clean;
      }
    }
  }
  return blocks.join(" ").slice(0, 100);
}

// ---- Tool call ----
function tool(tc: ToolCallInfo, w: number): RenderedChunk[] {
  const lines: string[] = [];
  const icon: Record<string,string> = { bash:"$", read:"📖", write:"✏️", edit:"🔧", grep:"🔍", find:"🔎", ls:"📂", web_search:"🌐", web_fetch:"📥" };
  const ico = icon[tc.name] || "•";
  const hasErr = tc.result?.isError;
  const bg = tc.result ? (hasErr ? ansi.bgToolError : ansi.bgToolSuccess) : ansi.bgToolPending;

  const args = fmtArgs(tc);
  const hdr = `${ico} ${tc.name}${args ? "  " + args : ""}`;
  const pad = Math.max(0, w - 4 - stripAnsi(hdr).length);
  lines.push("");
  lines.push(`  ${bg(ansi.bold(hdr) + " ".repeat(pad))}`);

  if (tc.result) {
    const text = tc.result.content.filter(c => c.type==="text").map(c => c.text||"").join("\n");
    if (text.trim()) {
      lines.push(...fmtResult(tc.name, text, w));
    } else {
      lines.push(`  ${ansi.success("✓ Done")}`);
    }
  }
  return [{ lines, type: "tool-header" }];
}

function fmtArgs(tc: ToolCallInfo): string {
  const p: string[] = [];
  for (const [k,v] of Object.entries(tc.arguments)) {
    if (k === "command") p.push(String(v));
    else if (k === "path" || k === "file_path") p.push(ansi.accent(String(v)));
    else if (k === "query" && typeof v==="string") p.push(v.length>60 ? v.slice(0,60)+"…":v);
    else if (typeof v==="string" && v.length<50) p.push(`${k}=${v}`);
  }
  return p.join("  ");
}

function fmtResult(toolName: string, text: string, w: number): string[] {
  const raw = text.split("\n");
  const max = toolName==="bash" ? 50 : 25;
  if ((toolName==="read"||toolName==="write"||toolName==="edit")) {
    const pm = text.match(/^(.+?):\s*$/m);
    if (pm) { const lang = getLanguageFromPath(pm[1]!);
      if (lang) { const hl = highlightCode(text, lang);
        const shown = hl.slice(0,max).map((l:string)=>`  ${l}`);
        if (raw.length>max) shown.push(ansi.dim(`  ... (${raw.length-max} more lines, to expand)`));
        return shown; }
    }
  }
  const display = raw.length>max ? raw.slice(-max) : raw;
  const out = display.map(l=>`  ${ansi.muted(l)}`);
  if (raw.length>max) {
    const skipped = raw.length-max;
    out.unshift(ansi.dim(`  [Showing last ${max} of ${raw.length} lines]`));
  }
  if (!out.length) out.push(`  ${ansi.muted("(no output)")}`);
  return out;
}