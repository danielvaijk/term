#!/usr/bin/env zsh

SCRIPT_DIR="${0:A:h}"

mkdir ~/.config/ghostty

ln -sf "$SCRIPT_DIR/.zshrc" ~/.zshrc
ln -sf "$SCRIPT_DIR/.ghostty" ~/.config/ghostty/config
ln -sf "$SCRIPT_DIR/bg.jpg" ~/.config/ghostty/bg.jpg

defaults write com.mitchellh.ghostty "ApplePressAndHoldEnabled" -bool false
