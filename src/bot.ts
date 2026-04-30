import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { processConversationalRequest } from './agent.js';
import { db } from './db/index.js';
import { messages } from './db/schema.js';
import { eq, asc } from 'drizzle-orm';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

const bot = new Telegraf(botToken);

async function getChatHistory(chatId: string) {
  return await db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));
}

async function saveMessage(chatId: string, role: string, content: string) {
  await db.insert(messages).values({
    chatId,
    role,
    content,
  });
}

async function clearChatHistory(chatId: string) {
  await db.delete(messages).where(eq(messages.chatId, chatId));
}

bot.command('clear', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  try {
    await clearChatHistory(chatId);
    await ctx.reply('Riwayat percakapan berhasil dihapus! Mari mulai topik baru.');
  } catch (error) {
    console.error('Error clearing history:', error);
    await ctx.reply('Terjadi kesalahan saat menghapus riwayat.');
  }
});

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  const chatId = ctx.chat.id.toString();
  
  await saveMessage(chatId, 'user', text);
  const history = await getChatHistory(chatId);
  
  // Do not await processConversationalRequest to prevent Telegraf 90s timeout
  processConversationalRequest(ctx, history, undefined).catch(async (error) => {
    console.error('Error processing text:', error);
    try { await ctx.reply('Terjadi kesalahan sistem.'); } catch (e) {}
  });
});

bot.on(message('photo'), async (ctx) => {
  const caption = ctx.message.caption || '';
  const photos = ctx.message.photo;
  const chatId = ctx.chat.id.toString();
  
  const highestResPhoto = photos[photos.length - 1];
  const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
  
  const userContent = caption ? `[Uploaded Image: ${fileLink}] ${caption}` : `[Uploaded Image: ${fileLink}]`;
  await saveMessage(chatId, 'user', userContent);
  const history = await getChatHistory(chatId);
  
  // Do not await processConversationalRequest to prevent Telegraf 90s timeout
  processConversationalRequest(ctx, history, fileLink.toString()).catch(async (error) => {
    console.error('Error processing photo:', error);
    try { await ctx.reply('Terjadi kesalahan sistem saat memproses foto.'); } catch (e) {}
  });
});

bot.launch();
console.log('Bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
