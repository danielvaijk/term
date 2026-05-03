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

if [[ -n $HOST ]]; then
  local ORIGIN=$(git -C "${SCRIPT_DIR:h}" remote get-url origin 2>/dev/null)

  # If the session already exists on the remote we just need to attach;
  # no prewarm work, so play a simple splash and reuse the same connection.
  local STATUS_FILE=$(mktemp -t zellij-splash.XXXXXX) || exit 1
  local CTL_SOCK=$(mktemp -u -t zellij-ctl.XXXXXX) || exit 1

  cleanup_prewarm() {
    rm -f "$STATUS_FILE"
  }
  trap cleanup_prewarm EXIT INT TERM

  print -r -- "connecting to $HOST..." > "$STATUS_FILE"

  # Pre-warm: open a control master, sync the config repo, decide which
  # zellij command to run on attach. Status messages stream back through
  # the file the splash polls each frame.
  (
    if ! ssh -fNM -S "$CTL_SOCK" -o ControlPersist=300 "$HOST" 2>/dev/null; then
      print -r -- "connection failed - press any key" > "$STATUS_FILE"
      exit 1
    fi

    print -r -- "syncing config..." > "$STATUS_FILE"
    ssh -S "$CTL_SOCK" "$HOST" "
      export PATH=\"/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:\$HOME/.local/bin:\$HOME/.cargo/bin:\$PATH\"
      if [ -L ~/.config/zellij/config.kdl ] && [ -n \"$ORIGIN\" ]; then
        repo=\$(git -C \"\$(dirname \"\$(readlink ~/.config/zellij/config.kdl)\")\" rev-parse --show-toplevel 2>/dev/null)
        if [ -n \"\$repo\" ] && [ \"\$(git -C \"\$repo\" remote get-url origin 2>/dev/null)\" = \"$ORIGIN\" ]; then
          git -C \"\$repo\" pull --ff-only >/dev/null 2>&1 || true
        fi
      fi
    " 2>/dev/null

    print -r -- "ready - press any key" > "$STATUS_FILE"
  ) &
  local PREWARM_PID=$!

  # Splash blocks in the foreground until any keypress.
  python3 "$SPLASH" --status-file "$STATUS_FILE" 2>/dev/null

  # If the user mashed a key before prewarm finished, wait for it.
  wait $PREWARM_PID 2>/dev/null

  if ! ssh -S "$CTL_SOCK" -O check "$HOST" 2>/dev/null; then
    print -u2 "Failed to connect to $HOST"
    exit 1
  fi

  # The control socket persists past exec, so the attach is instant.
  trap - EXIT INT TERM
  cleanup_prewarm

  TERM=xterm-256color exec ssh -S "$CTL_SOCK" -t "$HOST" "
  export PATH=\"/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:\$HOME/.local/bin:\$HOME/.cargo/bin:\$PATH\"
  cd $CWD
  if zellij list-sessions --short 2>/dev/null | grep -qx $SESSION; then
    exec zellij attach $SESSION
  else
    exec zellij -n ~/.config/zellij/layouts/$LAYOUT.kdl -s $SESSION
  fi
"
else
  cd ${~CWD}
  if zellij list-sessions --short 2>/dev/null | grep -qx $SESSION; then
    exec zellij attach $SESSION
  else
    python3 "$SPLASH" 2>/dev/null
    exec zellij -n ~/.config/zellij/layouts/$LAYOUT.kdl -s $SESSION
  fi
fi
