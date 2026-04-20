#!/usr/bin/env zsh

# Usage: session.sh <host> <session> <home_dir>

HOST=$1
SESSION=$2
HOME_DIR=$3

if [[ -z $HOST || -z $SESSION || -z $HOME_DIR ]]; then
  echo "Usage: ${0:t} <host> <session> <home_dir>"
  exit 1
fi

# Install SSH key on remote if this is the first connection.
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 $HOST true 2>/dev/null; then
  ssh-copy-id $HOST
fi

# Create tmux session on remote if it doesn't exist.
ssh $HOST "tmux has-session -t $SESSION 2>/dev/null || tmux new-session -d -s $SESSION -c $HOME_DIR"

# Attach — caffeinate keeps the remote awake for the duration of the session.
TERM=xterm-256color ssh -t $HOST "caffeinate -i -w \$\$ & tmux attach -t $SESSION"
