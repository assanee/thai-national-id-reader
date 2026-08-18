/**
 * ตีความบิตสถานะของ PC/SC ว่าหมายถึงเหตุการณ์อะไร
 *
 * แยกเป็น pure function เพราะเป็นจุดที่พลาดง่ายที่สุดในชั้นฮาร์ดแวร์
 * และเป็นจุดเดียวที่ทดสอบได้โดยไม่ต้องมีเครื่องอ่านจริง
 */

/** ค่าคงที่ของ PC/SC ตรงตามที่ pcsclite ให้มา */
export const STATE = {
  CHANGED: 0x0002,
  EMPTY: 0x0010,
  PRESENT: 0x0020,
  INUSE: 0x0100,
  MUTE: 0x0200,
} as const;

export type CardEvent = 'inserted' | 'removed' | 'none';

/**
 * เทียบสถานะเดิมกับสถานะใหม่แล้วบอกว่าเกิดอะไรขึ้นกับบัตร
 *
 * previous เป็น undefined ได้ เพราะ pcsclite ตั้งค่า reader.state หลังยิง event
 * event แรกสุดจึงไม่มีสถานะเดิมให้เทียบ — ถ้าตอนนั้นมีบัตรอยู่ต้องถือว่า "เพิ่งเสียบ"
 * ไม่งั้นบัตรที่ค้างอยู่ในเครื่องก่อนโปรแกรมเริ่มจะไม่ถูกตรวจเจอเลย
 */
export function interpretStatusChange(previous: number | undefined, current: number): CardEvent {
  const wasPresent = previous === undefined ? false : Boolean(previous & STATE.PRESENT);
  const isPresent = Boolean(current & STATE.PRESENT);

  if (isPresent && !wasPresent) return 'inserted';
  if (!isPresent && wasPresent) return 'removed';
  return 'none';
}
