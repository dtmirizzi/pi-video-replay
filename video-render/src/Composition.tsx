import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

// ---- Types ----
type CastEvent = [number, string, string]; // [timestamp, code, data]

interface StyledSpan {
  text: string;
  color?: string;
  bold?: boolean;
}

// ---- ANSI Parser (runs in browser) ----
const COLORS: Record<number, string> = {
  30: "#1a1b26", 31: "#f7768e", 32: "#9ece6a", 33: "#e0af68",
  34: "#7aa2f7", 35: "#bb9af7", 36: "#7dcfff", 37: "#c0caf5",
  90: "#565f89", 91: "#f7768e", 92: "#9ece6a", 93: "#e0af68",
  94: "#7aa2f7", 95: "#bb9af7", 96: "#7dcfff", 97: "#c0caf5",
};

interface ParseState {
  fg?: string;
  bold: boolean;
}

function startSpan(state: ParseState): StyledSpan {
  return { text: "", color: state.fg, bold: state.bold };
}

function parseAnsiLine(line: string): StyledSpan[] {
  const spans: StyledSpan[] = [];
  const state: ParseState = { bold: false };
  let current = startSpan(state);
  let i = 0;

  while (i < line.length) {
    if (line[i] === "\x1b") {
      // OSC sequence (\x1b]...\x07 or \x1b]...\x1b) — skip entirely
      if (line[i + 1] === "]") {
        if (current.text) { spans.push({ ...current }); current = startSpan(state); }
        // Find terminator: \x07 (BEL) or next \x1b (start of new escape)
        let end = line.indexOf("\x07", i);
        if (end === -1) end = line.indexOf("\x1b", i + 2);
        if (end === -1) end = line.length;
        i = end === line.length ? end : (line[end] === "\x07" ? end + 1 : end);
        current = startSpan(state);
        continue;
      }

      // SGR sequence (\x1b[...m)
      if (line[i + 1] === "[") {
        if (current.text) { spans.push({ ...current }); current = startSpan(state); }
        const end = line.indexOf("m", i);
        if (end === -1) { current.text += line[i]; i++; continue; }
        const params = line.slice(i + 2, end).split(";");
        i = end + 1;

        if (params[0] === "0" || (params.length === 1 && params[0] === "")) {
          state.fg = undefined; state.bold = false;
        } else if (params[0] === "1") { state.bold = true; }
        else if (params[0] === "2") { /* dim */ }
        else if (params[0] === "38" && params[1] === "2" && params.length >= 5) {
          state.fg = `rgb(${params[2]},${params[3]},${params[4]})`;
        } else if (params[0] === "39") { state.fg = undefined; }
        else if (params[0] === "48") { /* bg - handled by parseBg */ }
        else {
          const code = parseInt(params[0]!);
          if (COLORS[code]) state.fg = COLORS[code];
        }
        current = startSpan(state);
        continue;
      }

      // Unknown escape — skip the ESC char
      i++;
      continue;
    }

    current.text += line[i];
    i++;
  }
  if (current.text) spans.push(current);

  // Clean: merge adjacent spans with same style, remove empty
  const merged: StyledSpan[] = [];
  for (const s of spans) {
    if (!s.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.color === s.color && last.bold === s.bold) {
      last.text += s.text;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

// Background colors
const BG_COLORS: Record<string, string> = {
  "48;2;52;53;65": "rgba(52,53,65,1)",   // userMsgBg
  "48;2;40;40;50": "rgba(40,40,50,1)",    // toolPendingBg
  "48;2;40;50;40": "rgba(40,50,40,1)",    // toolSuccessBg
  "48;2;60;40;40": "rgba(60,40,40,1)",    // toolErrorBg
};

function parseBg(line: string): string | undefined {
  const m = line.match(/\x1b\[(48;2;\d+;\d+;\d+)m/);
  if (m) return BG_COLORS[m[1]!];
}

// ---- Component ----
export const CastVideo: React.FC<{
  castEvents: CastEvent[];
  fps: number;
  cols: number;
  rows: number;
}> = ({ castEvents, fps, cols, rows }) => {
  const frame = useCurrentFrame();
  const { fps: videoFps } = useVideoConfig();
  const time = frame / videoFps;

  // Compute which lines are visible at current timestamp
  const lines = useMemo(() => {
    const output: string[] = [];
    for (const event of castEvents) {
      if (event[0] > time) break;
      if (event[1] === "o") output.push(event[2]);
    }
    return output.join("").split("\r\n");
  }, [castEvents, time]);

  // Only show last ~30 lines to keep video focused
  const visibleLines = lines.slice(-30);

  return (
    <AbsoluteFill style={{
      backgroundColor: "#1a1b26",
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, monospace',
      fontSize: 18,
      lineHeight: 1.45,
      color: "#c0caf5",
      padding: "48px 64px",
      overflow: "hidden",
    }}>
      {visibleLines.map((line, i) => {
        const bg = parseBg(line);

        // Parse styled spans
        const spans = parseAnsiLine(line);

        // Render line
        return (
          <div
            key={i}
            style={{
              whiteSpace: "pre",
              backgroundColor: bg,
              minHeight: spans.length === 0 && !line ? "1.45em" : undefined,
              paddingLeft: bg ? 4 : 0,
              paddingRight: bg ? 4 : 0,
              borderRadius: bg ? 4 : 0,
            }}
          >
            {spans.length === 0 ? (
              line || " "
            ) : (
              spans.map((s, j) => (
                <span
                  key={j}
                  style={{
                    color: s.color,
                    fontWeight: s.bold ? "bold" : undefined,
                  }}
                >
                  {s.text}
                </span>
              ))
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};