let depth = 0;

/** True while any sink is running; events created by sink code are dropped to prevent feedback loops. */
export function isDispatching(): boolean {
  return depth > 0;
}

export function dispatch<T>(callback: () => T): T {
  depth++;
  try {
    return callback();
  } finally {
    depth--;
  }
}
