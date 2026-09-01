"""
Tool registry for the agentic workflow executor.

Each tool is defined with:
  - An OpenAI-compatible JSON schema (function definition)
  - An async handler that executes the tool and returns a result dict

The agent loop passes these definitions to the LLM so it can decide
which tool to call, with what arguments, at each reasoning step.
"""

from typing import Any, Callable, Awaitable
import json
import os

import httpx


ToolHandler = Callable[[dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]]


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "http_request",
            "description": (
                "Make an HTTP request to any URL. Use for calling external APIs, "
                "fetching data, or sending webhooks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The full URL to request",
                    },
                    "method": {
                        "type": "string",
                        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"],
                        "description": "HTTP method (defaults to GET)",
                    },
                    "headers": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": "Optional request headers",
                    },
                    "body": {
                        "type": "string",
                        "description": "Optional JSON request body as a string",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "slack_send_message",
            "description": "Send a message to a Slack channel.",
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "string",
                        "description": "Slack channel (e.g. #general)",
                    },
                    "text": {
                        "type": "string",
                        "description": "Message text to send",
                    },
                },
                "required": ["channel", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "store_data",
            "description": (
                "Persist structured data to the per-run workflow context. "
                "Use when you need to save extracted fields, classifications, or results."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Storage key / label for the data",
                    },
                    "data": {
                        "type": "object",
                        "description": "The structured data to store",
                    },
                },
                "required": ["key", "data"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_memory",
            "description": (
                "Search the tenant's long-term memory for relevant prior context, "
                "past workflow results, or stored knowledge."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language search query",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max number of results (default 5)",
                    },
                },
                "required": ["query"],
            },
        },
    },
]


def _parse_headers(headers: Any) -> dict[str, str]:
    if not headers:
        return {}
    if isinstance(headers, str):
        try:
            parsed = json.loads(headers)
        except (json.JSONDecodeError, TypeError):
            return {}
        headers = parsed
    if not isinstance(headers, dict):
        return {}
    return {str(k): str(v) for k, v in headers.items()}


async def handle_http_request(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    url = args["url"]
    method = args.get("method", "GET").upper()
    headers = _parse_headers(args.get("headers"))
    body = args.get("body")

    json_body = None
    if body:
        try:
            json_body = json.loads(body) if isinstance(body, str) else body
        except (json.JSONDecodeError, TypeError):
            json_body = None

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.request(
            method=method,
            url=url,
            headers=headers,
            json=json_body if json_body is not None else None,
            content=body if json_body is None and isinstance(body, str) else None,
        )

    return {
        "status_code": response.status_code,
        "headers": dict(response.headers),
        "body": response.text[:4000],
    }


async def handle_slack_send_message(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    tools_ctx = ctx.get("tools") or {}
    slack_ctx = tools_ctx.get("slack") or {}
    bot_token = slack_ctx.get("botToken") or os.environ.get("SLACK_BOT_TOKEN")

    if not bot_token:
        raise RuntimeError(
            "Slack bot token not configured. "
            "Connect Slack in Integrations or set SLACK_BOT_TOKEN."
        )

    channel = args["channel"]
    text = args["text"]

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://slack.com/api/chat.postMessage",
            headers={
                "Authorization": f"Bearer {bot_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            json={"channel": channel, "text": text},
        )

    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Slack API error: {data.get('error')}")

    return {"channel": channel, "ts": data.get("ts"), "ok": True}


async def handle_store_data(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    key = args["key"]
    data = args["data"]
    stored = ctx.setdefault("stored_data", {})
    stored[key] = data
    return {"stored": True, "key": key}


async def handle_search_memory(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    from .memory import MemoryManager

    query_text = args["query"]
    limit = args.get("limit", 5)
    tenant_id = ctx.get("tenant_id", "")

    manager = MemoryManager()
    results = await manager.search(tenant_id=tenant_id, query=query_text, limit=limit)
    return {"results": results}


TOOL_HANDLERS: dict[str, ToolHandler] = {
    "http_request": handle_http_request,
    "slack_send_message": handle_slack_send_message,
    "store_data": handle_store_data,
    "search_memory": handle_search_memory,
}


async def execute_tool_call(
    tool_name: str, arguments: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return {"error": f"Unknown tool: {tool_name}"}
    return await handler(arguments, ctx)


def get_tool_definitions(
    allowed_tools: list[str] | None = None,
) -> list[dict[str, Any]]:
    if allowed_tools is None:
        return TOOL_DEFINITIONS
    return [
        td
        for td in TOOL_DEFINITIONS
        if td["function"]["name"] in allowed_tools
    ]
