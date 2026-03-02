export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  status: "draft" | "active" | "archived";
  currentVersionId?: string;
  createdAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  versionNumber: number;
  dagJson: unknown;
  triggerConfigJson: unknown;
  isSandbox: boolean;
  createdAt: string;
  createdBy: string;
}


