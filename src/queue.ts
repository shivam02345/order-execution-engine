// src/queue.ts
import { Queue, Worker, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { MockDexRouter } from './dexRouter';
import {
  Order,
  OrderStatus,
  OrderStatusUpdate
} from './types';
import { emitOrderUpdate } from './events';
import { updateOrderStatus } from './db';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});


export const orderQueue = new Queue<Order>('orders', {
  connection
});

const router = new MockDexRouter();

async function sendStatus(
  orderId: string,
  status: OrderStatus,
  extra: Partial<OrderStatusUpdate> = {}
) {
  const update: OrderStatusUpdate = {
    orderId,
    status,
    dex: extra.dex,
    txHash: extra.txHash,
    executedPrice: extra.executedPrice,
    error: extra.error,
    timestamp: new Date().toISOString()
  };

  // Persist status change in DB (only for certain statuses if you like)
  await updateOrderStatus(orderId, status, {
    dex: extra.dex ?? null,
    executedPrice: extra.executedPrice ?? null,
    txHash: extra.txHash ?? null,
    error: extra.error ?? null
  });

  emitOrderUpdate(update);
}

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 500
  },
  removeOnComplete: true,
  removeOnFail: false
};

// Worker to process jobs
export const orderWorker = new Worker<Order>(
  'orders',
  async (job) => {
    const order = job.data;
    const { id } = order;

    try {
      await sendStatus(id, 'pending');

      await sendStatus(id, 'routing');

      const [rayQuote, metQuote] = await Promise.all([
        router.getRaydiumQuote(order.tokenIn, order.tokenOut, order.amount),
        router.getMeteoraQuote(order.tokenIn, order.tokenOut, order.amount)
      ]);

      const bestQuote = rayQuote.price >= metQuote.price ? rayQuote : metQuote;
      const bestDex = bestQuote.dex;

      await sendStatus(id, 'building', { dex: bestDex });

      // Simulate small building delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      await sendStatus(id, 'submitted', { dex: bestDex });

      const execResult = await router.executeSwap(bestDex, order);

      await sendStatus(id, 'confirmed', {
        dex: bestDex,
        txHash: execResult.txHash,
        executedPrice: execResult.executedPrice
      });

      return execResult;
    } catch (err: any) {
      console.error('Order processing error', err);
      await sendStatus(id, 'failed', {
        error: err?.message || 'Unknown error'
      });
      throw err;
    }
  },
  {
    connection,
    concurrency: 10
  }
);

orderWorker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed`, result);
});

orderWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed after retries`, err);
});
