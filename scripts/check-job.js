// scripts/check-job.js
require('dotenv').config();
const { Queue } = require('bullmq');

(async () => {
  const connection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };

  const prefix = process.env.QUEUE_PREFIX || process.env.CRAWL_QUEUE_PREFIX || 'nestjs-crawler';
  const queueName = process.env.QUEUE_NAME || process.env.CRAWL_QUEUE_NAME || 'crawl-queue';

  console.log('Using connection:', { host: connection.host, port: connection.port, password: connection.password ? '***' : '(none)', prefix, queueName });

  const queue = new Queue(queueName, { connection, prefix });

  try {
    // job counts
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    console.log('jobCounts:', counts);

    // list jobs in common states (small window)
    const states = ['waiting', 'active', 'completed', 'failed', 'delayed'];
    for (const state of states) {
      const jobs = await queue.getJobs([state], 0, 50);
      console.log(`\n${state} jobs: ${jobs.length}`);
      jobs.forEach((j) => {
        console.log(`  id=${j.id} state=${state} data=${JSON.stringify(j.data).slice(0,200)} return=${JSON.stringify(j.returnvalue || null).slice(0,200)}`);
      });
    }

    // try a specific id if provided
    const testId = process.argv[2] || null;
    if (testId) {
      const job1 = await queue.getJob(testId);
      console.log('\ngetJob(' + testId + '):', job1 ? { id: job1.id, state: await job1.getState(), data: job1.data, returnvalue: job1.returnvalue } : null);
    }

    // Robust Redis key scan
    console.log('\nScanning Redis keys for prefix...');
    const client = queue.client;

    const keys = [];
    if (client && typeof client.scanIterator === 'function') {
      for await (const k of client.scanIterator({ MATCH: `${prefix}:${queueName}:*`, COUNT: 100 })) keys.push(k);
    } else if (client && typeof client.scanStream === 'function') {
      // ioredis provides scanStream
      await new Promise((resolve, reject) => {
        const stream = client.scanStream({ match: `${prefix}:${queueName}:*`, count: 100 });
        stream.on('data', (resultKeys) => {
          for (const k of resultKeys) keys.push(k);
        });
        stream.on('end', resolve);
        stream.on('error', reject);
      });
    } else {
      // fallback - KEYS (ok for debugging but avoid in prod)
      try {
        const raw = await client.keys(`${prefix}:${queueName}:*`);
        if (Array.isArray(raw)) keys.push(...raw);
      } catch (err) {
        console.warn('Fallback KEYS failed:', err.message || err);
      }
    }

    console.log(`Found ${keys.length} keys matching ${prefix}:${queueName}:*`);
    for (const k of keys.slice(0,200)) {
      const type = await client.type(k).catch(() => 'unknown');
      console.log(`  ${k}  (type=${type})`);
      try {
        if (type === 'string') {
          const v = await client.get(k);
          console.log(`    str len=${v ? v.length : 0} sample=${v ? v.slice(0,200) : null}`);
        } else if (type === 'hash') {
          const h = await client.hgetall(k);
          console.log(`    hash keys: ${Object.keys(h).slice(0,10).join(', ')}`);
        } else if (type === 'list') {
          const l = await client.lrange(k, 0, 10);
          console.log(`    list(len=${l.length}): ${JSON.stringify(l).slice(0,200)}`);
        } else if (type === 'zset') {
          const z = await client.zrange(k, 0, 10, 'WITHSCORES');
          console.log(`    zset sample: ${JSON.stringify(z).slice(0,200)}`);
        }
      } catch (err) {
        // ignore read errors
        console.warn('    (could not read key)', err.message || err);
      }
    }
  } catch (err) {
    console.error('Error checking queue:', err);
  } finally {
    await queue.close();
    process.exit(0);
  }
})();
