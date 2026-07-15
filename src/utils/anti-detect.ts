export function humanDelay(min: number, max: number): Promise<void> {
  const delay = triangularDelay(min, max);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function triangularDelay(min: number, max: number): number {
  const u = Math.random();
  const midpoint = (min + max) / 2;

  if (u < 0.6) {
    const t = Math.random();
    return min + t * (midpoint - min + Math.random() * (max - midpoint) * 0.3);
  } else if (u < 0.85) {
    return midpoint + Math.random() * (max - midpoint) * 0.6;
  } else if (u < 0.95) {
    return min + Math.random() * (midpoint - min) * 0.3;
  } else {
    return max - Math.random() * (max - midpoint) * 0.4;
  }
}

export function shouldSkip(probability: number): boolean {
  return Math.random() < probability;
}

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function gaussianRandom(mean: number, stddev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stddev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
