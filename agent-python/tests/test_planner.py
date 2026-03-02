"""Tests for the DAG planner (topological sort and execution plan)."""

import pytest

from app.agents.planner import (
    DagNode,
    DagEdge,
    DagSnapshot,
    topological_sort,
    build_execution_plan,
)


def _node(id: str, type: str = "tool", label: str = "") -> DagNode:
    return {"id": id, "type": type, "label": label or id, "config": {}}


def _edge(from_: str, to: str, condition: str | None = None) -> DagEdge:
    return {"id": f"{from_}->{to}", "from_": from_, "to": to, "condition": condition}


class TestTopologicalSort:
    def test_simple_linear_dag(self):
        nodes = [_node("a"), _node("b"), _node("c")]
        edges = [_edge("a", "b"), _edge("b", "c")]
        result = topological_sort(nodes, edges)
        ids = [n["id"] for n in result]
        assert ids == ["a", "b", "c"]

    def test_diamond_dag(self):
        nodes = [_node("a"), _node("b"), _node("c"), _node("d")]
        edges = [_edge("a", "b"), _edge("a", "c"), _edge("b", "d"), _edge("c", "d")]
        result = topological_sort(nodes, edges)
        ids = [n["id"] for n in result]
        assert ids.index("a") < ids.index("b")
        assert ids.index("a") < ids.index("c")
        assert ids.index("b") < ids.index("d")
        assert ids.index("c") < ids.index("d")

    def test_single_node(self):
        nodes = [_node("solo")]
        result = topological_sort(nodes, [])
        assert [n["id"] for n in result] == ["solo"]

    def test_cycle_raises_error(self):
        nodes = [_node("a"), _node("b")]
        edges = [_edge("a", "b"), _edge("b", "a")]
        with pytest.raises(ValueError, match="cycle"):
            topological_sort(nodes, edges)

    def test_deterministic_order(self):
        """Nodes with the same in-degree should be sorted alphabetically."""
        nodes = [_node("z"), _node("m"), _node("a")]
        result = topological_sort(nodes, [])
        ids = [n["id"] for n in result]
        assert ids == ["a", "m", "z"]

    def test_complex_dag(self):
        nodes = [
            _node("trigger", "trigger"),
            _node("summarize", "agent"),
            _node("classify", "agent"),
            _node("store", "tool"),
            _node("notify", "tool"),
        ]
        edges = [
            _edge("trigger", "summarize"),
            _edge("summarize", "classify"),
            _edge("classify", "store"),
            _edge("store", "notify"),
        ]
        result = topological_sort(nodes, edges)
        ids = [n["id"] for n in result]
        assert ids == ["trigger", "summarize", "classify", "store", "notify"]


class TestBuildExecutionPlan:
    def test_returns_ordered_nodes(self):
        snapshot: DagSnapshot = {
            "nodes": [_node("b"), _node("a")],
            "edges": [_edge("a", "b")],
        }
        plan = build_execution_plan(snapshot)
        assert [n["id"] for n in plan] == ["a", "b"]
