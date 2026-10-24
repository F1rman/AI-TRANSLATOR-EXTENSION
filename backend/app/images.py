"""Decoded image validation and private object storage; no public URLs or image logs."""
import asyncio
from io import BytesIO
import warnings

from .models import ApiError


FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


def validate_image(data, *, max_bytes=10 * 1024 * 1024, max_pixels=20_000_000, png_only=False):
    from PIL import Image, UnidentifiedImageError
    invalid = ApiError("INVALID_IMAGE", "Choose a static PNG, JPEG or WebP image up to 10 MB and 20 megapixels.", 422)
    if not data or len(data) > max_bytes:
        raise invalid
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
                if (image.format not in FORMATS or (png_only and image.format != "PNG")
                        or width < 1 or height < 1 or width * height > max_pixels
                        or getattr(image, "n_frames", 1) != 1):
                    raise invalid
                mime = FORMATS[image.format]
                image.verify()
            # verify() checks structure; decoding also catches incomplete pixel data.
            with Image.open(BytesIO(data)) as image:
                image.load()
    except ApiError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise invalid from None
    return {"mimeType": mime, "width": width, "height": height, "bytes": len(data)}


class MemoryImageStorage:
    def __init__(self):
        self.objects = {}

    async def put(self, key, data, mime_type):
        self.objects[key] = (bytes(data), mime_type)

    async def get(self, key):
        if key not in self.objects:
            raise ApiError("IMAGE_UNAVAILABLE", "The image is no longer available. Start a new translation.", 410)
        return self.objects[key][0]

    async def delete(self, key):
        self.objects.pop(key, None)

    async def delete_job(self, identifier):
        for key in list(self.objects):
            if key.startswith(f"jobs/{identifier}/"):
                del self.objects[key]


class CloudImageStorage:
    def __init__(self, project_id, bucket):
        from google.cloud import storage
        self.client = storage.Client(project=project_id)
        self.bucket = self.client.bucket(bucket)

    async def put(self, key, data, mime_type):
        # Uniform bucket-level access + Public Access Prevention are deployment requirements.
        await asyncio.to_thread(self.bucket.blob(key).upload_from_string, data, content_type=mime_type, timeout=60)

    async def get(self, key):
        from google.api_core.exceptions import NotFound
        try:
            return await asyncio.to_thread(self.bucket.blob(key).download_as_bytes, timeout=60)
        except NotFound:
            raise ApiError("IMAGE_UNAVAILABLE", "The image is no longer available. Start a new translation.", 410) from None

    async def delete(self, key):
        from google.api_core.exceptions import NotFound
        try:
            await asyncio.to_thread(self.bucket.blob(key).delete, timeout=30)
        except NotFound:
            pass

    async def delete_job(self, identifier):
        def remove():
            from google.api_core.exceptions import NotFound
            for blob in self.client.list_blobs(self.bucket, prefix=f"jobs/{identifier}/"):
                try:
                    blob.delete(timeout=30)
                except NotFound:
                    pass
        await asyncio.to_thread(remove)

    async def close(self):
        self.client.close()
