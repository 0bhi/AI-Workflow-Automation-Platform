from collections.abc import Iterable
from typing_extensions import TypedDict


class DagNode(TypedDict):
    id: str
    type: str
    label: str
    config: dict


class DagEdge(TypedDict):
    id: str
    from_: str
    to: str
    condition: str | None


class DagSnapshot(TypedDict):
    nodes: list[DagNode]
    edges: list[DagEdge]


def topological_sort(nodes: Iterable[DagNode], edges: Iterable[DagEdge]) -> list[DagNode]:
    """Very small, deterministic topological sort over the DAG snapshot."""
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    adjacency: dict[str, list[str]] = {n["id"]: [] for n in nodes}

    for edge in edges:
        src = edge["from_"]
        dst = edge["to"]
        if src in in_degree and dst in in_degree:
            in_degree[dst] += 1
            adjacency[src].append(dst)

    queue: list[str] = sorted([nid for nid, deg in in_degree.items() if deg == 0])
    ordered_nodes: list[DagNode] = []

    node_by_id = {n["id"]: n for n in nodes}

    while queue:
        current = queue.pop(0)
        ordered_nodes.append(node_by_id[current])
        for nxt in sorted(adjacency[current]):
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    if len(ordered_nodes) != len(nodes):
        raise ValueError("DAG contains a cycle or unreachable nodes")

    return ordered_nodes


def build_execution_plan(snapshot: DagSnapshot) -> list[DagNode]:
    """Return the execution order for the given DAG snapshot."""
    return topological_sort(snapshot["nodes"], snapshot["edges"])



