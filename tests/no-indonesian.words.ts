// Test-only (PLAN/08 §8 guard): curated Indonesian stopwords shared by web.no-indonesian and cli.no-indonesian.
// Every word is common in Indonesian UI copy and never an English word, so a match in English output is a leak.

/** Indonesian words that must not appear in English text (matched whole-word, case-insensitive). */
export const INDONESIAN_STOPWORDS = [
  "yang",
  "dan",
  "atau",
  "untuk",
  "dengan",
  "tidak",
  "belum",
  "sudah",
  "gagal",
  "berhasil",
  "simpan",
  "hapus",
  "jalankan",
  "buka",
  "tutup",
  "halaman",
  "situs",
  "layanan",
  "cadangan",
  "pengaturan",
  "ringkasan",
  "masuk",
  "keluar",
  "perubahan",
  "sedang",
  "ini",
  "itu",
  "akan",
  "bisa",
  "harus",
  "lagi",
  "dtk",
  "mnt",
  "selesai",
  "silakan",
  "perangkat",
  "sandi",
  "pakai",
  "dari",
  "setelah",
  "sebelum",
  "dulu",
  "coba",
  "pilih",
  "baterai",
] as const;

const EDGE_L = "(?<![\\p{L}\\p{N}_/.-])";
const EDGE_R = "(?![\\p{L}\\p{N}_])";
const PATTERN = new RegExp(`${EDGE_L}(${INDONESIAN_STOPWORDS.join("|")})${EDGE_R}`, "giu");
/** "HP" (phone) is matched case-sensitively: lowercase `hp` is an English unit and a common short identifier. */
const HP = new RegExp(`${EDGE_L}HP${EDGE_R}`, "gu");

/**
 * Indonesian stopwords found in `text`. A word glued to `/`, `.`, `-` on its left is a path or token, not prose
 * (e.g. `/mnt/sdcard`, `.ini`, `wake-lock`), so it does not count.
 */
export function indonesianWords(text: string): string[] {
  const words = [...text.matchAll(PATTERN)].map((m) => m[1]?.toLowerCase() ?? "");
  return text.match(HP) ? [...words, "HP"] : words;
}
