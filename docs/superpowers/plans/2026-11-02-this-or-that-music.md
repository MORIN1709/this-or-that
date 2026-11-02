# תוכנית מימוש: "זה או זה" ברוק ומטאל

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** אתר סטטי של משחק "זה או זה" ברוק ומטאל. כל שאלה נבנית בזמן אמת מ-MusicBrainz, אחרי סינון פופולריות ב-ListenBrainz. הדפים: להקה מול להקה, אלבום מול אלבום, שיר מול שיר, בלי סוף, עם כפתור איפוס.

**Architecture:** עמוד HTML אחד שטוען מודולי ES רגילים, בלי build. יש שכבת HTTP (תור לבקשות MusicBrainz וקליינט פופולריות ל-ListenBrainz), ומעליה מקורות מוזיקה שנשמרים בזיכרון לפי ז'אנר. מעל המקורות יש יוצר שאלות, ומעליו מנוע משחק שמחזיק תור שאלות שנשלפו מראש ומונע כפילויות. ה-UI הוא קובץ אחד שמחבר את הכול.

**Tech Stack:** HTML, CSS, JavaScript (ES modules), בלי ספריות. בדיקות יחידה עם `node:test` (Node 22). בדיקת קצה-לקצה עם Playwright, שמותקן מראש בסביבה, כש-API מדומה דרך `page.route`.

**Spec:** `docs/design.md` (בעיקר סעיפים 5, 7 ו-9)

## Global Constraints

- בלי ספריות ובלי framework ובלי שלב build. המקור הוא הקבצים שנשלחים כמו שהם. שימוש ב-`<script type="module">`.
- המשקל שנשלח לדפדפן (`index.html`, `css/`, `js/`) צריך להיות בערך 10–15KB. סף קשיח: פחות מ-20KB לפני דחיסה.
- אין רשימות נתונים בקוד. החריג היחיד הוא רשימת תגיות הז'אנר ב-`js/config.js`.
- MusicBrainz: כל הבקשות עוברות בתור אחד, עם לפחות 1050ms בין התחלה של בקשה להתחלה של הבאה. על 503 או 429 מנסים שוב עד 4 ניסיונות, עם המתנה של `2000 * (attempt + 1)` מילישניות.
- ListenBrainz: משתמשים רק ב-`POST https://api.listenbrainz.org/1/popularity/{artist|release-group|recording}`. אסור להשתמש ב-`top-*-for-artist`, ב-`lb-radio` או בכל endpoint שדורש מפתח. אין מפתחות בקוד.
- ממשק בעברית ו-RTL (`<html lang="he" dir="rtl">`). שמות הפריטים מוצגים כמו שהם, באנגלית, בתוך אלמנט עם `dir="auto"`.
- בלי תמונות. בלי ניקוד, בלי סיבובים, בלי שמירת בחירות. אין `localStorage`.
- רק ז'אנרים של רוק ומטאל.
- **שליפה מראש (החלטת המשתמש):** תמיד יש 2 שאלות מוכנות מראש (`PREFETCH = 2`).
  - שולפים את שאלה 1 ומציגים אותה.
  - בזמן שהמשתמש עונה, שולפים את שאלות 2 ו-3.
  - אחרי שהמשתמש עונה על שאלה 1, שולפים את שאלה 4, וכן הלאה.
- **כפילויות (החלטת המשתמש):**
  - כל השאלות של הסיבוב הנוכחי נשמרות בזיכרון, עד שלוחצים איפוס.
  - שאלה שהזוג שלה כבר נשאל בסיבוב נשלפת מחדש, **בלי הגבלת ניסיונות**, עד שיוצאת שאלה שלא נשאלה.
