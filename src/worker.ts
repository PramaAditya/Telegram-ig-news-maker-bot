import { db } from './db/index.js';
import { jobsTable } from './db/schema.js';
import { eq, asc, and } from 'drizzle-orm';
import { runAutomatedPipeline } from './agent.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

const telegram = new Telegraf(botToken).telegram;

let isShuttingDown = false;

async function processNextJob() {
  if (isShuttingDown) return;

  try {
    // Pick the oldest pending job
    const pendingJobs = await db.select()
      .from(jobsTable)
      .where(eq(jobsTable.status, 'pending'))
      .orderBy(asc(jobsTable.createdAt))
      .limit(1);

    if (pendingJobs.length === 0) {
      // No jobs, wait and poll again
      setTimeout(processNextJob, 3000);
      return;
    }

    const job = pendingJobs[0];
    console.log(`[Worker] Picked up job ID ${job.id}`);

    // Mark as processing
    await db.update(jobsTable)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(jobsTable.id, job.id));

    try {
      // Run the pipeline
      await runAutomatedPipeline(
        job.chatId,
        job.messageId,
        job.text,
        job.media.length > 0 ? job.media : undefined,
        telegram
      );

      // Mark as completed
      await db.update(jobsTable)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(jobsTable.id, job.id));
        
      console.log(`[Worker] Job ID ${job.id} completed successfully`);

    } catch (pipelineError: any) {
      console.error(`[Worker] Job ID ${job.id} failed:`, pipelineError);
      // Mark as error
      await db.update(jobsTable)
        .set({ 
          status: 'error', 
          errorLog: pipelineError.message || String(pipelineError),
          updatedAt: new Date()
        })
        .where(eq(jobsTable.id, job.id));
    }
  } catch (dbError) {
    console.error('[Worker] Error accessing database:', dbError);
  }

  // Poll immediately for next job
  if (!isShuttingDown) {
    setImmediate(processNextJob);
  }
}

console.log('[Worker] Starting background worker...');
processNextJob();

// Graceful shutdown
const shutdown = () => {
  console.log('[Worker] Shutting down gracefully... finishing current job if any.');
  isShuttingDown = true;
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
