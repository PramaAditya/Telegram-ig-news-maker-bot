# Instagram News Maker Bot

An automated Telegram bot that receives news links/images, processes them using AI (Gemini), and schedules them to Instagram via Buffer.

## Features
- Fetches news articles using Firecrawl
- Summarizes and formats content for Instagram carousels
- Generates images using Sharp & standard templates
- Custom Local Queue System to bypass Buffer's 10-item limit for free accounts

## Setup

1. Copy `.env.example` to `.env` and fill the variables.
2. Run `npm install`.
3. Run migrations `npx drizzle-kit push`.
4. Run `npm start`.

## Webhook / Publish Trigger

Since Buffer free accounts have a queue limit of 10, this bot uses a local PostgreSQL database to queue the generated posts.
To actually publish them to Buffer (using `shareNow`), trigger the following endpoint periodically via a CRON job (e.g., using **N8N**, Zapier, or a basic cron script).

### `POST /api/trigger-publish`
Finds the oldest `pending` post in the database, publishes it to Buffer immediately, and updates the status.

**Headers:**
```
Authorization: Bearer <YOUR_TRIGGER_API_KEY>
```

**Response (Success):**
```json
{
  "message": "Published successfully",
  "postId": 1,
  "bufferResult": { ... }
}
```

## Dashboard (Queue Management)

You can manage the Queue (CRUD operations) via the built-in web dashboard.
Simply navigate to your bot's server address:
```
http://localhost:3000
```
*(Replace `localhost:3000` with your production URL).*

It will prompt you for the `DASHBOARD_PASSWORD` (configured in your `.env`) to authenticate and allow you to view, edit, and delete queued items.
