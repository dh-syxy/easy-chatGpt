"""聊天业务：组装上下文、落库、流式转发。

流式过程中不跨 yield 持有同一个 AsyncSession（避免 Starlette 任务组
与 SQLite 连接生命周期冲突导致 no active connection）。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings, get_settings
from app.db import AsyncSessionLocal
from app.models import Message, Session
from app.services.openai_client import OpenAIClientError, stream_chat_completion


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def make_title_from_content(content: str, max_len: int = 20) -> str:
    """用首条用户消息生成会话标题。"""
    text = " ".join(content.strip().split())
    if not text:
        return "新对话"
    return text if len(text) <= max_len else text[:max_len] + "…"


async def get_session_or_none(db: AsyncSession, session_id: str) -> Session | None:
    result = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.messages))
    )
    return result.scalar_one_or_none()


async def list_messages_ordered(db: AsyncSession, session_id: str) -> list[Message]:
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    return list(result.scalars().all())


def build_context_messages(
    messages: list[Message],
    max_count: int,
) -> list[dict[str, str]]:
    """按条数截断上下文，保留最近 max_count 条。"""
    trimmed = messages[-max_count:] if len(messages) > max_count else messages
    return [{"role": m.role, "content": m.content} for m in trimmed if m.content]


async def _prepare_assistant_reply(
    session_id: str,
    *,
    model: str | None = None,
    settings: Settings | None = None,
) -> tuple[str, str, list[dict[str, str]]] | None:
    """
    短事务：更新会话模型、读取上下文、创建空的 assistant 消息。
    返回 (assistant_message_id, use_model, context)；会话不存在则返回 None。
    """
    settings = settings or get_settings()
    async with AsyncSessionLocal() as db:
        session = await get_session_or_none(db, session_id)
        if not session:
            return None

        use_model = model or session.model or settings.openai_default_model
        session.model = use_model
        session.updated_at = _utcnow()

        history = await list_messages_ordered(db, session.id)
        context = build_context_messages(history, settings.max_context_messages)

        assistant = Message(
            session_id=session.id,
            role="assistant",
            content="",
        )
        db.add(assistant)
        await db.commit()
        await db.refresh(assistant)
        return assistant.id, use_model, context


async def _finalize_assistant_message(message_id: str, content: str) -> None:
    """短事务：写入助手消息最终内容并刷新会话时间。"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Message).where(Message.id == message_id))
        msg = result.scalar_one_or_none()
        if not msg:
            return
        msg.content = content
        session_result = await db.execute(
            select(Session).where(Session.id == msg.session_id)
        )
        session = session_result.scalar_one_or_none()
        if session:
            session.updated_at = _utcnow()
        await db.commit()


async def stream_assistant_reply(
    session_id: str,
    *,
    model: str | None = None,
    settings: Settings | None = None,
) -> AsyncIterator[str]:
    """基于当前会话已落库消息流式生成 assistant 回复，并落库。"""
    settings = settings or get_settings()
    prepared = await _prepare_assistant_reply(
        session_id, model=model, settings=settings
    )
    if prepared is None:
        yield _sse({"type": "error", "message": "会话不存在"})
        return

    assistant_id, use_model, context = prepared
    yield _sse({"type": "meta", "message_id": assistant_id, "model": use_model})

    full_text: list[str] = []
    finished_ok = False

    try:
        async for delta in stream_chat_completion(
            settings,
            model=use_model,
            messages=context,
        ):
            full_text.append(delta)
            yield _sse({"type": "delta", "content": delta})
        finished_ok = True
    except OpenAIClientError as exc:
        if not full_text:
            full_text.append(f"[错误] {exc}")
        yield _sse(
            {"type": "error", "message": str(exc), "message_id": assistant_id}
        )
    except Exception as exc:  # noqa: BLE001
        yield _sse(
            {"type": "error", "message": str(exc), "message_id": assistant_id}
        )
    finally:
        try:
            await _finalize_assistant_message(assistant_id, "".join(full_text))
        except Exception:  # noqa: BLE001
            pass

    if finished_ok:
        yield _sse({"type": "done", "message_id": assistant_id})


async def chat_stream(
    session_id: str,
    content: str,
    model: str | None = None,
) -> AsyncIterator[str]:
    """用户发送新消息并流式回复。"""
    async with AsyncSessionLocal() as db:
        session = await get_session_or_none(db, session_id)
        if not session:
            yield _sse({"type": "error", "message": "会话不存在"})
            return

        existing = await list_messages_ordered(db, session_id)
        db.add(Message(session_id=session_id, role="user", content=content))
        if not existing or (session.title in ("新对话", "New chat", "")):
            session.title = make_title_from_content(content)
        session.updated_at = _utcnow()
        if model:
            session.model = model
        await db.commit()

    async for chunk in stream_assistant_reply(session_id, model=model):
        yield chunk


async def edit_and_regenerate_stream(
    session_id: str,
    message_id: str,
    content: str,
    model: str | None = None,
) -> AsyncIterator[str]:
    """编辑用户消息：截断后续、更新内容、重新流式生成。"""
    async with AsyncSessionLocal() as db:
        session = await get_session_or_none(db, session_id)
        if not session:
            yield _sse({"type": "error", "message": "会话不存在"})
            return

        result = await db.execute(
            select(Message).where(
                Message.id == message_id, Message.session_id == session_id
            )
        )
        target = result.scalar_one_or_none()
        if not target:
            yield _sse({"type": "error", "message": "消息不存在"})
            return
        if target.role != "user":
            yield _sse({"type": "error", "message": "只能编辑用户消息"})
            return

        remaining = await list_messages_ordered(db, session_id)
        to_delete_ids: list[str] = []
        found = False
        for m in remaining:
            if m.id == target.id:
                found = True
                continue
            if found:
                to_delete_ids.append(m.id)
        if to_delete_ids:
            await db.execute(delete(Message).where(Message.id.in_(to_delete_ids)))

        target.content = content
        session.updated_at = _utcnow()
        if model:
            session.model = model
        all_msgs = [
            m for m in remaining if m.id == target.id or m.id not in set(to_delete_ids)
        ]
        user_msgs = [m for m in all_msgs if m.role == "user"]
        if user_msgs and user_msgs[0].id == target.id:
            session.title = make_title_from_content(content)
        await db.commit()

    async for chunk in stream_assistant_reply(session_id, model=model):
        yield chunk


async def regenerate_stream(
    session_id: str,
    message_id: str,
    model: str | None = None,
) -> AsyncIterator[str]:
    """删除指定 assistant 消息及其后消息，重新生成。"""
    async with AsyncSessionLocal() as db:
        session = await get_session_or_none(db, session_id)
        if not session:
            yield _sse({"type": "error", "message": "会话不存在"})
            return

        result = await db.execute(
            select(Message).where(
                Message.id == message_id, Message.session_id == session_id
            )
        )
        target = result.scalar_one_or_none()
        if not target:
            yield _sse({"type": "error", "message": "消息不存在"})
            return
        if target.role != "assistant":
            yield _sse({"type": "error", "message": "只能重新生成助手消息"})
            return

        remaining = await list_messages_ordered(db, session_id)
        to_delete_ids: list[str] = []
        found = False
        for m in remaining:
            if m.id == target.id:
                found = True
            if found:
                to_delete_ids.append(m.id)

        if to_delete_ids:
            await db.execute(delete(Message).where(Message.id.in_(to_delete_ids)))
        session.updated_at = _utcnow()
        if model:
            session.model = model
        await db.commit()

    async for chunk in stream_assistant_reply(session_id, model=model):
        yield chunk
