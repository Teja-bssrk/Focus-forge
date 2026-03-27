import json
import os
import sqlite3
from datetime import datetime, timedelta

from werkzeug.security import check_password_hash, generate_password_hash

from logic import normalize_slots, parse_subjects, profile_completeness, schedule_payload, score_for_user, subject_match

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "focus_forge.db"))


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _to_json(value):
    return json.dumps(value or [])


def _from_json(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _table_columns(connection, table_name):
    cursor = connection.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    return {row["name"] for row in cursor.fetchall()}


def _ensure_column(connection, table_name, column_name, definition):
    if column_name not in _table_columns(connection, table_name):
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def _parse_db_datetime(value):
    if not value:
        return None
    return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")


def _format_duration_label(minutes):
    return f"{minutes} min" if minutes not in {60, 120} else ("1 hour" if minutes == 60 else "2 hours")


def _migrate_existing_rows(connection):
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT id, created_at, duration_minutes, session_start, session_end, session_date, session_day_label
        FROM sessions
        """
    )
    for row in cursor.fetchall():
        if row["session_start"] and row["session_end"] and row["session_date"]:
            continue
        base_start = _parse_db_datetime(row["created_at"])
        schedule = schedule_payload(
            base_start.strftime("%Y-%m-%d"),
            base_start.strftime("%H:%M"),
            int(row["duration_minutes"] or 60),
        )
        cursor.execute(
            """
            UPDATE sessions
            SET session_start = ?,
                session_end = ?,
                session_date = ?,
                session_day_label = ?,
                time_slot_key = ?,
                time_slot_label = ?
            WHERE id = ?
            """,
            (
                schedule["session_start"],
                schedule["session_end"],
                schedule["session_date"],
                schedule["session_day_label"],
                schedule["time_slot_key"],
                schedule["time_slot_label"],
                row["id"],
            ),
        )
    connection.commit()


def _expire_finished_sessions(connection):
    cursor = connection.cursor()
    now_text = _now()
    cursor.execute(
        """
        UPDATE sessions
        SET status = 'ended',
            end_note = CASE
                WHEN trim(coalesce(end_note, '')) = '' THEN 'Session expired.'
                ELSE end_note
            END,
            ended_at = coalesce(ended_at, ?)
        WHERE status = 'active'
          AND session_end IS NOT NULL
          AND session_end <= ?
        """,
        (now_text, now_text),
    )
    connection.commit()


def create_tables():
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            subjects TEXT NOT NULL DEFAULT '[]',
            time_slots TEXT NOT NULL DEFAULT '[]',
            mood TEXT NOT NULL DEFAULT 'Focused',
            role TEXT NOT NULL DEFAULT 'Learn',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            time_slot_key TEXT NOT NULL,
            time_slot_label TEXT NOT NULL,
            session_start TEXT,
            session_end TEXT,
            session_date TEXT,
            session_day_label TEXT,
            duration_minutes INTEGER NOT NULL,
            mood TEXT NOT NULL,
            role TEXT NOT NULL,
            max_participants INTEGER NOT NULL,
            created_by INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            end_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ended_at TEXT,
            FOREIGN KEY (created_by) REFERENCES users (id)
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            is_host INTEGER NOT NULL DEFAULT 0,
            mic_on INTEGER NOT NULL DEFAULT 1,
            camera_on INTEGER NOT NULL DEFAULT 0,
            hand_up INTEGER NOT NULL DEFAULT 0,
            screen_sharing INTEGER NOT NULL DEFAULT 0,
            mic_allowed INTEGER NOT NULL DEFAULT 1,
            camera_allowed INTEGER NOT NULL DEFAULT 1,
            joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, user_id),
            FOREIGN KEY (session_id) REFERENCES sessions (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            sender_name TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions (id)
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            reviewer_user_id INTEGER NOT NULL,
            target_user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            review_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, reviewer_user_id, target_user_id),
            FOREIGN KEY (session_id) REFERENCES sessions (id),
            FOREIGN KEY (reviewer_user_id) REFERENCES users (id),
            FOREIGN KEY (target_user_id) REFERENCES users (id)
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            reporter_user_id INTEGER NOT NULL,
            target_user_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, reporter_user_id, target_user_id),
            FOREIGN KEY (session_id) REFERENCES sessions (id),
            FOREIGN KEY (reporter_user_id) REFERENCES users (id),
            FOREIGN KEY (target_user_id) REFERENCES users (id)
        )
        """
    )

    _ensure_column(connection, "sessions", "session_start", "TEXT")
    _ensure_column(connection, "sessions", "session_end", "TEXT")
    _ensure_column(connection, "sessions", "session_date", "TEXT")
    _ensure_column(connection, "sessions", "session_day_label", "TEXT")
    _ensure_column(connection, "members", "screen_sharing", "INTEGER NOT NULL DEFAULT 0")

    _migrate_existing_rows(connection)
    _expire_finished_sessions(connection)
    connection.commit()
    connection.close()


