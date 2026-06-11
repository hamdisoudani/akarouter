# Daytona VM Templates for OpenClaw

These templates allow you to spin up fully-configured Daytona development VMs that automatically install and point **OpenClaw** to your **AkaRouter** gateway, with dynamic channel setup (Telegram, Discord).

---

## How it Works
Daytona builds environments using standard **Dev Containers (`devcontainer.json`)**. These templates:
1. Spin up an isolated Node.js VM container.
2. Download and install OpenClaw globally.
3. Automatically generate the `openclaw.json` configuration file, injecting your AkaRouter URL and API key, and configuring integration channels (like Telegram/Discord).

---

## Setup Instructions

### 1. Copy the Devcontainer Files
Copy the [.devcontainer](file:///c:/Users/siham/OneDrive/Desktop/akarouter/daytona-templates/openclaw/.devcontainer) folder from `openclaw/` to your OpenClaw repository's root.

### 2. Configure Environment Variables in Daytona
Before starting the Daytona workspace, configure the following environment variables in your Daytona CLI or GUI:

#### Gateway Configuration (AkaRouter)
*   `AKAROUTER_URL`: The endpoint of your AkaRouter deployment (default: `https://api.akarouter.com/v1`).
*   `AKAROUTER_API_KEY`: An API key generated in the AkaRouter dashboard (`akar_...`).
*   `MODEL_NAME`: The model alias you want to target (default: `akarouter-pro`).

#### Telegram Channel Configuration
*   `TELEGRAM_ENABLED`: Set to `true` to enable the Telegram bot channel.
*   `TELEGRAM_BOT_TOKEN`: The bot token obtained from [@BotFather](https://t.me/BotFather).
*   `TELEGRAM_DM_POLICY`: The DM policy (default: `allowlist`).
*   `TELEGRAM_ALLOW_FROM`: Comma-separated list of numeric user IDs allowed to interact with the bot (e.g. `1234567,9876543`).

#### Discord Channel Configuration
*   `DISCORD_ENABLED`: Set to `true` to enable the Discord bot channel.
*   `DISCORD_BOT_TOKEN`: The bot token from the Discord Developer Portal.
*   `DISCORD_GROUP_POLICY`: The group policy (default: `allowlist`).
*   `DISCORD_GUILDS`: JSON string specifying guild/channel permissions (e.g. `{"1234567890": {"channels": {"0987654321": {"allow": true}}}}`).

---

### 3. Launch Workspace
Run the Daytona command to start the environment:
```bash
daytona up
```

Once the container is built:
*   **OpenClaw** will be installed globally.
*   The `~/.openclaw/openclaw.json` config file will be dynamically generated with all provider and channel settings loaded.
*   You can start OpenClaw in the VM immediately using:
    ```bash
    openclaw onboard --install-daemon
    ```
