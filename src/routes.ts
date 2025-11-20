// src/routes.ts
import { FastifyInstance } from 'fastify';
import { orderQueue, defaultJobOptions } from './queue';
import { insertOrder } from './db';
import { CreateOrderRequest, Order } from './types';
import { emitOrderUpdate, orderEvents } from './events';
import { randomUUID } from 'crypto';

export async function registerRoutes(app: FastifyInstance) {
  // POST /api/orders/execute  -> create market order
  app.post<{ Body: CreateOrderRequest }>(
    '/api/orders/execute',
    async (request, reply) => {
      const { tokenIn, tokenOut, amount, side } = request.body;

      if (!tokenIn || !tokenOut || !amount || !side) {
        return reply.status(400).send({ error: 'Invalid request body' });
      }

      const id = randomUUID();

      const order: Order = {
        id,
        type: 'market',
        tokenIn,
        tokenOut,
        amount,
        side,
        status: 'pending'
      };

      // Save initial order to DB
      await insertOrder(order);

      // Immediately emit initial pending status
      emitOrderUpdate({
        orderId: id,
        status: 'pending',
        timestamp: new Date().toISOString()
      });

      // Add to queue
      await orderQueue.add('execute-order', order, defaultJobOptions);

      return reply.status(200).send({
        orderId: id,
        message: 'Order accepted. Connect via WebSocket for updates.',
        wsUrl: `/ws/orders/${id}`
      });
    }
  );

// REAL event-driven WebSocket route using socket
app.get(
  '/ws/orders/:orderId',
  { websocket: true },
  (socket, req) => {
    const { orderId } = req.params as { orderId: string };

    console.log(`🔌 WebSocket connected for order ${orderId}`);

    // send initial message
    socket.send(JSON.stringify({
      orderId,
      status: 'pending',
      info: 'Subscribed to order updates'
    }));

    // listener for events
    const listener = (update: any) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(update));
      }
    };

    // subscribe to events for this order
    orderEvents.on(`order-updated:${orderId}`, listener);

    socket.on('close', () => {
      orderEvents.off(`order-updated:${orderId}`, listener);
      console.log(`🔌 WebSocket disconnected for order ${orderId}`);
    });
  }
);
}