/**
 * เทสต์ระดับโปรเซสจริง
 *
 * มีบางอย่างที่เทสต์ในกระบวนการเดียวกันจับไม่ได้ เช่นการที่โปรแกรมจบเองโดยไม่ตั้งใจ
 * เพราะ vitest ค้าง event loop ไว้ให้อยู่แล้ว ต้องแยกโปรเซสออกไปจึงจะเห็น
 */
import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(projectRoot, 'src', 'cli.ts');

function runCli(args: string[]) {
  return spawn(process.execPath, [cli, ...args], { cwd: projectRoot });
}

describe('CLI ระดับโปรเซส', () => {
  test('--help ทำงานและจบด้วยรหัสสำเร็จ', async () => {
    const child = runCli(['--help']);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));

    const code = await new Promise((resolve) => child.on('exit', resolve));

    expect(code).toBe(0);
    expect(output).toContain('อ่านบัตรประชาชนไทย');
  });

  /**
   * กันการถดถอยที่เคยเกิดจริง: การเรียก unref บนตัวเริ่มอัตโนมัติ
   * ทำให้ไม่มีอะไรค้าง event loop โปรแกรมจึงจบทันทีโดยไม่ทันเริ่มเฝ้ารอ
   */
  test('โหมดเฝ้ารอต้องยังทำงานอยู่หลังผ่านไป 2 วินาที ไม่จบเอง', { timeout: 15_000 }, async () => {
    const child = runCli([]);
    let exited = false;
    child.on('exit', () => (exited = true));

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const stillRunning = !exited;

    child.kill('SIGKILL');
    expect(stillRunning).toBe(true);
  });

  test('โหมดเฝ้ารอแจ้งว่าเริ่มทำงานแล้วทาง stderr', { timeout: 15_000 }, async () => {
    const child = runCli([]);
    let output = '';
    child.stderr.on('data', (chunk) => (output += chunk));

    await new Promise((resolve) => setTimeout(resolve, 1500));
    child.kill('SIGKILL');

    expect(output).toContain('เริ่มเฝ้ารอบัตร');
  });

  test('ปิดตัวลงอย่างเรียบร้อยเมื่อได้รับ SIGTERM', { timeout: 15_000 }, async () => {
    const child = runCli([]);
    await new Promise((resolve) => setTimeout(resolve, 800));

    child.kill('SIGTERM');
    const code = await new Promise((resolve) => child.on('exit', resolve));

    expect(code).toBe(0);
  });
});
