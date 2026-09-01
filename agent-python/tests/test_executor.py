"""Tests for the DAG executor with mocked LLM and tool calls."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agents.executor import (
    execute_run,
    _execute_trigger,
    _execute_tool,
    _execute_logic,
    _normalize_node_type,
    _should_execute_node,
    _text_for_slack,
    StepUpdateSender,
)
from app.agents.planner import DagNode, DagEdge, DagSnapshot


def _node(id: str, type: str = "tool", label: str = "", config: dict | None = None) -> DagNode:
    return {"id": id, "type": type, "label": label or id, "config": config or {}}


def _edge(from_: str, to: str, condition: str | None = None) -> DagEdge:
    return {"id": f"{from_}->{to}", "from_": from_, "to": to, "condition": condition}


class TestNormalizeNodeType:
    def test_simple_type(self):
        assert _normalize_node_type({"id": "x", "type": "trigger", "label": "", "config": {}}) == "trigger"

    def test_dotted_type(self):
        assert _normalize_node_type({"id": "x", "type": "agent.summarize", "label": "", "config": {}}) == "agent"

    def test_tool_type(self):
        assert _normalize_node_type({"id": "x", "type": "tool.http_request", "label": "", "config": {}}) == "tool"


class TestShouldExecuteNode:
    def test_no_incoming_edges(self):
        assert _should_execute_node("a", {}, {}, {}) is True

    def test_unconditional_edge_succeeded(self):
        incoming = {"b": [{"id": "e1", "from_": "a", "to": "b", "condition": None}]}
        results = {"a": {"status": "SUCCEEDED", "output": {}}}
        assert _should_execute_node("b", incoming, results, {}) is True

    def test_unconditional_edge_failed_source(self):
        incoming = {"b": [{"id": "e1", "from_": "a", "to": "b", "condition": None}]}
        results = {"a": {"status": "FAILED", "output": None}}
        assert _should_execute_node("b", incoming, results, {}) is False

    def test_conditional_edge_true(self):
        incoming = {"b": [{"id": "e1", "from_": "a", "to": "b", "condition": "output.score > 0.5"}]}
        results = {"a": {"status": "SUCCEEDED", "output": {"score": 0.9}}}
        assert _should_execute_node("b", incoming, results, {}) is True

    def test_conditional_edge_false(self):
        incoming = {"b": [{"id": "e1", "from_": "a", "to": "b", "condition": "output.score > 0.5"}]}
        results = {"a": {"status": "SUCCEEDED", "output": {"score": 0.2}}}
        assert _should_execute_node("b", incoming, results, {}) is False


@pytest.mark.asyncio
class TestTriggerExecutor:
    async def test_passes_through_input(self):
        node = _node("trigger.email", "trigger")
        ctx = {"input": {"subject": "Hello"}}
        result = await _execute_trigger(node, ctx)
        assert result["type"] == "trigger"
        assert result["input"]["subject"] == "Hello"


@pytest.mark.asyncio
class TestLogicExecutor:
    async def test_returns_logic_note(self):
        node = _node("logic.branch_if", "logic")
        result = await _execute_logic(node, {})
        assert result["type"] == "logic"
        assert "branching" in result["note"].lower()


@pytest.mark.asyncio
class TestToolExecutor:
    async def test_store_data_tool(self):
        node = _node("tool.db_write", "tool.db_write")
        ctx = {"current_output": {"key": "value"}, "input": {}}
        result = await _execute_tool(node, ctx)
        assert result["type"] == "tool"
        assert result.get("stored") is True

    async def test_http_tool_missing_url_raises(self):
        node = _node("tool.http_request", "tool.http_request", config={})
        with pytest.raises(RuntimeError, match="url"):
            await _execute_tool(node, {})


class TestSlackMessageText:
    def test_uses_agent_output_not_full_result_json(self):
        ctx = {
            "current_output": {
                "type": "agent",
                "node": "agent.plan_and_execute",
                "output": "✅ Deployment of API succeeded.",
                "tool_calls": [],
            }
        }
        text = _text_for_slack({"channel": "#general", "text": ""}, ctx)
        assert text == "✅ Deployment of API succeeded."
        assert "tool_calls" not in text

    def test_prefers_configured_text(self):
        ctx = {"current_output": {"output": "from agent"}}
        text = _text_for_slack({"text": "hardcoded"}, ctx)
        assert text == "hardcoded"


@pytest.mark.asyncio
class TestExecuteRun:
    async def test_simple_linear_dag(self):
        """Execute a trigger → logic flow and verify step updates are sent."""
        snapshot: DagSnapshot = {
            "nodes": [
                _node("trigger.start", "trigger"),
                _node("logic.branch", "logic"),
            ],
            "edges": [_edge("trigger.start", "logic.branch")],
        }

        sender = MagicMock(spec=StepUpdateSender)
        sender.send_update = AsyncMock()

        await execute_run(
            run_id="run_test",
            tenant_id="t1",
            snapshot=snapshot,
            input_payload={"test": True},
            tools_context=None,
            trace_id="trace_test",
            sender=sender,
        )

        assert sender.send_update.call_count == 2
        calls = [c.args[0] for c in sender.send_update.call_args_list]
        assert calls[0]["status"] == "SUCCEEDED"
        assert calls[0]["node_id"] == "trigger.start"
        assert calls[1]["status"] == "SUCCEEDED"
        assert calls[1]["node_id"] == "logic.branch"

    async def test_skipped_node_on_failed_source(self):
        """Nodes whose incoming edge conditions fail are SKIPPED."""
        snapshot_cond: DagSnapshot = {
            "nodes": [
                _node("start", "trigger"),
                _node("branch_yes", "logic"),
                _node("branch_no", "logic"),
            ],
            "edges": [
                _edge("start", "branch_yes", condition="output.go == True"),
                _edge("start", "branch_no", condition="output.go == False"),
            ],
        }

        sender2 = MagicMock(spec=StepUpdateSender)
        sender2.send_update = AsyncMock()

        await execute_run(
            run_id="run_cond",
            tenant_id="t1",
            snapshot=snapshot_cond,
            input_payload={"go": True},
            tools_context=None,
            trace_id="trace_cond",
            sender=sender2,
        )

        calls = [c.args[0] for c in sender2.send_update.call_args_list]
        statuses = {c["node_id"]: c["status"] for c in calls}
        assert statuses["start"] == "SUCCEEDED"
        assert "branch_yes" in statuses
        assert "branch_no" in statuses
