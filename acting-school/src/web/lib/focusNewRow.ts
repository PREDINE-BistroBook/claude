import { useEffect, useRef } from 'react';

/**
 * A list whose "+ Add …" sits at the top of its block (Part K2) but whose new
 * row appears at the end: once the list grows, bring the new (last) row into
 * view and put the cursor in its first field. Put the returned ref on the list.
 */
export function useFocusNewRow<T extends HTMLElement>(count: number) {
  const ref = useRef<T>(null);
  const before = useRef(count);
  useEffect(() => {
    const grew = count > before.current;
    before.current = count;
    if (!grew) return;
    const row = ref.current?.lastElementChild as HTMLElement | null | undefined;
    const field = row?.querySelector<HTMLElement>('input, textarea, select');
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    field?.focus({ preventScroll: true });
  }, [count]);
  return ref;
}
