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
    };
    service = new CrawlerService(queue as QueueService);
  });

  it('should call createWorker on module init', () => {
    // onModuleInit registers the worker processor
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
    });

    const result = await (service as any).processJob({
      data: { url: 'https://example.com' },
    });
    expect(result.title).toBe('Test');
    expect(result.metaDescription).toBe('desc');
    expect(result.favicon).toBe('/favicon.ico');
    expect(result.scripts).toContain('/a.js');
    expect(result.styles).toContain('/a.css');
    expect(result.images).toContain('/img.png');
    expect(result.url).toBe('https://example.com');
  });

  it('processJob should prefer data-src when src missing', async () => {
    mockedAxios.get.mockResolvedValue({
      data: '<html><body><img data-src="/lazy.png"></body></html>',
    });
    const result = await (service as any).processJob({
      data: { url: 'https://example.com' },
    });
    expect(result.images).toContain('/lazy.png');
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

  it('getStatus should return null when job not found', async () => {
    (queue.getJob as jest.Mock).mockResolvedValue(null);
    const status = await service.getStatus('nonexistent');
    expect(status).toBeNull();
  });

  it('cancel should call queue.removeJob and return true', async () => {
    (queue.removeJob as jest.Mock).mockResolvedValue(true);
    const ok = await service.cancel('1');
    expect(ok).toBe(true);
  });
});
