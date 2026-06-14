#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

let session = "main";
let layout = "single";
let cwd = "~";
let cwdSet = false;
let acceptKey = false;
const pairPort = 12322;
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.dirname(scriptDir);
const opRelaySock = path.join(os.homedir(), ".op-relay.sock");
const opRelayPort = "12321";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function expandHome(value: string) {
  return value === "~"
    ? os.homedir()
    : value.startsWith("~/")
      ? path.join(os.homedir(), value.slice(2))
      : value;
}

function sessionNameForCwd(value: string) {
  const resolved = path.resolve(expandHome(value));
  return path.basename(resolved) || "root";
}

function remoteCdCommand(value: string) {
  if (value === "~") return 'cd "$HOME"';
  if (value.startsWith("~/")) return `cd "$HOME"/${shellQuote(value.slice(2))}`;
  return `cd ${shellQuote(value)}`;
}

function usage() {
  process.stderr.write(
    `Usage: ${path.basename(process.argv[1])} [--accept-key] [-c cwd] [user@host]\n`,
  );
}

const args = process.argv.slice(2);
let i = 0;
while (i < args.length) {
  const arg = args[i];
  if (arg === "--accept-key") {
    acceptKey = true;
    i += 1;
  } else if (arg === "--") {
    i += 1;
    break;
  } else if (arg === "-c") {
    if (i + 1 >= args.length) {
      usage();
      process.exit(1);
    }
    cwd = args[i + 1];
    cwdSet = true;
    i += 2;
  } else if (arg.startsWith("-")) {
    usage();
    process.exit(1);
  } else {
    break;
  }
}
const host = args[i];

if (cwdSet) {
  layout = "coding";
  session = sessionNameForCwd(cwd);
}

function validPublicKeyLine(line: string) {
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) /.test(
    line,
  );
}

function commandOutput(command: string, args: string[], input?: string) {
  return spawnSync(command, args, { input, encoding: "utf8" });
}

function fingerprintPublicKey(key: string) {
  return commandOutput("ssh-keygen", ["-lf", "-"], `${key}\n`).stdout.trim();
}

function sshAuthFailure(file: string) {
  try {
    return /Permission denied|publickey|authentication failed|no more authentication methods/i.test(
      readFileSync(file, "utf8"),
    );
  } catch {
    return false;
  }
}

function listenOnce(port: number) {
  return new Promise<string>((resolve, reject) => {
    const server = net.createServer((socket) => {
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => (data += chunk));
      socket.on("end", () => {
        server.close();
        resolve(data);
      });
    });
    server.once("error", reject);
    server.listen(port);
  });
}

