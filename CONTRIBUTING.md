# Как помочь · Contributing

[По-русски](#по-русски) · [In English](#in-english)

## По-русски

### Сообщить о проблеме

Заводите [issue](https://github.com/Mark-Karte/ZeroNote/issues) — по-русски
или по-английски. Что приложить, написано в README, раздел «Если нашли
проблему». Раньше всего разбирается нарушение первого инварианта:
**файл изменился сам** — открыли, ничего не правили, сохранили, и файл
стал другим.

### Предложить изменение

- Перед большим изменением заведите issue: обсудить дешевле, чем
  переделывать. У проекта есть границы — что не делается вовсе,
  перечислено в README («Чего нет и не будет в первом круге»), а всё
  отложенное — в [DESIGN.md](DESIGN.md), раздел «Отложено».
- Шесть инвариантов нарушать нельзя, и первый из них — чужие файлы
  неприкосновенны: кодировка, переносы строк, финальная пустая строка
  и frontmatter сохраняются как были, автоформатирования нет. Все шесть —
  в [DESIGN.md](DESIGN.md).
- Должны проходить три проверки — те же, что в непрерывной сборке:
  `npm run check`, `npm test` и `cargo test` в папке `src-tauri`.
  Что касается файлов, кодировок и сессии — только с тестом.
- Цвета, отступы и размеры в компонентах — только переменными слоя
  оформления; зашитое значение ловит `tests/tokens.test.ts`.
- Новая зависимость — с объяснением, почему без неё нельзя.
- Существенное решение записывается в журнал решений `DESIGN.md` —
  вместе с тем, почему оно такое.

### Перевод

Интерфейс сейчас только на русском; английский появится в версии 0.21.0.
Перевод новый — если английский звучит неестественно, заведите issue или
пришлите исправление. После 0.21.0 новый язык будет одним файлом таблицы
строк; как его добавить, допишем сюда, когда каркас перевода будет готов.

## In English

### Reporting a problem

Open an [issue](https://github.com/Mark-Karte/ZeroNote/issues) — in English
or in Russian. What to include is described in the README, “Found
a problem?”. A violation of the first invariant is looked at before
anything else: **the file changed by itself** — you opened it, edited
nothing, saved, and the file is different.

### Proposing a change

- Before a large change, open an issue: discussing is cheaper than
  redoing. The project has boundaries — what is never done is listed
  in the README (“What isn't there, and won't be in the first round”),
  and everything deferred is in [DESIGN.md](DESIGN.md), the “Deferred”
  («Отложено») section.
- The six invariants must never be broken, and the first one is: other
  people's files are untouchable — encoding, line endings, trailing
  newline and frontmatter are kept as they were, there is no
  auto-formatting. All six are in [DESIGN.md](DESIGN.md).
- Three checks must pass — the same as in continuous integration:
  `npm run check`, `npm test`, and `cargo test` in the `src-tauri` folder.
  Anything touching files, encodings or the session comes with a test.
- Colours, spacing and sizes in components come only from the styling
  layer's variables; a hard-coded value is caught by `tests/tokens.test.ts`.
- A new dependency comes with an explanation of why it can't be done
  without it.
- A significant decision is recorded in the decision log in `DESIGN.md`,
  together with the reason for it.

`DESIGN.md` and the code comments are in Russian; issues and pull requests
in English are welcome all the same.

### Translation

The interface is in Russian only for now; English arrives in version
0.21.0. The translation is new — if the English reads unnaturally, open
an issue or send a fix. After 0.21.0 a new language will be a single
string-table file; how to add one will be written here once the
translation framework is ready.
