#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const sudoLocal = "/etc/pam.d/sudo_local";
const sudoLocalTemplate = "/etc/pam.d/sudo_local.template";
const pamTidLine = "auth       sufficient     pam_tid.so";

if (os.platform() !== "darwin") {
  process.stdout.write(
    "skipping sudo Touch ID setup; pam_tid.so is macOS-only\n",
  );
  process.exit(0);
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "sudo-local."));
const tmp = path.join(tmpDir, "sudo_local");
try {
  if (existsSync(sudoLocal)) writeFileSync(tmp, readFileSync(sudoLocal));
  else if (existsSync(sudoLocalTemplate))
    writeFileSync(tmp, readFileSync(sudoLocalTemplate));
  else
    writeFileSync(
      tmp,
      "# sudo_local: local config file which survives system update and is included for sudo\n",
    );

  let content = readFileSync(tmp, "utf8");
  if (/^[ \t]*auth[ \t]+sufficient[ \t]+pam_tid\.so([ \t]|$)/m.test(content)) {
    process.stdout.write("sudo Touch ID is already enabled\n");
    process.exit(0);
  }
  if (/^[ \t]*#auth[ \t]+sufficient[ \t]+pam_tid\.so([ \t]|$)/m.test(content)) {
    content = content.replace(
      /^[ \t]*#auth[ \t]+sufficient[ \t]+pam_tid\.so/m,
      pamTidLine,
    );
  } else {
    content += content.endsWith("\n") ? `${pamTidLine}\n` : `\n${pamTidLine}\n`;
  }
  writeFileSync(tmp, content);
  const result = spawnSync("sudo", ["install", "-m", "0444", tmp, sudoLocal], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.stdout.write(`enabled Touch ID for sudo in ${sudoLocal}\n`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
