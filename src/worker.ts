import { db } from './db/index.js';
import { jobsTable, queueTable, settingsTable } from './db/schema.js';
import { eq, sql, asc } from 'drizzle-orm';
import { runAutomatedPipeline } from './agent.js';
import { publishToBuffer } from './buffer.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cron from 'node-cron';
import dns from 'dns';
import { getGlobalSettings, getConnections } from './db/settings.js';

dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const globalSettings = await getGlobalSettings();
const botToken = globalSettings.telegramBotToken;
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

async function processNextJob() {
  if (isShuttingDown) return;
  if (activeJobs >= MAX_CONCURRENT_JOBS) return;

  let jobToProcess: any = null;

  try {
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
      if (activeJobs === 0) {
        setTimeout(processNextJob, 3000);
      }
      return;
    }

    jobToProcess = rows[0];
    console.log(`[Worker] Picked up job ID ${jobToProcess.id} (Active: ${activeJobs + 1}/${MAX_CONCURRENT_JOBS})`);
    
    activeJobs++;
    
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

    await runAutomatedPipeline(
      jobToProcess.chat_id,
      Number(jobToProcess.message_id),
      jobToProcess.text,
      jobToProcess.media && jobToProcess.media.length > 0 ? jobToProcess.media : undefined,
      telegramToUse,
      jobToProcess.template_id,
      jobToProcess.connection_id,
      jobToProcess.hero_style
    );

    await db.update(jobsTable)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jobsTable.id, jobToProcess.id));
      
    console.log(`[Worker] Job ID ${jobToProcess.id} completed successfully (Active: ${activeJobs - 1}/${MAX_CONCURRENT_JOBS})`);

  } catch (pipelineError: any) {
    console.error(`[Worker] Job ID ${jobToProcess.id} failed:`, pipelineError);
    await db.update(jobsTable)
      .set({ 
        status: 'error', 
        errorLog: pipelineError.message || String(pipelineError),
        updatedAt: new Date()
      })
      .where(eq(jobsTable.id, jobToProcess.id));
  } finally {
    activeJobs--;
    if (!isShuttingDown) {
      setImmediate(processNextJob);
    }
  }
}

console.log(`[Worker] Starting background worker (Concurrency: ${MAX_CONCURRENT_JOBS})...`);
for (let i = 0; i < MAX_CONCURRENT_JOBS; i++) {
  setTimeout(processNextJob, i * 500);
}

// --- Auto Publish Queue ---

async function autoPublishQueue() {
  if (isShuttingDown) return;
  
  try {
    const connections = await getConnections();
    const now = new Date();
    
    // Process custom scheduled posts FIRST
    try {
      const scheduledPosts = await db.select()
        .from(queueTable)
        .where(sql`status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`);
        
      for (const post of scheduledPosts) {
        if (!post.connectionId) continue;
        
        console.log(`[Worker] Custom schedule reached for post ID ${post.id}. Publishing now...`);
        const connection = connections.find(c => c.id === post.connectionId);
        if (!connection) {
           console.error(`[Worker] Connection ${post.connectionId} not found for scheduled post ${post.id}`);
           continue;
        }

        try {
          let mediaToPublish = [...post.media];
          const ctaUrl = connection.ctaImageUrl;
          if (ctaUrl && !mediaToPublish.some(m => m.url === ctaUrl)) {
            mediaToPublish.push({ type: 'image', url: ctaUrl });
          }

          await publishToBuffer(mediaToPublish, post.text, post.publishMetadata, connection.id);
          
          await db.update(queueTable)
            .set({ status: 'published', publishedAt: new Date() })
            .where(eq(queueTable.id, post.id));

          console.log(`[Worker] Successfully published scheduled post ID ${post.id}`);
        } catch (publishError: any) {
          console.error(`[Worker] Failed to publish scheduled post ID ${post.id}:`, publishError);
          await db.update(queueTable)
            .set({ status: 'error', errorLog: publishError.message || String(publishError) })
            .where(eq(queueTable.id, post.id));
        }
      }
    } catch (scheduleErr) {
       console.error('[Worker] Error processing custom scheduled posts:', scheduleErr);
    }
    
    // Now process regular auto-queue slots
    const formatter = new Intl.DateTimeFormat('en-US', { 
      weekday: 'long', 
      hour: '2-digit', 
      minute: '2-digit',
      hourCycle: 'h23', 
      timeZone: 'Asia/Jakarta' 
    });
    
    const parts = formatter.formatToParts(now);
    const day = parts.find(p => p.type === 'weekday')?.value;
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    const currentTimeStr = `${hour?.padStart(2, '0')}:${minute?.padStart(2, '0')}`;

    for (const settings of connections) {
      if (!settings.postingSlots || settings.postingSlots.length === 0) continue;

      const matchingSlot = settings.postingSlots.find(
        (slot: { day: string, time: string }) => slot.day.toLowerCase() === day?.toLowerCase() && slot.time === currentTimeStr
      );

      if (!matchingSlot) continue;

      if (settings.lastAutoPublishAt) {
        const diffMins = (now.getTime() - settings.lastAutoPublishAt.getTime()) / 60000;
        if (diffMins < 1) continue;
      }

      console.log(`[Worker] Slot matched (${day} ${currentTimeStr}) for connection ${settings.id}. Checking queue for auto-publish...`);
      
      const pendingPosts = await db.select()
        .from(queueTable)
        .where(sql`status = 'pending' AND scheduled_at IS NULL AND connection_id = ${settings.id}`)
        .orderBy(asc(queueTable.sortOrder))
        .limit(1);

      if (pendingPosts.length === 0) continue;

      const post = pendingPosts[0];
      console.log(`[Worker] Auto-publishing post ID ${post.id}`);

      try {
        let mediaToPublish = [...post.media];
        const ctaUrl = settings.ctaImageUrl;
        if (ctaUrl && !mediaToPublish.some(m => m.url === ctaUrl)) {
          mediaToPublish.push({ type: 'image', url: ctaUrl });
        }

        await publishToBuffer(mediaToPublish, post.text, post.publishMetadata, settings.id);
        
        await db.update(queueTable)
          .set({ status: 'published', publishedAt: new Date() })
          .where(eq(queueTable.id, post.id));

        await db.update(settingsTable).set({ lastAutoPublishAt: new Date() }).where(eq(settingsTable.id, settings.id));

        console.log(`[Worker] Successfully auto-published post ID ${post.id}`);
      } catch (publishError: any) {
        console.error(`[Worker] Failed to auto-publish post ID ${post.id}:`, publishError);
        await db.update(queueTable)
          .set({ status: 'error', errorLog: publishError.message || String(publishError) })
          .where(eq(queueTable.id, post.id));
      }
    }

  } catch (error: any) {
    console.error('[Worker] Unexpected error checking queue for auto-publish:', error);
  }
}

console.log(`[Worker] Auto-publish worker started (Checking every minute against DB settings).`);
cron.schedule('* * * * *', autoPublishQueue, {
  timezone: "Asia/Jakarta"
});

const shutdown = () => {
  console.log('[Worker] Shutting down gracefully... waiting for active jobs to finish.');
  isShuttingDown = true;
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

