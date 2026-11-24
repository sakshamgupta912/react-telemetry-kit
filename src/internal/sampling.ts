/** Maps an identifier to a stable fraction in [0, 1). */
export function fractionOf(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash, 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0) / 0x100000000;
}

export function isSelected(value: string, rate: number): boolean {
  return rate === 1 || (rate > 0 && fractionOf(value) < rate);
}
