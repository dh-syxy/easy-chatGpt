"""流式聊天相关路由。

数据库会话由 chat_service 在短事务内自行管理，路由层不再持有 DB 连接。
"""

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.schemas import ChatRequest, EditMessageRequest, RegenerateRequest
from app.services import chat_service

router = APIRouter(prefix="/sessions", tags=["chat"])


def _sse_response(generator) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{session_id}/chat")
async def chat(
    session_id: str,
    body: ChatRequest,
    request: Request,
):
    async def event_gen():
        async for chunk in chat_service.chat_stream(
            session_id, body.content, body.model
        ):
            if await request.is_disconnected():
                break
            yield chunk

    return _sse_response(event_gen())


@router.post("/{session_id}/messages/{message_id}/edit")
async def edit_message(
    session_id: str,
    message_id: str,
    body: EditMessageRequest,
    request: Request,
):
    async def event_gen():
        async for chunk in chat_service.edit_and_regenerate_stream(
            session_id, message_id, body.content, body.model
        ):
            if await request.is_disconnected():
                break
            yield chunk

    return _sse_response(event_gen())


@router.post("/{session_id}/messages/{message_id}/regenerate")
async def regenerate(
    session_id: str,
    message_id: str,
    body: RegenerateRequest,
    request: Request,
):
    async def event_gen():
        async for chunk in chat_service.regenerate_stream(
            session_id, message_id, body.model
        ):
            if await request.is_disconnected():
                break
            yield chunk

    return _sse_response(event_gen())
