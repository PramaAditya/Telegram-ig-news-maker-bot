import { db } from './src/db/index.js';

async function main() {
  console.log('Altering database schema manually to skip interactive prompts...');
  
  try {
    // 1. Create global_settings
    await db.execute(`
      CREATE TABLE IF NOT EXISTS "global_settings" (
        "id" integer PRIMARY KEY,
        "telegram_bot_token" text
      );
    `);

    // 2. Read existing settings and copy telegramBotToken
    const currentSettings: any = await db.execute(`SELECT * FROM "settings" WHERE id = 1`).catch(() => ({}));
    const token = currentSettings && currentSettings.length > 0 ? currentSettings[0]?.telegram_bot_token : undefined;
    
    if (token) {
      await db.execute(`
        INSERT INTO "global_settings" ("id", "telegram_bot_token")
        VALUES (1, '${token}')
        ON CONFLICT ("id") DO NOTHING;
      `);
    } else {
      await db.execute(`
        INSERT INTO "global_settings" ("id")
        VALUES (1)
        ON CONFLICT ("id") DO NOTHING;
      `);
    }

    // 3. Update settings table
    await db.execute(`
      ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "name" text DEFAULT 'Default Connection' NOT NULL;
    `);

    // Drop telegram_bot_token if it exists
    await db.execute(`
      ALTER TABLE "settings" DROP COLUMN IF EXISTS "telegram_bot_token";
    `).catch(() => {});

    // Alter id column to be auto-incrementing serial if it's not already
    await db.execute(`
      CREATE SEQUENCE IF NOT EXISTS settings_id_seq;
      ALTER TABLE "settings" ALTER COLUMN id SET DEFAULT nextval('settings_id_seq');
      ALTER SEQUENCE settings_id_seq OWNED BY "settings".id;
    `).catch(err => console.log('Error altering settings id sequence, it might already exist:', err));

    await db.execute(`
      SELECT setval('settings_id_seq', COALESCE((SELECT MAX(id) FROM "settings"), 1));
    `).catch(err => console.log('Error setting sequence val:', err));

    // 4. Add connection_id to tables
    await db.execute(`
      ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "connection_id" integer REFERENCES "settings"("id");
    `);
    await db.execute(`
      UPDATE "queue" SET "connection_id" = 1 WHERE "connection_id" IS NULL;
    `);

    await db.execute(`
      ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "connection_id" integer REFERENCES "settings"("id");
    `);
    await db.execute(`
      UPDATE "ideas" SET "connection_id" = 1 WHERE "connection_id" IS NULL;
    `);

    await db.execute(`
      ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "connection_id" integer REFERENCES "settings"("id");
    `);
    await db.execute(`
      UPDATE "jobs" SET "connection_id" = 1 WHERE "connection_id" IS NULL;
    `);

    console.log('Schema updated successfully!');
  } catch (err) {
    console.error('Error updating schema:', err);
  }
  
  process.exit(0);
}

main();
