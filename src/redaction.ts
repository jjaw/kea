const REDACTION_PATTERNS: ReadonlyArray<{
  type: string;
  pattern: RegExp;
  replacement?: string;
}> = [
  {
    type: "private-key",
    pattern:
      /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g
  },
  { type: "aws-key", pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  {
    type: "token",
    pattern: /\b(?:sk-|ghp_|gho_|github_pat_|xox[a-z]-)[A-Za-z0-9_-]+/g
  },
  {
    type: "bearer-token",
    pattern: /Authorization\s*:\s*Bearer\s+[^\s"'`,;]+/gi,
    replacement: "Authorization: Bearer [REDACTED:bearer-token]"
  },
  {
    type: "connection-password",
    pattern: /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+(@[^\s]+)/g,
    replacement: "$1[REDACTED:connection-password]$2"
  }
];

export function redactText(value: string): string {
  let redacted = value;
  for (const entry of REDACTION_PATTERNS) {
    redacted = redacted.replace(
      entry.pattern,
      entry.replacement ?? `[REDACTED:${entry.type}]`
    );
  }
  return redacted.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/g,
    (assignment, key: string) =>
      /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY/i.test(key)
        ? `${key}=[REDACTED:env-secret]`
        : assignment
  );
}

export function redactJson(value: unknown): string {
  const serialized = typeof value === "string" ? value : safeJsonStringify(value);
  return redactText(serialized);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
