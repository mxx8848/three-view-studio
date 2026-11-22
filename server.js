// 三视图学习站 · Express 服务端
// 匿名身份：cookie(uid) → X-Anon-Id 请求头 → 新建；30 天滑动过期；数据整体存 Users.data JSON。
import express from 'express';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const SHARE_ONLY = process.env.SHARE_ONLY === '1';
// 分享实例不加载 SQLite，也不接触本机学习记录。
const { readUser, writeUser, purgeStale, UID_TTL_MS } = SHARE_ONLY ? {} : await import('./lib/db.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
// 题库 JSON 约 3 MB，gzip 后可压到 ~0.6 MB
app.use(compression({ threshold: 1024 }));
// 公网加固：限流 + 请求体上限 + 每日写入配额 + 安全响应头 + 收紧 CORS
const { createGuard } = await import('./lib/guard.js');
app.use(createGuard());
if (SHARE_ONLY) {
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'upload-only' }));
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: '分享版不提供用户记录接口' }));
  app.get(['/', '/index', '/index.html'], async (req, res, next) => {
    try {
      const html = await readFile(join(HERE, 'public/index.html'), 'utf8');
      res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(html
        .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-share-only="true">')
        .replace('</head>', '<link rel="stylesheet" href="/share.css" /></head>'));
    } catch (error) { next(error); }
  });
}
app.use(express.json({ limit: '8mb' }));

// ---------------------------------------------------------------- 工具
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Express 5 不自带 cookie 解析，这里手写，避免额外依赖。 */
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setUidCookie(res, uid) {
  res.cookie('uid', uid, {
    httpOnly: true,     // 前端 JS 读不到，防 XSS 读取
    sameSite: 'lax',
    path: '/',
    maxAge: UID_TTL_MS, // 两年
  });
}

// ---------------------------------------------------------------- 匿名身份中间件
app.use((req, res, next) => {
  if (SHARE_ONLY) return next();
  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = isUid(cookies.uid) ? cookies.uid : null;
  const fromHeader = isUid(req.get('x-anon-id')) ? req.get('x-anon-id') : null;

  let uid = fromCookie || fromHeader || randomUUID();
  req.uidSource = fromCookie ? 'cookie' : fromHeader ? 'header' : 'new';

  // cookie 缺失/非法时回种：既覆盖"清 cookie"，也覆盖"换设备带 X-Anon-Id"
  if (uid !== fromCookie) setUidCookie(res, uid);

  req.uid = uid;
  next();
});

// ---------------------------------------------------------------- API
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uid: req.uid, source: req.uidSource, ts: Date.now() });
});

/** 读当前匿名用户数据 */
app.get('/api/data', (req, res) => {
  const r = readUser(req.uid);
  res.json({ ok: true, ...r, source: req.uidSource });
});

/** 覆盖写当前匿名用户数据 */
app.post('/api/data', (req, res) => {
  const { data } = req.body ?? {};
  if (data === undefined || typeof data !== 'object' || data === null) {
    return res.status(400).json({ ok: false, error: 'body.data 必须是 JSON 对象' });
  }
  const r = writeUser(req.uid, data);
  res.json({ ok: true, ...r });
});

/** 手动清空（用于"重置我的数据"按钮） */
app.post('/api/data/reset', (req, res) => {
  const r = writeUser(req.uid, {});
  res.json({ ok: true, ...r });
});

/** 维护：清理 30 天未访问的数据（可接 cron） */
app.post('/api/maintenance/purge', (req, res) => {
  res.json({ ok: true, ...purgeStale() });
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});

// ---------------------------------------------------------------- 静态资源
// Module workers do not inherit the page's import map. Serve the same local
// sources with explicit dependency URLs; never fetch libraries from a CDN.
const workerLibraries={
  'vendor/three.module.js':'three/build/three.module.js',
  'vendor/three.core.js':'three/build/three.core.js',
  'vendor/jsm/utils/BufferGeometryUtils.js':'three/examples/jsm/utils/BufferGeometryUtils.js',
  'vendor/csg/index.module.js':'three-bvh-csg/build/index.module.js',
  'vendor/meshbvh/index.module.js':'three-mesh-bvh/build/index.module.js'
};
const workerImports={'three':'/worker-modules/vendor/three.module.js','three-bvh-csg':'/worker-modules/vendor/csg/index.module.js','three-mesh-bvh':'/worker-modules/vendor/meshbvh/index.module.js'};
app.get(/^\/worker-modules\/(.+)$/,async(req,res,next)=>{
  const name=req.params[0];
  const file=/^js\/[\w-]+(?:\.[\w-]+)*\.js$/.test(name)?join(HERE,'public',name):workerLibraries[name]?join(HERE,'node_modules',workerLibraries[name]):null;
  if(!file)return res.sendStatus(404);
  try {
    const source=await readFile(file,'utf8');
    res.set('Cache-Control','no-cache, must-revalidate').type('js').send(source.replace(/from\s*(['"])(three(?:\/addons\/[^'"]+)?|three-bvh-csg|three-mesh-bvh)\1/g,(_,quote,spec)=>`from ${quote}${workerImports[spec]||spec.replace('three/addons/','/worker-modules/vendor/jsm/')}${quote}`));
  }catch(error){if(error.code==='ENOENT')res.sendStatus(404);else next(error);}
});
// 本站是本地教学工具，源码改动要立刻生效：JS/CSS/HTML 一律不走强缓存，
// 仅保留 ETag 协商缓存（未改动时返回 304）。vendor 目录是第三方库，可长期缓存。
app.use(
  express.static(join(HERE, 'public'), {
    extensions: ['html'],
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (/\.(js|css|html|svg)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  })
);
// three.js：build 与 examples/jsm 需要同源普通静态托管（ESM 相对导入）
app.use('/vendor', express.static(join(HERE, 'node_modules/three/build'), { maxAge: '7d' }));
app.use('/vendor/jsm', express.static(join(HERE, 'node_modules/three/examples/jsm'), { maxAge: '7d' }));
// CSG 相关库：浏览器端要按裸模块名解析，故单独映射
app.use('/vendor/csg', express.static(join(HERE, 'node_modules/three-bvh-csg/build'), { maxAge: '7d' }));
app.use('/vendor/meshbvh', express.static(join(HERE, 'node_modules/three-mesh-bvh/build'), { maxAge: '7d' }));

export { app };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) app.listen(PORT, HOST, () => {
  console.log(`三视图学习站 running at http://${HOST}:${PORT}`);
});
