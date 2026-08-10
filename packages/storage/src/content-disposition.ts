/**
 * Builds an RFC 6266 `Content-Disposition` header value for a download.
 *
 * Resource names allow any character except slashes and control characters, so
 * filenames routinely contain non-ASCII characters (e.g. "café.pdf", "报告.pdf").
 * A bare `filename="…"` carries those bytes verbatim, which is an invalid HTTP
 * header field value and makes browsers decode the name as ISO-8859-1, producing
 * a mangled download name. We always emit an ASCII `filename` fallback and add a
 * UTF-8 `filename*` (RFC 5987) form whenever the name is not pure ASCII, so
 * modern browsers recover the exact name while older clients still get a usable
 * fallback.
 */
export function buildContentDisposition(filename: string): string {
  const disposition = `attachment; filename="${toAsciiFallback(filename)}"`;

  if (/[^\x20-\x7e]/.test(filename)) {
    return `${disposition}; filename*=UTF-8''${encodeRfc5987(filename)}`;
  }

  return disposition;
}

function toAsciiFallback(filename: string): string {
  return filename.replace(/["\\]|[^\x20-\x7e]/g, "_");
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