async function ask(question: string) {
  process.stdout.write(question);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
    if (Buffer.concat(chunks).includes(10)) break;
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function acceptKeyPairing() {
  const localIp =
    commandOutput("ipconfig", ["getifaddr", "en0"]).stdout.trim() ||
    os.hostname();
  process.stdout.write(`waiting for an SSH key offer on port ${pairPort}...\n`);
  process.stdout.write(
    `on the other Mac, run: bun run session danielvaijk@${localIp}\n`,
  );
  const payload = await listenOnce(pairPort);
  const lines = payload.split(/\r?\n/);
  if (lines[0] !== "TERM_SESSION_KEY_PAIR_V1") {
    process.stderr.write("error: received an unknown key-pairing request\n");
    process.exit(1);
  }
  const client =
    lines.find((line) => line.startsWith("client="))?.slice("client=".length) ||
    "unknown client";
  const target = lines
    .find((line) => line.startsWith("target="))
    ?.slice("target=".length);
  const start = lines.indexOf("--keys--");
  const end = lines.indexOf("--end--");
  const keys =
    start >= 0 && end > start
      ? lines.slice(start + 1, end).filter(Boolean)
      : [];
  const approved: string[] = [];

  if (!keys.length) {
    process.stderr.write(
      "error: the other Mac did not offer any SSH agent keys\n",
    );
    process.exit(1);
  }

  process.stdout.write(`\nkey offer from: ${client}\n`);
  if (target) process.stdout.write(`requested target: ${target}\n`);
  process.stdout.write("\n");

  for (const key of keys) {
    if (!validPublicKeyLine(key)) {
      process.stdout.write("skipping invalid public key line\n");
      continue;
    }
    const fp = fingerprintPublicKey(key);
    if (!fp) {
      process.stdout.write(
        "skipping key because ssh-keygen could not fingerprint it\n",
      );
      continue;
    }
    process.stdout.write(`${fp}\n`);
    const answer = await ask("add this key to ~/.ssh/authorized_keys? [y/N] ");
    if (["y", "Y", "yes", "YES"].includes(answer)) approved.push(key);
    process.stdout.write("\n");
  }

  if (!approved.length) {
    process.stdout.write("no keys added\n");
    process.exit(1);
  }

  const sshDir = path.join(os.homedir(), ".ssh");
  const authorizedKeys = path.join(sshDir, "authorized_keys");
  mkdirSync(sshDir, { recursive: true });
  chmodSync(sshDir, 0o700);
  if (!existsSync(authorizedKeys)) writeFileSync(authorizedKeys, "");
  chmodSync(authorizedKeys, 0o600);
  const current = readFileSync(authorizedKeys, "utf8").split(/\r?\n/);
  for (const key of approved) {
    if (current.includes(key))
      process.stdout.write(`already present: ${fingerprintPublicKey(key)}\n`);
    else {
      writeFileSync(
        authorizedKeys,
        `${readFileSync(authorizedKeys, "utf8")}${key}\n`,
      );
      process.stdout.write(`added: ${fingerprintPublicKey(key)}\n`);
    }
  }
}

function resolvedPairingHost(sshHost: string) {
  const result = commandOutput("ssh", ["-G", sshHost]);
  const match = result.stdout
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith("hostname "));
  return match?.split(/\s+/, 2)[1] ?? "";
}

function offerAgentKeysForPairing(sshHost: string) {
  const keys = commandOutput("ssh-add", ["-L"])
    .stdout.split(/\r?\n/)
    .filter((line) => /^(ssh-|ecdsa-|sk-)/.test(line));
  if (!keys.length) {
    process.stderr.write(
      "hint: no SSH agent keys are available; make sure Secretive is running and added to ssh-agent\n",
    );
    return false;
  }
  let pairHost =
    resolvedPairingHost(sshHost) || sshHost.split("@").pop() || sshHost;
  pairHost = pairHost.split(":")[0];
  const computerName =
    commandOutput("scutil", ["--get", "ComputerName"]).stdout.trim() ||
    os.hostname();
  const clientName = `${os.userInfo().username}@${computerName}`;
  process.stderr.write(
    `SSH key is not authorized yet; offering this Mac's agent keys to ${pairHost}:${pairPort}\n`,
  );
  process.stderr.write(
    "hint: on the target Mac, run bun run session --accept-key and approve the fingerprint\n",
  );
  const payload = [
    "TERM_SESSION_KEY_PAIR_V1",
    `client=${clientName}`,
    `target=${sshHost}`,
    "--keys--",
    ...keys,
    "--end--",
    "",
  ].join("\n");
  try {
    const socket = net.createConnection({ host: pairHost, port: pairPort });
    socket.setTimeout(3000);
    socket.on("connect", () => socket.end(payload));
    socket.on("error", () => {});
    return true;
  } catch {
    return false;
  }
}

function connectControlMaster(
  ctlSock: string,
  sshHost: string,
  errFile: string,
) {
  const err = Bun.file(errFile).writer();
  const result = spawnSync(
    "ssh",
    [
      "-fNM",
      "-A",
      "-S",
      ctlSock,
      "-o",
      "ControlPersist=300",
      "-o",
      "BatchMode=yes",
      "-o",
      "PreferredAuthentications=publickey",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "KbdInteractiveAuthentication=no",
      "-o",
      "NumberOfPasswordPrompts=0",
      sshHost,
    ],
    { encoding: "utf8" },
  );
  err.write(result.stderr ?? "");
  err.end();
  return result.status === 0;
}

