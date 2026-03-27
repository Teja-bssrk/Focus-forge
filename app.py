import os
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from database import (
    add_message,
    authenticate_user,
    create_session,
    create_tables,
    end_session,
    get_room,
    get_user_profile_card,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    host_action,
    join_session,
    leave_session,
    list_sessions,
    overview,
    poll_signals,
    register_user,
    send_signal,
    submit_report,
    submit_review,
    update_self,
    update_user_profile,
)
from logic import APP_NAME, MOODS, ROLES, TIME_SLOTS, normalize_slots, parse_subjects, schedule_payload

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "focus-forge-secret")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"

create_tables()


def current_user():
    user_id = session.get("user_id")
    return get_user_by_id(user_id) if user_id else None


def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not current_user():
            return redirect(url_for("home"))
        return func(*args, **kwargs)

    return wrapper


def api_login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"success": False, "message": "Login required."}), 401
        return func(user, *args, **kwargs)

    return wrapper


def error(message, status=400):
    return jsonify({"success": False, "message": message}), status


def config_payload():
    return {
        "app_name": APP_NAME,
        "moods": [{"key": key, "description": value} for key, value in MOODS.items()],
        "roles": ROLES,
        "time_slots": TIME_SLOTS,
        "poll_ms": 1000,
    }


def parse_profile(data, updating=False, fallback_time_slots=None):
    display_name = str(data.get("display_name") or "").strip()
    email = str(data.get("email") or "").strip().lower()
    username = str(data.get("username") or "").strip().lower()
    password = str(data.get("password") or "")
    subjects = parse_subjects(data.get("subjects") or [])
    raw_time_slots = data.get("time_slots")
    time_slots = normalize_slots(raw_time_slots if raw_time_slots is not None else (fallback_time_slots or []))
    mood = str(data.get("mood") or "").strip()
    role = str(data.get("role") or "").strip()

    if not display_name:
        return None, "Display name is required."
    if not email:
        return None, "Email is required."
    if not username:
        return None, "Username is required."
    if not updating and len(password) < 6:
        return None, "Password must be at least 6 characters."
    if updating and password and len(password) < 6:
        return None, "Password must be at least 6 characters."
    if not subjects:
        return None, "Add at least one subject."
    if not updating and not time_slots:
        return None, "Choose at least one time slot."
    if mood not in MOODS:
        return None, "Choose a valid mood."
    if role not in ROLES:
        return None, "Choose a valid role."

    return {
        "display_name": display_name,
        "email": email,
        "username": username,
        "password": password,
        "subjects": subjects,
        "time_slots": time_slots,
        "mood": mood,
        "role": role,
    }, None


@app.route("/")
def home():
    if current_user():
        return redirect(url_for("dashboard"))
    return render_template("login.html", config=config_payload())


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("index.html", config=config_payload())


@app.get("/health")
def health():
    return jsonify({"success": True, "status": "ok", "app": APP_NAME})


@app.post("/api/register")
def api_register():
    payload, message = parse_profile(request.get_json(silent=True) or {})
    if message:
        return error(message)
    if get_user_by_email(payload["email"]):
        return error("Email already exists.")
    if get_user_by_username(payload["username"]):
        return error("Username already exists.")
    user = register_user(**payload)
    session["user_id"] = user["id"]
    session["welcome_mode"] = "new"
    return jsonify({"success": True, "redirect": url_for("dashboard"), "user": user})


@app.post("/api/login")
def api_login():
    data = request.get_json(silent=True) or {}
    identity = str(data.get("identity") or "").strip().lower()
    password = str(data.get("password") or "")
    if not identity or not password:
        return error("Enter your email or username and password.")
    user = authenticate_user(identity, password)
    if not user:
        return error("Invalid credentials.", 401)
    session["user_id"] = user["id"]
    session["welcome_mode"] = "returning"
    return jsonify({"success": True, "redirect": url_for("dashboard"), "user": user})


@app.post("/api/logout")
def api_logout():
    session.clear()
    return jsonify({"success": True, "redirect": url_for("home")})


@app.get("/api/bootstrap")
@api_login_required
def api_bootstrap(user):
    return jsonify(
        {
            "success": True,
            "user": get_user_by_id(user["id"]),
            "overview": overview(user["id"]),
            "welcome_mode": session.get("welcome_mode", "returning"),
            "browse_sessions": list_sessions(viewer_id=user["id"], only_active=True),
            "my_sessions": list_sessions(viewer_id=user["id"], scope="my"),
        }
    )


@app.put("/api/profile")
@api_login_required
def api_profile(user):
    payload, message = parse_profile(
        request.get_json(silent=True) or {},
        updating=True,
        fallback_time_slots=user.get("time_slots", []),
    )
    if message:
        return error(message)
    existing_email = get_user_by_email(payload["email"])
    if existing_email and existing_email["id"] != user["id"]:
        return error("Email already exists.")
    existing_username = get_user_by_username(payload["username"])
    if existing_username and existing_username["id"] != user["id"]:
        return error("Username already exists.")
    profile = update_user_profile(user["id"], **payload)
    return jsonify({"success": True, "profile": profile})


@app.get("/api/users/<int:user_id>/profile-card")
@api_login_required
def api_profile_card(user, user_id):
    profile = get_user_profile_card(user_id)
    if not profile:
        return error("User not found.", 404)
    return jsonify({"success": True, "profile": profile})


