"""Purchase lots share the job transaction, so a credit cannot be spent twice."""
from copy import deepcopy
import hashlib

from .models import ApiError


COLLECTION = "translationPurchases"


def purchase_key(environment, order_id):
    return COLLECTION, hashlib.sha256(f"{environment}:{order_id}".encode()).hexdigest()


def purchase_documents(documents):
    return [(key, value) for key, value in documents.items() if key[0] == COLLECTION and value]


def refresh(lot):
    for unit in ("Words", "Images"):
        lot[f"available{unit}"] = max(0, lot[f"netGranted{unit}"]
                                      - lot.get(f"consumed{unit}", 0) - lot.get(f"reserved{unit}", 0))
    # Fully reserved lots must still be loaded for cancellation/expiry settlement.
    lot["open"] = any(lot.get(field, 0) > 0 for field in
                      ("availableWords", "availableImages", "reservedWords", "reservedImages"))


def summary(documents):
    values = [value for _, value in purchase_documents(documents)]
    return {"words": sum(lot.get("availableWords", 0) for lot in values),
            "images": sum(lot.get("availableImages", 0) for lot in values),
            "reservedWords": sum(lot.get("reservedWords", 0) for lot in values),
            "reservedImages": sum(lot.get("reservedImages", 0) for lot in values)}


def reserve(documents, unit, amount):
    """Monthly quota has already been allocated. Reserve only the shortfall."""
    suffix = "Words" if unit == "words" else "Images"
    allocations = []
    for key, lot in sorted(purchase_documents(documents), key=lambda item: (item[1]["purchasedAt"], item[1]["orderId"])):
        if amount <= 0:
            break
        chosen = min(amount, lot.get(f"available{suffix}", 0))
        if chosen:
            lot[f"reserved{suffix}"] = lot.get(f"reserved{suffix}", 0) + chosen
            refresh(lot)
            allocations.append({"purchaseId": key[1], "unit": unit, "amount": chosen})
            amount -= chosen
    if amount:
        raise ApiError("QUOTA_EXCEEDED" if unit == "words" else "IMAGE_QUOTA_EXCEEDED",
                       "Your monthly allowance and purchased balance are used up. Buy a package or wait for the monthly reset.", 429)
    return allocations


def release(documents, allocations, *, charge):
    for allocation in allocations:
        lot = documents.get((COLLECTION, allocation["purchaseId"]))
        suffix = "Words" if allocation["unit"] == "words" else "Images"
        amount = allocation["amount"]
        if not lot or lot.get(f"reserved{suffix}", 0) < amount:
            raise RuntimeError("A purchase reservation is missing")
        lot[f"reserved{suffix}"] -= amount
        if charge:
            lot[f"consumed{suffix}"] = lot.get(f"consumed{suffix}", 0) + amount
        # The cap may have changed during the job; never restore refunded credits.
        refresh(lot)


def apply_snapshot(documents, key, payload):
    existing = documents.get(key)
    if existing:
        for field in ("orderId", "environment", "productId", "authProjectId", "uid", "words", "images", "purchasedAt"):
            if existing[field] != payload[field]:
                raise ApiError("PURCHASE_CONFLICT", "Purchase identity or original allowance does not match.", 409)
        if payload["revision"] < existing["revision"]:
            return False
        if payload["revision"] == existing["revision"]:
            if any(existing[field] != value for field, value in payload.items()):
                raise ApiError("PURCHASE_CONFLICT", "Purchase revision has conflicting terms.", 409)
            return False
    lot = {**deepcopy(existing or {}), **payload}
    for field in ("consumedWords", "consumedImages", "reservedWords", "reservedImages"):
        lot.setdefault(field, 0)
    refresh(lot)
    documents[key] = lot
    return True
