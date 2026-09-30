"""会话 CRUD 与导出路由。"""

from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db import get_db
from app.models import Session
from app.schemas import SessionCreate, SessionDetail, SessionOut, SessionUpdate
from app.services import export_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _content_disposition(filename: str) -> str:
    """同时兼容 ASCII fallback 与 UTF-8 文件名。"""
    ascii_name = filename.encode("ascii", "ignore").decode("ascii") or "chat"
    encoded = quote(filename)
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


@router.get("", response_model=list[SessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db)) -> list[Session]:
    result = await db.execute(select(Session).order_by(Session.updated_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=SessionOut)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
) -> Session:
    settings = get_settings()
    session = Session(
        title=body.title or "新对话",
        model=body.model or settings.openai_default_model,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> Session:
    result = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.messages))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session


@router.patch("/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: str,
    body: SessionUpdate,
    db: AsyncSession = Depends(get_db),
) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if body.title is not None:
        session.title = body.title
    if body.model is not None:
        session.model = body.model
    session.updated_at = _utcnow()
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    await db.delete(session)
    await db.commit()
    return {"ok": True}


@router.get("/{session_id}/export")
async def export_session(
    session_id: str,
    format: str = Query("docx", pattern="^(docx|pdf)$"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """导出当前会话全部消息为 Word 或 PDF。"""
    result = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.messages))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    messages = list(session.messages or [])
    base_name = export_service.sanitize_filename(session.title)

    if format == "pdf":
        data = export_service.build_pdf(session, messages)
        filename = f"{base_name}.pdf"
        media_type = "application/pdf"
    else:
        data = export_service.build_docx(session, messages)
        filename = f"{base_name}.docx"
        media_type = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": _content_disposition(filename)},
    )
