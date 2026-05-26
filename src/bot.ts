import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { startServer } from './server.js';
import { db } from './db/index.js';
import { jobsTable, ideasTable } from './db/schema.js';
import { getGlobalSettings, getConnections } from './db/settings.js';
import { TEMPLATES } from './templates.js';
import { eq } from 'drizzle-orm';
import dns from 'dns';
import { uploadToS3 } from './s3.js';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
startServer(PORT);

const globalSettings = await getGlobalSettings();
const botToken = globalSettings.telegramBotToken;
if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN must be provided in global settings (Database) or .env');
  process.exit(1);
}

const telegramApiRoot = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

const bot = new Telegraf(botToken, {
  telegram: {
    apiRoot: telegramApiRoot
  }
});

const mediaGroupAccumulator = new Map<string, { timer: NodeJS.Timeout, items: { fileId: string, caption?: string, msgId: number, type: 'image' | 'video', mimeType?: string }[] }>();

async function uploadTelegramMediaToS3(url: string, mimeType?: string): Promise<string> {
  console.log(`[Bot] Fetching media from URL: ${url}`);
  let buffer: Buffer;

  if (url.startsWith('file://')) {
    const filePath = fileURLToPath(url);
    buffer = await fs.readFile(filePath);
  } else {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }
  
  let ext = '.jpg';
  if (mimeType === 'image/png') ext = '.png';
  else if (mimeType === 'image/webp') ext = '.webp';
  else if (mimeType === 'video/mp4') ext = '.mp4';
  else if (mimeType === 'video/quicktime') ext = '.mov';
  else if (mimeType === 'video/webm') ext = '.webm';
  else if (!mimeType && url.includes('.')) {
      const extMatch = url.match(/\.([a-zA-Z0-9]+)(\?|$)/);
      if (extMatch) ext = `.${extMatch[1]}`;
  }

  const defaultMimeType = url.match(/\.(mp4|mov|webm)$/i) ? 'video/mp4' : 'image/jpeg';
  const resolvedMimeType = mimeType || defaultMimeType;

  return uploadToS3(buffer, resolvedMimeType, ext);
}

async function promptConnectionSelection(ctx: any, ideaId: number) {
  const connections = await getConnections();
  
  if (connections.length === 1) {
    // Only one connection, auto-assign
    await db.update(ideasTable).set({ connectionId: connections[0].id }).where(eq(ideasTable.id, ideaId));
    await askForTemplate(ctx, ideaId);
    return;
  }

  if (connections.length === 0) {
    return ctx.reply('No connections configured. Please set up a connection in the dashboard first.');
  }

  const buttons = connections.map(conn => [{ text: conn.name, callback_data: `select_conn_${ideaId}_${conn.id}` }]);
  buttons.push([{ text: '❌ Cancel', callback_data: `cancel_idea_${ideaId}` }]);

  await ctx.reply('Which account should I queue this idea for?', {
    reply_markup: {
      inline_keyboard: buttons
    }
  });
}

async function askForTemplate(ctx: any, ideaId: number) {
  const templateButtons = Object.values(TEMPLATES).map(t => {
    return [{ text: t.name, callback_data: `convert_${ideaId}_${t.id}` }];
  });

  templateButtons.push([{ text: '❌ Batal', callback_data: `cancel_idea_${ideaId}` }]);

  const messageText = 'Pilih template yang ingin digunakan:';
  
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: {
        inline_keyboard: templateButtons
      }
    });
  } else {
    await ctx.reply(messageText, {
      reply_markup: {
        inline_keyboard: templateButtons
      }
    });
  }
}

bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  let text = ctx.message.text;
  if (ctx.message.entities) {
    let offset = 0;
    const entities = ctx.message.entities;
    for (const entity of entities) {
      if (entity.type === 'text_link') {
        const linkText = text.substring(entity.offset + offset, entity.offset + entity.length + offset);
        const url = entity.url;
        const replacement = `${linkText} (${url})`;
        text = text.substring(0, entity.offset + offset) + replacement + text.substring(entity.offset + entity.length + offset);
        offset += replacement.length - linkText.length;
      }
    }
  }
  
  try {
    const connections = await getConnections();
    const defaultConnectionId = connections.length === 1 ? connections[0].id : null;

    const [idea] = await db.insert(ideasTable).values({
      connectionId: defaultConnectionId,
      chatId,
      messageId: ctx.message.message_id,
      text,
      media: [],
      status: 'pending'
    }).returning();
    
    if (defaultConnectionId) {
       await ctx.reply('Ide tersimpan. Apakah Anda ingin membuat konten dari ide ini?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Ya, Buat Konten', callback_data: `make_post_${idea.id}` }],
            [{ text: '❌ Batal', callback_data: `cancel_idea_${idea.id}` }]
          ]
        }
      });
    } else {
      await promptConnectionSelection(ctx, idea.id);
    }
  } catch (err: any) {
    console.error('[Bot] Error saving text idea:', err);
    await ctx.reply('Terjadi kesalahan sistem saat menyimpan antrean.');
  }
});

