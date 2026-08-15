<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
  function stash(): void {
    if (!view || mounted === null) return;
    const tab = tabById(mounted);
    if (tab) {
      tab.editor = view.state;
      tab.scrollTop = view.scrollDOM.scrollTop;
    }
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
    stash();
    view?.scrollDOM.removeEventListener('scroll', onScroll);
    view?.destroy();
    view = null;
  });

  $effect(() => {
    const id = tabs.activeId;
    if (!view || id === mounted) return;

    // Порядок важен: сначала сохранить состояние уходящей вкладки,
    // иначе правки последних секунд пропадут.
    stash();

    if (id === null) {
      mounted = null;
      view.setState(EditorState.create({ doc: '' }));
      return;
    }

    const tab = tabById(id);
    if (!tab) return;

    view.setState(tab.editor);
    mounted = id;
    // Прокрутка выставляется после смены состояния: до неё содержимого
    // нужной высоты в разметке ещё нет и прокручивать некуда.
    view.scrollDOM.scrollTop = tab.scrollTop;
    view.focus();
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
