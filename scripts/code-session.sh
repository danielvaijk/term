#!/usr/bin/env zsh

# Usage: code-session.sh <host> <session> <home_dir>

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

# Create tmux session with a 2x2 pane layout on remote if it doesn't exist.
ssh $HOST "
  tmux has-session -t $SESSION 2>/dev/null && exit

  tmux new-session -d -s $SESSION -c $HOME_DIR
  tmux split-window -h -c $HOME_DIR
  tmux select-pane -t 0
  tmux split-window -v -c $HOME_DIR
  tmux select-pane -t 2
  tmux split-window -v -c $HOME_DIR
  tmux select-pane -t 0
"

# Attach — caffeinate keeps the remote awake for the duration of the session.
TERM=xterm-256color ssh -t $HOST "caffeinate -i -w \$\$ & tmux attach -t $SESSION"
