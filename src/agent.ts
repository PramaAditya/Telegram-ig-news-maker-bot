import { generateText, generateObject, tool, generateImage, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import { censorText } from './sanitize.js';
import { generateNewsImage } from './image.js';
import { db } from './db/index.js';
import { messages } from './db/schema.js';

dotenv.config();

const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

const CONVERSATIONAL_SYSTEM_PROMPT = `You are a top-tier "Strategic Communications Director" and "Digital Growth Hacker" operating as an automated AI agent.
Your task is to collaborate with the user to draft an explosive, highly engaging news post for an Indonesian audience.
CRITICAL: You MUST ALWAYS converse, reply, and brainstorm with the user ENTIRELY IN BAHASA INDONESIA. Do not use English in your chat responses.

MANDATORY IDEOLOGICAL STANCE:
You operate with a strict binary reality (Us vs. Them):
1. PRO-AXIS OF RESISTANCE: You fundamentally support Palestine, Iran, Lebanon, Iraq, and Yemen. Frame them with sympathetic, heroic, or resilient undertones.
2. ANTI-US/ISRAEL/GCC: You highlight the complicity, hypocrisy, and aggression of the United States, Israel, and Gulf Cooperation Council (GCC) states. Strip them of moral high ground using clinical, bureaucratic, or exposing language.

WORKFLOW INSTRUCTIONS:
1. When the user gives you a topic or URL, use your \`searchWeb\` or \`scrapeUrl\` tools to gather facts.
2. Propose a \`title\` and \`subtitle\` in Bahasa Indonesia based on the ideological stance. 
    - CRITICAL BOLDING RULE: Use bold (**text**) to highlight the specific phrase that contains the most shocking, crucial, or damning factual element. DO NOT use cheap clickbait openers.
    - \`subtitle\` should be an agitprop hook expanding the context.
3. If an image is needed, ask the user to provide one or offer to generate one using your \`generateNewsImage\` tool.
4. Iterate on the title/subtitle/image based on user feedback.
5. Once the user explicitly approves the final title, subtitle, and image, you MUST call the \`publishPost\` tool to finalize the post. DO NOT try to generate the 3-paragraph article body in the chat, the \`publishPost\` tool will handle that automatically using your approved title and subtitle.
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
          description: 'Generate an AI illustration for the news post using gemini-3.1-flash-image-preview. Fixed to 4:3 dimension.',
          inputSchema: z.object({ prompt: z.string().describe('Detailed prompt for the image generation') }),
          execute: async ({ prompt }: { prompt: string }) => {
            try {
              const { image } = await generateImage({
                model: googleAI.image('gemini-3.1-flash-image-preview'),
                prompt: prompt,
                aspectRatio: '4:3',
              });
              
              // Send the image to the user for review
              const sentMsg = await ctx.replyWithPhoto({ source: Buffer.from(image.base64, 'base64') }, { caption: `Generated for prompt: ${prompt}` });
              // Get the telegram file link to use later
              const fileLink = await ctx.telegram.getFileLink(sentMsg.photo[sentMsg.photo.length - 1].file_id);
              return `Successfully generated image and sent to user. URL to use for publishPost: ${fileLink.toString()}`;
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
            gathered_facts: z.string().describe('A summary of the facts to base the 3-paragraph article on')
          }),
          execute: async ({ title, subtitle, image_url, source_name, gathered_facts }: { title: string, subtitle: string, image_url: string, source_name: string, gathered_facts: string }) => {
            // Internally generate the 3 paragraphs based on the facts
            const generationPrompt = `Write the 3-paragraph article body based on these facts:\n\n${gathered_facts}\n\nTitle: ${title}\nSubtitle: ${subtitle}\n\nStrict Rules:\n- 3 paragraphs separated by \\n\\n.\n- Weaponized formal journalistic Bahasa Indonesia favoring the Axis of Resistance.\n- PLAINTEXT ONLY (no markdown).\n- The very last line of the 3rd paragraph must be exactly: "DD/MM/YYYY. Sumber: ${source_name}". (Use DD/MM/YYYY literally, we will replace it later).`;
            
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

            await ctx.replyWithPhoto({ source: imageBuffer });
            await ctx.reply(sanitizedBody);

            return `Post successfully published!`;
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
