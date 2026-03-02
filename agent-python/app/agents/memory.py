"""
Agent memory system — short-term (per-run) and long-term (per-tenant via Qdrant).

Short-term memory:
  - Conversation history maintained within a single agent loop execution.
  - Passed directly through the messages list; no external storage needed.

Long-term memory:
  - Stored in Qdrant as vector embeddings per tenant.
  - Retrieved before LLM calls to inject relevant context.
  - Written after step completion to persist learnings.
"""

from typing import Any
import json
import logging
import os
import uuid

logger = logging.getLogger(__name__)

OPENAI_EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "agent_memory")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
EMBEDDING_DIM = 1536


def _get_qdrant_client():
    from qdrant_client import QdrantClient

    return QdrantClient(url=QDRANT_URL, timeout=10)


def _get_openai_client():
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY required for memory embeddings")
    return OpenAI(api_key=api_key)


class MemoryManager:
    """Manages long-term vector memory per tenant."""

    def __init__(self) -> None:
        self._qdrant = None
        self._openai = None
        self._collection_ensured = False

    def _ensure_clients(self) -> None:
        if self._qdrant is None:
            try:
                self._qdrant = _get_qdrant_client()
            except Exception as e:
                logger.warning("Qdrant unavailable, memory disabled: %s", e)
                return
        if self._openai is None:
            try:
                self._openai = _get_openai_client()
            except Exception as e:
                logger.warning("OpenAI unavailable for embeddings: %s", e)

    def _ensure_collection(self) -> None:
        if self._collection_ensured or self._qdrant is None:
            return
        try:
            from qdrant_client.models import Distance, VectorParams

            collections = [c.name for c in self._qdrant.get_collections().collections]
            if QDRANT_COLLECTION not in collections:
                self._qdrant.create_collection(
                    collection_name=QDRANT_COLLECTION,
                    vectors_config=VectorParams(
                        size=EMBEDDING_DIM,
                        distance=Distance.COSINE,
                    ),
                )
                logger.info("Created Qdrant collection: %s", QDRANT_COLLECTION)
            self._collection_ensured = True
        except Exception as e:
            logger.warning("Failed to ensure Qdrant collection: %s", e)

    def _embed(self, text: str) -> list[float] | None:
        if self._openai is None:
            return None
        try:
            response = self._openai.embeddings.create(
                model=OPENAI_EMBEDDING_MODEL,
                input=text[:8000],
            )
            return response.data[0].embedding
        except Exception as e:
            logger.warning("Embedding failed: %s", e)
            return None

    async def store(
        self,
        tenant_id: str,
        content: str,
        metadata: dict[str, Any] | None = None,
        run_id: str | None = None,
        node_id: str | None = None,
    ) -> str | None:
        self._ensure_clients()
        if self._qdrant is None or self._openai is None:
            return None

        self._ensure_collection()

        embedding = self._embed(content)
        if embedding is None:
            return None

        point_id = str(uuid.uuid4())
        payload = {
            "tenant_id": tenant_id,
            "content": content[:10_000],
            "run_id": run_id,
            "node_id": node_id,
            **(metadata or {}),
        }

        try:
            from qdrant_client.models import PointStruct

            self._qdrant.upsert(
                collection_name=QDRANT_COLLECTION,
                points=[
                    PointStruct(id=point_id, vector=embedding, payload=payload)
                ],
            )
            return point_id
        except Exception as e:
            logger.warning("Failed to store memory: %s", e)
            return None

    async def search(
        self,
        tenant_id: str,
        query: str,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        self._ensure_clients()
        if self._qdrant is None or self._openai is None:
            return []

        self._ensure_collection()

        embedding = self._embed(query)
        if embedding is None:
            return []

        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue

            results = self._qdrant.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=embedding,
                query_filter=Filter(
                    must=[
                        FieldCondition(
                            key="tenant_id",
                            match=MatchValue(value=tenant_id),
                        )
                    ]
                ),
                limit=limit,
            )

            return [
                {
                    "content": hit.payload.get("content", "") if hit.payload else "",
                    "score": hit.score,
                    "metadata": {
                        k: v
                        for k, v in (hit.payload or {}).items()
                        if k not in ("content", "tenant_id")
                    },
                }
                for hit in results
            ]
        except Exception as e:
            logger.warning("Memory search failed: %s", e)
            return []

    async def retrieve_context(
        self,
        tenant_id: str,
        query: str,
        limit: int = 3,
    ) -> str:
        """Retrieve relevant memories and format as a context string for injection."""
        results = await self.search(tenant_id=tenant_id, query=query, limit=limit)
        if not results:
            return ""

        parts = []
        for i, r in enumerate(results, 1):
            parts.append(f"[Memory {i} (relevance: {r['score']:.2f})]")
            parts.append(r["content"])
        return "\n".join(parts)

    async def store_step_result(
        self,
        tenant_id: str,
        run_id: str,
        node_id: str,
        input_summary: str,
        output_summary: str,
    ) -> None:
        """Store a step's result as a long-term memory."""
        content = (
            f"Workflow step '{node_id}' in run '{run_id}':\n"
            f"Input: {input_summary[:2000]}\n"
            f"Output: {output_summary[:2000]}"
        )
        await self.store(
            tenant_id=tenant_id,
            content=content,
            run_id=run_id,
            node_id=node_id,
            metadata={"type": "step_result"},
        )