- איפוס מנקה את ההיסטוריה ואת השאלות שנשלפו מראש, ומתחיל רצף חדש.
- **להקות ואמנים (החלטת המשתמש):** שאלת "להקות" כוללת גם אמני סולו.
- **שירים (החלטת המשתמש):** אפשר להציג כל שיר מאלבום פופולרי בז'אנר, לא רק את המובילים.
- שגיאת API מציגה הודעה בעברית וכפתור "נסה שוב".
- **לא עושים commit ולא push** עד שהמשתמש מבקש. התיקייה עדיין לא מאגר git.

## צורות התשובה של ה-API (הנחה שלא אומתה מול שרת חי)

הצורות האלה נלקחו מהתיעוד ומפרויקטים קיימים (סעיף 9 ב-spec). ה-fixtures בבדיקות בנויים לפיהן. הקוד צריך לטפל במערך חסר כמו במערך ריק, ולא לקרוס.

```text
MB  GET /ws/2/artist?query=…&fmt=json&limit=100&offset=0
    → { count, offset, artists: [ { id, name, type, score } ] }
MB  GET /ws/2/release-group?query=…&fmt=json&limit=100&offset=0
    → { count, offset, "release-groups": [ { id, title, "primary-type", "secondary-types"?: [..],
          "first-release-date"?: "1986-03-03", "artist-credit": [ { name, joinphrase? } ],
          releases?: [ { id, status? } ] } ] }
MB  GET /ws/2/release-group/{id}?inc=releases&fmt=json
    → { id, releases: [ { id, status?, date? } ] }
MB  GET /ws/2/release/{id}?inc=recordings&fmt=json
    → { id, media: [ { format?, tracks: [ { title, recording: { id, title } } ] } ] }
LB  POST /1/popularity/{entity}   body { "<entity_with_underscore>_mbids": [..] }
    → [ { "<entity_with_underscore>_mbid": id, total_listen_count: n|null, total_user_count: n|null } ]
```

## מבנה הקבצים

| קובץ | אחריות |
|---|---|
| `index.html` | המבנה, הטקסטים בעברית וטעינת `js/main.js` |
| `css/style.css` | עיצוב mobile-first ו-RTL |
| `js/config.js` | רשימת הז'אנרים והקבועים |
| `js/http.js` | `createMbClient`, `createLbClient`, `ApiError` |
| `js/filters.js` | פונקציות טהורות: נרמול, סינון אלבומי אולפן, הסרת כפילויות, דירוג |
| `js/music-sources.js` | שליפת להקות, אלבומים ושירים לכל ז'אנר, עם זיכרון |
| `js/questions.js` | `createQuestionMaker` ו-`pairKey`. לא תלוי ב-DOM |
| `js/game.js` | `createGame`: שליפה מראש, מניעת כפילויות ואיפוס. לא יודע שמדובר במוזיקה, כך שאפשר להוסיף קטגוריות |
| `js/main.js` | חיבור כל החלקים ל-DOM |
| `package.json` | `"type": "module"` וסקריפטים לבדיקות. אין תלויות, והוא לא נטען בדפדפן |
| `tests/*.test.js`, `tests/fixtures/*.json`, `tests/e2e.mjs` | בדיקות |
| `README.md` | איך מריצים בדיקות, איך מעלים ל-GitHub Pages ואיך בודקים בדפדפן |

---

### Task 1: שכבת HTTP

