export const extractBearerToken = (header?: string) => {
  if (!header) return null;

  const match = new RegExp(/^Bearer\s+(.+)$/i).exec(header);
  return match ? match[1].trim() : null;
}

export const verifyBearerToken = (expectedToken: string, receivedHeader?: string) => {
  if (!receivedHeader || !expectedToken) return false;

  const receivedToken = extractBearerToken(receivedHeader);
  if (!receivedToken) return false;

  const encoder = new TextEncoder();
  const receivedBuf = encoder.encode(receivedToken);
  const expectedBuf = encoder.encode(expectedToken);

  // Prevent length leak: compare same-length buffers
  const lengthsMatch = receivedBuf.byteLength === expectedBuf.byteLength
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(receivedBuf, expectedBuf)
    : !crypto.subtle.timingSafeEqual(receivedBuf, receivedBuf)
}