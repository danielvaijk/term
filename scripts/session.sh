#!/usr/bin/env zsh

# Usage: session.sh [--accept-key] [-c cwd] [user@host]
#
#   --accept-key  listen once for another machine's SSH public key and prompt
#                 before adding it to ~/.ssh/authorized_keys
#
# Without -c, starts the main session in ~ with a single full-screen pane.
# With -c, all panes start there, the session name is the directory name, and
# the coding layout is used. Layout only takes effect when the session is first
# created; reattaching preserves the current layout.
#
# If user@host is given, the session runs on that remote host via SSH.
# A full-screen splash plays while a control-master connection is
# pre-warmed in the background, doubling as a connection-status loader.

SESSION=main
LAYOUT=single
CWD="~"
CWD_SET=0
ACCEPT_KEY=0
PAIR_PORT=12322

while [[ $# -gt 0 ]]; do
  case $1 in
    --accept-key)
      ACCEPT_KEY=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      break
      ;;
    *)
      break
      ;;
  esac
done

session_name_for_cwd() {
  local expanded=${~1}
  local name=${${expanded:A}:t}
  [[ -n $name ]] && print -r -- "$name" || print -r -- "root"
}

remote_cd_command() {
  case "$1" in
    "~")
      print -r -- 'cd "$HOME"'
      ;;
    "~/"*)
      local suffix=${1#\~/}
      print -r -- "cd \"\$HOME\"/${(qq)suffix}"
      ;;
    *)
      print -r -- "cd ${(qq)1}"
      ;;
  esac
}

while getopts ":c:" opt; do
  case $opt in
    c) CWD=$OPTARG; CWD_SET=1 ;;
    *) echo "Usage: ${0:t} [--accept-key] [-c cwd] [user@host]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

HOST=$1

if (( CWD_SET )); then
  LAYOUT=coding
  SESSION=$(session_name_for_cwd "$CWD")
fi

SCRIPT_DIR=${0:A:h}
SPLASH=$SCRIPT_DIR/splash.py
OP_RELAY=$SCRIPT_DIR/op-relay.py
OP_RELAY_SOCK="$HOME/.op-relay.sock"
OP_RELAY_PORT=12321

valid_public_key_line() {
  case "$1" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-nistp256\ *|ecdsa-sha2-nistp384\ *|ecdsa-sha2-nistp521\ *|sk-ssh-ed25519@openssh.com\ *|sk-ecdsa-sha2-nistp256@openssh.com\ *)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

fingerprint_public_key() {
  local key=$1
  print -r -- "$key" | ssh-keygen -lf - 2>/dev/null
}

ssh_auth_failure() {
  grep -Eiq 'Permission denied|publickey|authentication failed|no more authentication methods' "$1"
}

