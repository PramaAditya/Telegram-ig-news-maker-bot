import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import axios from 'axios';
import fs from 'fs/promises';
import { uploadToS3 } from '../s3.js';
import { PipelineContext, ResearchResult, googleAI, withRetry } from '../utils.js';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

export async function runResearchPhase(context: PipelineContext): Promise<ResearchResult> {
  const { userInput, uploadedMedia, currentYear, baseSystemPrompt, telegram, statusMsg } = context;
  
  console.log(`[Phase 1] Researching: ${userInput}`);
  
  // Research prompt: strictly neutral 5W1H
  const researchSystemPrompt = baseSystemPrompt + `\n\nRESEARCH GUIDELINES:\nMaintain a strictly neutral, objective, and highly informative investigative journalistic tone. Focus on gathering factual news, context, and a comprehensive delivery of the 5W1H (Who, What, When, Where, Why, How). Do not apply any political bias, emotive language, or specific framing during the research phase.\n\nYour task is to gather facts on the user's input. If the user input contains an http/https URL, you MUST prioritize using the \`scrapeUrl\` tool on that specific URL to read its content. If it's just a topic or keywords, use the \`searchWeb\` tool. If there are media attachments, analyze them to gather context. Return a comprehensive summary of all relevant facts. Ensure your web searches specify the current date (especially the year ${currentYear}) to get the latest news.`;

  const messageContent: any[] = [
    { type: 'text', text: `User Input: ${userInput}` }
  ];

  const processedMedia = [...(uploadedMedia || [])];

  if (processedMedia.length > 0) {
    for (const media of processedMedia) {
      console.log(`[Phase 1] Downloading media for Gemini: ${media.url}`);
      try {
        let response;
        let retries = 3;
        while (retries > 0) {
          try {
            if (media.url.startsWith('file://')) {
              const parsedUrl = new URL(media.url);
              const filePath = decodeURIComponent(parsedUrl.pathname);
              const fileBuffer = await fs.readFile(filePath);
              response = { data: fileBuffer };
            } else {
              response = await axios.get(media.url, { responseType: 'arraybuffer' });
            }
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

  const { text: researchText } = await generateText({
    model: googleAI(process.env.CONTENT_RESEARCHER_MODEL || 'gemini-3.1-pro-preview'),
    system: researchSystemPrompt,
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

  console.log(`[Phase 1] Research Complete. Text length: ${researchText.length}`);
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✍️ Menyusun konten...'));

  return {
    researchText,
    scrapedImageUrl,
    processedMedia
  };
}
