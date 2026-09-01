from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from typing import Any
import asyncio
import os

from .agents.executor import execute_run as execute_dag_run

INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "dev-internal-token")


class ExecuteRunRequest(BaseModel):
    run_id: str
    tenant_id: str
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


def _assert_internal_token(x_internal_token: str | None) -> None:
    if x_internal_token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "agent-python"}


@app.post("/internal/runs/execute", response_model=ExecuteRunResponse)
async def execute_run(
    request: ExecuteRunRequest,
    x_internal_token: str | None = Header(default=None),
) -> ExecuteRunResponse:
    """
    Accept a workflow run from the Node backend and execute it asynchronously.
    """
    _assert_internal_token(x_internal_token)

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