@app.get("/api/sessions")
@api_login_required
def api_sessions(user):
    scope = str(request.args.get("scope") or "all").strip().lower()
    subject = str(request.args.get("subject") or "").strip() or None
    time_slot = str(request.args.get("time_slot") or "").strip() or None
    session_date = str(request.args.get("session_date") or "").strip() or None
    session_time = str(request.args.get("session_time") or "").strip() or None
    period = str(request.args.get("period") or "").strip().upper() or None
    only_active = str(request.args.get("only_active") or "").lower() == "true"
    sessions = list_sessions(
        viewer_id=user["id"],
        subject=subject,
        time_slot=time_slot,
        session_date=session_date,
        session_time=session_time,
        period=period,
        scope="my" if scope == "my" else "all",
        only_active=only_active,
    )
    return jsonify({"success": True, "sessions": sessions})


@app.post("/api/sessions")
@api_login_required
def api_create_session(user):
    data = request.get_json(silent=True) or {}
    subject = parse_subjects([data.get("subject")])
    subject = subject[0] if subject else ""
    session_date = str(data.get("session_date") or "").strip()
    session_time = str(data.get("session_time") or "").strip()
    duration_minutes = int(data.get("duration_minutes") or 0)
    max_participants = int(data.get("max_participants") or 0)
    mood = str(data.get("mood") or "").strip()
    role = str(data.get("role") or "").strip()
    schedule = schedule_payload(session_date, session_time, duration_minutes)

    if not subject:
        return error("Subject is required.")
    if not schedule:
        return error("Choose a valid date and time.")
    if duration_minutes < 15 or duration_minutes > 240:
        return error("Duration must be between 15 and 240 minutes.")
    if max_participants < 2 or max_participants > 12:
        return error("Max participants must be between 2 and 12.")
    if mood not in MOODS:
        return error("Choose a valid mood.")
    if role not in ROLES:
        return error("Choose a valid role.")

    created = create_session(user["id"], subject, schedule, duration_minutes, max_participants, mood, role)
    return jsonify({"success": True, "session": created})


@app.post("/api/sessions/<int:session_id>/join")
@api_login_required
def api_join(user, session_id):
    room, message = join_session(user["id"], session_id)
    if message:
        return error(message)
    return jsonify({"success": True, "session": room})


@app.post("/api/sessions/<int:session_id>/leave")
@api_login_required
def api_leave(user, session_id):
    room, message = leave_session(user["id"], session_id)
    if message:
        return error(message)
    return jsonify({"success": True, "session": room})


@app.get("/api/sessions/<int:session_id>/room")
@api_login_required
def api_room(user, session_id):
    room, message = get_room(session_id, user["id"])
    if message:
        return error(message)
    return jsonify({"success": True, "room": room})


@app.post("/api/sessions/<int:session_id>/room/self")
@api_login_required
def api_room_self(user, session_id):
    payload = request.get_json(silent=True) or {}
    room, message = update_self(
        session_id,
        user["id"],
        mic_on=payload.get("mic_on"),
        camera_on=payload.get("camera_on"),
        hand_up=payload.get("hand_up"),
        screen_sharing=payload.get("screen_sharing"),
    )
    if message:
        return error(message)
    return jsonify({"success": True, "room": room})


@app.post("/api/sessions/<int:session_id>/room/member/<int:target_user_id>")
@api_login_required
def api_member_action(user, session_id, target_user_id):
    action = str((request.get_json(silent=True) or {}).get("action") or "").strip()
    room, message = host_action(session_id, user["id"], target_user_id, action)
    if message:
        return error(message)
    return jsonify({"success": True, "room": room})


@app.post("/api/sessions/<int:session_id>/end")
@api_login_required
def api_end(user, session_id):
    room, message = end_session(session_id, user["id"])
    if message:
        return error(message)
    return jsonify({"success": True, "room": room})


@app.post("/api/sessions/<int:session_id>/chat")
@api_login_required
def api_chat(user, session_id):
    body = str((request.get_json(silent=True) or {}).get("body") or "").strip()
    if not body:
        return error("Message cannot be empty.")
    messages, message = add_message(session_id, user["id"], body)
    if message:
        return error(message)
    return jsonify({"success": True, "messages": messages})


@app.post("/api/sessions/<int:session_id>/feedback/<int:target_user_id>/review")
@api_login_required
def api_review(user, session_id, target_user_id):
    payload = request.get_json(silent=True) or {}
    result, message = submit_review(
        session_id,
        user["id"],
        target_user_id,
        payload.get("rating"),
        payload.get("review_text"),
    )
    if message:
        return error(message)
    return jsonify({"success": True, **result})


@app.post("/api/sessions/<int:session_id>/feedback/<int:target_user_id>/report")
@api_login_required
def api_report(user, session_id, target_user_id):
    payload = request.get_json(silent=True) or {}
    result, message = submit_report(
        session_id,
        user["id"],
        target_user_id,
        payload.get("reason"),
    )
    if message:
        return error(message)
    return jsonify({"success": True, **result})


@app.get("/api/sessions/<int:session_id>/signals")
@api_login_required
def api_signals(user, session_id):
    try:
        after_id = int(request.args.get("after_id") or 0)
    except (TypeError, ValueError):
        after_id = 0
    signals, message = poll_signals(session_id, user["id"], after_id=after_id)
    if message:
        return error(message)
    return jsonify({"success": True, "signals": signals})


@app.post("/api/sessions/<int:session_id>/signals")
@api_login_required
def api_send_signal(user, session_id):
    payload = request.get_json(silent=True) or {}
    result, message = send_signal(
        session_id,
        user["id"],
        payload.get("recipient_user_id"),
        payload.get("signal_type"),
        payload.get("payload"),
    )
    if message:
        return error(message)
    return jsonify({"success": True, **result})


if __name__ == "__main__":
    app.run(
        debug=os.environ.get("FLASK_DEBUG", "1") == "1",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5050")),
    )
