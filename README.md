# term

macOS terminal environment — Ghostty, zellij, zsh.

## Setup

1. Clone the repo to `~/home/term`
2. Run `scripts/setup.sh`
3. Open Secretive and create an SSH key for this machine
4. For each remote host you want to connect to, install your public key (one-time).
   On the target Mac:
   ```
   scripts/session.sh --accept-key
   ```
   Then run the normal remote session command from the client Mac and approve
   the displayed fingerprint on the target Mac.

   Password-based fallback also works when enabled on the target:
   ```
   ssh-copy-id -o PreferredAuthentications=password <host>
   ```

## Layout

Configs live under `.config/<tool>/` in the repo, mirroring `~/.config/`.
`scripts/setup.sh` symlinks each into place. Two paths can't follow XDG:

- `~/.zshenv` — zsh's hardcoded bootstrap; symlinked to the repo. It sets
  `XDG_CONFIG_HOME` and `ZDOTDIR` so the rest of zsh's config sits under
  `~/.config/zsh/`.
- `~/.ssh/config` — ssh has no XDG support. `setup.sh` keeps the local file
  and prepends an `Include` of the repo's `.ssh/config`.

## Session management

Start a zellij session with `scripts/session.sh`:

```
session.sh [--accept-key] [-s session] [-l layout] [-c cwd] [user@host]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-s` | `main` | Session name |
| `-l` | `single` | Layout: `single` or `coding` (large left pane, two stacked panes on the right) |
| `-c` | `~` | Working directory all panes start in |
| `--accept-key` | | Listen once for another machine's SSH public key and prompt before adding it |
| `user@host` | (local) | If given, runs on remote host via SSH |

Layouts live in `.config/zellij/layouts/` as KDL files. The `-l` flag only
takes effect when the session is first created; reattaching to an existing
session preserves its current layout.

Examples:

```zsh
# Local single-pane session
scripts/session.sh

# Remote coding layout in ~/home
scripts/session.sh -c ~/home -l coding user@host
```

## Accessing a remote dev server

When a dev server is running on `localhost:PORT` on the remote, forward the
port over SSH rather than exposing it publicly via `tunnel.vandijk.sh`.

**Ad-hoc, second connection:**

```
ssh -NL 3000:localhost:3000 user@host
```

`-N` runs no command, `-L` forwards the port. Hit `http://localhost:3000` on
the client.

**Persistent, in `~/.ssh/config`:**

```
Host host
  LocalForward 3000 localhost:3000
```

**On the fly, from inside an existing SSH session (including zellij):**

1. Press `Enter` (must be at the start of a line)
2. Press `~` then `Shift+C` — you'll get an `ssh>` prompt from the local SSH client
3. Type `-L 3000:localhost:3000` and `Enter`

Remove a forward later with `-KL 3000:localhost:3000` via the same escape.
Nested SSH eats one `~` per layer — use `~~C` to reach the outer hop. If `~C`
does nothing, the leading `Enter` was probably missed, or `EscapeChar none` is
set.

Reserve `tunnel.vandijk.sh` for things that genuinely need a public URL —
webhooks, preview sharing, mobile testing on cellular.
