import dotenv from 'dotenv';
dotenv.config();

for (const [key, val] of Object.entries(process.env)) {
  if (typeof val === 'string' && val.includes('${')) {
    process.env[key] = val.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, varName) => process.env[varName] || '');
  }
}

import { generateCarouselAnalysisContent } from '../src/agents/pipelines/image/aa.geopolitik/carousel_analysis.js';
import { getBaseSystemPrompt, PipelineContext } from '../src/utils.js';

const userInput = `Slide 1: Hook(Visual: Gambar siluet dua pemimpin negara bersalaman, dengan bayangan pion catur raksasa. Teks tebal & kontras)Teks: Kenapa di Politik Dunia, "Nggak Ada Teman yang Tulus"?Mari berkenalan dengan teori "Realisme" yang akan menampar kita dengan kerasnya realita!Slide 2: Analogi Kelas Tanpa GuruTeks: Coba bayangkan sebuah ruang kelas yang nggak punya guru sama sekali.Kira-kira apa yang terjadi? Pasti murid-muridnya bakal bikin aturan sendiri, muncul geng-gengan, dan siapa yang paling kuat, dialah yang akan berkuasa.Slide 3: Dunia Itu "Anarkis"Teks: Para penganut teori "Realisme" melihat dunia persis seperti kelas tanpa guru itu.Mereka beranggapan negara-negara hidup di dunia yang "anarkis" karena tidak ada pemerintahan dunia tertinggi yang benar-benar punya kuasa mutlak untuk membatasi pergerakan suatu negara.   Slide 4: Kepentingan Nasional adalah Nomor 1Teks: Karena tidak ada pengawas tertinggi, hukum rimba berlaku.Dalam bentuk realisme yang paling dasar, mengejar kepentingan sendiri (self-interest) dan memproyeksikan kekuatan/pengaruh adalah aturan main yang paling mutlak. Keselamatan negaramu bergantung pada dirimu sendiri.   Slide 5: Sebuah Kutipan Menohok (The Reality Check)Teks: Untuk memahami betapa "gelapnya" hukum rimba ini, coba resapi kutipan epik dari mantan Sekretaris Jenderal Hizbullah, Sayyed Hassan berikut ini.   Ini adalah cerminan murni bagaimana aktor politik melihat kerasnya dunia persaingan.Slide 6: "Dunia Tidak Menangisi yang Lemah"Teks: "Jika kamu lemah, dunia tidak akan mengakuimu, melindungimu, membelamu, atau meneteskan air mata untukmu."   "Satu-satunya hal yang melindungimu adalah kekuatanmu, keberanianmu, kepalan tanganmu, senjatamu, rudalmu, dan kehadiranmu di medan perang."   "Jika kamu kuat, kamu akan menguasai rasa hormat dari dunia."   Slide 7: Studi Kasus Nyata: Mengapa Dunia "Diam"?Teks: Mari kita pakai kacamata "Realisme" ini untuk membedah krisis saat ini: Mengapa AS terus mendukung Israel, dan mengapa dunia terkesan "diam" atau lambat merespons krisis kemanusiaan di Gaza?Slide 8: Moralitas vs Kepentingan StrategisTeks: Menurut teori realis, tindakan negara adidaya seringkali didasarkan pada kepentingan strategis nasional (seperti menjaga aliansi kuat dan basis pengaruh di Timur Tengah), bukan sekadar urusan moral atau kemanusiaan.   Di sisi lain, banyak negara lain terkesan pasif karena mereka memprioritaskan stabilitas ekonomi dan keamanan nasional mereka sendiri di atas krisis kemanusiaan. Dalam realisme: Kepentingan negara mengalahkan segalanya.Slide 9: Tapi, Apakah Harus Selalu Sekejam Ini?Teks: Pandangan super pesimis ini tentu banyak dikritik oleh ahli lainnya.Kritikus menilai realisme terlalu melebih-lebihkan konflik. Kenyataannya, negara-negara juga punya kapasitas untuk berdamai, membangun hukum internasional HAM, dan membuat organisasi seperti PBB. Hanya saja, implementasinya sering terbentur oleh kekuatan negara besar.`;

async function main() {
  console.log('='.repeat(78));
  console.log('    TESTING AA.GEOPOLITIK CAROUSEL ANALYSIS (TEXT & PROMPTS ONLY)');
  console.log('='.repeat(78));

  const currentDateObj = new Date();
  const currentYear = currentDateObj.getFullYear();
  const currentDateStr = currentDateObj.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  });
  const baseSystemPrompt = getBaseSystemPrompt(currentDateStr, currentYear);

  const context: PipelineContext = {
    chatId: 'test_chat',
    messageId: 1,
    userInput,
    uploadedMedia: [],
    telegram: null,
    statusMsg: null,
    settings: {
      id: 5,
      name: 'AA Geopolitik Test',
      editorialGuidelines: `Fokus pada analisis geopolitik realistis: kepentingan wilayah (teritori), sumber daya alam/energi, aliansi militer, rute dagang, dan kalkulasi strategis negara-negara.`,
      bannedWords: []
    },
    currentDateStr,
    currentYear,
    baseSystemPrompt,
    connectionId: 5,
  };

  const insights = {
    research: `Materi edukasi mengenai Teori Realisme dalam Hubungan Internasional, konsep anarki internasional, sistem self-help, dan kutipan pidato Sayyed Hassan Nasrallah tentang kekuatan dan rasa hormat global dalam konteks krisis kemanusiaan di Gaza dan Timur Tengah.`
  };

  console.log('Generating content via generateCarouselAnalysisContent...\n');
  const result = await generateCarouselAnalysisContent(context, insights);

  console.log('='.repeat(78));
  console.log('>>> [COVER SLIDE]');
  console.log('='.repeat(78));
  console.log(`TITLE          : ${result.title}`);
  console.log(`SUBTITLE       : ${result.subtitle}`);
  console.log(`IMAGE PROMPT   : ${result.image_prompt}`);

  console.log('\n' + '='.repeat(78));
  console.log('>>> [8 BODY SLIDES]');
  console.log('='.repeat(78));

  result.slides.forEach((slide, idx) => {
    console.log(`\n--- SLIDE ${idx + 1} (${slide.type.toUpperCase()}) ---`);
    console.log(`TITLE       : ${slide.title}`);
    console.log(`TEXT        : \n${slide.text}`);
    console.log(`IMAGE PROMPT: ${(slide as any).image_prompt || 'N/A'}`);
  });

  console.log('\n' + '='.repeat(78));
  console.log('>>> [METADATA & CAPTION]');
  console.log('='.repeat(78));
  console.log(`Source Name : ${result.source_name}`);
  console.log(`Source URL  : ${result.source_url || 'N/A'}`);
  console.log('\nFinal Instagram Caption:\n');
  console.log(result.finalCaption);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
