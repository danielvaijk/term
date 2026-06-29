#!/usr/bin/env bun
import os from "node:os";

type Address = {
  iface: string;
  address: string;
  family: "IPv4" | "IPv6";
};

function localAddresses(): Address[] {
  const addresses: Address[] = [];

  for (const [iface, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.internal) continue;
      const family =
        typeof info.family === "number" ? `IPv${info.family}` : info.family;
      if (family !== "IPv4" && family !== "IPv6") continue;
      // Skip link-local addresses (169.254.x.x and fe80::), which aren't routable.
      if (family === "IPv4" && info.address.startsWith("169.254.")) continue;
      if (family === "IPv6" && info.address.toLowerCase().startsWith("fe80"))
        continue;
      addresses.push({ iface, address: info.address, family });
    }
  }

  return addresses;
}

// Tunnel/virtual interfaces (VPNs, etc.) usually aren't the LAN address you
// want to hand to another machine, so rank physical interfaces first.
function isTunnel(iface: string) {
  return /^(utun|tun|tap|wg|ppp|ipsec|gif|stf)/.test(iface);
}

function score(entry: Address) {
  let value = 0;
  if (entry.family === "IPv4") value += 2; // prefer IPv4 for pasting as a host
  if (!isTunnel(entry.iface)) value += 1; // prefer physical over tunnel
  return value;
}

const all = localAddresses();

if (!all.length) {
  process.stderr.write("no non-internal network address found\n");
  process.exit(1);
}

const best = all.sort((a, b) => score(b) - score(a))[0];
process.stdout.write(`${best.address}\n`);
