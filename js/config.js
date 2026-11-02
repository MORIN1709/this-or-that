// MusicBrainz tags the questions are drawn from. Rock and metal only.
export const GENRES = [
  'classic rock', 'hard rock', 'heavy metal', 'thrash metal', 'grunge', 'punk rock',
  'progressive rock', 'progressive metal', 'doom metal', 'death metal', 'black metal',
  'alternative rock', 'alternative metal', 'nu metal', 'glam metal', 'power metal',
  'stoner rock', 'new wave of british heavy metal',
];

export const CANDIDATE_OFFSETS = [0, 100]; // search pages read per genre
export const PAGE_LIMIT = 100;
export const TOP_N = 40;                    // most-listened items kept per genre
export const PREFETCH = 2;                  // questions kept ready ahead
export const CHOICE_FLASH_MS = 350;
