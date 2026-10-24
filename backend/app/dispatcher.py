import asyncio
import json
import logging

log = logging.getLogger("translator")


class MemoryDispatcher:
    """Local development only. Production uses durable Cloud Tasks."""
    def __init__(self):
        self.handler = None
        self.tasks = set()
        self.enqueued = set()

    async def enqueue(self, identifier, generation, kind="text"):
        key = (identifier, generation)
        if key in self.enqueued:
            return
        self.enqueued.add(key)
        if self.handler:
            async def run():
                try:
                    await self.handler(identifier, generation)
                except Exception:
                    log.warning("development_worker_failed")
            task = asyncio.create_task(run())
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

    async def close(self):
        for task in list(self.tasks):
            task.cancel()
        if self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)


class CloudTasksDispatcher:
    def __init__(self, settings):
        from google.cloud import tasks_v2
        self.settings = settings
        self.client = tasks_v2.CloudTasksAsyncClient()
        self.parent = self.client.queue_path(settings.task_project, settings.task_location, settings.task_queue)

    async def enqueue(self, identifier, generation, kind="text"):
        from google.api_core.exceptions import AlreadyExists
        from google.cloud import tasks_v2
        from google.protobuf.duration_pb2 import Duration
        task = {
            "name": self.client.task_path(self.settings.task_project, self.settings.task_location,
                                         self.settings.task_queue, f"translate-{identifier}-{generation}"),
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": self.settings.backend_base_url + "/internal/process-job",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"jobId": identifier, "generation": generation}).encode("utf-8"),
                "oidc_token": {"service_account_email": self.settings.task_service_account,
                               "audience": self.settings.task_audience},
            },
            "dispatch_deadline": Duration(seconds=600 if kind == "image" else 120),
        }
        try:
            await self.client.create_task(request={"parent": self.parent, "task": task}, retry=None, timeout=20)
        except AlreadyExists:
            pass

    async def close(self):
        await self.client.transport.close()
