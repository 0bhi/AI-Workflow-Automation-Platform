"""
DAG executor with a real agentic tool-calling loop.

Each agent node runs an iterative loop where the LLM can:
  1. Decide which tool to call
  2. Receive the tool result
  3. Continue reasoning or produce a final answer

This replaces the old single-shot completion approach.
"""

from typing import Any, Callable, Awaitable
import json
import logging
import os

import httpx
from openai import AsyncOpenAI

from .planner import DagSnapshot, DagNode, DagEdge, build_execution_plan
from .tools import TOOL_DEFINITIONS, execute_tool_call, get_tool_definitions
from .safe_eval import safe_eval_condition
from .memory import MemoryManager

logger = logging.getLogger(__name__)

NODE_BACKEND_URL = os.environ.get("NODE_BACKEND_URL", "http://localhost:4000")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
MAX_AGENT_ITERATIONS = int(os.environ.get("MAX_AGENT_ITERATIONS", "15"))

_openai_client: AsyncOpenAI | None = None
_memory_manager: MemoryManager | None = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured for agent execution")
        _openai_client = AsyncOpenAI(api_key=api_key)
    return _openai_client


def _get_memory_manager() -> MemoryManager:
    global _memory_manager
    if _memory_manager is None:
        _memory_manager = MemoryManager()
    return _memory_manager


class StepUpdateSender:
    """Send step updates back to the Node backend."""

    async def send_update(self, payload: dict[str, Any]) -> None:
        run_id = payload["run_id"]
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                await client.post(
                    f"{NODE_BACKEND_URL}/internal/workflow-runs/{run_id}/steps",
                    json=payload,
                )
            except Exception:
                return None


ExecutionFn = Callable[[DagNode, dict[str, Any]], Awaitable[dict[str, Any]]]


# ---------------------------------------------------------------------------
# Node executors
# ---------------------------------------------------------------------------


async def _execute_trigger(node: DagNode, ctx: dict[str, Any]) -> dict[str, Any]:
    return {"type": "trigger", "node": node["id"], "input": ctx.get("input")}


