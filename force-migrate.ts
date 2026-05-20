import { db } from './src/db/index.js';

async function main() {
  console.log('Altering database schema manually to skip interactive prompts...');
  
  try {
    // Add banned_words column
    await db.execute(`
      ALTER TABLE "settings"
      ADD COLUMN IF NOT EXISTS "banned_words" jsonb DEFAULT '[]'::jsonb NOT NULL;
    `);

    console.log('Schema updated successfully!');
  } catch (err) {
    console.error('Error updating schema:', err);
  }
  
  process.exit(0);
}

main();