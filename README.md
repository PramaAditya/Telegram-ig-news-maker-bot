<p align="center">
  <samp>Instagram News Maker Bot</samp>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v20+-blue?style=flat-square&logo=node.js" alt="Node Version">
  <img src="https://img.shields.io/badge/Gemini-3.5_Pro-orange?style=flat-square&logo=google" alt="Gemini Model">
  <img src="https://img.shields.io/badge/Vue.js-v3.5-4fc08d?style=flat-square&logo=vuedotjs" alt="Vue Version">
  <img src="https://img.shields.io/badge/Drizzle_ORM-v0.45-green?style=flat-square" alt="Drizzle ORM">
  <img src="https://img.shields.io/badge/Docker-Supported-blue?style=flat-square&logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/License-ISC-red?style=flat-square" alt="License">
</p>

<h1 align="center">ig-news-maker-bot</h1>

<p align="center">
  <b>An automated news curation, research, and carousel generation pipeline.</b>
  <br>
  Submit topics or web links via Telegram or the Web CMS, let AI conduct deep research,
  and automatically publish rendered news slides directly to Instagram.
</p>

---

### 💻 Hero Demo

```text
$ npm run start:worker

[Worker] Starting background worker (Concurrency: 3)...
[Worker] Auto-publish worker started (Checking every minute against DB settings).
[Worker] Picked up job ID 108 (pending: 0)
[Phase 1] Researching URL: https://news.example.com/indonesia-tech-boom
[Research] Extracted core 5W1H facts via Firecrawl & Gemini-3.1-Pro-Preview
[Phase 2] Generating slide copy & visual prompts for 'Carousel Dark' template
[Media] Triggering Puppeteer rendering engine for 'kabar.perjuangan/carousel_dark'
[S3] Uploaded 3 rendered PNGs to S3 bucket (S3_BUCKET/posts/108/cover.jpg)
[Queue] Sensationally crafted slide sequence pushed to DB publish queue (sort_order: 1)
[Cron] Slot matched (Monday 14:00) for Connection: Kabar Perjuangan
[Cron] Auto-publishing post ID 108 to Buffer GraphQL API
✓ [Buffer] Successfully scheduled Instagram post with 3 slides!
```

---

## 🛠 Why ig-news-maker-bot?

Bypass manual design, research, formatting, and publishing entirely. Transition from raw news links or ideas to beautiful, styled, multi-slide Instagram posts in seconds.

| Feature | ig-news-maker-bot | Traditional Workflow |
| :--- | :--- | :--- |
| **Research & Draft** | ✅ Automated via Exa/Firecrawl + Gemini | Manual googling + doc drafting |
| **Visual Design** | ✅ Dynamic HTML/CSS Puppeteer Renderer | Manual Photoshop/Figma template |
| **Ingestion** | ✅ Telegram Bot & Web CMS | Disjointed note-taking apps |
| **Publishing** | ✅ Automated scheduling via Buffer API | Manual phone upload & captioning |

---

## 📖 Minimum Viable Knowledge

Before you deploy or customize, keep these architectural pillars in mind:

* **Telegram is Ingestion, Web is CMS:** Submit raw thoughts or news URLs on-the-go via the Telegram bot; use the dashboard to review, edit, and reorder.
* **Strict Censorship / Moderation:** Define banned terms & replacements in the database settings. The AI automatically scrubs these to prevent Instagram shadowbans.
* **Schedules Drive the Cron:** The worker polls the DB every minute. Posts publish only when a custom schedule or a dynamic connection slot matches the local Jakarta clock.
* **Media Re-generation is Instant:** Adjust slide copy in the Post Detail page, click "Regenerate Media", and the Puppeteer worker re-renders identical visuals with new text in seconds.

---

## ⚙️ Quick Start

### 1. Prerequisites
Ensure you have the following ready:
* Node.js v20+ & PostgreSQL database
* S3-compatible object storage
* Gemini API Key & Telegram Bot Token
* Buffer API Token & Channel ID

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
POSTGRES_URL=postgresql://user:pass@host:5432/db
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
LIGHT_MODEL=gemini-2.5-flash
DASHBOARD_PASSWORD=secure_admin_pass
TRIGGER_API_KEY=auth_token_for_trigger
S3_ENDPOINT=https://your-s3-endpoint
S3_ACCESS_KEY_ID=access_key
S3_SECRET_ACCESS_KEY=secret_key
S3_BUCKET=ig-news-bot
S3_PUBLIC_URL_BASE=https://cdn.example.com
```

### 3. Local Installation & Run
Configure and launch the application in three commands:
```bash
# Install backend/frontend dependencies & push DB schema
npm install && cd frontend && npm install && npm run build && cd ..
npx drizzle-kit push
npm run start
```

### 4. Docker Deployment (Compose)
To spin up the entire multi-container stack (Bot, API, Web, Puppeteer, Subtitles):
```bash
docker-compose up --build -d
```

---

## 🗄️ Project Landscape

```text
                  ┌─────────────────┐
                  │  Telegram Bot   │ ◄─── (Ingestion on-the-go)
                  └────────┬────────┘
                           │
                           ▼
  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐
  │  Web App SPA │──►│Jobs & Queue  │──►│  Agent Worker   │──► [Firecrawl / Exa]
  │  (Vue3 CMS)  │   │  (Postgres)  │   │(Gemini + S3/DB) │──► [Gemini Research]
  └──────────────┘   └──────────────┘   └────────┬────────┘
                                                 │
                                                 ▼
  ┌──────────────┐   ┌──────────────┐   ┌────────┴────────┐
  │ Instagram via│◄──│ Cron Trigger │◄──│Puppeteer Render │
  │  Buffer API  │   │ (Posting)    │   │ (Media Service) │
  └──────────────┘   └──────────────┘   └─────────────────┘
```

The codebase is organized into several lightweight modules:
* `src/bot.ts` — Receives text/image inputs via Telegram, saves them as Ideas, and registers jobs.
* `src/server.ts` — Exposes Express API endpoints for the Vue 3 Web CMS and custom publish triggers.
* `src/worker.ts` — Orchestrates background news generation, Puppeteer renders, and cron-scheduled posts.
* `src/db/schema.ts` — Drizzle definitions of global settings, user accounts, publish queues, and jobs.
* `services/` — Independent microservices for HTML media-rendering (`puppeteer`) and subtitle generation.

---

<p align="center">
  <sub>Licensed under the ISC License. Made by Prama Aditya.</sub>
</p>
