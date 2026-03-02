"""
Safe expression evaluator for DAG edge conditions.

Replaces the dangerous eval()-based evaluator with a restricted AST walker
that only allows comparisons, boolean logic, attribute access, subscripts,
and literals. No function calls, no imports, no assignments.
"""

import ast
import operator
from typing import Any


_COMPARE_OPS: dict[type, Any] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.Is: operator.is_,
    ast.IsNot: operator.is_not,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}

_BOOL_OPS: dict[type, Any] = {
    ast.And: all,
    ast.Or: any,
}

_UNARY_OPS: dict[type, Any] = {
    ast.Not: operator.not_,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_BIN_OPS: dict[type, Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
}

MAX_STRING_LEN = 10_000
MAX_EXPRESSION_LEN = 1_000


class SafeEvalError(Exception):
    pass


def _resolve(node: ast.expr, variables: dict[str, Any]) -> Any:
    """Recursively evaluate an AST node against the provided variables."""

    # --- Literals ---
    if isinstance(node, ast.Constant):
        val = node.value
        if isinstance(val, str) and len(val) > MAX_STRING_LEN:
            raise SafeEvalError("String literal too long")
        return val

    # --- Name lookup ---
    if isinstance(node, ast.Name):
        if node.id not in variables:
            raise SafeEvalError(f"Undefined variable: {node.id}")
        return variables[node.id]

    # --- Attribute access (e.g. output.score) ---
    if isinstance(node, ast.Attribute):
        obj = _resolve(node.value, variables)
        attr = node.attr
        if isinstance(obj, dict):
            return obj.get(attr)
        if hasattr(obj, attr) and not attr.startswith("_"):
            return getattr(obj, attr)
        return None

    # --- Subscript (e.g. output["key"] or output[0]) ---
    if isinstance(node, ast.Subscript):
        obj = _resolve(node.value, variables)
        key = _resolve(node.slice, variables)
        try:
            return obj[key]
        except (KeyError, IndexError, TypeError):
            return None

    # --- Boolean operators (and / or) ---
    if isinstance(node, ast.BoolOp):
        op_fn = _BOOL_OPS.get(type(node.op))
        if op_fn is None:
            raise SafeEvalError(f"Unsupported boolean op: {type(node.op).__name__}")
        values = [_resolve(v, variables) for v in node.values]
        return op_fn(values)

    # --- Unary operators (not, -, +) ---
    if isinstance(node, ast.UnaryOp):
        op_fn = _UNARY_OPS.get(type(node.op))
        if op_fn is None:
            raise SafeEvalError(f"Unsupported unary op: {type(node.op).__name__}")
        return op_fn(_resolve(node.operand, variables))

    # --- Binary operators (+, -, *, /, %) ---
    if isinstance(node, ast.BinOp):
        op_fn = _BIN_OPS.get(type(node.op))
        if op_fn is None:
            raise SafeEvalError(f"Unsupported binary op: {type(node.op).__name__}")
        left = _resolve(node.left, variables)
        right = _resolve(node.right, variables)
        return op_fn(left, right)

    # --- Comparisons (==, !=, <, >, <=, >=, in, not in) ---
    if isinstance(node, ast.Compare):
        left = _resolve(node.left, variables)
        for op, comparator in zip(node.ops, node.comparators):
            op_fn = _COMPARE_OPS.get(type(op))
            if op_fn is None:
                raise SafeEvalError(f"Unsupported compare op: {type(op).__name__}")
            right = _resolve(comparator, variables)
            if not op_fn(left, right):
                return False
            left = right
        return True

    # --- Ternary (a if cond else b) ---
    if isinstance(node, ast.IfExp):
        test = _resolve(node.test, variables)
        return _resolve(node.body, variables) if test else _resolve(node.orelse, variables)

    # --- Tuple / List literals ---
    if isinstance(node, (ast.Tuple, ast.List)):
        return [_resolve(el, variables) for el in node.elts]

    raise SafeEvalError(f"Unsupported expression type: {type(node).__name__}")


def safe_eval(expression: str, variables: dict[str, Any]) -> Any:
    """
    Safely evaluate a restricted Python expression.

    Allowed:
      - Literals (numbers, strings, booleans, None)
      - Variable references from `variables` dict
      - Attribute access (output.score)
      - Subscript access (output["key"])
      - Comparisons (==, !=, <, >, <=, >=, in, not in)
      - Boolean operators (and, or, not)
      - Arithmetic (+, -, *, /, %)
      - Ternary expressions (a if cond else b)

    Disallowed:
      - Function calls
      - Imports
      - Assignments
      - Comprehensions
      - Lambda
      - Anything else
    """

    if len(expression) > MAX_EXPRESSION_LEN:
        raise SafeEvalError("Expression too long")

    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        raise SafeEvalError(f"Invalid expression syntax: {e}") from e

    return _resolve(tree.body, variables)


def safe_eval_condition(
    expression: str,
    ctx: dict[str, Any],
    source_output: Any,
) -> bool:
    """
    Evaluate an edge condition expression safely.

    Available variables in the expression:
      - ctx: the full execution context
      - output: the source node's output
    """
    variables = {"ctx": ctx, "output": source_output}
    try:
        return bool(safe_eval(expression, variables))
    except (SafeEvalError, Exception):
        return False
