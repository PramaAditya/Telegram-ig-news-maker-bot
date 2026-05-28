const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const moment = require('moment-timezone');

let marked;
import('marked').then(module => {
  marked = module.marked;
  
  Handlebars.registerHelper('markdown', function (options) {
    return new Handlebars.SafeString(marked.parse(options.fn(this)));
  });
  Handlebars.registerHelper('markdownInline', function (options) {
    return new Handlebars.SafeString(marked.parseInline(options.fn(this)));
  });
});

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID: uuidv4 } = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

// Helper to launch puppeteer
async function getBrowser() {
  return await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
  });
}

// 1. Original /render endpoint
app.post('/render', async (req, res) => {
  let browser;
  try {
    const { viewport, html, css } = req.body;
    
    if (!html) {
      return res.status(400).json({ error: 'The "html" field is required' });
    }

    const width = parseInt(viewport?.width, 10) || 1200;
    const height = parseInt(viewport?.height, 10) || 630;

    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    const pendingRequests = new Set();
    page.on('request', request => pendingRequests.add(request.url()));
    page.on('requestfinished', request => pendingRequests.delete(request.url()));
    page.on('requestfailed', request => pendingRequests.delete(request.url()));

    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { margin: 0; padding: 0; }
          ${css || ''}
        </style>
      </head>
      <body>
        <main>
          ${html}
        </main>
      </body>
      </html>
    `.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/textfit\/2\.4\.0\/textFit\.min\.js/g, `http://localhost:${port}/textFit.min.js`);

    try {
      await page.setContent(fullHtml, {
        waitUntil: ['networkidle0', 'load', 'domcontentloaded'],
        timeout: 15000
      });
    } catch (e) {
      console.warn('Timeout waiting for networkidle0, proceeding with screenshot anyway.');
      console.warn('Pending requests:', Array.from(pendingRequests));
    }

    const imageBuffer = await page.screenshot({ type: 'png' });

    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.from(imageBuffer));
  } catch (error) {
    console.error('Rendering error:', error);
    res.status(500).json({ error: 'Failed to render image', details: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Helper function to compile template
const compileTemplate = (templateName) => {
  const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template "${templateName}" not found.`);
  }
  let templateSource = fs.readFileSync(templatePath);
  
  // Check for UTF-16 LE BOM
  if (templateSource.length >= 2 && templateSource[0] === 0xff && templateSource[1] === 0xfe) {
    templateSource = templateSource.toString('utf16le');
  } else {
    templateSource = templateSource.toString('utf8');
  }
  
  return Handlebars.compile(templateSource);
};

// Helper to render HTML to image buffer
async function renderHtmlToBuffer(htmlContent, width, height) {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    const pendingRequests = new Set();
    page.on('request', request => pendingRequests.add(request.url()));
    page.on('requestfinished', request => pendingRequests.delete(request.url()));
    page.on('requestfailed', request => pendingRequests.delete(request.url()));

    try {
      await page.setContent(htmlContent, {
        waitUntil: ['networkidle0', 'load', 'domcontentloaded'],
        timeout: 15000
      });
    } catch (e) {
      console.warn('Timeout waiting for networkidle0, proceeding with screenshot anyway.');
    }

    const imageBuffer = await page.screenshot({ type: 'png' });
    return imageBuffer;
  } finally {
    await browser.close();
  }
}

// Helper to upload buffer to S3
async function uploadToS3(buffer, filename) {
  const rootFolder = process.env.S3_ROOT_FOLDER ? `${process.env.S3_ROOT_FOLDER}/` : '';
  const key = `${rootFolder}${filename}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
  });

  await s3Client.send(command);
  
  if (process.env.S3_PUBLIC_URL_BASE) {
    // If a public URL base is provided, assume it maps directly to the bucket root
    // e.g. CDN or custom domain
    return `${process.env.S3_PUBLIC_URL_BASE}/${key}`;
  }
  
  // Fallback to endpoint + bucket name for standard path-style S3 URLs
  return `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`;
}

// Unified Dynamic Endpoint
app.post('/render/:mediaType/:brand/:templateName', async (req, res) => {
  const { mediaType, brand, templateName } = req.params;
  const templateBasePath = `${mediaType}/${brand}/${templateName}`;

  try {
    const { pages, viewport } = req.body;

    if (!pages || !Array.isArray(pages)) {
      return res.status(400).json({ error: 'The "pages" array is required' });
    }

    const width = parseInt(viewport?.width, 10) || 1080;
    const height = parseInt(viewport?.height, 10) || 1350;

    const imageUrls = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const templateFile = page.file;
      const context = page.context || {};

      const compiledTemplate = compileTemplate(`${templateBasePath}/${templateFile}`);
      const htmlContent = compiledTemplate(context)
        .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/textfit\/2\.4\.0\/textFit\.min\.js/g, `http://localhost:${port}/textFit.min.js`);

      const imageBuffer = await renderHtmlToBuffer(htmlContent, width, height);
      
      const filename = `${brand}-${templateName}-${templateFile}-${i+1}-${uuidv4()}.png`;
      const url = await uploadToS3(imageBuffer, filename);
      imageUrls.push(url);
    }

    return res.json({ urls: imageUrls });

  } catch (error) {
    console.error(`Render Template error for ${templateBasePath}:`, error);
    return res.status(500).json({ error: 'Failed to render template', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
