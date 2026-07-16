import { Context } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/types';

/**
 * InteractiveMenu Utility
 * Handles stateful Telegram messages, ephemeral toasts, and safe UI destruction.
 * Prevents "dead" buttons from polluting the chat history.
 */
export class InteractiveMenu {
  // Tracks active timeouts by message key (chatId_messageId) so they can be cancelled
  private static activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private static getMessageKey(ctx: Context, msgId?: number): string | null {
    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat.id;
    const messageId = msgId || ctx.callbackQuery?.message?.message_id;
    if (!chatId || !messageId) return null;
    return `${chatId}_${messageId}`;
  }

  private static clearTimeout(key: string | null) {
    if (key && this.activeTimeouts.has(key)) {
      clearTimeout(this.activeTimeouts.get(key));
      this.activeTimeouts.delete(key);
    }
  }

  /**
   * Sends a new message with an inline keyboard.
   */
  static async send(
    ctx: Context,
    text: string,
    buttons: InlineKeyboardButton[][],
    parseMode: 'Markdown' | 'HTML' | 'MarkdownV2' = 'Markdown',
    extra: Record<string, any> = {}
  ) {
    return await ctx.reply(text, {
      parse_mode: parseMode,
      reply_markup: {
        inline_keyboard: buttons,
      },
      ...extra,
    });
  }

  /**
   * Updates an existing inline keyboard message (replaces text and buttons).
   * Usually called inside a `bot.action` callback.
   */
  static async update(
    ctx: Context,
    newText: string,
    newButtons: InlineKeyboardButton[][],
    parseMode: 'Markdown' | 'HTML' | 'MarkdownV2' = 'Markdown'
  ) {
    try {
      // Always answer the callback query to stop the loading spinner on the user's button
      this.clearTimeout(this.getMessageKey(ctx));
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
      }

      await ctx.editMessageText(newText, {
        parse_mode: parseMode,
        reply_markup: {
          inline_keyboard: newButtons,
        },
      });
    } catch (e) {
      console.warn('[InteractiveMenu] Failed to update menu:', e);
    }
  }

  /**
   * Finalizes an interaction by replacing the text and permanently stripping all buttons.
   * Ensures the chat history is clean and old actions cannot be re-triggered.
   */
  static async finalize(
    ctx: Context,
    finalText: string,
    parseMode: 'Markdown' | 'HTML' | 'MarkdownV2' = 'Markdown'
  ) {
    try {
      this.clearTimeout(this.getMessageKey(ctx));
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
      }

      await ctx.editMessageText(finalText, {
        parse_mode: parseMode,
        reply_markup: { inline_keyboard: [] }, // Strips buttons
      });
    } catch (e) {
      console.warn('[InteractiveMenu] Failed to finalize menu:', e);
    }
  }

  /**
   * Temporarily adds a button (like Undo) to a message, and automatically removes it after a timeout.
   */
  static async finalizeWithTimeout(
    ctx: Context,
    text: string,
    tempButtons: InlineKeyboardButton[][],
    timeoutMs: number,
    finalTextAfterTimeout: string,
    parseMode: 'Markdown' | 'HTML' | 'MarkdownV2' = 'Markdown'
  ) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
      }

      const msg = await ctx.editMessageText(text, {
        parse_mode: parseMode,
        reply_markup: { inline_keyboard: tempButtons },
      });
      this.clearTimeout(this.getMessageKey(ctx));

      const messageId = typeof msg === 'boolean' ? ctx.callbackQuery?.message?.message_id : msg?.message_id;
      const key = this.getMessageKey(ctx, messageId);

      if (key) {
        const timeoutId = setTimeout(async () => {
          this.activeTimeouts.delete(key);
          try {
            await ctx.telegram.editMessageText(
              ctx.chat?.id,
              messageId,
              undefined,
              finalTextAfterTimeout,
              {
                parse_mode: parseMode,
                reply_markup: { inline_keyboard: [] },
              }
            );
          } catch (e) {
            // Message might have been deleted by the user or an undo action
          }
        }, timeoutMs);
        this.activeTimeouts.set(key, timeoutId);
      }
    } catch (e) {
      console.warn('[InteractiveMenu] Failed to set timed menu:', e);
    }
  }

  /**
   * Sends an ephemeral message that auto-deletes itself after a few seconds.
   * Perfect for "Undo successful" toasts.
   */
  static async toast(ctx: Context, text: string, durationMs: number = 3000) {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(text).catch(() => {}); // Native Telegram toast if triggered from a button
      } else {
        const msg = await ctx.reply(`ℹ️ _${text}_`, { parse_mode: 'Markdown' });
        const key = this.getMessageKey(ctx, msg.message_id);
        const timeout = setTimeout(async () => {
          this.clearTimeout(key);
          await ctx.telegram.deleteMessage(ctx.chat!.id, msg.message_id).catch(() => {});
        }, durationMs);
        if (key) {
          this.activeTimeouts.set(key, timeout);
        }
      }
    } catch (e) {
      console.warn('[InteractiveMenu] Failed to send toast:', e);
    }
  }
}
