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
session.sh [-s session] [-c cwd] [-p dir ...] [user@host]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-s` | `main` | Session name |
| `-c` | `~` | Base working directory |
| `-p` | `.` | Pane directory (relative to `-c`). Repeat for more panes (max 4) |
| `user@host` | (local) | If given, runs on remote host via SSH |

The number of `-p` flags determines the layout: 1 = single, 2 = left/right,
3 = top split + bottom full, 4 = 2x2. Each value sets the starting directory for that pane.

Examples:

```zsh
# Local single-pane session
scripts/session.sh

# Remote 2x2 with per-pane directories
scripts/session.sh -c ~/home -p term -p infra -p notes -p . user@host
```
