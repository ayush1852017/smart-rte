export const isElement = (target: EventTarget | null): target is Element =>
  typeof Element !== "undefined" && target instanceof Element;

export const isNode = (target: EventTarget | null): target is Node =>
  typeof Node !== "undefined" && target instanceof Node;

export const closestFromTarget = (target: EventTarget | null, selector: string): Element | null =>
  isElement(target) ? target.closest(selector) : null;
