import { describe, it, expect } from 'vitest';
import { censorTextWithReport, type BannedWord } from '../../frontend/src/sanitize';

describe('censorTextWithReport', () => {
  const sampleBannedWords: BannedWord[] = [
    { word: 'israel', replacement: '1srαǝl', type: 'partial' },
    { word: 'gaza', replacement: 'Gαzα', type: 'partial' },
    { word: 'bom', replacement: 'bøm', type: 'exact' },
    { word: 'mati', replacement: 'mαtı', type: 'exact' }
  ];

  it('replaces banned words and maintains HTML tags intact', () => {
    const text = '<strong>31 Juta Warga Iran Kompak Daftar Angkat Senjata</strong> Siap Melawan Agresi AS-Israel di Gaza';
    const result = censorTextWithReport(text, sampleBannedWords);

    expect(result.censoredText).toBe(
      '<strong>31 Juta Warga Iran Kompak Daftar Angkat Senjata</strong> Siap Melawan Agresi AS-1srαǝl di Gαzα'
    );
    expect(result.replacedCount).toBe(2);
    expect(result.replacedWords).toEqual(['israel', 'gaza']);
  });

  it('protects URLs from being censored', () => {
    const text = 'Kunjungi https://israel.com/gaza/bom untuk info perang';
    const result = censorTextWithReport(text, sampleBannedWords);

    expect(result.censoredText).toBe('Kunjungi https://israel.com/gaza/bom untuk info perang');
    expect(result.replacedCount).toBe(0);
  });

  it('respects exact vs partial match rules', () => {
    const text = 'Otomatis bom meledak membuat kucing mati';
    const result = censorTextWithReport(text, sampleBannedWords);

    // "Otomatis" contains "mati", but "mati" is exact type, so "otomatis" is NOT modified
    expect(result.censoredText).toBe('Otomatis bøm meledak membuat kucing mαtı');
    expect(result.replacedCount).toBe(2);
    expect(result.replacedWords).toEqual(['bom', 'mati']);
  });

  it('returns unchanged text and 0 count if no banned words match', () => {
    const text = 'Berita hari ini damai dan tenang.';
    const result = censorTextWithReport(text, sampleBannedWords);

    expect(result.censoredText).toBe(text);
    expect(result.replacedCount).toBe(0);
    expect(result.replacedWords).toEqual([]);
  });

  it('handles empty input gracefully', () => {
    expect(censorTextWithReport('', sampleBannedWords)).toEqual({
      censoredText: '',
      replacedCount: 0,
      replacedWords: []
    });
  });
});
