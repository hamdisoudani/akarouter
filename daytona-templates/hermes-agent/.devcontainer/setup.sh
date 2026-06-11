#!/usr/bin/env bash
set -e

echo "[+] Starting Hermes Agent Setup..."

# Install Hermes Agent via git repository
pip install --upgrade pip
pip install git+https://github.com/NousResearch/hermes-agent.git

# Create config directories
mkdir -p ~/.hermes

# Define configuration variables with defaults if missing
AKAROUTER_URL="${AKAROUTER_URL:-https://api.akarouter.com/v1}"
AKAROUTER_API_KEY="${AKAROUTER_API_KEY:-dummy_key}"
MODEL_NAME="${MODEL_NAME:-akarouter-pro}"

echo "[+] Configured Gateway: ${AKAROUTER_URL}"
echo "[+] Configured Model: ${MODEL_NAME}"

# Generate config.yaml
cat <<EOF > ~/.hermes/config.yaml
model:
  default: "${MODEL_NAME}"
  provider: "custom"
  base_url: "${AKAROUTER_URL}"
EOF

# Generate .env
cat <<EOF > ~/.hermes/.env
OPENAI_API_KEY=${AKAROUTER_API_KEY}
EOF

echo "[+] Hermes Agent setup completed successfully!"
