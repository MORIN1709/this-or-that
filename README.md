# זה או זה · רוק ומטאל

משחק "מלך הגבעה" ברוק ומטאל:
- בוחרים אם משחקים על **אלבומים** או על **אמנים**, ומוגרל תת-ז'אנר.
- מה שבוחרים נשאר על הגבעה (👑), ומולו עולה מתמודד חדש מאותו ז'אנר.
- כשנגמרים המתמודדים, מוכרז המלך של הז'אנר.

האתר סטטי לגמרי. הוא קורא שאלות מקבצי JSON בתיקייה `data/`, ולא פונה לשום API בזמן משחק. אין בו שרת ואין ספריות: רק `index.html`, `css/`, `js/` ו-`data/`.

## מבנה הנתונים

`data/` בנויה כך:

```text
data/index.json              { "genres": [ { "slug": "thrash-metal", "name": "thrash metal",
                                             "counts": { "artists": 30, "albums": 421, "songs": 4604 } } ] }
data/artists/<genre>.json    [["Metallica", "metallica", "https://…/photo"], …]       ← [שם, מפתח קובץ השירים, תמונה]
data/albums/<genre>.json     [["Metallica", [["Master of Puppets", 1986, "<cover>"], …]], …]
data/songs/<artist>.json     [["<cover>", ["Battery", "Master of Puppets", …]], …]   ← קובץ לכל אמן
```

**מבנה הקבצים:**
- **אמנים ואלבומים** נשמרים בקובץ אחד לכל ז'אנר.
- **שירים** נשמרים בקובץ אחד לכל אמן, משותף לכל הז'אנרים שלו. השירים מקובצים לפי האלבום, כדי שכל שיר יוצג עם העטיפה שלו.

**תמונות:**
- **לכל אמן יש תמונה אמיתית,** מאחד המקורות האלה: Wikimedia Commons (דרך MusicBrainz), Deezer או TheAudioDB.
- **לכל אלבום יש עטיפה:**
  - העטיפה מגיעה מ-Cover Art Archive, מהוצאה שבנתונים של MusicBrainz מסומן שיש לה עטיפה. במקרה כזה, `<cover>` הוא מזהה ההוצאה.
  - אם אין עטיפה שם, היא מגיעה מ-Deezer, ואז `<cover>` הוא כתובת מלאה.
  - אלבום שאין לו עטיפה בשום מקום לא נכלל.
- **האתר שומר רק כתובות.** הכתובות קבועות, והדפדפן שומר את התמונות ב-cache הרגיל שלו.

**טעינה:**
- **כל משחק מוריד קובץ אחד:** האמנים או האלבומים של הז'אנר שהוגרל.
- **התמונות של שני המתמודדים הבאים** נטענות מראש.
- **שירים:** קבצי השירים (`data/songs/`) נשמרים, אבל המשחק לא משתמש בהם כרגע.
- **דוגמה קטנה במבנה הזה** נמצאת ב-`tests/fixtures/data/`.

### בדיקה שהנתונים תקינים

אחרי כל שינוי ב-`data/` מריצים:

```bash
node tools/check-data.mjs
```

הפקודה בודקת שהמבנה תואם למה שהאתר קורא, שכל הקבצים קיימים ושהספירות ב-`index.json` נכונות.

### מקור הנתונים

הנתונים נבנו פעם אחת, ב-2 בנובמבר 2026, מ-MusicBrainz ומ-ListenBrainz:
- 30 האמנים המובילים בכל ז'אנר.
- כל אלבומי האולפן שלהם.
- כל השירים שבאלבומים האלה.

התמונות נאספו מ-Wikimedia Commons, Deezer, TheAudioDB ו-Cover Art Archive.

האתר לא פונה לשום API בזמן משחק. קוד הבנייה הוסר מהמאגר ונשאר בהיסטוריה של git, בקומיט `b9bd293`.

**קרדיט ורישיון:**
- **שמות** האמנים, האלבומים והשירים מ-[MusicBrainz](https://musicbrainz.org) הם CC0.
- **תגיות הז'אנר** הן CC BY-NC-SA, כלומר מותרות לשימוש לא מסחרי עם קרדיט.
- **פופולריות:** [ListenBrainz](https://listenbrainz.org).
- **תמונות אמנים:** [Wikimedia Commons](https://commons.wikimedia.org), תחת רישיונות חופשיים שמופיעים בדף של כל קובץ, וכן [Deezer](https://www.deezer.com) ו-[TheAudioDB](https://www.theaudiodb.com).
- **עטיפות:** [Cover Art Archive](https://coverartarchive.org).

## בדיקות

צריך Node 22.

```bash
npm test
```

בדיקות הדפדפן רצות ב-Chromium דרך Playwright, מול הנתונים לדוגמה שב-`tests/fixtures/data/`:

```bash
npx playwright install chromium   # פעם אחת
npm run e2e
```

## העלאה ל-GitHub Pages

1. ב-Settings בוחרים Pages.
2. תחת Build and deployment בוחרים Deploy from a branch.
3. בוחרים את הענף `main` ואת התיקייה `/ (root)`.
4. אחרי כדקה האתר זמין בכתובת שמופיעה שם.
