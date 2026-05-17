#!/usr/bin/env python3
"""Remote-side 1Password CLI relay client.

Install this ahead of the real `op` binary on the remote host. It resolves
`op://` secret references through the SSH-forwarded relay on the client Mac,
then keeps host-local behavior host-local:

  * `op read op://...` prints the resolved secret.
  * `op run -- command ...` resolves secret refs in the remote environment and
    optional env files, then execs the command on the remote host.
  * `op inject` resolves refs in remote files/stdin and writes remotely.

Unsupported commands fall back to the real local `op` binary when no relay is
available, and fail closed when the relay is available.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

SOCK_PATH = os.environ.get("OP_RELAY_SOCK", os.path.expanduser("~/.op-relay.sock"))
TCP_PORT = int(os.environ.get("OP_RELAY_PORT", "12321"))
SECRET_REF_RE = re.compile(r"op://[^\s'\"`$\\]+")


class RelayError(Exception):
    pass


def connect_relay() -> socket.socket | None:
    if os.path.exists(SOCK_PATH):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(65)
        try:
            sock.connect(SOCK_PATH)
            return sock
        except OSError:
            sock.close()

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    try:
        sock.connect(("127.0.0.1", TCP_PORT))
    except OSError:
        sock.close()
        return None
    sock.settimeout(65)
    return sock


def relay_available() -> bool:
    sock = connect_relay()
    if sock is None:
        return False
    sock.close()
    return True


def via_relay(args: list[str]) -> tuple[int, str, str]:
    sock = connect_relay()
    if sock is None:
        raise RelayError("relay is not available")

    try:
        sock.sendall((json.dumps({"args": args}) + "\n").encode())
        data = b""
        while b"\n" not in data:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
    finally:
        sock.close()

    if not data.strip():
        raise RelayError("empty response from relay")

    resp = json.loads(data.decode())
    return (
        int(resp.get("exit_code", 1)),
        str(resp.get("stdout", "")),
        str(resp.get("stderr", "")),
    )


def print_relay_response(args: list[str]) -> int:
    code, stdout, stderr = via_relay(args)
    if stdout:
        sys.stdout.write(stdout)
    if stderr:
        sys.stderr.write(stderr)
    return code


def read_secret(ref: str, account_args: list[str] | None = None) -> str:
    args = ["read"]
    if account_args:
        args.extend(account_args)
    args.append(ref)
    code, stdout, stderr = via_relay(args)
    if code != 0:
        raise RelayError(stderr or f"op read failed for {ref}")
    return stdout.rstrip("\n")


def resolve_refs(value: str, account_args: list[str] | None = None) -> str:
    def replace(match: re.Match[str]) -> str:
        return read_secret(match.group(0), account_args)

    return SECRET_REF_RE.sub(replace, value)


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].lstrip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key:
        return None
    value = value.strip()
    try:
        value = shlex.split(value, posix=True)[0] if value else ""
    except ValueError:
        value = value.strip("'\"")
    return key, value


def load_env_file(path: str, account_args: list[str] | None = None) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for line in f:
            parsed = parse_env_line(line)
            if parsed is None:
                continue
            key, value = parsed
            env[key] = resolve_refs(value, account_args)
    return env


@dataclass
class RunSpec:
    command: list[str]
    env_files: list[str]
    account_args: list[str]


def parse_run(args: list[str]) -> RunSpec:
    env_files: list[str] = []
    account_args: list[str] = []
    command: list[str] | None = None
    i = 0

    while i < len(args):
        arg = args[i]
        if arg == "--":
            command = args[i + 1 :]
            break
        if arg in ("--env-file", "--account"):
            if i + 1 >= len(args):
                raise RelayError(f"missing value for {arg}")
            if arg == "--env-file":
                env_files.append(args[i + 1])
            else:
                account_args.extend([arg, args[i + 1]])
            i += 2
            continue
        if arg.startswith("--env-file="):
            env_files.append(arg.split("=", 1)[1])
            i += 1
            continue
        if arg.startswith("--account="):
            account_args.append(arg)
            i += 1
            continue
        if arg == "--no-masking":
            i += 1
            continue
        if arg.startswith("-"):
            raise RelayError(f"unsupported op run flag: {arg}")
        command = args[i:]
        break

    if not command:
        raise RelayError("op run relay requires a command")

    return RunSpec(command=command, env_files=env_files, account_args=account_args)


def op_run(args: list[str]) -> int:
    spec = parse_run(args)
    env = os.environ.copy()

    for key, value in list(env.items()):
        if "op://" in value:
            env[key] = resolve_refs(value, spec.account_args)

    for env_file in spec.env_files:
        env.update(load_env_file(env_file, spec.account_args))

    result = subprocess.run(spec.command, env=env)
    return result.returncode


@dataclass
class InjectSpec:
    in_file: str | None
    out_file: str | None
    account_args: list[str]


def parse_inject(args: list[str]) -> InjectSpec:
    in_file: str | None = None
    out_file: str | None = None
    account_args: list[str] = []
    i = 0

    while i < len(args):
        arg = args[i]
        if arg in ("-i", "--in-file", "-o", "--out-file", "--account"):
            if i + 1 >= len(args):
                raise RelayError(f"missing value for {arg}")
            if arg in ("-i", "--in-file"):
                in_file = args[i + 1]
            elif arg in ("-o", "--out-file"):
                out_file = args[i + 1]
            else:
                account_args.extend(["--account", args[i + 1]])
            i += 2
            continue
        if arg.startswith("--in-file="):
            in_file = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--out-file="):
            out_file = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--account="):
            account_args.append(arg)
            i += 1
            continue
        raise RelayError(f"unsupported op inject flag: {arg}")

    return InjectSpec(in_file=in_file, out_file=out_file, account_args=account_args)


def op_inject(args: list[str]) -> int:
    spec = parse_inject(args)
    if spec.in_file:
        content = Path(os.path.expanduser(spec.in_file)).read_text(encoding="utf-8")
    else:
        content = sys.stdin.read()

    resolved = resolve_refs(content, spec.account_args)

    if spec.out_file:
        Path(os.path.expanduser(spec.out_file)).write_text(resolved, encoding="utf-8")
    else:
        sys.stdout.write(resolved)
    return 0


def real_op_path() -> str | None:
    real_op = shutil.which("op")
    this_script = os.path.realpath(__file__)

    if real_op and os.path.realpath(real_op) != this_script:
        return real_op

    for directory in os.environ.get("PATH", "").split(":"):
        candidate = os.path.join(directory, "op")
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            if os.path.realpath(candidate) != this_script:
                return candidate
    return None


def run_real_op(args: list[str]) -> int:
    real_op = real_op_path()
    if not real_op:
        print("op-relay: relay unavailable and no local op binary found", file=sys.stderr)
        return 1
    return subprocess.run([real_op] + args).returncode


def main() -> int:
    args = sys.argv[1:]
    if not args:
        return run_real_op(args) if not relay_available() else print_relay_response(["whoami"])

    if not relay_available():
        return run_real_op(args)

    try:
        command = args[0]
        command_args = args[1:]
        if command == "read":
            return print_relay_response(args)
        if command == "whoami":
            return print_relay_response(args)
        if command == "run":
            return op_run(command_args)
        if command == "inject":
            return op_inject(command_args)
        print(f"op-relay: unsupported command while relay is active: {command}", file=sys.stderr)
        return 1
    except (OSError, RelayError, json.JSONDecodeError) as e:
        print(f"op-relay: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
