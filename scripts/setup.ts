#!/usr/bin/env bun
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const scriptDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const home = os.homedir();

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureDir(dir: string, mode?: number) {
  mkdirSync(dir, { recursive: true });
  if (mode !== undefined) chmodSync(dir, mode);
}

function link(target: string, dest: string, dir = false) {
  try {
    symlinkSync(target, dest, dir ? "dir" : "file");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      try {
        Bun.spawnSync(["ln", dir ? "-sfn" : "-sf", target, dest]);
      } catch {
        throw err;
      }
    } else throw err;
  }
}

run("brew", ["bundle"]);

ensureDir(path.join(home, ".config/zsh"));
ensureDir(path.join(home, ".config/zellij"));
ensureDir(path.join(home, ".config/ghostty"));
ensureDir(path.join(home, ".config/lazygit"));

link(path.join(scriptDir, ".config/zsh/.zshenv"), path.join(home, ".zshenv"));
link(
  path.join(scriptDir, ".config/zsh/.zshrc"),
  path.join(home, ".config/zsh/.zshrc"),
);
link(
  path.join(scriptDir, ".config/zellij/config.kdl"),
  path.join(home, ".config/zellij/config.kdl"),
);
link(
  path.join(scriptDir, ".config/zellij/layouts"),
  path.join(home, ".config/zellij/layouts"),
  true,
);
link(
  path.join(scriptDir, ".config/ghostty/config"),
  path.join(home, ".config/ghostty/config"),
);
link(
  path.join(scriptDir, "data/bg.jpg"),
  path.join(home, ".config/ghostty/bg.jpg"),
);
link(
  path.join(scriptDir, ".config/lazygit/config.yml"),
  path.join(home, ".config/lazygit/config.yml"),
);

spawnSync(
  "defaults",
  [
    "write",
    "com.mitchellh.ghostty",
    "ApplePressAndHoldEnabled",
    "-bool",
    "false",
  ],
  { stdio: "inherit" },
);

ensureDir(path.join(home, ".ssh"), 0o700);
chmodSync(path.join(scriptDir, ".ssh"), 0o700);
chmodSync(path.join(scriptDir, ".ssh/config"), 0o600);
const sshConfig = path.join(home, ".ssh/config");
if (!existsSync(sshConfig)) writeFileSync(sshConfig, "");
chmodSync(sshConfig, 0o600);
const include = `Include ${scriptDir}/.ssh/config`;
const current = readFileSync(sshConfig, "utf8");
if (!current.includes(include))
  writeFileSync(sshConfig, `${include}\n${current}`);

run("bun", ["run", "setup-sudo-touch-id"]);
run("bun", ["run", "harden-sshd", "--install"]);