accept_key_pairing() {
  if ! command -v nc >/dev/null 2>&1; then
    print -u2 "error: nc is required for key pairing"
    exit 1
  fi

  local payload_file=$(mktemp -t session-key-offer.XXXXXX) || exit 1
  trap 'rm -f "$payload_file"' EXIT INT TERM

  print "waiting for an SSH key offer on port $PAIR_PORT..."
  print "on the other Mac, run: scripts/session.sh danielvaijk@$(ipconfig getifaddr en0 2>/dev/null || hostname)"
  nc -l "$PAIR_PORT" > "$payload_file"

  local header=$(sed -n '1p' "$payload_file")
  if [[ $header != TERM_SESSION_KEY_PAIR_V1 ]]; then
    print -u2 "error: received an unknown key-pairing request"
    exit 1
  fi

  local client=$(sed -n '2s/^client=//p' "$payload_file")
  local target=$(sed -n '3s/^target=//p' "$payload_file")
  local keys=("${(@f)$(sed -n '/^--keys--$/,/^--end--$/p' "$payload_file" | sed '1d;$d')}")
  local approved=()

  if (( ${#keys[@]} == 0 )); then
    print -u2 "error: the other Mac did not offer any SSH agent keys"
    exit 1
  fi

  print
  print "key offer from: ${client:-unknown client}"
  [[ -n $target ]] && print "requested target: $target"
  print

  local key fp answer
  for key in "${keys[@]}"; do
    if ! valid_public_key_line "$key"; then
      print "skipping invalid public key line"
      continue
    fi

    fp=$(fingerprint_public_key "$key")
    if [[ -z $fp ]]; then
      print "skipping key because ssh-keygen could not fingerprint it"
      continue
    fi

    print "$fp"
    printf "add this key to ~/.ssh/authorized_keys? [y/N] "
    read -r answer
    case "$answer" in
      y|Y|yes|YES)
        approved+=("$key")
        ;;
    esac
    print
  done

  if (( ${#approved[@]} == 0 )); then
    print "no keys added"
    exit 1
  fi

  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  touch ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys

  for key in "${approved[@]}"; do
    if grep -qxF "$key" ~/.ssh/authorized_keys; then
      print "already present: $(fingerprint_public_key "$key")"
    else
      print -r -- "$key" >> ~/.ssh/authorized_keys
      print "added: $(fingerprint_public_key "$key")"
    fi
  done
}

resolved_pairing_host() {
  local ssh_host=$1
  ssh -G "$ssh_host" 2>/dev/null | awk 'tolower($1) == "hostname" { print $2; exit }'
}

offer_agent_keys_for_pairing() {
  local ssh_host=$1

  if ! command -v nc >/dev/null 2>&1; then
    print -u2 "hint: nc is required for automatic key pairing"
    return 1
  fi

  local keys=("${(@f)$(ssh-add -L 2>/dev/null | awk '/^(ssh-|ecdsa-|sk-)/ { print }')}")
  if (( ${#keys[@]} == 0 )); then
    print -u2 "hint: no SSH agent keys are available; make sure Secretive is running and added to ssh-agent"
    return 1
  fi

  local pair_host=$(resolved_pairing_host "$ssh_host")
  [[ -z $pair_host ]] && pair_host=${ssh_host##*@}
  pair_host=${pair_host%%:*}

  local client_name="$(whoami)@$(scutil --get ComputerName 2>/dev/null || hostname)"
  print -u2 "SSH key is not authorized yet; offering this Mac's agent keys to $pair_host:$PAIR_PORT"
  print -u2 "hint: on the target Mac, run scripts/session.sh --accept-key and approve the fingerprint"

  {
    print -r -- "TERM_SESSION_KEY_PAIR_V1"
    print -r -- "client=$client_name"
    print -r -- "target=$ssh_host"
    print -r -- "--keys--"
    print -rl -- "${keys[@]}"
    print -r -- "--end--"
  } | nc -w 3 "$pair_host" "$PAIR_PORT" >/dev/null 2>&1
}

connect_control_master() {
  local ctl_sock=$1
  local host=$2
  local err_file=$3

  ssh -fNM -A -S "$ctl_sock" \
    -o ControlPersist=300 \
    -o BatchMode=yes \
    -o PreferredAuthentications=publickey \
    -o PasswordAuthentication=no \
    -o KbdInteractiveAuthentication=no \
    -o NumberOfPasswordPrompts=0 \
    "$host" 2>"$err_file"
}

wait_for_paired_auth() {
  local ctl_sock=$1
  local host=$2
  local err_file=$3
  local attempts=60
  local attempt=1

  print -u2 "waiting for key approval on the target Mac..."

  while (( attempt <= attempts )); do
    : > "$err_file"
    if connect_control_master "$ctl_sock" "$host" "$err_file"; then
      print -u2 "key approved; SSH connection established"
      return 0
    fi

    if ! ssh_auth_failure "$err_file"; then
      return 1
    fi

    sleep 1
    (( attempt++ ))
  done

  print -u2 "error: timed out waiting for key approval"
  return 1
}

if (( ACCEPT_KEY )); then
  accept_key_pairing
  exit 0
fi

print_connect_error() {
  local host=$1

  print -u2 "error: failed to connect to $host"
}

if [[ -n $HOST ]]; then
  local ORIGIN=$(git -C "${SCRIPT_DIR:h}" remote get-url origin 2>/dev/null)
  local REMOTE_SESSION=${(qq)SESSION}
  local REMOTE_CD=$(remote_cd_command "$CWD")

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
  if ! connect_control_master "$CTL_SOCK" "$HOST" "$SSH_ERR_FILE"; then
    if ssh_auth_failure "$SSH_ERR_FILE" && offer_agent_keys_for_pairing "$HOST"; then
      if ! wait_for_paired_auth "$CTL_SOCK" "$HOST" "$SSH_ERR_FILE"; then
        print_connect_error "$HOST" "$SSH_ERR_FILE"
        exit 1
      fi
    else
      print_connect_error "$HOST" "$SSH_ERR_FILE"
      exit 1
    fi
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
  $REMOTE_CD
  if zellij list-sessions --short 2>/dev/null | grep -qx -- $REMOTE_SESSION; then
    exec zellij attach $REMOTE_SESSION
  else
    exec zellij -n \"\$HOME/.config/zellij/layouts/$LAYOUT.kdl\" -s $REMOTE_SESSION
  fi
"
  SSH_STATUS=$?
  trap - EXIT INT TERM
  cleanup_all
  exit $SSH_STATUS
else
  cd ${~CWD}
  if zellij list-sessions --short 2>/dev/null | grep -qx -- "$SESSION"; then
    exec zellij attach "$SESSION"
  else
    python3 "$SPLASH" 2>/dev/null
    exec zellij -n "$HOME/.config/zellij/layouts/$LAYOUT.kdl" -s "$SESSION"
  fi
fi
