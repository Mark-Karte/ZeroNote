<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { undoDepth, redoDepth } from '@codemirror/commands';
  import { tabById, activeTab, languageOf, slotFor } from '../state/tabs.svelte';
  import { layout, paneById } from '../state/panes.svelte';
  import { setEditorView } from '../editor/current';
  import { canFold, canUnfold } from '../editor/folding';
  import { bookmarkedHere } from '../editor/bookmarks';
  import { invisiblesEnabled, readableWidthEnabled } from '../state/settings.svelte';
  import { readableColumn } from '../editor/readable';
  import { showMenu } from '../state/menu.svelte';
  import { editorMenu } from './menus';
  import { commandList } from '../keymap/global.svelte';
  import { runCommand } from '../keymap/registry';
  import '../editor/editor.css';

  /**
   * В какой области живёт это представление (Р-208).
   *
   * Представление одно на область, а не на окно, и показывает оно активную
   * вкладку своей области — не окна. Пока область одна, это одно и то же.
   */
  let { pane }: { pane: number } = $props();

  let host: HTMLDivElement;
  /**
   * Показывать ли текст колонкой по центру (Р-156).
   *
   * Класс на обёртке, а не расширение редактора: это оформление, и меняться
   * оно должно вместе с настройкой и с языком вкладки, не трогая состояние
   * и историю отмены.
   */
  const readable = $derived.by(() => {
    const tab = activeTab();
    return readableColumn({
      wrap: false,
      readableWidth: readableWidthEnabled(),
      markdown: tab ? languageOf(tab)?.id === 'markdown' : false,
    });
  });

  let view: EditorView | null = null;

  /**
   * Чьё состояние сейчас лежит в редакторе.
   *
   * Намеренно обычная переменная, а не руна: это служебная память, интерфейс
   * от неё не зависит, и делать её реактивной значило бы гонять лишний круг
   * пересчёта на каждом переключении вкладки.
   */
  let mounted: number | null = null;

  /**
   * Один экземпляр редактора на окно, состояния подменяются.
   *
   * По редактору на вкладку было бы проще, но десяток открытых файлов
   * означал бы десяток живых представлений с их обработчиками и измерениями.
   * Подмена состояния ничего не теряет: курсоры, прокрутка и история отмены
   * входят в `EditorState`, а не в представление.
   */
  /**
   * Куда эта область складывает состояние вкладки: в главное, если оно
   * её, иначе в своё зеркало (Р-209).
   */
  function slotOf(id: number | null) {
    if (id === null) return null;
    const editor = tabById(id)?.editor;
    if (!editor) return null;
    return editor.home === pane ? editor : (editor.mirrors[pane] ?? null);
  }

  function stash(id: number | null): void {
    if (!view) return;
    const slot = slotOf(id);
    if (!slot) return;

    const state = view.state;
    const scrollTop = view.scrollDOM.scrollTop;
    // Запись в уходящую вкладку не должна становиться зависимостью эффекта:
    // иначе он вызовет сам себя.
    untrack(() => {
      slot.state = state;
      slot.scrollTop = scrollTop;
    });
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({ doc: '' }),
      parent: host,
    });

    // Прокрутка не входит в EditorState, поэтому запоминается отдельно —
    // и для переключения вкладок, и для восстановления сессии.
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

    // Командам правки нужен доступ к редактору из обычного кода.
    setEditorView(pane, view);
  });

  /**
   * Контекстное меню области текста.
   *
   * Обработчик на обёртке, а не на содержимом CodeMirror: разметка внутри
   * пересоздаётся при каждой перерисовке, а эта обёртка живёт всё время
   * работы окна.
   */
  function onContextMenu(event: MouseEvent): void {
    if (!view) return;

    moveCaretToClick(view, event);

    const state = view.state;
    const tab = activeTab();
    // Глубина отмены — у главного состояния: у зеркала истории нет (Р-209),
    // а отменять из него можно.
    const history = tab?.editor?.state ?? state;
    showMenu(
      event,
      editorMenu(
        {
          canUndo: undoDepth(history) > 0,
          canRedo: redoDepth(history) > 0,
          readOnly: state.readOnly,
          markdown: tab ? languageOf(tab)?.id === 'markdown' : false,
          invisibles: invisiblesEnabled(),
          bookmarked: bookmarkedHere(state),
          canFold: canFold(state),
          canUnfold: canUnfold(state),
        },
        commandList(),
      ),
      runCommand,
    );
  }

  /**
   * Щелчок мимо выделения переносит курсор туда, где щёлкнули.
   *
   * Так ведёт себя всё в Windows: меню относится к месту вызова. Без этого
   * «перейти по ссылке под курсором» ушло бы по той ссылке, где курсор
   * остался с прошлого раза, — а пользователь показывал указателем совсем
   * на другую. Щелчок внутри выделения выделение сохраняет: иначе правый
   * щелчок по выделенному куску сбрасывал бы его перед «копировать».
   */
  function moveCaretToClick(target: EditorView, event: MouseEvent): void {
    const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;

    const inside = target.state.selection.ranges.some(
      (range) => !range.empty && pos >= range.from && pos <= range.to,
    );
    if (inside) return;

    target.dispatch({ selection: { anchor: pos } });
  }

  function onScroll(): void {
    if (!view) return;
    const slot = slotOf(mounted);
    if (slot) {
      slot.scrollTop = view.scrollDOM.scrollTop;
    }
  }

  onDestroy(() => {
    stash(mounted);
    view?.scrollDOM.removeEventListener('scroll', onScroll);
    view?.destroy();
    view = null;
    setEditorView(pane, null);
  });

  /**
   * Следим не только за сменой активной вкладки, но и за подменой её
   * состояния.
   *
   * Одной только `activeId` недостаточно, и это стоило дефекта: перечитывание
   * файла с диска и «интерпретировать как» подменяют состояние вкладки, не трогая
   * активную вкладку. Эффект, зависящий только от номера, такую подмену
   * не замечал — модель обновлялась, а на экране оставался прежний текст.
   *
   * Сравнение идёт по тождеству объекта состояния. Собственные правки
   * пользователя тоже проходят здесь, но там состояние вкладки и есть текущее
   * состояние представления, поэтому ничего не происходит.
   */
  $effect(() => {
    // Активная вкладка своей области, а не окна: соседняя область
    // показывает своё, и её фокус этому представлению не указ.
    const id = paneById(pane)?.active ?? null;
    const tab = id === null ? null : tabById(id);
    // У вкладки, которая не текст, состояния нет — но и этого компонента
    // над ней нет: рабочую область занимает её собственный экран.
    const editor = tab?.editor ?? null;

    // Зависимости эффекта называются явно: главное состояние, чья область
    // его держит, и зеркало этой области. Подмена любого из них обязана
    // сюда привести — а `slotFor` ниже ещё и создаёт зеркало, и такую
    // запись отслеживать нельзя, иначе эффект зовёт сам себя.
    if (editor) {
      void editor.state;
      void editor.home;
      void editor.mirrors[pane]?.state;
    }

    if (!view) return;

    if (id !== mounted) {
      stash(mounted);
      mounted = id;
    }

    if (!tab || !editor) {
      view.setState(EditorState.create({ doc: '' }));
      return;
    }

    const slot = untrack(() => slotFor(tab, pane));
    if (!slot) return;

    if (view.state !== slot.state) {
      view.setState(slot.state);
      // Прокрутка выставляется после смены состояния: до неё содержимого
      // нужной высоты в разметке ещё нет и прокручивать некуда.
      view.scrollDOM.scrollTop = slot.scrollTop;
      // Фокус — только активной области: соседняя, получив вкладку,
      // отняла бы клавиатуру у той, где человек печатает.
      if (untrack(() => layout.activePane) === pane) view.focus();
    }
  });
</script>

<!-- Предупреждение снято сознательно: правый щелчок не делает обёртку
     интерактивной. Внутри неё живёт область текста CodeMirror — она и есть
     то, что получает фокус и принимает клавиши, а меню лишь повторяет
     команды, у которых сочетания уже есть. Роль на обёртке была бы неправдой:
     сама по себе она ничего не делает. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="editor"
  class:zn-readable={readable}
  bind:this={host}
  oncontextmenu={onContextMenu}
></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
