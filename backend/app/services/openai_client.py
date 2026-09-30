"""CloseAI / OpenAI 兼容接口的流式客户端。"""

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


async def stream_chat_completion(
    settings: Settings,
    *,
    model: str,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    """
    调用 chat/completions 流式接口，逐步产出文本 delta。
    客户端断开或取消时应取消本生成器。
    """
    url = settings.openai_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
    }

    timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code >= 400:
                body = await response.aread()
                detail = body.decode("utf-8", errors="replace")
                raise OpenAIClientError(
                    f"上游接口错误 {response.status_code}: {detail}",
                    status_code=response.status_code,
                )

            async for line in response.aiter_lines():
                if not line:
                    continue
                if line.startswith(":"):
                    # SSE 注释行
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content
