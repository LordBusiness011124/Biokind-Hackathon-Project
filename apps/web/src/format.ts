export const usd = (cents: number, compact = false) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}) });
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const hrs = (ticks: number) => `${ticks.toFixed(1)} h`;
export const num = (n: number) => Math.round(n).toLocaleString('en-US');
