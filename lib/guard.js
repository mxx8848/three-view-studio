// 公网加固中间件：限流 + 请求体上限 + 每日写入配额 + 安全响应头 + 收紧 CORS
// 说明：这是"可以对外"的最低门槛，不是完整的安全方案。
// 暴露到公网前还应考虑：反向代理的 TLS、日志、备份、磁盘配额。

const WINDOW_MS = 60 * 1000;
const READ_LIMIT = 120; // 每 IP 每分钟 API 读请求；静态模块不消耗此额度
const WRITE_LIMIT = 20; // 每 IP 每分钟写请求
const DAILY_WRITES = 300; // 每 uid 每天写入次数
const MAX_BODY = 256 * 1024; // 256 KB 请求体上限
const MAX_TRACKED = 5000; // 内存中最多跟踪多少个客户端

function bucket(map, key, limit) {
  const now = Date.now();
  let b = map.get(key);
  if (!b || now - b.start > WINDOW_MS) {
    b = { start: now, count: 0 };
    map.set(key, b);
  }
  b.count += 1;
  if (map.size > MAX_TRACKED) {
    // 简单清理：丢掉过期的桶，避免内存无限增长
    for (const [k, v] of map) if (now - v.start > WINDOW_MS) map.delete(k);
  }
  return b.count <= limit;
}

export function createGuard(options = {}) {
  const readLimit = options.readLimit ?? READ_LIMIT;
  const writeLimit = options.writeLimit ?? WRITE_LIMIT;
  const dailyWrites = options.dailyWrites ?? DAILY_WRITES;
  const maxBody = options.maxBody ?? MAX_BODY;

  const reads = new Map();
  const writes = new Map();
  const daily = new Map(); // uid -> { day, count }

  return function guard(req, res, next) {
    // 安全响应头（对隧道转发同样有效）
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // 默认不发 Access-Control-Allow-Origin，等于只允许同源访问

    if (req.method === 'GET' && (req.path === '/api/health' || req.path === '/api/data')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    // 请求体上限（提前拒绝，避免大包进内存）
    const len = Number(req.headers['content-length'] || 0);
    if (len > maxBody) {
      res.status(413).json({ error: 'payload too large', limit: maxBody });
      return;
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';

    if (isWrite) {
      if (!bucket(writes, ip, writeLimit)) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'too many writes, slow down' });
        return;
      }
      // 每日写入配额按匿名 uid 统计
      const uid = req.uid || 'anon';
      const today = new Date().toISOString().slice(0, 10);
      let rec = daily.get(uid);
      if (!rec || rec.day !== today) {
        rec = { day: today, count: 0 };
        daily.set(uid, rec);
      }
      rec.count += 1;
      if (rec.count > dailyWrites) {
        res.status(429).json({ error: 'daily write quota exceeded', limit: dailyWrites });
        return;
      }
    } else if (req.path.startsWith('/api/')&&!bucket(reads, ip, readLimit)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'too many requests' });
      return;
    }

    next();
  };
}
