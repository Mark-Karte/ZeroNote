; Ассоциация файлов и «Открыть в ZeroNote» — задача 69, решение Р-190;
; свой тип и значок на каждое расширение — задача 134, решение Р-302.
;
; Подключается через `bundle > windows > nsis > installerHooks` в tauri.conf.json.
;
; Три правила, на которых здесь всё держится:
;
;  1. **Ключи только в HKCU.** Установка идёт в профиль пользователя и прав
;     администратора не просит (задача 44); машинные ключи их потребовали бы.
;
;  2. **Умолчание не отнимаем.** Мы добавляем себя в «Открыть с помощью»
;     и в список приложений Windows, но не пишем себя в умолчание расширения:
;     чем открывается `.md`, решает человек, а не установщик. К тому же
;     с Windows 10 умолчание всё равно защищено, и попытка его назначить
;     либо не сработает, либо покажет человеку «приложение изменило
;     умолчание» — то есть выглядит как то, чего он не просил.
;
;  3. **Что поставили, то и снимаем.** Всё, что пишется ниже, удаляется
;     в хуке удаления. Программа, оставившая после себя записи в реестре, —
;     это программа, которую запомнят плохо.
;
; На Windows 11 пункт «Открыть в ZeroNote» лежит под «Показать дополнительные
; параметры» (Shift+F10 открывает то же меню сразу). Попасть в короткое меню
; можно только обработчиком IExplorerCommand в упакованном приложении — это
; отдельная работа другого размера, и в задачу 69 она не входит.

; Прежний общий тип на все расширения (до задачи 134). Остаётся
; зарегистрированным: у тех, кто уже назначил ZeroNote умолчанием, выбор
; Windows ссылается на это имя, а переписать выбор установщик не может —
; он защищён проверочной суммой. В списках «Открыть с помощью» его больше
; нет, иначе ZeroNote стоял бы там дважды.
!define ZN_PROGID "ZeroNote.Document"
; У шаблона Tauri `MAINBINARYNAME` — имя без расширения: `.exe` он
; дописывает сам в каждом месте. Здесь дописываем мы.
!define ZN_EXE "$INSTDIR\${MAINBINARYNAME}.exe"
; Значки типов (задача 134, Р-302) — ресурсы установки, см. `bundle >
; resources` в tauri.conf.json; собирает их `icons/files/make-file-icons.mjs`.
!define ZN_ICONS "$INSTDIR\file-icons"

; --- Язык ------------------------------------------------------------------
;
; Установщик говорит на языке Windows: русский — при русском интерфейсе
; системы, английский — при любом другом (задача 156, `languages`
; в tauri.conf.json, английский первым — он и запасной). На том же языке
; пишутся в реестр названия типов и пункт «Открыть в ZeroNote»: их читает
; проводник, а не ZeroNote.
;
; Выбор — во время установки, по `$LANGUAGE`, а не `LangString`: этот файл
; шаблон Tauri подключает раньше, чем загружает языки, и `${LANG_RUSSIAN}`
; здесь ещё не существует. 1049 — код русского языка в Windows.
!define ZN_LANG_RU 1049
Var ZnText

; Положить в $ZnText строку на языке установщика.
!macro ZN_PICK RU EN
  ${If} $LANGUAGE == ${ZN_LANG_RU}
    StrCpy $ZnText "${RU}"
  ${Else}
    StrCpy $ZnText "${EN}"
  ${EndIf}
!macroend

; --- Типы файлов ------------------------------------------------------------
;
; Список один и тот же для «Открыть с помощью» и для окна выбора файла
; во фронтенде (`src/actions/file-types.ts`). Совпадение сторожит
; `tests/file-types.test.ts`: два списка одного и того же разъезжаются молча.
; Второе и третье в строке — название типа по-русски и по-английски: его
; проводник пишет в столбце «Тип», когда ZeroNote выбран для расширения
; умолчанием. Пишется одно — на языке установщика.

