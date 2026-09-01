/**
 * Count unique node ids in a DAG snapshot so run completion is based on the
 * planned graph, not only steps reported so far.
 */
export function countDagNodes(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== "object") {
    return 0;
  }
  const nodes = (snapshot as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) {
    return 0;
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const id = (node as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      ids.add(id);
    }
  }
  return ids.size;
}
