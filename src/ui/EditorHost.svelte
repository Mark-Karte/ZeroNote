<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { undoDepth, redoDepth } from '@codemirror/commands';
  import { tabs, tabById, activeTab, languageOf } from '../state/tabs.svelte';
  import { setEditorView } from '../editor/current';
  import { canFold, canUnfold } from '../editor/folding';
  import { showMenu } from '../state/menu.svelte';
  import { editorMenu } from './menus';
  import { commandList } from '../keymap/global.svelte';
  import { runCommand } from '../keymap/registry';
  import '../editor/editor.css';

  let host: HTMLDivElement;
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
  function stash(id: number | null): void {
    if (!view || id === null) return;
    const tab = tabById(id);
    if (!tab) return;

    const state = view.state;
    const scrollTop = view.scrollDOM.scrollTop;
    // Запись в уходящую вкладку не должна становиться зависимостью эффекта:
    // иначе он вызовет сам себя.
    untrack(() => {
      tab.editor = state;
      tab.scrollTop = scrollTop;
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
    setEditorView(view);
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
    showMenu(
      event,
      editorMenu(
        {
          canUndo: undoDepth(state) > 0,
          canRedo: redoDepth(state) > 0,
          readOnly: state.readOnly,
          markdown: tab ? languageOf(tab)?.id === 'markdown' : false,
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
    if (!view || mounted === null) return;
    const tab = tabById(mounted);
    if (tab) {
      tab.scrollTop = view.scrollDOM.scrollTop;
    }
  }

  onDestroy(() => {
    stash(mounted);
    view?.scrollDOM.removeEventListener('scroll', onScroll);
    view?.destroy();
    view = null;
    setEditorView(null);
  });

  /**
   * Следим не только за сменой активной вкладки, но и за подменой её
   * состояния.
   *
   * Одной только `activeId` недостаточно, и это стоило дефекта: перечитывание
   * файла с диска и «интерпретировать как» подменяют `tab.editor`, не трогая
   * активную вкладку. Эффект, зависящий только от номера, такую подмену
   * не замечал — модель обновлялась, а на экране оставался прежний текст.
   *
   * Сравнение идёт по тождеству объекта состояния. Собственные правки
   * пользователя тоже проходят здесь, но там `tab.editor` и есть текущее
   * состояние представления, поэтому ничего не происходит.
   */
  $effect(() => {
    const id = tabs.activeId;
    const tab = id === null ? null : tabById(id);
    const wanted = tab ? tab.editor : null;

    if (!view) return;

    if (id !== mounted) {
      stash(mounted);
      mounted = id;
    }

    if (!wanted) {
      view.setState(EditorState.create({ doc: '' }));
      return;
    }

    if (view.state !== wanted) {
      view.setState(wanted);
      // Прокрутка выставляется после смены состояния: до неё содержимого
      // нужной высоты в разметке ещё нет и прокручивать некуда.
      view.scrollDOM.scrollTop = tab!.scrollTop;
      view.focus();
    }
  });
</script>

<!-- Предупреждение снято сознательно: правый щелчок не делает обёртку
     интерактивной. Внутри неё живёт область текста CodeMirror — она и есть
     то, что получает фокус и принимает клавиши, а меню лишь повторяет
     команды, у которых сочетания уже есть. Роль на обёртке была бы неправдой:
     сама по себе она ничего не делает. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" bind:this={host} oncontextmenu={onContextMenu}></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
