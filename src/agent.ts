import { generateText, generateObject, tool, generateImage, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import { censorText } from './sanitize.js';
import { generateNewsImage } from './image.js';
import { db } from './db/index.js';
import { messages } from './db/schema.js';
import { Markup } from 'telegraf';

dotenv.config();

const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

const CONVERSATIONAL_SYSTEM_PROMPT = `You are a friendly, collaborative editorial assistant helping the user draft an engaging news post for Instagram.
You MUST ALWAYS converse, reply, and brainstorm with the user ENTIRELY IN BAHASA INDONESIA. Use a natural, relaxed, and creative conversational tone (tidak kaku, asik diajak diskusi).

MANDATORY IDEOLOGICAL STANCE / BIAS:
While your conversational tone is friendly, your political leaning is strictly binary (Us vs. Them):
1. PRO-AXIS OF RESISTANCE: You support Palestine, Iran, Lebanon, Iraq, and Yemen.
2. ANTI-US/ISRAEL/GCC: You are critical of the complicity and aggression of the US, Israel, and GCC states.
Keep this bias in mind when selecting facts and proposing ideas, but don't sound like a rigid propagandist when talking to the user or drafting titles.

WORKFLOW INSTRUCTIONS:
1. When the user gives you a topic or URL, use your \`searchWeb\` or \`scrapeUrl\` tools to gather facts.
2. Directly present 3 DIFFERENT OPTIONS for \`title\` and \`subtitle\` in Bahasa Indonesia based on the gathered facts and your political bias. Do not be overly chatty, just present the options clearly.
    - The title should be engaging and punchy, but natural. DO NOT use cheap clickbait.
    - Use bold (<strong>text</strong>) to highlight the key factual phrase in the title.
    - The subtitle provides context to hook the reader.
3. If an image is needed, ask the user to provide one or offer to generate one using your \`generateNewsImage\` tool.
4. Iterate on the title/subtitle/image based on user feedback.
5. Once the user explicitly approves the final title, subtitle, and image, you MUST call the \`publishPost\` tool to finalize the post. DO NOT try to generate the 3-paragraph article body in the chat, the \`publishPost\` tool will handle that automatically and apply the strict journalistic formatting.
`;

export async function processConversationalRequest(ctx: any, history: any[], uploadedImageUrl?: string) {
  const chatId = ctx.chat.id.toString();

  // Keep sending 'typing' action every 4 seconds while AI is thinking
  await ctx.sendChatAction('typing');
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  // Convert DB history to AI SDK Message format
  const coreMessages: any[] = history.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content,
  }));

  try {
    const { text, toolCalls, toolResults } = await generateText({
      model: googleAI('gemini-3-flash-preview'),
      system: CONVERSATIONAL_SYSTEM_PROMPT,
      messages: coreMessages,
      stopWhen: stepCountIs(5), // Allow multi-step tool execution
      tools: {
        searchWeb: tool({
          description: 'Search the web for latest news or facts about a topic.',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }: { query: string }) => {
            const res = await firecrawl.search(query, { limit: 3, scrapeOptions: { formats: ['markdown'] } });
            return JSON.stringify(res);
          },
        }),
        scrapeUrl: tool({
          description: 'Read the full content of a specific URL.',
          inputSchema: z.object({ url: z.string() }),
          execute: async ({ url }: { url: string }) => {
            const res = await firecrawl.scrape(url, { formats: ['markdown'] });
            return (res as any).markdown || JSON.stringify(res);
          },
        }),
        generateNewsImage: tool({
          description: 'Generate or edit an AI illustration for the news post using gemini-3.1-flash-image-preview. Fixed to 4:3 dimension.',
          inputSchema: z.object({ 
            prompt: z.string().describe('Detailed prompt for the image generation'),
            reference_image_url: z.string().optional().describe('Optional URL of an image to edit or use as reference')
          }),
          execute: async ({ prompt, reference_image_url }: { prompt: string, reference_image_url?: string }) => {
            try {
              let imageContent: any[] = [{ type: 'text', text: prompt + ' (Make it 4:3 aspect ratio)' }];
              if (reference_image_url) {
                imageContent.push({ type: 'image', image: new URL(reference_image_url) });
              }
              
              const { files } = await generateText({
                model: googleAI('gemini-3.1-flash-image-preview'),
                messages: [{ role: 'user', content: imageContent as any }],
              });
              
              let fileLinkStr = '';
              for (const file of files) {
                if (file.mediaType.startsWith('image/')) {
                  const sentMsg = await ctx.replyWithPhoto({ source: Buffer.from(file.uint8Array) }, { caption: `Generated for prompt: ${prompt}` });
                  const fileLink = await ctx.telegram.getFileLink(sentMsg.photo[sentMsg.photo.length - 1].file_id);
                  fileLinkStr = fileLink.toString();
                  break;
                }
              }
              
              if (!fileLinkStr) {
                return 'Model failed to generate an image file.';
              }
              
              return `Successfully generated image and sent to user. URL to use for publishPost: ${fileLinkStr}`;
            } catch (e: any) {
              return `Failed to generate image: ${e.message}`;
            }
          },
        }),
        publishPost: tool({
          description: 'Call this ONLY when the user explicitly approves the final title, subtitle, and image. This will generate the full article, render the image, and publish it.',
          inputSchema: z.object({
            title: z.string().describe('The finalized bolded title in Bahasa Indonesia'),
            subtitle: z.string().describe('The finalized subtitle in Bahasa Indonesia'),
            image_url: z.string().describe('The URL of the approved image (either user uploaded or generated)'),
            source_name: z.string().describe('The original news source (e.g., Al Jazeera)'),
            gathered_facts: z.string().describe('A summary of the facts to base the 2-paragraph article on')
          }),
          execute: async ({ title, subtitle, image_url, source_name, gathered_facts }: { title: string, subtitle: string, image_url: string, source_name: string, gathered_facts: string }) => {
            // Internally generate the 2 paragraphs based on the facts
            const generationPrompt = `Write the 2-paragraph article body based on these facts:\n\n${gathered_facts}\n\nTitle: ${title}\nSubtitle: ${subtitle}\n\nStrict Rules:\n- Exactly 2 paragraphs separated by \\n\\n.\n- Must be short enough to fit inside a Telegram photo caption (under 1024 characters total).\n- Tone: Weaponized formal journalistic Bahasa Indonesia. Superficially objective, but deeply framed to favor the Axis of Resistance (Palestine, Iran, Lebanon, Yemen) and aggressively expose the complicity/hypocrisy of US, Israel, and GCC states.\n- PLAINTEXT ONLY (no markdown).\n- The very last line of the 2nd paragraph must be exactly: "DD/MM/YYYY. Sumber: ${source_name}". (Use DD/MM/YYYY literally, we will replace it later).`;
            
            const { text: articleBody } = await generateText({
              model: googleAI('gemini-3-flash-preview'),
              prompt: generationPrompt,
            });

            const currentDate = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
            
            // Replace literal DD/MM/YYYY with actual date
            const finalBody = articleBody.replace('DD/MM/YYYY', currentDate);
            const sanitizedBody = censorText(finalBody);

            const formattedTitle = title.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            const formattedSubtitle = subtitle.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            const imageBuffer = await generateNewsImage({
              image_url,
              title: censorText(formattedTitle),
              subtitle: censorText(formattedSubtitle),
              date: currentDate,
              source: censorText(source_name),
              my_handle: '@poros.perjuangan'
            });

            // Send photo with the sanitized body as caption and a publish button
            const state = JSON.stringify({
              action: 'publish_buffer',
              // We can't pass the whole buffer in callback_data due to 64 byte limit,
              // so we will pass the params or we need to store them temporarily.
              // To keep it simple, we can just save it to DB or a global map,
              // but for now, let's just generate it again in the callback or store it.
            });
            // Actually, callback_data is limited to 64 bytes.
            // Let's store the pending post data in memory (or db).
            // For simplicity, let's just create a global map in bot.ts.
            // So here we just need to return the buffer and caption. Wait, agent.ts doesn't have access to the global map easily unless we export it.
            // Let's export a function from bot.ts or create a separate file `store.ts`.
            
            // To avoid complexity, we can just send the photo first, get the file_id, and then the callback_data only needs the file_id and we can fetch the caption from the message.
            // Wait, if we send the photo with caption, the callback query will contain `ctx.callbackQuery.message.photo` and `ctx.callbackQuery.message.caption`.
            // So we don't need to store anything! We just read the photo file_id and caption from the message that the button is attached to!
            
            await ctx.replyWithPhoto(
              { source: imageBuffer }, 
              { 
                caption: sanitizedBody,
                ...Markup.inlineKeyboard([
                  Markup.button.callback('🚀 Publish to Instagram via Buffer', 'publish_to_buffer'),
                  Markup.button.callback('❌ Cancel', 'cancel_publish')
                ])
              }
            );

            return `Preview sent to user with Publish button. Waiting for user action.`;
          }
        })
      }
    });

    clearInterval(typingInterval);

    if (text) {
      // Telegram uses single asterisk for bold in basic Markdown
      const telegramText = text.replace(/\*\*/g, '*');
      try {
        await ctx.reply(telegramText, { parse_mode: 'Markdown' });
      } catch (e) {
        console.warn('Failed to send as Markdown, falling back to plaintext:', e);
        await ctx.reply(text);
      }
      // Save assistant response
      await db.insert(messages).values({
        chatId,
        role: 'assistant',
        content: text,
      });
    }

  } catch (error) {
    clearInterval(typingInterval);
    console.error('Error in agent:', error);
    await ctx.reply('Terjadi kesalahan saat memproses permintaan.');
  }
}
