/**
 * ตำแหน่งข้อมูลบนบัตรประชาชนไทย
 *
 * ไฟล์นี้เป็นข้อมูลล้วน ไม่มี logic โดยตั้งใจ — บัตรบางรุ่นอาจวาง offset ต่างไปเล็กน้อย
 * เมื่อเจอบัตรที่อ่านไม่ได้ ให้แก้ที่ตารางนี้จุดเดียวโดยไม่ต้องแตะโค้ดอ่านบัตร
 */

export type FieldSpec = { offset: number; length: number };

export const FIELDS = {
  /** เลขประจำตัวประชาชน 13 หลัก */
  cid: { offset: 0x0004, length: 0x0d },

  /**
   * ชื่อไทย ชื่ออังกฤษ วันเกิด และเพศ วางติดกันเป็นบล็อกเดียว 209 ไบต์
   * อ่านรวดเดียวแทนการยิง 4 คำสั่ง เพราะการส่ง APDU แต่ละครั้งช้ากว่าการ slice buffer มาก
   */
  person: { offset: 0x0011, length: 0xd1 },

  /** หน่วยงานที่ออกบัตร */
  issuer: { offset: 0x00f6, length: 0x64 },

  /** วันออกบัตร (พ.ศ. รูปแบบ YYYYMMDD) */
  issueDate: { offset: 0x0167, length: 0x08 },

  /** วันหมดอายุ (พ.ศ. รูปแบบ YYYYMMDD) */
  expireDate: { offset: 0x016f, length: 0x08 },

  /** ที่อยู่ตามทะเบียนบ้าน */
  address: { offset: 0x1579, length: 0x64 },
} as const satisfies Record<string, FieldSpec>;

/** ตำแหน่งของแต่ละส่วนภายในบล็อก person ข้างบน (นับจากต้นบล็อก) */
export const PERSON_LAYOUT = {
  fullNameTH: { start: 0, end: 100 },
  fullNameEN: { start: 100, end: 200 },
  birthDate: { start: 200, end: 208 },
  gender: { start: 208, end: 209 },
} as const;

/**
 * รูปถ่ายเก็บเป็น JPEG แบ่งเป็น 20 บล็อก บล็อกละ 255 ไบต์
 * เพราะ APDU หนึ่งคำสั่งส่งข้อมูลกลับได้สูงสุด 255 ไบต์
 */
export const PHOTO = {
  offset: 0x017b,
  chunkLength: 0xff,
  chunkCount: 20,
} as const;