async def _execute_agent(node: DagNode, ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Execute an agent node with a full tool-calling loop.

    The LLM receives available tools as function definitions. At each step it
    can choose to call a tool or produce a final answer. The loop continues
    until the model stops calling tools or hits MAX_AGENT_ITERATIONS.
    """
    client = _get_openai_client()
    memory = _get_memory_manager()

    cfg = node.get("config", {}) or {}
    model = cfg.get("model", OPENAI_MODEL)
    system_prompt = cfg.get(
        "system_prompt",
        "You are an AI assistant executing a node inside an automation workflow. "
        "Use the available tools to accomplish the task. When you have the final "
        "result, respond with a clear answer without calling any more tools.",
    )
    temperature = float(cfg.get("temperature", 0.2))
    max_iterations = int(cfg.get("max_iterations", MAX_AGENT_ITERATIONS))
    allowed_tools: list[str] | None = cfg.get("allowed_tools")

    user_input = ctx.get("current_output") or ctx.get("input") or {}
    if not isinstance(user_input, str):
        try:
            user_content = json.dumps(user_input, ensure_ascii=False)[:8000]
        except Exception:
            user_content = str(user_input)[:8000]
    else:
        user_content = user_input[:8000]

    # Retrieve long-term memory context
    memory_context = ""
    try:
        tenant_id = ctx.get("tenant_id", "")
        memory_context = await memory.retrieve_context(
            tenant_id=tenant_id,
            query=user_content[:500],
            limit=3,
        )
    except Exception as e:
        logger.debug("Memory retrieval skipped: %s", e)

    # Build messages with memory injection
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    if memory_context:
        messages.append({
            "role": "system",
            "content": f"Relevant context from prior runs:\n{memory_context}",
        })

    messages.append({"role": "user", "content": user_content})

    tool_defs = get_tool_definitions(allowed_tools)
    tool_calls_log: list[dict[str, Any]] = []
    iterations = 0
    final_output = ""
    total_tokens = 0

    for iteration in range(max_iterations):
        iterations = iteration + 1

        call_kwargs: dict[str, Any] = {
            "model": model,
            "temperature": temperature,
            "messages": messages,
        }
        if tool_defs:
            call_kwargs["tools"] = tool_defs

        response = await client.chat.completions.create(**call_kwargs)
        message = response.choices[0].message

        if response.usage:
            total_tokens += response.usage.total_tokens

        # Append the assistant message to the conversation
        msg_dict: dict[str, Any] = {"role": "assistant", "content": message.content}
        if message.tool_calls:
            msg_dict["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in message.tool_calls
            ]
        messages.append(msg_dict)

        # If no tool calls, the agent has produced its final answer
        if not message.tool_calls:
            final_output = message.content or ""
            break

        # Execute each tool call and feed results back
        for tool_call in message.tool_calls:
            fn_name = tool_call.function.name
            try:
                fn_args = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            logger.info(
                "Agent tool call: %s(%s)", fn_name, json.dumps(fn_args)[:200]
            )

            try:
                result = await execute_tool_call(fn_name, fn_args, ctx)
            except Exception as exc:
                result = {"error": str(exc)}

            tool_calls_log.append({
                "tool": fn_name,
                "arguments": fn_args,
                "result": result,
                "iteration": iterations,
            })

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False)[:8000],
            })
    else:
        # Hit max iterations without final answer
        final_output = message.content or f"[Agent stopped after {max_iterations} iterations]"

    # Store step result in long-term memory (fire and forget)
    try:
        await memory.store_step_result(
            tenant_id=ctx.get("tenant_id", ""),
            run_id=ctx.get("run_id", ""),
            node_id=node["id"],
            input_summary=user_content[:500],
            output_summary=final_output[:500],
        )
    except Exception as e:
        logger.debug("Memory store skipped: %s", e)

    return {
        "type": "agent",
        "node": node["id"],
        "model": model,
        "output": final_output,
        "tool_calls": tool_calls_log,
        "iterations": iterations,
        "total_tokens": total_tokens,
        "conversation_length": len(messages),
    }


async def _execute_tool(node: DagNode, ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Execute a tool node directly (non-agentic, deterministic execution).
    """
    node_id = node["id"]
    cfg = node.get("config", {}) or {}

    if node_id == "tool.http_request" or node_id.endswith(".http_request"):
        from .tools import handle_http_request

        args = {
            "url": cfg.get("url", ""),
            "method": cfg.get("method", "GET"),
            "headers": cfg.get("headers"),
            "body": cfg.get("json") or cfg.get("body"),
        }
        if not args["url"]:
            raise RuntimeError("tool.http_request requires a 'url' in node.config")
        result = await handle_http_request(args, ctx)
        return {"type": "tool", "tool": "http_request", "node": node_id, **result}

    if node_id == "tool.slack_send_message" or node_id.endswith(".slack_send_message"):
        from .tools import handle_slack_send_message

        payload = ctx.get("current_output") or ctx.get("input") or {}
        if not isinstance(payload, str):
            try:
                text_default = json.dumps(payload, ensure_ascii=False)[:4000]
            except Exception:
                text_default = str(payload)[:4000]
        else:
            text_default = payload[:4000]

        tools_ctx = ctx.get("tools") or {}
        slack_ctx = tools_ctx.get("slack") or {}

        args = {
            "channel": cfg.get("channel") or slack_ctx.get("defaultChannel") or "#general",
            "text": cfg.get("text") or text_default,
        }
        result = await handle_slack_send_message(args, ctx)
        return {"type": "tool", "tool": "slack_send_message", "node": node_id, **result}

    if node_id == "tool.store_data" or node_id.endswith(".db_write"):
        from .tools import handle_store_data

        data = ctx.get("current_output") or ctx.get("input") or {}
        args = {"key": node_id, "data": data if isinstance(data, dict) else {"value": data}}
        result = await handle_store_data(args, ctx)
        return {"type": "tool", "tool": "store_data", "node": node_id, **result}

    if "ticket_create" in node_id or "ticket_assign" in node_id:
        from .tools import handle_create_ticket

        data = ctx.get("current_output") or ctx.get("input") or {}
        args = {
            "title": data.get("title", f"Auto-generated from {node_id}") if isinstance(data, dict) else str(data)[:100],
            "description": data.get("description", str(data)[:500]) if isinstance(data, dict) else str(data)[:500],
            "priority": data.get("priority", "medium") if isinstance(data, dict) else "medium",
            "assignee": data.get("assignee") if isinstance(data, dict) else None,
        }
        result = await handle_create_ticket(args, ctx)
        return {"type": "tool", "tool": node_id.split(".")[-1], "node": node_id, **result}

    # Fallback: record the tool call but perform no side-effect
    return {
        "type": "tool",
        "tool": node_id,
        "node": node_id,
        "input": ctx.get("current_output") or ctx.get("input"),
    }


async def _execute_logic(node: DagNode, ctx: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "logic",
        "node": node["id"],
        "note": "Logic node evaluated (branching handled via edge conditions).",
    }


NODE_EXECUTORS: dict[str, ExecutionFn] = {
    "trigger": _execute_trigger,
    "agent": _execute_agent,
    "tool": _execute_tool,
    "logic": _execute_logic,
}


def _normalize_node_type(node: DagNode) -> str:
    raw = node.get("type", "tool")
    if "." in raw:
        return raw.split(".", 1)[0]
    return raw


def _build_incoming_edges(edges: list[DagEdge]) -> dict[str, list[DagEdge]]:
    by_to: dict[str, list[DagEdge]] = {}
    for e in edges:
        by_to.setdefault(e["to"], []).append(e)
    return by_to


def _should_execute_node(
    node_id: str,
    incoming_by_to: dict[str, list[DagEdge]],
    node_results: dict[str, dict[str, Any]],
    ctx: dict[str, Any],
) -> bool:
    incoming = incoming_by_to.get(node_id, [])
    if not incoming:
        return True

    for edge in incoming:
        src_id = edge["from_"]
        src_result = node_results.get(src_id)
        if not src_result or src_result.get("status") != "SUCCEEDED":
            continue

        cond = edge.get("condition")
        if not cond:
            return True

        if safe_eval_condition(cond, ctx, src_result.get("output")):
            return True

    return False


async def execute_run(
    *,
    run_id: str,
    tenant_id: str,
    snapshot: DagSnapshot,
    input_payload: dict[str, Any] | None,
    tools_context: dict[str, Any] | None,
    trace_id: str | None,
    sender: StepUpdateSender | None = None,
) -> None:
    """Execute the given DAG snapshot in deterministic topological order."""

    if sender is None:
        sender = StepUpdateSender()

    plan = build_execution_plan(snapshot)
    incoming_by_to = _build_incoming_edges(snapshot["edges"])

    ctx: dict[str, Any] = {
        "input": input_payload or {},
        "tools": tools_context or {},
        "tenant_id": tenant_id,
        "run_id": run_id,
    }

    node_results: dict[str, dict[str, Any]] = {}

    for node in plan:
        node_id = node["id"]
        node_type = _normalize_node_type(node)

        if not _should_execute_node(node_id, incoming_by_to, node_results, ctx):
            update_payload = {
                "run_id": run_id,
                "tenant_id": tenant_id,
                "node_id": node_id,
                "type": node_type,
                "status": "SKIPPED",
                "input_json": {"context_keys": list(ctx.keys())},
                "output_json": {
                    "skipped": True,
                    "reason": "No incoming edge conditions evaluated to true",
                },
                "trace_id": trace_id,
            }
            node_results[node_id] = {
                "status": "SKIPPED",
                "output": update_payload["output_json"],
            }
            await sender.send_update(update_payload)
            continue

        exec_fn = NODE_EXECUTORS.get(node_type)

        try:
            if exec_fn is None:
                raise RuntimeError(f"No executor registered for node type '{node_type}'")

            output = await exec_fn(node, ctx)
            ctx["current_output"] = output

            update_payload = {
                "run_id": run_id,
                "tenant_id": tenant_id,
                "node_id": node_id,
                "type": node_type,
                "status": "SUCCEEDED",
                "input_json": {"context_keys": list(ctx.keys())},
                "output_json": output,
                "trace_id": trace_id,
            }

            node_results[node_id] = {"status": "SUCCEEDED", "output": output}
        except Exception as exc:
            update_payload = {
                "run_id": run_id,
                "tenant_id": tenant_id,
                "node_id": node_id,
                "type": node_type,
                "status": "FAILED",
                "input_json": {"context_keys": list(ctx.keys())},
                "output_json": None,
                "error_json": {
                    "message": str(exc),
                    "node": node_id,
                    "type": node_type,
                },
                "trace_id": trace_id,
            }
            node_results[node_id] = {"status": "FAILED", "output": None}
            await sender.send_update(update_payload)
            break

        await sender.send_update(update_payload)
