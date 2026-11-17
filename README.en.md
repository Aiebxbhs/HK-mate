# HK Mate

[中文](README.md) | **English**

> A campus companion for HKU postgraduates: keep up with email, manage your schedule, follow English lectures, and ask an AI assistant that knows Hong Kong.

HK Mate is a web app that runs on your own computer. It brings together Gmail, your HKU timetable, live lecture translation and an HKU campus guide. Email summaries, reply drafts and lecture translation all run on local models, so your private email and lecture recordings never leave the computer; only the AI assistant on the home page uses a cloud model.

## Highlights

- **Never miss an email**: new Gmail messages are detected in the background; the local AI summarizes each one and sorts it (School / Jobs / Bills & accounts / Promotions / Other), and can draft a reply that you check and send yourself.
- **Your schedule at a glance**: paste your HKU Event Calendar link to import the timetable and browse the whole term week by week; edit your own events, and watch deadlines on a countdown bar.
- **Follow English lectures**: live English–Chinese captions in class with time-stamped notes; after class, an automatic summary of key points, assignments and exams, each with the lecturer's own words and the time it was said.
- **AI assistant**: ask about your schedule, write a leave email, find good food nearby, get help with newcomer errands (ID card, visa, bank account…), or check the weather.
- **HKU guide**: libraries (with a floor-by-floor view of the Main Library), transport and campus locations, student services and contacts, from official HKU sources with the date each part was checked.
- **中文 / English**: switch the interface to English per account; AI replies, email summaries and lecture summaries follow, and the guide articles have English versions.

## Privacy

- Gmail is connected with **read-only** access. HK Mate never sends, deletes or moves email, or changes its read status.
- Email summaries, categories, reply drafts, speech recognition and translation, and lecture summaries **all run on this computer** (Ollama + Qwen3 4B, mlx-whisper); no cloud model API key is needed for them.
- Lecture audio is processed in memory only; it is never uploaded or saved.
- Mailbox tokens, lecture records, AI chat history and memories are encrypted on this computer, and all data is kept separate per account.
- Only the AI assistant's chats (and the preferences it remembers) are sent to the cloud provider you configure. Timetable subscription links are used once and not saved.

## Tech stack

| Part | Technology |
|---|---|
| Backend | Python 3.13 · FastAPI · SQLite · SQLAlchemy · Alembic (managed with uv) |
| Frontend | React · Vite (Node 24, npm) |
| Local models | Ollama + Qwen3 4B Instruct 2507 (summaries, categories, drafts, translation) · mlx-whisper (English speech recognition, Apple Silicon) |
| Cloud model | AI assistant: OpenAI by default, with presets for Gemini, Qwen, DeepSeek, Kimi, Zhipu and other compatible APIs |
| External services | Gmail API (read-only OAuth) · Google Places API (restaurants) · Hong Kong Observatory open data |

## Quick start

