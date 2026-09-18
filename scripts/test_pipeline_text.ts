import dotenv from 'dotenv';
dotenv.config();

for (const [key, val] of Object.entries(process.env)) {
  if (typeof val === 'string' && val.includes('${')) {
    process.env[key] = val.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, varName) => process.env[varName] || '');
  }
}

import { runResearchPhase } from '../src/agents/editorial/research.js';
import { runOpinionPhase } from '../src/agents/editorial/opinion.js';
import { generateCarouselDarkContent } from '../src/agents/pipelines/image/poros.perjuangan/carousel_dark.js';
import { getConnection } from '../src/db/settings.js';
import { getBaseSystemPrompt, PipelineContext } from '../src/utils.js';

// ============================================================================
// CONFIGURABLE INPUT
// ============================================================================
// Priority:
// 1. CLI Arguments: `tsx scripts/test_pipeline_text.ts "your text or url"`
// 2. Environment variable: `INPUT_TEXT`
// 3. Configurable default below
// ============================================================================
const DEFAULT_INPUT = `https://english.almayadeen.net/articles/why-the-israelis-are-so-afraid-of-a-liberated-yemen

Kenapa Israel takut Yaman Merdeka oleh Ansarullah`;

const cliArg = process.argv.slice(2).join(' ').trim();
const rawInput = cliArg || process.env.INPUT_TEXT || DEFAULT_INPUT;

