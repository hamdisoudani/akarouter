import logging
import json
import base64
from typing import Dict, Any, Optional
from daytona import Daytona, DaytonaConfig, CreateSandboxFromImageParams, Resources
from app.core.config import settings

logger = logging.getLogger(__name__)

def get_daytona_client(api_key: Optional[str] = None, api_url: Optional[str] = None) -> Daytona:
    """Initialize and return the Daytona client using parameters or fallback settings."""
    key = api_key or settings.daytona_api_key
    url = api_url or settings.daytona_api_base
    if not key:
        raise RuntimeError("Daytona API key is not configured")
    config = DaytonaConfig(
        api_key=key,
        api_url=url
    )
    return Daytona(config)

def create_sandbox(
    agent_name: str,
    cpu: Optional[int] = None,
    memory: Optional[int] = None,
    api_key: Optional[str] = None,
    api_url: Optional[str] = None
) -> str:
    """
    Create a new Daytona sandbox for OpenClaw.
    Returns the sandbox ID.
    """
    target_cpu = cpu or settings.daytona_sandbox_cpu
    target_ram = memory or settings.daytona_sandbox_memory
    logger.info(f"Creating Daytona sandbox for agent: {agent_name} ({target_cpu} CPU, {target_ram}GB RAM)")
    client = get_daytona_client(api_key, api_url)
    
    # We use a standard javascript/node image as base
    image_name = "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm"
    
    # Define resource limits
    resources = Resources(
        cpu=target_cpu,
        memory=target_ram,
        disk=settings.daytona_sandbox_disk
    )
    
    params = CreateSandboxFromImageParams(
        name=f"openclaw-{agent_name.lower().replace(' ', '-')}",
        image=image_name,
        resources=resources,
        auto_stop_interval=0
    )
    
    # Create the sandbox (this waits for it to provision and start)
    sandbox = client.create(params)
    logger.info(f"Daytona sandbox created successfully. ID: {sandbox.id}")
    return sandbox.id

def delete_sandbox(sandbox_id: str, api_key: Optional[str] = None, api_url: Optional[str] = None) -> None:
    """Delete a Daytona sandbox."""
    logger.info(f"Deleting Daytona sandbox: {sandbox_id}")
    client = get_daytona_client(api_key, api_url)
    try:
        sandbox = client.get(sandbox_id)
        client.delete(sandbox)
        logger.info(f"Daytona sandbox deleted successfully: {sandbox_id}")
    except Exception as e:
        logger.error(f"Failed to delete Daytona sandbox {sandbox_id}: {e}")
        # Propagate error if we want to ensure cleanup status
        raise

def exec_command(
    sandbox_id: str,
    command: str,
    timeout: Optional[int] = None,
    api_key: Optional[str] = None,
    api_url: Optional[str] = None
) -> tuple[int, str]:
    """Execute a command inside the Daytona sandbox."""
    client = get_daytona_client(api_key, api_url)
    sandbox = client.get(sandbox_id)
    logger.debug(f"Executing command in sandbox {sandbox_id}: {command}")
    resp = sandbox.process.exec(command, timeout=timeout)
    return resp.exit_code, resp.result

def install_openclaw(sandbox_id: str, api_key: Optional[str] = None, api_url: Optional[str] = None) -> None:
    """Install OpenClaw globally inside the sandbox after upgrading Node.js."""
    logger.info(f"Upgrading Node.js inside sandbox: {sandbox_id}")
    
    # Upgrade Node using global 'n' package manager to Node 22 (requires v22.19+ for OpenClaw)
    exec_command(sandbox_id, "sudo npm install -g n", timeout=120, api_key=api_key, api_url=api_url)
    exit_code, output = exec_command(sandbox_id, "sudo /usr/local/share/npm-global/bin/n 22", timeout=300, api_key=api_key, api_url=api_url)
    if exit_code != 0:
        # Try fallback path just in case
        exec_command(sandbox_id, "sudo n 22", timeout=300, api_key=api_key, api_url=api_url)
        
    logger.info(f"Installing OpenClaw globally in sandbox: {sandbox_id}")
    exit_code, output = exec_command(sandbox_id, "npm install -g openclaw@latest", timeout=300, api_key=api_key, api_url=api_url)
    if exit_code != 0:
        logger.warning(f"Global npm install failed (code {exit_code}), trying with sudo: {output}")
        exit_code, output = exec_command(sandbox_id, "sudo npm install -g openclaw@latest", timeout=300, api_key=api_key, api_url=api_url)
        if exit_code != 0:
            raise RuntimeError(f"Failed to install openclaw globally: {output}")
    logger.info("OpenClaw installed successfully")

def upload_openclaw_config(
    sandbox_id: str,
    config_dict: Dict[str, Any],
    api_key: Optional[str] = None,
    api_url: Optional[str] = None
) -> None:
    """Upload the openclaw.json config dictionary into the sandbox."""
    logger.info(f"Uploading OpenClaw config to sandbox: {sandbox_id}")
    client = get_daytona_client(api_key, api_url)
    sandbox = client.get(sandbox_id)
    
    config_json = json.dumps(config_dict, indent=2)
    
    # Ensure both config directories exist
    exec_command(sandbox_id, "mkdir -p /home/node/.openclaw /root/.openclaw", api_key=api_key, api_url=api_url)
    
    # Upload to /home/node/.openclaw/openclaw.json and set owner to node
    try:
        sandbox.fs.upload_file(config_json.encode("utf-8"), "/home/node/.openclaw/openclaw.json")
        exec_command(sandbox_id, "chown -R node:node /home/node/.openclaw", api_key=api_key, api_url=api_url)
    except Exception as e:
        logger.warning(f"Failed to upload config to /home/node/.openclaw/openclaw.json: {e}")
        
    # Upload to /root/.openclaw/openclaw.json
    try:
        sandbox.fs.upload_file(config_json.encode("utf-8"), "/root/.openclaw/openclaw.json")
    except Exception as e:
        logger.warning(f"Failed to upload config to /root/.openclaw/openclaw.json: {e}")

def start_openclaw_gateway(sandbox_id: str, api_key: Optional[str] = None, api_url: Optional[str] = None) -> None:
    """Start the OpenClaw gateway daemon inside the sandbox."""
    logger.info(f"Starting OpenClaw gateway inside sandbox: {sandbox_id}")
    
    # Kill any existing instance first
    exec_command(sandbox_id, "pkill -f openclaw", api_key=api_key, api_url=api_url)
    
    # Start openclaw gateway in the background using nohup
    exit_code, output = exec_command(sandbox_id, "nohup openclaw gateway run --allow-unconfigured --auth none --bind loopback > /tmp/openclaw.log 2>&1 &", api_key=api_key, api_url=api_url)
    if exit_code != 0:
        raise RuntimeError(f"Failed to start openclaw gateway daemon: {output}")
        
    logger.info("OpenClaw gateway daemon started successfully")

def get_openclaw_logs(
    sandbox_id: str,
    lines: int = 100,
    api_key: Optional[str] = None,
    api_url: Optional[str] = None
) -> str:
    """Retrieve the latest logs of the OpenClaw gateway."""
    exit_code, output = exec_command(sandbox_id, f"tail -n {lines} /tmp/openclaw.log", api_key=api_key, api_url=api_url)
    if exit_code != 0:
        return f"Could not retrieve logs: {output}"
    return output
