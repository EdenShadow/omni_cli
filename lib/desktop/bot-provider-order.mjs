import {normalizeBotProviderOrder} from '../shared/bot-provider-order.mjs';

const account = store => store.userId ? JSON.stringify([store.endpoint || '', store.userId]) : null;
export function botProviderOrder(store) {
  return normalizeBotProviderOrder(store.botProviderOrders?.[account(store)]);
}
export function saveBotProviderOrder(store, save, order) {
  const key = account(store), normalized = normalizeBotProviderOrder(order);
  if (!key || !Array.isArray(order) || order.length !== normalized.length || normalized.some(p => !order.includes(p)))
    throw Error('Invalid Bot runtime order');
  const previous = store.botProviderOrders;
  store.botProviderOrders = {...previous, [key]: normalized};
  try { save(); } catch (error) { store.botProviderOrders = previous; throw error; }
  return normalized;
}
