const cfg = window.FORGE_CONFIG || { time_slots: [], moods: [], roles: [], poll_ms: 2000 };
const APP_TIMEZONE = "Asia/Kolkata";
const APP_UTC_OFFSET = "+05:30";
const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

const state = {
    user: null,
    overview: null,
    browse: [],
    mine: [],
    room: null,
    roomId: null,
    pollHandle: null,
    activeView: "overview",
    welcomeMode: "returning",
    slotSelections: {
        auth: new Set(),
        profile: new Set(),
    },
    userCards: {},
    media: {
        stream: null,
        screenStream: null,
        error: "",
        warningShown: false,
    },
    rtc: {
        peers: {},
        signalAfterId: 0,
        signalPollHandle: null,
    },
};

function byId(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function alertBox(target, message, type = "success") {
    const root = byId(target);
    if (!root) return;
    const el = document.createElement("div");
    el.className = `alert alert-${type}`;
    el.textContent = message;
    root.prepend(el);
    window.setTimeout(() => el.remove(), 3600);
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        body: options.data ? JSON.stringify(options.data) : undefined,
    });
    const data = await response.json();
    if (!response.ok || data.success === false) {
        throw new Error(data.message || "Request failed");
    }
    return data;
}

function remoteVideoId(userId) {
    return `remoteVideo-${userId}`;
}

function remoteFallbackId(userId) {
    return `remoteFallback-${userId}`;
}

function remoteStatusId(userId) {
    return `remoteStatus-${userId}`;
}

function remoteAudioId(userId) {
    return `remoteAudio-${userId}`;
}

