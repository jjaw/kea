const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function truncateHead(value: string, maximumBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) {
    return value;
  }

  return truncateWithMarker(bytes, maximumBytes, 0);
}

export function truncateHeadTail(
  value: string,
  headBytes: number,
  tailBytes: number
): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= headBytes + tailBytes) {
    return value;
  }

  return truncateWithMarker(bytes, headBytes, tailBytes);
}

function truncateWithMarker(
  bytes: Uint8Array,
  requestedHeadBytes: number,
  requestedTailBytes: number
): string {
  const budget = requestedHeadBytes + requestedTailBytes;
  const requestedTotal = requestedHeadBytes + requestedTailBytes;
  const headRatio = requestedTotal === 0 ? 1 : requestedHeadBytes / requestedTotal;
  let marker = "";
  let actualHeadBytes = requestedHeadBytes;
  let actualTailBytes = requestedTailBytes;

  for (;;) {
    const omitted = bytes.byteLength - actualHeadBytes - actualTailBytes;
    marker = `…[truncated ${omitted.toLocaleString("en-US")} bytes]`;
    const contentBudget = Math.max(0, budget - utf8ByteLength(marker));
    const nextHeadBytes = Math.floor(contentBudget * headRatio);
    const nextTailBytes = contentBudget - nextHeadBytes;
    if (
      nextHeadBytes === actualHeadBytes &&
      nextTailBytes === actualTailBytes
    ) {
      break;
    }
    actualHeadBytes = nextHeadBytes;
    actualTailBytes = nextTailBytes;
  }

  const head = decodeValidPrefix(bytes.subarray(0, actualHeadBytes));
  const tail = decodeValidSuffix(bytes.subarray(bytes.byteLength - actualTailBytes));
  return `${head}${marker}${tail}`;
}

function decodeValidPrefix(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/\uFFFD$/u, "");
}

function decodeValidSuffix(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/^\uFFFD+/u, "");
}
