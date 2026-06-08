#!/bin/bash
# Output the current valid Nous access token
cd "$(dirname "$0")"
python3 refresh_token.py 2>/dev/null | tail -1
