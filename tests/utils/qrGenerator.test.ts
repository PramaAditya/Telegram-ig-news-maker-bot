import { describe, it, expect } from 'vitest';
import { generateQrCodeDataUrl } from '../../src/utils/qrGenerator.js';

describe('qrGenerator', () => {
  it('generates a valid Base64 PNG data URL for a given URL', async () => {
    const url = 'https://antaranews.com/berita/12345';
    const dataUrl = await generateQrCodeDataUrl(url);

    expect(dataUrl).toBeDefined();
    expect(typeof dataUrl).toBe('string');
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it('throws an error or returns empty when url is empty or invalid', async () => {
    await expect(generateQrCodeDataUrl('')).rejects.toThrow();
  });
});
