import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
