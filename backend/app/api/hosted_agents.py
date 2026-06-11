import logging
import base64
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel
from cryptography.fernet import Fernet

from app.core.supabase import get_supabase
from app.core.config import settings
from app.core.router import generate_api_key
from app.core.cache import get_max_agents_limit
from app.core.daytona import (
    create_sandbox,
    delete_sandbox,
    install_openclaw,
    upload_openclaw_config,
    start_openclaw_gateway,
    get_openclaw_logs
)
from app.api.user import _get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user/hosted-agents")

# ---------------------------------------------------------------------------
# Encryption Helpers
# ---------------------------------------------------------------------------

def encrypt_key(raw_key: str) -> str:
    secret = settings.agent_key_encryption_secret
    f = Fernet(secret.encode())
    return f.encrypt(raw_key.encode()).decode()

def decrypt_key(encrypted_key: str) -> str:
    secret = settings.agent_key_encryption_secret
    f = Fernet(secret.encode())
    return f.decrypt(encrypted_key.encode()).decode()

def _resolve_daytona_credentials(daytona_key_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Helper to fetch decrypted Daytona key and base URL by key ID. Falls back to config settings if key_id is not specified."""
    if not daytona_key_id:
        return settings.daytona_api_key, settings.daytona_api_base
        
    try:
        supabase = get_supabase()
        res = supabase.table("daytona_keys").select("*").eq("id", daytona_key_id).execute()
        if res.data:
            key_rec = res.data[0]
            decrypted = decrypt_key(key_rec["api_key_encrypted"])
            return decrypted, key_rec["api_url"]
    except Exception as e:
        logger.error(f"Error resolving Daytona credentials for key {daytona_key_id}: {e}")
        
    return settings.daytona_api_key, settings.daytona_api_base

# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class DeployAgentRequest(BaseModel):
    agent_name: str
    model_name: str = "akarouter-pro"  # Default model

class ConfigureChannelsRequest(BaseModel):
    telegram_enabled: bool = False
    telegram_bot_token: Optional[str] = None
    telegram_allow_from: Optional[str] = None
    
    discord_enabled: bool = False
    discord_bot_token: Optional[str] = None
    discord_guilds: Optional[Dict[str, Any]] = None

# ---------------------------------------------------------------------------
# Background Task
# ---------------------------------------------------------------------------

def deploy_agent_background(
    agent_id: str,
    agent_name: str,
    account_id: str,
    raw_api_key: str,
    model_name: str,
    gateway_url: str,
    daytona_key_id: Optional[str] = None,
    daytona_api_key: Optional[str] = None,
    daytona_api_url: Optional[str] = None
):
    """Background task to provision Daytona VM, install OpenClaw, write config, and start gateway with step telemetry."""
    supabase = get_supabase()
    
    try:
        # 1. Update status to 'provisioning', Step 1: Provisioning VM
        supabase.table("hosted_agents").update({
            "status": "provisioning",
            "progress_step": 1,
            "progress_message": "Provisioning VM sandbox on Daytona (1 CPU, 1GB RAM)...",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        # 2. Provision sandbox in Daytona
        sandbox_id = create_sandbox(agent_name, api_key=daytona_api_key, api_url=daytona_api_url)
        
        # 3. Update status to 'installing', Step 2: Installing OpenClaw
        supabase.table("hosted_agents").update({
            "sandbox_id": sandbox_id,
            "status": "installing",
            "progress_step": 2,
            "progress_message": "Installing OpenClaw global module (npm install)...",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        # 4. Install OpenClaw globally
        install_openclaw(sandbox_id, api_key=daytona_api_key, api_url=daytona_api_url)
        
        # 5. Update status to 'installing', Step 3: Injecting configuration
        supabase.table("hosted_agents").update({
            "status": "installing",
            "progress_step": 3,
            "progress_message": "Injecting AkaRouter credentials and configuration...",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        # Build openclaw.json config dictionary
        config_dict = {
            "gateway": {
                "mode": "local",
                "auth": {
                    "mode": "none"
                },
                "bind": "loopback"
            },
            "models": {
                "providers": {
                    "akarouter": {
                        "baseUrl": gateway_url,
                        "apiKey": raw_api_key,
                        "api": "openai-completions",
                        "models": [
                            {"id": "akarouter-pro", "name": "AkaRouter Pro", "contextWindow": 128000},
                            {"id": "akarouter-flash", "name": "AkaRouter Flash", "contextWindow": 128000},
                            {"id": "akarouter-large", "name": "AkaRouter Large", "contextWindow": 128000}
                        ]
                    }
                }
            },
            "agents": {
                "defaults": {
                    "model": f"akarouter/{model_name}",
                    "workspace": "/home/node/.openclaw/workspace"
                },
                "list": [
                    {
                        "id": "main",
                        "name": f"{agent_name} Agent",
                        "identity": {
                            "name": f"{agent_name} Agent",
                            "theme": "helpful assistant",
                            "emoji": "🤖"
                        }
                    }
                ]
            },
            "bindings": [],
            "channels": {}
        }
        
        # 6. Upload configuration to sandbox
        upload_openclaw_config(sandbox_id, config_dict, api_key=daytona_api_key, api_url=daytona_api_url)
        
        # 7. Update status to 'installing', Step 4: Starting gateway daemon
        supabase.table("hosted_agents").update({
            "status": "installing",
            "progress_step": 4,
            "progress_message": "Starting OpenClaw gateway daemon...",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        # Start the OpenClaw gateway
        start_openclaw_gateway(sandbox_id, api_key=daytona_api_key, api_url=daytona_api_url)
        
        # 8. Mark agent as running, Step 5: Complete
        supabase.table("hosted_agents").update({
            "status": "running",
            "progress_step": 5,
            "progress_message": "✓ Agent is online",
            "last_health_check": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        logger.info(f"Successfully deployed hosted agent {agent_id} in sandbox {sandbox_id}")
        
    except Exception as e:
        logger.error(f"Failed to deploy hosted agent {agent_id}: {e}", exc_info=True)
        # Update agent status to failed
        try:
            supabase.table("hosted_agents").update({
                "status": "failed",
                "error_message": "There was an error creating the hosted agent. Please try again or contact support.",
                "progress_message": "Deployment failed: an error occurred while setting up the agent sandbox environment.",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", agent_id).execute()
        except Exception as update_err:
            logger.error(f"Failed to set agent {agent_id} status to failed: {update_err}")

# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@router.get("")
async def list_agents(request: Request):
    """List all hosted agents for the authenticated user."""
    account_id = _get_user_id(request)
    supabase = get_supabase()
    
    result = supabase.table("hosted_agents").select(
        "id, agent_name, sandbox_id, status, model_name, telegram_enabled, telegram_allow_from, discord_enabled, error_message, created_at, updated_at"
    ).eq("account_id", account_id).execute()
    
    return {"agents": result.data or []}

@router.post("")
async def deploy_agent(
    request: Request,
    body: DeployAgentRequest,
    background_tasks: BackgroundTasks
):
    """Deploy a new hosted OpenClaw agent."""
    account_id = _get_user_id(request)
    supabase = get_supabase()
    
    # 1. Fetch user account to ensure validity
    acc_res = supabase.table("accounts").select("tier").eq("id", account_id).execute()
    if not acc_res.data:
        raise HTTPException(status_code=404, detail="User account not found")
    
    # Retrieve max agents limit from system settings configuration
    limit = get_max_agents_limit()
        
    # Check current active/provisioning agents count
    agents_res = supabase.table("hosted_agents").select("id").eq("account_id", account_id).execute()
    existing_count = len(agents_res.data or [])
    
    if existing_count >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"Hosted agent limit reached. The current configuration allows up to {limit} agent(s) per user."
        )
        
    # 2. Auto-generate dedicated API key for this agent
    raw_api_key, key_hash, key_prefix = generate_api_key()
    
    # Insert new API key in DB
    key_name = f"hosted-agent-{body.agent_name.lower().replace(' ', '-')}"
    api_key_res = supabase.table("api_keys").insert({
        "account_id": account_id,
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "key_name": key_name,
        "scopes": ["chat:completion", "models:list"],
        "allowed_models": ["*"]
    }).execute()
    
    if not api_key_res.data:
        raise HTTPException(status_code=500, detail="Failed to generate dedicated API key")
        
    api_key_id = api_key_res.data[0]["id"]
    encrypted_raw_key = encrypt_key(raw_api_key)
    
    # Load Balancing Selection Strategy
    import random
    daytona_key_id = None
    selected_api_key = None
    selected_api_url = None
    
    try:
        keys_res = supabase.table("daytona_keys").select("id, api_key_encrypted, api_url").eq("is_active", True).execute()
        active_keys = keys_res.data or []
        
        if active_keys:
            agents_res = supabase.table("hosted_agents").select("daytona_key_id, status").execute()
            agents = agents_res.data or []
            
            counts = {k["id"]: 0 for k in active_keys}
            for agent in agents:
                kid = agent.get("daytona_key_id")
                status = agent.get("status")
                if kid and kid in counts and status in ("running", "provisioning", "installing"):
                    counts[kid] += 1
                    
            min_count = min(counts.values())
            candidate_ids = [kid for kid, count in counts.items() if count == min_count]
            selected_id = random.choice(candidate_ids)
            
            selected_key_record = next(k for k in active_keys if k["id"] == selected_id)
            daytona_key_id = selected_key_record["id"]
            selected_api_url = selected_key_record["api_url"]
            selected_api_key = decrypt_key(selected_key_record["api_key_encrypted"])
            logger.info(f"Load balancer selected Daytona key ID: {daytona_key_id} (active VMs: {min_count})")
        else:
            logger.warning("No active Daytona keys found in database. Falling back to settings credentials.")
            selected_api_key = settings.daytona_api_key
            selected_api_url = settings.daytona_api_base
            if not selected_api_key:
                raise HTTPException(status_code=500, detail="Hosting service is currently unavailable. Please contact an administrator.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in Daytona load balancer selection: {e}")
        # Final fallback
        selected_api_key = settings.daytona_api_key
        selected_api_url = settings.daytona_api_base
        if not selected_api_key:
            raise HTTPException(status_code=500, detail="Hosting service is currently unavailable. Please contact an administrator.")
            
    # 3. Create the hosted agent record (initially 'provisioning', step 0)
    agent_res = supabase.table("hosted_agents").insert({
        "account_id": account_id,
        "agent_name": body.agent_name,
        "status": "provisioning",
        "progress_step": 0,
        "progress_message": "Generating dedicated API key...",
        "api_key_id": api_key_id,
        "api_key_raw_encrypted": encrypted_raw_key,
        "model_name": body.model_name,
        "daytona_key_id": daytona_key_id
    }).execute()
    
    if not agent_res.data:
        # Revoke the API key if inserting hosted agent fails
        supabase.table("api_keys").update({"is_active": False}).eq("id", api_key_id).execute()
        raise HTTPException(status_code=500, detail="Failed to create hosted agent record")
        
    agent_id = agent_res.data[0]["id"]
    
    # 4. Trigger background task to provision Daytona VM and start OpenClaw
    base_url = settings.public_backend_url or str(request.base_url)
    gateway_url = f"{base_url.rstrip('/')}/v1"
    
    background_tasks.add_task(
        deploy_agent_background,
        agent_id=agent_id,
        agent_name=body.agent_name,
        account_id=account_id,
        raw_api_key=raw_api_key,
        model_name=body.model_name,
        gateway_url=gateway_url,
        daytona_key_id=daytona_key_id,
        daytona_api_key=selected_api_key,
        daytona_api_url=selected_api_url
    )
    
    return {
        "ok": True,
        "agent_id": agent_id,
        "status": "provisioning",
        "message": "Agent provisioning started in the background"
    }

@router.post("/{agent_id}/channels")
async def configure_channels(
    agent_id: str,
    request: Request,
    body: ConfigureChannelsRequest
):
    """Configure channels (Telegram, Discord) for a running agent."""
    account_id = _get_user_id(request)
    supabase = get_supabase()
    
    # 1. Fetch agent and verify ownership
    agent_res = supabase.table("hosted_agents").select("*").eq("id", agent_id).eq("account_id", account_id).execute()
    if not agent_res.data:
        raise HTTPException(status_code=404, detail="Hosted agent not found or access denied")
        
    agent = agent_res.data[0]
    
    if agent["status"] != "running":
        raise HTTPException(status_code=400, detail=f"Cannot configure channels while agent is in '{agent['status']}' state")
        
    # 2. Encrypt bot tokens before storing in database
    encrypted_tg_token = encrypt_key(body.telegram_bot_token) if body.telegram_bot_token else None
    encrypted_discord_token = encrypt_key(body.discord_bot_token) if body.discord_bot_token else None
    
    # Update DB columns
    supabase.table("hosted_agents").update({
        "telegram_enabled": body.telegram_enabled,
        "telegram_bot_token": encrypted_tg_token or agent.get("telegram_bot_token"),
        "telegram_allow_from": body.telegram_allow_from,
        "discord_enabled": body.discord_enabled,
        "discord_bot_token": encrypted_discord_token or agent.get("discord_bot_token"),
        "discord_guilds": body.discord_guilds,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", agent_id).execute()
    
    # 3. Decrypt the agent's dedicated API key
    raw_api_key = decrypt_key(agent["api_key_raw_encrypted"])
    
    # 4. Decrypt bot tokens for injecting into config
    tg_token = body.telegram_bot_token or (decrypt_key(agent["telegram_bot_token"]) if agent.get("telegram_bot_token") else "")
    discord_token = body.discord_bot_token or (decrypt_key(agent["discord_bot_token"]) if agent.get("discord_bot_token") else "")
    
    # 5. Build new config dictionary
    base_url = settings.public_backend_url or str(request.base_url)
    gateway_url = f"{base_url.rstrip('/')}/v1"
    config_dict = {
        "gateway": {
            "mode": "local",
            "auth": {
                "mode": "none"
            },
            "bind": "loopback"
        },
        "models": {
            "providers": {
                "akarouter": {
                    "baseUrl": gateway_url,
                    "apiKey": raw_api_key,
                    "api": "openai-completions",
                    "models": [
                        {"id": "akarouter-pro", "name": "AkaRouter Pro", "contextWindow": 128000},
                        {"id": "akarouter-flash", "name": "AkaRouter Flash", "contextWindow": 128000},
                        {"id": "akarouter-large", "name": "AkaRouter Large", "contextWindow": 128000}
                    ]
                }
            }
        },
        "agents": {
            "defaults": {
                "model": f"akarouter/{agent['model_name']}",
                "workspace": "/home/node/.openclaw/workspace"
            },
            "list": [
                {
                    "id": "main",
                    "name": f"{agent['agent_name']} Agent",
                    "identity": {
                        "name": f"{agent['agent_name']} Agent",
                        "theme": "helpful assistant",
                        "emoji": "🤖"
                    }
                }
            ]
        },
        "bindings": [],
        "channels": {}
    }
    
    if body.telegram_enabled and tg_token:
        # Convert allow_from comma-separated string to integer list
        allow_from_list = []
        if body.telegram_allow_from:
            for x in body.telegram_allow_from.split(","):
                x = x.strip()
                if x.isdigit():
                    allow_from_list.append(int(x))
                    
        config_dict["channels"]["telegram"] = {
            "enabled": True,
            "botToken": tg_token,
            "dmPolicy": "allowlist",
            "allowFrom": allow_from_list
        }
        config_dict["bindings"].append({
            "agentId": "main",
            "match": {
                "channel": "telegram"
            }
        })
        
    if body.discord_enabled and discord_token:
        config_dict["channels"]["discord"] = {
            "enabled": True,
            "token": discord_token,
            "groupPolicy": "allowlist",
            "guilds": body.discord_guilds or {}
        }
        config_dict["bindings"].append({
            "agentId": "main",
            "match": {
                "channel": "discord"
            }
        })
        
    # 6. Upload new config and restart gateway in sandbox
    try:
        sandbox_id = agent["sandbox_id"]
        dtn_key, dtn_url = _resolve_daytona_credentials(agent.get("daytona_key_id"))
        upload_openclaw_config(sandbox_id, config_dict, api_key=dtn_key, api_url=dtn_url)
        start_openclaw_gateway(sandbox_id, api_key=dtn_key, api_url=dtn_url)
        
        # Update health check timestamp
        supabase.table("hosted_agents").update({
            "last_health_check": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
    except Exception as e:
        logger.error(f"Failed to update config in sandbox {agent['sandbox_id']}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to apply configuration inside VM: {e}")
        
    return {"ok": True, "message": "Channels configured successfully"}

@router.delete("/{agent_id}")
async def destroy_agent(agent_id: str, request: Request):
    """Revoke API key, delete Daytona sandbox, and delete agent record."""
    account_id = _get_user_id(request)
    supabase = get_supabase()
    
    # 1. Fetch agent and verify ownership
    agent_res = supabase.table("hosted_agents").select("*").eq("id", agent_id).eq("account_id", account_id).execute()
    if not agent_res.data:
        raise HTTPException(status_code=404, detail="Hosted agent not found or access denied")
        
    agent = agent_res.data[0]
    
    # Set status to destroying in DB first
    supabase.table("hosted_agents").update({
        "status": "destroying",
        "updated_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", agent_id).execute()
    
    # 2. Revoke the API key
    if agent.get("api_key_id"):
        supabase.table("api_keys").update({"is_active": False}).eq("id", agent["api_key_id"]).execute()
        
    # 3. Delete the Daytona sandbox VM
    if agent.get("sandbox_id"):
        try:
            dtn_key, dtn_url = _resolve_daytona_credentials(agent.get("daytona_key_id"))
            delete_sandbox(agent["sandbox_id"], api_key=dtn_key, api_url=dtn_url)
        except Exception as e:
            logger.error(f"Error deleting sandbox {agent['sandbox_id']} during destruction: {e}")
            # Continue deletion even if sandbox delete fails to avoid orphaned database records
            
    # 4. Delete agent record from Supabase
    supabase.table("hosted_agents").delete().eq("id", agent_id).execute()
    
    return {"ok": True, "message": "Agent destroyed successfully"}

@router.get("/{agent_id}/logs")
async def get_agent_logs(agent_id: str, request: Request, lines: int = 100):
    """Retrieve runtime logs from the agent gateway inside the sandbox."""
    account_id = _get_user_id(request)
    supabase = get_supabase()
    
    # Verify ownership
    agent_res = supabase.table("hosted_agents").select("sandbox_id, status, daytona_key_id").eq("id", agent_id).eq("account_id", account_id).execute()
    if not agent_res.data:
        raise HTTPException(status_code=404, detail="Hosted agent not found or access denied")
        
    agent = agent_res.data[0]
    if agent["status"] != "running" or not agent.get("sandbox_id"):
        return {"logs": f"Agent is in '{agent['status']}' state. Logs are only available for running agents."}
        
    try:
        dtn_key, dtn_url = _resolve_daytona_credentials(agent.get("daytona_key_id"))
        logs = get_openclaw_logs(agent["sandbox_id"], lines=lines, api_key=dtn_key, api_url=dtn_url)
        return {"logs": logs}
    except Exception as e:
        logger.error(f"Failed to fetch logs for agent {agent_id}: {e}")
        return {"logs": f"Error fetching logs from VM: {str(e)}"}
