from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class ApiError(Exception):
    def __init__(self, code, message, status=400, retry_after=None):
        super().__init__(code)
        self.code, self.message, self.status, self.retry_after = code, message, status, retry_after

    def public(self):
        return {"code": self.code, "message": self.message}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


Identifier = Annotated[str, StringConstraints(min_length=1, max_length=128)]
Language = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class Segment(StrictModel):
    id: Identifier
    text: Annotated[str, StringConstraints(min_length=1, max_length=4_000)]

    @model_validator(mode="after")
    def nonblank(self):
        if not self.id.strip() or not self.text.strip():
            raise ValueError("Segment identifiers and text must not be blank")
        return self


class TranslationRequest(StrictModel):
    sourceLanguage: Language
    targetLanguage: Language
    segments: Annotated[list[Segment], Field(min_length=1, max_length=24)]
    idempotencyKey: Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[\x21-\x7e]+$")]

    @model_validator(mode="after")
    def validate_segments(self):
        if self.targetLanguage.lower() == "auto":
            raise ValueError("A target language is required")
        if len({segment.id for segment in self.segments}) != len(self.segments):
            raise ValueError("Segment identifiers must be unique")
        return self


class WorkerRequest(StrictModel):
    jobId: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]
    generation: Annotated[int, Field(ge=0)] | None = None


class BillingSync(StrictModel):
    orderId: Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")]
    environment: Literal["test", "live"]
    productId: Literal["ai-translator-extension"]
    authProjectId: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    uid: Identifier
    revision: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    purchasedAt: Annotated[int, Field(ge=1, le=253402300799)]
    words: Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
    images: Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
    netGrantedWords: Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
    netGrantedImages: Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
    paymentState: Literal["pending", "paid", "partially_refunded", "refunded", "disputed", "failed", "expired"]

    @model_validator(mode="after")
    def validate_grant(self):
        if self.words + self.images == 0 or self.netGrantedWords > self.words or self.netGrantedImages > self.images:
            raise ValueError("Invalid purchase allowance")
        if self.paymentState not in {"paid", "partially_refunded"} and (self.netGrantedWords or self.netGrantedImages):
            raise ValueError("Only a paid purchase can grant units")
        return self


class ImageTranslationRequest(StrictModel):
    sourceLanguage: Language
    targetLanguage: Language
    idempotencyKey: Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[\x21-\x7e]+$")]

    @model_validator(mode="after")
    def validate_languages(self):
        if self.targetLanguage.lower() == "auto":
            raise ValueError("A target language is required")
        return self
