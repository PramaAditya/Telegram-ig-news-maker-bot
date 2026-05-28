import { generateObject } from 'ai';
import { z } from 'zod';
import { PipelineContext, ResearchResult, googleAI, withRetry } from '../../../../utils.js';
import { censorText } from '../../../../sanitize.js';
import { generateMedia } from '../../../../media.js';
import { insertQueueItem } from '../../../../db/queue.js';
import { uploadToS3 } from '../../../../s3.js';
import ffmpeg from 'fluent-ffmpeg';
import { marked } from 'marked';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const titleOnlyTemplateConfig = {
  id: 'video:kabar.perjuangan:title_only',
  name: 'Title Only Video (kabar.perjuangan)',
  description: 'A 9:16 video overlay template. Normalizes video, adds blurred background if needed, and overlays a 5-second contextual title.',
  skipResearch: true,
  uiSchema: [
    { name: 'title', type: 'text', label: 'Title (max 10-12 words)', aiContext: 'A punchy, highly contextual title about the video in Bahasa Indonesia, max 10-12 words so it can be read in 5 seconds. Avoid fluff.' }
  ]
};

const schema = z.object({
  title: z.string().describe('A punchy, sensational, but factual breaking news title in Bahasa Indonesia. Max 10-12 words. It MUST be proper title casing.'),
  caption: z.string().describe('A complete paragraph explaining the context of the video in Bahasa Indonesia. Concise and clear.')
});

