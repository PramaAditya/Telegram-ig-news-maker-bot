import { db } from './db/index.js';
import { jobsTable } from './db/schema.js';
import { eq, sql } from 'drizzle-orm';
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
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 3;

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

// Graceful shutdown
const shutdown = () => {
  console.log('[Worker] Shutting down gracefully... waiting for active jobs to finish.');
  isShuttingDown = true;
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
