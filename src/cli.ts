#!/usr/bin/env node
/**
 * เครื่องมือบรรทัดคำสั่งสำหรับอ่านบัตรประชาชน
 *
 * ค่าเริ่มต้นคือเฝ้ารอบัตรตลอดเวลา — เสียบบัตรกี่ใบก็อ่านต่อเนื่องโดยไม่ต้องรันใหม่
 */

import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { ThaiIdCardWatcher, readCardOnce } from './pcsc/reader.ts';
import type { ReadErrorReason } from './pcsc/reader.ts';
import type { ThaiIdCard } from './card/thai-id.ts';

/**
 * ชื่อคำสั่งที่จะแสดงในข้อความช่วยเหลือ
 *
 * ผู้ใช้ที่ติดตั้งจาก npm พิมพ์ `thai-id` ส่วนคนที่รันจากซอร์สพิมพ์ `node src/cli.ts`
 * การแสดงคำสั่งผิดทำให้คัดลอกไปใช้แล้วไม่ทำงาน
 */
const COMMAND = process.argv[1]?.endsWith('.ts') ? 'node src/cli.ts' : 'thai-id';

const USAGE = `
อ่านบัตรประชาชนไทยผ่านเครื่องอ่านสมาร์ทการ์ด

การใช้งาน:
  ${COMMAND} [ตัวเลือก]        เฝ้ารอบัตรตลอดเวลา (ค่าเริ่มต้น)
  ${COMMAND} --once             อ่านบัตรใบเดียวแล้วจบ

ตัวเลือก:
  --photo            อ่านรูปถ่ายจากบัตรด้วย (ช้าขึ้นประมาณ 1 วินาที)
  --out <ไฟล์>       บันทึกรูปถ่ายลงไฟล์ (ค่าเริ่มต้น: photo-<เลขบัตร>.jpg)
  --json             แสดงผลเป็น JSON บรรทัดเดียวต่อหนึ่งใบ (เหมาะกับการต่อท่อ)
  --once             อ่านใบเดียวแล้วออก แทนการเฝ้ารอตลอด
  --timeout <วินาที> เวลารอบัตรสูงสุดในโหมด --once (ค่าเริ่มต้น: 60)
  --quiet            แสดงเฉพาะผลการอ่าน ไม่แสดงสถานะระหว่างทาง
  --help             แสดงข้อความนี้
`.trim();

const { values } = parseArgs({
  options: {
    photo: { type: 'boolean', default: false },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '60' },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const includePhoto = values.photo || values.out !== undefined;

/** สถานะทั้งหมดออกทาง stderr เพื่อให้ stdout เหลือแต่ข้อมูลบัตรล้วน ๆ ต่อท่อได้ */
function status(message: string): void {
  if (!values.quiet) process.stderr.write(`${message}\n`);
}

function showProgress(step: string, percent: number): void {
  if (values.quiet || values.json) return;
  if (process.stderr.isTTY) process.stderr.write(`\r  ⏳ ${percent}%  ${step}`.padEnd(56));
  else process.stderr.write(`  ⏳ ${percent}%  ${step}\n`);
}

function clearProgress(): void {
  if (!values.quiet && !values.json && process.stderr.isTTY) {
    process.stderr.write(`\r${' '.repeat(56)}\r`);
  }
}

const REASON_TEXT: Record<ReadErrorReason, string> = {
  'not-thai-id': 'บัตรที่เสียบไม่ใช่บัตรประชาชนไทย',
  'card-removed': 'บัตรถูกดึงออกระหว่างอ่าน',
  'card-unresponsive': 'บัตรไม่ตอบสนอง (ลองถอดแล้วเสียบใหม่)',
  'corrupt-data': 'ข้อมูลที่อ่านมาเพี้ยน (เลขบัตรไม่ผ่านหลักตรวจสอบ)',
  timeout: 'บัตรไม่ตอบสนองภายในเวลาที่กำหนด — ถอดสาย USB ของเครื่องอ่านออกแล้วเสียบใหม่',
  unknown: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
};

async function present(card: ThaiIdCard): Promise<void> {
  clearProgress();

  let photoPath: string | null = null;
  if (card.photo) {
    photoPath = values.out ?? `photo-${card.cid}.jpg`;
    await writeFile(photoPath, card.photo);
  }

  if (values.json) {
    console.log(JSON.stringify({ ...card, photo: photoPath }));
    return;
  }

  const rows: [string, string][] = [
    ['เลขประจำตัวประชาชน', formatCid(card.cid)],
    ['ชื่อ-สกุล (ไทย)', joinName(card.titleTH, card.firstNameTH, card.middleNameTH, card.lastNameTH)],
    ['ชื่อ-สกุล (อังกฤษ)', joinName(card.titleEN, card.firstNameEN, card.middleNameEN, card.lastNameEN)],
    ['วันเกิด', card.birthDate ?? '-'],
    ['เพศ', { male: 'ชาย', female: 'หญิง', unknown: 'ไม่ระบุ' }[card.gender]],
    ['ที่อยู่', card.address ?? '-'],
    ['ผู้ออกบัตร', card.issuer ?? '-'],
    ['วันออกบัตร', card.issueDate ?? '-'],
    ['วันหมดอายุ', formatExpiry(card.expireDate)],
  ];
  if (photoPath) rows.push(['รูปถ่าย', `${photoPath} (${card.photo?.length} ไบต์)`]);

  const width = Math.max(...rows.map(([label]) => [...label].length));
  console.log('');
  for (const [label, value] of rows) {
    console.log(`  ${padThai(label, width)}  ${value}`);
  }
  console.log('');
}

/** padEnd นับ code unit ไม่ใช่จำนวนอักขระ ทำให้คอลัมน์ภาษาไทยเหลื่อม */
function padThai(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - [...text].length));
}

