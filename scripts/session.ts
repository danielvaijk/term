#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { Command } from "commander";
import { input, select } from "@inquirer/prompts";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const pairPort = 12322;
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.dirname(scriptDir);
const opRelayPort = "12321";
const sessionUsersFile = path.join(
  os.homedir(),
  ".config/term/session-users.json",
);
const vimMovementTheme = { keybindings: ["vim"] as const };

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

function sessionConfig(cwd: string, cwdSet: boolean) {
  return cwdSet
    ? { layout: "coding", session: sessionNameForCwd(cwd) }
    : { layout: "single", session: "main" };
}

function remoteCdCommand(value: string) {
  if (value === "~") return 'cd "$HOME"';
  if (value.startsWith("~/")) return `cd "$HOME"/${shellQuote(value.slice(2))}`;
  return `cd ${shellQuote(value)}`;
}

function validPublicKeyLine(line: string) {
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) /.test(
    line,
  );
}

function commandOutput(
  command: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
) {
  return spawnSync(command, args, {
    input,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
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

type CliOptions = {
  acceptKey?: boolean;
  cwd?: string;
};

const program = new Command()
  .name(path.basename(process.argv[1]))
  .description("Start a local or remote zellij session")
  .argument("[host]", "remote SSH host, optionally user@host")
  .option("--accept-key", "listen once for another machine's SSH public key")
  .option("-c, --cwd <cwd>", "working directory all panes start in")
  .allowExcessArguments(false)
  .parse(process.argv);

const cli = program.opts<CliOptions>();
const hostArg = program.args[0] as string | undefined;
const acceptKey = Boolean(cli.acceptKey);
const initialCwd = cli.cwd ?? "~";
const initialCwdSet = program.getOptionValueSource("cwd") !== undefined;

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

function resolvedIdentityAgent(sshHost: string) {
  const result = commandOutput("ssh", ["-G", sshHost]);
  const match = result.stdout
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith("identityagent "));
  const value = match?.split(/\s+/, 2)[1];
  if (!value || value.toLowerCase() === "none") return "";
  if (value === "SSH_AUTH_SOCK") return process.env.SSH_AUTH_SOCK ?? "";
  return expandHome(value);
}

function resolvedKnownHostTarget(sshHost: string) {
  const result = commandOutput("ssh", ["-G", sshHost]);
  const config = new Map(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/, 2))
      .filter((parts): parts is [string, string] => parts.length === 2),
  );
  const hostname =
    config.get("hostname") || sshHost.split("@").pop() || sshHost;
  const port = config.get("port") || "22";
  const host = hostname.split(":")[0];

  return port === "22" ? host : `[${host}]:${port}`;
}

