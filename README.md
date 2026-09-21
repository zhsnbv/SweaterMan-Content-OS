# Sweater Man Content OS

Внутренний инструмент команды Sweater Man: недельное планирование, производство,
публикация, разбор результатов и накопление выводов — в одном месте, с памятью,
которая живёт под интерфейсом.

---

## WHAT THIS IS

Не генератор контент-планов. Рабочая система, в которой:

- **Неделя** собирается командой `«Новая неделя, обнови план»`. AI сам читает
  предыдущую неделю, делает review если его не было, смотрит подтверждённую
  аналитику, накопленные learnings, ближайшие Core Videos с их реальными
  ассетами, backlog и стратегические документы — и создаёт календарь.
- **Карточка** правится в её собственном чате: «Слишком сложно, упрости»,
  «Сделай смешнее», «Не хочу карусель, сделай одну Story». Меняется **только**
  эта карточка, сохраняется ревизия, показывается diff, есть Undo.
- **Команда** комментирует карточки. Обычный комментарий — просто комментарий.
  `@ai` или кнопка **Send to AI** превращают его в правку с ревизией.
- **Результаты** заносятся вручную: отметил Published → через 24 ч появляется
  `24h report due` → загрузил скриншот → AI извлекает **только видимые** цифры →
  ты подтверждаешь или исправляешь → только подтверждённые числа идут в выводы.
- **Память** разделена на слои и не переписывается AI по своему усмотрению.

**Главный критерий:** через неделю, в новой сессии браузера, без истории чата,
команда `«Новая неделя, обнови план»` должна дать *лучший* план, чем в прошлый
раз. Контекст пересобирается из хранилища при каждом запросе.

### Ключевая сущность — CONTENT UNIT

Одна идея, несколько площадок. Не четыре независимых поста:

```
CONTENT UNIT: «Почему осьминоги бьют рыб, с которыми охотятся»
  Instagram → Story Poll
  YouTube   → Community Quiz
  TikTok    → Photo Mode
  Telegram  → не публикуем
```

---

## LOCAL SETUP

```bash
npm install
cp .env.example .env.local     # можно оставить пустым
npm run dev
```

Откроется на http://localhost:3000. **Никакие ключи не обязательны.**
Без них приложение работает на локальных адаптерах и честно пишет в Settings,
чего не хватает.

Первый запуск автоматически импортирует постоянный контекст из `seed/` и
`context/`. Пошаговый мастер — на `/setup`.

Чтобы сразу увидеть систему в работе:

```bash
npm run seed:demo    # V027 + примерная неделя
npm run reset:demo   # очистить контент (документы контекста останутся)
```

> Файловое хранилище держит состояние в памяти процесса и пишет на диск при
> каждой мутации. Поэтому эти скрипты рассчитаны на **остановленный** дев-сервер:
> если запустить их параллельно, работающий сервер перезапишет файл своей копией.
> При запущенном сервере то же самое делается кнопками в Settings → Demo data.
> С подключённым Supabase ограничения нет.

### Что работает без чего

| Нет | Что происходит |
|---|---|
| Supabase | Файловое хранилище в `.localdata/`. Одна машина, без auth. Всё остальное работает. |
| ключа AI | Детерминированный движок: планирование недели, weekly review, правки карточек (упростить / сократить / смешнее / одна Story / агрессивнее продавать / перенести) — работают. Свободная генерация текста и чтение скриншотов — нет. |
| GitHub | Snapshot пишется в `.localdata/dev/content-state/` в **точно том же** формате, что и в ветке. |

---

## SUPABASE SETUP

