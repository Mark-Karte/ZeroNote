import type { LanguageSupport } from '@codemirror/language';

/**
 * Реестр языков подсветки.
 *
 * **Языки грузятся по требованию.** Открыли `.md` — приехал разбор markdown,
 * и только он. Иначе в стартовый пакет попали бы парсеры всех языков сразу,
 * а это прямой удар по холодному старту. `import()` внутри загрузчика Vite
 * превращает в отдельный кусок, который скачивается в момент первого вызова.
 *
 * Список ролей общий: «ключевое слово», а не «ключевое слово Rust». Цвета
 * задаются токенами темы — см. `theme/syntax.ts` и решение Р-047.
 */

export interface Language {
  id: string;
  /** Что показывать в строке состояния. */
  label: string;
  /** Расширения файлов без точки, в нижнем регистре. */
  extensions: string[];
  /** Имена файлов целиком — для тех, у кого расширения нет. */
  filenames?: string[];
  load: () => Promise<LanguageSupport>;
}

/**
 * Простые языки без своего Lezer-пакета берутся из `legacy-modes`: один пакет
 * на десяток языков. Разбор там построчный, без дерева, — для подсветки этого
 * достаточно, а для структурного разбора эти языки нам и не нужны.
 */
async function legacy(name: string): Promise<LanguageSupport> {
  const { StreamLanguage, LanguageSupport: Support } = await import(
    '@codemirror/language'
  );

  const mode = async () => {
    switch (name) {
      case 'toml':
        return (await import('@codemirror/legacy-modes/mode/toml')).toml;
      case 'yaml':
        return (await import('@codemirror/legacy-modes/mode/yaml')).yaml;
      case 'ini':
        return (await import('@codemirror/legacy-modes/mode/properties')).properties;
      case 'sql':
        return (await import('@codemirror/legacy-modes/mode/sql')).standardSQL;
      case 'shell':
        return (await import('@codemirror/legacy-modes/mode/shell')).shell;
      case 'powershell':
        return (await import('@codemirror/legacy-modes/mode/powershell')).powerShell;
      case 'lua':
        return (await import('@codemirror/legacy-modes/mode/lua')).lua;
      default:
        throw new Error(`неизвестный язык из legacy-modes: ${name}`);
    }
  };

  // Оборачиваем в LanguageSupport: так все загрузчики реестра возвращают
  // одно и то же, и разбор markdown может звать их наравне с остальными.
  return new Support(StreamLanguage.define(await mode()));
}

export const LANGUAGES: Language[] = [
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['md', 'markdown', 'mdx'],
    load: async () => {
      const [
        { markdown, markdownLanguage },
        { languages },
        { codeBlocks },
        { LanguageSupport },
      ] = await Promise.all([
        import('@codemirror/lang-markdown'),
        import('./markdown-code'),
        import('./code-blocks'),
        import('@codemirror/language'),
      ]);
      // Код внутри блоков подсвечивается своим языком: в заметках
      // разработчика блоки кода — обычное дело, и без подсветки они
      // выглядят чужеродно.
      const md = markdown({ base: markdownLanguage, codeLanguages: languages });
      // Оформление блоков едет вместе с разбором markdown, а не в общем наборе
      // расширений: в файле `.rs` весь текст и так код, выделять в нём нечего.
      return new LanguageSupport(md.language, [md.support, codeBlocks()]);
    },
  },
  {
    id: 'cpp',
    label: 'C / C++',
    extensions: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'ino'],
    load: async () => (await import('@codemirror/lang-cpp')).cpp(),
  },
  {
    id: 'rust',
    label: 'Rust',
    extensions: ['rs'],
    load: async () => (await import('@codemirror/lang-rust')).rust(),
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    extensions: ['js', 'mjs', 'cjs'],
    load: async () => (await import('@codemirror/lang-javascript')).javascript(),
  },
  {
    id: 'jsx',
    label: 'JSX',
    extensions: ['jsx'],
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    extensions: ['ts', 'mts', 'cts'],
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  },
  {
    id: 'tsx',
    label: 'TSX',
    extensions: ['tsx'],
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
        jsx: true,
      }),
  },
  {
    id: 'python',
    label: 'Python',
    extensions: ['py', 'pyw', 'pyi'],
    load: async () => (await import('@codemirror/lang-python')).python(),
  },
  {
    id: 'json',
    label: 'JSON',
    extensions: ['json', 'jsonc', 'webmanifest'],
    load: async () => (await import('@codemirror/lang-json')).json(),
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['html', 'htm', 'xhtml'],
    load: async () => (await import('@codemirror/lang-html')).html(),
  },
  {
    id: 'css',
    label: 'CSS',
    extensions: ['css'],
    load: async () => (await import('@codemirror/lang-css')).css(),
  },
  {
    id: 'xml',
    label: 'XML',
    extensions: ['xml', 'svg', 'xsl', 'xsd'],
    load: async () => (await import('@codemirror/lang-xml')).xml(),
  },
  {
    id: 'toml',
    label: 'TOML',
    extensions: ['toml'],
    load: () => legacy('toml'),
  },
  {
    id: 'yaml',
    label: 'YAML',
    extensions: ['yaml', 'yml'],
    load: () => legacy('yaml'),
  },
  {
    id: 'ini',
    label: 'INI',
    extensions: ['ini', 'cfg', 'conf', 'properties'],
    filenames: ['.editorconfig', '.gitconfig'],
    load: () => legacy('ini'),
  },
  {
    id: 'sql',
    label: 'SQL',
    extensions: ['sql'],
    load: () => legacy('sql'),
  },
  {
    id: 'shell',
    label: 'Shell',
    extensions: ['sh', 'bash', 'zsh'],
    load: () => legacy('shell'),
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    extensions: ['ps1', 'psm1', 'psd1'],
    load: () => legacy('powershell'),
  },
  {
    id: 'lua',
    label: 'Lua',
    extensions: ['lua'],
    load: () => legacy('lua'),
  },
];

const BY_ID = new Map(LANGUAGES.map((lang) => [lang.id, lang]));

/**
 * Язык по имени файла.
 *
 * Незнакомое расширение — обычный текст без подсветки, а не догадка по
 * содержимому: неверная подсветка хуже отсутствующей, потому что врёт про
 * структуру. Пользователь может выбрать язык вручную в строке состояния.
 */
export function languageForFile(name: string | null): Language | null {
  if (!name) return null;

  const lower = name.toLowerCase();
  const byName = LANGUAGES.find((lang) => lang.filenames?.includes(lower));
  if (byName) return byName;

  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return null;

  const ext = lower.slice(dot + 1);
  return LANGUAGES.find((lang) => lang.extensions.includes(ext)) ?? null;
}

export function languageById(id: string | null): Language | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}
