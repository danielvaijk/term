import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import * as opRelayClient from "../scripts/op-relay-client";

describe("op relay client", () => {
  test("resolveRefs treats a whole secret ref value as one ref", async () => {
    const seen: string[] = [];
    const reader = async (ref: string) => {
      seen.push(ref);
      return "secret";
    };

    expect(
      await opRelayClient.resolveRefs(
        "op://Private/My Item/password",
        [],
        reader,
      ),
    ).toBe("secret");
    expect(seen).toEqual(["op://Private/My Item/password"]);
  });

  test("loadEnvFile supports quoted item names with spaces", async () => {
    const seen: string[] = [];
    const reader = async (ref: string) => {
      seen.push(ref);
      return "secret";
    };

    const tmp = mkdtempSync(path.join(os.tmpdir(), "op-relay-test."));
    try {
      const envFile = path.join(tmp, ".env");
      writeFileSync(envFile, 'TOKEN="op://Private/My Item/password"\n');
      expect(await opRelayClient.loadEnvFile(envFile, [], reader)).toEqual({
        TOKEN: "secret",
      });
      expect(seen).toEqual(["op://Private/My Item/password"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("resolveRefs keeps unquoted inline refs whitespace delimited", async () => {
    const seen: string[] = [];
    const reader = async (ref: string) => {
      seen.push(ref);
      return "secret";
    };

    expect(
      await opRelayClient.resolveRefs(
        "token=op://Private/Item/password suffix",
        [],
        reader,
      ),
    ).toBe("token=secret suffix");
    expect(seen).toEqual(["op://Private/Item/password"]);
  });

  test("op run resolves all refs without extra relay operations", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "op-relay-test."));
    const seen: string[][] = [];
    const server = net.createServer((socket) => {
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        data += chunk;
        if (!data.includes("\n")) return;

        const req = JSON.parse(data);
        const args = req.args as string[];
        seen.push(args);
        if (args[0] === "read") {
          socket.end(
            `${JSON.stringify({ exit_code: 0, stdout: "secret\n", stderr: "" })}\n`,
          );
        } else {
          socket.end(
            `${JSON.stringify({ exit_code: 1, stdout: "", stderr: "unexpected" })}\n`,
          );
        }
      });
    });

    try {
      const envFile = path.join(tmp, ".env");
      writeFileSync(
        envFile,
        [
          "TOKEN=op://Private/Token/password",
          "OTHER=op://Private/Other/password",
          "",
        ].join("\n"),
      );

      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("missing test port");

      const child = spawn(
        "bun",
        [
          "scripts/op-relay-client.ts",
          "run",
          `--env-file=${envFile}`,
          "--",
          "bun",
          "-e",
          "process.exit(process.env.TOKEN === 'secret' && process.env.OTHER === 'secret' ? 0 : 1)",
        ],
        {
          cwd: path.join(import.meta.dir, ".."),
          env: {
            ...process.env,
            OP_RELAY_PORT: String(address.port),
            OP_RELAY_SOCK: path.join(tmp, "missing.sock"),
          },
          stdio: "ignore",
        },
      );

      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", resolve);
      });

      expect(code).toBe(0);
      expect(seen).toEqual([
        ["read", "op://Private/Token/password"],
        ["read", "op://Private/Other/password"],
      ]);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("op run does not resolve inherited refs overridden by env files", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "op-relay-test."));
    const seen: string[][] = [];
    const server = net.createServer((socket) => {
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        data += chunk;
        if (!data.includes("\n")) return;

        const req = JSON.parse(data);
        const args = req.args as string[];
        seen.push(args);
        socket.end(
          `${JSON.stringify({ exit_code: 0, stdout: "from-file\n", stderr: "" })}\n`,
        );
      });
    });

    try {
      const envFile = path.join(tmp, ".env");
      writeFileSync(envFile, "TOKEN=op://Private/File/password\n");

      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("missing test port");

      const child = spawn(
        "bun",
        [
          "scripts/op-relay-client.ts",
          "run",
          `--env-file=${envFile}`,
          "--",
          "bun",
          "-e",
          "process.exit(process.env.TOKEN === 'from-file' ? 0 : 1)",
        ],
        {
          cwd: path.join(import.meta.dir, ".."),
          env: {
            ...process.env,
            OP_RELAY_PORT: String(address.port),
            OP_RELAY_SOCK: path.join(tmp, "missing.sock"),
            TOKEN: "op://Private/Inherited/password",
          },
          stdio: "ignore",
        },
      );

      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", resolve);
      });

      expect(code).toBe(0);
      expect(seen).toEqual([["read", "op://Private/File/password"]]);
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("findRealOp skips generated relay wrapper before real op", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "op-relay-test."));
    try {
      const wrapperDir = path.join(tmp, "wrapper");
      const realDir = path.join(tmp, "real");
      mkdirSync(wrapperDir);
      mkdirSync(realDir);

      const wrapper = path.join(wrapperDir, "op");
      const real = path.join(realDir, "op");
      writeFileSync(wrapper, "#!/usr/bin/env bun\nop-relay-client\n");
      writeFileSync(real, "#!/bin/sh\nexit 0\n");
      chmodSync(wrapper, 0o755);
      chmodSync(real, 0o755);

      expect(
        opRelayClient.findRealOp(
          `${wrapperDir}:${realDir}`,
          path.join(tmp, "op-relay-client.ts"),
          [],
        ),
      ).toBe(real);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("relay commands fail closed in ssh sessions", () => {
    expect(
      opRelayClient.shouldFailClosed(["run", "--env-file=.env"], {
        SSH_CONNECTION: "client 1 server 22",
      }),
    ).toBe(true);
    expect(opRelayClient.shouldFailClosed(["run"], {})).toBe(false);
    expect(
      opRelayClient.shouldFailClosed(["item", "list"], {
        SSH_CONNECTION: "client 1 server 22",
      }),
    ).toBe(false);
  });
});