!macro ZN_FOR_EACH_EXT ACTION
  !insertmacro ${ACTION} "md" "Заметка Markdown" "Markdown note"
  !insertmacro ${ACTION} "markdown" "Заметка Markdown" "Markdown note"
  !insertmacro ${ACTION} "mdx" "Заметка MDX" "MDX note"
  !insertmacro ${ACTION} "txt" "Текстовый документ" "Text document"
  !insertmacro ${ACTION} "log" "Файл журнала" "Log file"
  !insertmacro ${ACTION} "toml" "Настройки TOML" "TOML settings"
  !insertmacro ${ACTION} "json" "Данные JSON" "JSON data"
  !insertmacro ${ACTION} "jsonc" "Данные JSON с комментариями" "JSON data with comments"
  !insertmacro ${ACTION} "yaml" "Данные YAML" "YAML data"
  !insertmacro ${ACTION} "yml" "Данные YAML" "YAML data"
  !insertmacro ${ACTION} "xml" "Документ XML" "XML document"
  !insertmacro ${ACTION} "ini" "Настройки INI" "INI settings"
  !insertmacro ${ACTION} "cfg" "Файл настроек" "Settings file"
  !insertmacro ${ACTION} "conf" "Файл настроек" "Settings file"
  !insertmacro ${ACTION} "csv" "Таблица CSV" "CSV table"
  !insertmacro ${ACTION} "tsv" "Таблица TSV" "TSV table"
  !insertmacro ${ACTION} "properties" "Файл свойств" "Properties file"
  !insertmacro ${ACTION} "lock" "Файл блокировки" "Lock file"
  !insertmacro ${ACTION} "c" "Исходный код C" "C source code"
  !insertmacro ${ACTION} "h" "Заголовок C" "C header"
  !insertmacro ${ACTION} "cpp" "Исходный код C++" "C++ source code"
  !insertmacro ${ACTION} "cxx" "Исходный код C++" "C++ source code"
  !insertmacro ${ACTION} "cc" "Исходный код C++" "C++ source code"
  !insertmacro ${ACTION} "hpp" "Заголовок C++" "C++ header"
  !insertmacro ${ACTION} "hxx" "Заголовок C++" "C++ header"
  !insertmacro ${ACTION} "cs" "Исходный код C#" "C# source code"
  !insertmacro ${ACTION} "java" "Исходный код Java" "Java source code"
  !insertmacro ${ACTION} "kt" "Исходный код Kotlin" "Kotlin source code"
  !insertmacro ${ACTION} "rs" "Исходный код Rust" "Rust source code"
  !insertmacro ${ACTION} "go" "Исходный код Go" "Go source code"
  !insertmacro ${ACTION} "swift" "Исходный код Swift" "Swift source code"
  !insertmacro ${ACTION} "py" "Исходный код Python" "Python source code"
  !insertmacro ${ACTION} "rb" "Исходный код Ruby" "Ruby source code"
  !insertmacro ${ACTION} "php" "Исходный код PHP" "PHP source code"
  !insertmacro ${ACTION} "lua" "Исходный код Lua" "Lua source code"
  !insertmacro ${ACTION} "js" "Исходный код JavaScript" "JavaScript source code"
  !insertmacro ${ACTION} "jsx" "Исходный код JSX" "JSX source code"
  !insertmacro ${ACTION} "mjs" "Модуль JavaScript" "JavaScript module"
  !insertmacro ${ACTION} "cjs" "Модуль CommonJS" "CommonJS module"
  !insertmacro ${ACTION} "ts" "Исходный код TypeScript" "TypeScript source code"
  !insertmacro ${ACTION} "tsx" "Исходный код TSX" "TSX source code"
  !insertmacro ${ACTION} "html" "Документ HTML" "HTML document"
  !insertmacro ${ACTION} "htm" "Документ HTML" "HTML document"
  !insertmacro ${ACTION} "css" "Таблица стилей CSS" "CSS style sheet"
  !insertmacro ${ACTION} "scss" "Таблица стилей SCSS" "SCSS style sheet"
  !insertmacro ${ACTION} "less" "Таблица стилей Less" "Less style sheet"
  !insertmacro ${ACTION} "svelte" "Компонент Svelte" "Svelte component"
  !insertmacro ${ACTION} "vue" "Компонент Vue" "Vue component"
  !insertmacro ${ACTION} "sql" "Запрос SQL" "SQL query"
  !insertmacro ${ACTION} "sh" "Сценарий оболочки" "Shell script"
  !insertmacro ${ACTION} "bash" "Сценарий Bash" "Bash script"
  !insertmacro ${ACTION} "ps1" "Сценарий PowerShell" "PowerShell script"
  !insertmacro ${ACTION} "psm1" "Модуль PowerShell" "PowerShell module"
  !insertmacro ${ACTION} "bat" "Пакетный файл" "Batch file"
  !insertmacro ${ACTION} "cmd" "Командный сценарий" "Command script"
!macroend

!macro ZN_ADD_EXT EXT RU EN
  ; Свой тип на каждое расширение (задача 134): название, значок и команда
  ; открытия. Нужен ради значка — у общего типа он был бы один на всех.
  !insertmacro ZN_PICK "${RU}" "${EN}"
  WriteRegStr HKCU "Software\Classes\ZeroNote.${EXT}" "" "$ZnText"
  WriteRegStr HKCU "Software\Classes\ZeroNote.${EXT}\DefaultIcon" "" "${ZN_ICONS}\${EXT}.ico"
  WriteRegStr HKCU "Software\Classes\ZeroNote.${EXT}\shell\open\command" "" '"${ZN_EXE}" "%1"'
  ; «Открыть с помощью»: добавляемся к тем, кто уже там, и ничего не вытесняем.
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "ZeroNote.${EXT}" ""
  ; Прежний общий тип из списка убираем: на его месте теперь свой.
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${ZN_PROGID}"
  ; То же самое для списка «Приложения по умолчанию» в параметрах Windows:
  ; именно отсюда человек назначает нас умолчанием, если захочет.
  WriteRegStr HKCU "Software\ZeroNote\Capabilities\FileAssociations" ".${EXT}" "ZeroNote.${EXT}"
