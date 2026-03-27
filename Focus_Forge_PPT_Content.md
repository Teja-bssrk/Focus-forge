# Focus Forge PPT Content

Use this content to fill the `Idea Sprint 3.0` template slide by slide.

## Slide 1. Title Slide

**Project Title**
Focus Forge

**Tagline**
Smart collaborative study rooms with matching, progress tracking, and live peer learning.

**One-line pitch**
Focus Forge helps students find the right study partners and sessions by combining subject matching, mood compatibility, role fit, scheduled rooms, live collaboration, and post-session accountability.

**Team name**
Add your actual team name here.

**Team members**
Add your actual names here.

---

## Slide 2. Problem Statement

**Who is facing this problem?**
- Students preparing for exams, placements, coding rounds, and semester subjects
- Learners who want study partners but do not know who is available at the same time
- Students who lose consistency because online learning is often isolated and unstructured

**Why is this problem important?**
- Students struggle to stay consistent without accountability
- Existing study groups are often random, inactive, or mismatched by subject and schedule
- Learners with stress, distraction, or low motivation need the right type of peer support

**Current challenges or gaps**
- No structured way to match by subject, mood, learning role, and exact time
- Most tools support messaging, but not guided study room formation
- Progress, reputation, and session analytics are usually missing
- Trust is weak because there is no review, rating, or reporting layer

---

## Slide 3. Our Solution

**What is your solution?**
Focus Forge is a web app that creates structured study collaboration. Users sign up, add subjects and profile details, discover matching sessions, create their own scheduled rooms, and join live collaborative sessions with chat, participant controls, progress tracking, and reputation features.

**How does it solve the problem?**
- Matches students using subject relevance, mood compatibility, and learning role
- Allows exact scheduling of sessions using date and time
- Supports live room collaboration with host controls, chat, and media states
- Tracks completed sessions, weekly activity, monthly activity, and topics learned
- Adds trust through rating, review, and report visibility in profiles

**Core value**
Instead of random study groups, Focus Forge creates intentional, accountable, and personalized study collaboration.

---

## Slide 4. Key Features

**User and Profile Features**
- Login and signup system
- Subject-based profile creation
- Mood selection: Focused, Motivated, Distracted, Stressed, Sleepy
- Role selection: Learn, Teach, Learn + Teach

**Session Features**
- Create sessions with date, start time, and duration
- Browse and join matching live sessions
- Join allowed only when session time matches system time window
- Host controls for mute, camera control, and kick

**Collaboration Features**
- Live room view for host and participants
- Shared chat for all members in the session
- Camera, audio, and screen-sharing state handling
- Session countdown and expired-session state

**Analytics and Trust Features**
- Track progress portal with weekly and monthly analytics
- Topics learned and time-spent analysis
- Achievements and badges
- Ratings, reviews, and reports visible on user profiles

---

## Slide 5. Technical Approach

**Languages Used**
- Python
- JavaScript
- HTML
- CSS
- SQL using SQLite

**Frameworks and Core Technologies**
- Flask for backend routing and APIs
- SQLite for user, session, chat, review, report, progress, and signal storage
- Vanilla JavaScript for UI logic and live room behavior
- WebRTC signaling approach for peer media exchange
- Glassmorphism-style responsive frontend design

**Backend Design**
- Flask REST-style API architecture
- Session-based authentication
- SQLite schema for users, sessions, members, chat messages, reviews, reports, and signals
- Matching logic implemented in Python

**Frontend Design**
- Dashboard with sections for overview, profile, create session, browse sessions, my sessions, achievements, match lab, and track progress
- Black-blue futuristic UI with glassmorphism and animated transitions
- Real-time room refresh with client polling

**Deployment**
- GitHub for version control
- Render deployment for access from any device

---

## Slide 6. Technical Architecture Summary

**Flow**
1. User signs up or logs in
2. Profile data is stored in SQLite
3. User creates or joins a scheduled session
4. Backend validates timing, membership, and matching conditions
5. Room data, chat, participant controls, and feedback are served through Flask APIs
6. Frontend updates room state and collaboration UI dynamically

**Matching Logic**
- Subject match
- Mood support logic
- Learning role compatibility
- Scheduled availability filtering

**Data Stored**
- User identity and profile
- Session timing and participants
- Room membership controls
- Chat messages
- Reviews and reports
- Progress analytics

---

## Slide 7. Demonstration

**Demo Flow**
1. Open Focus Forge web app
2. Create a new student account
3. Fill profile with subjects, mood, and role
4. View overview dashboard and welcome state
5. Create a session with a chosen subject, date, and time
6. Browse sessions and join a live room
7. Show room features:
   - live countdown
   - chat
   - participant cards
   - host controls
   - session expiry state
8. Show review/report flow after session
9. Show track progress and achievements portal

**What to highlight during demo**
- Personalized study matching
- Scheduled join control based on real session time
- Trust and accountability system
- Attractive dashboard and room UI

**Live Demo URL**
https://focus-forge-q3mp.onrender.com

---

## Slide 8. Innovation and Impact

**What makes Focus Forge innovative?**
- Combines collaboration, accountability, and personalized matching in one platform
- Uses mood-based support pairing, not just subject-based grouping
- Connects study planning, live rooms, feedback, and analytics in a single workflow

**How it differs from existing solutions**
- Typical platforms provide only chat or video meetings
- Focus Forge adds structured study matching and post-session accountability
- User profiles display reviews, reports, and trust indicators

**Impact**
- Improves consistency in study habits
- Supports peer-to-peer mentoring
- Helps distracted or stressed learners find better support
- Encourages measurable learning outcomes through progress tracking

**Target users**
- College students
- Competitive exam aspirants
- Peer mentors and study groups
- EdTech communities and campus learning cells

---

## Slide 9. Challenges and Future Scope

**Challenges Faced**
- Building a multi-feature product within hackathon time
- Managing live session state across users
- Designing matchmaking logic that feels useful and realistic
- Handling browser permissions and WebRTC-style media flow

**Current limitations**
- SQLite is suitable for demo scale but not large production scale
- Live media reliability can improve further with TURN/WebRTC infrastructure
- Mobile browser behavior can vary for media permissions

**Future Scope**
- Add full TURN-backed real-time media for stronger video reliability
- Move from SQLite to PostgreSQL for scale
- Add AI-generated study recommendations and session summaries
- Add leaderboard, streak system, and long-term performance analytics
- Add institution-level dashboards for mentors or faculty
- Add native mobile app wrapper in the future

---

## Slide 10. Conclusion

Focus Forge is a smart collaborative learning platform designed to make studying more structured, social, and effective. It solves the problem of random and inactive study groups by introducing intelligent matching, scheduled study rooms, progress analytics, and trust-based feedback. The project is practical for students today, visually strong for presentation, and scalable for future EdTech impact.

**Closing line**
Focus Forge transforms study sessions from unstructured meetups into purposeful learning collaborations.

---

## Slide 11. Thank You

**Thank You**

**Optional closing line**
Ready to turn every study session into focused progress.

**Add**
- Team name
- Names
- Contact details if needed
