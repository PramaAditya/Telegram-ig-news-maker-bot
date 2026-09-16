import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertQueueItem } from '../../src/db/queue.js';
import { db } from '../../src/db/index.js';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  }
}));

describe('Queue DB: insertQueueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should insert queue item with chatId and messageId and return created record', async () => {
    const mockSelectReturn = [{ maxSort: 30 }];
    const mockInsertedRow = {
      id: 50,
      connectionId: 1,
      chatId: '987654321',
      messageId: 1234,
      sortOrder: 40,
      templateId: 'image:poros.perjuangan:carousel_dark',
      text: 'Test headline',
      media: [{ type: 'image', url: 'https://example.com/img.jpg' }],
      status: 'pending',
      retryCount: 0,
    };

    vi.mocked(db.select().from).mockResolvedValueOnce(mockSelectReturn as any);
    vi.mocked(db.insert({} as any).values({} as any).returning).mockResolvedValueOnce([mockInsertedRow] as any);

    const result = await insertQueueItem({
      connectionId: 1,
      chatId: '987654321',
      messageId: 1234,
      templateId: 'image:poros.perjuangan:carousel_dark',
      templateData: { title: 'Test' },
      text: 'Test headline',
      media: [{ type: 'image', url: 'https://example.com/img.jpg' }],
    });

    expect(db.insert).toHaveBeenCalled();
    expect(db.insert({} as any).values).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '987654321',
        messageId: 1234,
        sortOrder: 40,
        status: 'pending',
      })
    );
    expect(result).toEqual([mockInsertedRow]);
  });
});
