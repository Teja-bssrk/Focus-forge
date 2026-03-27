import re
from datetime import datetime, timedelta

APP_NAME = "Focus Forge"

TIME_SLOTS = [
    {"key": "08:00-09:00", "label": "8:00 AM - 9:00 AM"},
    {"key": "09:00-10:00", "label": "9:00 AM - 10:00 AM"},
    {"key": "10:00-12:00", "label": "10:00 AM - 12:00 PM"},
    {"key": "13:00-14:00", "label": "1:00 PM - 2:00 PM"},
    {"key": "14:00-16:00", "label": "2:00 PM - 4:00 PM"},
    {"key": "17:00-18:00", "label": "5:00 PM - 6:00 PM"},
    {"key": "18:00-20:00", "label": "6:00 PM - 8:00 PM"},
    {"key": "20:00-22:00", "label": "8:00 PM - 10:00 PM"},
]

TIME_SLOT_MAP = {item["key"]: item["label"] for item in TIME_SLOTS}
TIME_LABEL_MAP = {item["label"].lower(): item["key"] for item in TIME_SLOTS}

MOODS = {
    "Focused": "Ready to concentrate deeply",
    "Motivated": "Energetic and ready to learn",
    "Sleepy": "Low energy, needs support",
    "Distracted": "Easily losing focus",
    "Stressed": "Needs calm and structured study",
}

ROLES = ["Learn", "Teach", "Learn + Teach"]

MOOD_COMPLEMENTS = {
    "Motivated": "Distracted",
    "Distracted": "Motivated",
    "Focused": "Sleepy",
    "Sleepy": "Focused",
}

SUPPORT_MOODS = {"Focused", "Motivated"}
NEEDS_SUPPORT_MOODS = {"Distracted", "Stressed", "Sleepy"}


def normalize_subject(value):
    cleaned = re.sub(r"\s+", " ", str(value or "").strip())
    if not cleaned:
        return ""
    if cleaned.isupper() and len(cleaned) <= 6:
        return cleaned
    return " ".join(part.capitalize() for part in cleaned.split(" "))


def parse_subjects(value):
    raw = value if isinstance(value, list) else str(value or "").split(",")
    seen = set()
    subjects = []
    for item in raw:
        subject = normalize_subject(item)
        key = subject.lower()
        if subject and key not in seen:
            seen.add(key)
            subjects.append(subject)
    return subjects


def _parse_hm(value):
    return datetime.strptime(str(value).strip(), "%H:%M")


def _ampm(value):
    label = value.strftime("%I:%M %p")
    return label[1:] if label.startswith("0") else label


def slot_key_to_label(slot_key):
    slot_key = str(slot_key or "").strip()
    if slot_key in TIME_SLOT_MAP:
        return TIME_SLOT_MAP[slot_key]
    parts = slot_key.split("-")
    if len(parts) != 2:
        return slot_key
    try:
        return f"{_ampm(_parse_hm(parts[0]))} - {_ampm(_parse_hm(parts[1]))}"
    except ValueError:
        return slot_key


def normalize_slot(slot):
    if isinstance(slot, dict):
        key = str(slot.get("key") or slot.get("slot_key") or "").strip()
        label = str(slot.get("label") or "").strip()
        start = slot.get("start")
        end = slot.get("end")
        if start and end:
            return build_custom_slot(start, end)
        if key:
            return {"key": key, "label": label or slot_key_to_label(key)}
        if label:
            mapped = TIME_LABEL_MAP.get(label.lower())
            if mapped:
                return {"key": mapped, "label": TIME_SLOT_MAP[mapped]}
        return None

    raw = str(slot or "").strip()
    if not raw:
        return None
    if raw in TIME_SLOT_MAP:
        return {"key": raw, "label": TIME_SLOT_MAP[raw]}
    mapped = TIME_LABEL_MAP.get(raw.lower())
    if mapped:
        return {"key": mapped, "label": TIME_SLOT_MAP[mapped]}
    if re.fullmatch(r"\d{2}:\d{2}-\d{2}:\d{2}", raw):
        return {"key": raw, "label": slot_key_to_label(raw)}
    return None


def normalize_slots(value):
    raw = value if isinstance(value, list) else [value]
    slots = []
    seen = set()
    for item in raw:
        slot = normalize_slot(item)
        if not slot or slot["key"] in seen:
            continue
        seen.add(slot["key"])
        slots.append(slot)
    return sorted(slots, key=lambda item: item["key"])