Requirements: macOS (Apple Silicon, needed for lecture translation), [uv](https://docs.astral.sh/uv/) and Python 3.13. Dependencies go into the project's `.venv`, and Node is installed into the Git-ignored `.tools`; system runtimes are not changed.

```bash
uv sync --locked
.venv/bin/python scripts/setup-node.py
export PATH="$PWD/.tools/node/bin:$PATH"
npm --prefix frontend ci
bash scripts/dev.sh
```

Open **http://127.0.0.1:5173** and register with a username and password (there are no preset accounts). Usernames are 3–32 letters, digits or underscores and are not case-sensitive; no email address is needed to register.

Each feature needs some setup; configure what you need, and features that aren't set up say so:

| Feature | Needs | Guide (Chinese) |
|---|---|---|
| Mail | A Google OAuth client | [Gmail setup](docs/GMAIL_SETUP.md) |
| Email summaries, categories, drafts | Ollama + Qwen3 4B, run `bash scripts/ollama-serve.sh` | [Local model](docs/LOCAL_MODEL.md) |
| Lecture translation | `uv sync --group speech` and a local Whisper model | [Lecture translation](docs/LECTURE.md) |
| AI assistant | A cloud provider API key in `private-data/agent.env` | See "AI assistant" below |
| Timetable | Your Event Calendar subscription link from HKU Portal | [HKU timetable](docs/HKU_CALENDAR.md) |

## Features

There are five places, at the top on a computer and at the bottom on a phone: **Today, Schedule, Mail, Lectures, HKU guide**; each place's sub-pages are switched under the page title. The avatar menu in the top-right corner has "My account" (switch 中文 / English, change password; changing it signs out your other devices) and "Sign out". The sign-in page also has a language switch. Browser back and forward work, and the address bar keeps the current page (such as `#/inbox`), so a refresh stays put.

### Today (home)

- **Greeting and date** in Hong Kong time.
- **AI assistant**: the input under the greeting, which expands into a chat (see below).
- **Next 5 days**: classes, your own events and deadlines, day by day. A class in progress is marked "Now", the next class shows "in x min", and deadlines due within 24 hours get an orange dot. With nothing scheduled yet, you can "Import timetable" or "Add event" right there.

### Mail（HKU email does not allow external API access, but emails can be forwarded to a 163 or Gmail account for use.）

The number next to "Mail" in the navigation is how many new emails you haven't dealt with. Sub-pages: Inbox, Draft an email, Mailboxes.

- **New mail** (top of the Inbox): Gmail is checked about every 15 seconds and the page updates about every 3 seconds. Each new email is summarized and sorted automatically, with queue and progress shown. You can read the email, dismiss it (Gmail is not changed), retry a failed summary, draft a reply, or "Add to schedule" (an empty event form you fill in yourself). The first run looks back one hour; after that only new mail is checked. See [Automatic mail](docs/AUTO_MAIL.md) (Chinese).
- **Inbox**: three columns (mail list | email | AI assistant); every email shows its category and unread mail has an orange dot. Switch between the inbox and all received mail including archived, page by page. The right column summarizes on demand (not saved) and drafts replies.
- **Categories**: School, Jobs, Bills & accounts, Promotions and Other, all judged by the local Qwen model from the email's content. New mail is sorted with its summary, and mail from the last 10 days is sorted in the background.
- **Reply drafts / new emails**: choose how to reply, the tone, the language and how to sign, or write the points of a new email; the local Qwen model writes an editable draft that you copy or "Open in Gmail" and send yourself. Recipient addresses are never given to the model, and anything that looks like a password you type is removed from the draft. See [Reply drafts](docs/REPLY_DRAFT.md) (Chinese).
- **Mailboxes**: add, reauthorize or unlink Google mailboxes, up to 5. You can forward your school email automatically to a connected Gmail.

### Schedule

Sub-pages: Schedule, Timetable.

- **Schedule**: HKU classes and your own events for the next 100 days, grouped by date, with start times, locations and where each came from. "Add event" offers an **Event** (start and end time on one day, Hong Kong time) or a **Deadline** (a due time only, with a bar that starts filling 14 days before, turns orange within 3 days and red when overdue). Your own events can be edited in place; everything can be marked done or undone and deleted after confirming (HKU classes can't be edited, and deleted ones come back when you re-import).
- **Timetable**: HKU classes only, laid out like the HKU Portal timetable: the whole term as one scrolling calendar, a week per row, opening at the current week; each course keeps its own colour and exams are marked. The first time, the page offers a link box and an illustrated tutorial: paste your HKU Event Calendar subscription link to import (only hku.hk links are accepted, and the link isn't saved). The timetable is a one-time snapshot that doesn't follow later changes from HKU; import again when needed. See [HKU timetable](docs/HKU_CALENDAR.md) (Chinese).

### Lectures

Sub-pages: Live translation, Lecture records.

- **Live translation**: record during class; the local Whisper model recognizes the English and Qwen translates it into Chinese, shown as bilingual captions sentence by sentence (the sentence being spoken first appears in grey English). Take time-stamped notes alongside. Audio is never uploaded or saved. **Use Chrome or Safari** (some built-in app browsers block the microphone). Get permission from the lecturer and the university before recording.
- **After-class AI summary**: when the lecture ends, an overview, key points and reminders about assignments, exams, deadlines and announcements are generated, each with its time in the lecture and the lecturer's own English words; you preview it and decide whether to save it.
- **Lecture records**: browse by course, edit, delete and export to Markdown.

How it works, privacy and limits: [Lecture translation and records](docs/LECTURE.md) (Chinese).

### HKU guide (postgraduates)

Information for HKU postgraduates in three parts, from official HKU websites only, with sources and the date each part was checked; official names are given in English, and details that change often (opening hours, shuttle timetables) are given as official links.

- **Library**: the libraries, borrowing rules, booking discussion rooms and study spaces, printing; a floor-by-floor view of the Main Library that can be filtered by facility (colour printing, scanning, study space and more).
- **Transport & campus**: the official HKU Campus Map embedded, MTR exits, bus and minibus routes, shuttle bus routes and fares.
- **Student services & contacts**: transcripts, testimonials and student cards, paying fees, University Health Service, CEDARS counselling, disabilities and special educational needs, housing / non-local students / careers, emergencies and safety.

The content files are in `backend/app/agent/knowledge/hk/` (`topic: hku`), with English translations in `hk/en/`; the AI assistant searches them too.

### AI assistant

The input under the greeting on the home page; the steps it takes and result cards appear in the chat. It can currently:

- Look up your schedule and deadlines, and propose new events (saved only when you click "Add it").
- Draft emails, for example "I need to miss tomorrow's class, write a leave email to Prof. Chan": it checks your classes, then the local Qwen model writes the draft, and the body is not sent back to the cloud. You fill in the recipient's address in the card, then copy it or open it in Gmail and send it yourself.
- Look through your saved lecture records.
- Find food like a friend would, for example "Find good food in Sai Ying Pun": it first asks what you feel like with tappable choices, then recommends two or three places from Google Maps with reasons, ratings, opening status and map links (up to 30 searches per account per day).
- Answer newcomer questions (Hong Kong ID card, student visa extension, bank accounts, Octopus and MTR student fares, SIM card registration, avoiding scams), suggest beginner hikes and shopping spots, and answer from the HKU guide, using a knowledge base built from official sources with links and check dates.
- Check Hong Kong weather and warnings (if the lookup fails it says so instead of guessing), and explain how to use HK Mate.

Chats are sent to the cloud provider you choose. Chat history is encrypted on this computer (the latest 20 chats; open or delete them under "History"). The assistant remembers lasting preferences you mention (such as not eating spicy food, or where you live), shows "Remembered" with an undo, and lists everything it remembers under "Memory", where you can delete it; memories are sent to the cloud provider with your chats. Long chats are compressed into a summary of the earlier part.

**Configuration**: `private-data/agent.env` (Git-ignored) has four parts: the current model (`HKM_AGENT_PROVIDER`, `HKM_AGENT_MODEL`), one key per provider (such as `HKM_AGENT_OPENAI_API_KEY` or `HKM_AGENT_DEEPSEEK_API_KEY`; only the current provider's line is used), Google services (`HKM_AGENT_GOOGLE_MAPS_API_KEY`) and advanced settings. For example:

```text
HKM_AGENT_PROVIDER=openai
HKM_AGENT_MODEL=gpt-6.1-terra
HKM_AGENT_OPENAI_API_KEY=<your API key>
```

Restart `bash scripts/dev.sh` to apply. You can check the key and tool calls first with `.venv/bin/python scripts/agent-model-check.py` (this makes one billed call). Design and progress: [AI assistant plan](docs/AI_AGENT_PLAN.md) (Chinese).

### Language

- Choose 中文 or English under "My account". The setting is saved to the account and follows you to other devices; a language picked on the sign-in page is remembered in that browser only and saved with the account when you register.
- In English: all interface text, server messages and AI assistant replies, plus email and lecture summaries written from then on, are in English. Notes and placeholders in reply and new-email drafts are in English (such as `[To fill in: …]`), while the email's own language is still chosen in the draft form. The HKU guide and newcomer articles come from the English versions (`backend/app/agent/knowledge/hk/en/`).
- Live lecture translation is always English to Chinese. Summaries already written are not rewritten when you switch. Email categories are stored in Chinese and translated for display.

## Running and deployment

### Development

```bash
bash scripts/dev.sh
```

The frontend uses port 5173 and the backend 8000, both on this computer only. Ctrl+C stops both; if a port is taken the script says so and doesn't stop other programs. Database migrations run before start-up, so accounts survive restarts. API docs: http://127.0.0.1:8000/docs.

### Local deployment

Build the frontend, then let FastAPI serve both the pages and the API from one address:

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
npm --prefix frontend run build
bash scripts/serve.sh
```

Open **http://127.0.0.1:8000**. Don't run it alongside the development servers on port 8000. This mode is still for this computer only; public HTTPS is not set up.

### Preview in VS Code

1. Press `Cmd+Shift+P`, run `Browser: Open Integrated Browser`, and enter `http://127.0.0.1:5173`.
2. Drag the browser tab to the right of the editor to see the page while you edit.

`.vscode/launch.json` is included: once the servers are running, choose **HK Mate: 在 VS Code 中预览** in Run and Debug and press F5, or run the task **HK Mate: 启动本地页面与 API** with `Tasks: Run Task`. The older `Simple Browser: Show` may not handle cookies well, so sign in with the integrated browser or a normal browser.

## Checks and tests

```bash
bash scripts/check.sh
```

Runs backend Ruff lint and format checks and pytest, plus frontend ESLint, Prettier, Vitest and a production build. Tests use a temporary database, synthetic accounts and synthetic emails, and never touch real mailboxes or model services. GitHub Actions is not set up yet.

## Configuration and data

- Default database: `private-data/hkumate.sqlite3`. `private-data/`, databases, logs, `.venv`, `.tools` and frontend builds are never committed.
- Setting names are in `.env.example` and are read from process environment variables; `.env` is not loaded automatically (the start scripts read `private-data/agent.env` for the AI assistant).
- Google OAuth credentials and the token encryption key are never committed. The local encryption key is created on first authorization and must be kept. Google authorization in testing mode may expire after 7 days and need reconnecting.
- Local HTTP mode uses non-Secure cookies; any public HTTPS deployment must set `HKM_COOKIE_SECURE=true` and an exact `HKM_ALLOWED_ORIGINS`, not the local development settings.
- Passwords are 12–128 characters and hashed with Argon2id; sessions last up to 7 days, signing out revokes the session at once, and changing the password ends the account's sessions on other devices. A CSRF token is fetched before each write and refetched after a server restart.
- Rate limits are persistent 15-minute fixed windows: per account, 10 sign-ins, 5 registrations and 5 password changes; per source address, 40 of each action. On a 429, wait and retry; don't clear the database to get around it.
- Runs as a single instance; multiple backend workers are not supported yet.
- Password recovery, third-party sign-in and sending email are not implemented.
- Back up SQLite with the online backup API or a proper WAL backup while stopped; don't copy only the main database file while it is running.

## Project structure

```text
backend/app/            FastAPI endpoints, business logic, database and auth
  agent/                AI assistant: providers, model adapters, tool loop, tools and knowledge
  agent/knowledge/hk/   Hong Kong and HKU guide knowledge (official sources; English in en/)
backend/migrations/     Alembic database migrations
backend/tests/          Backend tests
frontend/src/pages/     Pages (Today, Schedule, Timetable, Mail, Lectures, HKU guide)
frontend/src/components/ Components (AI chat, event form, new-mail notices, library floors…)
frontend/src/i18n.js    Interface language (zh / en)
scripts/                Start, deploy, check and model scripts
docs/                   Feature notes, plans and decision records (Chinese)
```

## Documentation

The documents are written in Chinese.

| Document | About |
|---|---|
| [GMAIL_SETUP](docs/GMAIL_SETUP.md) | Gmail OAuth setup, backups, unlinking and FAQ |
| [AUTO_MAIL](docs/AUTO_MAIL.md) | Automatic new-mail checks, summaries and categories |
| [REPLY_DRAFT](docs/REPLY_DRAFT.md) | Reply drafts and new emails |
| [LOCAL_MODEL](docs/LOCAL_MODEL.md) | Local Ollama + Qwen setup and tests |
| [HKU_CALENDAR](docs/HKU_CALENDAR.md) | HKU timetable import and schedule |
| [LECTURE](docs/LECTURE.md) | Live lecture translation, summaries and records |
| [AI_AGENT_PLAN](docs/AI_AGENT_PLAN.md) | AI assistant design and progress |
| [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) | Local environment and account design |
| [DEVELOPMENT_STANDARDS](docs/DEVELOPMENT_STANDARDS.md) | Development standards and API list |
| [MAC_APP_AND_WEBSITE_PLAN](docs/MAC_APP_AND_WEBSITE_PLAN.md) | Mac app and website plan (draft) |
| [decisions/](docs/decisions/) | Architecture decision records |

Development rules: [AGENTS.md](AGENTS.md).
