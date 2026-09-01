let counter = 0;

/** Deterministic-ish incrementing id, good enough for a single local match. */
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function resetIdCounter(): void {
  counter = 0;
}