**Files:**
- Create: `package.json`, `js/http.js`
- Test: `tests/http.test.js`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { service: 'musicbrainz'|'listenbrainz'; status: number }`
  - `createMbClient({ fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, minIntervalMs = 1050, maxAttempts = 4, timeoutMs = 15000 } = {}) → { get(path: string, params?: Record<string, string|number>): Promise<any> }`
  - `createLbClient({ fetchImpl = fetch, timeoutMs = 15000 } = {}) → { popularity(entity: 'artist'|'release-group'|'recording', mbids: string[]): Promise<Map<string, number>> }`, כאשר הערך במפה הוא `total_user_count`, ו-`null` נהפך ל-0.

- [ ] **Step 1: צור את `package.json`**
  ```json
  { "name": "this-or-that", "private": true, "type": "module",
    "scripts": { "test": "node --test tests/", "e2e": "node tests/e2e.mjs" } }
  ```

- [ ] **Step 2: כתוב בדיקות שנכשלות ב-`tests/http.test.js`** עם `fetchImpl`, `sleep` ו-`now` מזויפים. השעון המזויף מתקדם כש-`sleep(ms)` נקרא.
  - `mb.get builds URL with fmt=json and params`: אחרי `get('/artist', { query: 'tag:"grunge"', limit: 100, offset: 0 })`, ה-URL שנשלח מתחיל ב-`https://musicbrainz.org/ws/2/artist?`, ו-`searchParams` מכיל `fmt=json`, `query=tag:"grunge"`, `limit=100` ו-`offset=0`. ה-header ‏`Accept` הוא `application/json`.
  - `mb.get spaces requests by 1050ms`: שתי קריאות במקביל. ה-fetch השני מתחיל בזמן המזויף ≥ 1050 אחרי הראשון.
  - `mb.get retries 503 then succeeds`: התשובות הן 503 ואחריה 200 `{ok:1}`. התוצאה היא `{ok:1}`, ו-`sleep` נקרא עם 2000.
  - `mb.get throws ApiError after 4 x 503`: ה-Promise נדחה עם `ApiError` שבו `status === 503`, ו-fetch נקרא 4 פעמים.
  - `mb.get does not retry 404`: נדחה עם `ApiError` שבו `status === 404`, ו-fetch נקרא פעם אחת.
  - `lb.popularity posts batch`: עבור `popularity('release-group', ['a','b'])`, נשלח `POST` ל-`https://api.listenbrainz.org/1/popularity/release-group` עם `Content-Type: application/json` וגוף `{"release_group_mbids":["a","b"]}`. התשובה היא `[{release_group_mbid:'a', total_user_count:7}, {release_group_mbid:'b', total_user_count:null}]`, והמפה שיוצאת היא `a→7, b→0`.
  - `lb.popularity with empty list makes no request`: מחזיר מפה ריקה, ו-fetch לא נקרא.

- [ ] **Step 3: הרץ** `node --test tests/http.test.js`. מצופה: FAIL, כי המודול לא קיים.

- [ ] **Step 4: ממש את `js/http.js`.**
  - התור בנוי כשרשרת Promise, כמו בקטע הקוד בסעיף 9.1 ב-spec.
  - ה-timeout ממומש עם `AbortController`.
  - שגיאת רשת (fetch נדחה) נזרקת הלאה בלי ניסיון חוזר.
  - ב-ListenBrainz חותכים ל-1000 מזהים.

- [ ] **Step 5: הרץ** `node --test tests/http.test.js`. מצופה: PASS.

---

### Task 2: פונקציות סינון ודירוג

**Files:**
- Create: `js/filters.js`
- Test: `tests/filters.test.js`

**Interfaces:**
- Produces:
  - `normalizeTitle(title: string): string`
  - `isStudioAlbum(rg: object): boolean`
  - `dedupeAlbums(albums: Album[]): Album[]`, כאשר `Album = { id, title, artist, year? }`
  - `topByScore<T extends {id}>(items: T[], scores: Map<string, number>, n: number): T[]`

- [ ] **Step 1: כתוב בדיקות שנכשלות:**
  - `normalizeTitle`:
    - `'Master of Puppets (Remastered)'` → `'master of puppets'`
    - `'Ride the Lightning [Deluxe Edition]'` → `'ride the lightning'`
    - `'...And Justice for All'` → `'and justice for all'`
  - `isStudioAlbum` מחזיר `true` עבור `{title:'Paranoid', 'first-release-date':'1970-09-18', 'secondary-types':[]}`.
  - `isStudioAlbum` מחזיר `false` עבור:
    - `'secondary-types':['Live']`
    - חוסר ב-`first-release-date`
    - הכותרות `'Greatest Hits'`, `'Live at Wembley'` ו-`'1995-06-10: Cabaret Metro'`
  - `dedupeAlbums`: שני פריטים עם artist `'Metallica'`, אחד `'Master of Puppets'` משנת 1986 ואחד `'Master of Puppets (Remastered)'` משנת 2017. נשאר אחד, זה של 1986.
  - `topByScore`:
    - פריטים `a, b, c, d` עם ציונים `a→5, b→50, c→0`, ול-`d` אין ציון. עבור `n=2` התוצאה היא `[b, a]`.
    - פריטים עם ציון 0 או בלי ציון לא נכנסים לעולם.

