/**
 * ชนิดของข้อผิดพลาดที่แยกจากกันชัดเจน
 *
 * เหตุผลที่ไม่ใช้ Error เปล่า: ผู้เรียกต้องตัดสินใจต่างกันในแต่ละกรณี
 * เช่น CardRemovedError ควรกลับไปรอบัตรใบใหม่ ส่วน NotThaiIdCardError ควรแจ้งผู้ใช้ให้เปลี่ยนบัตร
 */

export class ThaiIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** บัตรตอบกลับด้วย status word ที่ไม่ใช่ 0x9000 หรือคำตอบผิดรูปแบบ */
export class ApduError extends ThaiIdError {
  readonly statusWord: number | undefined;

  constructor(message: string, statusWord?: number) {
    super(statusWord === undefined ? message : `${message} (SW=0x${statusWord.toString(16).padStart(4, '0')})`);
    this.statusWord = statusWord;
  }
}

/** เลือก applet ไม่สำเร็จ — บัตรที่เสียบน่าจะไม่ใช่บัตรประชาชนไทย */
export class NotThaiIdCardError extends ThaiIdError {
  constructor() {
    super('บัตรที่เสียบไม่ใช่บัตรประชาชนไทย (เลือก applet ไม่สำเร็จ)');
  }
}

/** บัตรถูกดึงออกระหว่างอ่าน — ยกเลิกรอบนี้แล้วกลับไปรอบัตรใบใหม่ */
export class CardRemovedError extends ThaiIdError {
  constructor() {
    super('บัตรถูกดึงออกระหว่างกำลังอ่าน');
  }
}

/**
 * ข้อมูลที่อ่านมาไม่สมเหตุสมผล เช่นเลขบัตรไม่ผ่านหลักตรวจสอบ
 *
 * มักแปลว่าคำตอบจากบัตรเลื่อนกัน ไม่ใช่ว่าบัตรเสีย — ลองอ่านใหม่มักได้ผล
 */
export class CorruptCardDataError extends ThaiIdError {
  constructor(detail: string) {
    super(`ข้อมูลที่อ่านจากบัตรไม่สมเหตุสมผล: ${detail}`);
  }
}

/** ไม่พบเครื่องอ่านบัตรที่เชื่อมต่ออยู่ */
export class NoReaderError extends ThaiIdError {
  constructor() {
    super('ไม่พบเครื่องอ่านบัตร กรุณาเสียบเครื่องอ่านแล้วลองใหม่');
  }
}
