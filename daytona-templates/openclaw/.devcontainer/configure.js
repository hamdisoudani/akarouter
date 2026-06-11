const fs = require('fs');
const path = require('path');
const os = require('os');

const configDir = path.join(os.homedir(), '.openclaw');
const configFile = path.join(configDir, 'openclaw.json');

// Ensure directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Load existing config or start fresh
let config = {};
if (fs.existsSync(configFile)) {
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    console.warn("Could not parse existing openclaw.json, starting fresh.");
  }
}

// Ensure base objects exist
config.models = config.models || {};
config.models.providers = config.models.providers || {};
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.models = config.agents.defaults.models || {};
config.channels = config.channels || {};

// Configure AkaRouter provider
const akarouterUrl = process.env.AKAROUTER_URL || 'https://api.akarouter.com/v1';
const akarouterApiKey = process.env.AKAROUTER_API_KEY || '';
const modelName = process.env.MODEL_NAME || 'akarouter-pro';

if (akarouterApiKey) {
  config.models.providers.akarouter = {
    baseUrl: akarouterUrl,
    apiKey: akarouterApiKey,
    api: 'openai-completions'
  };
  
  // Set default model
  config.agents.defaults.models[`akarouter/${modelName}`] = {};
  console.log(`[+] Configured AkaRouter provider targeting model: ${modelName}`);
} else {
  console.warn("[!] Warning: AKAROUTER_API_KEY is not defined. AkaRouter provider will not be configured.");
}

// Configure Telegram channel dynamically
const telegramEnabled = process.env.TELEGRAM_ENABLED === 'true' || !!process.env.TELEGRAM_BOT_TOKEN;
if (telegramEnabled) {
  config.channels.telegram = {
    enabled: true,
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    dmPolicy: process.env.TELEGRAM_DM_POLICY || 'allowlist',
    allowFrom: process.env.TELEGRAM_ALLOW_FROM ? process.env.TELEGRAM_ALLOW_FROM.split(',').map(s => s.trim()) : []
  };
  console.log("[+] Telegram channel configuration injected.");
}

// Configure Discord channel dynamically
const discordEnabled = process.env.DISCORD_ENABLED === 'true' || !!process.env.DISCORD_BOT_TOKEN;
if (discordEnabled) {
  config.channels.discord = {
    enabled: true,
    token: process.env.DISCORD_BOT_TOKEN || '',
    groupPolicy: process.env.DISCORD_GROUP_POLICY || 'allowlist',
    guilds: {}
  };
  
  if (process.env.DISCORD_GUILDS) {
    try {
      config.channels.discord.guilds = JSON.parse(process.env.DISCORD_GUILDS);
    } catch (e) {
      console.error("Failed to parse DISCORD_GUILDS env var as JSON.");
    }
  }
  console.log("[+] Discord channel configuration injected.");
}

// Write config file
fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
console.log(`[+] Successfully wrote OpenClaw configuration to ${configFile}`);
