#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const sockPath = process.env.OP_RELAY_SOCK ?? `${os.homedir()}/.op-relay.sock`;
const tcpPort = Number.parseInt(process.env.OP_RELAY_PORT ?? "12321", 10);
const secretRefRe = /op:\/\/[^\s'"`$\\]+/g;
const quotedSecretRefRe = /(?<=['"])op:\/\/.*?(?=['"])/g;

export class RelayError extends Error {}

function expandHome(value: string) {
  return value === "~"
    ? os.homedir()
    : value.startsWith("~/")
      ? path.join(os.homedir(), value.slice(2))
      : value;
}

function connectRelay(timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const tryTcp = () => {
      const sock = net.createConnection({ host: "127.0.0.1", port: tcpPort });
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(null);
      }, timeoutMs);
      sock.once("connect", () => {
        clearTimeout(timer);
        sock.setTimeout(65000);
        resolve(sock);
      });
      sock.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    };

    if (!existsSync(sockPath)) {
      tryTcp();
      return;
    }

    const sock = net.createConnection(sockPath);
    const timer = setTimeout(() => {
      sock.destroy();
      tryTcp();
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.setTimeout(65000);
      resolve(sock);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      tryTcp();
    });
  });
}

export async function relayAvailable() {
  const sock = await connectRelay(1000);
  if (!sock) return false;
  sock.end();
  return true;
}

export async function viaRelay(
  args: string[],
): Promise<[number, string, string]> {
  const sock = await connectRelay(1000);
  if (!sock) throw new RelayError("relay is not available");

  const data = await new Promise<string>((resolve, reject) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("\n")) {
        sock.end();
        resolve(buf);
      }
    });
    sock.on("error", reject);
    sock.on("end", () => resolve(buf));
    sock.write(`${JSON.stringify({ args })}\n`);
  });

  if (!data.trim()) throw new RelayError("empty response from relay");
  const resp = JSON.parse(data);
  return [
    Number(resp.exit_code ?? 1),
    String(resp.stdout ?? ""),
    String(resp.stderr ?? ""),
  ];
}

async function printRelayResponse(args: string[]) {
  const [code, stdout, stderr] = await viaRelay(args);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return code;
}

export async function readSecret(ref: string, accountArgs: string[] = []) {
  const [code, stdout, stderr] = await viaRelay(["read", ...accountArgs, ref]);
  if (code !== 0) throw new RelayError(stderr || `op read failed for ${ref}`);
  return stdout.replace(/\n$/, "");
}

type SecretReader = (ref: string, accountArgs?: string[]) => Promise<string>;

export async function resolveRefs(
  value: string,
  accountArgs: string[] = [],
  reader: SecretReader = readSecret,
) {
  const replaceRefs = async (input: string, re: RegExp) => {
    let out = "";
    let last = 0;
    for (const match of input.matchAll(re)) {
      out += input.slice(last, match.index);
      out += await reader(match[0], accountArgs);
      last = (match.index ?? 0) + match[0].length;
    }
    return out + input.slice(last);
  };

  if (value.startsWith("op://")) return await reader(value, accountArgs);
  return await replaceRefs(
    await replaceRefs(value, quotedSecretRefRe),
    secretRefRe,
  );
}

export function parseEnvLine(line: string): [string, string] | null {
  let stripped = line.trim();
  if (!stripped || stripped.startsWith("#")) return null;
  if (stripped.startsWith("export "))
    stripped = stripped.slice("export ".length).trimStart();
  const eq = stripped.indexOf("=");
  if (eq < 0) return null;
  const key = stripped.slice(0, eq).trim();
  if (!key) return null;
  let value = stripped.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.split(/\s+/, 1)[0] ?? "";
  }
  return [key, value];
}

export async function loadEnvFile(
  filePath: string,
  accountArgs: string[] = [],
  reader: SecretReader = readSecret,
) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(expandHome(filePath), "utf8").split(
    /\r?\n/,
  )) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    env[parsed[0]] = await resolveRefs(parsed[1], accountArgs, reader);
  }
  return env;
}

type RunSpec = { command: string[]; envFiles: string[]; accountArgs: string[] };

