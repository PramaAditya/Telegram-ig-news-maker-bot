import { describe, it, expect } from 'vitest';
import { sanitizeSourceUrl, getCleanDomain, extractUrlsFromText } from '../../src/utils/urlSanitizer.js';

describe('urlSanitizer', () => {
  describe('sanitizeSourceUrl', () => {
    it('strips tracking query parameters while preserving path', () => {
      const dirtyUrl = 'https://www.antaranews.com/berita/4450123/kpk-tersangka-baru?utm_source=twitter&utm_medium=social&utm_campaign=breaking&fbclid=IwAR123&ref=share';
      const clean = sanitizeSourceUrl(dirtyUrl);
      expect(clean).toBe('https://www.antaranews.com/berita/4450123/kpk-tersangka-baru');
    });

    it('preserves clean URLs without query parameters', () => {
      const url = 'https://kompas.id/baca/hukum/aliran-dana';
      expect(sanitizeSourceUrl(url)).toBe(url);
    });

    it('handles URLs with harmless non-tracking query parameters', () => {
      const url = 'https://example.com/search?q=climate&page=2&utm_source=feed';
      const clean = sanitizeSourceUrl(url);
      expect(clean).toBe('https://example.com/search?q=climate&page=2');
    });

    it('returns empty string on invalid URL', () => {
      expect(sanitizeSourceUrl('not-a-valid-url')).toBe('');
      expect(sanitizeSourceUrl('')).toBe('');
    });
  });

  describe('getCleanDomain', () => {
    it('strips www and mobile subdomains', () => {
      expect(getCleanDomain('https://www.antaranews.com/berita/123')).toBe('antaranews.com');
      expect(getCleanDomain('https://m.detik.com/news/123')).toBe('detik.com');
      expect(getCleanDomain('https://amp.kompas.com/artikel')).toBe('kompas.com');
    });

    it('returns lowercase hostname for regular domains', () => {
      expect(getCleanDomain('https://AlJazeera.com/news')).toBe('aljazeera.com');
    });

    it('handles invalid inputs gracefully', () => {
      expect(getCleanDomain('invalid-url')).toBe('');
    });
  });

  describe('extractUrlsFromText', () => {
    it('extracts all http and https URLs from user input', () => {
      const text = 'Check this out https://antaranews.com/123 and also http://kompas.id/456 for details.';
      const urls = extractUrlsFromText(text);
      expect(urls).toEqual([
        'https://antaranews.com/123',
        'http://kompas.id/456'
      ]);
    });

    it('returns empty array if no URLs found', () => {
      expect(extractUrlsFromText('Just some plain news text without any link')).toEqual([]);
    });
  });
});