- [ ] **Step 2: הרץ** `node --test tests/filters.test.js`. מצופה: FAIL.

- [ ] **Step 3: ממש את `js/filters.js`.**
  - אפשר לקחת את הביטויים הרגולריים מ-`NOT_STUDIO_TITLE` ומ-`CONCERT_TITLE` בפרויקט disco-da-vez (סעיף 9.2 ב-spec).
  - `normalizeTitle` מסירה סוגריים ואת המילים deluxe, remaster(ed), expanded, anniversary, edition, version, bonus ו-reissue. אחר כך היא משאירה רק `a-z0-9` ורווחים בודדים.

- [ ] **Step 4: הרץ.** מצופה: PASS.

---

### Task 3: מקורות המוזיקה

**Files:**
- Create: `js/config.js`, `js/music-sources.js`, `tests/fixtures/` (קבצי JSON קטנים לפי הצורות למעלה)
- Test: `tests/music-sources.test.js`

**Interfaces:**
- Consumes: `mb.get` ו-`lb.popularity` מ-Task 1, ופונקציות הסינון מ-Task 2.
- Produces:
  - `js/config.js` מייצא:
    - `GENRES: string[]`, בדיוק הרשימה הזו: `'classic rock','hard rock','heavy metal','thrash metal','grunge','punk rock','progressive rock','progressive metal','doom metal','death metal','black metal','alternative rock','alternative metal','nu metal','glam metal','power metal','stoner rock','new wave of british heavy metal'`
    - `CANDIDATE_OFFSETS = [0, 100]`
    - `PAGE_LIMIT = 100`
    - `TOP_N = 40`
    - `PREFETCH = 2`
    - `CHOICE_FLASH_MS = 350`
  - `createMusicSources({ mb, lb }) → { bands(tag): Promise<Item[]>, albums(tag): Promise<Album[]>, songsFromAlbum(album: Album): Promise<Item[]> }`
    - `Item = { id, title, artist?, year? }`
    - כל פונקציה שומרת בזיכרון לפי מפתח (tag או album.id) את ה-Promise עצמו. Promise שנדחה נמחק מהזיכרון.

