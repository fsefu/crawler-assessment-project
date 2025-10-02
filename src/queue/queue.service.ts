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

  // TTL (seconds) for storing job results when jobs are removed from Bull
  private readonly resultTtlSeconds = parseInt(
    process.env.RESULT_TTL_SECONDS || String(60 * 60 * 24),
    10,
  ); // default 24h

  constructor() {
    const redisOpts = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null,
    };

    // connection used by the Queue (client operations)
    this.clientConnection = new IORedis(redisOpts);

    // separate connection used by the Worker (blocking commands)
    this.workerConnection = new IORedis(redisOpts);

    this.queue = new Queue(config.queueName, {
      connection: this.clientConnection,
      prefix: config.queuePrefix,
    });
  }

  async onModuleInit() {
    // intentionally empty - createWorker is called by CrawlerService.onModuleInit
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
      removeOnComplete: process.env.REMOVE_ON_COMPLETE === 'true' ? true : 1000,
      removeOnFail: process.env.REMOVE_ON_FAIL === 'true' ? true : 1000,
      attempts: parseInt(process.env.JOB_ATTEMPTS || '3', 10),
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
    return job;
  }

  async getJob(id: string) {
    return this.queue.getJob(id);
  }

  /**
   * Remove a job from the queue (if not running).
   * If job is running, we still set a cancel flag for the worker to pick up.
   */
  async removeJob(id: string) {
    const job = await this.getJob(id);
    if (!job) return false;

    // set cancel flag so running workers may stop
    await this.setCancelFlag(id);

    try {
      await job.remove();
      return true;
    } catch (err) {
      // Could be running and cannot be removed; we already set cancel flag
      return false;
    }
  }

  createWorker(processFn: (job: Job) => Promise<any>) {
    // create a worker with concurrency control
    this.worker = new Worker(config.queueName, async (job) => processFn(job), {
      connection: this.workerConnection,
      prefix: config.queuePrefix,
      concurrency: config.maxConcurrency,
    });

    // helpful lifecycle logging
    this.worker.on('active', (job) => {
      console.log(`[Worker] job active: ${job?.id}`);
    });

    this.worker.on('completed', async (job, returnvalue) => {
      try {
        console.log(`[Worker] job completed: ${job?.id}`);
        // store the result into Redis (so clients can fetch it even if Bull removed the job)
        await this.storeJobResult(String(job.id), returnvalue);
      } catch (err) {
        console.warn('[Worker] failed to store job result', job?.id, err);
      }
    });

    this.worker.on('failed', (job, err) =>
      console.error('Job failed', job?.id, err),
    );

    this.worker.on('error', (err) => {
      console.error('Worker error', err);
    });
  }

  // Cancellation helpers: set and check a cancel flag in Redis
  async setCancelFlag(jobId: string) {
    if (!jobId) return;
    try {
      // set key with TTL so it eventually expires
      await this.clientConnection.set(`cancel:${jobId}`, '1', 'EX', 60 * 60); // 1 hour
    } catch (err) {
      console.warn('Failed to set cancel flag for job', jobId, err);
    }
  }

  async isCancelled(jobId: string): Promise<boolean> {
    if (!jobId) return false;
    try {
      const v = await this.workerConnection.get(`cancel:${jobId}`);
      return v === '1';
    } catch (err) {
      return false;
    }
  }

  /**
   * Persist job return value into Redis so status can be retrieved even when Bull removed the job.
   * key: result:<jobId>
   */
  async storeJobResult(jobId: string, obj: any) {
    if (!jobId) return;
    try {
      const payload = JSON.stringify(obj ?? null);
      await this.clientConnection.set(
        `result:${jobId}`,
        payload,
        'EX',
        this.resultTtlSeconds,
      );
    } catch (err) {
      console.warn('Failed to persist job result', jobId, err);
    }
  }

  async getStoredResult(jobId: string): Promise<any | null> {
    if (!jobId) return null;
    try {
      const raw = await this.clientConnection.get(`result:${jobId}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('Failed to read stored job result', jobId, err);
      return null;
    }
  }
}
