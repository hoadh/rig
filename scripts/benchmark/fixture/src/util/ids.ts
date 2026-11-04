/** Returns a function producing 1, 2, 3, ... on successive calls. */
export function createIdSequence(start = 1): () => number {
  let next = start;
  return () => next++;
}
