import { API_BASE_URL, buildAuthHeaders } from "@lib/api/client";
import { WorkflowsClient, type WorkflowListItem } from "@components/workflows/WorkflowsClient";

async function getWorkflows(): Promise<WorkflowListItem[]> {
  const headers = buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/workflows`, {
    cache: "no-store",
    headers
  });

  if (!res.ok) {
    return [];
  }

  return res.json();
}

export default async function WorkflowsPage() {
  const workflows = await getWorkflows();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <WorkflowsClient initialWorkflows={workflows} />
    </div>
  );
}