- [ ] **Step 1: כתוב בדיקות שנכשלות** עם `mb` ו-`lb` מזויפים. הם רושמים את הקריאות ומחזירים fixtures.
  - **`bands`:**
    - יש שתי קריאות `mb.get('/artist', { query: 'tag:"thrash metal" AND (type:group OR type:person)', limit: 100, offset: 0|100 })`.
    - הסינון הזה כולל להקות ואמני סולו, ומוציא תזמורות, מקהלות ודמויות.
    - מזהים מתקבצים, בלי כפילויות, לקריאה אחת `lb.popularity('artist', ids)`.
    - התוצאה ממוינת לפי ציון, באורך עד `TOP_N`, ובצורה `{id, title: name}`.
  - **`bands` memoizes:** שתי קריאות ל-`bands('grunge')` גורמות לשתי קריאות MB בלבד, ולא לארבע.
  - **`bands` retries after failure:** הקריאה הראשונה נכשלת והשנייה מצליחה. הזיכרון לא שמר את הכישלון.
  - **`albums`:**
    - השאילתה היא `'tag:"thrash metal" AND primarytype:album AND status:official'` על `/release-group`.
    - הופעה חיה ואוסף ב-fixture מסוננים.
    - כפילות של רמאסטר מוסרת.
    - `artist` הוא חיבור של `name` ו-`joinphrase` מ-`artist-credit`.
    - `year` הם 4 התווים הראשונים של `first-release-date`.
    - הדירוג הוא דרך `lb.popularity('release-group', …)`.
  - **`songsFromAlbum`:**
    - קודם קוראים ל-`mb.get('/release-group/<id>', { inc: 'releases' })`, ובוחרים את ההוצאה שה-status שלה `Official` עם ה-`date` המוקדם ביותר. אם אין, לוקחים את הראשונה. ההוצאה המקורית נבחרת כדי להימנע ממהדורות דלוקס עם שירי בונוס.
    - אחר כך קוראים ל-`mb.get('/release/<releaseId>', { inc: 'recordings' })`.
    - media שה-format שלו מתאים ל-`/dvd|blu-?ray|video/i` מדולג.
    - שירים שהכותרת שלהם מתאימה ל-`/\b(demo|live|instrumental|karaoke|remix)\b/i` מדולגים.
    - מוחזרים **כל** השירים שנשארו, בלי סינון פופולריות ובלי קריאה ל-ListenBrainz.
    - כל שיר מוחזר בצורה `{id: recording.id, title: track.title, artist: album.artist, year: album.year}`.
  - **missing arrays:** אם `artists` או `release-groups` או `media` חסרים בתשובה, מוחזר `[]` ולא נזרקת שגיאה. (Review Focus 1)

- [ ] **Step 2: הרץ** `node --test tests/music-sources.test.js`. מצופה: FAIL.

- [ ] **Step 3: ממש את `js/config.js` ואת `js/music-sources.js`** לפי ה-interfaces והבדיקות.

- [ ] **Step 4: הרץ.** מצופה: PASS.

---

### Task 4: יוצר השאלות

**Files:**
- Create: `js/questions.js`
- Test: `tests/questions.test.js`

**Interfaces:**
- Consumes: `createMusicSources` מ-Task 3, ו-`GENRES` מ-config.
- Produces:
  - `QUESTION_TYPES = ['band', 'album', 'song']`
  - `Question = { type: 'band'|'album'|'song', genre: string, a: Item, b: Item }`
  - `pairKey(q: Question): string`: שני ה-id ממוינים ומחוברים ב-`'|'`.
  - `createQuestionMaker({ sources, genres, random = Math.random, maxTries = 3 }) → { makeQuestion(): Promise<Question> }`

- [ ] **Step 1: כתוב בדיקות שנכשלות** עם `random` דטרמיניסטי (פונקציה שמחזירה ערכים מתוך מערך) ועם `sources` מזויף.
  - `pairKey` של `{a:{id:'y'}, b:{id:'x'}}` הוא `'x|y'`.
  - `band question`: הסוג שהוגרל הוא `band`. התוצאה כוללת `type:'band'` ואת ה-genre שהוגרל, ו-`a.id !== b.id`. שני הפריטים מגיעים מ-`sources.bands(genre)`.
  - `album question`: שני אלבומים שונים מ-`sources.albums(genre)`.
  - `song question`:
    - מוגרלים שני אלבומים שונים, ונקראת `songsFromAlbum` על כל אחד מהם.
    - `a` הוא שיר אקראי מהאלבום הראשון, ו-`b` שיר אקראי מהאלבום השני.
    - אם יש רק אלבום אחד, יוצאים שני שירים שונים ממנו.
  - `retries another genre when < 2 items`: ה-genre הראשון מחזיר `[]` והשני מחזיר שלושה פריטים. נוצרת שאלה מה-genre השני.
  - `throws after maxTries`: כל ה-genres מחזירים `[]`. נזרקת שגיאה.

- [ ] **Step 2: הרץ.** מצופה: FAIL.

