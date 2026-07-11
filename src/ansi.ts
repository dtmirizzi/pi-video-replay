/**
 * ANSI styling helpers using Pi's exact Tokyo Night color palette.
 * Uses 24-bit true color for fidelity.
 */

const CSI = "\x1b[";

// ---- 24-bit color helpers ----
const fg24 = (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`;
const bg24 = (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`;
const reset = `${CSI}0m`;
const bold = `${CSI}1m`;
const dim = `${CSI}2m`;

// Pi's dark theme colors
const C = {
  accent:    [138, 190, 183],
  blue:      [95, 135, 255],
  cyan:      [0, 215, 255],
  green:     [181, 189, 104],
  red:       [204, 102, 102],
  yellow:    [255, 255, 0],
  text:      [212, 212, 212],
  gray:      [128, 128, 128],
  dimGray:   [102, 102, 102],
  darkGray:  [80, 80, 80],
  // Backgrounds
  userMsgBg:      [52, 53, 65],
  toolPendingBg:  [40, 40, 50],
  toolSuccessBg:  [40, 50, 40],
  toolErrorBg:    [60, 40, 40],
};

const c = (...rgb: number[]) => fg24(rgb[0]!, rgb[1]!, rgb[2]!);
const cb = (...rgb: number[]) => bg24(rgb[0]!, rgb[1]!, rgb[2]!);

export const ansi = {
  reset,
  bold:    (s: string) => `${bold}${s}${reset}`,
  dim:     (s: string) => `${dim}${s}${reset}`,

  // Semantic foregrounds
  accent:  (s: string) => `${c(...C.accent)}${s}${reset}`,
  error:   (s: string) => `${c(...C.red)}${s}${reset}`,
  success: (s: string) => `${c(...C.green)}${s}${reset}`,
  warning: (s: string) => `${c(...C.yellow)}${s}${reset}`,
  muted:   (s: string) => `${c(...C.gray)}${s}${reset}`,
  text:    (s: string) => `${c(...C.text)}${s}${reset}`,

  // Tool-specific
  toolTitle: (s: string) => `${c(...C.yellow)}${bold}${s}${reset}`,

  // Backgrounds
  bgToolPending: (s: string) => `${cb(...C.toolPendingBg)}${s}${reset}`,
  bgToolSuccess: (s: string) => `${cb(...C.toolSuccessBg)}${s}${reset}`,
  bgToolError:   (s: string) => `${cb(...C.toolErrorBg)}${s}${reset}`,
  bgUserMsg:     (s: string) => `${cb(...C.userMsgBg)}${s}${reset}`,

  // Spinner frames
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
} as const;

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b][^\x07]*\x07/g, "");
}