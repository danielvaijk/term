#!/usr/bin/env zsh

SCRIPT_DIR="${0:A:h:h}"

brew bundle

mkdir -p ~/.config/zsh ~/.config/zellij ~/.config/ghostty ~/.config/lazygit

# zsh's bootstrap file is hardcoded to ~/.zshenv; it sets ZDOTDIR so the rest lives under XDG.
ln -sf "$SCRIPT_DIR/.config/zsh/.zshenv" ~/.zshenv
ln -sf "$SCRIPT_DIR/.config/zsh/.zshrc" ~/.config/zsh/.zshrc
ln -sf "$SCRIPT_DIR/.config/zellij/config.kdl" ~/.config/zellij/config.kdl
ln -sfn "$SCRIPT_DIR/.config/zellij/layouts" ~/.config/zellij/layouts
ln -sf "$SCRIPT_DIR/.config/ghostty/config" ~/.config/ghostty/config
ln -sf "$SCRIPT_DIR/data/bg.jpg" ~/.config/ghostty/bg.jpg
ln -sf "$SCRIPT_DIR/.config/lazygit/config.yml" ~/.config/lazygit/config.yml

defaults write com.mitchellh.ghostty "ApplePressAndHoldEnabled" -bool false

# ssh
mkdir -p ~/.ssh && chmod 700 ~/.ssh
chmod 700 "$SCRIPT_DIR/.ssh"
chmod 600 "$SCRIPT_DIR/.ssh/config"
touch ~/.ssh/config && chmod 600 ~/.ssh/config

if ! grep -qF "Include $SCRIPT_DIR/.ssh/config" ~/.ssh/config; then
  print "Include $SCRIPT_DIR/.ssh/config\n$(< ~/.ssh/config)" > ~/.ssh/config
fi

"$SCRIPT_DIR/scripts/setup-sudo-touch-id.sh"
"$SCRIPT_DIR/scripts/harden-sshd.sh" --install
