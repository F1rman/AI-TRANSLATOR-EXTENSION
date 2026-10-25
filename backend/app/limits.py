"""Validated, server-owned monthly allowances from the packaged limits.json."""
from dataclasses import dataclass
import json
from pathlib import Path


@dataclass(frozen=True)
class PlanLimits:
    monthly_words: int
    monthly_images: int


@dataclass(frozen=True)
class MonthlyLimits:
    free: PlanLimits
    pro: PlanLimits

    def for_plan(self, pro: bool) -> PlanLimits:
        return self.pro if pro else self.free


def load_limits(path: Path | None = None) -> MonthlyLimits:
    """Fail closed on malformed configuration; there are no environment overrides."""
    path = path or Path(__file__).with_name("limits.json")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if (not isinstance(value, dict) or set(value) != {"period", "timezone", "plans"}
                or value["period"] != "calendar_month" or value["timezone"] != "UTC"
                or not isinstance(value["plans"], dict) or set(value["plans"]) != {"free", "pro"}):
            raise ValueError("Expected calendar_month, UTC and free/pro plans")
        plans = {}
        for name, plan in value["plans"].items():
            if not isinstance(plan, dict) or set(plan) != {"monthlyWords", "monthlyImages"}:
                raise ValueError("Expected monthlyWords and monthlyImages for each plan")
            if any(type(number) is not int or number < 0 for number in plan.values()):
                raise ValueError("Monthly allowances must be non-negative integers")
            plans[name] = PlanLimits(plan["monthlyWords"], plan["monthlyImages"])
        return MonthlyLimits(**plans)
    except (OSError, ValueError, TypeError) as error:
        raise RuntimeError(f"Invalid monthly limits file: {path.name}") from error