async function runTextPipeline() {
  console.log('='.repeat(78));
  console.log('              TEXT-ONLY PIPELINE TEST RUNNER');
  console.log('='.repeat(78));
  console.log('\n[Input Configuration]:');
  console.log(rawInput);
  console.log('-'.repeat(78));

  // 1. Resolve Settings (DB or Fallback)
  let settings: any = null;
  try {
    settings = await getConnection(1);
    if (!settings) {
      const { getConnections } = await import('../src/db/settings.js');
      const all = await getConnections();
      if (all && all.length > 0) {
        settings = all[0];
      }
    }
    if (settings) {
      console.log(`[Config] Connected to DB settings: "${settings?.name || 'Default'}" (ID: ${settings?.id})`);
    }
  } catch (err: any) {
    console.warn(`[Config] DB lookup error (${err.message}).`);
  }

  if (!settings) {
    settings = {
      id: 1,
      name: 'Default Test Connection',
      editorialGuidelines: process.env.EDITORIAL_GUIDELINES || `Your reporting should maintain a professional and highly informative journalistic tone. Focus on delivering factual news while highlighting perspectives from the Global South, particularly Palestine, Lebanon, Iran, Iraq, and Yemen. When covering conflicts or international relations, critically examine the roles, policies, and actions of the US, Israel, and their allies.\n\nCrucially, avoid emotive language, sensationalism, or blatant propaganda. Let the facts, context, and a comprehensive delivery of the 5W1H (Who, What, When, Where, Why, How) drive the narrative. Your goal is to inform the audience thoroughly and objectively within the constraints of a short format.`,
      bannedWords: [],
    };
  }

  const currentDateObj = new Date();
  const currentYear = currentDateObj.getFullYear();
  const currentDateStr = currentDateObj.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  });
  const baseSystemPrompt = getBaseSystemPrompt(currentDateStr, currentYear);

  const mockTelegram = {
    editMessageText: async (_chatId: any, _msgId: any, _entities: any, text: string) => {
      console.log(`  -> [Telegram Status]: ${text}`);
      return true;
    },
    sendMessage: async (_chatId: any, text: string) => {
      console.log(`  -> [Telegram Msg]: ${text}`);
      return { message_id: 1 };
    }
  };

  const context: PipelineContext = {
    chatId: 'test_chat_id',
    messageId: 101,
    userInput: rawInput,
    uploadedMedia: [],
    telegram: mockTelegram,
    statusMsg: { chat: { id: 'test_chat_id' }, message_id: 101 },
    settings,
    currentDateStr,
    currentYear,
    baseSystemPrompt,
    connectionId: settings.id || 1,
  };

  // ==========================================================================
  // PHASE 1: FACTUAL RESEARCH AGENT
  // ==========================================================================
  console.log('\n' + '='.repeat(78));
  console.log('>>> PHASE 1: RESEARCH AGENT (src/agents/editorial/research.ts)');
  console.log('='.repeat(78));
  const startTimeResearch = Date.now();
  const researchResult = await runResearchPhase(context);
  const researchDuration = ((Date.now() - startTimeResearch) / 1000).toFixed(1);

  console.log(`\n[Research Finished in ${researchDuration}s]`);
  console.log(`- Primary Source: ${researchResult.primarySourceUrl || 'None'}`);
  console.log(`- Candidate Sources: ${researchResult.candidateSources?.length || 0}`);
  if (researchResult.candidateSources && researchResult.candidateSources.length > 0) {
    researchResult.candidateSources.forEach(s => console.log(`   * [${s.domain || 'source'}]: ${s.url}`));
  }
  console.log(`- Scraped Images: ${researchResult.scrapedImageUrls?.length || 0}`);
  if (researchResult.scrapedImageUrls && researchResult.scrapedImageUrls.length > 0) {
    researchResult.scrapedImageUrls.slice(0, 3).forEach(img => console.log(`   * ${img}`));
  }

  console.log('\n--- FACTUAL RESEARCH NOTES (5W1H) ---');
  console.log(researchResult.researchText);

  // ==========================================================================
  // PHASE 2: EDITORIAL OPINION AGENT
  // ==========================================================================
  console.log('\n' + '='.repeat(78));
  console.log('>>> PHASE 2: OPINION AGENT (src/agents/editorial/opinion.ts)');
  console.log('='.repeat(78));
  const startTimeOpinion = Date.now();
  const opinionText = await runOpinionPhase(context, researchResult.researchText);
  const opinionDuration = ((Date.now() - startTimeOpinion) / 1000).toFixed(1);

  console.log(`\n[Opinion Finished in ${opinionDuration}s]`);
  console.log('--- EDITORIAL OPINION & ANGLE ---');
  console.log(opinionText);

  // ==========================================================================
  // PHASE 3: CONTENT GENERATION (SLIDES & CAPTION)
  // ==========================================================================
  console.log('\n' + '='.repeat(78));
  console.log('>>> PHASE 3: CONTENT GENERATOR (generateCarouselDarkContent)');
  console.log('='.repeat(78));
  const insights = {
    research: researchResult.researchText,
    opinion: opinionText,
  };

  const startTimeContent = Date.now();
  const { title, slides, source_name, source_url, finalCaption } = await generateCarouselDarkContent(
    context,
    insights,
    researchResult.candidateSources,
    researchResult.primarySourceUrl
  );
  const contentDuration = ((Date.now() - startTimeContent) / 1000).toFixed(1);

  console.log(`\n[Content Generation Finished in ${contentDuration}s]`);
  console.log('\n--- TITLE ---');
  console.log(title);

  console.log('\n--- SLIDES ---');
  slides.forEach((slide, i) => {
    console.log(`[Slide ${i + 1} | Type: ${slide.type}]`);
    console.log(slide.text);
    console.log('');
  });

  console.log('--- SOURCE METADATA ---');
  console.log(`Source Name: ${source_name}`);
  console.log(`Source URL : ${source_url || 'N/A'}`);

  console.log('\n--- FINAL INSTAGRAM CAPTION ---');
  console.log(finalCaption);

  console.log('\n' + '='.repeat(78));
  console.log('>>> PIPELINE TEXT-ONLY RUN COMPLETE');
  console.log(`Total Time: ${(
    parseFloat(researchDuration) +
    parseFloat(opinionDuration) +
    parseFloat(contentDuration)
  ).toFixed(1)}s`);
  console.log('='.repeat(78));
}

runTextPipeline().catch((err) => {
  console.error('\n[Fatal Error Running Pipeline]:', err);
  process.exit(1);
});
