// Antigravity 2.29.0 CortexStepMetadata descriptor (verified 2026-11-12):
// field 7 = finished_generating_at, google.protobuf.Timestamp.
// Skip every other field without interpreting tool arguments or message data.
function varint(bytes, offset) {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    if (offset >= bytes.length) throw new Error('Truncated metadata');
    const byte = bytes[offset++];
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) return [value, offset];
  }
  throw new Error('Invalid metadata integer');
}
function visit(bytes, consume) {
  let offset = 0;
  while (offset < bytes.length) {
    let tag; [tag, offset] = varint(bytes, offset);
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (!field) throw new Error('Invalid metadata tag');
    if (wire === 0) {
      let value; [value, offset] = varint(bytes, offset); consume(field, wire, value);
    } else if (wire === 2) {
      let length; [length, offset] = varint(bytes, offset);
      if (length > BigInt(bytes.length - offset)) throw new Error('Truncated metadata field');
      const end = offset + Number(length); consume(field, wire, bytes.subarray(offset, end)); offset = end;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > bytes.length) throw new Error('Truncated fixed metadata');
    } else throw new Error('Unsupported metadata wire type');
  }
}
function timestamp(bytes) {
  let seconds = 0n, nanos = 0n;
  visit(bytes, (field, wire, value) => {
    if (field === 1 || field === 2) {
      if (wire !== 0) throw new Error('Invalid timestamp');
      if (field === 1) seconds = value; else nanos = value;
    }
  });
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER) || nanos >= 1000000000n) throw new Error('Invalid timestamp range');
  const value = Number(seconds) * 1000 + Number(nanos) / 1000000;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}
export function stepGenerationTime(bytes) {
  try {
    let result = null;
    visit(bytes, (field, wire, value) => {
      if (field === 7) {
        if (wire !== 2) throw new Error('Invalid completion timestamp');
        result = timestamp(value);
      }
    });
    return result;
  } catch { return null; }
}
