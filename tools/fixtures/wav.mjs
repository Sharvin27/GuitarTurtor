// Small diagnostic decoder, deliberately limited to uncompressed 16-bit PCM RIFF/WAVE.
// No browser codecs, resampling, dependencies, or writes to the supplied recording.
export function decodePCM16Wav(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF/WAVE');
  let format, data;
  for (let at = 12; at + 8 <= b.length;) {
    const size = b.readUInt32LE(at + 4), end = at + 8 + size;
    if (end > b.length) throw new Error('Truncated WAV chunk');
    const id = b.toString('ascii', at, at + 4);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Truncated WAV format');
      format = { type: b.readUInt16LE(at + 8), channels: b.readUInt16LE(at + 10),
        sampleRate: b.readUInt32LE(at + 12), align: b.readUInt16LE(at + 20), bits: b.readUInt16LE(at + 22) };
    } else if (id === 'data') data = b.subarray(at + 8, end);
    at = end + (size & 1);
  }
  if (!format || !data || format.type !== 1 || format.bits !== 16 || !format.channels ||
      !format.sampleRate || format.align !== format.channels * 2 || data.length % format.align) throw new Error('Expected aligned 16-bit PCM');
  const y = new Float32Array(data.length / format.align);
  for (let i = 0; i < y.length; i++) for (let ch = 0; ch < format.channels; ch++) {
    y[i] += data.readInt16LE(i * format.align + ch * 2) / 32768 / format.channels;
  }
  return { y, sampleRate: format.sampleRate, channels: format.channels };
}
