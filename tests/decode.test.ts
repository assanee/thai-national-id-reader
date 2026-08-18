import { describe, expect, test } from 'vitest';
import {
  decodeThaiText,
  parseBuddhistDate,
  parseGender,
  parseName,
  parseAddress,
} from '../src/card/decode.ts';
import { fixedField, tis620 } from './helpers.ts';

describe('decodeThaiText', () => {
  test('ถอดรหัสไบต์ TIS-620 เป็นข้อความไทย', () => {
    expect(decodeThaiText(tis620('สมชาย'))).toBe('สมชาย');
  });

  test('ตัดช่องว่างที่บัตรเติมท้ายฟิลด์ออก', () => {
    expect(decodeThaiText(fixedField('ใจดี', 100))).toBe('ใจดี');
  });

  test('ตัดไบต์ NUL ที่บัตรบางรุ่นเติมมาออก', () => {
    expect(decodeThaiText(Buffer.concat([tis620('ทดสอบ'), Buffer.alloc(5, 0x00)]))).toBe('ทดสอบ');
  });
});

describe('parseBuddhistDate', () => {
  test('แปลงปี พ.ศ. เป็นวันที่รูปแบบ ISO', () => {
    expect(parseBuddhistDate('25301231')).toBe('1987-12-31');
  });

  test('คืน null เมื่อบัตรระบุเดือนหรือวันเป็น 00 (ข้อมูลไม่ครบ)', () => {
    expect(parseBuddhistDate('25300000')).toBeNull();
  });

  test('คืน null เมื่อความยาวไม่ใช่ 8 หลัก', () => {
    expect(parseBuddhistDate('2530')).toBeNull();
    expect(parseBuddhistDate('')).toBeNull();
  });
});

describe('parseGender', () => {
  test('รหัส 1 คือชาย และ 2 คือหญิง', () => {
    expect(parseGender('1')).toBe('male');
    expect(parseGender('2')).toBe('female');
  });

  test('รหัสอื่นถือว่าไม่ระบุ', () => {
    expect(parseGender('')).toBe('unknown');
  });
});

describe('parseName', () => {
  test('แยกคำนำหน้า ชื่อ และนามสกุล จากรูปแบบที่คั่นด้วย #', () => {
    expect(parseName('นาย#สมชาย##ใจดี')).toEqual({
      title: 'นาย',
      firstName: 'สมชาย',
      middleName: '',
      lastName: 'ใจดี',
    });
  });

  test('เก็บชื่อกลางไว้เมื่อบัตรมีระบุ', () => {
    expect(parseName('Mr.#Somchai#Ratana#Jaidee')).toEqual({
      title: 'Mr.',
      firstName: 'Somchai',
      middleName: 'Ratana',
      lastName: 'Jaidee',
    });
  });

  test('รับมือฟิลด์ว่างโดยไม่ throw', () => {
    expect(parseName('')).toEqual({ title: '', firstName: '', middleName: '', lastName: '' });
  });

  test('บัตรที่ส่งมาแค่ 3 ช่อง ต้องอ่านช่องสุดท้ายเป็นนามสกุล ไม่ใช่ชื่อกลาง', () => {
    expect(parseName('นางสาว#สมหญิง#ใจงาม')).toEqual({
      title: 'นางสาว',
      firstName: 'สมหญิง',
      middleName: '',
      lastName: 'ใจงาม',
    });
  });

  test('ช่องท้ายที่ว่างไม่ทำให้นามสกุลหาย', () => {
    expect(parseName('นาย#สมชาย##ใจดี#')).toMatchObject({
      firstName: 'สมชาย',
      lastName: 'ใจดี',
    });
  });
});

describe('parseAddress', () => {
  test('ประกอบที่อยู่จากฟิลด์ย่อยที่คั่นด้วย # โดยข้ามช่องว่าง', () => {
    expect(parseAddress('99/1###ซอยสุขุมวิท 5#ถนนสุขุมวิท#ตำบลคลองเตย#อำเภอคลองเตย#จังหวัดกรุงเทพมหานคร'))
      .toBe('99/1 ซอยสุขุมวิท 5 ถนนสุขุมวิท ตำบลคลองเตย อำเภอคลองเตย จังหวัดกรุงเทพมหานคร');
  });

  test('คืนสตริงว่างเมื่อไม่มีข้อมูล', () => {
    expect(parseAddress('#####')).toBe('');
  });
});
