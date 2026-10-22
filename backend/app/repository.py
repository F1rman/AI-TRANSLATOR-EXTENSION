"""Atomic document adapters; business transitions are shared by both adapters."""
import asyncio
from copy import deepcopy


class MemoryRepository:
    def __init__(self):
        self.documents = {}
        self.lock = asyncio.Lock()

    async def atomic(self, keys, operation):
        async with self.lock:
            documents = {key: deepcopy(self.documents.get(key)) for key in dict.fromkeys(keys)}
            result, updates = operation(documents)
            for key, value in updates.items():
                self.documents[key] = deepcopy(value)
            return deepcopy(result)

    async def get(self, key):
        async with self.lock:
            return deepcopy(self.documents.get(key))

    async def recoverable(self, now, limit=100):
        async with self.lock:
            jobs = [deepcopy(value) for (collection, _), value in self.documents.items()
                    if collection == "translationJobs" and value.get("recoverAt") is not None
                    and value["recoverAt"] <= now]
            return sorted(jobs, key=lambda value: value["recoverAt"])[:limit]


class FirestoreRepository:
    def __init__(self, project_id):
        from google.cloud.firestore_v1 import AsyncClient
        self.client = AsyncClient(project=project_id)

    def reference(self, key):
        collection, identifier = key
        return self.client.collection(collection).document(identifier)

    async def atomic(self, keys, operation):
        from google.cloud.firestore_v1 import async_transactional
        keys = list(dict.fromkeys(keys))

        @async_transactional
        async def execute(transaction):
            documents = {}
            for key in keys:
                snapshot = await self.reference(key).get(transaction=transaction)
                documents[key] = snapshot.to_dict() if snapshot.exists else None
            result, updates = operation(documents)
            for key, value in updates.items():
                transaction.set(self.reference(key), value)
            return result

        return await execute(self.client.transaction(max_attempts=5))

    async def get(self, key):
        snapshot = await self.reference(key).get()
        return snapshot.to_dict() if snapshot.exists else None

    async def recoverable(self, now, limit=100):
        from google.cloud.firestore_v1.base_query import FieldFilter
        query = (self.client.collection("translationJobs")
                 .where(filter=FieldFilter("recoverAt", "<=", now))
                 .order_by("recoverAt").limit(limit))
        return [snapshot.to_dict() async for snapshot in query.stream()]

    async def close(self):
        # AsyncClient inherits a synchronous HTTP cleanup method.
        self.client.close()
