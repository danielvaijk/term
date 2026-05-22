#!/usr/bin/env zsh

# Usage: session.sh [-s session] [-l layout] [-c cwd] [user@host]
#
# Layouts (-l):
#   single  one pane (default)
#   split   left/right two panes
#   grid    2x2 four panes
#
# All panes start in -c. The layout flag only takes effect when the
# session is first created; reattaching ignores it.
#
# If user@host is given, the session runs on that remote host via SSH.
# A full-screen splash plays while a control-master connection is
# pre-warmed in the background, doubling as a connection-status loader.

SESSION=main
LAYOUT=single
CWD="~"

while getopts "s:l:c:" opt; do
  case $opt in
    s) SESSION=$OPTARG ;;
    l) LAYOUT=$OPTARG ;;
    c) CWD=$OPTARG ;;
    *) echo "Usage: ${0:t} [-s session] [-l single|split|grid] [-c cwd] [user@host]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

HOST=$1

case $LAYOUT in
  single|split|grid) ;;
  *) echo "Unknown layout: $LAYOUT (expected single|split|grid)"; exit 1 ;;
esac

SCRIPT_DIR=${0:A:h}
SPLASH=$SCRIPT_DIR/splash.py
OP_RELAY=$SCRIPT_DIR/op-relay.py
OP_RELAY_SOCK="$HOME/.op-relay.sock"
OP_RELAY_PORT=12321

uses_cloudflared_proxy() {
  ssh -G "$1" 2>/dev/null | awk '
    BEGIN { in_proxycommand = 0 }
    tolower($1) == "proxycommand" {
      in_proxycommand = 1
      $1 = ""
      print
      next
    }
    in_proxycommand && /^[[:space:]]/ {
      print
      next
    }
    { in_proxycommand = 0 }
  ' | grep -q 'cloudflared'
}

cloudflared_tunnel_error() {
  grep -Eiq \
    'cloudflared.*(tunnel|origin|service|connect)|tunnel.*(not.*found|not.*running|unavailable|connection refused|connection reset|failed)|origin.*(unavailable|error|connection refused|connection reset|not.*reachable)|1033|Unable to reach the origin|lookup .* no such host|connection closed by (remote host|UNKNOWN port 65535)|kex_exchange_identification' \
    "$1"
}

print_connect_error() {
  local host=$1
  local err_file=$2

  if uses_cloudflared_proxy "$host" && cloudflared_tunnel_error "$err_file"; then
    print -u2 "error: cloudflared tunnel is not reachable for $host"
    print -u2 "hint: start it in another terminal with scripts/tunnel.sh <tunnel-name>"
  else
    print -u2 "error: failed to connect to $host"
  fi
}

check_cloudflared() {
  local host=$1

  uses_cloudflared_proxy "$host" || return 0

  if ! command -v cloudflared >/dev/null 2>&1; then
    print -u2 "error: $host uses cloudflared, but cloudflared is not installed or not on PATH"
    print -u2 "hint: install it with brew install cloudflared"
    exit 1
  fi
}

