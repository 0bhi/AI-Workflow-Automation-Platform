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
                "Persist structured data to the workflow context / database. "
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
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": "Create a support / issue ticket in the integrated system.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Ticket title"},
                    "description": {
                        "type": "string",
                        "description": "Ticket body / description",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                        "description": "Ticket priority",
                    },
                    "assignee": {
                        "type": "string",
                        "description": "User or team to assign to (optional)",
                    },
                },
                "required": ["title", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_fields",
            "description": (
                "Extract structured fields from unstructured text or documents. "
                "Returns a JSON object with the requested fields."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The source text to extract from",
                    },
                    "fields": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Field names to extract",
                    },
                },
                "required": ["text", "fields"],
            },
        },
    },
]


async def handle_http_request(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    url = args["url"]
    method = args.get("method", "GET").upper()
    headers = args.get("headers") or {}
    body = args.get("body")

    json_body = None
    if body:
        try:
            json_body = json.loads(body)
        except (json.JSONDecodeError, TypeError):
            pass

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.request(
            method=method,
            url=url,
            headers=headers,
            json=json_body if json_body is not None else None,
            content=body if json_body is None and body else None,
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
            "Set SLACK_BOT_TOKEN or provide tools_context.slack.botToken."
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


async def handle_create_ticket(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    import uuid

    ticket_id = f"TICKET-{uuid.uuid4().hex[:8].upper()}"
    return {
        "ticket_id": ticket_id,
        "title": args["title"],
        "description": args["description"],
        "priority": args.get("priority", "medium"),
        "assignee": args.get("assignee"),
        "status": "open",
    }


async def handle_extract_fields(
    args: dict[str, Any], ctx: dict[str, Any]
) -> dict[str, Any]:
    return {
        "source_length": len(args.get("text", "")),
        "requested_fields": args.get("fields", []),
        "note": "Field extraction delegated to the agent's reasoning.",
    }


TOOL_HANDLERS: dict[str, ToolHandler] = {
    "http_request": handle_http_request,
    "slack_send_message": handle_slack_send_message,
    "store_data": handle_store_data,
    "search_memory": handle_search_memory,
    "create_ticket": handle_create_ticket,
    "extract_fields": handle_extract_fields,
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
