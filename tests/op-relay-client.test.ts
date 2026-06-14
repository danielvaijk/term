import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
