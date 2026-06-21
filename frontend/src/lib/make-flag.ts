/**
 * Factory for simple boolean-flag modules. Returns a `{ get, set }` pair
 * backed by a module-scoped variable, giving each call-site its own isolated
 * flag without duplicating the three-line implementation.
 */
export function makeFlag(): { get: () => boolean; set: (value: boolean) => void } {
  let flag = false;
  return {
    get: () => flag,
    set: (value: boolean) => {
      flag = value;
    },
  };
}
