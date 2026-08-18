/**
 * เข้ารหัสข้อความไทยเป็น TIS-620 — ใช้ในเทสต์เท่านั้น
 * เพื่อสร้าง buffer จำลองแบบที่บัตรจริงส่งกลับมา โดยไม่ต้องฮาร์ดโค้ด hex
 * TIS-620 วางอักขระไทย U+0E01..U+0E5B ไว้ที่ไบต์ 0xA1..0xFB (บวก offset 0xA0)
 */
export function tis620(text: string): Buffer {
  const bytes = [...text].map((ch) => {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) return cp;
    if (cp >= 0x0e01 && cp <= 0x0e5b) return cp - 0x0e00 + 0xa0;
    throw new Error(`อักขระ ${ch} (U+${cp.toString(16)}) ไม่มีใน TIS-620`);
  });
  return Buffer.from(bytes);
}

/** จำลองฟิลด์บนบัตรที่มีความยาวคงที่ (บัตรจริงเติมช่องว่างท้ายจนเต็ม) */
export function fixedField(text: string, length: number): Buffer {
  const encoded = tis620(text);
  const padded = Buffer.alloc(length, 0x20);
  encoded.copy(padded, 0, 0, Math.min(encoded.length, length));
  return padded;
}
