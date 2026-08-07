#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const configDir = "/etc/ssh/sshd_config.d";
const configFile = `${configDir}/term-device-auth.conf`;
const mainConfig = "/etc/ssh/sshd_config";
const includeLine = `Include ${configDir}/*`;

const snippet = `# Managed by term/scripts/harden-sshd.ts.
# Device authorization lives in the user's authorized_keys file or in a
# separately configured trusted user CA.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
AuthenticationMethods publickey
`;

function run(
  command: string,
  args: string[],
  options: { stdio?: "inherit" | "pipe"; input?: string } = {},
) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    input: options.input,
  });
}

function usage() {
  process.stdout.write(`Usage: bun run harden-sshd [--install|--check|--print]

  --install  install the managed remote SSH authentication policy
  --check    print the effective authentication settings
  --print    print the managed config snippet

Run this on a remote host that should only accept approved SSH public keys.
`);
}

function commandPath(command: string) {
  const result = run("command", ["-v", command]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function sshdBin() {
  return (
    commandPath("sshd") ??
    (existsSync("/usr/sbin/sshd") ? "/usr/sbin/sshd" : null)
  );
}

function hostKeysPresent() {
  try {
    return readdirSync(path.dirname(mainConfig)).some((name) =>
      /^ssh_host_.+_key$/.test(name),
    );
  } catch {
    return false;
  }
}

// macOS only generates host keys the first time Remote Login is enabled, so a
// fresh machine has none and every sshd invocation exits with
// "no hostkeys available". ssh-keygen -A creates the missing ones and is a
// no-op once they exist.
function ensureHostKeys() {
  if (hostKeysPresent()) return;
  process.stdout.write("generating missing sshd host keys\n");
  const result = run("sudo", ["ssh-keygen", "-A"], { stdio: "inherit" });
  if (result.status !== 0) {
    process.stderr.write("error: could not generate sshd host keys\n");
    process.exit(result.status ?? 1);
  }
}

function reloadSshd() {
  if (
    commandPath("launchctl") &&
    run("launchctl", ["print", "system/com.openssh.sshd"]).status === 0
  ) {
    run("sudo", ["launchctl", "kickstart", "-k", "system/com.openssh.sshd"], {
      stdio: "inherit",
    });
  } else if (commandPath("systemctl")) {
    if (run("sudo", ["systemctl", "reload", "sshd"]).status !== 0)
      run("sudo", ["systemctl", "reload", "ssh"]);
  } else {
    process.stdout.write(
      "sshd config validated; reload sshd manually if needed\n",
    );
  }
}

function installPolicy() {
  const sshd = sshdBin();
  if (!sshd) {
    process.stderr.write("error: sshd not found\n");
    process.exit(1);
  }

  ensureHostKeys();

  run("sudo", ["mkdir", "-p", configDir], { stdio: "inherit" });
  const hasInclude =
    existsSync(mainConfig) &&
    new RegExp(
      `^[ \\t]*Include[ \\t]+${configDir.replaceAll(".", "\\.")}/\\*`,
      "m",
    ).test(run("sudo", ["cat", mainConfig]).stdout);
  if (existsSync(mainConfig) && !hasInclude) {
    const backup = `${mainConfig}.term-backup.${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    run("sudo", ["cp", mainConfig, backup], { stdio: "inherit" });
    const current = run("sudo", ["cat", mainConfig]).stdout;
    const tmp = path.join(
      mkdtempSync(path.join(os.tmpdir(), "term-sshd-config.")),
      "sshd_config",
    );
    writeFileSync(tmp, `${includeLine}\n${current}`);
    run("sudo", ["install", "-m", "0644", tmp, mainConfig], {
      stdio: "inherit",
    });
    rmSync(path.dirname(tmp), { recursive: true, force: true });
    process.stdout.write(`updated ${mainConfig}; backup saved at ${backup}\n`);
  }

  const tmp = path.join(
    mkdtempSync(path.join(os.tmpdir(), "term-sshd-snippet.")),
    "snippet",
  );
  writeFileSync(tmp, snippet);
  run("sudo", ["install", "-m", "0644", tmp, configFile], { stdio: "inherit" });
  rmSync(path.dirname(tmp), { recursive: true, force: true });

  const valid = run("sudo", [sshd, "-t"], { stdio: "inherit" });
  if (valid.status !== 0) process.exit(valid.status ?? 1);
  reloadSshd();
  process.stdout.write(`installed ${configFile}\n`);
}

function checkPolicy() {
  const sshd = sshdBin();
  if (!sshd) {
    process.stderr.write("error: sshd not found\n");
    process.exit(1);
  }
  if (!hostKeysPresent()) {
    process.stderr.write(
      "error: no sshd host keys; run bun run harden-sshd --install\n",
    );
    process.exit(1);
  }
  const result = run(sshd, ["-T"]);
  for (const line of result.stdout.split(/\r?\n/)) {
    const key = line.split(/\s+/, 1)[0];
    if (
      [
        "pubkeyauthentication",
        "passwordauthentication",
        "kbdinteractiveauthentication",
        "challengeresponseauthentication",
        "permitrootlogin",
        "authenticationmethods",
      ].includes(key)
    )
      process.stdout.write(`${line}\n`);
  }
}

switch (process.argv[2] ?? "--check") {
  case "--install":
    installPolicy();
    break;
  case "--check":
    checkPolicy();
    break;
  case "--print":
    process.stdout.write(snippet);
    break;
  case "-h":
  case "--help":
    usage();
    break;
  default:
    usage();
    process.exit(1);
}
