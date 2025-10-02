import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { QueueService } from '../src/queue/queue.service';

// Minimal mock for QueueService so the app boots without Redis
const mockQueueService = {
  addJob: jest
    .fn()
    .mockResolvedValue({ id: '1', getState: async () => 'waiting' }),
  getJob: jest.fn().mockResolvedValue(null),
  removeJob: jest.fn().mockResolvedValue(true),
  createWorker: jest.fn(), // worker creation is noop in tests
  // Added mocks for Part 2 features so the app can boot cleanly in tests:
  getStoredResult: jest.fn().mockResolvedValue(null),
  setCancelFlag: jest.fn().mockResolvedValue(undefined),
  isCancelled: jest.fn().mockResolvedValue(false),
  storeJobResult: jest.fn().mockResolvedValue(undefined),
};

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // override the QueueService provider so it doesn't attempt to connect to Redis
      .overrideProvider(QueueService)
      .useValue(mockQueueService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
    jest.clearAllMocks();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
