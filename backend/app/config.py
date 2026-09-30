"""应用配置：从环境变量加载 CloseAI / 服务相关设置。"""

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

# 优先读取项目根目录 .env，其次当前工作目录
_ROOT = Path(__file__).resolve().parents[2]
_ENV_CANDIDATES = (
    _ROOT / ".env",
    Path.cwd() / ".env",
    Path.cwd().parent / ".env",
)


def _env_files() -> tuple[str, ...]:
    files = [str(p) for p in _ENV_CANDIDATES if p.is_file()]
    return tuple(files) if files else (".env",)


class Settings(BaseSettings):
    """全局配置项。"""

    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = "sk-your-closeai-api-key"
    openai_base_url: str = "https://api.closeai-asia.com/v1"
    openai_default_model: str = "gpt-4o-mini"
    openai_available_models: str = "gpt-4o-mini,gpt-4o,gpt-4.1"

    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    # 相对 backend 工作目录；启动时会确保目录存在
    database_url: str = "sqlite+aiosqlite:///./data/chat.db"

    # 上下文消息条数上限（含 system 以外的 user/assistant）
    max_context_messages: int = 40

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def available_model_list(self) -> List[str]:
        models = [m.strip() for m in self.openai_available_models.split(",") if m.strip()]
        if self.openai_default_model and self.openai_default_model not in models:
            models.insert(0, self.openai_default_model)
        return models


@lru_cache
def get_settings() -> Settings:
    return Settings()
