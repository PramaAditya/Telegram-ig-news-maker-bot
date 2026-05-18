import { db } from './db/index.js';
import { jobsTable, queueTable } from './db/schema.js';
import { eq, sql, asc } from 'drizzle-orm';
import { runAutomatedPipeline } from './agent.js';
import { publishToBuffer } from './buffer.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cron from 'node-cron';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

const telegram = new Telegraf(botToken).telegram;

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
    // Run the pipeline
    await runAutomatedPipeline(
      jobToProcess.chat_id,
      Number(jobToProcess.message_id),
      jobToProcess.text,
      jobToProcess.media && jobToProcess.media.length > 0 ? jobToProcess.media : undefined,
      telegram
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
  
  console.log('[Worker] Checking queue for auto-publish...');
  try {
    // Find the oldest pending post
    const pendingPosts = await db.select()
      .from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.createdAt))
      .limit(1);

    if (pendingPosts.length === 0) {
      console.log('[Worker] No pending posts in queue to auto-publish.');
      return;
    }

    const post = pendingPosts[0];
    console.log(`[Worker] Auto-publishing post ID ${post.id}`);

    try {
      let mediaToPublish = [...post.media];
      const ctaUrl = process.env.CTA_IMAGE_URL;
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

// Run exactly at :00 and :30 past the hour using global clock
console.log(`[Worker] Auto-publish scheduled at exactly 0 and 30 past every hour.`);
cron.schedule('0,30 * * * *', autoPublishQueue);

// Graceful shutdown
const shutdown = () => {
  console.log('[Worker] Shutting down gracefully... waiting for active jobs to finish.');
  isShuttingDown = true;
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
