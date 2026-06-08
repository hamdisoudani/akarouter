#!/bin/bash
# Hermes proxy watchdog - restart if dead
# Hermes proxy handles both proxying AND token refresh

LOG="/tmp/nous_watchdog.log"
PORT=18888

log() {
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') - $1" >> "$LOG"
}

PROXY_ALIVE=0
if curl -s -o /dev/null -w "" --connect-timeout 3 --max-time 5 http://127.0.0.1:$PORT/v1/models > /dev/null 2>&1; then
    PROXY_ALIVE=1
fi

if [ $PROXY_ALIVE -eq 0 ]; then
    log "Hermes proxy not responding, restarting via systemd..."
    sudo systemctl restart hermes-proxy 2>/dev/null
    sleep 3
    if curl -s -o /dev/null -w "" --connect-timeout 3 --max-time 5 http://127.0.0.1:$PORT/v1/models > /dev/null 2>&1; then
        log "Hermes proxy restarted OK"
    else
        log "Hermes proxy FAILED to restart!"
    fi
fi
