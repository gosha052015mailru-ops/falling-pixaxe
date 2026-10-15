const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

/** 999 → "999", 12 345 → "12.3K", 4 500 000 → "4.5M". */
export function fmt(n: number): string {
  n = Math.floor(n);
  if (Math.abs(n) < 1000) return String(n);
  let i = 0;
  let v = n;
  while (Math.abs(v) >= 1000 && i < SUFFIX.length - 1) {
    v /= 1000;
    i++;
  }
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace(/\.?0+$/, '') + SUFFIX[i];
}