function parseRun(args: string[]): RunSpec {
  const envFiles: string[] = [];
  const accountArgs: string[] = [];
  let command: string[] | null = null;
  for (let i = 0; i < args.length; ) {
    const arg = args[i];
    if (arg === "--") {
      command = args.slice(i + 1);
      break;
    }
    if (arg === "--env-file" || arg === "--account") {
      if (i + 1 >= args.length)
        throw new RelayError(`missing value for ${arg}`);
      if (arg === "--env-file") envFiles.push(args[i + 1]);
      else accountArgs.push(arg, args[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith("--env-file=")) envFiles.push(arg.split("=", 2)[1]);
    else if (arg.startsWith("--account=")) accountArgs.push(arg);
    else if (arg === "--no-masking") {
    } else if (arg.startsWith("-"))
      throw new RelayError(`unsupported op run flag: ${arg}`);
    else {
      command = args.slice(i);
      break;
    }
    i += 1;
  }
  if (!command?.length) throw new RelayError("op run relay requires a command");
  return { command, envFiles, accountArgs };
}

async function opRun(args: string[]) {
  const spec = parseRun(args);
  const env: NodeJS.ProcessEnv = { ...process.env };
  const envFileEnv: Record<string, string> = {};

  for (const envFile of spec.envFiles)
    Object.assign(envFileEnv, await loadEnvFile(envFile, spec.accountArgs));

  for (const [key, value] of Object.entries(env)) {
    if (!(key in envFileEnv) && value?.includes("op://"))
      env[key] = await resolveRefs(value, spec.accountArgs);
  }
  Object.assign(env, envFileEnv);

  return (
    spawnSync(spec.command[0], spec.command.slice(1), {
      env,
      stdio: "inherit",
    }).status ?? 1
  );
}

type InjectSpec = { inFile?: string; outFile?: string; accountArgs: string[] };

function parseInject(args: string[]): InjectSpec {
  const spec: InjectSpec = { accountArgs: [] };
  for (let i = 0; i < args.length; ) {
    const arg = args[i];
    if (["-i", "--in-file", "-o", "--out-file", "--account"].includes(arg)) {
      if (i + 1 >= args.length)
        throw new RelayError(`missing value for ${arg}`);
      if (arg === "-i" || arg === "--in-file") spec.inFile = args[i + 1];
      else if (arg === "-o" || arg === "--out-file") spec.outFile = args[i + 1];
      else spec.accountArgs.push("--account", args[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith("--in-file=")) spec.inFile = arg.split("=", 2)[1];
    else if (arg.startsWith("--out-file=")) spec.outFile = arg.split("=", 2)[1];
    else if (arg.startsWith("--account=")) spec.accountArgs.push(arg);
    else throw new RelayError(`unsupported op inject flag: ${arg}`);
    i += 1;
  }
  return spec;
}

async function opInject(args: string[]) {
  const spec = parseInject(args);
  const input = spec.inFile
    ? readFileSync(expandHome(spec.inFile), "utf8")
    : await Bun.stdin.text();
  const resolved = await resolveRefs(input, spec.accountArgs);
  if (spec.outFile) writeFileSync(expandHome(spec.outFile), resolved);
  else process.stdout.write(resolved);
  return 0;
}

export function isRelayWrapper(candidate: string) {
  try {
    const stat = statSync(candidate);
    if (!stat.isFile() || stat.size > 64 * 1024) return false;
    const body = readFileSync(candidate, "utf8");
    return body.includes("op-relay-client") || body.includes(".term-op-repo");
  } catch {
    return false;
  }
}

function usableOp(candidate: string, selfPath: string) {
  try {
    return (
      statSync(candidate).isFile() &&
      realpathSync(candidate) !== selfPath &&
      !isRelayWrapper(candidate)
    );
  } catch {
    return false;
  }
}

export function findRealOp(
  pathValue = process.env.PATH ?? "",
  selfPath = realpathSync(process.argv[1]),
  preferredPaths = ["/opt/homebrew/bin/op", "/usr/local/bin/op"],
) {
  for (const candidate of preferredPaths) {
    if (usableOp(candidate, selfPath)) return candidate;
  }
  for (const dir of pathValue.split(":")) {
    const candidate = path.join(dir, "op");
    if (usableOp(candidate, selfPath)) return candidate;
  }
  return null;
}

function runRealOp(args: string[]) {
  const realOp = findRealOp();
  if (!realOp) {
    process.stderr.write(
      "op-relay: relay unavailable and no local op binary found\n",
    );
    return 1;
  }
  return spawnSync(realOp, args, { stdio: "inherit" }).status ?? 1;
}

export function shouldFailClosed(args: string[], env = process.env) {
  return (
    Boolean(env.SSH_CONNECTION) &&
    ["read", "run", "inject", "whoami"].includes(args[0] ?? "")
  );
}

export async function main(args = process.argv.slice(2)) {
  const available = await relayAvailable();
  if (!args.length)
    return available ? await printRelayResponse(["whoami"]) : runRealOp(args);
  if (!available) {
    if (shouldFailClosed(args)) {
      process.stderr.write("op-relay: relay unavailable in SSH session\n");
      return 1;
    }
    return runRealOp(args);
  }

  const [command, ...commandArgs] = args;
  if (command === "read" || command === "whoami")
    return await printRelayResponse(args);
  if (command === "run") return await opRun(commandArgs);
  if (command === "inject") return await opInject(commandArgs);
  return runRealOp(args);
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`op-relay: ${err.message ?? err}\n`);
      process.exit(1);
    });
}
