#!/usr/bin/env node
/**
 * ตรวจว่าแพ็กเกจที่จะเผยแพร่ใช้งานได้จริงหลังติดตั้ง
 *
 * เทสต์ปกติรันบนซอร์ส จึงจับปัญหาที่เกิดตอน "แพ็กแล้วติดตั้ง" ไม่ได้เลย เช่น
 * exports ชี้ผิดไฟล์ ไฟล์ที่จำเป็นไม่ถูกใส่ใน files หรือ type ที่ผู้ใช้มองไม่เห็น
 *
 * ขั้นตอน: build → pack → ติดตั้งในโฟลเดอร์ชั่วคราว → ลอง import ทุกรูปแบบ
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = mkdtempSync(join(tmpdir(), 'verify-package-'));

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const checks = [];
const record = (name, fn) => {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, detail: (error.stdout || '') + (error.stderr || error.message) });
  }
};

try {
  console.log('📦 กำลัง build และแพ็ก...');
  run('npm', ['run', 'build'], projectRoot);
  const packOutput = run('npm', ['pack', '--pack-destination', sandbox, '--json'], projectRoot);
  const tarball = join(sandbox, JSON.parse(packOutput)[0].filename);

  writeFileSync(
    join(sandbox, 'package.json'),
    JSON.stringify({ name: 'verify-consumer', version: '1.0.0', type: 'module' }),
  );
  console.log('📥 กำลังติดตั้งลงโฟลเดอร์ชั่วคราว...');
  run('npm', ['install', '--no-audit', '--no-fund', tarball], sandbox);

  record('import แบบ ESM ได้ และฟังก์ชันทำงานจริง', () => {
    writeFileSync(
      join(sandbox, 'a.mjs'),
      `import { isValidThaiCid, ThaiIdCardWatcher, readThaiIdCard } from 'thai-national-id-reader';
       if (typeof readThaiIdCard !== 'function') throw new Error('readThaiIdCard หาย');
       if (typeof ThaiIdCardWatcher !== 'function') throw new Error('ThaiIdCardWatcher หาย');
       if (isValidThaiCid('1111111111119') !== true) throw new Error('หลักตรวจสอบคำนวณผิด');
       if (isValidThaiCid('1111111111118') !== false) throw new Error('ไม่ปฏิเสธเลขที่ผิด');`,
    );
    run(process.execPath, ['a.mjs'], sandbox);
  });

  record('require แบบ CommonJS ได้ และฟังก์ชันทำงานจริง', () => {
    writeFileSync(
      join(sandbox, 'b.cjs'),
      `const { isValidThaiCid, readThaiIdCard } = require('thai-national-id-reader');
       if (typeof readThaiIdCard !== 'function') throw new Error('readThaiIdCard หาย');
       if (isValidThaiCid('1111111111119') !== true) throw new Error('หลักตรวจสอบคำนวณผิด');`,
    );
    run(process.execPath, ['b.cjs'], sandbox);
  });

  record('TypeScript อ่าน type ได้ครบภายใต้ strict mode', () => {
    run('npm', ['install', '--no-audit', '--no-fund', '-D', 'typescript', '@types/node'], sandbox);
    writeFileSync(
      join(sandbox, 'c.ts'),
      `import { ThaiIdCardWatcher, type ThaiIdCard, type ReadErrorReason } from 'thai-national-id-reader';
       const w = new ThaiIdCardWatcher({ includePhoto: true, retryAttempts: 3 });
       w.on('card', (card: ThaiIdCard) => { const n: string = card.firstNameTH; void n; });
       w.on('read-error', (_e, info) => { const r: ReadErrorReason = info.reason; void r; });
       w.on('progress', ({ percent }) => { const p: number = percent; void p; });`,
    );
    writeFileSync(
      join(sandbox, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'ES2023',
          strict: true,
          types: ['node'],
          noEmit: true,
        },
        include: ['c.ts'],
      }),
    );
    run(join(sandbox, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], sandbox);
  });

  record('คำสั่ง thai-id ทำงานและแสดงชื่อคำสั่งที่ถูกต้อง', () => {
    const help = run(join(sandbox, 'node_modules', '.bin', 'thai-id'), ['--help'], sandbox);
    if (!help.includes('thai-id [ตัวเลือก]')) {
      throw new Error(`ข้อความช่วยเหลือบอกคำสั่งผิด:\n${help.split('\n').slice(0, 6).join('\n')}`);
    }
    if (help.includes('src/cli.ts')) throw new Error('ยังอ้างถึงไฟล์ในซอร์สอยู่');
  });

  record('ไม่มีซอร์สหรือเทสต์หลุดไปกับแพ็กเกจ', () => {
    const listed = run('npm', ['pack', '--dry-run', '--json'], projectRoot);
    const files = JSON.parse(listed)[0].files.map((f) => f.path);
    const leaked = files.filter((f) => f.startsWith('src/') || f.startsWith('tests/'));
    if (leaked.length > 0) throw new Error(`ไฟล์ที่ไม่ควรเผยแพร่หลุดไป: ${leaked.join(', ')}`);
  });

  record('native addon ไม่ถูกรวมเข้า bundle', () => {
    const files = JSON.parse(run('npm', ['pack', '--dry-run', '--json'], projectRoot))[0].files;
    const oversized = files.filter((f) => f.path.endsWith('.js') && f.size > 200_000);
    if (oversized.length > 0) {
      throw new Error(`ไฟล์ใหญ่ผิดปกติ อาจ bundle native เข้าไป: ${oversized.map((f) => f.path)}`);
    }
  });
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log('');
for (const check of checks) {
  console.log(`  ${check.ok ? '✅' : '❌'} ${check.name}`);
  if (!check.ok) console.log(`     ${check.detail.trim().split('\n').slice(0, 5).join('\n     ')}`);
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${failed === 0 ? '✅ แพ็กเกจพร้อมเผยแพร่' : `❌ ไม่ผ่าน ${failed} ข้อ`}\n`);
process.exit(failed === 0 ? 0 : 1);
