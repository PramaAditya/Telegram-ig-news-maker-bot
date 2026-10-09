import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const puppeteer = require('../services/media-renderer/node_modules/puppeteer');
const Handlebars = require('../services/media-renderer/node_modules/handlebars');

async function main() {
  const outputDir = path.resolve('output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const templateBaseDir = path.resolve('services/media-renderer/templates/image/aa.geopolitik/carousel_analysis');
  const coverTemplateSource = fs.readFileSync(path.join(templateBaseDir, 'cover.html'), 'utf-8');
  const slideTemplateSource = fs.readFileSync(path.join(templateBaseDir, 'slide.html'), 'utf-8');

  const compileCover = Handlebars.compile(coverTemplateSource);
  const compileSlide = Handlebars.compile(slideTemplateSource);

  // 1. Placeholder Version
  const coverHtmlPlaceholder = compileCover({
    title: 'Geopolitik Itu <strong>BUKAN Cuma Perang Agama!</strong>',
    subtitle: 'Banyak yang Masih Salah Paham',
    cover_image: 'https://placehold.co/1080x1350',
    cta_text: 'Read More'
  });

  const slideHtmlPlaceholder = compileSlide({
    title: 'Apa sih sebenarnya <strong>geopolitik?</strong>',
    text: 'Singkatnya, geopolitik adalah sebuah cara pandang untuk melihat <strong>hubungan antara wilayah (teritori), sumber daya, dan akses strategis</strong>.<br/><br/>Konsep ini melihat <strong>secara realistis</strong> bagaimana negara-negara bertindak demi <strong>mengamankan keuntungan di suatu wilayah.</strong>',
    cover_image: 'https://placehold.co/1080x1350',
    slide_number: '01 / 04'
  });

  // 2. Realistic Photo Version (High-res dramatic geopolitics backdrop)
  const realCoverImage = 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1080&auto=format&fit=crop';
  const coverHtmlReal = compileCover({
    title: 'Geopolitik Itu <strong>BUKAN Cuma Perang Agama!</strong>',
    subtitle: 'Banyak yang Masih Salah Paham',
    cover_image: realCoverImage,
    cta_text: 'Read More'
  });

  const slideHtmlReal = compileSlide({
    title: 'Apa sih sebenarnya <strong>geopolitik?</strong>',
    text: 'Singkatnya, geopolitik adalah sebuah cara pandang untuk melihat <strong>hubungan antara wilayah (teritori), sumber daya, dan akses strategis</strong>.<br/><br/>Konsep ini melihat <strong>secara realistis</strong> bagaimana negara-negara bertindak demi <strong>mengamankan keuntungan di suatu wilayah.</strong>',
    cover_image: realCoverImage,
    slide_number: '01 / 04'
  });

  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });

  const renderAndSave = async (html: string, fileName: string) => {
    console.log(`Rendering ${fileName}...`);
    await page.setContent(html, { waitUntil: ['networkidle0', 'load'] });
    await page.evaluateHandle('document.fonts.ready');
    const filePath = path.join(outputDir, fileName);
    await page.screenshot({ path: filePath, type: 'png' });
    console.log(`Saved: ${filePath}`);
  };

  await renderAndSave(coverHtmlPlaceholder, 'aa_geopolitik_cover_placeholder.png');
  await renderAndSave(slideHtmlPlaceholder, 'aa_geopolitik_slide_placeholder.png');
  await renderAndSave(coverHtmlReal, 'aa_geopolitik_cover_real.png');
  await renderAndSave(slideHtmlReal, 'aa_geopolitik_slide_real.png');

  await browser.close();
  console.log('All templates compiled and rendered successfully from Handlebars!');
}

main().catch(err => {
  console.error('Render failed:', err);
  process.exit(1);
});