def _feedback_metrics(connection, user_id):
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT COUNT(*) AS review_count, COALESCE(ROUND(AVG(rating), 1), 0) AS average_rating
        FROM reviews
        WHERE target_user_id = ?
        """,
        (user_id,),
    )
    review_row = cursor.fetchone()
    cursor.execute("SELECT COUNT(*) AS report_count FROM reports WHERE target_user_id = ?", (user_id,))
    report_row = cursor.fetchone()
    cursor.execute(
        """
        SELECT rating, COUNT(*) AS total
        FROM reviews
        WHERE target_user_id = ?
        GROUP BY rating
        """,
        (user_id,),
    )
    rating_breakdown = {str(score): 0 for score in range(1, 6)}
    for row in cursor.fetchall():
        rating_breakdown[str(row["rating"])] = row["total"]
    return {
        "average_rating": float(review_row["average_rating"] or 0),
        "review_count": int(review_row["review_count"] or 0),
        "report_count": int(report_row["report_count"] or 0),
        "rating_breakdown": rating_breakdown,
    }


def _recent_reviews(connection, user_id, limit=4):
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT
            r.rating,
            r.review_text,
            r.created_at,
            reviewer.display_name AS reviewer_name,
            s.subject,
            s.session_start
        FROM reviews r
        JOIN users reviewer ON reviewer.id = r.reviewer_user_id
        JOIN sessions s ON s.id = r.session_id
        WHERE r.target_user_id = ?
        ORDER BY r.created_at DESC
        LIMIT ?
        """,
        (user_id, limit),
    )
    return [
        {
            "rating": row["rating"],
            "review_text": row["review_text"],
            "created_at": row["created_at"],
            "reviewer_name": row["reviewer_name"],
            "subject": row["subject"],
            "session_start": row["session_start"],
        }
        for row in cursor.fetchall()
    ]


def _recent_reports(connection, user_id, limit=4):
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT
            r.reason,
            r.created_at,
            reporter.display_name AS reporter_name,
            s.subject,
            s.session_start
        FROM reports r
        JOIN users reporter ON reporter.id = r.reporter_user_id
        JOIN sessions s ON s.id = r.session_id
        WHERE r.target_user_id = ?
        ORDER BY r.created_at DESC
        LIMIT ?
        """,
        (user_id, limit),
    )
    return [
        {
            "reason": row["reason"],
            "created_at": row["created_at"],
            "reporter_name": row["reporter_name"],
            "subject": row["subject"],
            "session_start": row["session_start"],
        }
        for row in cursor.fetchall()
    ]


def _feedback_summary(connection, user_id, include_activity=True):
    summary = _feedback_metrics(connection, user_id)
    if include_activity:
        summary["recent_reviews"] = _recent_reviews(connection, user_id)
        summary["recent_reports"] = _recent_reports(connection, user_id)
    return summary


def _user_from_row(row, connection=None, include_feedback=False):
    if not row:
        return None
    user = dict(row)
    user["subjects"] = parse_subjects(_from_json(user.get("subjects")))
    user["time_slots"] = normalize_slots(_from_json(user.get("time_slots")))
    user["profile_completeness"] = profile_completeness(user)
    user["feedback"] = _feedback_summary(connection, user["id"]) if include_feedback and connection else {
        "average_rating": 0.0,
        "review_count": 0,
        "report_count": 0,
        "rating_breakdown": {str(score): 0 for score in range(1, 6)},
        "recent_reviews": [],
        "recent_reports": [],
    }
    user.pop("password_hash", None)
    return user


def _members(connection, session_id):
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT m.*, u.display_name, u.mood, u.role
        FROM members m
        JOIN users u ON u.id = m.user_id
        WHERE m.session_id = ?
        ORDER BY m.is_host DESC, m.joined_at ASC
        """,
        (session_id,),
    )
    results = []
    for row in cursor.fetchall():
        feedback = _feedback_metrics(connection, row["user_id"])
        results.append(
            {
                "user_id": row["user_id"],
                "display_name": row["display_name"],
                "mood": row["mood"],
                "role": row["role"],
                "is_host": bool(row["is_host"]),
                "mic_on": bool(row["mic_on"]),
                "camera_on": bool(row["camera_on"]),
                "hand_up": bool(row["hand_up"]),
                "screen_sharing": bool(row["screen_sharing"]),
                "mic_allowed": bool(row["mic_allowed"]),
                "camera_allowed": bool(row["camera_allowed"]),
                "joined_at": row["joined_at"],
                "average_rating": feedback["average_rating"],
                "review_count": feedback["review_count"],
                "report_count": feedback["report_count"],
            }
        )
    return results


