import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Относительные пути — нужны для Capacitor (этап 8)
  base: './',
  // Phaser сам по себе весит ~1.2 МБ — это ожидаемо
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