async function handleMediaMessage(ctx: any, isVideo: boolean) {
  const chatId = ctx.chat.id.toString();

  const baseCaption = ctx.message.caption || '';
  let caption = baseCaption;
  
  if (ctx.message.caption_entities) {
    let offset = 0;
    const entities = ctx.message.caption_entities;
    for (const entity of entities) {
      if (entity.type === 'text_link') {
        const linkText = caption.substring(entity.offset + offset, entity.offset + entity.length + offset);
        const url = entity.url;
        const replacement = `${linkText} (${url})`;
        caption = caption.substring(0, entity.offset + offset) + replacement + caption.substring(entity.offset + entity.length + offset);
        offset += replacement.length - linkText.length;
      }
    }
  }
  let fileId = '';
  let mimeType: string | undefined;

  if (isVideo) {
    fileId = ctx.message.video.file_id;
    mimeType = ctx.message.video.mime_type;
  } else {
    const photos = ctx.message.photo;
    fileId = photos[photos.length - 1].file_id;
    mimeType = 'image/jpeg';
  }
  
  const mediaGroupId = ctx.message.media_group_id;
  
  if (mediaGroupId) {
    console.log(`[Bot] Received ${isVideo ? 'video' : 'photo'} part of media group ${mediaGroupId}`);
    if (!mediaGroupAccumulator.has(mediaGroupId)) {
      mediaGroupAccumulator.set(mediaGroupId, {
        items: [],
        timer: setTimeout(async () => {
          const groupData = mediaGroupAccumulator.get(mediaGroupId);
          mediaGroupAccumulator.delete(mediaGroupId);
          if (!groupData) return;
          
          console.log(`[Bot] Processing accumulated media group ${mediaGroupId} with ${groupData.items.length} items`);
          
          try {
            groupData.items.sort((a, b) => a.msgId - b.msgId);
            
            const mediaItems = [];
            for (const item of groupData.items) {
              let url = '';
              let retries = 3;
              while (retries > 0) {
                try {
                  const fileUrl = await ctx.telegram.getFileLink(item.fileId);
                  const telegramUrl = fileUrl.toString();
                  url = await uploadTelegramMediaToS3(telegramUrl, item.mimeType);
                  break;
                } catch (e: any) {
                  retries--;
                  console.warn(`[Bot] Failed to download/upload ${item.fileId}, retries left: ${retries}. Error: ${e.message}`, e.cause);
                  if (retries === 0) throw e;
                  await new Promise(res => setTimeout(res, 1000));
                }
              }
              mediaItems.push({ type: item.type, url, mimeType: item.mimeType });
            }
            
            const groupCaption = groupData.items.find(item => item.caption)?.caption || 'No specific text provided, analyze the media context if possible.';
            
            const connections = await getConnections();
            const defaultConnectionId = connections.length === 1 ? connections[0].id : null;

            const [idea] = await db.insert(ideasTable).values({
              connectionId: defaultConnectionId,
              chatId,
              messageId: groupData.items[0].msgId,
              text: groupCaption,
              media: mediaItems,
              status: 'pending'
            }).returning();
            
            if (defaultConnectionId) {
              await ctx.reply('Ide (album) tersimpan. Apakah Anda ingin membuat konten dari ide ini?', {
                reply_to_message_id: groupData.items[0].msgId,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '✅ Ya, Buat Konten', callback_data: `make_post_${idea.id}` }],
                    [{ text: '❌ Batal', callback_data: `cancel_idea_${idea.id}` }]
                  ]
                }
              });
            } else {
              await promptConnectionSelection(ctx, idea.id);
            }
            
          } catch (error) {
            console.error('[Bot] Error saving media group idea:', error);
            try { await ctx.reply('Terjadi kesalahan sistem saat menyimpan antrean album.'); } catch (e) {}
          }
        }, 2000)
      });
    }
    
    const group = mediaGroupAccumulator.get(mediaGroupId)!;
    group.items.push({
      fileId,
      caption: caption,
      msgId: ctx.message.message_id,
      type: isVideo ? 'video' : 'image',
      mimeType
    });
    
    return;
  }

  console.log(`[Bot] Received single ${isVideo ? 'video' : 'photo'} message from ${ctx.chat.id}`);
  let finalS3Url: string | undefined = undefined;
  let retries = 3;
  while (retries > 0) {
    try {
      const fileUrl = await ctx.telegram.getFileLink(fileId);
      const telegramUrl = fileUrl.toString();
      finalS3Url = await uploadTelegramMediaToS3(telegramUrl, mimeType);
      break;
    } catch (e: any) {
      retries--;
      console.warn(`[Bot] Failed to download/upload ${fileId}, retries left: ${retries}. Error: ${e.message}`, e.cause);
      if (retries === 0) {
        await ctx.reply('❌ Gagal mengunduh media dari Telegram. Silakan coba lagi.');
        return;
      }
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  
  if (!finalS3Url) return;
  const text = caption ? caption : 'No specific text provided, analyze the media context if possible.';
  
  try {
    const connections = await getConnections();
    const defaultConnectionId = connections.length === 1 ? connections[0].id : null;

    const [idea] = await db.insert(ideasTable).values({
      connectionId: defaultConnectionId,
      chatId,
      messageId: ctx.message.message_id,
      text,
      media: [{ type: isVideo ? 'video' : 'image', url: finalS3Url, mimeType }],
      status: 'pending'
    }).returning();
    
    if (defaultConnectionId) {
      await ctx.reply('Ide media tersimpan. Apakah Anda ingin membuat konten dari ide ini?', {
        reply_to_message_id: ctx.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Ya, Buat Konten', callback_data: `make_post_${idea.id}` }],
            [{ text: '❌ Batal', callback_data: `cancel_idea_${idea.id}` }]
          ]
        }
      });
    } else {
       await promptConnectionSelection(ctx, idea.id);
    }
  } catch (error) {
    console.error(`[Bot] Error saving single media idea:`, error);
    try { await ctx.reply('Terjadi kesalahan sistem saat menyimpan antrean media.'); } catch (e) {}
  }
}

