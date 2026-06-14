#!/usr/bin/env bun
import { gunzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const chars =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+=-~.:;|/\\<>";
const colors = { dim: 236, lo: 240, mid: 245, hi: 250, max: 255 };
let resized = false;

process.on("SIGWINCH", () => (resized = true));

function termSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

function loadFrames(filePath: string) {
  const raw = gunzipSync(readFileSync(filePath));
  const nl = raw.indexOf(10);
  const header = JSON.parse(raw.subarray(0, nl).toString("utf8"));
  const data = raw.subarray(nl + 1);
  const size = header.cols * header.rows;
  const frames: Buffer[] = [];
  for (let i = 0; i < header.n_frames; i += 1)
    frames.push(data.subarray(i * size, (i + 1) * size));
  return { header, frames };
}

class Splash {
  private cols = 80;
  private rows = 24;
  private gw = 80;
  private gh = 22;
  private grid: string[][] = [];
  private clear = true;
  private frameIdx = 0;
  private tickCount = 0;

  constructor(
    private header: { cols: number; rows: number; fps?: number },
    private frames: Buffer[],
    private statusFile?: string,
  ) {
    this.initGrid();
  }

  private initGrid() {
    const size = termSize();
    this.cols = size.cols;
    this.rows = size.rows;
    this.gh = Math.max(1, this.rows - 2);
    this.gw = this.cols;
    this.grid = Array.from({ length: this.gh }, () =>
      Array.from(
        { length: this.gw },
        () => chars[Math.floor(Math.random() * chars.length)],
      ),
    );
    this.clear = true;
  }

  handleResize() {
    this.initGrid();
  }

  tick() {
    this.tickCount += 1;
    this.frameIdx = this.tickCount % this.frames.length;
  }

  private readStatus() {
    if (!this.statusFile) return "press any key";
    try {
      return (
        readFileSync(this.statusFile, "utf8").split(/\r?\n/, 1)[0].trim() ||
        "press any key"
      );
    } catch {
      return "press any key";
    }
  }

  private buildBrightness() {
    const bright = Array.from({ length: this.gh }, () =>
      new Array<number>(this.gw).fill(0),
    );
    const src = this.frames[this.frameIdx];
    for (let r = 0; r < this.gh; r += 1) {
      const sy = Math.floor((r * this.header.rows) / this.gh);
      const rowOff = sy * this.header.cols;
      for (let c = 0; c < this.gw; c += 1) {
        const sx = Math.floor((c * this.header.cols) / this.gw);
        bright[r][c] = src[rowOff + sx] / 255;
      }
    }
    return bright;
  }

  render() {
    const bright = this.buildBrightness();
    const cap = Math.min(1, this.tickCount / 15);
    const buf: string[] = [this.clear ? "\x1b[2J" : "", "\x1b[H"];
    this.clear = false;

    for (let r = 0; r < this.gh; r += 1) {
      const parts = [`\x1b[${r + 1};1H`];
      let prev = -1;
      for (let c = 0; c < this.gw; c += 1) {
        const b = bright[r][c];
        if (
          (b > 0.5 && Math.random() < 0.35) ||
          (b > 0.2 && Math.random() < 0.06) ||
          Math.random() < 0.008
        ) {
          this.grid[r][c] = chars[Math.floor(Math.random() * chars.length)];
        }
        const bc = Math.min(b, cap);
        const g =
          bc > 0.7
            ? colors.max
            : bc > 0.45
              ? colors.hi
              : bc > 0.25
                ? colors.mid
                : bc > 0.1
                  ? colors.lo
                  : colors.dim;
        if (g !== prev) {
          parts.push(`\x1b[38;5;${g}m`);
          prev = g;
        }
        parts.push(this.grid[r][c]);
      }
      buf.push(parts.join(""));
    }

    const msg = this.readStatus();
    const mx = Math.max(1, Math.floor((this.cols - msg.length) / 2));
    buf.push(
      `\x1b[${this.rows};1H\x1b[2K\x1b[${this.rows};${mx}H\x1b[38;5;238m${msg}\x1b[0m`,
    );
    process.stdout.write(buf.join(""));
  }
}

function parseArgs() {
  const index = process.argv.indexOf("--status-file");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const { cols, rows } = termSize();
  if (cols < 20 || rows < 8) return;

  const repoRoot = path.dirname(
    path.dirname(new URL(import.meta.url).pathname),
  );
  const framesPath = path.join(repoRoot, "data", "frames.gz");
  if (!existsSync(framesPath)) return;
  const { header, frames } = loadFrames(framesPath);
  if (!frames.length) return;

  const splash = new Splash(header, frames, parseArgs());
  const frameTime = 1000 / (header.fps ?? 18);
  const stdin = process.stdin;
  const oldStty = spawnSync("stty", ["-g"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "ignore"],
  }).stdout.trim();
  let cleaned = false;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (oldStty) {
      spawnSync("stty", [oldStty], {
        stdio: ["inherit", "ignore", "ignore"],
      });
    } else if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
    stdin.pause();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }

  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  stdin.setRawMode(true);
  stdin.resume();

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (resized) {
        resized = false;
        splash.handleResize();
      }
      splash.render();
      splash.tick();
    }, frameTime);
    stdin.on("data", (data: Buffer) => {
      if (data.length && data[0] !== 0x1b) {
        clearInterval(timer);
        cleanup();
        resolve();
      }
    });
    process.once("SIGINT", () => {
      clearInterval(timer);
      cleanup();
      resolve();
    });
  });
}

if (import.meta.main) await main();