!macroend

!macro ZN_REMOVE_EXT EXT RU EN
  DeleteRegKey HKCU "Software\Classes\ZeroNote.${EXT}"
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "ZeroNote.${EXT}"
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${ZN_PROGID}"
  ; Список «Открыть с помощью» убираем только если он опустел, то есть
  ; кроме нас там никого и не было. `/ifempty` в NSIS 3 — ни подключей,
  ; ни значений: чужая запись в списке его сохраняет.
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  ; Так же и ключ самого расширения: у типа, которого до нас в профиле
  ; не было (`.bat`, `.kt`, `.svelte`), его завёл наш список, и без этой
  ; строки после удаления оставался пустой ключ. Чужой ключ, где есть хоть
  ; одно значение или подключ, не трогается (задача 134, живая проверка).
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}"
!macroend

; --- Глагол «Открыть в ZeroNote» --------------------------------------------

!macro ZN_ADD_VERB TARGET PARAM
  !insertmacro ZN_PICK "Открыть в ZeroNote" "Open in ZeroNote"
  WriteRegStr HKCU "Software\Classes\${TARGET}\shell\ZeroNote" "" "$ZnText"
  WriteRegStr HKCU "Software\Classes\${TARGET}\shell\ZeroNote" "Icon" "${ZN_EXE},0"
  ; Проводник запускает по процессу на каждый выделенный файл; `Player`
  ; означает «отдай все выделенные одному». Второй экземпляр у нас всё равно
  ; передаёт пути первому и уходит, но пять лишних процессов — лишние.
  WriteRegStr HKCU "Software\Classes\${TARGET}\shell\ZeroNote" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\${TARGET}\shell\ZeroNote\command" "" '"${ZN_EXE}" "${PARAM}"'
!macroend

!macro ZN_REMOVE_VERB TARGET
  DeleteRegKey HKCU "Software\Classes\${TARGET}\shell\ZeroNote"
!macroend

; --- Хуки -------------------------------------------------------------------

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro ZN_PICK "Регистрация типов файлов и пунктов меню…" "Registering file types and menu items…"
  DetailPrint "$ZnText"

  ; Прежний общий тип: как называется, чем рисуется, чем открывается.
  ; Значок — лист без подписи: тип один на все расширения, и подпись
  ; у него была бы неправдой для всех, кроме одного.
  !insertmacro ZN_PICK "Текстовый документ ZeroNote" "ZeroNote text document"
  WriteRegStr HKCU "Software\Classes\${ZN_PROGID}" "" "$ZnText"
  WriteRegStr HKCU "Software\Classes\${ZN_PROGID}\DefaultIcon" "" "${ZN_ICONS}\document.ico"
  WriteRegStr HKCU "Software\Classes\${ZN_PROGID}\shell\open\command" "" '"${ZN_EXE}" "%1"'

  ; Приложение — то, что видно в «Открыть с помощью» под своим именем.
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "ZeroNote"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"${ZN_EXE}" "%1"'

  ; Заявка в список приложений Windows. Без неё назначить нас умолчанием
  ; из параметров системы нельзя — а это единственный честный способ им стать.
  WriteRegStr HKCU "Software\ZeroNote\Capabilities" "ApplicationName" "ZeroNote"
  !insertmacro ZN_PICK "Редактор текста и заметок" "Text and notes editor"
  WriteRegStr HKCU "Software\ZeroNote\Capabilities" "ApplicationDescription" "$ZnText"
  WriteRegStr HKCU "Software\RegisteredApplications" "ZeroNote" "Software\ZeroNote\Capabilities"

  !insertmacro ZN_FOR_EACH_EXT ZN_ADD_EXT

  ; Глагол на файле, на папке и на пустом месте внутри открытой папки.
  ; У фона папки путь приходит в %V, а не в %1: %1 там пустой.
  !insertmacro ZN_ADD_VERB "*" "%1"
  !insertmacro ZN_ADD_VERB "Directory" "%1"
  !insertmacro ZN_ADD_VERB "Directory\Background" "%V"

  ; Сказать проводнику, что список ассоциаций изменился, — иначе новые пункты
  ; появятся только после перезахода в систему. SHCNE_ASSOCCHANGED = 0x08000000.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ZN_PICK "Снятие типов файлов и пунктов меню…" "Removing file types and menu items…"
  DetailPrint "$ZnText"

  DeleteRegKey HKCU "Software\Classes\${ZN_PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"

  DeleteRegValue HKCU "Software\RegisteredApplications" "ZeroNote"
  DeleteRegKey HKCU "Software\ZeroNote"

  !insertmacro ZN_FOR_EACH_EXT ZN_REMOVE_EXT

  !insertmacro ZN_REMOVE_VERB "*"
  !insertmacro ZN_REMOVE_VERB "Directory"
  !insertmacro ZN_REMOVE_VERB "Directory\Background"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; Пустые хуки объявлять обязательно: установщик вставляет все четыре.
!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
