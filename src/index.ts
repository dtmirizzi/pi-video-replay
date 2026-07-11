#!/usr/bin/env node
/**
 * pi-video-replay — Convert Pi coding agent sessions to asciinema cast files.
 *
 * Usage:
 *   pi-video-replay <session-file>           Convert a session to .cast
 *   pi-video-replay <session-file> --gif     Convert directly to GIF
 *   pi-video-replay --list                   List recent sessions
 *   pi-video-replay --pick                   Pick from recent sessions
 */
import { Command } from "commander";
import { resolve, basename } from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { detectConverter, listConverters } from "./converters/index.js";
import { renderSession } from "./renderer.js";
import { applyTiming, applySceneTiming } from "./typing.js";
import { writeCastFile } from "./cast-writer.js";
import { DEFAULT_TIMING, type TimingOptions } from "./types.js";

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("pi-video-replay")
  .description("Replay Pi coding agent sessions as asciinema terminal recordings")
  .version("0.1.0")
  .argument("[session]", "Path to a Pi session file (.jsonl)")
  .option("-o, --output <path>", "Output .cast file path", "")
  .option("--video", "Render as MP4 video via Remotion (1080p, 30fps)")
  .option("--width <number>", "Terminal width in columns", "100")
  .option("--height <number>", "Terminal height in rows", "30")
  .option("--speed <number>", "Playback speed multiplier", "1.0")
  .option("--typing <mode>", "Typing mode: user-only, all, none, scene", "user-only")
  .option("--show-thinking", "Show thinking blocks (hidden by default)")
  .option("--no-tools", "Hide tool calls and results")
  .option("--annotations", "Show model changes, compactions, etc.")
  .option("--converter <name>", "Force a specific converter (pi, claude)", "auto")
  .option("--list", "List available converters")
  .option("--sessions", "List recent Pi sessions")
  .action(async (session, options) => {
    // Handle --list
    if (options.list) {
      console.log("Available converters:");
      for (const name of listConverters()) {
        console.log(`  - ${name}`);
      }
      return;
    }

    // Handle --sessions
    if (options.sessions) {
      listSessions();
      return;
    }

    // Require a session file
    if (!session) {
      console.error("Error: No session file specified.");
      console.error("Usage: pi-video-replay <session.jsonl>");
      console.error("       pi-video-replay --sessions  (list available sessions)");
      process.exit(1);
    }

    const sessionPath = resolve(session);

    if (!existsSync(sessionPath)) {
      console.error(`Error: Session file not found: ${sessionPath}`);
      process.exit(1);
    }

    // Determine output path
    const outputPath = options.output
      ? resolve(options.output)
      : sessionPath.replace(/\.jsonl$/, ".cast");

    // Parse options
    const width = parseInt(options.width, 10);
    const height = parseInt(options.height, 10);
    const speed = parseFloat(options.speed);

    if (!["user-only", "all", "none", "scene"].includes(options.typing) && !options.video) {
      console.error("Error: --typing must be one of: user-only, all, none, scene");
      process.exit(1);
    }

    const timing: TimingOptions = {
      ...DEFAULT_TIMING,
      speed,
      typing: options.typing as TimingOptions["typing"],
    };

    // Run conversion
    console.log(`\n🎬 pi-video-replay`);
    console.log(`  Session: ${sessionPath}`);
    console.log(`  Output:  ${outputPath}`);
    console.log(`  Speed:   ${speed}x`);
    console.log(`  Typing:  ${options.typing}`);
    console.log();

    try {
      // Detect or force converter
      const converter = options.converter === "auto"
        ? await detectConverter(sessionPath)
        : (await import("./converters/index.js")).getConverter(options.converter);

      if (!converter) {
        console.error(`Error: Unknown converter "${options.converter}"`);
        process.exit(1);
      }

      console.log(`  Format:  ${converter.name}`);

      // Convert session to normalized entries
      const converted = await converter.convert(sessionPath);
      console.log(`  Entries: ${converted.entries.length}`);
      console.log(`  CWD:     ${converted.cwd}`);

      // Render to ANSI chunks
      const chunks = renderSession(converted, {
        width,
        showThinking: options.showThinking,
        showTools: options.tools,
      });
      console.log(`  Chunks:  ${chunks.length}`);

      // Apply timing (scene mode for video, interactive for terminal)
      const useSceneTiming = options.typing === "scene" || options.video;
      const events = useSceneTiming
        ? applySceneTiming(chunks, timing)
        : applyTiming(chunks, timing);
      console.log(`  Events:  ${events.length}`);

      // Write .cast file
      writeCastFile(outputPath, {
        width,
        height,
        title: converted.title,
        cwd: converted.cwd,
      }, events);
      console.log(`\n✅ Cast file written: ${outputPath}`);
      console.log(`   Play with: asciinema play ${outputPath}`);
      console.log(`   (Requires asciinema >= 3.0. Install: brew install asciinema)`);

      // Optionally render video
      if (options.video) {
        const videoPath = outputPath.replace(/\.cast$/, ".mp4");
        await renderVideo(outputPath, videoPath, width, height);
      }
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Video rendering helpers
// ---------------------------------------------------------------------------
// Video rendering (Remotion)
// ---------------------------------------------------------------------------

async function renderVideo(
  castPath: string,
  videoPath: string,
  cols: number,
  rows: number,
): Promise<void> {
  console.log(`\n🎬 Rendering video with Remotion...`);
  const { execSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const distDir = fileURLToPath(new URL(".", import.meta.url));
  const renderDir = resolve(distDir, "..", "video-render");

  if (!existsSync(`${renderDir}/node_modules`)) {
    console.log(`  Installing dependencies (one-time)...`);
    execSync(`cd ${renderDir} && npm install`, { stdio: "inherit", timeout: 120_000 });
  }

  const castLines = readFileSync(castPath, "utf8").trim().split("\n");
  const castEvents = castLines.slice(1).map(l => JSON.parse(l));
  let totalDuration = 0;
  for (const e of castEvents) {
    if (Array.isArray(e) && typeof e[0] === "number") totalDuration = Math.max(totalDuration, e[0]);
  }
  const fps = 30;
  const durationFrames = Math.max(30, Math.ceil((totalDuration + 2) * fps));

  console.log(`  1080p ${fps}fps, ${durationFrames} frames, ${cols}x${rows} terminal`);

  writeFileSync(`${renderDir}/src/duration.json`, JSON.stringify({ frames: durationFrames, fps, cols, rows }), "utf8");
  writeFileSync(`${renderDir}/src/cast-data.json`, JSON.stringify({ events: castEvents }), "utf8");

  const start = Date.now();
  execSync(`cd ${renderDir} && npx remotion render src/index.ts MyComposition ${videoPath} --concurrency=4`, { stdio: "inherit", timeout: 600_000 });
  console.log(`✅ Video: ${videoPath} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
}

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

function listSessions(): void {
  const sessionsDir = `${homedir()}/.pi/agent/sessions`;

  if (!existsSync(sessionsDir)) {
    console.log("No Pi sessions found.");
    return;
  }

  const projects = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  if (projects.length === 0) {
    console.log("No Pi sessions found.");
    return;
  }

  console.log("\nRecent Pi sessions:\n");

  let count = 0;
  for (const project of projects) {
    const projectDir = `${sessionsDir}/${project.name}`;
    const files = readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse()
      .slice(0, 5);

    const projectName = project.name.replace(/^--/, "/").replace(/--/g, "/");

    for (const file of files) {
      if (count >= 20) break;
      const path = `${projectDir}/${file}`;
      console.log(`  ${path}`);
      count++;
    }
  }

  console.log(`\n  Use: pi-video-replay <path> to replay a session\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

program.parse();