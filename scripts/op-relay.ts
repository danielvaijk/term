#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";

const sockPath = process.env.OP_RELAY_SOCK ?? `${os.homedir()}/.op-relay.sock`;
const tcpPort = Number.parseInt(process.env.OP_RELAY_PORT ?? "12321", 10);
const pidPath = `${sockPath}.pid`;
const opBin = process.env.OP_RELAY_BIN ?? "op";
const timeout =
  Number.parseInt(process.env.OP_RELAY_TIMEOUT ?? "60", 10) * 1000;
const isolateCommands = !["0", "false", "False"].includes(
  process.env.OP_RELAY_ISOLATE_COMMANDS ?? "1",
);
const signoutAfterRead = !["0", "false", "False"].includes(
  process.env.OP_RELAY_SIGNOUT_AFTER_READ ?? "1",
);
const signoutArgs = (process.env.OP_RELAY_SIGNOUT_ARGS ?? "signout --all")
  .split(/\s+/)
  .filter(Boolean);

const allowedReadFlags = new Set(["--account", "--cache"]);
const allowedDirectCommands = new Set(["read", "whoami"]);

type RelayResponse = { exit_code: number; stdout: string; stderr: string };

function killPrevious() {
  try {
    const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
    if (Number.isFinite(pid)) process.kill(pid, "SIGTERM");
  } catch {}
}

function error(message: string): RelayResponse {
  return { exit_code: 1, stdout: "", stderr: `op-relay: ${message}\n` };
}

function validateArgs(args: unknown): string[] {
  if (!Array.isArray(args) || args.length === 0)
    throw new Error("missing or invalid 'args'");
  if (!args.every((arg) => typeof arg === "string"))
    throw new Error("'args' must be a list of strings");
  if (!allowedDirectCommands.has(args[0]))
    throw new Error(`unsupported op command: ${args[0]}`);
  if (args[0] === "read") validateReadArgs(args.slice(1));
  else if (args.length > 1)
    throw new Error(`unsupported arguments for op ${args[0]}`);
  return args;
}

function validateReadArgs(args: string[]) {
  const positional: string[] = [];
  for (let i = 0; i < args.length; ) {
    const arg = args[i];
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--account=")) {
      i += 1;
      continue;
    }
    if (allowedReadFlags.has(arg)) {
      i += arg === "--account" ? 2 : 1;
      continue;
    }
    if (arg.startsWith("-"))
      throw new Error(`unsupported op read flag: ${arg}`);
    positional.push(arg);
    i += 1;
  }
  if (positional.length !== 1 || !positional[0].startsWith("op://")) {
    throw new Error(
      "op read relay requires exactly one op:// secret reference",
    );
  }
}

async function runCommand(
  args: string[],
  env = process.env,
): Promise<RelayResponse> {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(opBin, args, {
      env,
      detached: isolateCommands,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exit_code: 1, stdout, stderr: stderr || `${err.message}\n` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) resolve(error(`op command timed out (${timeout / 1000}s)`));
      else resolve({ exit_code: code ?? 1, stdout, stderr });
    });
  });
}

async function runOp(args: string[]): Promise<RelayResponse> {
  const env = { ...process.env };
  delete env.OP_SESSION;
  const result = await runCommand(args, env);
  if (signoutAfterRead && args[0] === "read") {
    const signout = spawnSync(opBin, signoutArgs, {
      encoding: "utf8",
      timeout,
    });
    if (signout.status !== 0)
      result.stderr += signout.stderr || "op-relay: op signout failed\n";
  }
  return result;
}

function handleClient(conn: net.Socket) {
  let data = "";
  conn.setEncoding("utf8");
  conn.on("data", async (chunk) => {
    data += chunk;
    if (!data.includes("\n")) return;
    conn.pause();
    try {
      if (data.trim()) {
        const req = JSON.parse(data);
        const resp = await runOp(validateArgs(req.args));
        conn.end(`${JSON.stringify(resp)}\n`);
      } else {
        conn.end();
      }
    } catch (err) {
      conn.end(
        `${JSON.stringify(error(err instanceof SyntaxError ? "invalid JSON" : String((err as Error).message ?? err)))}\n`,
      );
    }
  });
  conn.on("error", () => {});
}

function cleanup(unixServer: net.Server, tcpServer: net.Server) {
  unixServer.close();
  tcpServer.close();
  for (const path of [sockPath, pidPath]) {
    try {
      rmSync(path);
    } catch {}
  }
}

killPrevious();
try {
  if (existsSync(sockPath)) rmSync(sockPath);
} catch {}

const unixServer = net.createServer(handleClient);
const tcpServer = net.createServer(handleClient);

unixServer.listen(sockPath, () => chmodSync(sockPath, 0o600));
tcpServer.listen(tcpPort, "127.0.0.1");
writeFileSync(pidPath, `${process.pid}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    cleanup(unixServer, tcpServer);
    process.exit(0);
  });
}
