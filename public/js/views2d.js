// 二维视图渲染：SVG 直接用毫米作为坐标单位，所以 stroke-width 就是真实线宽。
// 线型遵循 GB/T 4457.4—2002：粗实线 0.5、细实线/虚线/细点画线 0.25，虚线段长按标准比例。
import { LINE_STYLES } from './problems.js';

const PAD = 8; // mm，给中心线留出 2~5mm 超出量

function styleOf(lt) {
  const s = LINE_STYLES[lt] || LINE_STYLES.v;
  return {
    'stroke-width': s.width,
    'stroke-dasharray': s.dash ? s.dash.join(' ') : 'none',
    'stroke-linecap': lt === 'c' ? 'round' : 'butt',
    class: `ln lt-${lt}`,
  };
}

const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

/**
 * 把一条视图数据渲染成 SVG
 * @param {object} view  {w,h,items,axes}
 * @param {{flipX?:boolean, hidden?:boolean, label?:string}} opts
 */
export function renderViewSVG(view, opts = {}) {
  const { flipX = false, hidden = false } = opts;
  const w = view.w;
  const h = view.h;
  const X = (x) => (flipX ? w - x : x);
  const Y = (y) => h - y; // SVG 的 y 向下，图纸的 y 向上
  const pt = (p) => `${X(p[0])} ${Y(p[1])}`;

  const vb = `${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}`;
  // 显示尺寸：按 2.5 px/mm 折算并限制最大宽度，避免视图撑满整列显得过大
  const maxPx = Math.round((w + PAD * 2) * 2.5);
  const out = [];
  out.push(
    `<svg class="views-svg" viewBox="${vb}" width="100%" height="auto" ` +
      `style="max-width:${maxPx}px;display:block;margin:0 auto" ` +
      `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${opts.label || '视图'}">`
  );
  out.push(
    `<rect x="${-PAD}" y="${-PAD}" width="${w + PAD * 2}" height="${h + PAD * 2}" fill="#ffffff" stroke="none"/>`
  );

  if (hidden) {
    // 待求视图：虚线框 + 问号
    out.push(
      `<rect x="0" y="0" width="${w}" height="${h}" fill="#fcfaf6" stroke="#c9bfae" ` +
        `stroke-width="0.3" stroke-dasharray="2 1.5"/>`
    );
    out.push(
      `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-size="${Math.min(h, w) * 0.28}" ` +
        `fill="#c0b5a3" font-family="ui-monospace, monospace" font-weight="700">?</text>`
    );
    out.push('</svg>');
    return out.join('');
  }

  // 轴线/中心线在下层
  if (opts.guides) {
    out.push('<g class="drawing-guides" fill="none" stroke="#168473" stroke-width="0.35" stroke-dasharray="2 1.4">');
    for (const x of opts.guides.x || []) out.push(`<line x1="${X(x)}" y1="-4" x2="${X(x)}" y2="${h + 4}"/>`);
    for (const y of opts.guides.y || []) out.push(`<line x1="-4" y1="${Y(y)}" x2="${w + 4}" y2="${Y(y)}"/>`);
    out.push('</g>');
  }
  for (const a of view.axes || []) {
    out.push(
      `<line ${attrs({
        x1: X(a.p[0][0]), y1: Y(a.p[0][1]),
        x2: X(a.p[1][0]), y2: Y(a.p[1][1]),
        stroke: '#b0271c', fill: 'none', ...styleOf('c'),
      })}/>`
    );
  }

  for (const it of view.items || []) {
    const st = styleOf(it.lt);
    const stroke = '#1a1a1a';
    if (it.t === 'poly') {
      const d = it.pts.map(pt).join(' L ');
      out.push(`<path ${attrs({ d: `M ${d}${it.closed ? ' Z' : ''}`, stroke, fill: 'none', ...st })}/>`);
    } else if (it.t === 'line') {
      out.push(
        `<line ${attrs({
          x1: X(it.p[0][0]), y1: Y(it.p[0][1]),
          x2: X(it.p[1][0]), y2: Y(it.p[1][1]),
          stroke, fill: 'none', ...st,
        })}/>`
      );
    } else if (it.t === 'circle') {
      const cx = X(it.c[0]);
      const cy = Y(it.c[1]);
      out.push(`<circle ${attrs({ cx, cy, r: it.r, stroke, fill: 'none', ...st })}/>`);
      // 自动补中心线（细点画线），超出圆周 4mm
      if (opts.showCenters === false) continue;
      const extra = 4;
      out.push(
        `<line ${attrs({
          x1: cx - it.r - extra, y1: cy, x2: cx + it.r + extra, y2: cy,
          stroke: '#b0271c', fill: 'none', ...styleOf('c'),
        })}/>`
      );
      out.push(
        `<line ${attrs({
          x1: cx, y1: cy - it.r - extra, x2: cx, y2: cy + it.r + extra,
          stroke: '#b0271c', fill: 'none', ...styleOf('c'),
        })}/>`
      );
    }
  }

  out.push('</svg>');
  return out.join('');
}

/** 图例 */
export function renderLegend() {
  return Object.entries(LINE_STYLES)
    .map(([k, s]) => {
      const style =
        `border-color:#1a1a1a;` +
        (s.dash ? `border-top-style:${k === 'c' ? 'dotted' : 'dashed'};` : '') +
        `border-top-width:${k === 'v' ? 2 : 1}px;`;
      return `<span><i class="${k === 'v' ? '' : k}" style="${style}"></i>${s.name}</span>`;
    })
    .join('');
}
