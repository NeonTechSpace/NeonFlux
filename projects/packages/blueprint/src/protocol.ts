/**
 * Durable Blueprint run protocol shared by Convex and every deployed
 * consumer. Bump this only when persisted run or replay semantics change.
 */
export const BLUEPRINT_RUN_PROTOCOL_VERSION = 6 as const;