def _session_from_row(connection, row, viewer_id=None):
    if not row:
        return None
    item = dict(row)
    members = _members(connection, item["id"])
    viewer = next((member for member in members if member["user_id"] == viewer_id), None) if viewer_id else None
    start_at = _parse_db_datetime(item.get("session_start") or item.get("created_at"))
    end_at = _parse_db_datetime(item.get("session_end")) or (start_at + timedelta(minutes=int(item["duration_minutes"])))
    now = datetime.now()
    remaining = 0
    if item["status"] == "active":
        remaining = max(0, int(((end_at if now >= start_at else start_at) - now).total_seconds()))
    is_live = item["status"] == "active" and start_at <= now < end_at
    is_upcoming = item["status"] == "active" and now < start_at
    schedule_label = f"{start_at.strftime('%a, %b %d')} | {start_at.strftime('%I:%M %p').lstrip('0')} - {end_at.strftime('%I:%M %p').lstrip('0')}"
    session_state_label = "LIVE" if is_live else ("Upcoming" if is_upcoming and item["status"] == "active" else "Ended")

    return {
        "id": item["id"],
        "subject": item["subject"],
        "time_slot_key": item["time_slot_key"],
        "time_slot_label": item["time_slot_label"],
        "duration_minutes": item["duration_minutes"],
        "duration_label": _format_duration_label(item["duration_minutes"]),
        "mood": item["mood"],
        "role": item["role"],
        "max_participants": item["max_participants"],
        "created_by": item["created_by"],
        "host_name": item["host_name"],
        "status": item["status"],
        "end_note": item["end_note"],
        "created_at": item["created_at"],
        "ended_at": item["ended_at"],
        "session_start": start_at.strftime("%Y-%m-%d %H:%M:%S"),
        "session_end": end_at.strftime("%Y-%m-%d %H:%M:%S"),
        "session_date": start_at.strftime("%Y-%m-%d"),
        "session_day_label": start_at.strftime("%A"),
        "session_label": schedule_label,
        "session_time_label": f"{start_at.strftime('%I:%M %p').lstrip('0')} - {end_at.strftime('%I:%M %p').lstrip('0')}",
        "participants_count": len(members),
        "members": members,
        "viewer": viewer,
        "is_member": viewer is not None,
        "is_active": item["status"] == "active",
        "is_live": is_live,
        "is_upcoming": is_upcoming,
        "session_state_label": session_state_label,
        "remaining_seconds": remaining,
    }


def register_user(display_name, email, username, password, subjects, time_slots, mood, role):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO users (display_name, email, username, password_hash, subjects, time_slots, mood, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            display_name,
            email.lower(),
            username.lower(),
            generate_password_hash(password),
            _to_json(parse_subjects(subjects)),
            _to_json(normalize_slots(time_slots)),
            mood,
            role,
        ),
    )
    connection.commit()
    user_id = cursor.lastrowid
    connection.close()
    return get_user_by_id(user_id)


def authenticate_user(identity, password):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT * FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)", (identity, identity))
    row = cursor.fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        connection.close()
        return None
    user = _user_from_row(row, connection, include_feedback=True)
    connection.close()
    return user


def get_user_by_id(user_id):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    user = _user_from_row(row, connection, include_feedback=True)
    connection.close()
    return user


def get_user_by_email(email):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT * FROM users WHERE lower(email) = lower(?)", (email,))
    row = cursor.fetchone()
    connection.close()
    return _user_from_row(row)


