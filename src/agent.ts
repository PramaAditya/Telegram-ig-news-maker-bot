import { TEMPLATES } from './templates.js';
import { getSettings } from './db/settings.js';
import { runResearchPhase } from './agents/research.js';
import { MediaItem, PipelineContext, getBaseSystemPrompt, withRetry } from './utils.js';

export async function runAutomatedPipeline(chatId: string, messageId: number, userInput: string, uploadedMedia: MediaItem[] | undefined, telegram: any, templateId: string = 'image:kabar.perjuangan:carousel_dark') {
  try {
    const template = TEMPLATES[templateId];
    if (!template) {
      throw new Error(`Template ${templateId} not found in registry`);
    }

    let statusMsg = await withRetry(() => telegram.sendMessage(chatId, '🔍 Mencari informasi...', { reply_to_message_id: messageId })) as any;

    const currentDateObj = new Date();
    const currentYear = currentDateObj.getFullYear();
    const currentDateStr = currentDateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
    
    const settings = await getSettings();
    const baseSystemPrompt = getBaseSystemPrompt(currentDateStr, currentYear);

    const pipelineContext: PipelineContext = {
      chatId,
      messageId,
      userInput,
      uploadedMedia,
      telegram,
      statusMsg,
      settings,
      currentDateStr,
      currentYear,
      baseSystemPrompt
    };

    // Phase 1: Research
    const researchResult = await runResearchPhase(pipelineContext);

    // Phase 2-5: Template-specific Pipeline
    await template.runPipeline(pipelineContext, researchResult);

  } catch (error: any) {
    console.error('[Pipeline Error]', error);
    try {
      await withRetry(() => telegram.sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message}`, { reply_to_message_id: messageId }));
    } catch (e) {
      console.error('[Pipeline Error] Failed to send error message to user:', e);
    }
    throw error;
  }
}
