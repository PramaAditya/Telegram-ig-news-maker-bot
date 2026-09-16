import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { createRequire } from 'module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const puppeteer = require('../services/media-renderer/node_modules/puppeteer');
const Handlebars = require('../services/media-renderer/node_modules/handlebars');

async function run() {
  const sampleUrl = 'https://antaranews.com/berita/4450123/kpk-tetapkan-tersangka-baru-kasus-pengadaan-server';
  
  // Generate high-contrast, crisp QR code as Base64 Data URL
  const qrDataUrl = await QRCode.toDataURL(sampleUrl, {
    width: 600,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#ffffff'
    },
    errorCorrectionLevel: 'M'
  });

  // Test fallback: request carousel_dark/source_qr, which doesn't exist locally and falls back to common/source_qr.html
  const baseDir = path.resolve('services/media-renderer/templates');
  const requested = 'image/poros.perjuangan/carousel_dark/source_qr';
  let templatePath = path.join(baseDir, `${requested}.html`);
  if (!fs.existsSync(templatePath)) {
    const parts = requested.split('/');
    const mediaType = parts[0];
    const brand = parts[1];
    const fileName = parts.slice(3).join('/') || parts[parts.length - 1];
    const commonPath = path.join(baseDir, mediaType, brand, 'common', `${fileName}.html`);
    if (fs.existsSync(commonPath)) {
      templatePath = commonPath;
    }
  }
  console.log(`Resolved template path: ${templatePath}`);
  const sourceHtml = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(sourceHtml);

  const context = {
    logo: 'https://storage.pelita.tech/logo_poros_perjuangan_white.png',
    roman_number: '(IV)',
    article_title: 'KPK Tetapkan Tersangka Baru Kasus Korupsi Pengadaan <strong>Server Digital Nasional</strong>',
    source_name: 'ANTARA NEWS',
    source_domain: 'antaranews.com',
    qr_code_image: qrDataUrl
  };
  const finalHtml = template(context);

  const outDir = path.resolve('tests/output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(finalHtml, { waitUntil: ['networkidle0', 'domcontentloaded'] });

    const outputPath = path.join(outDir, 'sample_source_qr.png');
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`Saved screenshot to: ${outputPath}`);

    const metadata = await sharp(outputPath).metadata();
    console.log(`Metadata: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Error rendering sample QR:', err);
  process.exit(1);
});
