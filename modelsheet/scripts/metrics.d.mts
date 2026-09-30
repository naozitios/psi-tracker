export function computeMetrics(
  query: (sql: string) => Promise<Array<Record<string, unknown>>>,
): Promise<Array<[metric: string, value: string, target: string]>>;
