// src/events.ts
import { EventEmitter } from 'events';
import { OrderStatusUpdate } from './types';

export const orderEvents = new EventEmitter();

// Avoid "MaxListenersExceededWarning" for many orders
orderEvents.setMaxListeners(0);

export function emitOrderUpdate(update: OrderStatusUpdate) {
  orderEvents.emit(`order-updated:${update.orderId}`, update);
}
