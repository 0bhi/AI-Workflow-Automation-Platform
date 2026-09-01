import os
import signal
import subprocess
import time
import uuid
from dataclasses import dataclass
import socket

import httpx


@dataclass
class Proc:
    name: str
    popen: subprocess.Popen


def _wait_http_ok(url: str, timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            r = httpx.get(url, timeout=1.5)
            if 200 <= r.status_code < 300:
                return
        except Exception as e:  # noqa: BLE001 - test helper
            last_err = e
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {url} to become healthy: {last_err}")


def _wait_tcp(host: str, port: int, timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return
        except Exception as e:  # noqa: BLE001 - test helper
            last_err = e
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for TCP {host}:{port}: {last_err}")


def _start_proc(*, name: str, cmd: list[str], cwd: str, env: dict[str, str]) -> Proc:
    p = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return Proc(name=name, popen=p)


def _terminate_procs(procs: list[Proc]) -> None:
    # Best-effort shutdown in reverse order.
    for pr in reversed(procs):
        if pr.popen.poll() is not None:
            continue
        try:
            pr.popen.send_signal(signal.SIGTERM)
        except Exception:
            pass
    # Give them a moment, then hard kill.
    deadline = time.time() + 5.0
    while time.time() < deadline:
        if all(pr.popen.poll() is not None for pr in procs):
            return
        time.sleep(0.2)
    for pr in reversed(procs):
        if pr.popen.poll() is None:
            try:
                pr.popen.kill()
            except Exception:
                pass


def _drain_output(procs: list[Proc], max_chars: int = 6000) -> str:
    chunks: list[str] = []
    for pr in procs:
        out = ""
        try:
            if pr.popen.stdout is not None:
                out = pr.popen.stdout.read() or ""
        except Exception:
            out = ""
        if out:
            chunks.append(f"\n===== {pr.name} =====\n{out[-max_chars:]}")
    return "\n".join(chunks).strip()


def test_e2e_invoke_workflow_to_completion():
    """
    Full E2E smoke test:
      invoke workflow -> Node queues job -> worker calls agent -> agent executes DAG
      -> agent posts step updates -> Node marks run SUCCEEDED -> steps visible via API.

    This test avoids OpenAI by using only deterministic nodes:
      trigger -> tool.store_data
    """

    # This test file lives at:
    #   ai-workflow-automation-platform/agent-python/tests/...
    # So two levels up is the platform root directory itself.
    platform_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    infra_dir = os.path.join(platform_root, "infra")
    backend_dir = os.path.join(platform_root, "backend-node")
    agent_dir = os.path.join(platform_root, "agent-python")

    backend_port = "4010"
    agent_port = "5010"

    backend_url = f"http://localhost:{backend_port}"
    agent_url = f"http://localhost:{agent_port}"

    env_base = os.environ.copy()

    # Start infra (Postgres + Redis + Qdrant). Qdrant isn't required for this DAG,
    # but compose is cheap and keeps the environment consistent.
    subprocess.run(["docker", "compose", "up", "-d"], cwd=infra_dir, check=True)
    _wait_tcp("127.0.0.1", 5432, timeout_s=45.0)
    _wait_tcp("127.0.0.1", 6379, timeout_s=45.0)

    # Ensure backend deps + schema exist (idempotent).
    subprocess.run(["npm", "install"], cwd=backend_dir, check=True)
    subprocess.run(["npm", "run", "db:schema"], cwd=backend_dir, check=True)

    procs: list[Proc] = []
    try:
        backend_env = {
            **env_base,
            "PORT": backend_port,
            "AGENT_SERVICE_URL": agent_url,
            "NODE_ENV": "test",
        }
        agent_env = {
            **env_base,
            "NODE_BACKEND_URL": backend_url,
        }

        # Start backend API, run worker, and agent service.
        procs.append(
            _start_proc(
                name="backend-api",
                cmd=["npm", "run", "dev"],
                cwd=backend_dir,
                env=backend_env,
            )
        )
        _wait_http_ok(f"{backend_url}/health", timeout_s=45.0)

        procs.append(
            _start_proc(
                name="backend-worker",
                cmd=["npm", "run", "dev:worker"],
                cwd=backend_dir,
                env=backend_env,
            )
        )

        # Ensure agent deps are available.
        subprocess.run(["pip", "install", "-r", "requirements.txt"], cwd=agent_dir, check=True)
        procs.append(
            _start_proc(
                name="agent-python",
                cmd=[
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    agent_port,
                ],
                cwd=agent_dir,
                env=agent_env,
            )
        )
        _wait_http_ok(f"{agent_url}/health", timeout_s=45.0)

        # --- Use the public API like the UI does ---
        email = f"e2e_{uuid.uuid4().hex[:10]}@example.com"
        password = "passw0rd"

        with httpx.Client(base_url=backend_url, timeout=10.0) as client:
            signup = client.post("/api/auth/signup", json={"email": email, "password": password})
            assert signup.status_code == 201, signup.text
            token = signup.json()["token"]

            headers = {"authorization": f"Bearer {token}"}

            slug = f"e2e-wf-{uuid.uuid4().hex[:8]}"
            create = client.post(
                "/api/workflows",
                headers=headers,
                json={"name": "E2E workflow", "slug": slug, "description": "e2e"},
            )
            assert create.status_code == 201, create.text
            workflow_id = create.json()["id"]

            # Must activate before saving version due to repo loading active-only.
            activate = client.patch(
                f"/api/workflows/{workflow_id}",
                headers=headers,
                json={"status": "active"},
            )
            assert activate.status_code == 200, activate.text

            dag = {
                "nodes": [
                    {
                        "id": "trigger.http_webhook",
                        "type": "trigger.http_webhook",
                        "label": "Trigger",
                        "config": {},
                    },
                    {
                        "id": "tool.store_data",
                        "type": "tool.store_data",
                        "label": "Store",
                        "config": {},
                    },
                ],
                "edges": [
                    {"id": "e1", "from_": "trigger.http_webhook", "to": "tool.store_data", "condition": None}
                ],
            }
            save = client.put(
                f"/api/workflows/{workflow_id}/dag",
                headers={**headers, "content-type": "application/json"},
                json={"dag": dag},
            )
            assert save.status_code == 201, save.text

            invoke = client.post(f"/api/workflows/{slug}/invoke", headers=headers, json={"hello": "world"})
            assert invoke.status_code == 202, invoke.text
            run_id = invoke.json()["runId"]

            # Poll until run is settled.
            deadline = time.time() + 60.0
            last = None
            while time.time() < deadline:
                r = client.get(f"/api/runs/{run_id}", headers=headers)
                assert r.status_code == 200, r.text
                last = r.json()
                status = last.get("run", {}).get("status") or last.get("status")
                if status in {"SUCCEEDED", "FAILED"}:
                    break
                time.sleep(0.75)

            assert last is not None
            run = last.get("run") or last
            steps = last.get("steps") or []

            assert run.get("status") == "SUCCEEDED", f"Run did not succeed: {run}"
            assert len(steps) >= 2, f"Expected at least 2 steps, got {len(steps)}"

            statuses = {s.get("status") for s in steps}
            assert "FAILED" not in statuses
    except Exception as e:
        # Attach logs to make failures actionable.
        logs = _drain_output(procs)
        raise AssertionError(f"E2E test failed: {e}\n\n{logs}") from e
    finally:
        _terminate_procs(procs)

