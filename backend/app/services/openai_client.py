"""CloseAI / OpenAI 兼容接口的流式客户端（仅 /v1/responses）。"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import Settings


class OpenAIClientError(Exception):
    """上游 API 调用失败。"""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _auth_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }


def _timeout() -> httpx.Timeout:
    return httpx.Timeout(connect=30.0, read=600.0, write=30.0, pool=30.0)


def _messages_to_responses_input(
    messages: list[dict[str, str]],
) -> list[dict[str, str]]:
    """将会话消息转为 Responses API 的 input 列表。"""
    items: list[dict[str, str]] = []
    for m in messages:
        role = m.get("role") or "user"
        if role not in ("user", "assistant", "system", "developer"):
            role = "user"
        content = m.get("content") or ""
        if not content:
            continue
        items.append({"role": role, "content": content})
    return items


def _extract_responses_text_delta(event: dict[str, Any]) -> str | None:
    """从 Responses SSE 事件中提取可见文本增量。"""
    etype = event.get("type") or ""

    if etype == "response.output_text.delta":
        delta = event.get("delta")
        return delta if isinstance(delta, str) and delta else None

    if etype.endswith("output_text.delta") or etype.endswith("text.delta"):
        delta = event.get("delta")
        if isinstance(delta, str) and delta:
            return delta

    delta_obj = event.get("delta")
    if isinstance(delta_obj, dict):
        text = delta_obj.get("text") or delta_obj.get("content")
        if isinstance(text, str) and text:
            return text

    return None


async def stream_model_reply(
    settings: Settings,
    *,
    model: str,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    """
    调用 /v1/responses 流式产出文本。
    内置 web_search 工具，tool_choice=auto：由模型按需决定是否联网。
    """
    url = settings.openai_base_url.rstrip("/") + "/responses"
    payload: dict[str, Any] = {
        "model": model,
        "input": _messages_to_responses_input(messages),
        "tools": [{"type": "web_search"}],
        "tool_choice": "auto",
        "stream": True,
        "instructions": (
            "You can use web search when up-to-date or external information is needed. "
            "Do not search for simple questions you can answer confidently without it. "
            "When searching, prefer authoritative sources and cite URLs when available."
        ),
    }

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        async with client.stream(
            "POST", url, headers=_auth_headers(settings), json=payload
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()
                detail = body.decode("utf-8", errors="replace")
                raise OpenAIClientError(
                    f"上游接口错误 {response.status_code}: {detail}",
                    status_code=response.status_code,
                )

            async for line in response.aiter_lines():
                if not line or line.startswith(":") or line.startswith("event:"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue
                text = _extract_responses_text_delta(event)
                if text:
                    yield text
