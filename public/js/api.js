// 匿名身份 + fetch 封装
// 三重保障：httpOnly cookie（服务端） → localStorage 备份（前端） → X-Anon-Id 请求头
// cookie 被清理后，localStorage 里的值经 X-Anon-Id 回传，服务端据此回种 cookie，数据不丢。
const KEY = 'tv.anonId';
export const SHARE_ONLY = typeof document !== 'undefined' && document.documentElement.dataset.shareOnly === 'true';

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  // 兜底：老浏览器
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let anonId = null;
export function getAnonId() {
  if (SHARE_ONLY) return null;
  if (anonId) return anonId;
  try {
    anonId = localStorage.getItem(KEY);
  } catch {
    anonId = null; // 隐私模式下 localStorage 可能抛错
  }
  if (!anonId) {
    anonId = uuid();
    try {
      localStorage.setItem(KEY, anonId);
    } catch {
      /* 忽略：此时只有 cookie 兜底 */
    }
  }
  return anonId;
}

/** 统一带 X-Anon-Id 的 fetch */
export async function api(path, { method = 'GET', body } = {}) {
  if (SHARE_ONLY) return { ok: true, data: {} };
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Anon-Id': getAnonId(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin', // 带上 httpOnly cookie
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  // 服务端认定的 uid 与本地不一致时（例如清过 cookie），采纳服务端的并回写备份
  if (json.uid && json.uid !== getAnonId()) {
    anonId = json.uid;
    try {
      localStorage.setItem(KEY, anonId);
    } catch {
      /* ignore */
    }
  }
  return json;
}

export const loadData = () => api('/api/data');
export const saveData = (data) => api('/api/data', { method: 'POST', body: { data } });
