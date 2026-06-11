#!/usr/bin/env bash
set -e

echo "[+] Starting OpenClaw Setup..."

# Install OpenClaw globally using npm
npm install -g openclaw@latest

# Run Node.js configuration builder
node .devcontainer/configure.js

echo "[+] OpenClaw setup completed successfully!"