- [ ] **Step 3: ממש את `js/questions.js`.** סדר ההגרלה הוא type, אחר כך genre, ואז בחירת פריטים. אחר כך הסדר בין `a` ל-`b` מוגרל, כך שהפריט ה"פופולרי יותר" לא תמיד מופיע בצד א'.

- [ ] **Step 4: הרץ.** מצופה: PASS.

---

### Task 5: מנוע המשחק (שליפה מראש, כפילויות, איפוס)

**Files:**
- Create: `js/game.js`
- Test: `tests/game.test.js`

**Interfaces:**
- Consumes: `makeQuestion(): Promise<Question>` ו-`pairKey` מ-Task 4.
- Produces: `createGame({ makeQuestion, pairKey, prefetch = 2, yieldFn = () => new Promise(r => setTimeout(r, 0)) }) → { next(): Promise<Question>, reset(): void }`

**ההתנהגות (לפי הזרימה שהמשתמש הגדיר):**
- `next()` מחזיר את השאלה הראשונה בתור, ואז ממלא את התור כך שיהיו בו `prefetch` שאלות בדרך. בקריאה הראשונה, Q1 מוצג, ו-Q2 ו-Q3 נשלפות. אחרי כל תשובה נשלפת שאלה אחת חדשה.
- מילוי של מקום בתור:
  - קוראים ל-`makeQuestion` שוב ושוב, **בלי הגבלה**, עד שיוצא `pairKey` שלא נמצא בהיסטוריה של הסיבוב.
  - בין ניסיון לניסיון קוראים ל-`await yieldFn()`, כדי שלולאה ארוכה על נתונים שכבר בזיכרון לא תקפיא את הדף.
  - המפתח נוסף להיסטוריה ברגע שהשאלה נכנסת לתור, כך שגם שתי שאלות שבתור לא יהיו זהות.
  - אם `reset()` נקרא באמצע, הלולאה עוצרת.
- `reset()` מנקה את ההיסטוריה, זורק את התור ומעלה את מונה הדור. שאלה שהגיעה מדור קודם לא תוחזר לעולם.
- אם מילוי נכשל, `next()` נדחה עם השגיאה, והמקום ההוא נזרק. הקריאה הבאה ל-`next()` מתחילה מילוי חדש. Promise שנדחה בתוך התור צריך `.catch(() => {})` כדי שלא תהיה אזהרת unhandled rejection.

- [ ] **Step 1: כתוב בדיקות שנכשלות:**
  - `prefetches`: אחרי `await next()` הראשון, `makeQuestion` נקרא `1 + prefetch` פעמים.
  - `skips duplicate pair`: ה-`makeQuestion` המזויף מחזיר את הזוגות `x|y`, `x|y`, `x|z`. שתי הקריאות הראשונות ל-`next()` מחזירות `x|y` ו-`x|z`.
  - `keeps fetching until not duplicate`: `makeQuestion` מחזיר `x|y` עשר פעמים, ואחר כך `x|z`. הקריאה השנייה ל-`next()` מחזירה `x|z`, ולא חוזרת אף פעם כפולה.
  - `reset drops stale prefetched`: מתחילים עם `next()` שמחזיר את Q1, ו-Q2 עדיין ממתין. קוראים ל-`reset()` ומשחררים את Q2. הקריאה הבאה ל-`next()` מחזירה שאלה שנוצרה אחרי האיפוס, ולא את Q2. (Review Focus 3)
  - `reset clears history`: אחרי איפוס, זוג שכבר הופיע מותר שוב.
  - `error then recovery`: `makeQuestion` נכשל פעם אחת. הקריאה הראשונה ל-`next()` נדחית, והקריאה הבאה מצליחה.

- [ ] **Step 2: הרץ.** מצופה: FAIL.

- [ ] **Step 3: ממש את `js/game.js`.**

- [ ] **Step 4: הרץ** `npm test`. מצופה: כל בדיקות היחידה עוברות.

---

