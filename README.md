# Falling Pickaxe ⛏

Казуальная физическая игра: кирка падает в шахту, ломает блоки, отскакивает, улучшается на верстаках,
взрывает TNT. Между забегами — улучшения, кузница, предметы и престиж.

Полный геймдизайн, математика и дорожная карта: **[GAME_DESIGN.md](GAME_DESIGN.md)**.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173 — открыть с телефона в той же сети или в мобильном режиме DevTools
npm test           # unit-тесты ядра
npm run sim        # headless-симуляция баланса: npm run sim -- 600 42
npm run build      # сборка в dist/
```

Управление: тап по левой/правой половине экрана (или ← →) — толчок; 💥 (или пробел) — динамит.

## Структура

| Папка | Что внутри |
|-------|------------|
| `src/game/` | Чистое ядро без DOM: блоки, биомы, генерация мира, физика, забег, экономика, сохранения, бот |
| `src/render/` | Canvas 2D-рендер, процедурные пиксельные текстуры, частицы |
| `src/audio/` | Синтез звуков WebAudio (без аудио-файлов) |
| `src/ui/` | Экраны, HUD, локализация RU/EN |
| `scripts/balance-sim.ts` | Симуляция прогрессии жадным ботом |
| `android/` | Нативный Android-проект (Capacitor) |

Весь баланс — в `src/game/config.ts` (+ HP/ценность блоков в `src/game/blocks.ts`).
После правок прогоняйте `npm run sim` и сверяйтесь с целями из раздела 5.6 дизайн-документа.

## Сборка под Android

Нужны Android Studio (JDK 21, Android SDK 35+).

```bash
npm run android:sync   # build + копирование в android/
npm run android:open   # открыть в Android Studio → Run на устройстве
```

Релиз в Google Play:
1. Поменять `appId` в `capacitor.config.json` (сейчас `com.fallingpickaxe.game`) на свой — после
   публикации изменить его нельзя.
2. Иконки и сплэш: `npx @capacitor/assets generate` (положить `assets/icon.png` 1024×1024).
3. Android Studio → *Build → Generate Signed App Bundle* → `.aab`; ключ подписи хранить вне репозитория.
4. Google Play Console: карточка, политика конфиденциальности, Data safety, рейтинг IARC,
   закрытый тест (≥ 12 тестировщиков × 14 дней для новых личных аккаунтов), затем продакшн.
5. Проверить актуальное требование Google Play к `targetSdkVersion` (`android/variables.gradle`).
