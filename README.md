# term

macOS terminal environment — Ghostty, tmux, zsh.

## Setup

1. Clone the repo to `~/home/term`
2. Run `scripts/setup.sh`
3. Open Secretive and create an SSH key for this machine
4. For each remote host you want to connect to, install your public key (one-time):
   ```
   ssh-copy-id -o PreferredAuthentications=password <host>
   ```

## Connecting to a remote machine

Create a wrapper script in `~` that calls the generic session script with your machine's details:

```zsh
#!/usr/bin/env zsh
~/home/term/scripts/session.sh "<host>" "<session>" "<home_dir>"
```

Use `code-session.sh` instead for a 2x2 tmux pane layout.