def get_user_by_username(username):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT * FROM users WHERE lower(username) = lower(?)", (username,))
    row = cursor.fetchone()
    connection.close()
    return _user_from_row(row)


def get_user_profile_card(user_id):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    profile = _user_from_row(row, connection, include_feedback=True)
    connection.close()
    if not profile:
        return None
    profile.pop("email", None)
    return profile


def update_user_profile(user_id, display_name, email, username, subjects, time_slots, mood, role, password=None):
    connection = get_connection()
    cursor = connection.cursor()
    if password:
        cursor.execute(
            """
            UPDATE users
            SET display_name = ?, email = ?, username = ?, subjects = ?, time_slots = ?, mood = ?, role = ?, password_hash = ?
            WHERE id = ?
            """,
            (
                display_name,
                email.lower(),
                username.lower(),
                _to_json(parse_subjects(subjects)),
                _to_json(normalize_slots(time_slots)),
                mood,
                role,
                generate_password_hash(password),
                user_id,
            ),
        )
    else:
        cursor.execute(
            """
            UPDATE users
            SET display_name = ?, email = ?, username = ?, subjects = ?, time_slots = ?, mood = ?, role = ?
            WHERE id = ?
            """,
            (
                display_name,
                email.lower(),
                username.lower(),
                _to_json(parse_subjects(subjects)),
                _to_json(normalize_slots(time_slots)),
                mood,
                role,
                user_id,
            ),
        )
    connection.commit()
    connection.close()
    return get_user_by_id(user_id)


def list_sessions(viewer_id=None, subject=None, time_slot=None, session_date=None, session_time=None, period=None, scope="all", only_active=False):
    connection = get_connection()
    _expire_finished_sessions(connection)
    cursor = connection.cursor()
    query = """
        SELECT s.*, u.display_name AS host_name
        FROM sessions s
        JOIN users u ON u.id = s.created_by
    """
    conditions = []
    params = []

    if subject:
        conditions.append("lower(s.subject) LIKE lower(?)")
        params.append(f"%{subject}%")
    if time_slot:
        conditions.append("s.time_slot_key = ?")
        params.append(time_slot)
    if session_date:
        conditions.append("s.session_date = ?")
        params.append(session_date)
    if session_time:
        conditions.append("substr(s.session_start, 12, 5) = ?")
        params.append(session_time)
    if period == "AM":
        conditions.append("CAST(substr(s.session_start, 12, 2) AS INTEGER) < 12")
    elif period == "PM":
        conditions.append("CAST(substr(s.session_start, 12, 2) AS INTEGER) >= 12")
    if only_active:
        conditions.append("s.status = 'active'")
    if scope == "my" and viewer_id:
        conditions.append("(s.created_by = ? OR EXISTS (SELECT 1 FROM members m WHERE m.session_id = s.id AND m.user_id = ?))")
        params.extend([viewer_id, viewer_id])

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.created_at DESC"

    cursor.execute(query, params)
    sessions = []
    viewer = get_user_by_id(viewer_id) if viewer_id else None
    for row in cursor.fetchall():
        session = _session_from_row(connection, row, viewer_id)
        if viewer:
            session.update(score_for_user(viewer, session))
            session["join_allowed"] = (
                session["is_live"]
                and not session["is_member"]
                and subject_match(session["subject"], viewer.get("subjects", []))
                and session["participants_count"] < session["max_participants"]
            )
            if session["is_upcoming"]:
                session["tag"] = "Starts later"
            elif not session["is_live"] and session["status"] == "active":
                session["tag"] = "Join window closed"
        sessions.append(session)
    connection.close()
    return sessions


def get_session(session_id, viewer_id=None):
    connection = get_connection()
    _expire_finished_sessions(connection)
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT s.*, u.display_name AS host_name
        FROM sessions s
        JOIN users u ON u.id = s.created_by
        WHERE s.id = ?
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    session = _session_from_row(connection, row, viewer_id)
    connection.close()
    return session


