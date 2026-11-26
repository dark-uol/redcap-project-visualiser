/** Pure colour maths (no DOM): sRGB to CIE Lab, CIEDE2000 distance, colour-vision-deficiency simulation, WCAG contrast. */

export type Rgb = [number, number, number];
export type Lab = [number, number, number];
export type Deficiency = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';

/** Parses `#rrggbb` into 0..255 channels. */
export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const toLinear = (channel: number): number => {
  const unit = channel / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (linear: number): number => {
  const clamped = Math.min(1, Math.max(0, linear));
  const unit = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return unit * 255;
};

/** Machado, Oliveira and Fernandes (2009) matrices at severity 1.0, applied to linear RGB. */
const SIMULATION_MATRICES: Record<Exclude<Deficiency, 'normal'>, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

/** The colour as someone with the given deficiency sees it (channels 0..255). */
export function simulate(rgb: Rgb, deficiency: Deficiency): Rgb {
  if (deficiency === 'normal') return rgb;
  const linear = rgb.map(toLinear);
  const matrix = SIMULATION_MATRICES[deficiency];
  const mixed = matrix.map((row) => row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]);
  return [fromLinear(mixed[0]), fromLinear(mixed[1]), fromLinear(mixed[2])];
}

/** sRGB (D65) to CIE Lab. */
export function toLab(rgb: Rgb): Lab {
  const [red, green, blue] = rgb.map(toLinear);
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** CIEDE2000 colour difference (Sharma, Wu and Dalal's formulation, kL = kC = kH = 1). About 2.3 is a just-noticeable difference. */
export function deltaE2000(first: Lab, second: Lab): number {
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const meanChroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanChroma ** 7 / (meanChroma ** 7 + 25 ** 7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1 = Math.hypot(a1Prime, b1);
  const c2 = Math.hypot(a2Prime, b2);
  const hue = (b: number, aPrime: number): number => (b === 0 && aPrime === 0 ? 0 : (toDegrees(Math.atan2(b, aPrime)) + 360) % 360);
  const h1 = hue(b1, a1Prime);
  const h2 = hue(b2, a2Prime);

  const deltaL = l2 - l1;
  const deltaC = c2 - c1;
  let deltaHue = 0;
  if (c1 * c2 !== 0) {
    deltaHue = h2 - h1;
    if (deltaHue > 180) deltaHue -= 360;
    else if (deltaHue < -180) deltaHue += 360;
  }
  const deltaH = 2 * Math.sqrt(c1 * c2) * Math.sin(toRadians(deltaHue / 2));

  const meanL = (l1 + l2) / 2;
  const meanC = (c1 + c2) / 2;
  let meanHue = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) meanHue /= 2;
    else meanHue = (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  }
  const t = 1 - 0.17 * Math.cos(toRadians(meanHue - 30)) + 0.24 * Math.cos(toRadians(2 * meanHue))
    + 0.32 * Math.cos(toRadians(3 * meanHue + 6)) - 0.2 * Math.cos(toRadians(4 * meanHue - 63));
  const deltaTheta = 30 * Math.exp(-(((meanHue - 275) / 25) ** 2));
  const rotationC = 2 * Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sC = 1 + 0.045 * meanC;
  const sH = 1 + 0.015 * meanC * t;
  const rotation = -Math.sin(toRadians(2 * deltaTheta)) * rotationC;

  return Math.sqrt(
    (deltaL / sL) ** 2 + (deltaC / sC) ** 2 + (deltaH / sH) ** 2 + rotation * (deltaC / sC) * (deltaH / sH),
  );
}

/** CIEDE2000 between two `#rrggbb` colours as seen with the given deficiency. */
export function colourDistance(firstHex: string, secondHex: string, deficiency: Deficiency = 'normal'): number {
  const first = toLab(simulate(parseHex(firstHex), deficiency));
  const second = toLab(simulate(parseHex(secondHex), deficiency));
  return deltaE2000(first, second);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours (1 to 21). */
export function contrastRatio(firstHex: string, secondHex: string): number {
  const luminance = (hex: string): number => {
    const [red, green, blue] = parseHex(hex).map(toLinear);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter, darker] = [luminance(firstHex), luminance(secondHex)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
