# pi-video-replay

Replay Pi coding agent sessions as asciinema terminal recordings (.cast files).

Converts Pi session JSONL files into watchable terminal replays with:
- **Pi's own rendering** — uses Pi's `UserMessageComponent` and `AssistantMessageComponent` for exact visual fidelity
- **Smart typing simulation** — user messages type character-by-character, assistant responses render in paragraphs, tool output streams in chunks
- **Plugable converters** — supports Pi sessions natively, with a converter interface for Claude Code and other formats

## Quick Start

```bash
# Install
npm install -g pi-video-replay

# Replay a session
pi-video-replay ~/.pi/agent/sessions/--your-project--/session.jsonl

# Play the result (requires asciinema >= 3.0)
# Install: brew install asciinema
asciinema play session.cast

# Convert to GIF
asciinema agg session.cast session.gif
# or: pi-video-replay session.jsonl --gif
```

## Usage

```bash
pi-video-replay <session-file> [options]

# Examples
pi-video-replay session.jsonl                          # Output to session.cast
pi-video-replay session.jsonl -o demo.cast             # Custom output path
pi-video-replay session.jsonl --gif                    # Generate .cast + .gif
pi-video-replay session.jsonl --speed 2 --typing none  # Fast, no typing
pi-video-replay session.jsonl --annotations            # Show model changes, etc.
pi-video-replay session.jsonl --show-thinking           # Unfold thinking blocks

# List available sessions
pi-video-replay --sessions

# List converters
pi-video-replay --list
```

### Options

| Option | Default | Description |
|---|---|---|
| `-o, --output <path>` | auto | Output .cast file path |
| `--gif` | false | Also generate GIF via `agg` |
| `--width <cols>` | 100 | Terminal width in columns |
| `--height <rows>` | 30 | Terminal height in rows |
| `--speed <n>` | 1.0 | Playback speed multiplier |
| `--typing <mode>` | user-only | `user-only`, `all`, or `none` |
| `--show-thinking` | false | Show thinking blocks |
| `--annotations` | false | Show model changes, compactions |
| `--converter <name>` | auto | Force a converter (`pi`, `claude`) |
| `--sessions` | — | List recent Pi sessions |
| `--list` | — | List available converters |

## Architecture

```
Session JSONL → Converter → Normalized entries → Renderer → ANSI chunks → Timing → .cast
                    ↑                                                   
        ┌───────────┴──────────┐
        │ Pi format (built-in) │  Claude Code (future)
        └──────────────────────┘
```

### Adding a new converter

Implement the `SessionConverter` interface:

```typescript
import type { SessionConverter, ConvertedSession } from "pi-video-replay/converters";

export class MyConverter implements SessionConverter {
  readonly name = "my-format";

  async canHandle(filePath: string): Promise<boolean> {
    // Detect if this is your format
    return filePath.endsWith(".myformat");
  }

  async convert(filePath: string): Promise<ConvertedSession> {
    // Parse and return normalized entries
    return {
      cwd: "/project",
      entries: [
        { type: "user-message", text: "Hello", timestamp: "..." },
        { type: "assistant-message", content: { textBlocks: ["Hi!"], thinkingBlocks: [], toolCalls: [] } },
      ],
    };
  }
}
```

Then register it in `src/converters/registry.ts`.

## Future: Voice Overs & Video

The `.cast` format preserves precise event timing, which provides the foundation for:

1. **Narration timeline** — extract key moments (user asks, tool runs, assistant responds)
2. **TTS integration** — generate audio for each narration segment
3. **Video rendering** — render `.cast` to video frames + mix audio with ffmpeg

## How It Works

### Rendering Pipeline

1. **Parse** — reads Pi session JSONL, walks the message tree
2. **Convert** — normalizes entries (user/assistant messages, tool calls with inline results)
3. **Render** — `UserMessageComponent` and `AssistantMessageComponent` produce ANSI-styled lines with Pi's exact colors and markdown rendering
4. **Post-process** — strips background colors and OSC133 markers for cleaner replay
5. **Time** — applies typing delays (ANSI-aware), paragraph chunking, and stream simulation
6. **Write** — outputs asciinema v3 `.cast` file

### Typing Modes

- **`user-only`** (default): User messages type character-by-character. Assistant text and tool output appear in paragraphs/chunks. Best balance.
- **`all`**: Everything types character-by-character. Use for short demos only.
- **`none`**: Instant rendering. Fastest, good for previewing or maximum speed.

## Requirements

- Node.js 22+
- `@earendil-works/pi-coding-agent` (auto-installed as dependency)
- **asciinema >= 3.0** for playback (`brew install asciinema`, not the pip version)
- Optional: `agg` for GIF conversion (`brew install agg`)

## License

MIT