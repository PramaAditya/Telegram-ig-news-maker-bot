import { generateText, generateObject, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import axios from 'axios';
import { censorText } from './sanitize.js';
import { uploadToS3 } from './s3.js';
import { generateImageSequence } from './image.js';
import { publishToBuffer } from './buffer.js';

dotenv.config();

const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

const getSystemPrompt = (currentDateStr: string, currentYear: number) => `You are a strict, automated editorial assistant crafting a news carousel for Instagram.
You operate entirely in BAHASA INDONESIA. Your tone should be highly informative, objective, and strictly journalistic.

CRITICAL CONTEXT REGARDING TIME:
Today's date is: ${currentDateStr}.
The current year is: ${currentYear}.
You MUST use the year ${currentYear} (and the current month if needed) in your web searches. Completely ignore any internal knowledge cutoff dates that suggest we are in the past.

EDITORIAL GUIDELINES & FRAMING:
Your reporting should maintain a professional and highly informative journalistic tone. Focus on delivering factual news while highlighting perspectives from the Global South, particularly Palestine, Lebanon, Iran, Iraq, and Yemen. When covering conflicts or international relations, critically examine the roles, policies, and actions of the US, Israel, and their allies. 

Crucially, avoid emotive language, sensationalism, or blatant propaganda. Let the facts, context, and a comprehensive delivery of the 5W1H (Who, What, When, Where, Why, How) drive the narrative. Your goal is to inform the audience thoroughly and objectively within the constraints of a short format.
`;

export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  mimeType?: string;
  buffer?: Buffer;
  s3Url?: string;
}

