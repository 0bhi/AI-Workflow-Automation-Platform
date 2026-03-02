"""Tests for the safe expression evaluator."""

import pytest

from app.agents.safe_eval import safe_eval, safe_eval_condition, SafeEvalError


class TestSafeEval:
    def test_literal_true(self):
        assert safe_eval("True", {}) is True

    def test_literal_false(self):
        assert safe_eval("False", {}) is False

    def test_integer(self):
        assert safe_eval("42", {}) == 42

    def test_string(self):
        assert safe_eval('"hello"', {}) == "hello"

    def test_variable_lookup(self):
        assert safe_eval("x", {"x": 10}) == 10

    def test_undefined_variable_raises(self):
        with pytest.raises(SafeEvalError, match="Undefined variable"):
            safe_eval("y", {"x": 1})

    def test_comparison_gt(self):
        assert safe_eval("x > 5", {"x": 10}) is True
        assert safe_eval("x > 5", {"x": 3}) is False

    def test_comparison_eq(self):
        assert safe_eval("x == 'done'", {"x": "done"}) is True
        assert safe_eval("x == 'done'", {"x": "pending"}) is False

    def test_comparison_in(self):
        assert safe_eval("'a' in items", {"items": ["a", "b"]}) is True
        assert safe_eval("'c' in items", {"items": ["a", "b"]}) is False

    def test_boolean_and(self):
        assert safe_eval("x > 0 and y > 0", {"x": 1, "y": 2}) is True
        assert safe_eval("x > 0 and y > 0", {"x": 1, "y": -1}) is False

    def test_boolean_or(self):
        assert safe_eval("x > 0 or y > 0", {"x": -1, "y": 2}) is True

    def test_not(self):
        assert safe_eval("not x", {"x": False}) is True

    def test_attribute_access_dict(self):
        assert safe_eval("output.score", {"output": {"score": 0.95}}) == 0.95

    def test_attribute_access_missing(self):
        assert safe_eval("output.missing", {"output": {}}) is None

    def test_subscript_access(self):
        assert safe_eval('output["key"]', {"output": {"key": "val"}}) == "val"

    def test_arithmetic(self):
        assert safe_eval("x + y", {"x": 3, "y": 4}) == 7
        assert safe_eval("x * 2", {"x": 5}) == 10

    def test_ternary(self):
        assert safe_eval("'yes' if x else 'no'", {"x": True}) == "yes"
        assert safe_eval("'yes' if x else 'no'", {"x": False}) == "no"

    def test_nested_attribute(self):
        assert safe_eval("a.b.c", {"a": {"b": {"c": 42}}}) == 42

    def test_rejects_function_calls(self):
        with pytest.raises(SafeEvalError, match="Unsupported"):
            safe_eval("len(x)", {"x": [1, 2, 3]})

    def test_rejects_import(self):
        with pytest.raises(SafeEvalError):
            safe_eval("__import__('os')", {})

    def test_expression_too_long(self):
        with pytest.raises(SafeEvalError, match="too long"):
            safe_eval("x " * 1000, {"x": 1})


class TestSafeEvalCondition:
    def test_true_condition(self):
        result = safe_eval_condition(
            "output.score > 0.8",
            ctx={"input": {}},
            source_output={"score": 0.95},
        )
        assert result is True

    def test_false_condition(self):
        result = safe_eval_condition(
            "output.score > 0.8",
            ctx={"input": {}},
            source_output={"score": 0.5},
        )
        assert result is False

    def test_invalid_expression_returns_false(self):
        result = safe_eval_condition(
            "this is not valid python [[[",
            ctx={},
            source_output={},
        )
        assert result is False

    def test_ctx_access(self):
        result = safe_eval_condition(
            'ctx.tenant_id == "t1"',
            ctx={"tenant_id": "t1"},
            source_output={},
        )
        assert result is True
