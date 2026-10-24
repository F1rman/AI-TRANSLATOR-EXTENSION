"""Application logs use fixed messages and numeric stage timings, never request payloads."""
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"severity": record.levelname, "message": record.getMessage()}, ensure_ascii=True)


def configure_logging():
    logger = logging.getLogger("translator")
    if not getattr(logger, "_translator_configured", False):
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
        logger._translator_configured = True
