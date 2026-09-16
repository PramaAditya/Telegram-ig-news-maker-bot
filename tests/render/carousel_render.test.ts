import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { marked } from 'marked';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('../../services/media-renderer/node_modules/puppeteer');
const Handlebars = require('../../services/media-renderer/node_modules/handlebars');

// Register Handlebars helpers matching media-renderer/server.js
Handlebars.registerHelper('markdown', function (this: any, options: any) {
  return new Handlebars.SafeString(marked.parse(options.fn(this)));
});
Handlebars.registerHelper('markdownInline', function (this: any, options: any) {
  return new Handlebars.SafeString(marked.parseInline(options.fn(this)));
});

// Helper for Roman numerals matching pipeline
const toRoman = (num: number) => {
  const roman: Record<string, number> = {
    M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1
  };
  let str = '';
  for (let i of Object.keys(roman)) {
    let q = Math.floor(num / roman[i]);
    num -= q * roman[i];
    str += i.repeat(q);
  }
  return str;
};

// Constant Test Fixtures
export const TEST_FIXTURES = {
  heroImage: 'https://placehold.co/1080x1080/1a1a1a/ffffff.png?text=Hero+Cover',
  logo: 'https://placehold.co/250x80/transparent/ffffff.png?text=POROS',
  title: 'Inovasi Fusi Nuklir <strong>Catat Sejarah Baru</strong> di 2026',
  slides: [
    'Reaktor fusi eksperimental berhasil mempertahankan reaksi stabil selama lebih dari **1.000 detik**, melampaui rekor dunia sebelumnya.',
    'Pencapaian ini membuka babak baru bagi penyediaan energi bersih tanpa emisi karbon bagi **jutaan manusia** di masa depan.',
    'Para ilmuwan kini beralih ke tahap pembangunan **pembangkit listrik komersial pertama** yang ditargetkan beroperasi sebelum 2035.'
  ],
  slideImages: [
    'https://placehold.co/1080x1080/2a2a2a/ffffff.png?text=Slide+1+Image',
    'https://placehold.co/1080x1080/333333/ffffff.png?text=Slide+2+Image',
    'https://placehold.co/1080x1080/3d3d3d/ffffff.png?text=Slide+3+Image'
  ]
};

const TEMPLATE_BASE_DIR = path.resolve('services/media-renderer/templates/image/poros.perjuangan');
const OUTPUT_BASE_DIR = path.resolve('tests/output');

function compileTemplateFile(templateName: string, fileName: string) {
  const filePath = path.join(TEMPLATE_BASE_DIR, templateName, `${fileName}.html`);
  let source = fs.readFileSync(filePath);
  if (source.length >= 2 && source[0] === 0xff && source[1] === 0xfe) {
    source = Buffer.from(source.toString('utf16le'), 'utf8');
  }
  return Handlebars.compile(source.toString('utf8'));
}

describe('Actual Carousel Media Renderer Integration Tests', () => {
  let browser: any;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }, 20000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  async function renderHtmlToImage(htmlContent: string, outputPath: string) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1080, height: 1350 });
      await page.setContent(htmlContent, { waitUntil: ['load', 'networkidle0'], timeout: 15000 });
      const imageBuffer = await page.screenshot({ type: 'png' });
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, imageBuffer);
      return imageBuffer;
    } finally {
      await page.close();
    }
  }

  describe('Carousel Dark Renderer', () => {
    const outDir = path.join(OUTPUT_BASE_DIR, 'carousel_dark');

    it('renders actual cover.png with constant hero image, logo, and highlighted title', async () => {
      const compileCover = compileTemplateFile('carousel_dark', 'cover');
      const html = compileCover({
        logo: TEST_FIXTURES.logo,
        cover_image: TEST_FIXTURES.heroImage,
        title: marked.parseInline(TEST_FIXTURES.title)
      });

      const outPath = path.join(outDir, 'cover.png');
      const buffer = await renderHtmlToImage(html, outPath);

      expect(fs.existsSync(outPath)).toBe(true);
      expect(buffer.length).toBeGreaterThan(50000); // Real image with textures

      const meta = await sharp(outPath).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1350);
      expect(meta.format).toBe('png');
    }, 25000);

    it('renders actual slide_1.png and slide_2.png with roman numerals and highlighted markdown text', async () => {
      const compileSlide = compileTemplateFile('carousel_dark', 'slide');

      for (let i = 0; i < 2; i++) {
        const html = compileSlide({
          cover_image: TEST_FIXTURES.heroImage,
          text: marked.parse(TEST_FIXTURES.slides[i]),
          roman_number: toRoman(i + 1)
        });

        const outPath = path.join(outDir, `slide_${i + 1}.png`);
        const buffer = await renderHtmlToImage(html, outPath);

        expect(fs.existsSync(outPath)).toBe(true);
        expect(buffer.length).toBeGreaterThan(40000);

        const meta = await sharp(outPath).metadata();
        expect(meta.width).toBe(1080);
        expect(meta.height).toBe(1350);
      }
    }, 30000);
  });

  describe('Carousel Multi Images Renderer', () => {
    const outDir = path.join(OUTPUT_BASE_DIR, 'carousel_multi_images');

    it('renders actual cover.png for multi images template', async () => {
      const compileCover = compileTemplateFile('carousel_multi_images', 'cover');
      const html = compileCover({
        logo: TEST_FIXTURES.logo,
        cover_image: TEST_FIXTURES.heroImage,
        title: marked.parseInline(TEST_FIXTURES.title)
      });

      const outPath = path.join(outDir, 'cover.png');
      const buffer = await renderHtmlToImage(html, outPath);

      expect(fs.existsSync(outPath)).toBe(true);
      expect(buffer.length).toBeGreaterThan(50000);

      const meta = await sharp(outPath).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1350);
    }, 25000);

    it('renders actual content slides each with its own image and roman numerals', async () => {
      const compileSlide = compileTemplateFile('carousel_multi_images', 'slide');

      for (let i = 0; i < TEST_FIXTURES.slides.length; i++) {
        const html = compileSlide({
          cover_image: TEST_FIXTURES.heroImage,
          slide_image: TEST_FIXTURES.slideImages[i],
          text: marked.parse(TEST_FIXTURES.slides[i]),
          roman_number: toRoman(i + 1)
        });

        const outPath = path.join(outDir, `slide_${i + 1}.png`);
        const buffer = await renderHtmlToImage(html, outPath);

        expect(fs.existsSync(outPath)).toBe(true);
        expect(buffer.length).toBeGreaterThan(40000);

        const meta = await sharp(outPath).metadata();
        expect(meta.width).toBe(1080);
        expect(meta.height).toBe(1350);
      }
    }, 45000);
  });

  describe('Single Page Post Renderer', () => {
    const outDir = path.join(OUTPUT_BASE_DIR, 'single_page');

    it('renders actual single page cover.png with dark gradient, title, and 2 paragraphs', async () => {
      const compileCover = compileTemplateFile('single_page', 'cover');
      const description = `${marked.parse(TEST_FIXTURES.slides[0])}\n\n${marked.parse(TEST_FIXTURES.slides[1])}`;
      
      const html = compileCover({
        logo: TEST_FIXTURES.logo,
        cover_image: TEST_FIXTURES.heroImage,
        title: marked.parseInline(TEST_FIXTURES.title),
        description: description
      });

      const outPath = path.join(outDir, 'cover.png');
      const buffer = await renderHtmlToImage(html, outPath);

      expect(fs.existsSync(outPath)).toBe(true);
      expect(buffer.length).toBeGreaterThan(50000);

      const meta = await sharp(outPath).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1350);
    }, 25000);
  });
});
