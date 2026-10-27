"""Server-owned subscription access and anchored character allowance periods."""
from calendar import monthrange
from datetime import UTC, datetime, timedelta


def as_datetime(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    if type(value) in (int, float):
        try:
            return datetime.fromtimestamp(value, UTC)
        except (ValueError, OverflowError, OSError):
            return None
    if isinstance(value, str):
        try:
            return as_datetime(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def iso(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def manual_active(manual, now):
    if not manual or manual.get("plan") != "pro":
        return False
    expires = as_datetime(manual.get("expiresAt"))
    return manual.get("expiresAt") is None or expires is not None and expires > now


def access(manual, snapshot, now):
    """Manual Pro grants remain overrides; billing snapshots always expire."""
    if manual_active(manual, now):
        anchor = as_datetime(manual.get("quotaAnchorAt")) or as_datetime(manual.get("updatedAt"))
        return {"pro": True, "source": "manual", "anchor": anchor, "paidThrough": None}
    paid_through = as_datetime((snapshot or {}).get("paidThrough"))
    paid_start = as_datetime((snapshot or {}).get("paidPeriodStart"))
    anchor = as_datetime((snapshot or {}).get("quotaAnchorAt"))
    active = bool(snapshot and snapshot.get("status") in {"active", "past_due"}
                  and not snapshot.get("blockedReason") and paid_through and paid_through > now
                  and paid_start and paid_start <= now and anchor and anchor <= now)
    return {"pro": active, "source": "subscription" if active else "free",
            "anchor": anchor if active else None, "paidThrough": paid_through if active else None}


def anniversary(anchor, offset):
    # Derive each boundary from the original anchor, not the clamped prior month.
    month = anchor.year * 12 + anchor.month - 1 + offset
    year, month = divmod(month, 12)
    month += 1
    return anchor.replace(year=year, month=month, day=min(anchor.day, monthrange(year, month)[1]))


def allowance_period(effective, now):
    now = now.astimezone(UTC)
    if not effective["pro"]:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return "free:" + iso(start), start, end
    anchor = effective["anchor"]
    if anchor is None:
        raise RuntimeError("A Pro allowance requires its persisted anchor")
    offset = (now.year - anchor.year) * 12 + now.month - anchor.month
    start = anniversary(anchor, offset)
    if start > now:
        offset -= 1
        start = anniversary(anchor, offset)
    end = anniversary(anchor, offset + 1)
    if effective["paidThrough"]:
        end = min(end, effective["paidThrough"])
    return "pro:" + iso(anchor) + ":" + iso(start), start, end


def features(pro):
    return {"pageTranslation": pro, "pageContext": pro,
            "tones": ["neutral", "formal", "friendly", "technical"] if pro else ["neutral"],
            "historyLimit": 1000 if pro else 20, "priority": pro, "imageTranslation": False}
