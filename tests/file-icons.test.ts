import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_EXTENSIONS } from '../src/actions/file-types';
import { kindOf } from '../src/icons/files';

/**
 * Значки типов файлов для проводника (задача 134, Р-302).
 *
 * Собирает их скрипт (`icons/files/make-file-icons.mjs`), а не сборка,
 * и лежат они в репозитории готовыми. Значит, разойтись со списком типов
 * и с видом файла в дереве они могут молча: добавили расширение —
 * а значка нет, и проводник покажет пустое место; перенесли тип из «прочего»
 * в «код» — а значок остался серым. Тест сверяет готовое с источником.
 */
const DIR = 'src-tauri/icons/files';
const NSH = readFileSync('src-tauri/installer/associations.nsh', 'utf8');
const CONF = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
  bundle: { resources: Record<string, string> };
};

/** Кадры, которые обязан держать каждый значок: ряд знака приложения плюс 20, 24, 40. */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

interface Frame {
  size: number;
  data: Buffer;
}

/** Разобрать `.ico`: каталог кадров и их байты. */
function frames(file: string): Frame[] {
  const bytes = readFileSync(`${DIR}/${file}`);
  expect(bytes.readUInt16LE(0), `${file}: не .ico`).toBe(0);
  expect(bytes.readUInt16LE(2), `${file}: не .ico`).toBe(1);
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    const size = bytes[at] === 0 ? 256 : bytes[at]!;
    const length = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    return { size, data: bytes.subarray(offset, offset + length) };
  });
}

const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8')) as Record<
  string,
  { kind: string; label: string | null }
>;

describe('значки типов файлов', () => {
  it('есть у каждого типа из списка ассоциаций, и лишних нет', () => {
    const icons = readdirSync(DIR)
      .filter((name) => name.endsWith('.ico'))
      .map((name) => name.slice(0, -4));
    expect(icons.sort()).toEqual([...TEXT_EXTENSIONS, 'document'].sort());
  });

  /** Вид — тот же, что красит дерево: иначе `.py` в проводнике серый, а в ZeroNote фиолетовый. */
  it('нарисованы видом файла из дерева', () => {
    for (const ext of TEXT_EXTENSIONS) {
      expect(manifest[ext]?.kind, `.${ext}`).toBe(kindOf(`x.${ext}`));
      expect(manifest[ext]?.label, `.${ext}`).toBeTruthy();
    }
  });

  it('держат все кадры: мелкие точечным рисунком, 256 — PNG', () => {
    for (const name of Object.keys(manifest)) {
      const own = frames(`${name}.ico`);
      expect(
        own.map((f) => f.size),
        name,
      ).toEqual(SIZES);
      for (const frame of own) {
        if (frame.size < 256) {
          // BITMAPINFOHEADER: размер заголовка 40, высота удвоена под маску.
          expect(frame.data.readUInt32LE(0), `${name} ${frame.size}`).toBe(40);
          expect(frame.data.readInt32LE(8), `${name} ${frame.size}`).toBe(frame.size * 2);
        } else {
          expect(frame.data.subarray(1, 4).toString('ascii'), name).toBe('PNG');
        }
      }
    }
  });

  /** Кадр 256 — с палитрой: полноцветный весит в разы больше, а LZMA сжатое не ужмёт. */
  it('кадр 256 — с палитрой', () => {
    for (const name of Object.keys(manifest)) {
      const png = frames(`${name}.ico`).find((f) => f.size === 256)!.data;
      // IHDR идёт первым: 8 байт подписи, 8 — длина и имя куска, 13 — данные.
      expect(png[8 + 8 + 9], name).toBe(3);
    }
  });

  it('у каждого типа в установщике есть название на двух языках', () => {
    // Русское и английское (задача 156): пишется одно — на языке установщика.
    const lines = [...NSH.matchAll(/!insertmacro \$\{ACTION\} "([^"]+)" "([^"]*)" "([^"]*)"/g)];
    expect(lines.map((m) => m[1]).sort()).toEqual([...TEXT_EXTENSIONS].sort());
    for (const m of lines) {
      expect(m[2], `.${m[1]}`).not.toBe('');
      expect(m[3], `.${m[1]}`).not.toBe('');
      expect(m[3], `.${m[1]}`).not.toMatch(/[\u0400-\u04FF]/);
    }
  });

  /**
   * Ключ расширения удаление снимает, только если он опустел: ключ, который
   * завёл наш список «Открыть с помощью» (`.bat`, `.kt`), уходит, а чужой,
   * где есть хоть одно значение, остаётся. Без `/ifempty` удаление ZeroNote
   * снесло бы чужие сопоставления.
   */
  it('ключ расширения удаляется только пустым', () => {
    const deletions = [...NSH.matchAll(/DeleteRegKey (\/\S+ )?HKCU "Software\\Classes\\\.\$\{EXT\}[^"]*"/g)];
    expect(deletions.length).toBeGreaterThan(0);
    for (const m of deletions) expect(m[1], m[0]).toBe('/ifempty ');
  });

  /** Установщик ищет значки там, куда их кладёт сборка. */
  it('лежат там, где их ищет установщик', () => {
    const target = CONF.bundle.resources['icons/files/*.ico'];
    expect(target).toBe('file-icons/');
    expect(NSH).toContain('!define ZN_ICONS "$INSTDIR\\file-icons"');
  });
});
