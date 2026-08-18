/**
 * แปลงข้อมูลดิบจากบัตรประชาชนให้เป็นค่าที่ใช้งานได้
 *
 * ทุกฟังก์ชันในไฟล์นี้เป็น pure function — ไม่แตะเครื่องอ่านบัตร
 * จึงทดสอบได้ครบโดยไม่ต้องมีฮาร์ดแวร์
 */

export type Gender = 'male' | 'female' | 'unknown';

export type ParsedName = {
  title: string;
  firstName: string;
  middleName: string;
  lastName: string;
};

/** บัตรเก็บข้อความไทยเป็น TIS-620 ไม่ใช่ UTF-8 และเติมช่องว่าง/NUL ท้ายฟิลด์จนเต็มความยาว */
const tis620Decoder = new TextDecoder('tis-620');

export function decodeThaiText(buffer: Buffer): string {
  return tis620Decoder.decode(buffer).replace(/\u0000/g, '').trim();
}

/**
 * บัตรเก็บวันที่เป็น พ.ศ. รูปแบบ YYYYMMDD เช่น "25301231"
 * บางใบระบุเดือน/วันเป็น "00" เมื่อทราบแต่ปี — กรณีนั้นคืน null แทนการเดาค่า
 */
export function parseBuddhistDate(raw: string): string | null {
  const digits = raw.trim();
  if (!/^\d{8}$/.test(digits)) return null;

  const year = Number(digits.slice(0, 4)) - 543;
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));

  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * ตรวจกับปฏิทินจริง ไม่ใช่แค่ช่วง 1-31
 * ถ้าปล่อยผ่าน วันที่อย่าง 30 กุมภาพันธ์ จะหลุดออกไปเป็นข้อมูลที่ดูปกติแต่ใช้ไม่ได้
 */
function daysInMonth(year: number, month: number): number {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 0;
}

/**
 * ตรวจเลขประจำตัวประชาชนด้วยหลักตรวจสอบตัวสุดท้าย
 *
 * มีค่ามากกว่าการตรวจความยาวเฉย ๆ เพราะจับข้อมูลที่เพี้ยนจากการอ่านได้
 * ตอนพัฒนาเคยเจอบัตรคืนข้อมูลเลื่อนกันทั้งชุดโดยที่ทุกฟิลด์ยังดู "มีรูปแบบถูก" อยู่
 */
export function isValidThaiCid(cid: string): boolean {
  if (!/^\d{13}$/.test(cid)) return false;

  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(cid[index]) * (13 - index);
  }

  return (11 - (sum % 11)) % 10 === Number(cid[12]);
}

export function parseGender(raw: string): Gender {
  if (raw.trim() === '1') return 'male';
  if (raw.trim() === '2') return 'female';
  return 'unknown';
}

/**
 * ชื่อบนบัตรมาในรูป "คำนำหน้า#ชื่อ#ชื่อกลาง#นามสกุล"
 *
 * แต่ไว้ใจตำแหน่งตรง ๆ ไม่ได้ เพราะบัตรบางใบส่งมาแค่ 3 ช่องเมื่อไม่มีชื่อกลาง
 * (เช่น "นางสาว#สมหญิง#ใจงาม") การอ่านตามตำแหน่งจะทำให้นามสกุลกลายเป็นชื่อกลาง
 * จึงยึดหลักว่า "ช่องท้ายสุดที่มีข้อมูล คือนามสกุล" แล้วที่เหลือตรงกลางคือชื่อกลาง
 */
export function parseName(raw: string): ParsedName {
  const [title = '', ...rest] = raw.split('#').map((part) => part.trim());

  const lastIndex = rest.findLastIndex((part) => part.length > 0);
  if (lastIndex <= 0) {
    return { title, firstName: rest[0] ?? '', middleName: '', lastName: '' };
  }

  return {
    title,
    firstName: rest[0] ?? '',
    middleName: rest.slice(1, lastIndex).filter((part) => part.length > 0).join(' '),
    lastName: rest[lastIndex] ?? '',
  };
}

/** ที่อยู่คั่นด้วย # เช่นกัน (บ้านเลขที่#หมู่#ตรอก#ซอย#ถนน#ตำบล#อำเภอ#จังหวัด) ช่องที่ว่างต้องข้าม */
export function parseAddress(raw: string): string {
  return raw
    .split('#')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
}