export async function runAutomatedPipeline(ctx: any, userInput: string, uploadedMedia?: MediaItem[]) {
  try {
    let statusMsg = await ctx.reply('🔍 Mencari informasi...');

    // Phase 1: Research (Fact Gathering)
    console.log(`[Phase 1] Researching: ${userInput}`);
    const currentDateObj = new Date();
    const currentYear = currentDateObj.getFullYear();
    const currentDateStr = currentDateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
    const currentDate = currentDateStr;
    
    const SYSTEM_PROMPT = getSystemPrompt(currentDateStr, currentYear);

    const messageContent: any[] = [
      { type: 'text', text: `User Input: ${userInput}` }
    ];

      if (uploadedMedia && uploadedMedia.length > 0) {
          for (const media of uploadedMedia) {
            console.log(`[Phase 1] Downloading media for Gemini: ${media.url}`);
            try {
                let response;
                let retries = 3;
                while (retries > 0) {
                  try {
                    response = await axios.get(media.url, { responseType: 'arraybuffer' });
                    break;
                  } catch (e: any) {
                    retries--;
                    console.warn(`[Phase 1] Download failed, retries left: ${retries}. Error: ${e.message}`);
                    if (retries === 0) throw e;
                    await new Promise(res => setTimeout(res, 2000));
                  }
                }
                
                let buffer = Buffer.from(response!.data);
              
              if (media.type === 'video') {
                console.log(`[Phase 1] Saving original video...`);
                media.buffer = buffer;
                
                console.log(`[Phase 1] Uploading video to S3...`);
                const s3Url = await uploadToS3(buffer, media.mimeType || 'video/mp4', '.mp4');
                media.s3Url = s3Url;
                console.log(`[Phase 1] S3 URL: ${s3Url}`);
                
                messageContent.push({
                  type: 'file',
                  data: s3Url,
                  mediaType: media.mimeType || 'video/mp4'
                });
              } else {
                console.log(`[Phase 1] Saving original image...`);
                media.buffer = buffer;
                
                console.log(`[Phase 1] Uploading image to S3...`);
                media.s3Url = await uploadToS3(buffer, 'image/jpeg', '.jpg');

                messageContent.push({
                  type: 'image',
                  image: buffer
                });
            }
          } catch (err: any) {
            console.error(`[Phase 1] Failed to process media:`, err.message);
          }
        }
      }

    let scrapedImageUrl: string | null = null;

    const { text: researchResult } = await generateText({
      model: googleAI('gemini-3.1-pro-preview'),
      system: SYSTEM_PROMPT + `\n\nYour task is to gather facts on the user's input. If the user input contains an http/https URL, you MUST prioritize using the \`scrapeUrl\` tool on that specific URL to read its content. If it's just a topic or keywords, use the \`searchWeb\` tool. If there are media attachments, analyze them to gather context. Return a comprehensive summary of all relevant facts. Ensure your web searches specify the current date (especially the year ${currentYear}) to get the latest news.`,
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ],
      tools: {
        searchWeb: tool({
          description: 'Search the web for latest news or facts about a topic.',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }: { query: string }) => {
            console.log(`[Tool: searchWeb] Searching for: "${query}"`);
            const res = await firecrawl.search(query, { limit: 3, scrapeOptions: { formats: ['markdown'] } });
            return JSON.stringify(res);
          },
        }),
        scrapeUrl: tool({
          description: 'Read the full content of a specific URL.',
          inputSchema: z.object({ url: z.string() }),
          execute: async ({ url }: { url: string }) => {
            console.log(`[Tool: scrapeUrl] Scraping URL: ${url}`);
            const res = await firecrawl.scrape(url, { formats: ['markdown'] });
            const metadata = (res as any).metadata;
            if (metadata && (metadata.ogImage || metadata.image)) {
               scrapedImageUrl = metadata.ogImage || metadata.image;
               console.log(`[Tool: scrapeUrl] Found image URL in metadata: ${scrapedImageUrl}`);
            }
            return (res as any).markdown || JSON.stringify(res);
          },
        }),
      },
      stopWhen: stepCountIs(3),
    });

    console.log(`[Phase 1] Research Complete. Text length: ${researchResult.length}`);
    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✍️ Menyusun konten...');

    // Phase 2: Content Generation
    console.log(`[Phase 2] Generating content`);
    const { object: contentParams } = await generateObject({
      model: googleAI('gemini-3.1-pro-preview'),
      system: SYSTEM_PROMPT + `
Your task is to parse the gathered facts into final components for an Instagram news carousel.
- title: Scroll-stopping, casual, highly sensational, and provocative (but factual) breaking news style. Target audience is Gen Z Indonesians. Use natural, modern, and impactful Indonesian phrasing. AVOID sounding repetitive, robotic, or overusing cliché slang like "Kena Mental" or "Skakmat". Make it sound like an authentic viral news alert on social media. Highlight the key factual phrase with HTML tags (<strong>text</strong>). Do NOT use markdown. IT MUST BE PROPER TITLE CASING (Capitalize the first letter of each major word, including inside the tags).
- slide_text: A single string of text for the slide explaining the news. IT MUST BE 2 SENTENCES MAXIMUM. Answer Who, What, When, Where, Why, and How (5W1H) as comprehensively as possible within these 2 sentences using the available facts. Separate sentences with double newlines (\\n\\n). Do NOT repeat information already stated in the title.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- image_prompt: A prompt for an AI image generator to create an accompanying cover background image. MUST specify: "real life stock photography, no text whatsoever, similar to photo taken by newspaper photographer or stock photographer".
`,
      schema: z.object({
        title: z.string(),
        slide_text: z.string(),
        source_name: z.string(),
        image_prompt: z.string(),
      }),
      prompt: `Original User Input/Caption:\n${userInput}\n\nGathered Facts:\n\n${researchResult}`,
    });
    
    let finalCaption = `${contentParams.slide_text.trim()}\n\n${currentDate}. Sumber: ${contentParams.source_name}`;
    finalCaption = censorText(finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🖼️ Mempersiapkan gambar...');

    // Phase 3: Image Sourcing
    let baseImageBuffer: Buffer | null = null;

    if (uploadedMedia && uploadedMedia.length > 0) {
      const firstMedia = uploadedMedia[0];
      if (firstMedia.type === 'image' && firstMedia.buffer) {
        baseImageBuffer = firstMedia.buffer;
        console.log(`[Phase 3] Using uploaded cover image for enhancement`);
      }
    } else if (scrapedImageUrl) {
      console.log(`[Phase 3] Using scraped image URL as base: ${scrapedImageUrl}`);
      try {
        const response = await axios.get(scrapedImageUrl, { responseType: 'arraybuffer' });
        baseImageBuffer = Buffer.from(response.data);
      } catch (err: any) {
        console.warn(`[Phase 3] Failed to download scraped image: ${err.message}`);
      }
    }

    let imageGenerationPrompt = "";
    const promptSuffix = "Enhance and sharpen the image. Relayout and ensure it is strictly in 1:1 aspect ratio. Ensure the image has the style of real life stock photography with NO TEXT whatsoever, similar to a photo taken by a newspaper photographer or stock photographer.";

    if (baseImageBuffer) {
      console.log(`[Phase 3] Enhancing cover image with Gemini...`);
      imageGenerationPrompt = `Based on the provided image, ${promptSuffix}`;
    } else {
      console.log(`[Phase 3] Generating cover image with prompt: ${contentParams.image_prompt}`);
      imageGenerationPrompt = `${contentParams.image_prompt}. ${promptSuffix}`;
    }

    const imageGenMessageContent: any[] = [];
    if (baseImageBuffer) {
      imageGenMessageContent.push({ type: 'image', image: baseImageBuffer });
    }
    imageGenMessageContent.push({ type: 'text', text: imageGenerationPrompt });

    const { files } = await generateText({
      model: googleAI('gemini-3.1-flash-image-preview'),
      messages: [{ role: 'user', content: imageGenMessageContent as any }],
      providerOptions: {
        google: {
          imageConfig: {
            aspectRatio: '1:1'
          }
        }
      }
    });
    
    let generatedFileBuffer: Buffer | null = null;
    if (files) {
      for (const file of files) {
        if (file.mediaType.startsWith('image/')) {
          generatedFileBuffer = Buffer.from(file.uint8Array);
          break;
        }
      }
    }

    if (!generatedFileBuffer) {
      throw new Error('Gagal menghasilkan atau memproses gambar dari AI.');
    }

    console.log(`[Phase 3] Uploading generated/enhanced image to S3...`);
    const coverImageUrl = await uploadToS3(generatedFileBuffer, 'image/jpeg', '.jpg');

    if (!coverImageUrl) {
      throw new Error('Gagal mendapatkan URL gambar.');
    }

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...');

    // Phase 4: Image Rendering
    console.log(`[Phase 4] Rendering carousel via API`);
    
    // Remove emojis from title
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu;
    const cleanTitle = contentParams.title.replace(emojiRegex, '');

    // Pagination step to ensure slides are not too long
    const MAX_SLIDE_LENGTH = 200;
    
    function paginateText(text: string, maxLength: number): string[] {
      const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      const slides: string[] = [];
      let currentSlide = '';

      for (const p of paragraphs) {
        if (p.length > maxLength) {
          if (currentSlide) {
            slides.push(currentSlide);
            currentSlide = '';
          }
          const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
          for (const sentence of sentences) {
            const s = sentence.trim();
            if (!s) continue;
            if (!currentSlide) {
              currentSlide = s;
            } else if (currentSlide.length + s.length + 1 <= maxLength) {
              currentSlide += ' ' + s;
            } else {
              slides.push(currentSlide);
              currentSlide = s;
            }
          }
        } else {
          if (!currentSlide) {
            currentSlide = p;
          } else if (currentSlide.length + p.length + 2 <= maxLength) {
            currentSlide += '\n\n' + p;
          } else {
            slides.push(currentSlide);
            currentSlide = p;
          }
        }
      }
      if (currentSlide) slides.push(currentSlide);
      return slides;
    }

    const paginatedSlides = paginateText(contentParams.slide_text, MAX_SLIDE_LENGTH);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✨ Menambahkan highlight teks...');
    console.log(`[Phase 4] Enhancing slides with markdown bolding via gemini-3.1-flash-lite...`);
    
    const highlightText = async (text: string) => {
      try {
        const { text: boldedText } = await generateText({
          model: googleAI('gemini-3.1-flash-lite-preview'),
          system: `You are an editor for an Instagram news carousel. Your task is to add bold markdown (using **text**) to the most important or shocking words, phrases, or clauses in the provided text. 
This helps readers scan the text and prevents it from being monotonous.
RULES:
1. Do not change any original words, only add ** around the important parts.
2. Output ONLY the modified text, nothing else.
3. Don't bold everything, just the key highlights (maximum 20-30% of the text).`,
          prompt: text
        });
        return boldedText.trim() || text;
      } catch (err) {
        console.warn('Failed to add bolding to text, falling back to original text:', err);
        return text;
      }
    };

    const boldedSlides = await Promise.all(paginatedSlides.map(text => highlightText(text)));

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...');

    const renderedUrls = await generateImageSequence({
      logo: 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
      cover_image: coverImageUrl,
      title: censorText(cleanTitle),
      slides: boldedSlides.map(text => ({
        text: censorText(text)
      }))
    });

    if (!renderedUrls || renderedUrls.length === 0) {
      throw new Error('Gagal merender carousel dari API.');
    }

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Mempublikasikan ke Buffer...');

    // Phase 5: Publishing via Buffer
    console.log(`[Phase 5] Sending rendered photo to user and preparing Buffer URLs`);
    
    // Fetch the first image (cover) to send back as preview
    let previewBuffer: Buffer | undefined;
    try {
      const response = await axios.get(renderedUrls[0], { responseType: 'arraybuffer' });
      previewBuffer = Buffer.from(response.data);
    } catch (e) {
      console.warn('Failed to fetch preview cover image:', e);
    }

    if (previewBuffer) {
      if (finalCaption.length > 1024) {
        await ctx.replyWithPhoto({ source: previewBuffer });
        await ctx.reply(finalCaption);
      } else {
        await ctx.replyWithPhoto(
          { source: previewBuffer },
          { caption: finalCaption }
        );
      }
    } else {
      await ctx.reply(finalCaption + `\n\nCover URL: ${renderedUrls[0]}`);
    }

    // Prepare array of media for Queue
    let allPublishUrls: { type: 'image' | 'video', url: string }[] = renderedUrls.map(url => ({
      type: 'image',
      url
    }));

    console.log(`[Phase 5] Saving to Queue with ${allPublishUrls.length} media items`);
    
    // Save to DB instead of direct Buffer publishing
    const { db } = await import('./db/index.js');
    const { queueTable } = await import('./db/schema.js');
    
    await db.insert(queueTable).values({
      text: finalCaption,
      media: allPublishUrls,
      status: 'pending'
    });

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Berhasil disimpan ke antrian (Queue)!');
    console.log(`[Done] Pipeline finished successfully.`);

  } catch (error: any) {
    console.error('[Pipeline Error]', error);
    await ctx.reply(`❌ Terjadi kesalahan: ${error.message}`);
  }
}
