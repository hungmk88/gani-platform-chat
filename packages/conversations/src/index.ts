// The conversation core shared by the API and the worker (N138): the only module that changes a conversation's state, the message
// service and the outbox writer. Plain classes over a caller's TenantTx: no framework, no connection of their own.
export * from './channel-policy-service.js';
export * from './conversation-state-machine.js';
export * from './errors.js';
export * from './message-service.js';
export * from './outbox-writer.js';
