// SQLite 访问层：使用 Node 24 内置 node:sqlite，零原生依赖。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** 30 天滑动过期（毫秒） */
export const STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** cookie 与 localStorage 备份的有效期：两年（毫秒） */
export const UID_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;

const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'app.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));

const q = {
  insert: db.prepare('INSERT OR IGNORE INTO Users (uid, data, updated_at) VALUES (?, ?, ?)'),
  touch: db.prepare('UPDATE Users SET updated_at = ? WHERE uid = ?'),
  read: db.prepare('SELECT uid, data, updated_at FROM Users WHERE uid = ?'),
  write: db.prepare('UPDATE Users SET data = ?, updated_at = ? WHERE uid = ?'),
  reset: db.prepare('UPDATE Users SET data = ?, updated_at = ? WHERE uid = ?'),
  purge: db.prepare('DELETE FROM Users WHERE updated_at < ?'),
};

/** 确保用户行存在（幂等）。 */
export function ensureUser(uid) {
  const now = Date.now();
  q.insert.run(uid, '{}', now);
  return now;
}

/**
 * 读取用户数据，并执行 30 天滑动过期：
 * - 距上次访问超过 30 天 → 清空 data 并重置时间戳（返回 expired:true）
 * - 否则刷新 updated_at
 */
export function readUser(uid) {
  ensureUser(uid);
  const row = q.read.get(uid);
  const now = Date.now();
  const stale = now - row.updated_at > STALE_MS;
  if (stale) {
    q.reset.run('{}', now, uid);
    return { uid, data: {}, updatedAt: now, expired: true };
  }
  q.touch.run(now, uid);
  let data = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch {
    data = {};
  }
  return { uid, data, updatedAt: now, expired: false };
}

/** 写入用户数据（整体覆盖 data 字段）。 */
export function writeUser(uid, data) {
  ensureUser(uid);
  const now = Date.now();
  q.write.run(JSON.stringify(data ?? {}), now, uid);
  return { uid, updatedAt: now };
}

/** 清理长期未访问的匿名数据（可定时调用）。 */
export function purgeStale() {
  const cutoff = Date.now() - STALE_MS;
  const info = q.purge.run(cutoff);
  return { removed: Number(info.changes || 0), cutoff };
}
