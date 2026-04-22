#!/usr/bin/env zsh

# Usage: tunnel.sh <tunnel-name>

TUNNEL=$1

if [[ -z $TUNNEL ]]; then
  echo "Usage: ${0:t} <tunnel-name>"
  exit 1
fi

caffeinate -dims cloudflared tunnel run $TUNNEL
