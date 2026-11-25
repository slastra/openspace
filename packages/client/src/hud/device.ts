/** Touch-first device (phone/tablet): no hover, coarse pointer. */
export const isTouch =
  typeof matchMedia === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;