### Task 6: ה-UI, קצה-לקצה ו-README

**Files:**
- Create: `index.html`, `css/style.css`, `js/main.js`, `tests/e2e.mjs`, `README.md`

**Interfaces:**
- Consumes: כל המודולים הקודמים. `main.js` הוא המקום היחיד שמכיר את ה-DOM.

**טקסטים (בדיוק כך):**

| מקום | טקסט |
|---|---|
| כותרת | `זה או זה` |
| תת-כותרת | `רוק ומטאל` |
| שאלת להקה | `איזו להקה או אמן?` |
| שאלת אלבום | `איזה אלבום?` |
| שאלת שיר | `איזה שיר?` |
| בין שני הכפתורים | `או` |
| טעינה | `מביאים שאלה…` |
| שגיאה | `לא הצלחנו להביא שאלה. בדקו את החיבור ונסו שוב.` |
| כפתור ניסיון חוזר | `נסה שוב` |
| כפתור איפוס | `ערבוב מחדש` |
| שורת תחתית | `נתונים: MusicBrainz · פופולריות: ListenBrainz`, כקישורים |

**התנהגות:**
- **תווית ז'אנר:** ה-genre באנגלית מוצג כתגית קטנה ליד השאלה.
- **תוכן הכפתורים:**
  - שורה ראשית: `title`.
  - שורה משנית באלבום: `artist · year`.
  - שורה משנית בשיר: `artist`.
  - שתי השורות בתוך אלמנט עם `dir="auto"`, והטקסט נכנס דרך `textContent`.
- **לחיצה על אפשרות:**
  - שני הכפתורים מקבלים `disabled`, והכפתור שנבחר מקבל class ‏`chosen`.
  - אחרי `CHOICE_FLASH_MS` קוראים ל-`game.next()`.
  - אם השאלה הבאה עוד לא מוכנה, מוצג מצב הטעינה.
- **איפוס:** `game.reset()`, מצב טעינה, ואז `next()`.
- **שגיאה:**
  - מוצגים טקסט השגיאה וכפתור "נסה שוב", שקורא שוב ל-`next()`.
  - `console.warn` עם השגיאה המקורית, כדי שיהיה קל לאבחן בדפדפן של המשתמש.
- **עיצוב:**
  - mobile-first, עם כפתורים גדולים בגובה של לפחות 96px וטקסט שעובר שורה (`overflow-wrap: anywhere`).
  - אין גלילה אופקית ברוחב 360px.
  - צבעים כהים או בהירים לפי `prefers-color-scheme`.

