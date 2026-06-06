from fastapi import FastAPI
from fastapi.responses import JSONResponse
from app.api import chat, health, models

app = FastAPI(
    title="AKAROUTER",
    description="Multi-account AI inference proxy with round-robin routing",
    version="0.1.0",
)


app.include_router(health.router)
app.include_router(models.router)
app.include_router(chat.router)


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse({"service": "akarouter", "status": "ok", "docs": "/docs"})
