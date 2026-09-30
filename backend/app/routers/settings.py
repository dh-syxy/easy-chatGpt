"""可读配置接口（不暴露 API Key）。"""

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
async def get_app_settings() -> SettingsOut:
    settings = get_settings()
    key = settings.openai_api_key or ""
    configured = bool(key) and not key.startswith("sk-your-")
    return SettingsOut(
        default_model=settings.openai_default_model,
        available_models=settings.available_model_list,
        base_url_configured=bool(settings.openai_base_url),
    )