- [ ] **Step 1: כתוב את `tests/e2e.mjs`.**
  - **הכנה:**
    - שרת סטטי קטן עם `node:http` על התיקייה.
    - Chromium דרך `require('playwright')`. ב-ESM משתמשים ב-`createRequire`.
    - viewport ‏`360×740`.
    - `page.route('https://musicbrainz.org/**')` מחזיר fixture לפי ה-path:
      - `/ws/2/artist` → `mb-artists.json`
      - `/ws/2/release-group` עם `query` → `mb-release-groups.json`
      - `/ws/2/release-group/<id>` → `mb-release-group-releases.json`
      - `/ws/2/release/<id>` → `mb-release.json`
    - `page.route('https://api.listenbrainz.org/**')` עונה על preflight (`OPTIONS`), קורא את המזהים מגוף ה-POST, ומחזיר לכל מזהה `total_user_count = 1000 - index`.
    - יש לפחות 6 להקות ו-6 אלבומים. ה-fixtures כוללים פריט אחד עם כותרת של 80 תווים, ואת `'...And Justice for All'`.
  - **בדיקות** (כל אחת עם timeout של 30 שניות, כי התור משאיר רווח של 1050ms בין בקשות):
    1. `loads first question`: תוך 30 שניות מופיעה אחת מהתוויות `איזו להקה או אמן?`, `איזה אלבום?` או `איזה שיר?`, ושני כפתורי אפשרות עם טקסט לא ריק.
    2. `choice advances and disables`: מיד אחרי לחיצה, שני הכפתורים `disabled` (Review Focus 2). אחר כך מוצגת שאלה עם זוג שונה מהקודם.
    3. `double click registers once`: שומרים את הטקסט של השאלה הנוכחית (Q0), מבצעים `dblclick` על אחת האפשרויות, ומחכים עד שהטקסט משתנה (Q1). אחר כך מחכים 1500ms ומוודאים שעדיין מוצג Q1, ולא התקדמנו שאלה נוספת.
    4. `reset loads a question`: לחיצה על `ערבוב מחדש`, ואחריה מופיעה שאלה.
    5. `error then retry`: ה-routes מחזירים 500, ואחרי טעינה מחדש מופיע טקסט השגיאה. ה-routes מוחזרים ל-fixtures, לוחצים `נסה שוב`, ומופיעה שאלה.
    6. `no horizontal scroll`: `document.documentElement.scrollWidth <= window.innerWidth`, גם כשמוצג הפריט הארוך (Review Focus 4).
    7. `option text is dir=auto`: לכל אחד מאלמנטי הטקסט בכפתורים יש `dir="auto"` (Review Focus 5).
    8. `slow network shows loading`: ה-route מעכב 3 שניות, טקסט הטעינה מופיע, ואחר כך מופיעה השאלה.
  - כל כישלון מסתיים ב-`process.exit(1)`.

- [ ] **Step 2: הרץ** `npm run e2e`. מצופה: FAIL, כי `index.html` לא קיים.

- [ ] **Step 3: ממש את `index.html`, `css/style.css` ו-`js/main.js`.**

- [ ] **Step 4: הרץ** `npm run e2e`. מצופה: כל 8 הבדיקות עוברות.

- [ ] **Step 5: בדוק משקל.**
  - הרץ: `du -cb index.html css/*.css js/*.js | tail -1`
  - מצופה: פחות מ-20480 בייט.
  - אם יוצא יותר מ-15KB, ציין את זה בדוח.

- [ ] **Step 6: כתוב `README.md` בעברית**, עם שלושה דברים:
  - הרצת בדיקות: `npm test` ו-`npm run e2e`.
  - העלאה ל-GitHub Pages: Settings, Pages, Deploy from branch, `main`, root.
  - בדיקה ראשונה בדפדפן אמיתי:
    - פותחים את האתר ואת ה-Console.
    - אם מופיעה שגיאה, מעתיקים את ה-`console.warn`.
    - משחקים כ-20 שאלות ושמים לב לשירים לא מוכרים.

- [ ] **Step 7: הרץ את כל הבדיקות** `npm test && npm run e2e`. מצופה: הכול עובר.

---

## Review Focus

1. **התשובות האמיתיות של MusicBrainz או ListenBrainz שונות מה-fixtures** (שום דבר לא אומת מול שרת חי). המצופה: הודעת שגיאה בעברית ו-`console.warn` מפורט, ולא מסך ריק או קריסה. הבדיקות: "missing arrays" ב-Task 3, ו-e2e 5 ב-Task 6.
2. **לחיצה כפולה או מהירה על אפשרות.** המצופה: נרשמת בחירה אחת ומתקדמים שאלה אחת. הבדיקות: e2e 2 ו-3.
3. **איפוס בזמן ששאלה עדיין נטענת.** המצופה: שאלה ישנה לא קופצת אחרי האיפוס. הבדיקה: `reset drops stale prefetched` ב-Task 5.
4. **שמות ארוכים במסך צר.** המצופה: הטקסט עובר שורה, בלי גלילה אופקית. הבדיקה: e2e 6.
5. **שמות באנגלית עם פיסוק בדף RTL**, למשל `...And Justice for All` או `AC/DC`. המצופה: הטקסט מוצג בכיוון הנכון. הבדיקה: e2e 7.
