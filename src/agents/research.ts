import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { firecrawlService } from '../utils/firecrawl.js';
import fs from 'fs/promises';
import { uploadToS3 } from '../s3.js';
import { PipelineContext, ResearchResult, googleAI, withRetry } from '../utils.js';



export async function processMediaOnly(context: PipelineContext): Promise<ResearchResult> {
  const { uploadedMedia } = context;
  const processedMedia = [...(uploadedMedia || [])];

  if (processedMedia.length > 0) {
    for (const media of processedMedia) {
      console.log(`[Phase 1 Skip] Downloading media: ${media.url}`);
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
              const fetchRes = await fetch(media.url);
              if (!fetchRes.ok) throw new Error(`Fetch failed: ${fetchRes.statusText}`);
              const arrayBuffer = await fetchRes.arrayBuffer();
              response = { data: Buffer.from(arrayBuffer) };
            }
            break;
          } catch (e: any) {
            retries--;
            console.warn(`[Phase 1 Skip] Download failed, retries left: ${retries}. Error: ${e.message}`);
            if (retries === 0) throw e;
            await new Promise(res => setTimeout(res, 2000));
          }
        }
        
        let buffer = Buffer.from(response!.data);
        media.buffer = buffer;
        
        if (media.type === 'video') {
          console.log(`[Phase 1 Skip] Uploading video to S3...`);
          const s3Url = await uploadToS3(buffer, media.mimeType || 'video/mp4', '.mp4');
          media.s3Url = s3Url;
          console.log(`[Phase 1 Skip] S3 URL: ${s3Url}`);
        } else {
          console.log(`[Phase 1 Skip] Uploading image to S3...`);
          media.s3Url = await uploadToS3(buffer, 'image/jpeg', '.jpg');
        }
      } catch (err: any) {
        console.error(`[Phase 1 Skip] Failed to process media:`, err.message);
      }
    }
  }

  return {
    researchText: '',
    scrapedImageUrl: null,
    scrapedImageUrls: [],
    processedMedia
  };
}

export async function runResearchPhase(context: PipelineContext): Promise<ResearchResult> {
  const { userInput, uploadedMedia, currentYear, baseSystemPrompt, telegram, statusMsg } = context;
  
  console.log(`[Phase 1] Researching: ${userInput}`);
  
  // Research prompt: strictly neutral 5W1H
  const researchSystemPrompt = baseSystemPrompt + `\n\nRESEARCH GUIDELINES:\nMaintain a strictly neutral, objective, and highly informative investigative journalistic tone. Focus on gathering factual news, context, and a comprehensive delivery of the 5W1H (Who, What, When, Where, Why, How). Do not apply any political bias, emotive language, or specific framing during the research phase.\n\nYour task is to gather facts on the user's input. If the user input contains an http/https URL, you MUST prioritize using the \`scrapeUrl\` tool on that specific URL to read its content. If it's just a topic or keywords, use the \`searchWeb\` tool. If there are media attachments, analyze them to gather context. Return a comprehensive summary of all relevant facts. Ensure your web searches specify the current date (especially the year ${currentYear}) to get the latest news.\n\nIMPORTANT IMAGE CURATION:\nIf you find highly relevant news photographs or editorial images within the scraped markdown content, list them at the end of your summary under a "### Relevant Images" section using markdown image syntax: ![description](url). Do NOT include logos, icons, avatars, promotional banners, or irrelevant UI elements.`;

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
                const fetchRes = await fetch(media.url);
                if (!fetchRes.ok) throw new Error(`Fetch failed: ${fetchRes.statusText}`);
                const arrayBuffer = await fetchRes.arrayBuffer();
                response = { data: Buffer.from(arrayBuffer) };
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
  let scrapedImageUrls: string[] = [];

  const extractImagesFromMarkdown = (md: string) => {
    const regex = /!\[.*?\]\((.*?)\)/g;
    let match;
    while ((match = regex.exec(md)) !== null) {
      const url = match[1].trim();
      if (url.startsWith('http') && !url.includes('firecrawl')) {
        scrapedImageUrls.push(url);
      }
    }
  };

  let researchText = '';
  let attempt = 0;
  const maxRetries = 3;
  let fallbackMarkdown = '';

  while (attempt < maxRetries) {
    try {
      attempt++;
      console.log(`[Phase 1] Research AI generation attempt ${attempt}...`);
      const response = await generateText({
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
              const res = await firecrawlService.search(query, { limit: 3, scrapeOptions: { formats: ['markdown'] } });
              
              if (res && (res as any).data) {
                (res as any).data.forEach((item: any) => {
                  if (item.metadata && (item.metadata.ogImage || item.metadata.image)) {
                    const img = item.metadata.ogImage || item.metadata.image;
                    if (img && img.startsWith('http')) scrapedImageUrls.push(img);
                  }
                });
              }
              return JSON.stringify(res);
            },
          }),
          scrapeUrl: tool({
            description: 'Read the full content of a specific URL.',
            inputSchema: z.object({ url: z.string() }),
            execute: async ({ url }: { url: string }) => {
              console.log(`[Tool: scrapeUrl] Scraping URL: ${url}`);
              const res = await firecrawlService.scrape(url, { formats: ['markdown'] });
              const metadata = (res as any).metadata;
              const markdown = (res as any).markdown;
              
              if (metadata && (metadata.ogImage || metadata.image)) {
                 scrapedImageUrl = metadata.ogImage || metadata.image;
                 if (scrapedImageUrl && scrapedImageUrl.startsWith('http')) {
                   scrapedImageUrls.push(scrapedImageUrl);
                 }
                 console.log(`[Tool: scrapeUrl] Found image URL in metadata: ${scrapedImageUrl}`);
              }
              
              if (markdown) {
                fallbackMarkdown += `\n\n--- Content from ${url} ---\n${markdown}`;
              }
              
              return markdown || JSON.stringify(res);
            },
          }),
        },
        stopWhen: stepCountIs(3),
      });

      researchText = response.text;

      if (researchText && researchText.trim().length > 0) {
        break; // Success, non-empty output
      } else {
        console.warn(`[Phase 1] Research AI returned empty output on attempt ${attempt}.`);
      }
    } catch (error) {
      console.warn(`[Phase 1] Research AI generation failed on attempt ${attempt}:`, error);
    }

    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(res => setTimeout(res, delay));
    }
  }

  if (!researchText || researchText.trim().length === 0) {
    console.warn(`[Phase 1] Failed to generate research text after ${maxRetries} attempts. Using fallback content.`);
    researchText = `Raw Input:\n${userInput}\n\n${fallbackMarkdown}`;
  }

  console.log(`[Phase 1] Research Complete. Text length: ${researchText.length}`);
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✍️ Menyusun konten...'));
  
  // Extract AI-curated images from the final response
  extractImagesFromMarkdown(researchText);

  // Deduplicate image URLs
  scrapedImageUrls = [...new Set(scrapedImageUrls)];
  if (scrapedImageUrls.length > 0) {
    console.log(`[Phase 1] Found ${scrapedImageUrls.length} relevant images during research.`);
  }

  return {
    researchText,
    scrapedImageUrl,
    scrapedImageUrls,
    processedMedia
  };
}
