import {
  Annotation,
  EditorState,
  Transaction,
  type Extension,
  type StateEffect,
  type TransactionSpec,
} from '@codemirror/state';
import { clearBookmarksEffect, toggleBookmarkEffect } from './bookmarks';

/**
 * Зеркала: один буфер в нескольких областях (Р-209).
 *
 * У буфера одно **главное** состояние — с историей отмены, закладками,
 * языком — и сколько угодно зеркал: тот же текст, свои курсоры, своя
 * прокрутка, своя свёртка. Правки ходят между ними транзакциями, история
 * живёт только в главном.
 *
 * Здесь лежит то, что не зависит от вкладок и областей и потому
 * проверяется тестом: чем зеркало отличается от главного и что именно
 * переносится из одной транзакции в другую.
 */

/**
 * Откуда пришла транзакция: номер области, из которой её разослали.
 *
 * Пометка нужна, чтобы правка не ходила по кругу: слушатель, увидевший её,
 * знает, что это уже рассылка, а не ввод, и дальше не рассылает —
 * кроме главного, которое доставляет её остальным зеркалам, минуя источник.
 */
export const mirroredFrom = Annotation.define<number>();

/**
 * Расширение зеркала: **история у него пуста всегда.**
 *
 * Не «своя история», а никакой: отмена в зеркале идёт через главное
 * состояние — как в VS Code, где история у документа, а не у окна.
 * Две истории на один текст разошлись бы после первого же `Ctrl+Z`
 * не в той области. Плата: отмена курсора (`edit.undo-cursor`) в зеркале
 * не работает — ей тоже нечего вспоминать.
 */
export const mirrorOnly: Extension = EditorState.transactionExtender.of(() => ({
  annotations: Transaction.addToHistory.of(false),
}));

/**
 * Зеркало из главного состояния: тот же текст и то же выделение.
 *
 * `Text` неизменяем и делится между состояниями бесплатно — второй копии
 * документа в памяти не появляется. Расширения передаются снаружи: они
 * зависят от вкладки, а не от того, зеркало это или нет.
 */
export function createMirror(primary: EditorState, extensions: Extension): EditorState {
  return EditorState.create({
    doc: primary.doc,
    selection: primary.selection,
    extensions: [extensions, mirrorOnly],
  });
}

function isBookmarkEffect(effect: StateEffect<unknown>): boolean {
  return effect.is(toggleBookmarkEffect) || effect.is(clearBookmarksEffect);
}

/**
 * Что из транзакции нести в другие состояния того же буфера.
 *
 * Изменения текста и эффекты закладок — закладка свойство буфера (Р-116),
 * а не области. Выделение не переносится: у каждого состояния своё, и оно
 * подвинется по изменениям само. Свёртка не переносится по той же причине.
 *
 * `null` — нести нечего: транзакция только двигала курсор. Пришла ли она
 * из рассылки, здесь не проверяется — это решает получатель по `sourceOf`:
 * зеркало рассылку дальше не передаёт, а главное передаёт остальным
 * зеркалам, минуя источник.
 */
export function replaySpec(
  transaction: Transaction,
  source: number,
): TransactionSpec | null {
  const effects = transaction.effects.filter(isBookmarkEffect);
  if (!transaction.docChanged && effects.length === 0) return null;

  const annotations: Annotation<unknown>[] = [mirroredFrom.of(source)];
  // Название события нужно истории главного, чтобы склеивать набор текста
  // в один шаг отмены, как она делает это с прямым вводом.
  const userEvent = transaction.annotation(Transaction.userEvent);
  if (userEvent !== undefined) {
    annotations.push(Transaction.userEvent.of(userEvent));
  }

  const spec: TransactionSpec = { effects, annotations };
  if (transaction.docChanged) {
    spec.changes = transaction.changes;
  }
  return spec;
}

/** Откуда пришла транзакция — или `null`, если это прямой ввод. */
export function sourceOf(transaction: Transaction): number | null {
  return transaction.annotation(mirroredFrom) ?? null;
}
