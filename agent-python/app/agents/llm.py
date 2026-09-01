"""OpenAI-compatible clients for chat and embeddings.

Chat uses OPENAI_BASE_URL / OPENAI_API_KEY (Groq, Ollama, etc.).
Embeddings can use a separate EMBEDDING_BASE_URL / EMBEDDING_API_KEY
(e.g. local Ollama) and fall back to the chat endpoint if unset.
"""

import os

from openai import AsyncOpenAI, OpenAI

DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1"
DEFAULT_API_KEY = "ollama"
DEFAULT_MODEL = "qwen3:8b"
DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:0.6b"
DEFAULT_EMBEDDING_DIM = 1024


def llm_base_url() -> str:
    return os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def llm_api_key() -> str:
    return os.environ.get("OPENAI_API_KEY") or DEFAULT_API_KEY


def llm_model() -> str:
    return os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)


def embedding_base_url() -> str:
    return os.environ.get("EMBEDDING_BASE_URL", llm_base_url()).rstrip("/")


def embedding_api_key() -> str:
    return os.environ.get("EMBEDDING_API_KEY") or llm_api_key()


def embedding_model() -> str:
    return os.environ.get("OPENAI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)


def embedding_dim() -> int:
    return int(os.environ.get("EMBEDDING_DIM", str(DEFAULT_EMBEDDING_DIM)))


def make_async_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=llm_api_key(), base_url=llm_base_url())


def make_sync_client() -> OpenAI:
    """Sync client used for embeddings (may point at a different provider)."""
    return OpenAI(api_key=embedding_api_key(), base_url=embedding_base_url())
