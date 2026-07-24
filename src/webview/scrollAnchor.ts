export interface ScrollAnchorRestorationInput {
  readonly currentScrollTop: number;
  readonly anchorOffsetBefore: number;
  readonly anchorOffsetAfter: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface ScrollAnchorRestoration {
  readonly scrollTop: number;
  readonly trailingSpace: number;
}

/**
 * Calculates the scroll offset needed to return a stable item to its previous
 * viewport position after the scroll container's children have been replaced.
 * When a shorter list would clamp that offset, trailing space supplies only
 * the missing scroll range.
 */
export function calculateScrollAnchorRestoration(
  input: ScrollAnchorRestorationInput,
): ScrollAnchorRestoration {
  const scrollTop = Math.max(
    0,
    input.currentScrollTop + input.anchorOffsetAfter - input.anchorOffsetBefore,
  );
  const naturalMaximum = Math.max(0, input.scrollHeight - input.clientHeight);

  return {
    scrollTop,
    trailingSpace: Math.ceil(Math.max(0, scrollTop - naturalMaximum)),
  };
}

export function isWithinNaturalScrollRange(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trailingSpace: number,
  tolerance = 1,
): boolean {
  const naturalMaximum = Math.max(0, scrollHeight - trailingSpace - clientHeight);
  return scrollTop <= naturalMaximum + tolerance;
}
