#!/usr/bin/env zsh

SCRIPT_DIR="${0:A:h:h}"

brew bundle

mkdir -p ~/.config/zsh ~/.config/tmux ~/.config/ghostty ~/.config/lazygit

# zsh's bootstrap file is hardcoded to ~/.zshenv; it sets ZDOTDIR so the rest lives under XDG.
ln -sf "$SCRIPT_DIR/.config/zsh/.zshenv" ~/.zshenv
ln -sf "$SCRIPT_DIR/.config/zsh/.zshrc" ~/.config/zsh/.zshrc
ln -sf "$SCRIPT_DIR/.config/tmux/tmux.conf" ~/.config/tmux/tmux.conf
ln -sf "$SCRIPT_DIR/.config/ghostty/config" ~/.config/ghostty/config
ln -sf "$SCRIPT_DIR/data/bg.jpg" ~/.config/ghostty/bg.jpg
ln -sf "$SCRIPT_DIR/.config/lazygit/config.yml" ~/.config/lazygit/config.yml

defaults write com.mitchellh.ghostty "ApplePressAndHoldEnabled" -bool false

# ssh
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/config && chmod 600 ~/.ssh/config

if ! grep -qF "Include $SCRIPT_DIR/.ssh/config" ~/.ssh/config; then
  print "Include $SCRIPT_DIR/.ssh/config\n$(< ~/.ssh/config)" > ~/.ssh/config
fi
