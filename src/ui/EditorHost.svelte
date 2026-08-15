<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { tabs, tabById } from '../state/tabs.svelte';
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
  });

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

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
