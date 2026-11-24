export type Greeting = 'morning' | 'afternoon' | 'evening';

/** Morning 05:00–11:59, afternoon 12:00–17:59, evening otherwise. */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
