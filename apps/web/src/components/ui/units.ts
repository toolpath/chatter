/**
 * A design size in pixels, as rem. The app sets the root text size to 80%,
 * so a size in rem shrinks with the rest of the page. 16 px is 1 rem.
 */
export function rem(pixels: number): string {
  return `${pixels / 16}rem`;
}
