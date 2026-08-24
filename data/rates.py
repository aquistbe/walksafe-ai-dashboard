"""Rate helpers shared by the build scripts and the re-derivation scripts.

One definition, imported by both, so a committed GeoJSON patched by
`rederive_*.py` and a GeoJSON rebuilt from source carry identical numbers.
"""


def per_10k(count, denominator, digits=2):
    """`count` per 10,000 units of `denominator`; None when either is missing
    or the denominator is not positive. Never coerces a missing count to 0:
    a zone with no joined crash data must stay `None`, not read as zero."""
    if count is None or denominator is None:
        return None
    try:
        d = float(denominator)
        c = float(count)
    except (TypeError, ValueError):
        return None
    if d != d or c != c or d <= 0:          # NaN or non-positive denominator
        return None
    return round(c / d * 10_000, digits)
