#!/usr/bin/env python3
"""1Password CLI secret relay server.

Listens on a local Unix socket and resolves a narrow set of `op` requests on
the client Mac, where the 1Password desktop app can show the biometric prompt.
The socket is intended to be reverse-forwarded over SSH to a trusted host.

Protocol (newline-delimited JSON, one request per connection):

  Request:  {"args": ["read", "op://vault/item/field"]}
  Response: {"exit_code": 0, "stdout": "secret-value", "stderr": ""}
"""

import json
import os
import signal
import socket
import subprocess
import sys
import threading

SOCK_PATH = os.environ.get("OP_RELAY_SOCK", os.path.expanduser("~/.op-relay.sock"))
TCP_PORT = int(os.environ.get("OP_RELAY_PORT", "12321"))
PID_PATH = SOCK_PATH + ".pid"
OP_BIN = os.environ.get("OP_RELAY_BIN", "op")
TIMEOUT = int(os.environ.get("OP_RELAY_TIMEOUT", "60"))
ISOLATE_COMMANDS = os.environ.get("OP_RELAY_ISOLATE_COMMANDS", "1") not in {
    "0",
    "false",
    "False",
}
SIGNOUT_AFTER_READ = os.environ.get("OP_RELAY_SIGNOUT_AFTER_READ", "1") not in {
    "0",
    "false",
    "False",
}
SIGNOUT_ARGS = os.environ.get("OP_RELAY_SIGNOUT_ARGS", "signout --all").split()

ALLOWED_READ_FLAGS = {
    "--account",
    "--cache",
}

ALLOWED_DIRECT_COMMANDS = {
    "read",
    "whoami",
}


def kill_previous() -> None:
    try:
        with open(PID_PATH) as f:
            pid = int(f.read().strip())
        os.kill(pid, signal.SIGTERM)
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        pass


def error(message: str) -> dict[str, object]:
    return {"exit_code": 1, "stdout": "", "stderr": f"op-relay: {message}\n"}


def validate_args(args: object) -> list[str]:
    if not args or not isinstance(args, list):
        raise ValueError("missing or invalid 'args'")
    if not all(isinstance(arg, str) for arg in args):
        raise ValueError("'args' must be a list of strings")
    if args[0] not in ALLOWED_DIRECT_COMMANDS:
        raise ValueError(f"unsupported op command: {args[0]}")
    if args[0] == "read":
        validate_read_args(args[1:])
    elif len(args) > 1:
        raise ValueError(f"unsupported arguments for op {args[0]}")
    return args


def validate_read_args(args: list[str]) -> None:
    positional = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--":
            positional.extend(args[i + 1 :])
            break
        if arg.startswith("--account="):
            i += 1
            continue
        if arg in ALLOWED_READ_FLAGS:
            if arg == "--account":
                i += 2
            else:
                i += 1
            continue
        if arg.startswith("-"):
            raise ValueError(f"unsupported op read flag: {arg}")
        positional.append(arg)
        i += 1

    if len(positional) != 1 or not positional[0].startswith("op://"):
        raise ValueError("op read relay requires exactly one op:// secret reference")


def run_op(args: list[str]) -> dict[str, object]:
    env = os.environ.copy()
    env.pop("OP_SESSION", None)
    result = subprocess.run(
        [OP_BIN] + args,
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        env=env,
        start_new_session=ISOLATE_COMMANDS,
    )
    stderr = result.stderr
    if SIGNOUT_AFTER_READ and args[0] == "read":
        signout = subprocess.run(
            [OP_BIN] + SIGNOUT_ARGS,
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
        if signout.returncode != 0:
            stderr += signout.stderr or "op-relay: op signout failed\n"
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": stderr,
    }


def handle_client(conn: socket.socket) -> None:
    try:
        data = b""
        while b"\n" not in data:
            chunk = conn.recv(4096)
            if not chunk:
                break
            data += chunk

        if not data.strip():
            return

        req = json.loads(data.decode())
        resp = run_op(validate_args(req.get("args")))

        conn.sendall((json.dumps(resp) + "\n").encode())
    except ValueError as e:
        conn.sendall((json.dumps(error(str(e))) + "\n").encode())
    except json.JSONDecodeError:
        err = error("invalid JSON")
        conn.sendall((json.dumps(err) + "\n").encode())
    except subprocess.TimeoutExpired:
        err = error(f"op command timed out ({TIMEOUT}s)")
        conn.sendall((json.dumps(err) + "\n").encode())
    except Exception as e:
        err = {"exit_code": 1, "stdout": "", "stderr": str(e)}
        try:
            conn.sendall((json.dumps(err) + "\n").encode())
        except Exception:
            pass
    finally:
        conn.close()


def accept_loop(srv: socket.socket) -> None:
    while True:
        try:
            conn, _ = srv.accept()
        except OSError:
            break
        threading.Thread(target=handle_client, args=(conn,), daemon=True).start()


def main() -> None:
    kill_previous()

    if os.path.exists(SOCK_PATH):
        os.unlink(SOCK_PATH)

    unix_srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    unix_srv.bind(SOCK_PATH)
    os.chmod(SOCK_PATH, 0o600)
    unix_srv.listen(4)

    tcp_srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp_srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    tcp_srv.bind(("127.0.0.1", TCP_PORT))
    tcp_srv.listen(4)

    with open(PID_PATH, "w") as f:
        f.write(str(os.getpid()))

    def shutdown(signum, frame):
        unix_srv.close()
        tcp_srv.close()
        for p in (SOCK_PATH, PID_PATH):
            try:
                os.unlink(p)
            except FileNotFoundError:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    threading.Thread(target=accept_loop, args=(tcp_srv,), daemon=True).start()
    accept_loop(unix_srv)


if __name__ == "__main__":
    main()
