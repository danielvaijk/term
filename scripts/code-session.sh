#!/usr/bin/env zsh

# Usage: code-session.sh <host> <session> <home_dir>

HOST=$1
SESSION=$2
HOME_DIR=$3

if [[ -z $HOST || -z $SESSION || -z $HOME_DIR ]]; then
  echo "Usage: ${0:t} <host> <session> <home_dir>"
  exit 1
fi

TERM=xterm-256color ssh -t $HOST "
  /opt/homebrew/bin/tmux has-session -t $SESSION 2>/dev/null || {
    /opt/homebrew/bin/tmux new-session -d -s $SESSION -c $HOME_DIR
    /opt/homebrew/bin/tmux split-window -h -c $HOME_DIR
    /opt/homebrew/bin/tmux select-pane -t 1
    /opt/homebrew/bin/tmux split-window -v -c $HOME_DIR
    /opt/homebrew/bin/tmux select-pane -t 3
    /opt/homebrew/bin/tmux split-window -v -c $HOME_DIR
    /opt/homebrew/bin/tmux select-pane -t 1
  }
  caffeinate -i -w \$\$ &
  /opt/homebrew/bin/tmux attach -t $SESSION
"
