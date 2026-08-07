# term

macOS terminal environment — Ghostty, zellij, zsh.

## Setup

1. Install Homebrew if it is not already installed:

   ```zsh
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Clone the repo to `~/home/term`
3. Install the Brewfile dependencies before running any repo scripts:

   ```zsh
   cd ~/home/term
   brew bundle
   ```

4. Run `bun run setup`
5. Open Secretive and create an SSH key for this machine
6. For each remote host you want to connect to, install your public key (one-time).
   On the target Mac:

   ```
   bun run session --accept-key
   ```

   Then run the normal remote session command from the client Mac and approve
   the displayed fingerprint on the target Mac.

   Password-based fallback also works when enabled on the target:

   ```
   ssh-copy-id -o PreferredAuthentications=password <host>
   ```

`bun run setup` also installs the managed `sshd` policy: public-key auth stays on,
password and keyboard-interactive auth are disabled, and root login is disabled.
On macOS it enables Touch ID for `sudo` through `/etc/pam.d/sudo_local`.

## Layout

Configs live under `.config/<tool>/` in the repo, mirroring `~/.config/`.
`bun run setup` symlinks each into place. Two paths can't follow XDG:

- `~/.zshenv` — zsh's hardcoded bootstrap; symlinked to the repo. It sets
  `XDG_CONFIG_HOME` and `ZDOTDIR` so the rest of zsh's config sits under
  `~/.config/zsh/`.
- `~/.ssh/config` — ssh has no XDG support. `bun run setup` keeps the local file
  and prepends an `Include` of the repo's `.ssh/config`.

## Session management

Start a zellij session with `bun run session`:

```
bun run session [--accept-key] [-c cwd] [user@host]
```

| Flag           | Default | Description                                                                                                          |
| -------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `-c`, `--cwd`  | `~`     | Working directory all panes start in. When set, the session name is the directory name and the coding layout is used |
| `--accept-key` |         | Listen once for another machine's SSH public key and prompt before adding it                                         |
| `user@host`    | prompt  | If given, runs on remote host via SSH                                                                                |

Values not passed on the command line are prompted interactively. Without a
host, the script lists known LAN devices from the local ARP table, plus a local
session option. Without `-c`, it prompts for a start directory after the target
is known. Choosing `~` starts the `main` session with the single layout; choosing
another directory uses the directory name as the session name and the coding
layout. Layout selection only takes effect when the session is first created;
reattaching to an existing session preserves its current layout.

Examples:

```zsh
# Pick target and start directory interactively
bun run session

# Remote coding layout in ~/home
bun run session -c ~/home user@host
```

## Accessing a remote dev server

When a dev server is running on `localhost:PORT` on the remote, forward the
port over SSH rather than exposing it publicly.

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

## Remote access security

`bun run session user@host` treats SSH as the device allowlist. Connect directly
to the host by IP address or hostname, either on the local network or over a mesh
network such as Tailscale. A client still needs an approved SSH identity before
the remote zellij session starts.

Use one hardware-backed SSH identity per physical client device:

- macOS: create the key in Secretive and keep `IdentityAgent` pointed at the
  Secretive socket.
- Portable tokens: create an OpenSSH security-key identity, preferably with
  user verification:
  ```
  ssh-keygen -t ed25519-sk -O verify-required -f ~/.ssh/id_ed25519_sk_device
  ```
- Do not copy one software private key between devices.

### Adding a client device

1. Create or unlock the device's hardware-backed SSH identity.
2. From the new client, run the normal remote session command:
   ```
   bun run session user@host
   ```
3. When authentication fails, the client offers its agent public keys.
4. On the target host, run:
   ```
   bun run session --accept-key
   ```
5. Approve only the fingerprint for the physical device you are adding.

The key is appended to `~/.ssh/authorized_keys` on that target host. For several
remotes, repeat this per host or replace per-host key lists with a personal SSH
user CA and issue per-device certificates.

### Removing a client device

Remove that device's public key from `~/.ssh/authorized_keys` on every managed
remote host, then verify it is gone:

```
ssh-keygen -lf ~/.ssh/authorized_keys
```

If you use an SSH CA instead, revoke the device certificate or stop issuing a
valid certificate for that device. Rotate the CA if the CA private key is ever
exposed.

### Managed remote SSH policy

`bun run setup` installs this policy. To reapply or inspect only the SSH
daemon hardening:

```
bun run harden-sshd --install
```

On macOS this step is skipped with a warning unless Remote Login is enabled,
since a host that accepts no SSH connections gains nothing from the policy.
Enable it under System Settings > General > Sharing > Remote Login (or
`sudo systemsetup -setremotelogin on`) and rerun the command above. Leave it off
on machines that are only ever SSH clients.

The script installs an `sshd_config.d` snippet that keeps public-key auth on and
disables password, keyboard-interactive, and root login paths. Check the
effective daemon settings with:

```
bun run harden-sshd --check
```

The settings that matter are:

```
pubkeyauthentication yes
passwordauthentication no
kbdinteractiveauthentication no
permitrootlogin no
authenticationmethods publickey
```

`bun run session` also passes public-key-only SSH options for its own connections, but
the daemon policy is what prevents a fresh unapproved machine from logging in by
some other SSH client.

Before closing your current admin session, test a second SSH session from an
approved client. If the host rejects the config, restore the backup path printed
by `bun run harden-sshd --install` and reload `sshd`.

### Client SSH config

Keep host-specific identity selection in your private `~/.ssh/config`, not in
this repo. A Secretive-backed Mac can use:

```
Host my-remote
  HostName 100.64.0.10
  User danielvaijk
  IdentityAgent ~/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh
  IdentityFile ~/.ssh/my-secretive-device-key.pub
  IdentitiesOnly yes
  ForwardAgent yes
```

A hardware-token client can use:

```
Host my-remote
  HostName 192.168.1.50
  User danielvaijk
  IdentityFile ~/.ssh/id_ed25519_sk_device
  IdentitiesOnly yes
  ForwardAgent yes
```

Enable `ForwardAgent` only for hosts where remote git or the 1Password relay
workflow needs it.

### Agent forwarding boundary

`bun run session` forwards the client SSH agent so git commands inside the remote
session can authenticate with the client device, keeping Touch ID or hardware
token confirmation local. While the session is active, remote processes that can
reach the forwarded socket can ask the local agent to sign authentication
challenges. Hardware-backed keys still matter because the private key is not
copied to the remote and user-presence or user-verification prompts can gate
signing, but agent forwarding should only be enabled for trusted remotes.
