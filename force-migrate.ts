import { db } from './src/db/index.js';

async function main() {
  console.log('Altering database schema manually to skip interactive prompts...');
  
  try {
    // Add banned_words column
    await db.execute(`
      ALTER TABLE "settings"
      ADD COLUMN IF NOT EXISTS "banned_words" jsonb DEFAULT '[]'::jsonb NOT NULL;
    `);

    // Buffer rename and new columns
    await db.execute(`
      ALTER TABLE "settings" RENAME COLUMN "buffer_instagram_channel_id" TO "buffer_channel_id";
    `).catch(() => console.log('Column might already be renamed'));
    
    await db.execute(`
      ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "buffer_channel_network" text DEFAULT 'instagram';
    `);

    await db.execute(`
      ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "publish_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
    `);

    console.log('Schema updated successfully!');
  } catch (err) {
    console.error('Error updating schema:', err);
  }
  
  process.exit(0);
}

main();