if [[ -n $HOST ]]; then
  check_cloudflared "$HOST"

  local ORIGIN=$(git -C "${SCRIPT_DIR:h}" remote get-url origin 2>/dev/null)

  # If the session already exists on the remote we just need to attach;
  # no prewarm work, so play a simple splash and reuse the same connection.
  local STATUS_FILE=$(mktemp -t zellij-splash.XXXXXX) || exit 1
  local CTL_SOCK=$(mktemp -u -t zellij-ctl.XXXXXX) || exit 1
  local SSH_ERR_FILE=$(mktemp -t zellij-ssh.XXXXXX) || exit 1
  local OP_RELAY_ERR_FILE=$(mktemp -t op-relay.XXXXXX) || exit 1
  local OP_RELAY_PID=""
  local PREWARM_PID=""

  cleanup_prewarm() {
    rm -f "$STATUS_FILE"
    rm -f "$SSH_ERR_FILE"
    rm -f "$OP_RELAY_ERR_FILE"
  }
  cleanup_all() {
    cleanup_prewarm
    if [[ -n $PREWARM_PID ]]; then
      kill $PREWARM_PID 2>/dev/null
      wait $PREWARM_PID 2>/dev/null
    fi
    [[ -S $CTL_SOCK ]] && ssh -S "$CTL_SOCK" -O exit "$HOST" >/dev/null 2>&1
    if [[ -n $OP_RELAY_PID ]]; then
      kill $OP_RELAY_PID 2>/dev/null
      wait $OP_RELAY_PID 2>/dev/null
    fi
  }
  trap cleanup_all EXIT INT TERM

  # -A on the master, not just the slaves: with connection multiplexing the
  # master governs agent forwarding, and slave sessions inherit it from here.
  if ! ssh -fNM -A -S "$CTL_SOCK" -o ControlPersist=300 "$HOST" 2>"$SSH_ERR_FILE"; then
    print_connect_error "$HOST" "$SSH_ERR_FILE"
    exit 1
  fi

  # Start the 1Password CLI relay so Touch ID prompts stay on this machine.
  # Resolve the real op binary (skip our own relay-client symlink).
  local OP_REAL=""
  for p in /opt/homebrew/bin/op /usr/local/bin/op; do
    [[ -x $p ]] && { OP_REAL=$p; break; }
  done
  if [[ -z $OP_REAL ]]; then
    print -u2 "error: 1Password CLI (op) not found — install it first (brew install --cask 1password-cli)"
    exit 1
  fi

  OP_RELAY_BIN=$OP_REAL python3 "$OP_RELAY" 2>"$OP_RELAY_ERR_FILE" &
  OP_RELAY_PID=$!
  for i in 1 2 3 4 5; do
    if ! kill -0 $OP_RELAY_PID 2>/dev/null; then
      if grep -q 'Address already in use' "$OP_RELAY_ERR_FILE"; then
        print -u2 "error: op relay failed to start because 127.0.0.1:$OP_RELAY_PORT is already in use"
      else
        print -u2 "error: op relay failed to start"
      fi
      exit 1
    fi
    [[ -S $OP_RELAY_SOCK ]] && break
    sleep 0.1
  done

  # Add the 1Password relay forwarding to the existing control master, so SSH
  # authentication only happens once.
  if [[ -S $OP_RELAY_SOCK ]]; then
    ssh -S "$CTL_SOCK" -O forward -R $OP_RELAY_PORT:127.0.0.1:$OP_RELAY_PORT "$HOST" 2>/dev/null || true
  fi

  print -r -- "connecting to $HOST..." > "$STATUS_FILE"

  # Pre-warm: sync the config repo and decide which zellij command to run on
  # attach. Status messages stream back through the file the splash polls each
  # frame.
  (
    print -r -- "syncing config..." > "$STATUS_FILE"
    # -A so the config-repo pull authenticates with the client's forwarded
    # agent, keeping all git Touch ID prompts on the client.
    ssh -A -S "$CTL_SOCK" "$HOST" "
      export PATH=\"\$HOME/.local/bin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:\$HOME/.cargo/bin:\$PATH\"
      if [ -L ~/.config/zellij/config.kdl ] && [ -n \"$ORIGIN\" ]; then
        repo=\$(git -C \"\$(dirname \"\$(readlink ~/.config/zellij/config.kdl)\")\" rev-parse --show-toplevel 2>/dev/null)
        if [ -n \"\$repo\" ] && [ \"\$(git -C \"\$repo\" remote get-url origin 2>/dev/null)\" = \"$ORIGIN\" ]; then
          git -C \"\$repo\" pull --ff-only >/dev/null 2>&1 || true
          # Install the op relay client so remote op calls proxy to the client's Touch ID.
          mkdir -p ~/.local/bin
          ln -sf \"\$repo/scripts/op-relay-client.py\" ~/.local/bin/op
        fi
      fi
    " 2>/dev/null

    print -r -- "ready - press any key" > "$STATUS_FILE"
  ) &
  PREWARM_PID=$!

  # Splash blocks in the foreground until any keypress.
  python3 "$SPLASH" --status-file "$STATUS_FILE" 2>/dev/null

  # If the user mashed a key before prewarm finished, wait for it.
  wait $PREWARM_PID 2>/dev/null
  PREWARM_PID=""

  if ! ssh -S "$CTL_SOCK" -O check "$HOST" 2>/dev/null; then
    print_connect_error "$HOST" "$SSH_ERR_FILE"
    exit 1
  fi

  cleanup_prewarm

  # -A forwards this client's SSH agent so git inside the session authenticates
  # with the client's keys, not the remote's.
  TERM=xterm-256color ssh -A -S "$CTL_SOCK" -t "$HOST" "
  export PATH=\"\$HOME/.local/bin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:\$HOME/.cargo/bin:\$PATH\"
  mkdir -p ~/.ssh && ln -sf \"\$SSH_AUTH_SOCK\" ~/.ssh/forwarded-agent.sock
  cd $CWD
  if zellij list-sessions --short 2>/dev/null | grep -qx $SESSION; then
    exec zellij attach $SESSION
  else
    exec zellij -n ~/.config/zellij/layouts/$LAYOUT.kdl -s $SESSION
  fi
"
  SSH_STATUS=$?
  trap - EXIT INT TERM
  cleanup_all
  exit $SSH_STATUS
else
  cd ${~CWD}
  if zellij list-sessions --short 2>/dev/null | grep -qx $SESSION; then
    exec zellij attach $SESSION
  else
    python3 "$SPLASH" 2>/dev/null
    exec zellij -n ~/.config/zellij/layouts/$LAYOUT.kdl -s $SESSION
  fi
fi
