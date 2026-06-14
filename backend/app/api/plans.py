from fastapi import APIRouter
from app.core.supabase import get_supabase

router = APIRouter(prefix="/v1/plans")

@router.get("")
async def get_plans():
    supabase = get_supabase()
    result = supabase.table("plan_presets").select("*").order("tier").execute()
    return {"plans": result.data or []}
