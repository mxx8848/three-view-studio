// A missing view has no source pixels. Its dimensions are only a placeholder;
// reconstruction obtains physical dimensions from the two measured views.
export function selectedViewRoles(items, blankRole = '') {
  if (!['front', 'top', 'side'].includes(blankRole)) return inferViewRoles(items.map(item => item.box));
  if (items.length !== 2) return { roles: null, score: 0 };
  const known = ['front', 'top', 'side'].filter(role => role !== blankRole);
  const axis = blankRole === 'side' ? 'y' : 'x';
  const ordered = [...items].sort((a, b) => a.box[axis] + a.box[axis === 'x' ? 'w' : 'h'] / 2 - b.box[axis] - b.box[axis === 'x' ? 'w' : 'h'] / 2);
  const roles = {};
  for (const role of known) {
    const pinned = items.find(item => item.role === role);
    if (pinned) roles[role] = pinned.box;
  }
  for (const role of known.filter(role => !roles[role])) roles[role] = ordered.find(item => !Object.values(roles).includes(item.box)).box;
  if (roles[known[0]] === roles[known[1]]) return { roles: null, score: 0 };
  const w = blankRole === 'side' ? roles.top.h : blankRole === 'top' ? roles.front.w : roles.top.w;
  const h = blankRole === 'top' ? roles.side.w : blankRole === 'side' ? roles.front.h : roles.side.h;
  roles[blankRole] = { x: 0, y: 0, w, h, blank: true };
  return { roles, score: 12 };
}

export function inferViewRoles(boxes) {
  if (boxes.length !== 3) return { roles: null, score: 0 };
  let best = null;
  for (let fi = 0; fi < 3; fi += 1) {
    for (let ti = 0; ti < 3; ti += 1) {
      for (let si = 0; si < 3; si += 1) {
        if (fi === ti || fi === si || ti === si) continue;
        const front = boxes[fi], top = boxes[ti], side = boxes[si];
        const topBelow = top.y + top.h / 2 > front.y + front.h / 2;
        const sideRight = side.x + side.w / 2 > front.x + front.w / 2;
        const alignX = overlap(front.x, front.w, top.x, top.w);
        const alignY = overlap(front.y, front.h, side.y, side.h);
        const gapTop = Math.max(0, top.y - front.y - front.h) / Math.max(1, front.h);
        const gapSide = Math.max(0, side.x - front.x - front.w) / Math.max(1, front.w);
        const score = 4 * alignX + 4 * alignY + (topBelow ? 2 : -4) + (sideRight ? 2 : -4)
          - Math.min(gapTop, 4) * 0.35 - Math.min(gapSide, 4) * 0.35;
        if (!best || score > best.score) best = { score, roles: { front, top, side } };
      }
    }
  }
  return best || { roles: null, score: 0 };
}

function overlap(a, aSize, b, bSize) {
  return Math.max(0, Math.min(a + aSize, b + bSize) - Math.max(a, b)) / Math.max(1, Math.min(aSize, bSize));
}
