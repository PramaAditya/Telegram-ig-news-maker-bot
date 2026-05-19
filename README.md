# Instagram News Maker Bot

An automated news curation and publishing system built on Node.js. It acts as both a Telegram bot (for quick submissions on-the-go) and a full web-based CMS for generating, reviewing, editing, and publishing news carousels to Instagram via Buffer.

Powered by AI (Gemini), it researches topics, writes Gen-Z targeted news slides, and dynamically renders image carousels.

---

## 🌟 Core Features

- **Multi-channel Ingestion:** Submit topics, raw text, or news URLs via the Telegram Bot or through the built-in Web Dashboard.
- **AI-Powered Pipeline (Agent):** Uses Firecrawl to read URLs, and Gemini to summarize facts, write punchy Indonesian captions, and determine important highlight words.
- **Image Generation:** Upload reference cover images, generate enhancements via AI, and render complete Instagram carousel sequences.
- **Full Web CMS (Vue SPA):** 
  - Manage the **Publishing Queue** (Reorder, Delete, Publish Now).
  - Edit draft posts via the **Post Detail** view (Change title, slides text, and upload new cover images).
  - Regenerate images instantly from the CMS after editing slide text.
  - Image copying & pasting support.
  - Interactive media lightbox powered by Fancybox.
- **Dynamic Database Settings:** Control cron intervals, API tokens, and watermarks directly from the UI without restarting your `.env` configuration.
- **Smart Background Worker:** A robust Node.js worker handles API generation asynchronously and strictly follows database-defined publish intervals (e.g., publish every 60 minutes between 06:00 and 23:00).

---

## 🛠 Tech Stack

### Backend
- **Node.js + Express** (API Server & File Serving)
- **Telegraf** (Telegram Bot interaction)
- **Drizzle ORM + PostgreSQL** (Database queue, jobs, and settings management)
- **node-cron** (Background worker automation)
- **Vercel AI SDK** (Integration with Gemini models)
- **Multer** (File uploads & S3 Integration)

### Frontend (SPA CMS)
- **Vue 3 + Vite**
- **Tailwind CSS v4** (Styling)
- **Vue Router** (Client-side routing)
- **Lucide Vue Next** (Icons)
- **@fancyapps/ui** (Media Lightbox)

---

## ⚙️ Setup & Installation

### 1. Prerequisites
- Docker & Docker Compose (Recommended)
- PostgreSQL Database
- Telegram Bot Token
- Buffer API Token
- Gemini API Key
- S3 Compatible Storage (for image hosting)

### 2. Local Setup (Without Docker)
1. Clone the repo and run `npm install`.
2. Copy `.env.example` to `.env` and fill the variables.
3. Push the database schema:
   ```bash
   npx drizzle-kit push
   ```
4. Build the Frontend SPA:
   ```bash
   cd frontend
   npm install
   npm run build
   ```
   *(This bundles the Vue app into the backend's `/public` folder).*
5. Start the bot, API server, and worker:
   ```bash
   npm run start
   ```

### 3. Production Deployment (Docker / Dokploy)
The repository includes a multi-stage `Dockerfile` that automatically:
1. Builds the Vue frontend using Vite.
2. Sets up the Node.js backend (including `ffmpeg` for media handling).
3. Serves both the backend API and frontend SPA on port `3000`.

To deploy:
```bash
docker-compose up --build -d
```

---

## 🗄️ Project Architecture

```
ig-news-maker-bot/
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── frontend/               # Vue 3 SPA
│   ├── src/
│   │   ├── auth.ts         # Secure localStorage token handling
│   │   ├── components/     # Reusable UI (ImageUploader, PasswordInput)
│   │   ├── views/          # Pages (Dashboard, CreatePost, Settings, PostDetail)
│   │   └── main.ts         # Vue Router config
├── src/                    # Node.js Backend
│   ├── agent.ts            # AI Pipeline (Firecrawl + Gemini)
│   ├── bot.ts              # Telegraf Telegram Bot Listener
│   ├── buffer.ts           # Buffer GraphQL API integration
│   ├── image.ts            # External Image Render Engine caller
│   ├── s3.ts               # AWS S3 Uploads
│   ├── server.ts           # Express API endpoints & Static File server
│   ├── worker.ts           # Background Cron Job processor
│   └── db/
│       ├── index.ts        # Postgres connection
│       ├── schema.ts       # Drizzle Tables (queue, jobs, settings)
│       └── settings.ts     # Global Settings helper with .env fallback
```

---

## 💻 Web Dashboard Usage

Access the dashboard by navigating to the server's URL (e.g., `http://localhost:3000`).
The frontend is protected by a password mechanism. Upon loading, the browser will prompt you for the `DASHBOARD_PASSWORD` (which corresponds to your database settings or `.env`).

### Available Pages:
1. **Queue (`/`)**: View pending carousels, reorder them, force-publish, or delete them. Includes a media lightbox for previewing slides.
2. **Create New (`/create`)**: Manually trigger the AI agent by pasting a topic/URL and an optional reference image. The job will appear in the realtime Processing Jobs monitor.
3. **Settings (`/settings`)**: Dynamically update global settings (Telegram Token, Buffer Keys, Cron Intervals) without restarting the container.
4. **Post Detail (`/post/:id`)**: The Editor CMS.
   - Adjust the AI-generated Title and Cover Image.
   - Add, edit, or remove slides dynamically.
   - Click **Regenerate Media Grid** to re-render the images with your new text/titles without changing the core content.

---

## 🔄 How the Automation Loop Works

1. **Ingestion**: A user sends a message to the Telegram bot or submits the `CreatePost` form.
2. **Jobs Table**: The request is logged into the `jobs` table with a `pending` status.
3. **Agent Worker**: `src/worker.ts` constantly listens for pending jobs. When found, it claims the job and runs `agent.ts`.
4. **AI Generation**: `agent.ts` researches the topic, generates the text, renders the images, uploads them to S3, and saves the final result to the `queue` table.
5. **Publish Cron**: Every minute, `worker.ts` checks the `settings` table. If the current time is within the allowed operating hours, and enough time has passed since the last post, it takes the top item from the `queue` table and publishes it to Instagram via Buffer.