function offerAgentKeysForPairing(sshHost: string) {
  const identityAgent = resolvedIdentityAgent(sshHost);
  const keys = commandOutput(
    "ssh-add",
    ["-L"],
    undefined,
    identityAgent ? { SSH_AUTH_SOCK: identityAgent } : undefined,
  )
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
      "StrictHostKeyChecking=accept-new",
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

function printConnectError(sshHost: string, errFile?: string) {
  process.stderr.write(`error: failed to connect to ${sshHost}\n`);
  if (!errFile) return;

  const stderr = readFileSync(errFile, "utf8");
  if (/host key verification failed|offending .*key in/i.test(stderr)) {
    const target = resolvedKnownHostTarget(sshHost);
    process.stderr.write(
      [
        "SSH rejected the target host key before authentication.",
        "If this is the expected Mac, reset the stale known_hosts entry and retry:",
        `ssh-keygen -R ${shellQuote(target)}`,
      ].join("\n") + "\n",
    );
    return;
  }

  const detail = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4);

  if (detail.length) {
    process.stderr.write(`${detail.join("\n")}\n`);
  }
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

function relayTcpAvailable(timeoutMs = 100) {
  return new Promise<boolean>((resolve) => {
    const sock = net.createConnection({
      host: "127.0.0.1",
      port: Number.parseInt(opRelayPort, 10),
    });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function printOpRelayStartFailure(errFile: string) {
  const err = readFileSync(errFile, "utf8");
  process.stderr.write(
    err.includes("Address already in use")
      ? `error: op relay failed to start because 127.0.0.1:${opRelayPort} is already in use\n`
      : "error: op relay failed to start\n",
  );
}

function startOpRelay(errFile: string) {
  const opReal = opRealPath();
  if (!opReal) {
    process.stderr.write(
      "error: 1Password CLI (op) not found - install it first (brew install --cask 1password-cli)\n",
    );
    process.exit(1);
  }

  return spawn("bun", ["run", "op-relay"], {
    cwd: repoRoot,
    env: { ...process.env, OP_RELAY_BIN: opReal },
    stderr: Bun.file(errFile),
    stdout: "ignore",
    stdin: "ignore",
  });
}

async function waitForOpRelay(proc: ReturnType<typeof spawn>, errFile: string) {
  for (let n = 0; n < 20; n += 1) {
    await Bun.sleep(100);
    if (proc.exitCode !== null) {
      printOpRelayStartFailure(errFile);
      process.exit(1);
    }
    if (await relayTcpAvailable()) return;
  }
  process.stderr.write("error: op relay did not become reachable\n");
  process.exit(1);
}

type NetworkDevice = {
  host: string;
  name: string;
  detail: string;
};

type BonjourInstance = {
  name: string;
  host: string;
  port: number;
};

type TailscalePeer = {
  HostName?: unknown;
  DNSName?: unknown;
  TailscaleIPs?: unknown;
  Online?: unknown;
};

type TailscaleStatus = {
  Peer?: unknown;
};

function dnsSdOutput(args: string[], ready: RegExp) {
  return new Promise<string>((resolve) => {
    const child = spawn("dns-sd", args, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve(output);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (ready.test(output)) settle();
    });
    child.once("error", settle);
    child.once("exit", settle);
  });
}

async function bonjourInstanceNames() {
  const output = await dnsSdOutput(
    ["-B", "_ssh._tcp", "local."],
    /\bAdd\b\s+\S+\s+\d+\s+\S+\s+_ssh\._tcp\.\s+(.+?)\s*$/m,
  );
  const names = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /\bAdd\b\s+\S+\s+\d+\s+\S+\s+_ssh\._tcp\.\s+(.+?)\s*$/,
    );
    if (match) names.add(match[1]);
  }

  return [...names];
}

async function resolveBonjourInstance(
  name: string,
): Promise<BonjourInstance | undefined> {
  const output = await dnsSdOutput(
    ["-L", name, "_ssh._tcp", "local."],
    /can be reached at \S+?:\d+\b/,
  );
  const match = output.match(/can be reached at (\S+?):(\d+)\b/);
  if (!match) return undefined;

  return {
    name,
    host: match[1].replace(/\.$/, ""),
    port: Number.parseInt(match[2], 10),
  };
}

async function withSpinner<T>(message: string, work: Promise<T>) {
  const frames = ["-", "\\", "|", "/"];
  const started = Date.now();
  let frame = 0;
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    process.stderr.write(
      `\r${frames[frame++ % frames.length]} ${message} ${elapsed}s (Ctrl-C to abort)`,
    );
  }, 100);

  try {
    return await work;
  } finally {
    clearInterval(timer);
    process.stderr.write("\r\x1b[K");
  }
}

