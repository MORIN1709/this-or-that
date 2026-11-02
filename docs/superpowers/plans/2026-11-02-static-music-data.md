# תוכנית מימוש: מאגר מוזיקה סטטי

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** בונים פעם אחת מאגר JSON של אמנים, אלבומים ושירים מ-MusicBrainz ו-ListenBrainz, ומעבירים את האתר לקרוא רק ממנו.

**Architecture:**
- **סקריפט Node** (`tools/`) עם שלושה חלקים:
  - שכבת שליפה עם מטמון על הדיסק, בקצב של בקשה ב-1100ms.
  - פונקציות טהורות לסינון ולעיצוב הנתונים.
  - pipeline שכותב את `data/{artists,albums,songs}/<slug>.json` ואת `data/index.json`.
- **האתר:** `js/data-source.js` מחליף את השליפה החיה. `game.js` לא משתנה, ו-`questions.js` משתנה מעט.

**Tech Stack:** Node 22 בלי תלויות. `node:test` לבדיקות יחידה. Playwright, שמותקן מראש, לבדיקות בדפדפן.

**Spec:** `docs/superpowers/specs/2026-11-02-static-music-data-design.md`. יחד איתו, `docs/design.md` לכל מה שלא השתנה.

## Global Constraints

- **הכמויות:** 30 האמנים המובילים בכל ז'אנר, כל אלבומי האולפן שלהם, וכל השירים שבאלבומים.
  - אין מגבלה לאמן.
  - אין סינון לפי התגיות של האלבום.
