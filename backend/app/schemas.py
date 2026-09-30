"""Pydantic 请求/响应模型。"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class MessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: datetime
    parent_id: Optional[str] = None

    model_config = {"from_attributes": True}


class SessionCreate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None


class SessionOut(BaseModel):
    id: str
    title: str
    model: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SessionDetail(SessionOut):
    messages: List[MessageOut] = Field(default_factory=list)


class ChatRequest(BaseModel):
    content: str = Field(..., min_length=1)
    model: Optional[str] = None


class EditMessageRequest(BaseModel):
    content: str = Field(..., min_length=1)
    model: Optional[str] = None


class RegenerateRequest(BaseModel):
    model: Optional[str] = None


class SettingsOut(BaseModel):
    default_model: str
    available_models: List[str]
    base_url_configured: bool
