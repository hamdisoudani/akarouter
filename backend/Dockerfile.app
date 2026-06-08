FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Force env vars explicitly so runtime always picks up Railway envs
ENV AKAROUTER_APP_ENV=production
ENV AKAROUTER_PORT=8000
ENV AKAROUTER_NOUS_API_BASE=https://inference-api.nousresearch.com/v1
ENV AKAROUTER_NOUS_CLIENT_ID=hermes-cli
ENV AKAROUTER_NOUS_SCOPE=inference:invoke
ENV AKAROUTER_NOUS_DEVICE_CODE_URL=https://portal.nousresearch.com/api/oauth/device/code
ENV AKAROUTER_NOUS_TOKEN_URL=https://portal.nousresearch.com/api/oauth/token
ENV AKAROUTER_TOKEN_REFRESH_SKEW=120
ENV AKAROUTER_REFRESH_LOCK_TTL=30
ENV AKAROUTER_MAX_CONCURRENT_PER_ACCOUNT=12
EXPOSE 8000
CMD ["sh", "start.sh"]