- **קצב:** לכל היותר בקשה אחת ל-1100ms. על 503 ו-429 יש ניסיון חוזר, עם המתנה של `2000 * attempt`.
- **הזדהות:** `User-Agent: this-or-that/1.0 ( https://github.com/MORIN1709/this-or-that )`, בלי מייל.
- **ListenBrainz:** רק `POST /1/popularity/artist`.
- **בלי מוזיקה ישראלית:** חיפוש האמנים כולל `NOT country:IL`, ושמות בכתב עברי (`/[֐-׿]/`) מסוננים.
- **שירי האלבום** נלקחים מההוצאה הרשמית המוקדמת ביותר. מדיית וידאו מדולגת.
- **סינון שירים:** demo, live, remix, instrumental ו-karaoke מסוננים **רק בתוך סוגריים או אחרי ` - `**.
- **מבנה הקבצים** בדיוק לפי §7 ב-spec: מקונן לפי אמן ואלבום, בלי מזהי MBID.
- **האתר לא פונה** ל-MusicBrainz או ל-ListenBrainz. קבצי השליפה החיה נמחקים.
- **מגבלות קיימות שנשארות:** ממשק בעברית ו-RTL, טקסט הפריטים ב-`dir="auto"`, בלי ספריות ובלי build. שליפה מראש של 2 שאלות, כפילויות בסיבוב ואיפוס נשארים כמו שהם.
- **הרצה כאן** דורשת `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- **git:** עובדים בענף `static-music-data`. בסוף כל task עושים commit ו-push. **לא ממזגים ל-`main`** עד שהמשתמש מאשר את בדיקת האיכות (§9 ב-spec).

## Review Focus

1. **משיכה מוקדמת של עמודים:** אמן עם הרבה הוצאות, כמו Metallica, עם יותר מ-1,000. המצופה: כל העמודים נשלפים. השרת מחזיר כ-50 הוצאות לעמוד ולא 100, ולכן ה-offset מתקדם לפי מה שחזר בפועל. → Task 2, הבדיקה `pages by returned count`.
2. **בנייה שנקטעה באמצע.** המצופה: הרצה חוזרת ממשיכה מהמטמון, בלי לשלוח שוב בקשות שכבר הצליחו. → Task 2, הבדיקה `cache hit makes no request`.
3. **כותרות עם תווי Unicode:** `…And Justice for All` עם תו שלוש-נקודות, ו-`Self‐Destruct` עם מקף U+2010. המצופה: אין כפילויות, והתצוגה תקינה. → Task 1, הבדיקה `dedupes unicode variants`.
4. **קובץ של ז'אנר שנכשל בטעינה, או ש-`index.json` מפנה לקובץ שלא קיים.** המצופה: מוגרל ז'אנר אחר. הודעת שגיאה מופיעה רק אם הכול נכשל. → Task 4, הבדיקה `a missing genre file falls back to another genre`.
5. **שני פריטים עם אותו טקסט,** למשל שני שירים בשם "Intro" של אותה להקה, או שתי להקות בשם Nirvana. המצופה: הם לא יופיעו כזוג. → Task 4, הבדיקה `never pairs items with the same displayed text`.

## מבנה הקבצים

| קובץ | אחריות |
|---|---|
| `tools/build-lib.mjs` | `GENRES`, `slugify`, `isMainTag`, `pickArtists`, `studioAlbums`, `genreFiles`. פונקציות טהורות |
| `tools/fetcher.mjs` | `createFetcher`: תור, מטמון על הדיסק, ניסיונות חוזרים ו-User-Agent |
| `tools/build-data.mjs` | `buildAll` ו-`writeData`, ונקודת כניסה להרצה מהשורה (CLI) |
| `data/**` | הפלט, שנכנס ל-git |
| `js/data-source.js` | `createDataSource`: טעינה עצלה של `data/` |
| `js/questions.js` | התאמה למקור החדש, ושני פריטים עם טקסט שונה |
| `js/main.js`, `js/config.js`, `index.html`, `css/style.css` | החיבור, ניקוי, favicon ו-`touch-action` |
| נמחקים | `js/http.js`, `js/music-sources.js`, `tests/http.test.js`, `tests/music-sources.test.js`, `tests/fixtures/mb-*.json` |

---

### Task 1: פונקציות טהורות לבנייה

**Files:**
- Create: `tools/build-lib.mjs`
- Modify: `.gitignore` (הוספת `.cache/`)
- Test: `tests/build-lib.test.js`

**Interfaces:**
- Consumes: `normalizeTitle`, `isStudioAlbum` מ-`js/filters.js`.
- Produces:
  - `GENRES: string[]`. אותן 18 תגיות שב-`js/config.js` היום, ועוברות לכאן.
  - `slugify(name: string): string`
  - `isMainTag(tags: {name: string, count: number}[] | undefined, genre: string, maxRank = 5): boolean`
  - `pickArtists(candidates: MbArtist[], scores: Map<string, number>, genre: string, n = 30): {id: string, name: string}[]`
  - `studioAlbums(releases: MbRelease[]): {title: string, year: number, songs: string[]}[]`, ממוין לפי שנה.
  - `genreFiles(entries: {name: string, albums: {title, year, songs}[]}[]): { artists: string[], albums: [string, [string, number][]][], songs: [string, [string, number, string[]][]][] }`

- [ ] **Step 1: כתוב בדיקות שנכשלות:**
  - **`slugify`:**
    - `'thrash metal'` → `'thrash-metal'`
    - `'new wave of british heavy metal'` → `'new-wave-of-british-heavy-metal'`
  - **`isMainTag`:**
    - `true` כש-`thrash metal` הוא אחת מ-5 התגיות עם ה-count הגבוה ביותר.
    - `false` כשהוא במקום השביעי.
    - `false` כש-`tags` הוא `undefined`.
    - ההשוואה לא תלויה באותיות גדולות או קטנות.
  - **`pickArtists`:**
    - מסנן אמן שהשם שלו בעברית.
    - מסנן אמן שהתגית לא ראשית אצלו.
    - מסנן אמן עם ציון 0.
    - ממיין לפי ציון ומחזיר לכל היותר `n`, בצורה `{id, name}`.
  - **`studioAlbums`:** הקלט הוא הוצאות בצורת התשובה האמיתית (`release-group` עם `primary-type` ו-`secondary-types`, `date` ו-`media[].tracks[].title`).
    - מחזיר אלבום אחד לכל release-group, מההוצאה עם ה-`date` המוקדם ביותר. השנה נלקחת מ-`release-group['first-release-date']`.
    - מדלג על release-group עם `secondary-types: ['Live']`.
    - מדלג על הכותרת `Greatest Hits`.
    - מדלג על מדיה בפורמט `DVD-Video`.
    - **מסנן את השירים** `'Battery (demo)'`, `'Orion - Live'` ו-`'Fade to Black (live)'`.
    - **משאיר את השיר** `'Live Wire'`.
    - **`dedupes unicode variants`:** `'...And Justice for All'` ו-`'…And Justice for All'` נספרים כאלבום אחד, והמוקדם נשאר.
  - **`genreFiles`:** קלט של שני אמנים, כל אחד עם שני אלבומים, נותן בדיוק את המבנה המקונן מ-§7 ב-spec, בסדר שבו האמנים נכנסו.

- [ ] **Step 2: הרץ** `node --test tests/build-lib.test.js`. מצופה: FAIL, כי המודול לא קיים.

- [ ] **Step 3: ממש את `tools/build-lib.mjs`.**
  - התבנית של שיר שאינו שיר רגיל: `/[([]\s*[^)\]]*\b(demo|live|remix|instrumental|karaoke)\b[^)\]]*[)\]]|\s-\s.*\b(demo|live|remix|instrumental|karaoke)\b/i`.
  - כפילויות שירים באותו אלבום מוסרות לפי `normalizeTitle`.

- [ ] **Step 4: הרץ** `npm test`. מצופה: הכול עובר.

- [ ] **Step 5: Commit ו-push**
  ```bash
  git add tools/build-lib.mjs tests/build-lib.test.js .gitignore && git commit -m "Build: pure selection and shaping functions for the static data" && git push
  ```

---

### Task 2: שליפה עם מטמון, וה-pipeline

**Files:**
- Create: `tools/fetcher.mjs`, `tools/build-data.mjs`, `tests/fixtures/build/*.json`
- Test: `tests/fetcher.test.js`, `tests/build-data.test.js`

**Interfaces:**
- Consumes: הכול מ-Task 1.
- Produces:
  - `createFetcher({ cacheDir: string, userAgent: string, fetchImpl?, sleep?, now?, minIntervalMs = 1100, maxAttempts = 5 }) → { getJson(url: string): Promise<any>, postJson(url: string, body: object): Promise<any>, stats: { network: number, cached: number } }`
  - `buildAll({ fetcher, genres = GENRES, perGenre = 30, log = () => {} }) → Promise<{ index: object, files: Map<string, any> }>`. המפתחות במפה הם, למשל, `'artists/thrash-metal.json'`.
  - `writeData(dir: string, result): Promise<void>`
  - **הכתובות** שב-pipeline:
    - חיפוש: `https://musicbrainz.org/ws/2/artist?fmt=json&limit=100&query=tag:"<genre>" AND (type:group OR type:person) AND NOT country:IL`
    - פופולריות: `POST https://api.listenbrainz.org/1/popularity/artist` עם `{artist_mbids}`
    - הוצאות: `https://musicbrainz.org/ws/2/release?fmt=json&artist=<id>&status=official&type=album&inc=recordings+release-groups&limit=100&offset=<n>`

- [ ] **Step 1: כתוב בדיקות שנכשלות ל-fetcher** (שעון מזויף, `fetchImpl` מזויף, ו-`cacheDir` בתיקייה זמנית):
  - **`sends user agent`:** ה-header ‏`User-Agent` שווה לערך שהועבר.
  - **`spaces requests by 1100ms`:** שתי בקשות `getJson` במקביל מתחילות לפחות 1100 מילישניות אחת אחרי השנייה.
  - **`cache hit makes no request`:** קוראים `getJson(url)` פעמיים, ו-fetch נקרא פעם אחת. גם fetcher חדש עם אותו `cacheDir` לא שולח בקשה. **(Review Focus 2)**
  - **`postJson caches by url and body`:** אותה כתובת עם גוף אחר שולחת בקשה חדשה.
  - **`retries 503`:** אחרי 503 ואז 200 מתקבלת התוצאה, ו-sleep נקרא עם 2000.
  - **`does not cache errors`:** אחרי 404 נזרקת שגיאה, ואין קובץ במטמון.

- [ ] **Step 2: כתוב בדיקות שנכשלות ל-`buildAll`.** ה-fetcher מזויף ועונה לפי ה-URL מתוך `tests/fixtures/build/`. הקבצים שם קטנים, בצורת התשובות האמיתיות שראינו בבדיקות (§5 ב-spec).
  - **`builds nested files for one genre`:** עם `genres: ['thrash metal']` ו-`perGenre: 2`, יוצאים בדיוק 3 קבצים ו-`index.json` עם `counts`.
  - **`pages by returned count`:**
    - עמוד ראשון מחזיר 2 הוצאות, עם `release-count: 5`.
    - השני מתבקש עם `offset=2` ומחזיר 2.
    - השלישי מתבקש עם `offset=4` ומחזיר 1, ואז הלולאה עוצרת.
    - **(Review Focus 1)**
  - **`fetches each artist once across genres`:** אמן ששייך לשני ז'אנרים מקבל בקשת הוצאות אחת.
  - **`drops a genre with fewer than 5 artists`:** הז'אנר לא מופיע ב-`index.json`, ולא נכתבים לו קבצים.

- [ ] **Step 3: הרץ** `node --test tests/fetcher.test.js tests/build-data.test.js`. מצופה: FAIL.

- [ ] **Step 4: ממש את `tools/fetcher.mjs` ואת `tools/build-data.mjs`.**
  - **המטמון:** הקובץ נקרא `<sha1(url + body)>.json` בתוך `cacheDir`.
  - **ה-CLI** מופעל כש-`import.meta.url === pathToFileURL(process.argv[1]).href`:
    - `cacheDir` הוא `.cache/http`, והפלט נכתב ל-`data/`.
    - התקדמות מודפסת עם `log`: ז'אנר, אמן ומספר העמוד.
    - בסוף מודפס סיכום ספירות לכל ז'אנר, ו-`stats`.

- [ ] **Step 5: הרץ** `npm test`. מצופה: הכול עובר.

- [ ] **Step 6: Commit ו-push**
  ```bash
  git add tools/ tests/fetcher.test.js tests/build-data.test.js tests/fixtures/build && git commit -m "Build: cached polite fetcher and data pipeline" && git push
  ```

---

### Task 3: הרצת הבנייה האמיתית וכיוון סינון הרעש

**Files:**
- Create: `data/**`, שנוצר על ידי הסקריפט.
- Modify: `tools/build-lib.mjs`, רק אם `maxRank` צריך כיוון.

- [ ] **Step 1: הרצת ניסיון על ז'אנר אחד**
  - הרץ: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node tools/build-data.mjs --genres "thrash metal"`
  - **מצופה:**
    - הסקריפט מסתיים.
    - ב-`data/artists/thrash-metal.json` יש בין 25 ל-30 שמות, ו-Metallica, Slayer ו-Megadeth ביניהם.
    - Poison לא נמצא שם.
  - **אם יש רעש או חוסר:** משנים את `maxRank`, מריצים שוב (המטמון חוסך את הבקשות), ורושמים Ruling.
  - כדי לתמוך ב-`--genres`, ה-CLI מקבל רשימה מופרדת בפסיקים.

- [ ] **Step 2: הרצה מלאה, ברקע**
  - הרץ: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node tools/build-data.mjs > .cache/build.log 2>&1`
  - מריצים עם `run_in_background`, ומעקב דרך `tail` על הלוג.
  - **מצופה:**
    - הסקריפט מסתיים תוך כשעה.
    - ב-`index.json` מופיעים לפחות 15 ז'אנרים.
    - אין שגיאות בסוף הלוג.

- [ ] **Step 3: בדוק גדלים**
  - הרץ: `for f in data/*/*.json; do printf "%s %s\n" "$(gzip -9c $f | wc -c)" "$f"; done | sort -n | tail -5`
  - **מצופה:**
    - הקובץ הגדול ביותר קטן מ-40KB אחרי דחיסה.
    - אם יש קובץ גדול יותר: רושמים Ruling ומדווחים למשתמש. לא מקצצים נתונים בלי לשאול.

- [ ] **Step 4: בדוק עברית ומבנה**
  - הרץ: `grep -lP "[\x{0590}-\x{05FF}]" -r data/`
  - **מצופה:** אין פלט.

- [ ] **Step 5: Commit ו-push**
  ```bash
  git add data && git commit -m "Data: one-time static music database (30 artists per genre)" && git push
  ```

---

### Task 4: האתר קורא מהמאגר

**Files:**
- Create: `js/data-source.js`, `tests/data-source.test.js`
- Modify: `js/questions.js`, `tests/questions.test.js`, `js/main.js`, `js/config.js`, `index.html`, `css/style.css`, `tests/e2e.mjs`, `README.md`
- Delete: `js/http.js`, `js/music-sources.js`, `tests/http.test.js`, `tests/music-sources.test.js`, `tests/fixtures/mb-*.json`

**Interfaces:**
- Consumes: הקבצים ב-`data/` מ-Task 3, ו-`normalizeTitle` מ-`js/filters.js`.
- Produces:
  - `createDataSource({ fetchImpl?, base = 'data/' } = {}) → { genres(): Promise<string[]>, bands(genre): Promise<Item[]>, albums(genre): Promise<Item[]>, songs(genre): Promise<Item[]> }`
    - `genre` הוא השם שמוצג. ה-slug נמצא דרך `index.json`.
    - כל קובץ נטען פעם אחת. Promise שנכשל נמחק מהזיכרון.
    - **צורת הפריטים:**
      - להקה: `{ id, title }`
      - אלבום: `{ id, title, artist, year }`
      - שיר: `{ id, title, artist, year }`
    - **המזהה:** `${type}|${normalizeTitle(artist || '')}|${normalizeTitle(title)}`
  - `createQuestionMaker({ sources, random = Math.random, maxTries = 5 })`. אין יותר פרמטר `genres`, כי הרשימה מגיעה מ-`await sources.genres()`.
  - `config.js` מייצא רק את `PREFETCH = 2` ואת `CHOICE_FLASH_MS = 350`.

- [ ] **Step 1: כתוב בדיקות שנכשלות ל-`data-source`** (עם `fetchImpl` מזויף):
  - **`loads index once and maps name to slug`:** `bands('thrash metal')` מבקש את `data/artists/thrash-metal.json`. גם אחרי שתי קריאות, `index.json` נטען פעם אחת.
  - **`flattens nested albums and songs`:** שני אלבומים עם שלושה שירים בסך הכול נותנים 2 אלבומים ו-3 שירים, בצורת הפריטים שלמעלה.
  - **`failed file is retried`:** הקריאה הראשונה נכשלת, והשנייה מצליחה.

- [ ] **Step 2: עדכן את `tests/questions.test.js`.** `fakeSources` מקבל `genres()`, ושאלת שירים קוראת ל-`songs(genre)`. בדיקות חדשות:
  - **`never pairs items with the same displayed text`:** ברשימה יש שלושה שירים: שניים בשם "Intro" של אותה להקה, ואחד בשם "Battery". אם הוגרלו שני ה-"Intro", הזוג נפסל, ובסופו של דבר אחד הצדדים הוא "Battery". **(Review Focus 5)**
  - **`a missing genre file falls back to another genre`:** `songs('g1')` נדחה, ו-`songs('g2')` מחזיר שלושה שירים. נוצרת שאלה מ-g2, בלי שגיאה. **(Review Focus 4)**

- [ ] **Step 3: הרץ** `npm test`. מצופה: הבדיקות החדשות נכשלות.

- [ ] **Step 4: ממש את `js/data-source.js` ועדכן את `js/questions.js`.**
  - כש-`sources.*` נדחה, זה נחשב כמו ז'אנר עם פחות מ-2 פריטים: מנסים ז'אנר אחר, ונרשם `console.warn`.
  - שני פריטים נחשבים זהים בתצוגה כשה-`title` וה-`artist` שלהם זהים.

- [ ] **Step 5: חבר את האתר.**
  - **`main.js`:** משתמש ב-`createDataSource()`, ומוחקים ממנו את ה-imports של http ו-music-sources.
  - **מחיקות:** מוחקים את הקבצים שברשימת Delete, ו-`config.js` מצומצם לשני הקבועים.
  - **`index.html`:** מוסיפים `<link rel="icon" href="data:,">`.
  - **`css/style.css`:** מוסיפים `touch-action: manipulation` ל-`.option`.
  - **`README.md`:**
    - הסבר על המאגר, ואיך בונים אותו מחדש: הפקודה מ-Task 3, בלי משתני ה-proxy מחוץ לסביבה הזו.
    - שורת רישיון: נתוני MusicBrainz הם CC0, ותגיות הז'אנר הן CC BY-NC-SA.
    - שלב התקנה לבדיקות הדפדפן: `npx playwright install chromium`.

- [ ] **Step 6: עדכן את `tests/e2e.mjs`.**
  - **מוחקים** את ה-routes של MusicBrainz ושל ListenBrainz.
  - **ה-route החדש** הוא `**/data/**`:
    - במצב `fail` מחזיר 500.
    - במצב `slow` מעכב 3 שניות.
    - במצב `ok` נותן לבקשה לעבור לשרת הסטטי עם `route.continue()`.
  - **בדיקה חדשה, `never contacts MusicBrainz`:** סופרים בקשות ל-`musicbrainz.org` ול-`listenbrainz.org` לאורך 5 שאלות. מצופה: 0.
  - ההמתנה של 8 שניות בבדיקת הלחיצה הכפולה מתקצרת ל-2 שניות.

- [ ] **Step 7: הרץ** `npm test && npm run e2e`. מצופה: הכול עובר, כולל 9 בדיקות בדפדפן.

- [ ] **Step 8: בדוק משקל**
  - הרץ: `cat index.html css/style.css js/*.js | gzip -9 | wc -c`
  - מצופה: פחות מ-8000. הקוד מתכווץ, כי שכבת ה-HTTP יוצאת.

- [ ] **Step 9: Commit ו-push**
  ```bash
  git add -A && git commit -m "Site: read questions from the static data; remove live fetching" && git push
  ```

---

## אחרי הכול

1. סקירה סופית של כל הענף.
2. הצגת בדיקת האיכות למשתמש (§9 ב-spec):
   - 30 האמנים של כל ז'אנר.
   - מספר האלבומים והשירים בכל ז'אנר.
   - מדגם אלבומים של 2–3 להקות.
3. **מיזוג ל-`main` רק אחרי האישור שלו.**
