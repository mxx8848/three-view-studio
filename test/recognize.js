import { thresholdSelectedViews } from '../public/js/recognize.js';

const width = 6;
const height = 2;
const rgba = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < width * height; i += 1) {
  const value = i % 2 === 0 ? 0 : 255;
  rgba.set([value, value, value, 255], i * 4);
}
const generatedCrops = [];
globalThis.document = {
  createElement() {
    const crop = {
      width: 0,
      height: 0,
      pixels: null,
    };
    crop.getContext = () => ({
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(data) { crop.pixels = data.data; },
    });
    generatedCrops.push(crop);
    return crop;
  },
};
const canvas = {
  width, height,
  getContext() { return { getImageData() { return { data: rgba }; } }; },
};
const roles = {
  front: { x: 0, y: 0, w: 2, h: 2 },
  top: { x: 2, y: 0, w: 2, h: 2 },
  side: { x: 4, y: 0, w: 2, h: 2 },
};
const result = thresholdSelectedViews(canvas, roles);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const expected = x % 2 === 0 ? 1 : 0;
    if (result.ink[y * width + x] !== expected) throw new Error(`pixel threshold mismatch at ${x},${y}`);
  }
}
if (Object.keys(result.thresholded).length !== 3) throw new Error('one binary preview per view is required');
console.log('independent view thresholding passed');
const blankResult = thresholdSelectedViews(canvas, { front: roles.front, side: { ...roles.side, blank: true } });
if (blankResult.lineMasks.side.mask.some(Boolean) || blankResult.lineMasks.side.darkMask.some(Boolean)) throw Error('explicit blank must ignore source pixels');
if (!blankResult.lineMasks.front.mask.some(Boolean)) throw Error('explicit blank must retain known view ink');
if ([...blankResult.thresholded.side.pixels].some(value => value !== 255)) throw Error('explicit blank preview must be white');

const colorWidth = 12, colorHeight = 12;
const colorPixels = new Uint8ClampedArray(colorWidth * colorHeight * 4);
for (let y = 0; y < colorHeight; y += 1) {
  for (let x = 0; x < colorWidth; x += 1) {
    const shade = 225 + x * 2;
    const offset = (y * colorWidth + x) * 4;
    colorPixels.set([shade, shade, shade, 255], offset);
  }
}
for (let x = 2; x < 10; x += 1) colorPixels.set([45, 145, 85, 255], (6 * colorWidth + x) * 4);
const colorCanvas = { width: colorWidth, height: colorHeight, getContext() { return { getImageData() { return { data: colorPixels }; } }; } };
const colorResult = thresholdSelectedViews(colorCanvas, {
  front: { x: 0, y: 0, w: 12, h: 12 },
  top: { x: 0, y: 0, w: 12, h: 12 },
  side: { x: 0, y: 0, w: 12, h: 12 },
});
if (!colorResult.ink[6 * colorWidth + 5]) throw new Error('colored technical-pen stroke was lost against a shaded background');
console.log('colored ink over uneven paper thresholding passed');

const lineWidth = 24, lineHeight = 24;
const linePixels = new Uint8ClampedArray(lineWidth * lineHeight * 4);
for (let i = 0; i < lineWidth * lineHeight; i += 1) linePixels.set([255, 255, 255, 255], i * 4);
for (let y = 10; y <= 14; y += 1) {
  for (let x = 3; x <= 20; x += 1) linePixels.set([20, 20, 20, 255], (y * lineWidth + x) * 4);
}
const lineCanvas = { width: lineWidth, height: lineHeight, getContext() { return { getImageData() { return { data: linePixels }; } }; } };
thresholdSelectedViews(lineCanvas, {
  front: { x: 0, y: 0, w: lineWidth, h: lineHeight },
  top: { x: 0, y: 0, w: lineWidth, h: lineHeight },
  side: { x: 0, y: 0, w: lineWidth, h: lineHeight },
});
const normalizedLine = generatedCrops.at(-1).pixels;
const normalizedCount = normalizedLine.filter((value, i) => i % 4 === 0 && value < 128).length;
if (normalizedCount !== 90) throw new Error(`display must preserve the original thick stroke: ${normalizedCount} pixels`);
console.log('original stroke width preserved in displayed extraction');
