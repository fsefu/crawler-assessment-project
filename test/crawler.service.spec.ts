import { CrawlerService } from '../src/crawler/crawler.service';
import { QueueService } from '../src/queue/queue.service';
import axios from 'axios';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CrawlerService', () => {
  let service: CrawlerService;
  let queue: Partial<QueueService>;

  beforeEach(() => {
    queue = {
      addJob: jest
        .fn()
        .mockResolvedValue({ id: '1', getState: async () => 'waiting' }),
      createWorker: jest.fn(),
      getJob: jest.fn(),
      removeJob: jest.fn().mockResolvedValue(true),
      // Added mocks for part 2 features:
      getStoredResult: jest.fn().mockResolvedValue(null),
      setCancelFlag: jest.fn().mockResolvedValue(undefined),
      isCancelled: jest.fn().mockResolvedValue(false),
      storeJobResult: jest.fn().mockResolvedValue(undefined),
    };
    service = new CrawlerService(queue as QueueService);
  });

  it('should call createWorker on module init', () => {
    service.onModuleInit();
    expect(queue.createWorker).toHaveBeenCalled();
  });

  it('enqueueCrawl should add job and return job', async () => {
    const job = await service.enqueueCrawl('https://example.com');
    expect((queue.addJob as jest.Mock).mock.calls.length).toBe(1);
    expect(job.id).toBe('1');
  });

  it('processJob should extract data correctly', async () => {
    mockedAxios.get.mockResolvedValue({
      data: '<html><head><title>Test</title><meta name="description" content="desc"><link rel="icon" href="/favicon.ico"></head><body><script src="/a.js"></script><link rel="stylesheet" href="/a.css"><img src="/img.png"></body></html>',
      headers: { 'content-type': 'text/html' },
    });

    const result = await (service as any).processJob({
      data: { url: 'https://example.com' },
    });

    expect(result.title).toBe('Test');
    expect(result.metaDescription).toBe('desc');
    expect(result.favicon).toBe('https://example.com/favicon.ico');
    expect(result.scripts).toContain('https://example.com/a.js');
    expect(result.styles).toContain('https://example.com/a.css');
    expect(result.images).toContain('https://example.com/img.png');
    expect(result.url).toBe('https://example.com');
  });

  it('processJob should prefer data-src when src missing', async () => {
    mockedAxios.get.mockResolvedValue({
      data: '<html><body><img data-src="/lazy.png"></body></html>',
      headers: { 'content-type': 'text/html' },
    });

    const result = await (service as any).processJob({
      data: { url: 'https://example.com' },
    });

    expect(result.images).toContain('https://example.com/lazy.png');
  });

  it('processJob should throw when url missing in job', async () => {
    await expect((service as any).processJob({ data: {} })).rejects.toThrow(
      'Missing URL',
    );
  });

  it('processJob should surface axios errors', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network error'));
    await expect(
      (service as any).processJob({ data: { url: 'https://example.com' } }),
    ).rejects.toThrow('network error');
  });

  it('getStatus should return null when job not found and no stored result', async () => {
    (queue.getJob as jest.Mock).mockResolvedValue(null);
    (queue.getStoredResult as jest.Mock).mockResolvedValue(null);
    const status = await service.getStatus('nonexistent');
    expect(status).toBeNull();
  });

  it('getStatus should return stored result when job removed', async () => {
    (queue.getJob as jest.Mock).mockResolvedValue(null);
    (queue.getStoredResult as jest.Mock).mockResolvedValue({
      title: 'Saved',
      url: 'https://saved.example',
    });

    const status = await service.getStatus('someid');

    // runtime assertion (keeps test readable)
    expect(status).not.toBeNull();

    // assign to a new local variable so TS knows it's non-null
    const s = status! as any;

    expect(s.state).toBe('completed');
    // result may be typed `any`/unknown — cast to any to access title
    expect((s.result as any).title).toBe('Saved');
  });

  it('cancel should call queue.setCancelFlag and return true', async () => {
    (queue.removeJob as jest.Mock).mockResolvedValue(true);
    const ok = await service.cancel('1');
    expect(queue.setCancelFlag).toHaveBeenCalledWith('1');
    expect(ok).toBe(true);
  });
});
