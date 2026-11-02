# זה או זה · רוק ומטאל

משחק בחירות אינסופי: להקה מול להקה, אלבום מול אלבום, שיר מול שיר.

האתר סטטי לגמרי. הוא קורא שאלות מקבצי JSON בתיקייה `data/`, ולא פונה לשום API בזמן משחק. אין בו שרת ואין ספריות: רק `index.html`, `css/`, `js/` ו-`data/`.

## מבנה הנתונים

`data/` מחולקת לפי תת-ז'אנר. כל ז'אנר מופיע ב-`index.json`, ויש לו שלושה קבצים:

```text
data/index.json              { "genres": [ { "slug": "thrash-metal", "name": "thrash metal",
                                             "counts": { "artists": 30, "albums": 352, "songs": 3410 } } ] }
data/artists/<slug>.json     ["Metallica", "Slayer", …]
data/albums/<slug>.json      [["Metallica", [["Master of Puppets", 1986], …]], …]
data/songs/<slug>.json       [["Metallica", [["Master of Puppets", 1986, ["Battery", …]], …]], …]
```

- האתר טוען כל קובץ רק כשהוא צריך אותו לשאלה, ורק פעם אחת.
- לכל סוג בכל ז'אנר צריכים להיות לפחות 2 פריטים.
- בתיקייה `tests/fixtures/data/` יש דוגמה קטנה במבנה הזה.

### בדיקה שהנתונים תקינים

אחרי כל שינוי ב-`data/` מריצים:

```bash
node tools/check-data.mjs
```

הפקודה בודקת שהמבנה תואם למה שהאתר קורא, שכל הקבצים קיימים ושהספירות ב-`index.json` נכונות.

### בניית הנתונים מ-MusicBrainz (אופציונלי)

`tools/build-data.mjs` בונה את `data/` מ-MusicBrainz ומ-ListenBrainz:
- 30 האמנים המובילים בכל ז'אנר, כל אלבומי האולפן שלהם וכל השירים.
- הקצב הוא בקשה אחת ב-1.1 שניות, עם הזדהות.
- יש מטמון ב-`.cache/`, כך שריצה שנקטעה ממשיכה מאותה נקודה.

```bash
node tools/build-data.mjs                      # כל הז'אנרים
node tools/build-data.mjs --genres "grunge"    # ז'אנר אחד
```

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