bot.on('callback_query', async (ctx: any) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    
    if (callbackData.startsWith('make_post_')) {
      const ideaId = parseInt(callbackData.replace('make_post_', ''), 10);
      
      const [idea] = await db.select().from(ideasTable).where(eq(ideasTable.id, ideaId));
      if (!idea) {
        return ctx.answerCbQuery('Ide tidak ditemukan.');
      }
      if (idea.status !== 'pending') {
         return ctx.answerCbQuery('Ide ini sudah diproses.');
      }

      await askForTemplate(ctx, ideaId);
      await ctx.answerCbQuery();

    } else if (callbackData.startsWith('select_conn_')) {
      const match = callbackData.match(/^select_conn_(\d+)_(\d+)$/);
      if (!match) return ctx.answerCbQuery('Format data tidak valid.');
      
      const ideaId = parseInt(match[1], 10);
      const connId = parseInt(match[2], 10);

      await db.update(ideasTable).set({ connectionId: connId }).where(eq(ideasTable.id, ideaId));
      
      await askForTemplate(ctx, ideaId);
      await ctx.answerCbQuery('Connection selected');

    } else if (callbackData.startsWith('convert_')) {
      const match = callbackData.match(/^convert_(\d+)_(.+)$/);
      if (!match) return ctx.answerCbQuery('Format data tidak valid.');
      
      const ideaId = parseInt(match[1], 10);
      const templateId = match[2];

      const [idea] = await db.select().from(ideasTable).where(eq(ideasTable.id, ideaId));
      if (!idea) {
        return ctx.answerCbQuery('Ide tidak ditemukan.');
      }
      if (idea.status !== 'pending') {
         return ctx.answerCbQuery('Ide ini sudah diproses.');
      }
      if (!idea.connectionId) {
        return ctx.answerCbQuery('Silakan pilih akun/connection terlebih dahulu.');
      }

      await db.insert(jobsTable).values({
        connectionId: idea.connectionId,
        chatId: idea.chatId,
        messageId: idea.messageId,
        text: idea.text,
        media: idea.media,
        templateId: templateId,
        status: 'pending'
      });

      await db.update(ideasTable).set({ status: 'converted' }).where(eq(ideasTable.id, ideaId));

      await ctx.editMessageText('✅ Masuk antrean sistem');
      await ctx.answerCbQuery('Ide akan diproses.');
      
    } else if (callbackData.startsWith('cancel_idea_')) {
      const ideaId = parseInt(callbackData.replace('cancel_idea_', ''), 10);
      
      await ctx.editMessageText('⏸️ Ide disimpan. Bisa diproses nanti di dashboard.');
      await ctx.answerCbQuery('Disimpan ke dashboard.');
    }
  } catch (error) {
    console.error('[Bot] Error in callback_query:', error);
    try { await ctx.answerCbQuery('Terjadi kesalahan.'); } catch (e) {}
  }
});

bot.on(message('photo'), (ctx) => handleMediaMessage(ctx, false));
bot.on(message('video'), (ctx) => handleMediaMessage(ctx, true));

const startBotWithRetry = async (retries = 10, delayMs = 3000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      console.log('Bot is running in automated mode...');
      return;
    } catch (err: any) {
      console.error(`[Bot] Failed to launch bot (Attempt ${i + 1}/${retries}): ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};

startBotWithRetry().catch(err => {
  console.error('[Bot] Failed to start after multiple retries', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

