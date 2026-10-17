import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export function createAccountingTestReplica() {
  const cached = fileURLToPath(new URL('../node_modules/.cache/accounting-mongo/mongod.exe', import.meta.url));
  const systemBinary = process.env.MONGOMS_SYSTEM_BINARY || (process.platform === 'win32' && existsSync(cached) ? cached : undefined);
  return MongoMemoryReplSet.create({ binary: { version: '7.0.14', ...(systemBinary ? { systemBinary } : {}) }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
}