async function bonjourDevices() {
  const instances = (
    await Promise.all(
      (await bonjourInstanceNames()).map((name) =>
        resolveBonjourInstance(name),
      ),
    )
  ).filter((instance) => instance !== undefined);

  const byHost = new Map<string, BonjourInstance>();
  for (const instance of instances) {
    if (!byHost.has(instance.host)) byHost.set(instance.host, instance);
  }

  return [...byHost.values()]
    .map((instance) => ({
      host: instance.host,
      name: instance.name,
      detail:
        instance.port === 22
          ? `${instance.host}, Bonjour`
          : `${instance.host}:${instance.port}, Bonjour`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function isTailscalePeer(value: unknown): value is TailscalePeer {
  return Boolean(value && typeof value === "object");
}

function tailscalePeerIpv4(peer: TailscalePeer) {
  if (!Array.isArray(peer.TailscaleIPs)) return "";

  return (
    peer.TailscaleIPs.find(
      (ip): ip is string =>
        typeof ip === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(ip),
    ) ?? ""
  );
}

async function tailscaleDevices() {
  const result = commandOutput("tailscale", ["status", "--json"]);
  if (result.status !== 0) return [];

  let status: TailscaleStatus;
  try {
    status = JSON.parse(result.stdout) as TailscaleStatus;
  } catch {
    return [];
  }

  const peers =
    status.Peer && typeof status.Peer === "object"
      ? Object.values(status.Peer).filter(isTailscalePeer)
      : [];

  const candidates = peers
    .filter((peer) => peer.Online === true)
    .map((peer) => {
      const ip = tailscalePeerIpv4(peer);
      if (!ip) return undefined;

      const dnsName =
        typeof peer.DNSName === "string" ? peer.DNSName.replace(/\.$/, "") : "";
      const hostName =
        typeof peer.HostName === "string" && peer.HostName.trim()
          ? peer.HostName.trim()
          : "";

      return {
        ip,
        name: hostName || dnsName || ip,
      };
    })
    .filter((peer) => peer !== undefined);

  return candidates
    .map((peer) => ({
      host: peer.ip,
      name: peer.name,
      detail: `${peer.ip}, Tailscale`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function dedupeDevices(devices: NetworkDevice[]) {
  const byHost = new Map<string, NetworkDevice>();
  for (const device of devices) {
    if (!byHost.has(device.host)) byHost.set(device.host, device);
  }

  return [...byHost.values()];
}

async function networkDevices() {
  const tailscale = await tailscaleDevices();

  if (tailscale.length) return dedupeDevices(tailscale);
  return dedupeDevices(await bonjourDevices());
}

function readSessionUsers() {
  try {
    const users = JSON.parse(readFileSync(sessionUsersFile, "utf8"));
    if (!users || typeof users !== "object" || Array.isArray(users)) return {};

    return Object.fromEntries(
      Object.entries(users).filter(
        ([, username]) => typeof username === "string",
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberSuccessfulUsername(sshHost: string) {
  const at = sshHost.lastIndexOf("@");
  if (at < 1) return;

  const username = sshHost.slice(0, at);
  const host = sshHost.slice(at + 1);
  if (!host) return;

  const users = { ...readSessionUsers(), [host]: username };
  mkdirSync(path.dirname(sessionUsersFile), { recursive: true });
  writeFileSync(sessionUsersFile, `${JSON.stringify(users, null, 2)}\n`);
}

async function chooseHost(existingHost?: string) {
  let selectedHost = existingHost;

  if (!selectedHost) {
    const devices = await withSpinner(
      "checking network hosts",
      networkDevices(),
    );
    const picked = await select<string>({
      message: "Select a target",
      theme: vimMovementTheme,
      choices: [
        { name: "This Mac (local)", value: "__local__" },
        ...devices.map((device) => ({
          name: `${device.name} (${device.detail})`,
          value: device.host,
        })),
        { name: "Enter host manually", value: "__manual__" },
      ],
    });

    if (picked === "__local__") return undefined;

    selectedHost =
      picked === "__manual__"
        ? await input({ message: "Host or IP address" })
        : picked;
  }

  if (selectedHost.includes("@")) return selectedHost;

  const username = await input({
    message: "Username",
    default: readSessionUsers()[selectedHost] ?? os.userInfo().username,
  });

  return `${username}@${selectedHost}`;
}

function sortDirectoryNames(a: string, b: string) {
  const aLowercase = /^[a-z]/.test(a);
  const bLowercase = /^[a-z]/.test(b);

  if (aLowercase !== bLowercase) return aLowercase ? -1 : 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

function localHomeDirs() {
  return readdirSync(os.homedir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort(sortDirectoryNames);
}

async function chooseLocalCwd() {
  const picked = await select<string>({
    message: "Start directory",
    theme: vimMovementTheme,
    choices: [
      { name: "Home (~), single layout", value: "__home__" },
      ...localHomeDirs().map((dir) => ({
        name: `${dir} (coding layout)`,
        value: `~/${dir}`,
      })),
      { name: "Enter directory manually", value: "__manual__" },
    ],
  });

  if (picked === "__home__") return { cwd: "~", cwdSet: false };
  if (picked === "__manual__") {
    const cwd = await input({
      message: "Directory",
      default: "~",
    });
    return { cwd, cwdSet: cwd !== "~" };
  }

  return { cwd: picked, cwdSet: true };
}

function remoteHomeDirs(ctlSock: string, sshHost: string) {
  const result = spawnSync(
    "ssh",
    [
      "-S",
      ctlSock,
      sshHost,
      'find "$HOME" -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; 2>/dev/null | sort',
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => name && !name.startsWith("."))
    .sort(sortDirectoryNames);
}

async function chooseRemoteCwd(ctlSock: string, sshHost: string) {
  const dirs = remoteHomeDirs(ctlSock, sshHost);
  const picked = await select<string>({
    message: "Start directory",
    theme: vimMovementTheme,
    choices: [
      { name: "Home (~), single layout", value: "__home__" },
      ...dirs.map((dir) => ({
        name: `${dir} (coding layout)`,
        value: `~/${dir}`,
      })),
      { name: "Enter directory manually", value: "__manual__" },
    ],
  });

  if (picked === "__home__") return { cwd: "~", cwdSet: false };
  if (picked === "__manual__") {
    const cwd = await input({
      message: "Remote directory",
      default: "~",
    });
    return { cwd, cwdSet: cwd !== "~" };
  }

  return { cwd: picked, cwdSet: true };
}

async function runRemoteSession(
  host: string,
  requestedCwd: string,
  requestedCwdSet: boolean,
  promptCwd: boolean,
) {
  let cwd = requestedCwd;
  let cwdSet = requestedCwdSet;
  const origin = commandOutput("git", [
    "-C",
    repoRoot,
    "remote",
    "get-url",
    "origin",
  ]).stdout.trim();
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
        printConnectError(host, sshErrFile.file);
        process.exit(1);
      }
    } else {
      printConnectError(host, sshErrFile.file);
      process.exit(1);
    }
  }

  rememberSuccessfulUsername(host);

  if (promptCwd && !requestedCwdSet) {
    const picked = await chooseRemoteCwd(ctlSock, host);
    cwd = picked.cwd;
    cwdSet = picked.cwdSet;
  }

  const { layout, session } = sessionConfig(cwd, cwdSet);
  const remoteSession = shellQuote(session);
  const remoteCd = remoteCdCommand(cwd);

  opRelayProc = startOpRelay(opRelayErrFile.file);
  await waitForOpRelay(opRelayProc, opRelayErrFile.file);

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

  writeFileSync(statusFile.file, `connecting to ${host}...\n`);

  const remotePrewarm = `
    export PATH="$HOME/.term/bin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:$HOME/.cargo/bin:$PATH"
    if [ -L ~/.config/zellij/config.kdl ] && [ -n ${shellQuote(origin)} ]; then
      repo=$(git -C "$(dirname "$(readlink ~/.config/zellij/config.kdl)")" rev-parse --show-toplevel 2>/dev/null)
      if [ -n "$repo" ] && [ "$(git -C "$repo" remote get-url origin 2>/dev/null)" = ${shellQuote(origin)} ]; then
        git -C "$repo" pull --ff-only >/dev/null 2>&1 || true
        if [ -f ~/.local/bin/op ] && grep -Eq 'op-relay-client|\\.term-op-repo' ~/.local/bin/op; then
          rm -f ~/.local/bin/op ~/.local/bin/.term-op-repo
        fi
        mkdir -p ~/.term/bin
        printf '%s\n' "$repo" > ~/.term/bin/.term-op-repo
        cat > ~/.term/bin/op <<'TERM_OP_WRAPPER'
#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repo = readFileSync(new URL("./.term-op-repo", import.meta.url), "utf8").trim();
const result = spawnSync("bun", [path.join(repo, "scripts/op-relay-client.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
TERM_OP_WRAPPER
        chmod +x ~/.term/bin/op
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
    export PATH="$HOME/.term/bin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:$HOME/.cargo/bin:$PATH"
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
}

function runLocalSession(cwd: string, cwdSet: boolean) {
  const { layout, session } = sessionConfig(cwd, cwdSet);
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

function isPromptInterrupt(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "ExitPromptError" ||
      error.message.includes("User force closed the prompt"))
  );
}

async function main() {
  if (acceptKey) {
    await acceptKeyPairing();
    process.exit(0);
  }

  const host = await chooseHost(hostArg);

  if (host) {
    await runRemoteSession(host, initialCwd, initialCwdSet, !initialCwdSet);
  } else {
    const { cwd, cwdSet } = initialCwdSet
      ? { cwd: initialCwd, cwdSet: initialCwdSet }
      : await chooseLocalCwd();
    runLocalSession(cwd, cwdSet);
  }
}

await main().catch((error) => {
  if (isPromptInterrupt(error)) {
    process.stdout.write("\n");
    process.exit(130);
  }

  throw error;
});
