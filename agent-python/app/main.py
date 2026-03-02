from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any
import asyncio

from .agents.executor import execute_run as execute_dag_run, DagSnapshot


class ExecuteRunRequest(BaseModel):
    run_id: str
    tenant_id: str
    # Accept any JSON object here and let the executor validate/interpret it.
    snapshot_dag_json: dict[str, Any]
    input_payload: dict | None = None
    tools_context: dict | None = None
    trace_id: str | None = None
    mode: str = "production"


class ExecuteRunResponse(BaseModel):
    accepted: bool
    run_id: str
    trace_id: str | None = None


app = FastAPI(title="AI Workflow Agent Service", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "agent-python"}


@app.post("/internal/runs/execute", response_model=ExecuteRunResponse)
async def execute_run(request: ExecuteRunRequest) -> ExecuteRunResponse:
    """
    Accept a workflow run from the Node backend and execute it asynchronously.

    For the MVP we simply schedule `executor.execute_run` on the event loop and
    immediately acknowledge the request so the Node service is not blocked.
    """

    asyncio.create_task(
        execute_dag_run(
            run_id=request.run_id,
            tenant_id=request.tenant_id,
            snapshot=request.snapshot_dag_json,
            input_payload=request.input_payload or {},
            tools_context=request.tools_context or {},
            trace_id=request.trace_id,
        )
    )

    return ExecuteRunResponse(
        accepted=True,
        run_id=request.run_id,
        trace_id=request.trace_id,
    )



