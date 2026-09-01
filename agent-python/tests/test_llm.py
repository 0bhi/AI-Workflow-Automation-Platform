"""Chat vs embedding client configuration."""

from app.agents import llm


def test_chat_and_embeddings_use_separate_endpoints(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "gsk_test")
    monkeypatch.setenv("EMBEDDING_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("EMBEDDING_API_KEY", "ollama")

    assert llm.llm_base_url() == "https://api.groq.com/openai/v1"
    assert llm.llm_api_key() == "gsk_test"
    assert llm.embedding_base_url() == "http://127.0.0.1:11434/v1"
    assert llm.embedding_api_key() == "ollama"

    chat = llm.make_async_client()
    embeddings = llm.make_sync_client()
    assert str(chat.base_url).rstrip("/") == "https://api.groq.com/openai/v1"
    assert str(embeddings.base_url).rstrip("/") == "http://127.0.0.1:11434/v1"


def test_embeddings_fall_back_to_chat_endpoint(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "gsk_test")
    monkeypatch.delenv("EMBEDDING_BASE_URL", raising=False)
    monkeypatch.delenv("EMBEDDING_API_KEY", raising=False)

    assert llm.embedding_base_url() == "https://api.groq.com/openai/v1"
    assert llm.embedding_api_key() == "gsk_test"


def test_default_model_ids(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_EMBEDDING_MODEL", raising=False)
    assert llm.llm_model() == "qwen3:8b"
    assert llm.embedding_model() == "qwen3-embedding:0.6b"
