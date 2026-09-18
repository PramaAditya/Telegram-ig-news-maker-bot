import { generateText } from "ai";
import {
  PipelineContext,
  googleAI,
  withRetry,
} from "../../utils.js";
import { censorText } from "../../sanitize.js";
import { AgentStepConfig } from "./types.js";

export const opinionAgentConfig: AgentStepConfig = {
  id: 'opinion',
  name: 'Editorial Opinion',
  label: 'Analisis Opini & Sudut Pandang',
  description: 'Analisis implikasi kebijakan, pembongkaran motif kekuasaan, dan perumusan sudut pandang editorial tajam.',
  icon: 'Lightbulb',
  badgeColor: 'amber',
  displayOrder: 2,
  ui: {
    format: 'markdown',
    collapsible: true,
    defaultExpanded: true,
    editable: true,
  },
  promptContext: {
    header: 'EDITORIAL OPINION & CORE ARGUMENT',
  },
};

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function runOpinionPhase(
  context: PipelineContext,
  researchText: string,
): Promise<string> {
  const {
    userInput,
    currentYear,
    currentDateStr,
    baseSystemPrompt,
    telegram,
    statusMsg,
    settings,
  } = context;

  const defaultGuidelines = process.env.EDITORIAL_GUIDELINES ||
    'Lakukan analisis kritis terhadap isu ini dengan fokus pada kepentingan publik, akuntabilitas pembuat kebijakan, dan dampak sosial-ekonomi bagi masyarakat kelas menengah-bawah.';
  const editorialGuidelines = settings?.editorialGuidelines || defaultGuidelines;
  const bannedWords = settings?.bannedWords || [];

  const bannedWordsPrompt = bannedWords.length > 0
    ? `\n\nCRITICAL MODERATION RULE:\nYou are allowed to discuss sensitive topics, but you MUST replace specific words with their safe alternatives for spelling. Whenever you would normally write one of the following words, you MUST use its exact replacement instead:\n${bannedWords.map((w: { word: string, replacement: string }) => `- Replace "${w.word}" with "${w.replacement}"`).join('\n')}`
    : '';

  if (telegram && statusMsg) {
    try {
      await withRetry(() =>
        telegram.editMessageText(
          statusMsg.chat.id,
          statusMsg.message_id,
          undefined,
          "💡 Menganalisis sudut pandang editorial...",
        ),
      );
    } catch (e) {
      console.warn('[Opinion Agent] Failed to update telegram status:', e);
    }
  }

  const opinionSystemPrompt = `${baseSystemPrompt}

PERAN & TUJUAN:
Anda adalah Chief Editorial Analyst untuk media berita digital progresif di Indonesia.
Tugas Anda adalah membedah fakta-fakta mentah yang telah dikumpulkan pada fase riset dan merumuskan sudut pandang editorial (editorial stance), pisau analisis, serta argumen inti yang tajam dan berani.

PEDOMAN EDITORIAL & SUDUT PANDANG AKUN (WAJIB DIPATUHI):
${editorialGuidelines}
${bannedWordsPrompt}

PANDUAN PENYUSUNAN OPINI:
1. Pahami konteks 5W1H dari fakta yang disajikan.
2. Identifikasi dinamika kekuasaan: Siapa yang mengambil keputusan? Siapa yang menanggung beban/kerugian di lapangan? Apakah ada kontradiksi antara narasi formal pejabat vs fakta nyata?
3. Format output analisis Anda ke dalam 3 poin terstruktur (gunakan format Markdown):
   - **Tesis Utama (Stance)**: 1-2 kalimat tegas yang merangkum posisi dan sudut pandang redaksi terhadap isu ini.
   - **Poin Kritis (Key Arguments)**: 2-3 poin argumen padat berisi sintesis antara data/regulasi dengan dampak riil di masyarakat.
   - **Refleksi / Punchline**: 1 kalimat penutup reflektif atau pertanyaan kritis yang menantang pemikiran audiens.
4. Gunakan Bahasa Indonesia yang bernas, intelektual, lugas, dan berbobot tanpa bertele-tele. Jangan menggunakan retorika kosong; sandarkan argumen pada fakta riset yang ada.`;

  let opinionText = "";
  let attempt = 0;
  const maxRetries = 3;

  while (attempt < maxRetries) {
    try {
      attempt++;
      console.log(`[Phase Opinion] Generating editorial opinion attempt ${attempt}...`);
      const response = await generateText({
        model: googleAI(
          process.env.CONTENT_RESEARCHER_MODEL || process.env.CONTENT_WRITER_MODEL || "gemini-3.1-pro-preview",
        ),
        system: opinionSystemPrompt,
        messages: [
          {
            role: "user",
            content: `User Input/Topik Awal:\n${userInput}\n\nTanggal Saat Ini: ${currentDateStr} (${currentYear})\n\nFakta Riset 5W1H:\n${researchText}`,
          },
        ],
      });

      opinionText = response.text;
      if (opinionText && opinionText.trim().length > 0) {
        break;
      }
    } catch (error) {
      console.warn(`[Phase Opinion] Generation failed on attempt ${attempt}:`, error);
    }

    if (attempt < maxRetries) {
      await delay(Math.pow(2, attempt) * 1000);
    }
  }

  if (!opinionText || opinionText.trim().length === 0) {
    console.warn('[Phase Opinion] Failed to generate opinion text. Using fallback.');
    opinionText = `**Tesis Utama**:\nIsu ini memerlukan pengawalan publik yang ketat agar kebijakan yang diambil tidak mengorbankan kepentingan masyarakat luas.\n\n**Poin Kritis**:\n- Transparansi dan akuntabilitas pembuat kebijakan menjadi kunci utama.\n- Implementasi di lapangan harus diawasi agar tepat sasaran.`;
  }

  // Sanitize with banned words
  opinionText = censorText(opinionText, bannedWords);

  console.log(`[Phase Opinion] Opinion Generation Complete. Text length: ${opinionText.length}`);
  return opinionText;
}