function joinName(title: string, first: string, middle: string, last: string): string {
  return [title, first, middle, last].filter((part) => part.length > 0).join(' ') || '-';
}

/** จัดรูปเป็น 1-2345-67890-12-3 ตามที่พิมพ์บนหน้าบัตร */
function formatCid(cid: string): string {
  if (cid.length !== 13) return cid;
  return `${cid[0]}-${cid.slice(1, 5)}-${cid.slice(5, 10)}-${cid.slice(10, 12)}-${cid[12]}`;
}

function formatExpiry(expireDate: string | null): string {
  if (!expireDate) return '-';
  return new Date(expireDate) < new Date() ? `${expireDate}  ⚠️  หมดอายุแล้ว` : expireDate;
}

async function runOnce(): Promise<void> {
  try {
    status('💳 กรุณาเสียบบัตรประชาชน...');
    const card = await readCardOnce({
      includePhoto,
      onProgress: ({ step, percent }) => showProgress(step, percent),
      timeoutMs: Number(values.timeout) * 1000,
    });
    await present(card);
  } catch (error) {
    clearProgress();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  }
}

function runForever(): void {
  const watcher = new ThaiIdCardWatcher({
    includePhoto,
    onProgress: ({ step, percent }) => showProgress(step, percent),
  });

  watcher.on('started', () => status('👀 เริ่มเฝ้ารอบัตร (กด Ctrl+C เพื่อออก)'));
  watcher.on('reader-connected', (name) => status(`🔌 เชื่อมต่อเครื่องอ่าน: ${name}`));
  watcher.on('reader-disconnected', (name) => status(`🔌 ถอดเครื่องอ่าน: ${name}`));
  watcher.on('card-inserted', () => status('💳 เสียบบัตรแล้ว'));
  watcher.on('card-removed', () => status('💳 ถอดบัตรออกแล้ว'));
  watcher.on('reading', () => status('📖 กำลังอ่านบัตร...'));
  watcher.on('progress', ({ step, percent }) => showProgress(step, percent));
  watcher.on('card', (card) => void present(card));

  watcher.on('read-error', (error, info) => {
    clearProgress();
    const detail = REASON_TEXT[info.reason];
    if (info.willRetry) {
      status(`⚠️  ${detail} — กำลังลองใหม่ (ครั้งที่ ${info.attempt})`);
    } else {
      console.error(`❌ อ่านบัตรไม่สำเร็จ: ${detail}`);
      if (info.reason === 'unknown') console.error(`   รายละเอียด: ${error.message}`);
      status('👀 กลับไปรอบัตรใบถัดไป');
    }
  });

  watcher.on('error', (error) => {
    clearProgress();
    console.error(`❌ ข้อผิดพลาดของระบบ: ${error.message}`);
  });

  const shutdown = () => {
    watcher.close();
    status('\n👋 หยุดเฝ้ารอแล้ว');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (values.once) {
  void runOnce();
} else {
  runForever();
}
