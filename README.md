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

## Session management

Start a tmux session with `scripts/session.sh`:

```
session.sh [-l layout] [-s session] [-c cwd] [user@host]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-l` | `1` | Layout: 1 = single, 2 = left/right, 3 = 2x1, 4 = 2x2 |
| `-s` | `main` | Session name |
| `-c` | `~` | Working directory |
| `user@host` | (local) | If given, runs on remote host via SSH |

Examples:

```zsh
# Local session
scripts/session.sh

# Remote 2x2 layout
scripts/session.sh -l 4 -s dev -c ~/projects user@host
```
