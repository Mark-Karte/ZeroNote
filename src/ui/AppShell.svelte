<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
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
  import Popup from './Popup.svelte';
  import SettingsScreen from './settings/SettingsScreen.svelte';
  import WelcomeScreen from './welcome/WelcomeScreen.svelte';
  import { settings, startSettings, wrapEnabled } from '../state/settings.svelte';
  import { searchFocusRequest } from '../state/project-search.svelte';
  import { tabs, restore, applyWrap } from '../state/tabs.svelte';
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
  import { installGlobalKeymap, loadKeymap, commandList } from '../keymap/global.svelte';
  import { contextMenu, hideMenu, showMenu } from '../state/menu.svelte';
  import { fieldMenu } from './menus';
  import {
    copyField,
    cutField,
    fieldSelection,
    isField,
    pasteField,
    selectAllField,
    type Field,
  } from '../actions/clipboard';

  let removeKeymap: (() => void) | null = null;
  let removeMenu: (() => void) | null = null;
  let unlistenDrop: UnlistenFn | null = null;
  let unlistenClose: UnlistenFn | null = null;
  let unlistenFocus: UnlistenFn | null = null;
  let unlistenTree: UnlistenFn | null = null;
  let unlistenIndex: UnlistenFn | null = null;
  let removeFollow: (() => void) | null = null;
  let dropActive = $state(false);

  /** О чём не удалось восстановить — показывается той же полосой, что и прочее. */
  const restoreNotices = $state<string[]>([]);

  // Перенос строк — общая настройка, а состояния вкладок создаются каждое
  // со своим набором расширений. Эффект здесь, а не в `state/settings`:
  // тот не должен знать про вкладки, иначе получится круг импортов.
  //
  // `untrack` обязателен: применение проходит по всем вкладкам и подменяет
  // им состояние редактора, то есть пишет ровно в то, что читает. Без него
  // эффект вызывает сам себя — и окно остаётся с недорисованным содержимым.
  $effect(() => {
    const wrap = wrapEnabled();
    untrack(() => applyWrap(wrap));
  });

  onMount(async () => {
    void startSettings();

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

    // Меню вебвью — «Назад», «Обновить», «Посмотреть код» — в редакторе
    // не означает ничего и закрывает собой то, что означало бы. Снимается
    // во всём окне и всегда, одной строкой на этапе перехвата: своё меню
    // показывают те места, которым есть что предложить, и до них событие
    // доходит уже без чужого меню.
    const suppress = (event: MouseEvent): void => event.preventDefault();

    // Поля ввода — панель поиска, палитра, диалог. Событие сюда доходит
    // только если ближе к цели меню не нашлось: те обработчики останавливают
    // распространение. Без этого правый щелчок в поле поиска не делал бы
    // ничего — а его там жмут чаще всего, чтобы вставить.
    const fieldOn = (event: MouseEvent): void => {
      const target = event.target;
      if (!isField(target)) {
        hideMenu();
        return;
      }
      showMenu(
        event,
        fieldMenu(
          { hasSelection: fieldSelection(target) !== '', readOnly: target.readOnly },
          commandList(),
        ),
        (id) => void pickInField(target, id),
      );
    };

    window.addEventListener('contextmenu', suppress, { capture: true });
    window.addEventListener('contextmenu', fieldOn);
    removeMenu = () => {
      window.removeEventListener('contextmenu', suppress, { capture: true });
      window.removeEventListener('contextmenu', fieldOn);
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

  /**
   * Пункты меню поля ввода делают то же, что одноимённые команды, но с полем,
   * а не с областью текста: `edit.copy` в реестре копирует из редактора.
   * Имена взяты те же, чтобы подпись и сочетание приходили из раскладки (Р-107).
   */
  async function pickInField(field: Field, id: string): Promise<void> {
    switch (id) {
      case 'edit.cut':
        await cutField(field);
        return;
      case 'edit.copy':
        await copyField(field);
        return;
      case 'edit.paste':
        await pasteField(field);
        return;
      case 'edit.select-all':
        selectAllField(field);
        return;
    }
  }

  onDestroy(() => {
    removeKeymap?.();
    removeMenu?.();
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

  <!-- Вкладки на уровне окна, а не над одним редактором: так они идут
       во всю ширину и не сдвигаются, когда открывается боковая панель. -->
  {#if tabs.items.length > 0}
    <TabStrip />
  {/if}

  <div class="body">
    <!-- Полоса значков теперь показывается всегда. До задачи 20 она появлялась
         вместе с первой папкой (Р-044): полоса с одним значком занимала место
         и ничего не объясняла. Теперь в ней всегда есть кнопка параметров,
         а меню у нас нет — без полосы до настроек нельзя было бы добраться
         иначе как сочетанием клавиш, о котором ещё надо знать. -->
    <IconStrip />
    {#if roots.sidebar}
      <Sidebar searchFocus={searchFocusRequest.value} />
    {/if}

    <div class="main panel">
      {#if settings.open}
        <!-- Параметры занимают рабочую область, а не заводят вкладку (Р-074):
             вкладка равна буферу, и на этом держатся сессия, черновики
             и вопрос при закрытии. -->
        <SettingsScreen />
      {:else if tabs.items.length > 0}
        <SearchPanel />
        <EditorHost />
      {:else}
        <WelcomeScreen />
      {/if}
    </div>
  </div>

  <StatusBar />
  <Modal />
  <Palette />

  <!-- Контекстное меню одно на окно и рисуется здесь, а не там, где вызвано:
       внутри прокручиваемой панели оно уезжало бы вместе с содержимым,
       а внутри блока с обрезкой пропадало бы под его краем. -->
  {#if contextMenu.open}
    <Popup
      items={contextMenu.open.items}
      at={contextMenu.open.at}
      onpick={(id) => {
        // Закрываем до выполнения: действие может открыть диалог,
        // и меню осталось бы висеть поверх него.
        const chosen = contextMenu.open;
        hideMenu();
        chosen?.pick(id);
      }}
      onclose={hideMenu}
    />
  {/if}
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Подложка окна. Видна она только в зазорах между панелями и по краям
       тела — но именно она делает панели панелями, а не областями,
       разделёнными линиями. */
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
     уезжает за нижний край окна. На этом однажды уже попались.

     Отступ и зазор одинаковые: панель не должна прилегать к краю окна
     плотнее, чем к соседней панели. */
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    gap: var(--zn-space-1);
    padding: var(--zn-space-1);
  }

  /*
   * Общий вид панели. Класс раздаётся снаружи, а не повторяется в каждом
   * компоненте: панелей уже четыре, и скругление, подогнанное в трёх местах
   * из четырёх, — это ровно тот дефект, который никто не замечает месяцами.
   *
   * :global нужен потому, что класс висит на элементе дочернего компонента:
   * Svelte иначе сочтёт правило неиспользуемым и выбросит его при сборке.
   */
  .body :global(.panel) {
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-lg);
    overflow: hidden;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    /* Рабочая область — самый ближний слой: панели стоят на подложке,
       а она лежит на панели. */
    background-color: var(--zn-color-bg-raised);
  }
</style>
