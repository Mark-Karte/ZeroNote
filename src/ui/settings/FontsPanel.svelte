<script lang="ts">
  import { settings, put } from '../../state/settings.svelte';
  import { appearance } from '../../theme/store.svelte';
  import {
    BUNDLED,
    EDITOR_SUGGESTIONS,
    firstAvailable,
    GENERIC,
    pixels,
    splitFamilies,
    UI_SUGGESTIONS,
    type ShownFont,
  } from '../../theme/fonts';
  import { installed } from '../font-check';

  /**
   * Шрифты интерфейса и редактора (задача 105).
   *
   * Настройка человека, а не темы (решение владельца): тема задаёт
   * умолчание, выбранное здесь его перекрывает и не меняется вместе
   * с темой. Под полем — то, что **на экране**, а не то, что записано:
   * записать можно шрифт, которого в системе нет, и тогда на экране
   * останется шрифт темы. Молча показать записанное значило бы соврать
   * ровно о том, ради чего сюда пришли.
   */

  const values = $derived(settings.state?.settings);
  const broken = $derived(settings.state?.broken ?? null);
  const tokens = $derived(appearance.current?.tokens ?? {});

  const PLACES = [
    {
      id: 'ui',
      title: 'Шрифт интерфейса',
      familyToken: 'font-family-ui',
      sizeToken: 'font-size-ui',
      min: 8,
      max: 32,
      suggestions: UI_SUGGESTIONS,
      sample: 'Параметры · Оформление · Съешь же ещё этих мягких булок',
    },
    {
      id: 'editor',
      title: 'Шрифт редактора',
      familyToken: 'font-family-editor',
      sizeToken: 'font-size-editor',
      min: 8,
      max: 48,
      suggestions: EDITOR_SUGGESTIONS,
      sample: 'fn main() { let O0 = "Il1|"; } // → ≠ ==',
    },
  ] as const;

  type Place = (typeof PLACES)[number];

  const SOURCE: Record<ShownFont['source'], string> = {
    bundled: 'вшит в приложение',
    system: 'есть в системе',
    generic: 'шрифт Windows по умолчанию',
  };

  /** Есть ли шрифт: вшитый и общее семейство есть всегда, прочее — меряем. */
  const present = (name: string): boolean =>
    BUNDLED.has(name) || GENERIC.has(name.toLowerCase()) || installed(name);

  function status(place: Place): { shown: ShownFont | null; missing: string | null; size: number | null } {
    const chosen = values?.font[place.id].family ?? null;
    const first = chosen ? (splitFamilies(chosen)[0] ?? null) : null;
    return {
      shown: firstAvailable(splitFamilies(tokens[place.familyToken] ?? ''), installed),
      missing: first && !present(first) ? first : null,
      size: pixels(tokens[place.sizeToken]),
    };
  }

  /** Пустое поле — «как в теме», то есть ключа в файле нет. */
  function setFamily(place: Place, text: string): void {
    const trimmed = text.trim();
    void put(['font', place.id, 'family'], trimmed === '' ? null : trimmed);
  }

  function setSize(place: Place, text: string): void {
    const trimmed = text.trim();
    if (trimmed === '') {
      void put(['font', place.id, 'size'], null);
      return;
    }
    const size = Number.parseInt(trimmed, 10);
    // Число вне разумного диапазона в файл не пойдёт: интерфейс со шрифтом
    // в два пикселя починить через этот же интерфейс уже не выйдет.
    if (Number.isFinite(size) && size >= place.min && size <= place.max) {
      void put(['font', place.id, 'size'], size);
    }
  }
</script>

{#if values}
  <section class="fonts">
    <h2 class="part-title">Шрифты</h2>

    {#each PLACES as place (place.id)}
      {@const now = status(place)}
      {@const own = values.font[place.id]}
      <div class="place">
        <div class="row">
          <div class="what">
            <span class="name">{place.title}</span>
            <span class="note">
              Пусто — из темы. Размер от {place.min} до {place.max} пикселей.
            </span>
          </div>
          <input
            class="field family"
            type="text"
            list="zn-fonts-{place.id}"
            disabled={broken !== null}
            value={own.family ?? ''}
            placeholder={now.shown ? `${now.shown.name} — из темы` : 'как в теме'}
            spellcheck="false"
            onchange={(e) => setFamily(place, e.currentTarget.value)}
          />
          <input
            class="field size"
            type="number"
            min={place.min}
            max={place.max}
            disabled={broken !== null}
            value={own.size ?? ''}
            placeholder={now.size !== null ? String(now.size) : ''}
            onchange={(e) => setSize(place, e.currentTarget.value)}
          />
          <datalist id="zn-fonts-{place.id}">
            {#each place.suggestions as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </div>

        {#if now.missing}
          <p class="state warning">
            «{now.missing}» в системе не нашёлся — на экране {now.shown?.name ?? 'шрифт по умолчанию'}.
          </p>
        {:else if now.shown}
          <p class="state">
            На экране: {now.shown.name}{now.size !== null ? `, ${now.size} px` : ''} — {SOURCE[now.shown.source]},
            {own.family || own.size ? 'выбран здесь' : 'из темы'}.
          </p>
        {/if}
        <p class="sample {place.id}">{place.sample}</p>
      </div>
    {/each}
  </section>
{/if}

<style>
  .fonts {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-4);
  }

  .part-title {
    margin: 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
    font-weight: var(--zn-font-weight-strong);
  }

  .place {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-1);
    flex: 1;
    min-width: 0;
  }

  .name {
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
  }

  .note {
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .field {
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
  }

  .field:focus {
    outline: none;
    border-color: var(--zn-color-border-focus);
  }

  .family {
    flex: 0 1 calc(var(--zn-control-theme-card-width) + var(--zn-space-6) * 2);
    min-width: 0;
  }

  .size {
    flex: none;
    width: calc(var(--zn-space-6) * 3);
  }

  .state {
    margin: 0;
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
  }

  .state.warning {
    color: var(--zn-color-warning);
  }

  /* Образец набран тем, что на экране, — токеном, а не записанным именем:
     вопрос «как это будет выглядеть» задают про экран. */
  .sample {
    margin: 0;
    padding: var(--zn-space-2) var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-raised);
    color: var(--zn-color-fg-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sample.ui {
    font-family: var(--zn-font-family-ui);
    font-size: var(--zn-font-size-ui);
  }

  .sample.editor {
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-editor);
  }
</style>
