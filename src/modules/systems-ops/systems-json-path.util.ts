export type JsonPathReadResult = {
  found: boolean;
  value: unknown;
};

type PathToken = string | number;

const PATH_TOKEN_PATTERN = /\.([A-Za-z_$][A-Za-z0-9_$-]*)|\[(\d+)]|\[['"]([^'"]+)['"]]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonPath(path: string): PathToken[] {
  if (path === '$') return [];
  if (!path.startsWith('$')) throw new Error(`Invalid JSONPath "${path}". Path must start with $.`);

  const tokens: PathToken[] = [];
  let consumed = 1;
  for (const match of path.matchAll(PATH_TOKEN_PATTERN)) {
    if (match.index !== consumed) throw new Error(`Invalid JSONPath "${path}" near "${path.slice(consumed)}".`);
    consumed += match[0].length;
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(Number(match[2]));
    else if (match[3]) tokens.push(match[3]);
  }

  if (consumed !== path.length) throw new Error(`Invalid JSONPath "${path}" near "${path.slice(consumed)}".`);
  return tokens;
}

export function readJsonPath(source: unknown, path: string): JsonPathReadResult {
  const tokens = parseJsonPath(path);
  let current = source;

  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) return { found: false, value: undefined };
      current = current[token];
      continue;
    }
    if (!isRecord(current) || !(token in current)) return { found: false, value: undefined };
    current = current[token];
  }

  return { found: true, value: current };
}
