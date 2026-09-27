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
!define ZN_VERB_LABEL "Открыть в ZeroNote"
; У шаблона Tauri `MAINBINARYNAME` — имя без расширения: `.exe` он
; дописывает сам в каждом месте. Здесь дописываем мы.
!define ZN_EXE "$INSTDIR\${MAINBINARYNAME}.exe"
; Значки типов (задача 134, Р-302) — ресурсы установки, см. `bundle >
; resources` в tauri.conf.json; собирает их `icons/files/make-file-icons.mjs`.
!define ZN_ICONS "$INSTDIR\file-icons"

; --- Типы файлов ------------------------------------------------------------
;
; Список один и тот же для «Открыть с помощью» и для окна выбора файла
; во фронтенде (`src/actions/file-types.ts`). Совпадение сторожит
; `tests/file-types.test.ts`: два списка одного и того же разъезжаются молча.
; Второе в строке — название типа: его проводник пишет в столбце «Тип»,
; когда ZeroNote выбран для расширения умолчанием.

!macro ZN_FOR_EACH_EXT ACTION
  !insertmacro ${ACTION} "md" "Заметка Markdown"
  !insertmacro ${ACTION} "markdown" "Заметка Markdown"
  !insertmacro ${ACTION} "mdx" "Заметка MDX"
  !insertmacro ${ACTION} "txt" "Текстовый документ"
  !insertmacro ${ACTION} "log" "Файл журнала"
  !insertmacro ${ACTION} "toml" "Настройки TOML"
  !insertmacro ${ACTION} "json" "Данные JSON"
  !insertmacro ${ACTION} "jsonc" "Данные JSON с комментариями"
  !insertmacro ${ACTION} "yaml" "Данные YAML"
  !insertmacro ${ACTION} "yml" "Данные YAML"
  !insertmacro ${ACTION} "xml" "Документ XML"
  !insertmacro ${ACTION} "ini" "Настройки INI"
  !insertmacro ${ACTION} "cfg" "Файл настроек"
  !insertmacro ${ACTION} "conf" "Файл настроек"
  !insertmacro ${ACTION} "csv" "Таблица CSV"
  !insertmacro ${ACTION} "tsv" "Таблица TSV"
  !insertmacro ${ACTION} "properties" "Файл свойств"
  !insertmacro ${ACTION} "lock" "Файл блокировки"
  !insertmacro ${ACTION} "c" "Исходный код C"
  !insertmacro ${ACTION} "h" "Заголовок C"
  !insertmacro ${ACTION} "cpp" "Исходный код C++"
  !insertmacro ${ACTION} "cxx" "Исходный код C++"
  !insertmacro ${ACTION} "cc" "Исходный код C++"
  !insertmacro ${ACTION} "hpp" "Заголовок C++"
  !insertmacro ${ACTION} "hxx" "Заголовок C++"
  !insertmacro ${ACTION} "cs" "Исходный код C#"
  !insertmacro ${ACTION} "java" "Исходный код Java"
  !insertmacro ${ACTION} "kt" "Исходный код Kotlin"
  !insertmacro ${ACTION} "rs" "Исходный код Rust"
  !insertmacro ${ACTION} "go" "Исходный код Go"
  !insertmacro ${ACTION} "swift" "Исходный код Swift"
  !insertmacro ${ACTION} "py" "Исходный код Python"
  !insertmacro ${ACTION} "rb" "Исходный код Ruby"
  !insertmacro ${ACTION} "php" "Исходный код PHP"
  !insertmacro ${ACTION} "lua" "Исходный код Lua"
  !insertmacro ${ACTION} "js" "Исходный код JavaScript"
  !insertmacro ${ACTION} "jsx" "Исходный код JSX"
  !insertmacro ${ACTION} "mjs" "Модуль JavaScript"
  !insertmacro ${ACTION} "cjs" "Модуль CommonJS"
  !insertmacro ${ACTION} "ts" "Исходный код TypeScript"
  !insertmacro ${ACTION} "tsx" "Исходный код TSX"
  !insertmacro ${ACTION} "html" "Документ HTML"
  !insertmacro ${ACTION} "htm" "Документ HTML"
  !insertmacro ${ACTION} "css" "Таблица стилей CSS"
  !insertmacro ${ACTION} "scss" "Таблица стилей SCSS"
  !insertmacro ${ACTION} "less" "Таблица стилей Less"
  !insertmacro ${ACTION} "svelte" "Компонент Svelte"
  !insertmacro ${ACTION} "vue" "Компонент Vue"
  !insertmacro ${ACTION} "sql" "Запрос SQL"
  !insertmacro ${ACTION} "sh" "Сценарий оболочки"
  !insertmacro ${ACTION} "bash" "Сценарий Bash"
  !insertmacro ${ACTION} "ps1" "Сценарий PowerShell"
  !insertmacro ${ACTION} "psm1" "Модуль PowerShell"
  !insertmacro ${ACTION} "bat" "Пакетный файл"
  !insertmacro ${ACTION} "cmd" "Командный сценарий"
!macroend

!macro ZN_ADD_EXT EXT NAME
  ; Свой тип на каждое расширение (задача 134): название, значок и команда
  ; открытия. Нужен ради значка — у общего типа он был бы один на всех.
  WriteRegStr HKCU "Software\Classes\ZeroNote.${EXT}" "" "${NAME}"
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

!macro ZN_REMOVE_EXT EXT NAME
  DeleteRegKey HKCU "Software\Classes\ZeroNote.${EXT}"
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "ZeroNote.${EXT}"
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${ZN_PROGID}"
  ; Сам ключ расширения не трогаем никогда: он чужой. Список «Открыть
  ; с помощью» убираем только если он опустел, то есть кроме нас там
  ; никого и не было.
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
!macroend

; --- Глагол «Открыть в ZeroNote» --------------------------------------------

!macro ZN_ADD_VERB TARGET PARAM
  WriteRegStr HKCU "Software\Classes\${TARGET}\shell\ZeroNote" "" "${ZN_VERB_LABEL}"
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
  DetailPrint "Регистрация типов файлов и пунктов меню…"

  ; Прежний общий тип: как называется, чем рисуется, чем открывается.
  ; Значок — лист без подписи: тип один на все расширения, и подпись
  ; у него была бы неправдой для всех, кроме одного.
  WriteRegStr HKCU "Software\Classes\${ZN_PROGID}" "" "Текстовый документ ZeroNote"
  WriteRegStr HKCU "Software\Classes\${ZN_PROGID}\DefaultIcon" "" "${ZN_ICONS}\document.ico"
  WriteRegStr HKCU "Software\Classes\${ZN_PROGID}\shell\open\command" "" '"${ZN_EXE}" "%1"'

  ; Приложение — то, что видно в «Открыть с помощью» под своим именем.
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "ZeroNote"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"${ZN_EXE}" "%1"'

  ; Заявка в список приложений Windows. Без неё назначить нас умолчанием
  ; из параметров системы нельзя — а это единственный честный способ им стать.
  WriteRegStr HKCU "Software\ZeroNote\Capabilities" "ApplicationName" "ZeroNote"
  WriteRegStr HKCU "Software\ZeroNote\Capabilities" "ApplicationDescription" "Редактор текста и заметок"
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
  DetailPrint "Снятие типов файлов и пунктов меню…"

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
