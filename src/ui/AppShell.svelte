<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';

  import TitleBar from './TitleBar.svelte';
  import TabStrip from './TabStrip.svelte';
  import EditorHost from './EditorHost.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import NoticeStrip from './NoticeStrip.svelte';
  import StatusBar from './StatusBar.svelte';
  import Modal from './Modal.svelte';
  import Sidebar from './sidebar/Sidebar.svelte';
  import IconStrip from './sidebar/IconStrip.svelte';
  import Palette from './palette/Palette.svelte';
  import { searchFocusRequest } from '../state/project-search.svelte';
  import { tabs, restore } from '../state/tabs.svelte';
  import { flushNow } from '../state/persist.svelte';
  import { roots, refresh as refreshRoots, rootProblems } from '../state/roots.svelte';
  import { refreshDirs } from '../state/tree.svelte';
  import { TREE_CHANGED } from '../ipc/tree';
  import { applyProgress, refreshProgress } from '../state/index.svelte';
  import { INDEX_PROGRESS, type IndexProgress } from '../ipc/index';
  import { forgetResolved } from '../editor/wikilinks';
  import { openDropped, closeAllTabs } from '../actions/files';
  import { checkExternalChanges } from '../actions/external';
  import { startupPaths } from '../ipc/files';
  import { installGlobalKeymap, loadKeymap } from '../keymap/global';

  let removeKeymap: (() => void) | null = null;
  let unlistenDrop: UnlistenFn | null = null;
  let unlistenClose: UnlistenFn | null = null;
  let unlistenFocus: UnlistenFn | null = null;
  let unlistenTree: UnlistenFn | null = null;
  let unlistenIndex: UnlistenFn | null = null;
  let removeFollow: (() => void) | null = null;
  let dropActive = $state(false);

  /** О чём не удалось восстановить — показывается той же полосой, что и прочее. */
  const restoreNotices = $state<string[]>([]);

  onMount(async () => {
    for (const problem of await loadKeymap()) {
      restoreNotices.push(problem);
    }
    removeKeymap = installGlobalKeymap((problems) => {
      // Правку keymap.toml показываем той же полосой: пользователь правит
      // файл руками и должен видеть, если ошибся.
      restoreNotices.length = 0;
      restoreNotices.push(...problems);
    });

    // Сессия восстанавливается до файлов из командной строки: если файл
    // уже был открыт в прошлый раз, он просто станет активным, а не откроется
    // второй вкладкой.
    const notices = await restore();
    for (const notice of notices) {
      restoreNotices.push(notice);
    }

    const paths = await startupPaths();
    if (paths.length > 0) {
      await openDropped(paths);
    }

    // Закрытие окна перехватывается: несохранённые буферы должны спросить,
    // а не исчезнуть. Событие приходит уже после того, как Windows решила
    // закрыть окно, поэтому закрытие нужно подтвердить вручную.
    unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (await closeAllTabs()) {
        await getCurrentWindow().destroy();
        return;
      }
      // Закрытие отменили — но всё, что успели напечатать, лучше сбросить
      // на диск прямо сейчас, не дожидаясь таймера.
      await flushNow();
    });

    // Файлы сверяются с диском при возвращении фокуса в окно: именно тогда
    // пользователь мог что-то сделать с ними в другой программе (Р-014).
    unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload }) => {
      if (!payload) return;
      void checkExternalChanges();
      // Тогда же перечитываются корни: zeronote.toml могли поправить в другой
      // программе, а пропавший сетевой диск — подключить обратно.
      void refreshRoots();
    });

    // Слежение за корнями: ядро присылает список папок, содержимое которых
    // могло измениться, а перечитываем мы только раскрытые.
    unlistenTree = await listen<string[]>(TREE_CHANGED, (event) => {
      void refreshDirs(event.payload);
    });

    // Ход индексации: состояние приходит событиями, а не опросом.
    unlistenIndex = await listen<IndexProgress>(INDEX_PROGRESS, (event) => {
      applyProgress(event.payload);
      // Индексация закончилась — висячая ссылка могла стать рабочей,
      // и наоборот. Запомненные ответы про ссылки больше не действительны.
      if (!event.payload.running) forgetResolved();
    });
    // Одно состояние на старте: индексация могла начаться до подписки.
    void refreshProgress();

    // Нажатый Ctrl подчёркивает ссылки под указателем: только тогда щелчок
    // и правда уведёт в другой файл. Признаком на корне, а не классом
    // на элементах, — модификатор глобален, и знать о нём должен CSS.
    const followOn = (event: KeyboardEvent) => {
      if (event.ctrlKey) document.documentElement.dataset.follow = '';
    };
    const followOff = (event: KeyboardEvent) => {
      if (!event.ctrlKey) delete document.documentElement.dataset.follow;
    };
    // Потеря фокуса окном не присылает keyup, и признак остался бы висеть.
    const followReset = () => delete document.documentElement.dataset.follow;

    window.addEventListener('keydown', followOn);
    window.addEventListener('keyup', followOff);
    window.addEventListener('blur', followReset);
    removeFollow = () => {
      window.removeEventListener('keydown', followOn);
      window.removeEventListener('keyup', followOff);
      window.removeEventListener('blur', followReset);
    };

    unlistenDrop = await getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        dropActive = true;
      } else if (event.payload.type === 'drop') {
        dropActive = false;
        void openDropped(event.payload.paths);
      } else {
        dropActive = false;
      }
    });
  });

  onDestroy(() => {
    removeKeymap?.();
    unlistenDrop?.();
    unlistenClose?.();
    unlistenFocus?.();
    unlistenTree?.();
    unlistenIndex?.();
    removeFollow?.();
  });
</script>

<div class="shell" class:drop={dropActive}>
  <TitleBar />
  <NoticeStrip extra={[...restoreNotices, ...rootProblems()]} />

  <div class="body">
    <!-- Полоса значков показывается тем, кто работает с папками: либо панель
         открыта, либо корень уже добавлен. Тому, кто правит одиночные файлы,
         постоянная полоса сбоку не нужна — этим ZeroNote и отличается от
         редактора, который умеет только проекты. -->
    {#if roots.sidebar || roots.items.length > 0}
      <IconStrip />
    {/if}
    {#if roots.sidebar}
      <Sidebar searchFocus={searchFocusRequest.value} />
    {/if}

    <div class="main">
      {#if tabs.items.length > 0}
        <TabStrip />
        <SearchPanel />
        <EditorHost />
      {:else}
        <main class="workarea">
          <p class="empty">Нет открытых файлов</p>
          <p class="hint">Ctrl+N — новый, Ctrl+O — открыть, либо перетащите файл сюда</p>
        </main>
      {/if}
    </div>
  </div>

  <StatusBar />
  <Modal />
  <Palette />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--zn-color-bg-canvas);
    /* Тонкая рамка вместо системной: окно без украшений сливается с фоном
       рабочего стола, особенно в светлой теме. */
    border: var(--zn-border-width) solid var(--zn-color-border-default);
  }

  .shell.drop {
    border-color: var(--zn-color-accent);
  }

  /* Панель и рабочая область — в строку. `min-height: 0` обязателен обоим:
     без него содержимое с прокруткой распирает строку и строка состояния
     уезжает за нижний край окна. На этом однажды уже попались. */
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .workarea {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--zn-space-2);
    min-height: 0;
  }

  .empty {
    margin: 0;
    color: var(--zn-color-fg-subtle);
  }

  .hint {
    margin: 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