function parseSubjects(raw) {
    return String(raw || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function formatCountdown(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseIstDateTime(raw) {
    const value = String(raw || "").trim();
    if (!value) return null;
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
    const parsed = new Date(`${withSeconds}${APP_UTC_OFFSET}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIstDateTime(raw, options) {
    const parsed = parseIstDateTime(raw);
    if (!parsed) return raw;
    return parsed.toLocaleString("en-IN", {
        timeZone: APP_TIMEZONE,
        ...options,
    });
}

function formatMessageTime(raw) {
    return formatIstDateTime(raw, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatFeedbackDate(raw) {
    return formatIstDateTime(raw, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function setupCursorGlow() {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const orb = document.createElement("div");
    orb.className = "cursor-orb";
    document.body.appendChild(orb);

    window.addEventListener("mousemove", (event) => {
        orb.style.left = `${event.clientX}px`;
        orb.style.top = `${event.clientY}px`;
    });

    document.body.addEventListener("mouseover", (event) => {
        if (event.target.closest("button, a, input, select, .chip, .slot-chip, .rail-link")) {
            orb.classList.add("cursor-orb-active");
        }
    });

    document.body.addEventListener("mouseout", (event) => {
        if (event.target.closest("button, a, input, select, .chip, .slot-chip, .rail-link")) {
            orb.classList.remove("cursor-orb-active");
        }
    });
}

function formatSessionDateLabel(session) {
    return session.session_label || `${session.session_day_label || ""} | ${session.session_time_label || ""}`.trim();
}

function updateSchedulePreview() {
    const form = byId("sessionForm");
    const preview = byId("schedulePreview");
    if (!form || !preview) return;
    const dateValue = form.session_date.value;
    const timeValue = form.session_time.value;
    if (!dateValue || !timeValue) {
        preview.textContent = "Choose a date and time";
        return;
    }
    const localDate = parseIstDateTime(`${dateValue} ${timeValue}:00`);
    if (!localDate) {
        preview.textContent = "Choose a valid date and time";
        return;
    }
    preview.textContent = localDate.toLocaleString("en-IN", {
        timeZone: APP_TIMEZONE,
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }) + " IST";
}

function animateCounters(container) {
    if (!container) return;
    container.querySelectorAll("strong").forEach((node) => {
        if (node.dataset.animated === "true") return;
        const raw = String(node.textContent);
        const target = Number.parseInt(raw.replace(/[^\d]/g, ""), 10);
        const suffix = raw.replace(/[\d]/g, "");
        if (Number.isNaN(target)) return;
        node.dataset.animated = "true";
        const duration = 650;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            node.textContent = `${Math.round(target * eased)}${suffix}`;
            if (progress < 1) window.requestAnimationFrame(step);
            else node.textContent = `${target}${suffix}`;
        };
        window.requestAnimationFrame(step);
    });
}

function renderSlotGroup(targetId, bucket) {
    const target = byId(targetId);
    if (!target) return;
    target.innerHTML = cfg.time_slots
        .map((slot) => `
            <button
                type="button"
                class="slot-chip ${state.slotSelections[bucket].has(slot.key) ? "active" : ""}"
                data-slot-bucket="${bucket}"
                data-slot-key="${slot.key}"
            >
                ${escapeHtml(slot.label)}
            </button>
        `)
        .join("");
}

function slotPayload(bucket) {
    const selected = new Set(state.slotSelections[bucket]);
    return cfg.time_slots.filter((slot) => selected.has(slot.key));
}

function setView(view) {
    state.activeView = view;
    document.body.dataset.view = view;
    document.querySelectorAll(".view").forEach((section) => {
        section.classList.toggle("hidden", section.id !== `view-${view}`);
    });
    document.querySelectorAll(".rail-link[data-view]").forEach((button) => {
        button.classList.toggle("active", button.dataset.view === view);
    });
    byId("viewTitle").textContent = {
        overview: "Overview",
        progress: "Track Progress",
        profile: "Profile",
        matchlab: "Match Lab",
        achievements: "Achievements",
        create: "Create Session",
        browse: "Browse Sessions",
        mine: "My Sessions",
        room: "Room",
    }[view] || "Overview";
}

function renderStats() {
    const root = byId("overviewStats");
    root.innerHTML = `
        <article class="stat-card">
            <span>Profile complete</span>
            <strong>${state.overview.profile_completeness}%</strong>
        </article>
        <article class="stat-card">
            <span>Active sessions</span>
            <strong>${state.overview.active_sessions}</strong>
        </article>
        <article class="stat-card">
            <span>My sessions</span>
            <strong>${state.overview.my_sessions}</strong>
        </article>
        <article class="stat-card">
            <span>Forge points</span>
            <strong>${state.overview.points}</strong>
        </article>
    `;
    animateCounters(root);
}

function renderWelcomeHero() {
    byId("welcomeEyebrow").textContent = state.welcomeMode === "new" ? "Fresh Forge" : "Back In Forge";
    byId("welcomeHeadline").textContent = state.welcomeMode === "new"
        ? `Welcome ${state.user.display_name}`
        : `Welcome back ${state.user.display_name}`;
    byId("welcomeCopy").textContent = state.welcomeMode === "new"
        ? "Your account is ready. Start building sessions, tracking progress, and earning badges."
        : "Your dashboard is live with your current rooms, progress analytics, and latest recommendations.";
}

function renderAchievements() {
    const root = byId("achievementStats");
    root.innerHTML = `
        <article class="stat-card">
            <span>Total points</span>
            <strong>${state.overview.points}</strong>
        </article>
        <article class="stat-card">
            <span>Hosted sessions</span>
            <strong>${state.overview.hosted_sessions}</strong>
        </article>
        <article class="stat-card">
            <span>Ended sessions</span>
            <strong>${state.overview.ended_sessions}</strong>
        </article>
        <article class="stat-card">
            <span>Badges earned</span>
            <strong>${(state.overview.badges || []).length}</strong>
        </article>
    `;
    animateCounters(root);

    byId("achievementList").innerHTML = (state.overview.badges || []).map((badge, index) => `
        <article class="achievement-card">
            <div class="achievement-orb">${String(index + 1).padStart(2, "0")}</div>
            <div>
                <h4>${escapeHtml(badge.name)}</h4>
                <p>${escapeHtml(badge.detail)}</p>
            </div>
        </article>
    `).join("");
}

function renderProgress() {
    const track = state.overview.track_progress || {};
    const stats = byId("progressStats");
    stats.innerHTML = `
        <article class="stat-card">
            <span>Total sessions</span>
            <strong>${track.total_sessions || 0}</strong>
        </article>
        <article class="stat-card">
            <span>Total topics learned</span>
            <strong>${track.total_topics || 0}</strong>
        </article>
        <article class="stat-card">
            <span>Weekly study time</span>
            <strong>${track.weekly_minutes || 0} min</strong>
        </article>
        <article class="stat-card">
            <span>Monthly study time</span>
            <strong>${track.monthly_minutes || 0} min</strong>
        </article>
    `;
    animateCounters(stats);

    byId("progressBreakdown").innerHTML = `
        <article class="achievement-card">
            <div class="achievement-orb">7D</div>
            <div>
                <h4>${track.weekly_sessions || 0} sessions this week</h4>
                <p>${track.weekly_topics || 0} topics learned in the last 7 days, with ${track.weekly_minutes || 0} minutes of study time.</p>
            </div>
        </article>
        <article class="achievement-card">
            <div class="achievement-orb">30D</div>
            <div>
                <h4>${track.monthly_sessions || 0} sessions this month</h4>
                <p>${track.monthly_topics || 0} topics learned in the last 30 days, with ${track.monthly_minutes || 0} minutes of study time.</p>
            </div>
        </article>
    `;

    const history = byId("progressHistory");
    const sessions = track.recent_sessions || [];
    history.innerHTML = sessions.length
        ? sessions.map((item) => `
            <article class="session-card">
                <div class="session-head">
                    <div>
                        <h4>${escapeHtml(item.subject)}</h4>
                        <div class="session-meta">
                            <span class="chip">${escapeHtml(item.session_label)}</span>
                            <span class="chip">${escapeHtml(item.duration_label)}</span>
                        </div>
                    </div>
                </div>
                <div class="session-meta">
                    <span class="chip">Role: ${escapeHtml(item.role)}</span>
                    <span class="chip">Mood: ${escapeHtml(item.mood)}</span>
                </div>
            </article>
        `).join("")
        : '<div class="banner info-banner">Finish some sessions to unlock progress history.</div>';
}

function renderFeedbackFeed(items, mode) {
    if (!(items || []).length) {
        return `<div class="banner info-banner">No ${mode} yet.</div>`;
    }
    return items.map((item) => `
        <article class="feedback-item">
            <div class="feedback-item-head">
                <strong>${escapeHtml(mode === "reviews" ? item.reviewer_name : item.reporter_name)}</strong>
                ${mode === "reviews" ? `<span class="chip accent-chip">${escapeHtml(`${item.rating}/5`)}</span>` : '<span class="chip danger-chip">Report</span>'}
            </div>
            <p>${escapeHtml(mode === "reviews" ? (item.review_text || "Rating submitted without written review.") : item.reason)}</p>
            <div class="feedback-meta-row">
                <span class="chip">${escapeHtml(item.subject)}</span>
                <span class="chip">${escapeHtml(formatFeedbackDate(item.created_at))}</span>
            </div>
        </article>
    `).join("");
}

function renderProfileFeedback() {
    const feedback = state.user?.feedback || {};
    const stats = byId("profileFeedbackStats");
    if (!stats) return;
    stats.innerHTML = `
        <article class="stat-card">
            <span>Average rating</span>
            <strong>${feedback.review_count ? Number(feedback.average_rating || 0).toFixed(1) : "0.0"}</strong>
        </article>
        <article class="stat-card">
            <span>Total reviews</span>
            <strong>${feedback.review_count || 0}</strong>
        </article>
        <article class="stat-card">
            <span>Reports received</span>
            <strong>${feedback.report_count || 0}</strong>
        </article>
        <article class="stat-card">
            <span>5 star ratings</span>
            <strong>${feedback.rating_breakdown?.["5"] || 0}</strong>
        </article>
    `;
    animateCounters(stats);
    byId("profileReviews").innerHTML = renderFeedbackFeed(feedback.recent_reviews || [], "reviews");
    byId("profileReports").innerHTML = renderFeedbackFeed(feedback.recent_reports || [], "reports");
}

function renderSpotlight(profile = null) {
    const root = byId("profileSpotlight");
    if (!root) return;
    if (!profile) {
        root.innerHTML = '<div class="banner info-banner">Select a participant to view their profile reputation.</div>';
        return;
    }
    const feedback = profile.feedback || {};
    root.innerHTML = `
        <div class="spotlight-head">
            <div>
                <h4>${escapeHtml(profile.display_name)}</h4>
                <p>@${escapeHtml(profile.username)} | ${escapeHtml(profile.role)} | ${escapeHtml(profile.mood)}</p>
            </div>
            <div class="chip-row">
                <span class="chip accent-chip">${escapeHtml(feedback.review_count ? `${Number(feedback.average_rating || 0).toFixed(1)} / 5` : "No rating yet")}</span>
                <span class="chip">${escapeHtml(`${feedback.review_count || 0} reviews`)}</span>
                <span class="chip">${escapeHtml(`${feedback.report_count || 0} reports`)}</span>
            </div>
        </div>
        <div class="chip-row">
            ${(profile.subjects || []).map((subject) => `<span class="chip">${escapeHtml(subject)}</span>`).join("") || '<span class="chip">No subjects listed</span>'}
        </div>
        <div class="dual-grid feedback-dual-grid">
            <div class="glass-panel">
                <h4>Recent Reviews</h4>
                <div class="feedback-feed">${renderFeedbackFeed(feedback.recent_reviews || [], "reviews")}</div>
            </div>
            <div class="glass-panel">
                <h4>Recent Reports</h4>
                <div class="feedback-feed">${renderFeedbackFeed(feedback.recent_reports || [], "reports")}</div>
            </div>
        </div>
    `;
}

async function loadProfileCard(userId) {
    const numericId = Number(userId);
    if (!numericId) return null;
    if (state.user?.id === numericId) {
        state.userCards[numericId] = state.user;
        return state.user;
    }
    if (state.userCards[numericId]) return state.userCards[numericId];
    const data = await api(`/api/users/${numericId}/profile-card`);
    state.userCards[numericId] = data.profile;
    return data.profile;
}

function updateFeedbackTarget(room) {
    const form = byId("feedbackForm");
    const meta = byId("feedbackTargetMeta");
    if (!form || !meta) return;
    const targetId = Number(form.target_user_id.value || 0);
    const target = (room?.members || []).find((member) => member.user_id === targetId);
    const hasTarget = Boolean(target);
    const formDisabled = !room || room.is_active || !hasTarget;

    if (!room) {
        meta.textContent = "Select a participant from the room.";
    } else if (room.is_active) {
        meta.textContent = "Feedback opens after the session ends.";
    } else if (target) {
        meta.textContent = `Feedback target: ${target.display_name}`;
    } else {
        meta.textContent = "Select a participant from the ended session.";
    }

    form.querySelectorAll("select, textarea, button[data-feedback-submit], input[name='reason']").forEach((field) => {
        field.disabled = formDisabled;
    });
}

function primeFeedbackTarget(member, room) {
    const form = byId("feedbackForm");
    if (!form || !member) return;
    form.target_user_id.value = member.user_id;
    updateFeedbackTarget(room || state.room);
}

function renderRecommendations() {
    const list = byId("recommendations");
    const matchLab = byId("matchLabList");
    const items = state.overview.recommended_sessions || [];
    const html = items.length
        ? items.map(renderSessionCard).join("")
        : '<div class="banner info-banner">No recommendations yet. Update your profile or create the first room.</div>';
    list.innerHTML = html;
    matchLab.innerHTML = html;
    updateStackMotion(list, items);
    updateStackMotion(matchLab, items);
}

function renderIdentity() {
    byId("identitySummary").innerHTML = `
        <span class="chip">${escapeHtml((state.user.subjects || []).join(", ") || "-")}</span>
        <span class="chip">${escapeHtml(state.user.mood)}</span>
        <span class="chip">${escapeHtml(state.user.role)}</span>
    `;
    byId("userName").textContent = state.user.display_name;
    byId("userHandle").textContent = `@${state.user.username}`;
    byId("completionPill").textContent = `Profile ${state.user.profile_completeness}%`;
    byId("roomPill").textContent = state.room?.is_active ? "Room live" : (state.roomId ? "Room expired" : "No room");
    updateRoomDock();
}

function updateStackMotion(container, items) {
    if (!container) return;
    container.classList.toggle("floating-lane", (items || []).length > 2);
}

function sessionActionButtons(session) {
    const buttons = [];
    if (session.is_member) {
        buttons.push(`<button class="btn btn-primary" type="button" data-action="open-room" data-id="${session.id}">${session.is_active ? "Open Room" : "View Box"}</button>`);
        if (!session.viewer?.is_host && session.is_active) {
            buttons.push(`<button class="btn btn-secondary" type="button" data-action="leave-session" data-id="${session.id}">Leave</button>`);
        }
        if (session.viewer?.is_host && session.is_active) {
            buttons.push(`<button class="btn btn-danger" type="button" data-action="end-session" data-id="${session.id}">End</button>`);
        }
    } else if (session.join_allowed) {
        buttons.push(`<button class="btn btn-primary" type="button" data-action="join-session" data-id="${session.id}">Join</button>`);
    } else if (session.is_active) {
        buttons.push(`<button class="btn btn-secondary" type="button" disabled>${escapeHtml(session.tag || "Unavailable")}</button>`);
    }
    return buttons.join("");
}

function renderExpiredSessionCard(session) {
    return `
        <article class="session-card session-card-expired">
            <div class="expired-accent"></div>
            <div class="expired-main">
                <div>
                    <h4>${escapeHtml(session.subject)}</h4>
                    <p>${escapeHtml(formatSessionDateLabel(session))} | Host ${escapeHtml(session.host_name)}</p>
                </div>
                <span class="mini-expired">Session expired</span>
            </div>
            <div class="session-actions">
                ${session.is_member ? `<button class="btn btn-secondary" type="button" data-action="open-room" data-id="${session.id}">View Box</button>` : ""}
            </div>
        </article>
    `;
}

function renderSessionCard(session) {
    if (!session.is_active) return renderExpiredSessionCard(session);
    const statusLabel = session.is_live ? "LIVE" : (session.is_upcoming ? "Upcoming" : (session.session_state_label || session.status));
    const statusClass = session.is_live ? "live-pill live-badge" : "pill";

    return `
        <article class="session-card">
            <div class="session-head">
                <div>
                    <h4>${escapeHtml(session.subject)}</h4>
                    <div class="session-meta">
                        <span class="chip">${escapeHtml(formatSessionDateLabel(session))}</span>
                        <span class="chip">${escapeHtml(session.duration_label)}</span>
                        <span class="chip">${escapeHtml(`${session.participants_count}/${session.max_participants} seats`)}</span>
                    </div>
                </div>
                <span class="${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="session-meta">
                <span class="chip">${escapeHtml(session.session_day_label || "")}</span>
                <span class="chip">Mood: ${escapeHtml(session.mood)}</span>
                <span class="chip">Role: ${escapeHtml(session.role)}</span>
                <span class="chip">Host: ${escapeHtml(session.host_name)}</span>
                <span class="chip">Score: ${escapeHtml(session.score || 0)}</span>
            </div>
            <div class="session-meta">${(session.reasons || []).map((item) => `<span class="chip accent-chip">${escapeHtml(item)}</span>`).join("")}</div>
            <div class="session-actions">${sessionActionButtons(session)}</div>
        </article>
    `;
}

function renderBrowse() {
    const list = byId("browseList");
    list.innerHTML = state.browse.length
        ? state.browse.map(renderSessionCard).join("")
        : '<div class="banner info-banner">No sessions found.</div>';
    updateStackMotion(list, state.browse);
}

function renderMine() {
    const list = byId("mineList");
    list.innerHTML = state.mine.length
        ? state.mine.map(renderSessionCard).join("")
        : '<div class="banner info-banner">You have no sessions yet.</div>';
    updateStackMotion(list, state.mine);
}

function renderCreatePreview() {
    const preview = byId("createPreview");
    if (!preview) return;
    const sessions = state.mine.slice(0, 4);
    preview.innerHTML = sessions.length
        ? sessions.map(renderSessionCard).join("")
        : '<div class="banner info-banner">Create a room and your live session lane will appear here.</div>';
    updateStackMotion(preview, sessions);
}

function updateRoomDock() {
    const dock = byId("roomDock");
    if (!dock) return;
    const hasRoom = Boolean(state.roomId);
    dock.classList.toggle("hidden", !hasRoom);
    document.body.dataset.roomActive = hasRoom ? "true" : "false";
    if (!hasRoom) {
        dock.innerHTML = "";
        return;
    }
    dock.innerHTML = `
        <div class="room-dock-main">
            <span class="room-dock-pulse ${state.room?.is_active ? "live" : "expired"}"></span>
            <div>
                <strong>${escapeHtml(state.room?.subject || "Session Room")}</strong>
                <p>${escapeHtml(state.room?.is_live ? "Session active in background" : (state.room?.is_upcoming ? "Session scheduled in background" : "Session expired"))} ${state.room ? `| ${escapeHtml(formatSessionDateLabel(state.room))}` : ""}</p>
            </div>
        </div>
        <button class="btn btn-primary" type="button" id="roomDockButton">${state.room?.is_active ? "Return to Room" : "Open Expired Box"}</button>
    `;
}

function renderMatchReveal(session, reveal = false) {
    const root = byId("matchReveal");
    const radar = byId("matchRadar");
    if (!root || !radar) return;
    if (!session) {
        root.innerHTML = "<h4>Best match waiting</h4><p>Run the radar to reveal your strongest live session fit.</p>";
        radar.classList.remove("scanning");
        return;
    }
    root.innerHTML = `
        <h4>${escapeHtml(session.subject)}</h4>
        <p>${escapeHtml(formatSessionDateLabel(session))}</p>
        <div class="chip-row">
            <span class="chip">${escapeHtml(session.score || 0)}% match</span>
            <span class="chip">${escapeHtml(session.mood)}</span>
            <span class="chip">${escapeHtml(session.role)}</span>
        </div>
    `;
    if (reveal) root.classList.add("reveal-pop");
    window.setTimeout(() => root.classList.remove("reveal-pop"), 700);
}

function runMatchRadar() {
    const radar = byId("matchRadar");
    const best = (state.overview?.recommended_sessions || [])[0];
    if (!radar) return;
    radar.classList.add("scanning");
    renderMatchReveal(null, false);
    window.setTimeout(() => {
        radar.classList.remove("scanning");
        renderMatchReveal(best, true);
    }, 1800);
}

function fillProfileForm() {
    const form = byId("profileForm");
    form.display_name.value = state.user.display_name || "";
    form.username.value = state.user.username || "";
    form.email.value = state.user.email || "";
    form.password.value = "";
    form.subjects.value = (state.user.subjects || []).join(", ");
    form.mood.value = state.user.mood;
    form.role.value = state.user.role;
}

async function bootstrap() {
    const data = await api("/api/bootstrap");
    state.user = data.user;
    state.userCards = { [data.user.id]: data.user };
    state.overview = data.overview;
    state.welcomeMode = data.welcome_mode || "returning";
    state.browse = data.browse_sessions;
    state.mine = data.my_sessions;
    renderStats();
    renderWelcomeHero();
    renderRecommendations();
    renderIdentity();
    renderAchievements();
    renderProgress();
    renderProfileFeedback();
    renderBrowse();
    renderMine();
    renderCreatePreview();
    renderMatchReveal((data.overview.recommended_sessions || [])[0], false);
    fillProfileForm();
}

function stopPolling() {
    if (state.pollHandle) {
        clearInterval(state.pollHandle);
        state.pollHandle = null;
    }
}

function stopSignalPolling() {
    if (state.rtc.signalPollHandle) {
        clearInterval(state.rtc.signalPollHandle);
        state.rtc.signalPollHandle = null;
    }
}

function cleanupRtcPeer(userId) {
    const peer = state.rtc.peers[userId];
    if (!peer) return;
    try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.close();
    } catch (error) {
        console.error(error);
    }
    delete state.rtc.peers[userId];
    const video = byId(remoteVideoId(userId));
    if (video) video.srcObject = null;
    const audio = byId(remoteAudioId(userId));
    if (audio) audio.srcObject = null;
}

function cleanupRtc() {
    stopSignalPolling();
    Object.keys(state.rtc.peers).forEach((userId) => cleanupRtcPeer(Number(userId)));
    state.rtc.peers = {};
    state.rtc.signalAfterId = 0;
}

function releaseLocalMedia() {
    if (state.media.stream) {
        state.media.stream.getTracks().forEach((track) => track.stop());
        state.media.stream = null;
    }
    if (state.media.screenStream) {
        state.media.screenStream.getTracks().forEach((track) => track.stop());
        state.media.screenStream = null;
    }
    Object.values(state.rtc.peers).forEach((peer) => {
        peer.pc.getSenders().forEach((sender) => {
            try {
                sender.replaceTrack(null);
            } catch (error) {
                console.error(error);
            }
        });
    });
}

async function sendRtcSignal(sessionId, recipientUserId, signalType, payload) {
    return api(`/api/sessions/${sessionId}/signals`, {
        method: "POST",
        data: {
            recipient_user_id: recipientUserId,
            signal_type: signalType,
            payload,
        },
    });
}

async function playMediaElement(element) {
    if (!element || !element.srcObject) return;
    try {
        await element.play();
    } catch (error) {
        console.debug("Media autoplay deferred", error);
    }
}

function resumeRemoteMediaPlayback() {
    document.querySelectorAll("video[id^='remoteVideo-'], audio[id^='remoteAudio-']").forEach((element) => {
        if (element.srcObject) {
            playMediaElement(element);
        }
    });
}

function attachRemoteStream(userId, peer, member) {
    const video = byId(remoteVideoId(userId));
    const audio = byId(remoteAudioId(userId));
    const fallback = byId(remoteFallbackId(userId));
    const status = byId(remoteStatusId(userId));
    const liveVideo = Boolean(peer?.stream?.getVideoTracks().some((track) => track.readyState === "live"));
    const liveAudio = Boolean(peer?.stream?.getAudioTracks().some((track) => track.readyState === "live"));
    if (video) {
        video.srcObject = liveVideo
            ? new MediaStream(peer.stream.getVideoTracks().filter((track) => track.readyState === "live"))
            : null;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.classList.toggle("hidden-preview", !liveVideo);
        if (liveVideo) playMediaElement(video);
    }
    if (audio) {
        audio.srcObject = liveAudio
            ? new MediaStream(peer.stream.getAudioTracks().filter((track) => track.readyState === "live"))
            : null;
        audio.autoplay = true;
        audio.playsInline = true;
        if (liveAudio) playMediaElement(audio);
    }
    if (fallback) fallback.classList.toggle("hidden", liveVideo);
    if (status) {
        if (liveVideo && member?.screen_sharing) status.textContent = "Live shared screen";
        else if (liveVideo) status.textContent = "Live audio/video feed";
        else if (liveAudio) status.textContent = "Live audio feed";
        else if (member?.screen_sharing) status.textContent = "Connecting shared screen...";
        else if (member?.camera_on || member?.mic_on) status.textContent = "Connecting live feed...";
        else status.textContent = "Camera and mic are off";
    }
}

function shouldInitiatePeer(member) {
    return Boolean(state.user?.id) && Boolean(member?.user_id) && state.user.id < member.user_id;
}

async function createRtcOffer(peer, member, room, force = false) {
    if (!peer || !member || !room?.id || !room?.is_live) return;
    if (!force && !shouldInitiatePeer(member)) return;
    if (peer.makingOffer) return;
    if (!force && Date.now() - (peer.lastOfferAt || 0) < 800) return;
    if (peer.pc.signalingState !== "stable") return;

    try {
        peer.makingOffer = true;
        await syncPeerTracks(peer, room);
        if (force && typeof peer.pc.restartIce === "function") {
            peer.pc.restartIce();
        }
        const offer = await peer.pc.createOffer(force ? { iceRestart: true } : undefined);
        await peer.pc.setLocalDescription(offer);
        peer.lastOfferAt = Date.now();
        await sendRtcSignal(room.id, member.user_id, "offer", peer.pc.localDescription.toJSON ? peer.pc.localDescription.toJSON() : peer.pc.localDescription);
    } catch (error) {
        console.error(error);
    } finally {
        peer.makingOffer = false;
    }
}

async function getOutgoingTracks(room) {
    if (!room?.viewer || room.viewer.user_id !== state.user?.id || !room.is_live) {
        return { audioTrack: null, videoTrack: null };
    }

    let mediaStream = null;
    let audioTrack = null;
    let videoTrack = null;

    if (room.viewer.screen_sharing && state.media.screenStream) {
        videoTrack = state.media.screenStream.getVideoTracks()[0] || null;
        if (room.viewer.mic_on && room.viewer.mic_allowed) {
            mediaStream = await ensureLocalMedia();
            audioTrack = mediaStream?.getAudioTracks()[0] || null;
        }
        return { audioTrack, videoTrack };
    }

    if (room.viewer.camera_allowed || room.viewer.mic_allowed) {
        mediaStream = await ensureLocalMedia();
    }
    if (room.viewer.camera_on && room.viewer.camera_allowed) {
        videoTrack = mediaStream?.getVideoTracks()[0] || null;
    }
    if (room.viewer.mic_on && room.viewer.mic_allowed) {
        audioTrack = mediaStream?.getAudioTracks()[0] || null;
    }
    return { audioTrack, videoTrack };
}

async function syncPeerTracks(peer, room) {
    const { audioTrack, videoTrack } = await getOutgoingTracks(room);
    const audioSender = peer.audioSender || peer.pc.getSenders().find((sender) => sender.track?.kind === "audio" || sender.__kind === "audio");
    const videoSender = peer.videoSender || peer.pc.getSenders().find((sender) => sender.track?.kind === "video" || sender.__kind === "video");

    if (audioTrack) {
        if (audioSender) await audioSender.replaceTrack(audioTrack);
    } else if (audioSender) {
        await audioSender.replaceTrack(null);
    }

    if (videoTrack) {
        if (videoSender) await videoSender.replaceTrack(videoTrack);
    } else if (videoSender) {
        await videoSender.replaceTrack(null);
    }
}

function ensureRtcPeer(room, member) {
    if (!window.RTCPeerConnection || !room?.is_live || !member || member.user_id === state.user?.id) return null;
    if (state.rtc.peers[member.user_id]) return state.rtc.peers[member.user_id];

    const peer = {
        userId: member.user_id,
        polite: state.user.id > member.user_id,
        makingOffer: false,
        ignoreOffer: false,
        pendingCandidates: [],
        stream: new MediaStream(),
        lastOfferAt: 0,
        pc: new RTCPeerConnection(RTC_CONFIG),
    };

    const audioTransceiver = peer.pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTransceiver = peer.pc.addTransceiver("video", { direction: "sendrecv" });
    audioTransceiver.sender.__kind = "audio";
    videoTransceiver.sender.__kind = "video";
    peer.audioSender = audioTransceiver.sender;
    peer.videoSender = videoTransceiver.sender;

    peer.pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            peer.stream = event.streams[0];
        } else {
            const exists = peer.stream.getTracks().some((item) => item.id === event.track.id);
            if (!exists) peer.stream.addTrack(event.track);
        }
        event.track.addEventListener("ended", () => {
            const latestMember = (state.room?.members || []).find((item) => item.user_id === member.user_id) || member;
            attachRemoteStream(member.user_id, peer, latestMember);
        });
        const latestMember = (state.room?.members || []).find((item) => item.user_id === member.user_id) || member;
        attachRemoteStream(member.user_id, peer, latestMember);
    };

    peer.pc.onicecandidate = (event) => {
        if (!event.candidate || !state.room?.id) return;
        sendRtcSignal(state.room.id, member.user_id, "candidate", event.candidate.toJSON ? event.candidate.toJSON() : event.candidate).catch((error) => {
            console.error(error);
        });
    };

    peer.pc.onconnectionstatechange = () => {
        const latestMember = (state.room?.members || []).find((item) => item.user_id === member.user_id) || member;
        attachRemoteStream(member.user_id, peer, latestMember);
        if (peer.pc.connectionState === "failed") {
            createRtcOffer(peer, latestMember, state.room, true);
        }
        if (peer.pc.connectionState === "disconnected") {
            window.setTimeout(() => {
                if (state.rtc.peers[member.user_id] === peer && state.room?.is_live) {
                    createRtcOffer(peer, latestMember, state.room, true);
                }
            }, 900);
        }
    };

    peer.pc.onnegotiationneeded = async () => {
        const latestMember = (state.room?.members || []).find((item) => item.user_id === member.user_id) || member;
        await createRtcOffer(peer, latestMember, state.room);
    };

    state.rtc.peers[member.user_id] = peer;
    attachRemoteStream(member.user_id, peer, member);
    return peer;
}

async function handleRtcSignal(room, signal) {
    const member = (room.members || []).find((item) => item.user_id === signal.sender_user_id);
    if (!member) return;
    const peer = ensureRtcPeer(room, member);
    if (!peer) return;

    if (signal.signal_type === "candidate") {
        if (!signal.payload || peer.ignoreOffer) return;
        if (!peer.pc.remoteDescription || !peer.pc.remoteDescription.type) {
            peer.pendingCandidates.push(signal.payload);
            return;
        }
        try {
            await peer.pc.addIceCandidate(signal.payload);
        } catch (error) {
            console.error(error);
        }
        return;
    }

    if (!["offer", "answer"].includes(signal.signal_type) || !signal.payload) return;
    const description = signal.payload;
    const offerCollision = description.type === "offer" && (peer.makingOffer || peer.pc.signalingState !== "stable");
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    try {
        await peer.pc.setRemoteDescription(description);
        while (peer.pendingCandidates.length) {
            const candidate = peer.pendingCandidates.shift();
            if (!candidate) continue;
            try {
                await peer.pc.addIceCandidate(candidate);
            } catch (error) {
                console.error(error);
            }
        }
        if (description.type === "offer") {
            await syncPeerTracks(peer, room);
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            await sendRtcSignal(room.id, member.user_id, "answer", peer.pc.localDescription.toJSON ? peer.pc.localDescription.toJSON() : peer.pc.localDescription);
        }
    } catch (error) {
        console.error(error);
    }
}

async function pollRtcSignals(sessionId) {
    if (!state.room?.is_live || state.room.id !== sessionId) return;
    try {
        const data = await api(`/api/sessions/${sessionId}/signals?after_id=${state.rtc.signalAfterId}`);
        const signals = data.signals || [];
        if (signals.length) {
            state.rtc.signalAfterId = signals[signals.length - 1].id;
            for (const signal of signals) {
                await handleRtcSignal(state.room, signal);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

function startSignalPolling(sessionId) {
    stopSignalPolling();
    state.rtc.signalAfterId = 0;
    state.rtc.signalPollHandle = setInterval(() => {
        pollRtcSignals(sessionId);
    }, 600);
    pollRtcSignals(sessionId);
}

async function syncRtcPeers(room) {
    if (!window.RTCPeerConnection || !room?.is_live) {
        cleanupRtc();
        return;
    }

    const activeIds = new Set((room.members || []).filter((member) => member.user_id !== state.user?.id).map((member) => member.user_id));
    Object.keys(state.rtc.peers).forEach((userId) => {
        if (!activeIds.has(Number(userId))) cleanupRtcPeer(Number(userId));
    });

    for (const member of room.members || []) {
        if (member.user_id === state.user?.id) continue;
        const peer = ensureRtcPeer(room, member);
        if (peer) {
            await syncPeerTracks(peer, room);
            attachRemoteStream(member.user_id, peer, member);
            if (shouldInitiatePeer(member) && peer.pc.signalingState === "stable" && !peer.pc.currentRemoteDescription) {
                await createRtcOffer(peer, member, room);
            }
        }
    }
}

async function ensureLocalMedia() {
    if (state.media.stream) return state.media.stream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        state.media.error = "Live camera preview is not supported in this browser.";
        return null;
    }
    try {
        state.media.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        state.media.error = "";
        return state.media.stream;
    } catch (error) {
        state.media.error = "Camera or microphone permission was blocked. Room toggles still update, but live preview is unavailable.";
        return null;
    }
}

async function ensureScreenShareStream() {
    if (state.media.screenStream) return state.media.screenStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        state.media.error = "Screen share is not supported in this browser.";
        return null;
    }
    try {
        state.media.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const [track] = state.media.screenStream.getVideoTracks();
        if (track) {
            track.addEventListener("ended", async () => {
                state.media.screenStream = null;
                if (state.room?.id) {
                    try {
                        const data = await api(`/api/sessions/${state.room.id}/room/self`, {
                            method: "POST",
                            data: { screen_sharing: false },
                        });
                        renderRoom(data.room, state.activeView === "room");
                    } catch (error) {
                        alertBox("appAlert", error.message, "error");
                    }
                }
            });
        }
        return state.media.screenStream;
    } catch (error) {
        state.media.error = "Screen selection was cancelled or blocked.";
        return null;
    }
}

async function syncLocalMedia(room) {
    const preview = byId("localPreview");
    const screenPreview = byId("screenPreview");
    const previewState = byId("localPreviewState");
    const meter = byId("micMeter");

    if (!room || !room.viewer || room.viewer.user_id !== state.user?.id || !room.is_live) {
        releaseLocalMedia();
        if (meter) meter.classList.remove("active");
        return;
    }

    const needsDevice = room.viewer.camera_allowed || room.viewer.mic_allowed;
    const stream = needsDevice ? await ensureLocalMedia() : null;
    const cameraEnabled = Boolean(room.viewer.camera_on && room.viewer.camera_allowed && room.is_live);
    const micEnabled = Boolean(room.viewer.mic_on && room.viewer.mic_allowed && room.is_live);
    const screenEnabled = Boolean(room.viewer.screen_sharing && room.is_live);

    if (screenEnabled && !state.media.screenStream) {
        await ensureScreenShareStream();
    }

    if (!stream) {
        if ((cameraEnabled || micEnabled) && room?.id) {
            try {
                const data = await api(`/api/sessions/${room.id}/room/self`, {
                    method: "POST",
                    data: { camera_on: false, mic_on: false },
                });
                renderRoom(data.room, state.activeView === "room");
                return;
            } catch (error) {
                console.error(error);
            }
        }
        if (previewState) {
            previewState.textContent = room.viewer.camera_allowed ? (state.media.error || "Camera preview unavailable.") : "Camera disabled by host";
        }
        if (meter) meter.classList.toggle("active", false);
        if (state.media.error && !state.media.warningShown) {
            alertBox("appAlert", state.media.error, "error");
            state.media.warningShown = true;
        }
        return;
    }

    stream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
    });
    stream.getVideoTracks().forEach((track) => {
        track.enabled = cameraEnabled;
    });

    if (preview) {
        preview.srcObject = stream;
        preview.muted = true;
        preview.autoplay = true;
        preview.playsInline = true;
        preview.classList.toggle("hidden-preview", !cameraEnabled);
    }
    if (screenPreview) {
        screenPreview.srcObject = state.media.screenStream || null;
        screenPreview.autoplay = true;
        screenPreview.playsInline = true;
        screenPreview.classList.toggle("hidden-preview", !screenEnabled || !state.media.screenStream);
    }

    if (previewState) {
        if (screenEnabled) previewState.textContent = "Live screen share";
        else if (!room.viewer.camera_allowed) previewState.textContent = "Camera disabled by host";
        else if (cameraEnabled) previewState.textContent = "Live camera preview";
        else previewState.textContent = "Camera is off";
    }
    if (meter) meter.classList.toggle("active", micEnabled);
    await syncRtcPeers(room);
}

function renderRoom(room, focusRoom = false) {
    state.room = room;
    state.roomId = room.id;
    renderIdentity();
    if (focusRoom) setView("room");

    byId("roomTitle").textContent = `${room.subject} Room`;
    byId("roomMeta").textContent = `${formatSessionDateLabel(room)} | ${room.duration_label} | Host ${room.host_name}`;
    byId("roomTimer").textContent = room.is_live
        ? `Ends in ${formatCountdown(room.remaining_seconds)}`
        : (room.is_upcoming ? `Starts in ${formatCountdown(room.remaining_seconds)}` : "Ended");

    const banner = byId("roomBanner");
    banner.textContent = room.is_live
        ? "Session active. Camera, mic, and screen-share controls are live on this portal."
        : (room.is_upcoming ? "Session scheduled. Members can join early and wait for the start time." : (room.end_note || "Session expired."));
    banner.className = `banner ${room.is_active ? "active-banner" : "expired-banner"}`;

    const endButton = byId("endSessionButton");
    endButton.style.display = room.viewer?.is_host ? "inline-flex" : "none";
    endButton.disabled = !room.is_active;
    const leaveButton = byId("roomLeaveButton");
    leaveButton.style.display = room.viewer?.is_host ? "none" : "inline-flex";
    leaveButton.disabled = !room.is_active;
    updateFeedbackTarget(room);

    const micLabel = !room.viewer?.mic_allowed ? "Mic Blocked" : (room.viewer?.mic_on ? "Mic On" : "Mic Off");
    const cameraLabel = !room.viewer?.camera_allowed ? "Camera Blocked" : (room.viewer?.camera_on ? "Camera On" : "Camera Off");
    const screenLabel = room.viewer?.screen_sharing ? "Stop Share" : "Share Screen";

    byId("selfControls").innerHTML = `
        <button class="chip portal-chip ${room.viewer?.mic_on && room.viewer?.mic_allowed ? "active" : ""}" type="button" data-self="mic" ${room.is_live ? "" : "disabled"}>
            ${micLabel}
        </button>
        <button class="chip portal-chip ${room.viewer?.camera_on && room.viewer?.camera_allowed ? "active" : ""}" type="button" data-self="camera" ${room.is_live ? "" : "disabled"}>
            ${cameraLabel}
        </button>
        <button class="chip portal-chip ${room.viewer?.screen_sharing ? "active" : ""}" type="button" data-self="screen" ${room.is_live ? "" : "disabled"}>
            ${screenLabel}
        </button>
        <button class="chip portal-chip ${room.viewer?.hand_up ? "active" : ""}" type="button" data-self="hand" ${room.is_live ? "" : "disabled"}>
            ${room.viewer?.hand_up ? "✋ Hand Up" : "✋ Raise Hand"}
        </button>
        <span class="mic-meter ${room.viewer?.mic_on && room.viewer?.mic_allowed && room.is_live ? "active" : ""}" id="micMeter">Mic Signal</span>
    `;

    byId("participants").innerHTML = room.members.map((member) => {
        const initials = member.display_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const isSelf = member.user_id === state.user?.id;
        const liveCamera = isSelf && member.camera_on && member.camera_allowed && room.is_live && !member.screen_sharing;
        const liveScreen = isSelf && member.screen_sharing && room.is_live;
        const screenMarkup = isSelf ? `
            <div class="participant-screen self-screen ${liveCamera || liveScreen ? "is-live" : ""}">
                <video id="screenPreview" class="local-preview ${liveScreen ? "" : "hidden-preview"}" autoplay muted playsinline></video>
                <video id="localPreview" class="local-preview ${liveCamera ? "" : "hidden-preview"}" autoplay muted playsinline></video>
                <div class="screen-fallback ${liveCamera || liveScreen ? "hidden" : ""}">
                    <strong>${escapeHtml(initials)}</strong>
                    <span>${escapeHtml(member.display_name)}</span>
                </div>
                <div class="screen-status" id="localPreviewState">${liveScreen ? "Live screen share" : (liveCamera ? "Live camera preview" : (member.camera_allowed ? "Camera is off" : "Camera disabled by host"))}</div>
            </div>
        ` : `
            <div class="participant-screen">
                <video id="${remoteVideoId(member.user_id)}" class="local-preview hidden-preview" autoplay playsinline></video>
                <div class="screen-fallback" id="${remoteFallbackId(member.user_id)}">
                    <strong>${escapeHtml(initials)}</strong>
                    <span>${escapeHtml(member.display_name)}</span>
                </div>
                <div class="screen-status" id="${remoteStatusId(member.user_id)}">${member.screen_sharing ? "Waiting for shared screen" : (member.camera_on || member.mic_on ? "Waiting for live feed" : "Camera and mic are off")}</div>
            </div>
        `;

        const hostTools = room.viewer?.is_host && !member.is_host && room.is_live ? `
            <div class="chip-row">
                <button class="chip portal-chip" type="button" data-host="mute" data-user="${member.user_id}">Mute</button>
                <button class="chip portal-chip" type="button" data-host="unmute" data-user="${member.user_id}">Unmute</button>
                <button class="chip portal-chip" type="button" data-host="disable_mic" data-user="${member.user_id}">Disable Mic</button>
                <button class="chip portal-chip" type="button" data-host="enable_mic" data-user="${member.user_id}">Enable Mic</button>
                <button class="chip portal-chip" type="button" data-host="disable_camera" data-user="${member.user_id}">Disable Cam</button>
                <button class="chip portal-chip" type="button" data-host="enable_camera" data-user="${member.user_id}">Enable Cam</button>
                <button class="chip portal-chip danger-chip" type="button" data-host="kick" data-user="${member.user_id}">Kick</button>
            </div>
        ` : "";

        const feedbackTools = !isSelf ? `
            <div class="chip-row participant-action-row">
                <button class="chip portal-chip" type="button" data-profile-open="${member.user_id}">View Profile</button>
                <button class="chip portal-chip" type="button" data-feedback-open="${member.user_id}">Review / Report</button>
            </div>
        ` : `
            <div class="chip-row participant-action-row">
                <button class="chip portal-chip" type="button" data-profile-open="${member.user_id}">View My Profile</button>
            </div>
        `;

        return `
            <article class="participant-card ${isSelf ? "self-card" : ""}">
                ${screenMarkup}
                <div class="chip-row">
                    ${member.is_host ? '<span class="chip active">Host</span>' : ""}
                    ${isSelf ? '<span class="chip accent-chip">You</span>' : ""}
                    ${member.screen_sharing ? '<span class="chip accent-chip">Sharing Screen</span>' : ""}
                    <span class="chip">${member.mic_on ? "Mic On" : "Mic Off"}</span>
                    <span class="chip">${member.camera_on ? "Cam On" : "Cam Off"}</span>
                    <span class="chip">${member.hand_up ? "✋ Hand Up" : "✋ Hand Down"}</span>
                    <span class="chip">${member.mic_allowed ? "Mic Enabled" : "Mic Locked"}</span>
                    <span class="chip">${member.camera_allowed ? "Cam Enabled" : "Cam Locked"}</span>
                    <span class="chip">${escapeHtml(member.role)}</span>
                    <span class="chip accent-chip">${escapeHtml(member.review_count ? `${Number(member.average_rating || 0).toFixed(1)} stars` : "No rating yet")}</span>
                    <span class="chip">${escapeHtml(`${member.review_count || 0} reviews`)}</span>
                    <span class="chip">${escapeHtml(`${member.report_count || 0} reports`)}</span>
                </div>
                ${feedbackTools}
                ${hostTools}
            </article>
        `;
    }).join("");

    byId("messages").innerHTML = room.messages.length
        ? room.messages.map((message) => `
            <div class="message">
                <strong>${escapeHtml(message.sender_name)}</strong>
                <div>${escapeHtml(message.body)}</div>
                <time>${escapeHtml(formatMessageTime(message.created_at))}</time>
            </div>
        `).join("")
        : '<div class="banner info-banner">No messages yet.</div>';

    const messages = byId("messages");
    if (messages) messages.scrollTop = messages.scrollHeight;

    syncLocalMedia(room);
    Object.values(state.rtc.peers).forEach((peer) => {
        const member = (room.members || []).find((item) => item.user_id === peer.userId);
        if (member) attachRemoteStream(peer.userId, peer, member);
    });
}

async function openRoom(sessionId, focusRoom = true) {
    const data = await api(`/api/sessions/${sessionId}/room`);
    cleanupRtc();
    renderRoom(data.room, focusRoom);
    stopPolling();
    startSignalPolling(sessionId);
    state.pollHandle = setInterval(async () => {
        try {
            const fresh = await api(`/api/sessions/${sessionId}/room`);
            renderRoom(fresh.room, false);
        } catch (error) {
            stopPolling();
            cleanupRtc();
        }
    }, cfg.poll_ms || 2000);
}

function renderRoom(room, focusRoom = false) {
    state.room = room;
    state.roomId = room.id;
    renderIdentity();
    if (focusRoom) setView("room");

    byId("roomTitle").textContent = `${room.subject} Room`;
    byId("roomMeta").textContent = `${formatSessionDateLabel(room)} | ${room.duration_label} | Host ${room.host_name}`;
    byId("roomTimer").textContent = room.is_live
        ? `Ends in ${formatCountdown(room.remaining_seconds)}`
        : (room.is_upcoming ? `Starts in ${formatCountdown(room.remaining_seconds)}` : "Ended");

    const banner = byId("roomBanner");
    banner.textContent = room.is_live
        ? "Session active. Camera, mic, and screen-share controls are live on this portal."
        : (room.is_upcoming ? "Session scheduled. Members can join early and wait for the start time." : (room.end_note || "Session expired."));
    banner.className = `banner ${room.is_active ? "active-banner" : "expired-banner"}`;

    const endButton = byId("endSessionButton");
    endButton.style.display = room.viewer?.is_host ? "inline-flex" : "none";
    endButton.disabled = !room.is_active;
    const leaveButton = byId("roomLeaveButton");
    leaveButton.style.display = room.viewer?.is_host ? "none" : "inline-flex";
    leaveButton.disabled = !room.is_active;
    updateFeedbackTarget(room);

    const micLabel = !room.viewer?.mic_allowed ? "Mic Blocked" : (room.viewer?.mic_on ? "Mic On" : "Mic Off");
    const cameraLabel = !room.viewer?.camera_allowed ? "Camera Blocked" : (room.viewer?.camera_on ? "Camera On" : "Camera Off");
    const screenLabel = room.viewer?.screen_sharing ? "Stop Share" : "Share Screen";

    byId("selfControls").innerHTML = `
        <button class="chip portal-chip ${room.viewer?.mic_on && room.viewer?.mic_allowed ? "active" : ""}" type="button" data-self="mic" ${room.is_live ? "" : "disabled"}>
            ${micLabel}
        </button>
        <button class="chip portal-chip ${room.viewer?.camera_on && room.viewer?.camera_allowed ? "active" : ""}" type="button" data-self="camera" ${room.is_live ? "" : "disabled"}>
            ${cameraLabel}
        </button>
        <button class="chip portal-chip ${room.viewer?.screen_sharing ? "active" : ""}" type="button" data-self="screen" ${room.is_live ? "" : "disabled"}>
            ${screenLabel}
        </button>
        <button class="chip portal-chip ${room.viewer?.hand_up ? "active" : ""}" type="button" data-self="hand" ${room.is_live ? "" : "disabled"}>
            ${room.viewer?.hand_up ? "\u270B Hand Up" : "\u270B Raise Hand"}
        </button>
        <span class="mic-meter ${room.viewer?.mic_on && room.viewer?.mic_allowed && room.is_live ? "active" : ""}" id="micMeter">Mic Signal</span>
    `;

    byId("participants").innerHTML = room.members.map((member) => {
        const initials = member.display_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const isSelf = member.user_id === state.user?.id;
        const liveCamera = isSelf && member.camera_on && member.camera_allowed && room.is_live && !member.screen_sharing;
        const liveScreen = isSelf && member.screen_sharing && room.is_live;
        const screenMarkup = isSelf ? `
            <div class="participant-screen self-screen ${liveCamera || liveScreen ? "is-live" : ""}">
                <video id="screenPreview" class="local-preview ${liveScreen ? "" : "hidden-preview"}" autoplay muted playsinline></video>
                <video id="localPreview" class="local-preview ${liveCamera ? "" : "hidden-preview"}" autoplay muted playsinline></video>
                <div class="screen-fallback ${liveCamera || liveScreen ? "hidden" : ""}">
                    <strong>${escapeHtml(initials)}</strong>
                    <span>${escapeHtml(member.display_name)}</span>
                </div>
                <div class="screen-status" id="localPreviewState">${liveScreen ? "Live screen share" : (liveCamera ? "Live camera preview" : (member.camera_allowed ? "Camera is off" : "Camera disabled by host"))}</div>
            </div>
        ` : `
            <div class="participant-screen">
                <video id="${remoteVideoId(member.user_id)}" class="local-preview hidden-preview" autoplay muted playsinline></video>
                <audio id="${remoteAudioId(member.user_id)}" autoplay playsinline></audio>
                <div class="screen-fallback" id="${remoteFallbackId(member.user_id)}">
                    <strong>${escapeHtml(initials)}</strong>
                    <span>${escapeHtml(member.display_name)}</span>
                </div>
                <div class="screen-status" id="${remoteStatusId(member.user_id)}">${member.screen_sharing ? "Waiting for shared screen" : (member.camera_on || member.mic_on ? "Waiting for live feed" : "Camera and mic are off")}</div>
            </div>
        `;

        const hostTools = room.viewer?.is_host && !member.is_host && room.is_live ? `
            <div class="chip-row">
                <button class="chip portal-chip" type="button" data-host="mute" data-user="${member.user_id}">Mute</button>
                <button class="chip portal-chip" type="button" data-host="unmute" data-user="${member.user_id}">Unmute</button>
                <button class="chip portal-chip" type="button" data-host="disable_mic" data-user="${member.user_id}">Disable Mic</button>
                <button class="chip portal-chip" type="button" data-host="enable_mic" data-user="${member.user_id}">Enable Mic</button>
                <button class="chip portal-chip" type="button" data-host="disable_camera" data-user="${member.user_id}">Disable Cam</button>
                <button class="chip portal-chip" type="button" data-host="enable_camera" data-user="${member.user_id}">Enable Cam</button>
                <button class="chip portal-chip danger-chip" type="button" data-host="kick" data-user="${member.user_id}">Kick</button>
            </div>
        ` : "";

        const feedbackTools = !isSelf ? `
            <div class="chip-row participant-action-row">
                <button class="chip portal-chip" type="button" data-profile-open="${member.user_id}">View Profile</button>
                <button class="chip portal-chip" type="button" data-feedback-open="${member.user_id}">Review / Report</button>
            </div>
        ` : `
            <div class="chip-row participant-action-row">
                <button class="chip portal-chip" type="button" data-profile-open="${member.user_id}">View My Profile</button>
            </div>
        `;

        return `
            <article class="participant-card ${isSelf ? "self-card" : ""}">
                ${screenMarkup}
                <div class="chip-row">
                    ${member.is_host ? '<span class="chip active">Host</span>' : ""}
                    ${isSelf ? '<span class="chip accent-chip">You</span>' : ""}
                    ${member.screen_sharing ? '<span class="chip accent-chip">Sharing Screen</span>' : ""}
                    <span class="chip">${member.mic_on ? "Mic On" : "Mic Off"}</span>
                    <span class="chip">${member.camera_on ? "Cam On" : "Cam Off"}</span>
                    <span class="chip">${member.hand_up ? "\u270B Hand Up" : "\u270B Hand Down"}</span>
                    <span class="chip">${member.mic_allowed ? "Mic Enabled" : "Mic Locked"}</span>
                    <span class="chip">${member.camera_allowed ? "Cam Enabled" : "Cam Locked"}</span>
                    <span class="chip">${escapeHtml(member.role)}</span>
                    <span class="chip accent-chip">${escapeHtml(member.review_count ? `${Number(member.average_rating || 0).toFixed(1)} stars` : "No rating yet")}</span>
                    <span class="chip">${escapeHtml(`${member.review_count || 0} reviews`)}</span>
                    <span class="chip">${escapeHtml(`${member.report_count || 0} reports`)}</span>
                </div>
                ${feedbackTools}
                ${hostTools}
            </article>
        `;
    }).join("");

    byId("messages").innerHTML = room.messages.length
        ? room.messages.map((message) => `
            <div class="message">
                <strong>${escapeHtml(message.sender_name)}</strong>
                <div>${escapeHtml(message.body)}</div>
                <time>${escapeHtml(formatMessageTime(message.created_at))}</time>
            </div>
        `).join("")
        : '<div class="banner info-banner">No messages yet.</div>';

    const messages = byId("messages");
    if (messages) messages.scrollTop = messages.scrollHeight;

    syncLocalMedia(room);
    Object.values(state.rtc.peers).forEach((peer) => {
        const latestMember = (room.members || []).find((item) => item.user_id === peer.userId);
        if (latestMember) attachRemoteStream(peer.userId, peer, latestMember);
    });
}

async function openRoom(sessionId, focusRoom = true) {
    const data = await api(`/api/sessions/${sessionId}/room`);
    cleanupRtc();
    renderRoom(data.room, focusRoom);
    stopPolling();
    startSignalPolling(sessionId);
    state.pollHandle = setInterval(async () => {
        try {
            const fresh = await api(`/api/sessions/${sessionId}/room`);
            renderRoom(fresh.room, false);
        } catch (error) {
            stopPolling();
            cleanupRtc();
            releaseLocalMedia();
            state.room = null;
            state.roomId = null;
            try {
                await bootstrap();
            } catch (bootstrapError) {
                console.error(bootstrapError);
            }
            setView("mine");
            alertBox(
                "appAlert",
                /join the session first/i.test(error.message || "")
                    ? "You were removed from this live session."
                    : (error.message || "Live room connection was lost."),
                "error",
            );
        }
    }, cfg.poll_ms || 1000);
}

function authPayload(form, bucket) {
    return {
        display_name: form.display_name.value.trim(),
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
        subjects: parseSubjects(form.subjects.value),
        time_slots: slotPayload(bucket),
        mood: form.mood.value,
        role: form.role.value,
    };
}

document.addEventListener("DOMContentLoaded", async () => {
    setupCursorGlow();
    const page = document.body.dataset.page;

    if (page === "auth") {
        renderSlotGroup("authSlots", "auth");

        document.querySelectorAll(".tab").forEach((button) => {
            button.addEventListener("click", () => {
                document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
                byId("loginForm").classList.toggle("hidden", button.dataset.tab !== "login");
                byId("signupForm").classList.toggle("hidden", button.dataset.tab !== "signup");
            });
        });

        document.body.addEventListener("click", (event) => {
            const chip = event.target.closest("[data-slot-bucket]");
            if (!chip) return;
            const bucket = chip.dataset.slotBucket;
            const key = chip.dataset.slotKey;
            if (state.slotSelections[bucket].has(key)) state.slotSelections[bucket].delete(key);
            else state.slotSelections[bucket].add(key);
            renderSlotGroup(bucket === "auth" ? "authSlots" : "profileSlots", bucket);
        });

        byId("loginForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                const data = await api("/api/login", {
                    method: "POST",
                    data: {
                        identity: event.currentTarget.identity.value.trim(),
                        password: event.currentTarget.password.value,
                    },
                });
                window.location.href = data.redirect;
            } catch (error) {
                alertBox("authAlert", error.message, "error");
            }
        });

        byId("signupForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                const data = await api("/api/register", { method: "POST", data: authPayload(event.currentTarget, "auth") });
                window.location.href = data.redirect;
            } catch (error) {
                alertBox("authAlert", error.message, "error");
            }
        });
        return;
    }

    document.querySelectorAll(".rail-link[data-view]").forEach((button) => {
        button.addEventListener("click", () => setView(button.dataset.view));
    });

    byId("logoutButton").addEventListener("click", async () => {
        releaseLocalMedia();
        stopPolling();
        cleanupRtc();
        const data = await api("/api/logout", { method: "POST" });
        window.location.href = data.redirect;
    });

    document.body.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-slot-bucket]");
        if (!chip) return;
        const bucket = chip.dataset.slotBucket;
        const key = chip.dataset.slotKey;
        if (state.slotSelections[bucket].has(key)) state.slotSelections[bucket].delete(key);
        else state.slotSelections[bucket].add(key);
        renderSlotGroup("profileSlots", bucket);
    });

    byId("profileForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const form = event.currentTarget;
            const data = await api("/api/profile", {
                method: "PUT",
                data: {
                    display_name: form.display_name.value.trim(),
                    username: form.username.value.trim(),
                    email: form.email.value.trim(),
                    password: form.password.value,
                    subjects: parseSubjects(form.subjects.value),
                    mood: form.mood.value,
                    role: form.role.value,
                },
            });
            state.user = data.profile;
            await bootstrap();
            alertBox("appAlert", "Profile updated.");
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    byId("sessionForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const form = event.currentTarget;
            const data = await api("/api/sessions", {
                method: "POST",
                data: {
                    subject: form.subject.value.trim(),
                    session_date: form.session_date.value,
                    session_time: form.session_time.value,
                    duration_minutes: Number(form.duration_minutes.value),
                    max_participants: Number(form.max_participants.value),
                    mood: form.mood.value,
                    role: form.role.value,
                },
            });
            await bootstrap();
            await openRoom(data.session.id);
            alertBox("appAlert", "Session created.");
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    byId("filterForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const subject = event.currentTarget.subject.value.trim();
            const sessionDate = event.currentTarget.session_date.value;
            const sessionTime = event.currentTarget.session_time.value;
            const query = new URLSearchParams({ only_active: "true" });
            if (subject) query.set("subject", subject);
            if (sessionDate) query.set("session_date", sessionDate);
            if (sessionTime) query.set("session_time", sessionTime);
            const data = await api(`/api/sessions?${query.toString()}`);
            state.browse = data.sessions;
            renderBrowse();
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    byId("clearFilters").addEventListener("click", async () => {
        byId("filterForm").reset();
        await bootstrap();
    });

    document.body.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-action]");
        if (action) {
            try {
                const id = action.dataset.id;
                if (action.dataset.action === "join-session") {
                    await api(`/api/sessions/${id}/join`, { method: "POST" });
                    await bootstrap();
                    await openRoom(id, true);
                } else if (action.dataset.action === "open-room") {
                    await openRoom(id, true);
                } else if (action.dataset.action === "leave-session") {
                    await api(`/api/sessions/${id}/leave`, { method: "POST" });
                    state.room = null;
                    state.roomId = null;
                    releaseLocalMedia();
                    stopPolling();
                    cleanupRtc();
                    await bootstrap();
                    setView("mine");
                } else if (action.dataset.action === "end-session") {
                    await api(`/api/sessions/${id}/end`, { method: "POST" });
                    await bootstrap();
                    if (state.roomId === Number(id)) await openRoom(id, state.activeView === "room");
                }
            } catch (error) {
                alertBox("appAlert", error.message, "error");
            }
            return;
        }

        if (event.target.id === "roomDockButton" && state.roomId) {
            setView("room");
            return;
        }

        const self = event.target.closest("[data-self]");
        if (self && state.room) {
            try {
                if (self.dataset.self === "leave") {
                    await api(`/api/sessions/${state.room.id}/leave`, { method: "POST" });
                    state.room = null;
                    state.roomId = null;
                    releaseLocalMedia();
                    stopPolling();
                    cleanupRtc();
                    await bootstrap();
                    setView("mine");
                    return;
                }
                const payload = {};
                if (self.dataset.self === "screen") {
                    if (!state.room.viewer.screen_sharing) {
                        const screen = await ensureScreenShareStream();
                        if (!screen) {
                            alertBox("appAlert", state.media.error || "Unable to start screen share.", "error");
                            return;
                        }
                    } else if (state.media.screenStream) {
                        state.media.screenStream.getTracks().forEach((track) => track.stop());
                        state.media.screenStream = null;
                    }
                    payload.screen_sharing = !state.room.viewer.screen_sharing;
                }
                if (self.dataset.self === "mic") payload.mic_on = !state.room.viewer.mic_on;
                if (self.dataset.self === "camera") payload.camera_on = !state.room.viewer.camera_on;
                if (self.dataset.self === "hand") payload.hand_up = !state.room.viewer.hand_up;
                const data = await api(`/api/sessions/${state.room.id}/room/self`, { method: "POST", data: payload });
                renderRoom(data.room);
            } catch (error) {
                alertBox("appAlert", error.message, "error");
            }
            return;
        }

        const host = event.target.closest("[data-host]");
        if (host && state.room) {
            try {
                const data = await api(`/api/sessions/${state.room.id}/room/member/${host.dataset.user}`, {
                    method: "POST",
                    data: { action: host.dataset.host },
                });
                renderRoom(data.room);
            } catch (error) {
                alertBox("appAlert", error.message, "error");
            }
        }

        const profileOpen = event.target.closest("[data-profile-open]");
        if (profileOpen) {
            try {
                const profile = await loadProfileCard(profileOpen.dataset.profileOpen);
                renderSpotlight(profile);
            } catch (error) {
                alertBox("appAlert", error.message, "error");
            }
            return;
        }

        const feedbackOpen = event.target.closest("[data-feedback-open]");
        if (feedbackOpen && state.room) {
            try {
                const member = (state.room.members || []).find((item) => item.user_id === Number(feedbackOpen.dataset.feedbackOpen));
                if (!member) return;
                primeFeedbackTarget(member, state.room);
                const profile = await loadProfileCard(member.user_id);
                renderSpotlight(profile);
            } catch (error) {
                alertBox("appAlert", error.message, "error");
            }
        }
    });

    byId("endSessionButton").addEventListener("click", async () => {
        if (!state.room) return;
        try {
            const data = await api(`/api/sessions/${state.room.id}/end`, { method: "POST" });
            renderRoom(data.room, state.activeView === "room");
            releaseLocalMedia();
            await bootstrap();
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    byId("roomLeaveButton").addEventListener("click", async () => {
        if (!state.room) return;
        try {
            await api(`/api/sessions/${state.room.id}/leave`, { method: "POST" });
            state.room = null;
            state.roomId = null;
            releaseLocalMedia();
            stopPolling();
            cleanupRtc();
            await bootstrap();
            setView("mine");
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    byId("chatForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.room) return;
        const input = event.currentTarget.body;
        const body = input.value.trim();
        if (!body) return;
        try {
            const data = await api(`/api/sessions/${state.room.id}/chat`, { method: "POST", data: { body } });
            input.value = "";
            state.room.messages = data.messages;
            renderRoom(state.room, state.activeView === "room");
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    byId("feedbackForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.room) return;
        const form = event.currentTarget;
        const submitter = event.submitter;
        const targetUserId = Number(form.target_user_id.value || 0);
        if (!targetUserId) {
            alertBox("appAlert", "Select a participant first.", "error");
            return;
        }
        if (state.room.is_active) {
            alertBox("appAlert", "Feedback opens after the session ends.", "error");
            return;
        }
        try {
            let data;
            if (submitter?.dataset.feedbackSubmit === "report") {
                data = await api(`/api/sessions/${state.room.id}/feedback/${targetUserId}/report`, {
                    method: "POST",
                    data: { reason: form.reason.value.trim() },
                });
                form.reason.value = "";
                alertBox("appAlert", "Report submitted.");
            } else {
                data = await api(`/api/sessions/${state.room.id}/feedback/${targetUserId}/review`, {
                    method: "POST",
                    data: {
                        rating: Number(form.rating.value),
                        review_text: form.review_text.value.trim(),
                    },
                });
                form.review_text.value = "";
                alertBox("appAlert", "Review submitted.");
            }
            if (data.profile) {
                state.userCards[targetUserId] = data.profile;
                renderSpotlight(data.profile);
            }
            await bootstrap();
            if (state.roomId) await openRoom(state.roomId, state.activeView === "room");
        } catch (error) {
            alertBox("appAlert", error.message, "error");
        }
    });

    window.addEventListener("beforeunload", () => {
        releaseLocalMedia();
        stopPolling();
        cleanupRtc();
    });
    document.addEventListener("pointerdown", resumeRemoteMediaPlayback);
    document.addEventListener("keydown", resumeRemoteMediaPlayback);

    byId("matchNowButton")?.addEventListener("click", runMatchRadar);
    byId("sessionForm")?.session_date?.addEventListener("input", updateSchedulePreview);
    byId("sessionForm")?.session_time?.addEventListener("input", updateSchedulePreview);

    await bootstrap();
    renderSpotlight(null);
    updateSchedulePreview();
    setView("overview");
});