1. Создать проект на [supabase.com](https://supabase.com).
2. Применить миграции (SQL Editor или CLI), по порядку:
   - `supabase/migrations/0001_init.sql` — таблицы, внешние ключи, индексы
   - `supabase/migrations/0002_rls.sql` — RLS и роли OWNER / EDITOR / VIEWER
   - `supabase/migrations/0003_storage.sql` — приватный бакет `content-os`
3. Скопировать URL, anon key и service role key в `.env.local`.
4. Перезапустить. Settings → Integrations должен показать Supabase ✓.

С CLI:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Схема: колонки для всего, по чему фильтруем, джойним и сортируем; `jsonb`
для редакционных payload-ов (тексты, массивы заметок, снапшоты ревизий).
Внешние ключи настоящие, каскады заданы явно.

---

## ENV VARIABLES

Полный список с комментариями — в [`.env.example`](.env.example).

| Переменная | Зачем |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Клиент и Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Сервер. Обходит RLS — **только** на сервере |
| `AI_PROVIDER` | `anthropic` \| `openai` \| `mock` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Ключ выбранного провайдера |
| `AI_MODEL_PLANNER` / `AI_MODEL_REVIEW` / `AI_MODEL_VISION` | Модели по ролям, не по названиям в коде |
| `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` | Durable snapshot |
| `GITHUB_DATA_BRANCH` | По умолчанию `content-state` |
| `CONTENT_OS_DATA_DIR` | Где лежит локальное хранилище |

Имя модели нигде не зашито в бизнес-логику: код просит **роль**
(`planner` / `review` / `vision`), а `lib/ai/config.ts` решает, какая это модель.
Сменить модель — это изменение env, а не кода.

---

## GITHUB TOKEN / PERMISSIONS

Fine-grained token, доступ **только к этому репозиторию**:

| Разрешение | Уровень | Зачем |
|---|---|---|
| Contents | Read and write | Читать и писать ветку `content-state` |
| Metadata | Read | Обязательно для fine-grained токенов |

Больше ничего не нужно: ни issues, ни actions, ни pull requests.

При setup приложение создаёт ветку `content-state` от дефолтной, если её нет.
Проверить/создать вручную — Settings → *Initialize / verify branch*.

---

## AI API SETUP

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

или

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

Абстракция провайдера — в `lib/ai/provider.ts`; реализации в
`lib/ai/providers/`. Добавить OpenRouter — это один новый файл,
реализующий тот же интерфейс, и одна ветка в `lib/ai/config.ts`.

**Vision.** Извлечение метрик из скриншотов требует модели со зрением
(`AI_MODEL_VISION`). Без неё окно отчёта всё равно открывается — просто цифры
вписываются руками. Система **никогда** не придумывает значение: не видно на
скриншоте — значит `NA`.

---

## RUN LOCALLY

```bash
npm run dev          # дев-сервер
npm run build        # прод-сборка
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # unit + integration (vitest)
npm run test:e2e     # Playwright happy-path
npm run check        # typecheck + lint + test
```

---

## DEPLOY TO VERCEL

1. Импортировать репозиторий в Vercel (Next.js определится сам).
2. Добавить переменные окружения из `.env.example`.
3. Deploy.

**Важно:** коммиты состояния контента идут в ветку `content-state`, а код живёт
в `main`. Деплой на push в `main` — коммиты контента его не триггерят. Если в
проекте включены preview-деплои на все ветки, отключите их для
`content-state`, иначе каждая правка карточки будет собирать preview.

---

## INITIAL IMPORT

Положить в `seed/`:

```
seed/MASTER_CONTEXT.md
seed/PERFORMANCE_INSIGHTS.md
seed/FUNNEL_PLAYBOOK.md
```

`context/PRODUCTION_PIPELINE.md` уже есть в репозитории — его создаёт и ведёт
это приложение (реальный workflow: раскадровка → съёмка ведущего → cutout →
генерация ассетов → сборка сцен → CapCut). Свою версию можно положить в
`seed/PRODUCTION_PIPELINE.md` — она перекроет дефолтную.

Импорт запускается сам при первом запуске. Повторить — Settings →
*Re-import from seed/* или Context → *Re-import*. Импорт **никогда** не
перезаписывает уже загруженный документ, если не нажать Re-import явно.

Если файла нет — приложение не падает: создаётся понятный placeholder с
инструкцией, куда положить документ, а планировщик честно пишет, что контекст
неполный.

---

## HOW MEMORY WORKS

Память разделена на четыре слоя, чтобы AI не переписывал стратегию каждую неделю:

| Слой | Что | Кто меняет |
|---|---|---|
| **A. Immutable** | `MASTER_CONTEXT`, `FUNNEL_PLAYBOOK`, `PRODUCTION_PIPELINE` | Только Owner. AI может лишь **предложить** изменение |
| **B. Operational** | `strategy_state.json` — фокус, активные эксперименты, sales level | Weekly review и AI напрямую |
| **C. Learnings** | append-only выводы с evidence и confidence | AI добавляет, ничего не удаляет |
| **D. Weekly data** | планы, ревизии, отчёты, reviews | Обычная работа |

### Context Builder

Перед **каждым** ответом AI:

1. определяется scope — workspace / week / content unit / report;
2. `buildContextBundle()` собирает bundle **из хранилища**, не из истории чата;
3. читается текущее durable-состояние;
4. и только потом формируется ответ.

В bundle попадает только релевантное, с бюджетом по символам: базовые документы
режутся по секциям (`##`), learnings ранжируются по confidence, свежести и
соответствию scope, отчёты — только подтверждённые. История чата используется
максимум на несколько последних реплик и **не является источником правды**.

Поэтому новая сессия браузера с пустым чатом даёт такой же результат, как
долгая. Это проверяется тестом `TEST F` в `tests/integration/acceptance.test.ts`.

### Learning engine

Learning без evidence создать нельзя. Confidence выводится из объёма
подтверждений:

| Ситуация | Confidence |
|---|---|
| Один результат | `LOW` |
| Несколько сопоставимых | до `MEDIUM` |
| Повторяемая закономерность | `HIGH` |
| Повторяющийся operational feedback команды (≥3 карточек) | `HIGH` |

Повторяющийся фидбек — тоже evidence. Если трижды сказать «такие карусели
слишком долго делать», weekly review создаст:

```
Observation: Large custom carousels exceed the team's supporting-content effort budget.
Evidence:    User feedback on CU-…, CU-…, CU-…
Confidence:  HIGH
Action:      Prefer Story or a ≤4-card carousel unless specifically requested.
```

и следующая неделя будет собрана с учётом этого.

### Compaction

Raw-история не удаляется никогда. При росте объёма создаются summaries в
`memory/summaries/`; оригинальные планы, отчёты, ревизии и reviews остаются
доступными. Для сборки контекста используются summaries, для аудита — оригиналы.

---

## HOW GITHUB SYNC WORKS

Runtime работает на Postgres. GitHub — **не** realtime-база, а durable snapshot
и audit trail.

Каждая значимая мутация ставит асинхронный sync (пользователь не ждёт сеть).
Индикатор в шапке: `Synced ✓` · `Syncing…` · `Sync failed — retry`.
Весь snapshot уходит **одним коммитом** (blob → tree → commit → ref).

```
.content-os/
  context/
    MASTER_CONTEXT.md
    PERFORMANCE_INSIGHTS.md
    FUNNEL_PLAYBOOK.md
    PRODUCTION_PIPELINE.md
    strategy_state.json
  weeks/2026-W39/
    plan.json
    review.md
    review.json
  content-units/
    CU-2026-W39-01.json
    CU-2026-W39-01.revisions.json
    CU-2026-W39-01.comments.json
  core-videos/V027.json
  backlog/topics.json
  analytics/CU-2026-W39-01/
    24h.json  72h.json  7d.json
  memory/
    learnings.jsonl
    decisions.jsonl
    summaries/
  schemas/README.md
```

Примеры коммитов:

```
content: generate plan for 2026-W40
content: revise CU-2026-W40-03 from user feedback
analytics: add confirmed 24h report for CU-2026-W40-03
review: complete 2026-W40
memory: update operational learnings
```

**Скриншоты никогда не коммитятся.** Изображения лежат в Supabase Storage;
в репозиторий попадают только путь в Storage и структурированные метрики.
Это проверяется тестом в `tests/integration/github-sync.test.ts`.

---

## HOW TO ADD TEAM MEMBER

Settings → Workspace members → email + роль → **Invite**.

| Роль | Может |
|---|---|
| `OWNER` | Всё + подтверждать изменения фундаментальной стратегии |
| `EDITOR` | Редактировать контент, комментировать, вызывать AI |
| `VIEWER` | Только чтение |

С подключённым Supabase участник входит через Supabase Auth, и RLS применяет
роль на уровне базы (`supabase/migrations/0002_rls.sql`). Без Supabase
workspace локальный и однопользовательский.

Ревизии и аналитика — append-only даже для OWNER: RLS разрешает на
`content_revisions` только `insert` и `select`.

---

## BACKUP / RECOVERY

Две независимые копии:

1. **Postgres** — рабочее состояние. Supabase делает автоматические бэкапы;
   Point-in-Time Recovery на платных планах.
2. **Ветка `content-state`** — полный человекочитаемый snapshot с историей
   коммитов. Это и есть бэкап.

**Восстановление:**

```bash
git fetch origin content-state
git checkout content-state
# .content-os/ содержит всё состояние в JSON и Markdown
```

Файлы читаются глазами и импортируются обратно: структура плоская, схемы
описаны в `.content-os/schemas/README.md`.

Снять полный snapshot прямо сейчас: Settings → индикатор синхронизации
(он же кнопка) или `POST /api/sync`.

**Что система не удаляет никогда:** историческую аналитику, feedback
пользователя, raw-результаты, ревизии. AI не может это стереть — ни одним
инструментом.

---

## ARCHITECTURE

```
app/
  week/ core-videos/ backlog/ insights/ context/ settings/ setup/
  api/                     REST: state, units, comments, publish, reports,
                           review, context, sync, ai/chat, setup, demo
lib/
  domain/                  enums, zod-схемы, ISO-недели (UTC), id
  store/                   Store-интерфейс + Supabase и файловый адаптеры
  services/                units · analytics · learnings · review · planner
                           · diff · bootstrap · demo
  ai/
    context-builder.ts     сборка bundle из durable state
    tools.ts               21 инструмент, со scope-границами
    agent.ts               scope → context → provider → tools
    providers/sdk.ts       Anthropic / OpenAI через Vercel AI SDK
    providers/mock.ts      детерминированный движок без ключей
  github/                  octokit + локальный snapshot, одинаковый формат
components/                UI: week board, drawer, chat, analytics, pages
supabase/migrations/       schema · RLS · storage
tests/                     unit · integration · e2e
```

### Стек

Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind CSS 4 ·
Supabase (Postgres + Storage + Auth) · Vercel AI SDK 7 · Octokit 5 · Zod 4 ·
dnd-kit · Vitest · Playwright.

> **Почему TypeScript 5.9, а не 7.** На момент сборки `typescript-eslint`
> поддерживает `typescript >=4.8.4 <6.1.0`. TS 7 (нативный компилятор) ломает
> линтинг. 5.9 — текущая стабильная линия 5.x, не устаревший API.

> **Почему не shadcn/ui CLI.** Примитивы написаны вручную в той же идиоме
> (`cva` + `tailwind-merge`, те же имена и варианты) — `components/ui/`.
> Зависимостей меньше, контроль над плотностью интерфейса полный.

Нет микросервисов, Redis, очередей и отдельной векторной БД — они не нужны.
Архитектура позволяет добавить `pgvector` позже, но V1 от него не зависит.

---

## AI TOOLS

AI действует инструментами, а не текстом:

```
get_workspace_context   get_current_week      get_previous_week
get_core_videos         get_backlog           get_relevant_learnings
get_analytics           create_week_plan      update_week_plan
create_content_unit     update_content_unit   move_content_unit
update_platform_variant record_user_feedback  add_backlog_item
update_backlog_item     run_weekly_review     record_learning
update_strategy_state   propose_strategy_change  sync_to_github
```

**Границы безопасности:**

- Чат карточки видит только подмножество инструментов и физически не может
  изменить другую карточку — попытка бросает `Scope violation`.
- `propose_strategy_change` — единственный путь к фундаментальным документам,
  и он лишь создаёт предложение для Owner.
- Регенерация недели не трогает опубликованные карточки и не создаёт их дубли.
- `CORE_CANDIDATE` в backlog требует ≥2 подтверждений: один удачный опрос
  доказательством не считается.
- Каждая мутация создаёт ревизию с полным снапшотом «до» — любая правка
  обратима.

---

## TESTING

```bash
npm run test       # 71 unit + integration
npm run test:e2e   # Playwright
npm run check      # typecheck + lint + test
```

Покрыто: ISO-недели (включая независимость от таймзоны), evidence→confidence,
санитизация метрик, due-состояния аналитики, diff, Context Builder, все
AI-инструменты, GitHub snapshot, и полный acceptance-сценарий TEST A–F из
брифа — включая главный: новая сессия без истории чата строит улучшенный план.
