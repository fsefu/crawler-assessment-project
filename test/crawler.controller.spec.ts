import { CrawlerController } from '../src/crawler/crawler.controller';
import { CrawlerService } from '../src/crawler/crawler.service';

const mockService = {
  enqueueCrawl: jest.fn().mockResolvedValue({ id: '1' }),
  getStatus: jest.fn().mockResolvedValue({ id: '1', state: 'completed' }),
  cancel: jest.fn().mockResolvedValue(true),
};

describe('CrawlerController', () => {
  let controller: CrawlerController;

  beforeEach(() => {
    controller = new CrawlerController(mockService as any);
  });

  it('enqueue should return job id', async () => {
    const res = await controller.enqueue({ url: 'https://example.com' } as any);
    expect(res.id).toBe('1');
  });

  it('status should return status', async () => {
    const res = await controller.status('1');
    expect(res.state).toBe('completed');
  });

  it('cancel should call cancel', async () => {
    const res = await controller.cancel('1');
    expect(res.cancelled).toBe(true);
  });
});
