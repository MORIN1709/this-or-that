# זה או זה · רוק ומטאל

משחק בחירות אינסופי: להקה מול להקה, אלבום מול אלבום, שיר מול שיר.

האתר סטטי לגמרי. הוא קורא שאלות מקבצי JSON בתיקייה `data/`, ולא פונה לשום API בזמן משחק. אין בו שרת ואין ספריות: רק `index.html`, `css/`, `js/` ו-`data/`.

## מבנה הנתונים

`data/` בנויה כך:

```text
data/index.json              { "genres": [ { "slug": "thrash-metal", "name": "thrash metal",
                                             "counts": { "artists": 30, "albums": 352, "songs": 3410 } } ] }
data/artists/<genre>.json    [["Metallica", "metallica"], ["Slayer", "slayer"], …]     ← [שם, מפתח קובץ השירים]
data/albums/<genre>.json     [["Metallica", [["Master of Puppets", 1986], …]], …]
data/songs/<artist>.json     ["Hit the Lights", "Battery", …]                            ← קובץ לכל אמן
```

- **אמנים ואלבומים** נשמרים בקובץ אחד לכל ז'אנר.
- **שירים** נשמרים בקובץ אחד לכל אמן, משותף לכל הז'אנרים שלו, ובלי אלבום ושנה.
- **שאלת שירים** מגרילה שני אמנים ומורידה רק את שני הקבצים שלהם.
- **כל קובץ נטען רק כשצריך,** ורק פעם אחת.
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

האתר לא פונה לשום API. קוד הבנייה הוסר מהמאגר ונשאר בהיסטוריה של git, בקומיט `6f9e2a7`.

**רישיון:** שמות האמנים, האלבומים והשירים מ-MusicBrainz הם CC0. תגיות הז'אנר הן CC BY-NC-SA, כלומר מותרות לשימוש לא מסחרי עם קרדיט. הקרדיט מופיע בתחתית האתר.

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