def build_custom_slot(start, end):
    try:
        start_time = _parse_hm(start)
        end_time = _parse_hm(end)
    except ValueError:
        return None
    if start_time >= end_time:
        return None
    key = f"{start_time.strftime('%H:%M')}-{end_time.strftime('%H:%M')}"
    return {"key": key, "label": slot_key_to_label(key)}


def parse_session_datetime(session_date, session_time):
    try:
        return datetime.strptime(f"{str(session_date).strip()} {str(session_time).strip()}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None


def schedule_payload(session_date, session_time, duration_minutes):
    start_at = parse_session_datetime(session_date, session_time)
    if not start_at:
        return None
    end_at = start_at + timedelta(minutes=int(duration_minutes or 0))
    slot_key = f"{start_at.strftime('%H:%M')}-{end_at.strftime('%H:%M')}"
    start_label = _ampm(start_at)
    end_label = _ampm(end_at)
    return {
        "session_start": start_at.strftime("%Y-%m-%d %H:%M:%S"),
        "session_end": end_at.strftime("%Y-%m-%d %H:%M:%S"),
        "session_date": start_at.strftime("%Y-%m-%d"),
        "session_day_label": start_at.strftime("%A"),
        "session_time_label": f"{start_label} - {end_label}",
        "session_label": f"{start_at.strftime('%a, %b %d')} | {start_label} - {end_label}",
        "period": "AM" if start_at.hour < 12 else "PM",
        "time_slot_key": slot_key,
        "time_slot_label": slot_key_to_label(slot_key),
    }


def subject_match(subject, subject_list):
    target = normalize_subject(subject).lower()
    return target in {normalize_subject(item).lower() for item in subject_list or []}


def role_score(my_role, other_role):
    if {my_role, other_role} == {"Learn", "Teach"}:
        return 20, "teach and learn roles align strongly"
    if "Learn + Teach" in {my_role, other_role}:
        return 16, "flexible role fit"
    if my_role == other_role:
        return 10, "same role match"
    return 8, "mixed role fit"


def mood_score(my_mood, other_mood):
    pair = {my_mood, other_mood}
    if my_mood in NEEDS_SUPPORT_MOODS and other_mood in SUPPORT_MOODS:
        return 20, "supportive mood pairing"
    if other_mood in NEEDS_SUPPORT_MOODS and my_mood in SUPPORT_MOODS:
        return 20, "supportive mood pairing"
    if my_mood in SUPPORT_MOODS and other_mood in SUPPORT_MOODS:
        if my_mood == other_mood:
            return 14, "same high-focus mood"
        return 16, "strong focus and motivation mix"
    if my_mood in SUPPORT_MOODS or other_mood in SUPPORT_MOODS:
        return 12, "steady support mood"
    if pair <= NEEDS_SUPPORT_MOODS:
        return 2, "needs a focused or motivated partner"
    if MOOD_COMPLEMENTS.get(my_mood) == other_mood:
        return 18, "complementary moods"
    if my_mood == other_mood:
        return 8, "same mood"
    return 6, "workable mood mix"


def score_for_user(user, target):
    subject_points = 40 if subject_match(target.get("subject"), user.get("subjects", [])) else 0
    user_slots = {item["key"] for item in normalize_slots(user.get("time_slots", []))}
    target_slot = str(target.get("time_slot_key") or target.get("time_slot") or "").strip()
    slot_points = 20 if target_slot in user_slots else 0
    mood_points, mood_reason = mood_score(user.get("mood"), target.get("mood"))
    role_points, role_reason = role_score(user.get("role"), target.get("role"))

    reasons = []
    if subject_points:
        reasons.append("subject match")
    if slot_points:
        reasons.append("slot match")
    reasons.append(mood_reason)
    reasons.append(role_reason)

    total = subject_points + slot_points + mood_points + role_points
    if total == 100:
        tag = "Perfect Match"
    elif total >= 70:
        tag = "Very Good Match"
    elif total >= 50:
        tag = "Good Match"
    else:
        tag = "Low Match"

    return {"score": total, "tag": tag, "reasons": reasons}


def profile_completeness(user):
    checks = [
        bool(user.get("display_name")),
        bool(user.get("email")),
        bool(user.get("username")),
        bool(user.get("subjects")),
        bool(user.get("time_slots")),
        bool(user.get("mood")),
        bool(user.get("role")),
    ]
    return int(sum(1 for item in checks if item) / len(checks) * 100)
