"""
be/finance/services/idempotency.py
Thread-safe in-memory idempotency registry for financial commands.
"""
import time
import threading
from typing import Any, Dict, Optional, Tuple
from fastapi import HTTPException, status


class IdempotencyService:
    """
    Tracks executed financial commands by key to prevent duplicate processing.
    Key is scoped to (user_email, endpoint_path, idempotency_key).
    """

    def __init__(self, ttl_seconds: int = 86400):
        self.ttl_seconds = ttl_seconds
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._in_progress: Dict[str, float] = {}
        self._lock = threading.Lock()

    def _clean_expired(self, now: float):
        expired = [k for k, v in self._cache.items() if now - v.get("timestamp", 0) > self.ttl_seconds]
        for k in expired:
            self._cache.pop(k, None)
        expired_in_progress = [k for k, start in self._in_progress.items() if now - start > 120]
        for k in expired_in_progress:
            self._in_progress.pop(k, None)

    def check_and_start(self, scoped_key: str) -> Optional[Dict[str, Any]]:
        """
        If already completed, returns cached dict with keys {'status_code', 'response'}.
        If currently in progress, raises 409 Conflict.
        If new, marks in-progress and returns None.
        """
        now = time.time()
        with self._lock:
            self._clean_expired(now)
            if scoped_key in self._cache:
                return self._cache[scoped_key]
            if scoped_key in self._in_progress:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A financial command with this Idempotency-Key is already being processed.",
                )
            self._in_progress[scoped_key] = now
            return None

    def complete(self, scoped_key: str, response_data: Any, status_code: int = 200):
        """Records the successful execution result and clears in-progress state."""
        now = time.time()
        with self._lock:
            self._in_progress.pop(scoped_key, None)
            self._cache[scoped_key] = {
                "timestamp": now,
                "status_code": status_code,
                "response": response_data,
            }

    def fail(self, scoped_key: str):
        """Clears in-progress state on failure so a retry may proceed."""
        with self._lock:
            self._in_progress.pop(scoped_key, None)

    def execute_idempotent(
        self,
        idempotency_key: Optional[str],
        user_email: str,
        endpoint_path: str,
        operation_fn,
    ) -> Any:
        """
        Wrapper that executes operation_fn if idempotency_key is provided,
        or calls operation_fn directly if no key is supplied.
        """
        if not idempotency_key or not idempotency_key.strip():
            return operation_fn()

        scoped_key = f"{user_email}:{endpoint_path}:{idempotency_key.strip()}"
        cached = self.check_and_start(scoped_key)
        if cached:
            return cached["response"]

        try:
            result = operation_fn()
            self.complete(scoped_key, result)
            return result
        except Exception:
            self.fail(scoped_key)
            raise


# Global singleton
idempotency_service = IdempotencyService()
