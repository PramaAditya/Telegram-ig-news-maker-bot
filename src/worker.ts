import { db } from './db/index.js';
import { jobsTable, queueTable } from './db/schema.js';
import { eq, sql, asc } from 'drizzle-orm';
import { runAutomatedPipeline } from './agent.js';
import { publishToBuffer } from './buffer.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cron from 'node-cron';
import dns from 'dns';
import { getSettings } from './db/settings.js';

// Fix for ECONNRESET issues in Docker (Node.js 17+ prefers IPv6 by default, which can break in some Docker networks)
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const settings = await getSettings();
const botToken = settings.telegramBotToken;
if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN must be provided in Settings (Database) or .env');
  process.exit(1);
}

const telegramApiRoot = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

const telegram = new Telegraf(botToken, {
  telegram: {
    apiRoot: telegramApiRoot
  }
}).telegram;

let isShuttingDown = false;
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 3;

// --- Telegram Jobs Processing ---

async function processNextJob() {
  if (isShuttingDown) return;
  if (activeJobs >= MAX_CONCURRENT_JOBS) return; // Wait until a job finishes

  let jobToProcess: any = null;

  try {
    // Atomically claim a pending job using Postgres FOR UPDATE SKIP LOCKED
    // This allows multiple workers (or concurrent loops in the same worker) 
    // to pull jobs safely without race conditions.
    const result = await db.execute(sql`
      UPDATE jobs 
      SET status = 'processing', updated_at = NOW() 
      WHERE id = (
        SELECT id FROM jobs 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 1 
        FOR UPDATE SKIP LOCKED
      ) 
      RETURNING *;
    `);

    const rows = result as any[];

    if (rows.length === 0) {
      // No jobs, wait and poll again if we aren't already polling heavily
      if (activeJobs === 0) {
        setTimeout(processNextJob, 3000);
      }
      return;
    }

    jobToProcess = rows[0];
    console.log(`[Worker] Picked up job ID ${jobToProcess.id} (Active: ${activeJobs + 1}/${MAX_CONCURRENT_JOBS})`);
    
    // We successfully claimed a job, increment active count
    activeJobs++;
    
    // Immediately try to fetch another job if we have capacity
    if (activeJobs < MAX_CONCURRENT_JOBS) {
      setImmediate(processNextJob);
    }

  } catch (dbError) {
    console.error('[Worker] Error accessing database to claim job:', dbError);
    if (activeJobs === 0) {
      setTimeout(processNextJob, 3000);
    }
    return;
  }

  // Process the claimed job
  try {
    const telegramToUse = jobToProcess.chat_id === 'DASHBOARD'
      ? {
          sendMessage: async (chatId: string, text: string, opts: any) => {
            console.log(`[Dashboard Job Status] ${text}`);
            return { chat: { id: chatId }, message_id: Date.now() };
          },
          editMessageText: async (chatId: string, msgId: number, inlineMsgId: any, text: string) => {
            console.log(`[Dashboard Job Status] ${text}`);
          },
          sendPhoto: async (chatId: string, photo: any, opts: any) => {
            console.log(`[Dashboard Job] Sending photo preview to dashboard mock`);
          }
        }
      : telegram;

    // Run the pipeline
    await runAutomatedPipeline(
      jobToProcess.chat_id,
      Number(jobToProcess.message_id),
      jobToProcess.text,
      jobToProcess.media && jobToProcess.media.length > 0 ? jobToProcess.media : undefined,
      telegramToUse
    );

    // Mark as completed
    await db.update(jobsTable)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jobsTable.id, jobToProcess.id));
      
    console.log(`[Worker] Job ID ${jobToProcess.id} completed successfully (Active: ${activeJobs - 1}/${MAX_CONCURRENT_JOBS})`);

  } catch (pipelineError: any) {
    console.error(`[Worker] Job ID ${jobToProcess.id} failed:`, pipelineError);
    // Mark as error
    await db.update(jobsTable)
      .set({ 
        status: 'error', 
        errorLog: pipelineError.message || String(pipelineError),
        updatedAt: new Date()
      })
      .where(eq(jobsTable.id, jobToProcess.id));
  } finally {
    activeJobs--;
    // After finishing a job, check for more
    if (!isShuttingDown) {
      setImmediate(processNextJob);
    }
  }
}

console.log(`[Worker] Starting background worker (Concurrency: ${MAX_CONCURRENT_JOBS})...`);
// Start the initial workers up to the concurrency limit
for (let i = 0; i < MAX_CONCURRENT_JOBS; i++) {
  setTimeout(processNextJob, i * 500); // Stagger initial starts slightly
}

// --- Auto Publish Queue ---

async function autoPublishQueue() {
  if (isShuttingDown) return;
  
  try {
    const settings = await getSettings();
    const now = new Date();
    
    // Check if current hour is within allowed bounds (Asia/Jakarta timezone)
    const currentHourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jakarta' }).format(now);
    const currentHour = parseInt(currentHourStr, 10);
    
    if (currentHour < settings.cronStartHour || currentHour > settings.cronEndHour) {
      return; // Outside of allowed publishing hours
    }

    // Check if enough time has passed since last publish
    if (settings.lastAutoPublishAt) {
      const diffMins = (now.getTime() - settings.lastAutoPublishAt.getTime()) / 60000;
      if (diffMins < settings.cronIntervalMinutes) {
        return; // Not enough time has passed
      }
    }

    console.log('[Worker] Checking queue for auto-publish...');
    
    // Find the oldest pending post
    const pendingPosts = await db.select()
      .from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.sortOrder))
      .limit(1);

    if (pendingPosts.length === 0) {
      return;
    }

    const post = pendingPosts[0];
    console.log(`[Worker] Auto-publishing post ID ${post.id}`);

    try {
      let mediaToPublish = [...post.media];
      const ctaUrl = settings.ctaImageUrl;
      if (ctaUrl && !mediaToPublish.some(m => m.url === ctaUrl)) {
        mediaToPublish.push({ type: 'image', url: ctaUrl });
      }

      // Publish to buffer
      await publishToBuffer(mediaToPublish, post.text);
      
      // Update DB
      await db.update(queueTable)
        .set({
          status: 'published',
          publishedAt: new Date()
        })
        .where(eq(queueTable.id, post.id));

      // Update last publish time in settings
      const { settingsTable } = await import('./db/schema.js');
      await db.update(settingsTable).set({ lastAutoPublishAt: new Date() }).where(eq(settingsTable.id, 1));

      console.log(`[Worker] Successfully auto-published post ID ${post.id}`);
    } catch (publishError: any) {
      console.error(`[Worker] Failed to auto-publish post ID ${post.id}:`, publishError);
      
      // Update DB with error so it doesn't get stuck in a retry loop
      await db.update(queueTable)
        .set({
          status: 'error',
          errorLog: publishError.message || String(publishError)
        })
        .where(eq(queueTable.id, post.id));
    }

  } catch (error: any) {
    console.error('[Worker] Unexpected error checking queue for auto-publish:', error);
  }
}

// Run every minute, the function will decide whether to publish based on settings
console.log(`[Worker] Auto-publish worker started (Checking every minute against DB settings).`);
cron.schedule('* * * * *', autoPublishQueue, {
  timezone: "Asia/Jakarta"
});

// Graceful shutdown
const shutdown = () => {
  console.log('[Worker] Shutting down gracefully... waiting for active jobs to finish.');
  isShuttingDown = true;
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