def create_session(user_id, subject, schedule, duration_minutes, max_participants, mood, role):
    if not schedule:
        return None
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO sessions (
            subject, time_slot_key, time_slot_label, session_start, session_end, session_date, session_day_label,
            duration_minutes, mood, role, max_participants, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            subject,
            schedule["time_slot_key"],
            schedule["time_slot_label"],
            schedule["session_start"],
            schedule["session_end"],
            schedule["session_date"],
            schedule["session_day_label"],
            int(duration_minutes),
            mood,
            role,
            int(max_participants),
            user_id,
        ),
    )
    session_id = cursor.lastrowid
    cursor.execute(
        """
        INSERT INTO members (session_id, user_id, is_host, mic_on, camera_on, hand_up, screen_sharing, mic_allowed, camera_allowed)
        VALUES (?, ?, 1, 1, 0, 0, 0, 1, 1)
        """,
        (session_id, user_id),
    )
    connection.commit()
    connection.close()
    return get_session(session_id, user_id)


def join_session(user_id, session_id):
    user = get_user_by_id(user_id)
    session = get_session(session_id, user_id)
    if not session:
        return None, "Session not found."
    if session["is_member"]:
        return session, None
    if not session["is_active"]:
        return None, session["end_note"] or "Session expired."
    if session["is_upcoming"]:
        return None, "You can join only when the session start time matches the current system time."
    if not session["is_live"]:
        return None, "Join window closed for this session."
    if not subject_match(session["subject"], user.get("subjects", [])):
        return None, "Subject mismatch."
    if session["participants_count"] >= session["max_participants"]:
        return None, "Session is full."

    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO members (session_id, user_id, is_host, mic_on, camera_on, hand_up, screen_sharing, mic_allowed, camera_allowed)
        VALUES (?, ?, 0, 1, 0, 0, 0, 1, 1)
        """,
        (session_id, user_id),
    )
    connection.commit()
    connection.close()
    return get_session(session_id, user_id), None


def leave_session(user_id, session_id):
    session = get_session(session_id, user_id)
    if not session:
        return None, "Session not found."
    if session["created_by"] == user_id and session["is_active"]:
        return end_session(session_id, user_id, "Session expired. Host left.")
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("DELETE FROM members WHERE session_id = ? AND user_id = ?", (session_id, user_id))
    connection.commit()
    connection.close()
    return get_session(session_id, user_id), None


def get_messages(session_id):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT sender_name, body, created_at FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,))
    rows = [dict(row) for row in cursor.fetchall()]
    connection.close()
    return rows


def get_room(session_id, viewer_id):
    session = get_session(session_id, viewer_id)
    if not session:
        return None, "Session not found."
    if not session["is_member"]:
        return None, "Join the session first."
    session["messages"] = get_messages(session_id)
    return session, None


def _session_member_exists(connection, session_id, user_id):
    cursor = connection.cursor()
    cursor.execute("SELECT 1 FROM members WHERE session_id = ? AND user_id = ?", (session_id, user_id))
    return cursor.fetchone() is not None


def _validate_feedback_target(connection, session_id, actor_user_id, target_user_id):
    _expire_finished_sessions(connection)
    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT s.*, u.display_name AS host_name
        FROM sessions s
        JOIN users u ON u.id = s.created_by
        WHERE s.id = ?
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None, "Session not found."
    session = _session_from_row(connection, row, actor_user_id)
    if actor_user_id == target_user_id:
        return None, "You cannot review or report yourself."
    if session["is_active"]:
        return None, "Reviews and reports open after the session ends."
    if not _session_member_exists(connection, session_id, actor_user_id) or not _session_member_exists(connection, session_id, target_user_id):
        return None, "Feedback is available only between session participants."
    return session, None


def submit_review(session_id, reviewer_user_id, target_user_id, rating, review_text):
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return None, "Choose a rating between 1 and 5."
    review_text = str(review_text or "").strip()
    if rating < 1 or rating > 5:
        return None, "Choose a rating between 1 and 5."
    if len(review_text) > 500:
        return None, "Review is too long."

    connection = get_connection()
    session, error = _validate_feedback_target(connection, session_id, reviewer_user_id, target_user_id)
    if error:
        connection.close()
        return None, error

    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT id
        FROM reviews
        WHERE session_id = ? AND reviewer_user_id = ? AND target_user_id = ?
        """,
        (session_id, reviewer_user_id, target_user_id),
    )
    existing = cursor.fetchone()
    if existing:
        cursor.execute(
            """
            UPDATE reviews
            SET rating = ?, review_text = ?, created_at = ?
            WHERE id = ?
            """,
            (rating, review_text, _now(), existing["id"]),
        )
    else:
        cursor.execute(
            """
            INSERT INTO reviews (session_id, reviewer_user_id, target_user_id, rating, review_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, reviewer_user_id, target_user_id, rating, review_text, _now()),
        )
    connection.commit()
    profile = get_user_profile_card(target_user_id)
    connection.close()
    return {"profile": profile, "session": session}, None


def submit_report(session_id, reporter_user_id, target_user_id, reason):
    reason = str(reason or "").strip()
    if not reason:
        return None, "Enter a report reason."
    if len(reason) > 500:
        return None, "Report reason is too long."

    connection = get_connection()
    session, error = _validate_feedback_target(connection, session_id, reporter_user_id, target_user_id)
    if error:
        connection.close()
        return None, error

    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT id
        FROM reports
        WHERE session_id = ? AND reporter_user_id = ? AND target_user_id = ?
        """,
        (session_id, reporter_user_id, target_user_id),
    )
    existing = cursor.fetchone()
    if existing:
        cursor.execute(
            """
            UPDATE reports
            SET reason = ?, created_at = ?
            WHERE id = ?
            """,
            (reason, _now(), existing["id"]),
        )
    else:
        cursor.execute(
            """
            INSERT INTO reports (session_id, reporter_user_id, target_user_id, reason, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, reporter_user_id, target_user_id, reason, _now()),
        )
    connection.commit()
    profile = get_user_profile_card(target_user_id)
    connection.close()
    return {"profile": profile, "session": session}, None


def update_self(session_id, user_id, mic_on=None, camera_on=None, hand_up=None, screen_sharing=None):
    room, error = get_room(session_id, user_id)
    if error:
        return None, error
    if not room["is_active"]:
        return None, room["end_note"] or "Session expired."
    viewer = room["viewer"]
    updates = []
    params = []
    if mic_on is not None:
        if mic_on and not viewer["mic_allowed"]:
            return None, "Host disabled your mic."
        updates.append("mic_on = ?")
        params.append(1 if mic_on else 0)
    if camera_on is not None:
        if camera_on and not viewer["camera_allowed"]:
            return None, "Host disabled your camera."
        updates.append("camera_on = ?")
        params.append(1 if camera_on else 0)
    if hand_up is not None:
        updates.append("hand_up = ?")
        params.append(1 if hand_up else 0)
    if screen_sharing is not None:
        updates.append("screen_sharing = ?")
        params.append(1 if screen_sharing else 0)
    if updates:
        connection = get_connection()
        cursor = connection.cursor()
        params.extend([session_id, user_id])
        cursor.execute(f"UPDATE members SET {', '.join(updates)} WHERE session_id = ? AND user_id = ?", params)
        connection.commit()
        connection.close()
    return get_room(session_id, user_id)


def host_action(session_id, host_user_id, target_user_id, action):
    room, error = get_room(session_id, host_user_id)
    if error:
        return None, error
    if not room["viewer"] or not room["viewer"]["is_host"]:
        return None, "Only host can control participants."
    if not room["is_active"]:
        return None, room["end_note"] or "Session expired."
    if target_user_id == host_user_id:
        return None, "Host controls cannot target host."

    connection = get_connection()
    cursor = connection.cursor()
    if action == "mute":
        cursor.execute("UPDATE members SET mic_on = 0 WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    elif action == "unmute":
        cursor.execute("UPDATE members SET mic_on = CASE WHEN mic_allowed = 1 THEN 1 ELSE 0 END WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    elif action == "disable_mic":
        cursor.execute("UPDATE members SET mic_allowed = 0, mic_on = 0 WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    elif action == "enable_mic":
        cursor.execute("UPDATE members SET mic_allowed = 1 WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    elif action == "disable_camera":
        cursor.execute("UPDATE members SET camera_allowed = 0, camera_on = 0 WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    elif action == "enable_camera":
        cursor.execute("UPDATE members SET camera_allowed = 1 WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    elif action == "kick":
        cursor.execute("DELETE FROM members WHERE session_id = ? AND user_id = ?", (session_id, target_user_id))
    else:
        connection.close()
        return None, "Unknown action."
    connection.commit()
    connection.close()
    return get_room(session_id, host_user_id)


def end_session(session_id, host_user_id, note="Session ended by host."):
    session = get_session(session_id, host_user_id)
    if not session:
        return None, "Session not found."
    if session["created_by"] != host_user_id:
        return None, "Only host can end the session."
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("UPDATE sessions SET status = 'ended', end_note = ?, ended_at = ? WHERE id = ?", (note, _now(), session_id))
    connection.commit()
    connection.close()
    return get_room(session_id, host_user_id)


def add_message(session_id, user_id, body):
    room, error = get_room(session_id, user_id)
    if error:
        return None, error
    if not room["is_active"]:
        return None, room["end_note"] or "Session expired."
    user = get_user_by_id(user_id)
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("INSERT INTO messages (session_id, sender_name, body, created_at) VALUES (?, ?, ?, ?)", (session_id, user["display_name"], body, _now()))
    connection.commit()
    connection.close()
    return get_messages(session_id), None


def overview(user_id):
    user = get_user_by_id(user_id)
    browse = list_sessions(viewer_id=user_id, only_active=True)
    mine = list_sessions(viewer_id=user_id, scope="my")
    now = datetime.now()
    weekly_cutoff = now - timedelta(days=7)
    monthly_cutoff = now - timedelta(days=30)
    recos = []
    for item in browse:
        if item["is_member"]:
            continue
        scored = dict(item)
        scored.update(score_for_user(user, item))
        recos.append(scored)
    recos.sort(key=lambda item: (-item["score"], item["subject"].lower()))
    hosted_sessions = sum(1 for item in mine if item["created_by"] == user_id)
    ended_sessions = sum(1 for item in mine if not item["is_active"])
    active_joined = sum(1 for item in mine if item["is_active"])
    completed_sessions = [item for item in mine if _parse_db_datetime(item["session_end"]) and _parse_db_datetime(item["session_end"]) <= now]
    weekly_sessions = [item for item in completed_sessions if _parse_db_datetime(item["session_start"]) >= weekly_cutoff]
    monthly_sessions = [item for item in completed_sessions if _parse_db_datetime(item["session_start"]) >= monthly_cutoff]
    weekly_topics = len({item["subject"] for item in weekly_sessions})
    monthly_topics = len({item["subject"] for item in monthly_sessions})
    weekly_minutes = sum(int(item["duration_minutes"] or 0) for item in weekly_sessions)
    monthly_minutes = sum(int(item["duration_minutes"] or 0) for item in monthly_sessions)
    points = (hosted_sessions * 40) + (active_joined * 20) + (ended_sessions * 30) + (user["profile_completeness"] // 5)
    badges = []
    if user["profile_completeness"] == 100:
        badges.append({"name": "Profile Perfect", "detail": "Completed every profile field."})
    if hosted_sessions >= 1:
        badges.append({"name": "Room Smith", "detail": "Created your first study room."})
    if hosted_sessions >= 3:
        badges.append({"name": "Session Captain", "detail": "Hosted three or more rooms."})
    if ended_sessions >= 2:
        badges.append({"name": "Closer", "detail": "Finished multiple study sessions."})
    if active_joined >= 2:
        badges.append({"name": "Momentum", "detail": "Stayed active across multiple sessions."})
    if not badges:
        badges.append({"name": "First Spark", "detail": "Create or join a room to unlock achievements."})
    return {
        "profile_completeness": user["profile_completeness"],
        "active_sessions": len(browse),
        "my_sessions": len(mine),
        "recommended_sessions": recos[:5],
        "hosted_sessions": hosted_sessions,
        "ended_sessions": ended_sessions,
        "points": points,
        "badges": badges,
        "track_progress": {
            "total_sessions": len(completed_sessions),
            "total_topics": len({item["subject"] for item in completed_sessions}),
            "total_minutes": sum(int(item["duration_minutes"] or 0) for item in completed_sessions),
            "weekly_sessions": len(weekly_sessions),
            "weekly_topics": weekly_topics,
            "weekly_minutes": weekly_minutes,
            "monthly_sessions": len(monthly_sessions),
            "monthly_topics": monthly_topics,
            "monthly_minutes": monthly_minutes,
            "recent_sessions": [
                {
                    "subject": item["subject"],
                    "session_label": item["session_label"],
                    "duration_label": item["duration_label"],
                    "role": item["role"],
                    "mood": item["mood"],
                }
                for item in sorted(completed_sessions, key=lambda row: row["session_start"], reverse=True)[:8]
            ],
        },
    }