async function waitForPairedAuth(
  ctlSock: string,
  sshHost: string,
  errFile: string,
) {
  process.stderr.write("waiting for key approval on the target Mac...\n");
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    writeFileSync(errFile, "");
    if (connectControlMaster(ctlSock, sshHost, errFile)) {
      process.stderr.write("key approved; SSH connection established\n");
      return true;
    }
    if (!sshAuthFailure(errFile)) return false;
    await Bun.sleep(1000);
  }
  process.stderr.write("error: timed out waiting for key approval\n");
  return false;
}

function printConnectError(sshHost: string) {
  process.stderr.write(`error: failed to connect to ${sshHost}\n`);
}

function tempPath(prefix: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, file: path.join(dir, "file") };
}

function spawnDetached(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2] = {},
) {
  return spawn(command, args, { ...options, stdio: options.stdio ?? "ignore" });
}

function opRealPath() {
  for (const candidate of ["/opt/homebrew/bin/op", "/usr/local/bin/op"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

if (acceptKey) {
  await acceptKeyPairing();
  process.exit(0);
}

if (host) {
  const origin = commandOutput("git", [
    "-C",
    repoRoot,
    "remote",
    "get-url",
    "origin",
  ]).stdout.trim();
  const remoteSession = shellQuote(session);
  const remoteCd = remoteCdCommand(cwd);
  const statusFile = tempPath("zellij-splash.");
  const ctlSock = path.join(
    mkdtempSync(path.join(os.tmpdir(), "zellij-ctl.")),
    "sock",
  );
  const sshErrFile = tempPath("zellij-ssh.");
  const opRelayErrFile = tempPath("op-relay.");
  let opRelayProc: ReturnType<typeof spawn> | null = null;
  let prewarmProc: ReturnType<typeof spawn> | null = null;

  const cleanupPrewarm = () => {
    rmSync(statusFile.dir, { recursive: true, force: true });
    rmSync(sshErrFile.dir, { recursive: true, force: true });
    rmSync(opRelayErrFile.dir, { recursive: true, force: true });
  };
  const cleanupAll = () => {
    cleanupPrewarm();
    if (prewarmProc) prewarmProc.kill();
    if (existsSync(ctlSock))
      spawnSync("ssh", ["-S", ctlSock, "-O", "exit", host], {
        stdio: "ignore",
      });
    if (opRelayProc) opRelayProc.kill();
  };
  process.on("exit", cleanupAll);
  process.on("SIGINT", () => {
    cleanupAll();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupAll();
    process.exit(143);
  });

  if (!connectControlMaster(ctlSock, host, sshErrFile.file)) {
    if (sshAuthFailure(sshErrFile.file) && offerAgentKeysForPairing(host)) {
      if (!(await waitForPairedAuth(ctlSock, host, sshErrFile.file))) {
        printConnectError(host);
        process.exit(1);
      }
    } else {
      printConnectError(host);
      process.exit(1);
    }
  }

  const opReal = opRealPath();
  if (!opReal) {
    process.stderr.write(
      "error: 1Password CLI (op) not found - install it first (brew install --cask 1password-cli)\n",
    );
    process.exit(1);
  }

  opRelayProc = spawn("bun", ["run", "op-relay"], {
    cwd: repoRoot,
    env: { ...process.env, OP_RELAY_BIN: opReal },
    stderr: Bun.file(opRelayErrFile.file),
    stdout: "ignore",
    stdin: "ignore",
  });
  for (let n = 0; n < 5; n += 1) {
    await Bun.sleep(100);
    if (opRelayProc.exitCode !== null) {
      const err = readFileSync(opRelayErrFile.file, "utf8");
      process.stderr.write(
        err.includes("Address already in use")
          ? `error: op relay failed to start because 127.0.0.1:${opRelayPort} is already in use\n`
          : "error: op relay failed to start\n",
      );
      process.exit(1);
    }
    if (existsSync(opRelaySock)) break;
  }

  if (existsSync(opRelaySock)) {
    spawnSync(
      "ssh",
      [
        "-S",
        ctlSock,
        "-O",
        "forward",
        "-R",
        `${opRelayPort}:127.0.0.1:${opRelayPort}`,
        host,
      ],
      { stdio: "ignore" },
    );
  }

  writeFileSync(statusFile.file, `connecting to ${host}...\n`);

  const remotePrewarm = `
    export PATH="$HOME/.local/bin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:$HOME/.cargo/bin:$PATH"
    if [ -L ~/.config/zellij/config.kdl ] && [ -n ${shellQuote(origin)} ]; then
      repo=$(git -C "$(dirname "$(readlink ~/.config/zellij/config.kdl)")" rev-parse --show-toplevel 2>/dev/null)
      if [ -n "$repo" ] && [ "$(git -C "$repo" remote get-url origin 2>/dev/null)" = ${shellQuote(origin)} ]; then
        git -C "$repo" pull --ff-only >/dev/null 2>&1 || true
        mkdir -p ~/.local/bin
        printf '%s\n' "$repo" > ~/.local/bin/.term-op-repo
        cat > ~/.local/bin/op <<'TERM_OP_WRAPPER'
#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repo = readFileSync(new URL("./.term-op-repo", import.meta.url), "utf8").trim();
const result = spawnSync("bun", ["--cwd", repo, "run", "op-relay-client", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
TERM_OP_WRAPPER
        chmod +x ~/.local/bin/op
      fi
    fi
  `;
  prewarmProc = spawn(
    "bash",
    [
      "-lc",
      `printf %s ${shellQuote("syncing config...\n")} > ${shellQuote(statusFile.file)}; ssh -A -S ${shellQuote(ctlSock)} ${shellQuote(host)} ${shellQuote(remotePrewarm)} 2>/dev/null; printf %s ${shellQuote("ready - press any key\n")} > ${shellQuote(statusFile.file)}`,
    ],
    { stdio: "ignore" },
  );

  spawnSync("bun", ["run", "splash", "--status-file", statusFile.file], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (prewarmProc.exitCode === null)
    await new Promise((resolve) => prewarmProc?.once("exit", resolve));
  prewarmProc = null;

  if (
    spawnSync("ssh", ["-S", ctlSock, "-O", "check", host], { stdio: "ignore" })
      .status !== 0
  ) {
    printConnectError(host);
    process.exit(1);
  }

  cleanupPrewarm();
  const remoteAttach = `
    export PATH="$HOME/.local/bin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:$HOME/.cargo/bin:$PATH"
    mkdir -p ~/.ssh && ln -sf "$SSH_AUTH_SOCK" ~/.ssh/forwarded-agent.sock
    ${remoteCd}
    if zellij list-sessions --short 2>/dev/null | grep -qx -- ${remoteSession}; then
      exec zellij attach ${remoteSession}
    else
      exec zellij -n "$HOME/.config/zellij/layouts/${layout}.kdl" -s ${remoteSession}
    fi
  `;
  const result = spawnSync(
    "ssh",
    ["-A", "-S", ctlSock, "-t", host, remoteAttach],
    {
      stdio: "inherit",
      env: { ...process.env, TERM: "xterm-256color" },
    },
  );
  process.removeAllListeners("exit");
  cleanupAll();
  process.exit(result.status ?? 1);
} else {
  process.chdir(expandHome(cwd));
  const list = spawnSync("zellij", ["list-sessions", "--short"], {
    encoding: "utf8",
  });
  if (list.stdout.split(/\r?\n/).includes(session)) {
    const result = spawnSync("zellij", ["attach", session], {
      stdio: "inherit",
    });
    process.exit(result.status ?? 1);
  }
  spawnSync("bun", ["run", "splash"], { cwd: repoRoot, stdio: "inherit" });
  const result = spawnSync(
    "zellij",
    [
      "-n",
      path.join(os.homedir(), `.config/zellij/layouts/${layout}.kdl`),
      "-s",
      session,
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
