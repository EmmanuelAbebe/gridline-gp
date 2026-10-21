"""The phone's messages: JSON {s, g, b, k} at ~60 Hz (steer -1..1, gas 0..1, brake 0..1, button bitmask), plus an
optional link probe {p, r} (sequence number, last round trip ms)."""
import json

# Bit i of the phone's `k` field = BUTTON_NAMES[i] (same order as web/src/settings/settings.ts BUTTONS).
BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "BACK", "START", "GUIDE", "LS", "RS",
                "UP", "DOWN", "LEFT", "RIGHT"]
BUTTON_MASK = (1 << len(BUTTON_NAMES)) - 1


def squash(text):
    """Lowercase letters and digits only, so "s l o w  r o a d s" (odd spacing) matches "slowroads"."""
    return "".join(c for c in text.lower() if c.isalnum())


def clamp(v, lo, hi):
    return max(lo, min(hi, v))



def parse_message(text):
    """A phone message -> (the decoded JSON object, (s, g, b, k)) with every value clamped / masked, or None when it
    isn't one (bad JSON or values)."""
    try:
        d = json.loads(text)
        s = clamp(float(d.get("s", 0)), -1.0, 1.0)
        g = clamp(float(d.get("g", 0)), 0.0, 1.0)
        b = clamp(float(d.get("b", 0)), 0.0, 1.0)
        k = int(d.get("k", 0)) & BUTTON_MASK
    except (ValueError, TypeError, AttributeError):
        return None
    return d, (s, g, b, k)


def pressed(k):
    """Names of the buttons held in bitmask k."""
    return [n for i, n in enumerate(BUTTON_NAMES) if k >> i & 1]
