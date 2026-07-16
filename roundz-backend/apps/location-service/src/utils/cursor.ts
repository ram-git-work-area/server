export type DecodedHistoryCursor = {
  timestampMs: number;
  id: string;
};

export function encodeHistoryCursor(entry: { timestamp: Date; id: string }): string {
  return Buffer.from(`${entry.timestamp.getTime()}:${entry.id}`).toString('base64url');
}

export function decodeHistoryCursor(cursor: string): DecodedHistoryCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex <= 0) {
      return null;
    }

    const timestampMs = Number(decoded.slice(0, separatorIndex));
    const id = decoded.slice(separatorIndex + 1);

    if (!Number.isFinite(timestampMs) || !id) {
      return null;
    }

    return { timestampMs, id };
  } catch {
    return null;
  }
}
