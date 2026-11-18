"""Calendar period helpers returning inclusive ``(start, end)`` date pairs."""

import calendar
from datetime import date, timedelta


def month(d: date) -> tuple[date, date]:
    """Return the first and last day of ``d``'s month."""
    return d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1])


def quarter(year: int, q: int) -> tuple[date, date]:
    """Return the first and last day of calendar quarter ``q`` (1-4) of ``year``."""
    if q not in (1, 2, 3, 4):
        raise ValueError(f"quarter must be 1-4, got {q}")
    return date(year, 3 * q - 2, 1), month(date(year, 3 * q, 1))[1]


def week_ending(d: date) -> tuple[date, date]:
    """Return the 7-day period ending on ``d``."""
    return d - timedelta(days=6), d
