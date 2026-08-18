import { defineConfig } from 'tsup';

/**
 * tsup รับผิดชอบเฉพาะการแปลงเป็น JavaScript (ESM + CommonJS)
 *
 * ส่วนไฟล์ .d.ts สร้างด้วย tsc แยกต่างหาก เพราะ rollup-plugin-dts ที่ tsup ใช้
 * ต้องการ TypeScript API แบบ JavaScript ซึ่งเข้ากันไม่ได้กับ TypeScript 7 ที่เป็น native port
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node18',
  platform: 'node',
  // native addon ต้องให้ผู้ใช้ resolve เอง ห้ามรวมเข้าไปใน bundle
  external: ['@pokusew/pcsclite'],
});
