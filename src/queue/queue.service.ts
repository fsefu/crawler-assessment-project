import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import { config } from '../config';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  // Use two connections: one for the Queue (client) and one for the Worker (blocking)
  private clientConnection: Redis;
  private workerConnection: Redis;
  public queue: Queue;
  private worker?: Worker;

  constructor() {
    const redisOpts = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      // THIS IS THE IMPORTANT PART:
      // BullMQ requires null for blocking commands (workers).
      maxRetriesPerRequest: null,
      // optional: lazy connect if you want to delay connection until needed:
      // lazyConnect: true,
    };

    console.log('[QueueService] Redis config:', {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || '(none)',
      prefix: config.queuePrefix,
      queueName: config.queueName,
    });

    // connection used by the Queue (client operations)
    this.clientConnection = new IORedis(redisOpts);

    // separate connection used by the Worker (blocking commands)
    this.workerConnection = new IORedis(redisOpts);

    this.queue = new Queue('crawl-queue', {
      connection: this.clientConnection,
      prefix: config.queuePrefix,
    });
  }

  async onModuleInit() {
    // you can optionally create the worker here, or lazily create it later.
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }

    // close the queue client
    await this.queue.close();

    // quit both ioredis clients
    try {
      await this.clientConnection.quit();
    } catch (err) {
      // ignore/ log any quit errors
      console.warn('error quitting clientConnection', err);
    }
    try {
      await this.workerConnection.quit();
    } catch (err) {
      console.warn('error quitting workerConnection', err);
    }
  }

  async addJob(name: string, data: any) {
    const job = await this.queue.add(name, data, {
      removeOnComplete: false,
      removeOnFail: false,
    });
    return job;
  }

  async getJob(id: string) {
    return this.queue.getJob(id);
  }

  async removeJob(id: string) {
    const job = await this.getJob(id);
    if (!job) return false;
    await job.remove();
    return true;
  }

  createWorker(processFn: (job: Job) => Promise<any>) {
    // Use the workerConnection here (must have maxRetriesPerRequest: null)
    this.worker = new Worker('crawl-queue', async (job) => processFn(job), {
      connection: this.workerConnection,
      prefix: config.queuePrefix,
    });

    this.worker.on('failed', (job, err) =>
      console.error('Job failed', job?.id, err),
    );
  }
}