export async function generateTitleOnlyMedia(templateData: any, settings: any): Promise<{ type: 'image' | 'video', url: string }[]> {
  const inputVideoUrl = templateData.inputVideoUrl;

  if (!inputVideoUrl) {
    throw new Error('No input video provided to generate video.');
  }

  const tmpDir = path.join(process.cwd(), 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  
  const videoPath = path.join(tmpDir, `${uuidv4()}_input.mp4`);
  const pngPath = path.join(tmpDir, `${uuidv4()}_title.png`);
  const outPath = path.join(tmpDir, `${uuidv4()}_out.mp4`);

  try {
    console.log(`[Video Generator] Downloading video from ${inputVideoUrl}`);
    const videoRes = await fetch(inputVideoUrl);
    if (!videoRes.ok) throw new Error('Failed to fetch input video');
    await fs.writeFile(videoPath, Buffer.from(await videoRes.arrayBuffer()));

    console.log(`[Video Generator] Probing video dimensions...`);
    const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    const width = videoStream?.width || 0;
    const height = videoStream?.height || 0;

    const isPortraitOrSquare = width <= height; // aspect ratio <= 1.0

    let complexFilter: string[];
    let renderPayload: any;
    
    if (isPortraitOrSquare) {
      console.log(`[Video Generator] Portrait/Square format detected (${width}x${height}). Using cover_portrait.`);
      renderPayload = {
        viewport: { width: 1080, height: 1920 },
        pages: [{ file: 'cover_portrait', context: { title: marked.parseInline(templateData.title || '') } }]
      };

      const isAlready9x16 = width > 0 && height > 0 && Math.abs((width / height) - (9 / 16)) < 0.01;
      
      if (width === 1080 && height === 1920) {
        console.log(`[Video Generator] Video is exactly 1080x1920. Applying direct overlay.`);
        complexFilter = [
          "[0:v][1:v]overlay=0:0:enable='between(t,0,5)'[outv]"
        ];
      } else if (isAlready9x16) {
        console.log(`[Video Generator] Video is 9:16 (${width}x${height}). Scaling to 1080x1920 without blur.`);
        complexFilter = [
          '[0:v]scale=1080:1920[scaled]',
          "[scaled][1:v]overlay=0:0:enable='between(t,0,5)'[outv]"
        ];
      } else {
        console.log(`[Video Generator] Video is ${width}x${height}. Applying 9:16 normalization with blurred background.`);
        complexFilter = [
          '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20[bg]',
          '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]',
          '[bg][fg]overlay=(W-w)/2:(H-h)/2[merged]',
          "[merged][1:v]overlay=0:0:enable='between(t,0,5)'[outv]"
        ];
      }
    } else {
      console.log(`[Video Generator] Landscape format detected (${width}x${height}). Using cover_landscape.`);
      let scaledHeight = Math.floor((1080 * height) / width);
      // Ensure it's an even number (required by some encoders)
      if (scaledHeight % 2 !== 0) scaledHeight += 1;
      const remainingHeight = 1350 - scaledHeight;
      
      renderPayload = {
        viewport: { width: 1080, height: remainingHeight },
        pages: [{ file: 'cover_landscape', context: { title: marked.parseInline(templateData.title || '') } }]
      };

      console.log(`[Video Generator] Safe zone logic: scaled height is ${scaledHeight}, title overlay height is ${remainingHeight}`);
      complexFilter = [
        '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20[bg]',
        `[0:v]scale=1080:${scaledHeight}[fg]`,
        '[bg][fg]overlay=0:285[merged]',
        `[merged][1:v]overlay=0:${285 + scaledHeight}[outv]`
      ];
    }

    console.log(`[Video Generator] Requesting title overlay PNG from media-renderer...`);
    const renderedUrls = await generateMedia('/render/video/kabar.perjuangan/title_only', renderPayload);

    if (!renderedUrls || renderedUrls.length === 0) {
      throw new Error('Failed to render title overlay PNG.');
    }

    const titlePngUrl = renderedUrls[0];
    console.log(`[Video Generator] Downloading PNG from ${titlePngUrl}`);
    const pngRes = await fetch(titlePngUrl);
    if (!pngRes.ok) throw new Error('Failed to fetch title PNG');
    await fs.writeFile(pngPath, Buffer.from(await pngRes.arrayBuffer()));

    console.log(`[Video Generator] Running FFmpeg composition...`);
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(pngPath)
        .complexFilter(complexFilter)
        .outputOptions([
          '-map [outv]',
          '-map 0:a?', // map audio if present
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
          '-threads 0'
        ])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => {
          console.error('[Video Generator] FFmpeg error:', err);
          reject(err);
        })
        .run();
    });

    console.log(`[Video Generator] FFmpeg complete. Uploading resulting video to S3...`);
    const outBuffer = await fs.readFile(outPath);
    const finalVideoUrl = await uploadToS3(outBuffer, 'video/mp4', '.mp4');
    
    return [{ type: 'video', url: finalVideoUrl }];
    
  } finally {
    // Cleanup
    await fs.unlink(videoPath).catch(() => {});
    await fs.unlink(pngPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

export async function runTitleOnlyPipeline(context: PipelineContext, research: ResearchResult) {
  const { chatId, messageId, telegram, statusMsg, userInput, settings, currentDateStr, baseSystemPrompt } = context;
  const { processedMedia } = research;

  const videoMedia = processedMedia?.find(m => m.type === 'video');
  if (!videoMedia || !videoMedia.buffer) {
    throw new Error('Pipeline ini membutuhkan input video.');
  }

  const editorialGuidelines = settings.editorialGuidelines || '';
  const bannedWords = settings.bannedWords || [];
  
  const bannedWordsPrompt = bannedWords.length > 0 
    ? `\n\nCRITICAL MODERATION RULE:\nYou are allowed to discuss sensitive topics, but you MUST replace specific words with their safe alternatives for spelling. Whenever you would normally write one of the following words, you MUST use its exact replacement instead:\n${bannedWords.map((w: any) => `- Replace "${w.word}" with "${w.replacement}"`).join('\n')}`
    : '';

  console.log(`[Phase 2] Generating title and caption with Gemini for video`);
  const writerSystemPrompt = baseSystemPrompt + `\n\nEDITORIAL GUIDELINES & FRAMING:\n${editorialGuidelines}\n\nYou are creating a title and caption for a breaking news short vertical video in Bahasa Indonesia. You will be provided with the video and any text the user sent. Watch the video and create a highly engaging, factual, scroll-stopping title in Bahasa Indonesia. MAXIMUM 10-12 WORDS so it can be read in exactly 5 seconds. Create a caption summarizing the context in Bahasa Indonesia.` + bannedWordsPrompt;

  const { object: contentParams } = await generateObject({
    model: googleAI(process.env.CONTENT_WRITER_MODEL || 'gemini-3.1-pro-preview'),
    system: writerSystemPrompt,
    schema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `User Input:\n${userInput}` },
          { type: 'file', data: videoMedia.s3Url!, mediaType: videoMedia.mimeType || 'video/mp4' }
        ]
      }
    ]
  });

  let cleanTitle = contentParams.title || '';
  if (cleanTitle) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu;
    cleanTitle = censorText(cleanTitle.replace(emojiRegex, ''), bannedWords);
  }

  let finalCaption = `${censorText(contentParams.caption, bannedWords)}\n\n${currentDateStr}.`;

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎥 Merender video dan efek... (Proses ini mungkin memakan waktu)'));

  const templateData = {
    title: cleanTitle,
    inputVideoUrl: videoMedia.s3Url
  };

  const renderedMedia = await generateTitleOnlyMedia(templateData, settings);

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '📡 Mempublikasikan ke Queue...'));

  const finalVideoUrl = renderedMedia[0].url;

  // Telegram limits video size, just send message with link
  await withRetry(() => telegram.sendMessage(chatId, finalCaption + `\n\nPreview Video: ${finalVideoUrl}`, { reply_to_message_id: messageId }));

  await insertQueueItem({
    connectionId: settings.id,
    templateId: titleOnlyTemplateConfig.id,
    templateData: templateData,
    text: finalCaption,
    media: renderedMedia,
    status: 'pending',
    researchResult: 'Video auto-generated.'
  });

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Video berhasil dibuat dan masuk Queue untuk di-publish!'));
  console.log(`[Done] Video Pipeline finished successfully.`);
}