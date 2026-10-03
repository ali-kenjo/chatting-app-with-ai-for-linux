// ---------- Reading a mood from words ----------
// A small, fast classifier that runs on this computer (no network): it reads
// captions as they stream (the AI's words, or yours) and guesses a mood from
// punctuation, laughter, emoji and word lists in English, German and Arabic.
// It also spots a few gestures (a wave on hello and goodbye, a shrug on
// "no idea"...). Pure module: no DOM, so node:test checks it.
import { MOODS } from "./presets.mjs";

const AR_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g; // vowel marks and tatweel

// Lowercase, one kind of apostrophe, Arabic letters in one spelling each
export function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\uFE0F/g, "")
    .replace(AR_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ");
}

// ---------- Word lists ----------
// "word" matches the whole word, "word*" also longer words starting with it,
// "two words" the phrase; "entry|1.5" sets how much it counts (default 1,
// phrases 1.3, emoji 1.4). Arabic entries also match with the common
// prefixes (و ف ب ل ك ال) and pronoun endings.
const LEXICON = {
  happy: [
    "glad", "happy", "nice", "great", "love that", "love it", "awesome", "wonderful", "lovely", "yay",
    "sweet", "delighted", "enjoy*", "fun", "perfect", "beautiful", "brilliant", "pleased", "fantastic|0.8",
    "good to see you", "nice to see you",
    "froh", "freut mich", "freue mich", "glücklich", "schön", "toll", "super", "prima", "klasse", "wunderbar",
    "spaß", "perfekt", "herrlich", "sehr gut",
    "سعيد", "مبسوط", "فرحان", "رائع", "جميل", "حلو", "ممتاز", "يسعدني", "تمام|0.6", "عظيم", "يا سلام", "جيد|0.7",
    "😊", "🙂", "😄", "😃", "😁", "☺", "👍", "😀", "🌞",
  ],
  excited: [
    "wow|1.2", "amazing", "incredible", "can't wait|1.5", "cannot wait|1.5", "let's go|1.5", "let's do it", "epic",
    "exciting", "excited", "thrilled", "insane", "unbelievable", "mind-blowing", "huge|0.7",
    "wahnsinn", "unglaublich", "krass", "mega", "hammer", "genial", "fantastisch", "aufregend", "aufgeregt",
    "los geht's|1.5", "los gehts|1.5", "kann es kaum erwarten|1.5", "irre",
    "واو|1.2", "مذهل", "رهيب", "خرافي", "متحمس", "يلا|0.8", "لا يصدق", "مدهش", "روعه", "حماس",
    "🤩", "🎉", "🥳", "🚀", "🔥", "⚡", "💥",
  ],
  laughing: [
    "hilarious|1.6", "so funny|1.6", "that's funny|1.6", "cracking up|1.8", "lmao|1.8", "lmfao|1.8", "rofl|1.8",
    "witzig|1.2", "lustig|1.2", "zum totlachen|1.8", "ich lach mich|1.8", "urkomisch|1.6",
    "مضحك|1.4", "ضحكتني|1.8", "اضحكتني|1.8",
    "😂|2", "🤣|2", "😆|1.6", "😹|1.6",
  ],
  curious: [
    "curious", "i wonder", "wonder", "interesting", "tell me more|1.5", "how come", "what if", "fascinating",
    "intriguing", "i'd love to know",
    "neugierig", "interessant", "spannend", "erzähl mir mehr|1.5", "erzähl mal", "wie kommt", "was wäre wenn",
    "faszinierend", "ich frage mich",
    "مثير للاهتمام|1.5", "فضولي", "مهتم", "اخبرني اكثر|1.5", "احكي لي", "كيف ذلك", "ماذا لو", "مشوق", "يا ترى",
    "🧐", "👀",
  ],
  thinking: [
    "hmm|1.2", "hm", "let me think|1.5", "let's see", "one sec", "give me a second", "let me check", "considering",
    "maybe|0.5", "perhaps|0.5", "thinking",
    "lass mich überlegen|1.5", "mal sehen", "mal überlegen", "vielleicht|0.5", "ich denke nach", "überleg*",
    "همم|1.2", "امم", "دعني افكر|1.5", "خليني افكر|1.5", "ربما|0.5", "يمكن|0.4", "افكر",
    "🤔|1.4", "💭",
  ],
  focused: [
    "step by step|1.5", "here's how", "here is how", "let's focus", "focus", "specifically", "the key is",
    "carefully", "break it down", "let's break", "checklist", "concentrate",
    "schritt für schritt|1.5", "konzentrier*", "fokus*", "der trick ist", "genauer gesagt",
    "خطوه بخطوه|1.5", "لنركز", "ركز", "بالتحديد", "المفتاح هو",
    "🎯", "📝", "🛠",
  ],
  surprised: [
    "whoa|1.3", "woah|1.3", "no way|1.3", "seriously", "i didn't expect", "surprising", "surprised", "shocked",
    "oh wow|1.5", "holy",
    "echt jetzt|1.3", "nicht dein ernst|1.5", "überrascht", "überraschend", "boah|1.3", "ach du",
    "معقول", "يا الهي|1.3", "مستحيل", "صدمه", "مفاجاه", "فاجاتني", "يا ساتر", "اوه",
    "😮", "😲", "😯", "🤯|1.6", "😱", "😳",
  ],
  confused: [
    "confused", "confusing", "doesn't make sense|1.5", "don't understand|1.5", "didn't catch", "what do you mean|1.3",
    "huh|1.2", "unclear", "lost me",
    "verwirrt", "verwirrend", "verstehe nicht|1.5", "versteh ich nicht|1.5", "ergibt keinen sinn|1.5",
    "wie meinst du", "hä|1.2", "häh|1.2", "unklar",
    "محتار", "مرتبك", "لا افهم|1.5", "ما فهمت|1.5", "مش فاهم|1.5", "غير واضح", "ماذا تقصد", "شو قصدك", "ايش قصدك",
    "😕", "😵", "🤷", "❓",
  ],
  skeptical: [
    "i doubt", "doubt it", "if you say so|1.6", "questionable", "suspicious", "skeptical", "not convinced",
    "allegedly", "supposedly", "technically|0.7", "debatable",
    "na ja", "naja", "zweifel*", "fraglich", "wer's glaubt|1.6", "wers glaubt|1.6", "angeblich", "skeptisch",
    "nicht überzeugt", "sagen wir mal",
    "اشك", "مشكوك", "على ما يبدو", "لست مقتنعا", "مش مقتنع",
    "😏|1.5", "🙄|1.5", "🤨|1.5", "😒",
  ],
  sad: [
    "sorry to hear|1.6", "i'm sorry", "sad", "unfortunately", "that's tough", "that sucks", "hard time", "i miss",
    "heartbroken", "disappoint*", "too bad", "lonely", "rough day", "bad day", "bad news",
    "tut mir leid|1.5", "traurig", "leider", "schade", "das ist hart", "schwere zeit", "vermisse", "enttäuscht",
    "einsam", "schlechter tag", "schlechte nachrichten",
    "اسف", "حزين", "للاسف", "مؤسف", "وحيد", "افتقد", "خساره", "مكسور", "زعلان", "يوم سيء", "خبر سيء",
    "😢|1.6", "😭|1.6", "😞", "😔", "💔|1.6", "☹", "🙁", "😟",
  ],
  affectionate: [
    "love you|1.8", "thank you so much|1.5", "thanks so much|1.5", "you're the best|1.5", "sweet of you",
    "hug", "means a lot", "appreciate you", "i appreciate", "so kind", "adorable", "cute",
    "hab dich lieb|1.8", "danke dir", "vielen dank", "du bist die beste", "du bist der beste", "umarmung",
    "lieb von dir", "bedeutet mir viel", "schätze dich",
    "احبك|1.8", "شكرا جزيلا|1.5", "انت الافضل|1.5", "حبيبي", "حبيبتي", "عزيزي", "عزيزتي", "لطيف منك", "يعني لي الكثير", "قلبي",
    "❤|1.6", "🥰|1.6", "😍|1.4", "💕", "💖", "🤗", "😘", "💗", "♥",
  ],
  proud: [
    "proud", "nailed it|1.5", "well done", "you did it|1.5", "we did it|1.5", "congrat*|1.3", "achievement",
    "accomplish*", "crushed it", "impressive", "great job", "good job",
    "stolz", "gut gemacht", "geschafft", "glückwunsch", "gratuliere", "beeindruckend", "starke leistung",
    "فخور", "احسنت", "مبروك", "الف مبروك", "انجاز", "عمل رائع", "برافو",
    "💪", "🏆", "🥇", "👏", "🙌",
  ],
  sleepy: [
    "tired", "sleepy", "good night", "goodnight", "yawn", "exhausted", "bedtime", "go to bed", "nap", "late night",
    "müde", "gute nacht", "schlafen", "erschöpft", "gähn*", "ins bett", "schläfrig", "nickerchen",
    "نعسان", "تعبان", "تصبح على خير", "نوم", "انام", "منهك", "متعب", "ليله سعيده",
    "😴|1.6", "💤|1.6", "🥱|1.6", "😪",
  ],
};

// Things you might say about your day; the robot reacts to them
const USER_NEWS = {
  excited: [
    "i got the job|2", "got the job|2", "i passed|2", "we won|2", "i won|2", "i did it|2", "got promoted|2",
    "i'm engaged|2", "got engaged|2", "it worked|1.5", "good news|1.6", "guess what|1.2",
    "ich habe es geschafft|2", "hab's geschafft|2", "bestanden|1.6", "gewonnen|1.6", "befördert|2",
    "den job bekommen|2", "verlobt|2", "es hat geklappt|1.6", "gute nachrichten|1.6", "rate mal|1.2",
    "نجحت|2", "فزت|2", "فزنا|2", "حصلت على الوظيفه|2", "تمت ترقيتي|2", "انخطبت|2", "زبطت|1.5", "خبر حلو|1.6", "خبر سار|1.6",
  ],
  sad: [
    "i failed|2", "i lost|1.5", "lost my|1.6", "broke up|2", "got fired|2", "didn't work|1.2", "i'm sick|1.6",
    "stressed|1.3", "anxious|1.3", "worried|1.2",
    "durchgefallen|2", "verloren|1.4", "schluss gemacht|2", "gekündigt|1.6", "hat nicht geklappt|1.4", "krank|1.2",
    "gestresst|1.3", "sorgen|1",
    "رسبت|2", "خسرت|1.5", "انفصلت|2", "انطردت|2", "ما زبط|1.4", "مريض|1.3", "متوتر|1.3", "قلقان|1.3", "خايف|1.2",
  ],
};

// How the robot answers the mood it hears in your words
const REACTION = {
  happy: "happy", excited: "excited", laughing: "laughing", curious: "curious", thinking: "curious",
  focused: "focused", surprised: "surprised", confused: "focused", skeptical: "curious", sad: "sad",
  affectionate: "affectionate", proud: "proud", sleepy: "sleepy", neutral: "neutral",
};

// Gestures some words call for. at: "start" = only as a sentence begins,
// "turn" = only as a whole turn begins; who: whose words ("ai", "user", both)
const GESTURE_CUES = [
  {
    gesture: "wave", at: "turn",
    words: [
      "hello", "hi", "hey", "hey there", "good morning", "good evening", "good afternoon", "morning", "evening",
      "welcome back", "howdy",
      "hallo", "servus", "moin", "guten morgen", "guten abend", "guten tag", "grüß dich", "willkommen zurück",
      "مرحبا", "اهلا", "اهلين", "السلام عليكم", "صباح الخير", "مساء الخير", "هلا",
    ],
  },
  {
    gesture: "wave", at: "any",
    words: [
      "bye", "goodbye", "see you", "see ya", "talk soon", "take care", "bye bye",
      "tschüss", "tschau", "ciao", "bis bald", "bis später", "bis dann", "auf wiedersehen", "mach's gut",
      "مع السلامه", "الى اللقاء", "باي", "في امان الله", "اشوفك",
    ],
  },
  {
    gesture: "nod", at: "start", who: "ai",
    words: [
      "yes", "yeah", "yep", "exactly", "absolutely", "definitely", "of course", "totally", "agreed",
      "ja", "genau", "stimmt", "absolut", "natürlich", "klar", "auf jeden fall", "richtig",
      "نعم", "ايوه", "اكيد", "بالضبط", "صحيح", "طبعا",
    ],
  },
  {
    gesture: "head_shake", at: "start", who: "ai",
    words: [
      "no,", "no.", "nope", "nah", "not really", "i don't think so",
      "nein", "nee", "eher nicht", "auf keinen fall", "glaube nicht",
      "لا لا", "ابدا", "مش صحيح", "لا اعتقد",
    ],
  },
  {
    gesture: "shrug", at: "any",
    words: [
      "i don't know", "who knows", "no idea", "hard to say",
      "keine ahnung", "weiß nicht", "wer weiß", "schwer zu sagen",
      "لا اعرف", "ما بعرف", "الله اعلم", "مين يعرف",
    ],
  },
  {
    gesture: "lean_in", at: "start", who: "ai",
    words: ["look at this", "check this out", "here's the thing", "listen", "picture this", "schau mal", "guck mal", "hör zu", "stell dir vor", "pass auf", "انظر", "شوف", "اسمع", "تخيل"],
  },
  {
    gesture: "celebrate", at: "any",
    words: ["congratulations", "we did it", "hooray", "hurray", "woohoo", "glückwunsch", "hurra", "juhu", "wir haben es geschafft", "مبروك", "الف مبروك", "فزنا"],
  },
  {
    gesture: "double_take", at: "start",
    words: ["wait, what", "wait what", "hold on", "moment mal", "warte mal", "لحظه لحظه", "استنى"],
  },
  {
    gesture: "shy", at: "any", who: "user",
    words: [
      "you're cute", "you are cute", "you're so cute", "so cute", "you're adorable", "you're so smart", "you're amazing",
      "i love you", "you're the best",
      "du bist süß", "du bist so klug", "du bist toll", "ich liebe dich", "du bist der beste", "du bist die beste",
      "انت لطيف", "انت ذكي", "انت رائع", "احبك", "انت الافضل",
    ],
  },
];

// Mood order when two score the same (the livelier one shows)
const ORDER = ["laughing", "surprised", "excited", "sad", "affectionate", "proud", "confused", "skeptical", "sleepy", "happy", "curious", "focused", "thinking"];

// ---------- Compiled matchers ----------
const WORD = "\\p{L}\\p{N}";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isArabic = (s) => /[\u0600-\u06FF]/.test(s);
const isEmoji = (s) => !/[\p{L}\p{N}]/u.test(s);

function compile(entry) {
  let [raw, w] = entry.split("|");
  let word = normalize(raw).trim();
  const stem = word.endsWith("*");
  if (stem) word = word.slice(0, -1);
  const weight = w ? Number(w) : isEmoji(word) ? 1.4 : word.includes(" ") ? 1.3 : 1;
  if (isEmoji(word)) return { word, weight, emoji: true };
  const arabic = isArabic(word);
  const body = escapeRe(word).replace(/ /g, "\\s+").replace(/'/g, "'?");
  const pre = arabic ? "(?:[وفبلك])?(?:ال)?" : "";
  const post = stem ? `[${WORD}]*` : arabic ? "(?:ه|ها|هم|هن|ك|كم|نا|ي|ني|ات|ون|ين|ان|ا)?" : "";
  return { word, weight, re: new RegExp(`(?<![${WORD}])${pre}${body}${post}(?![${WORD}])`, "u") };
}

const compileAll = (lists) => Object.fromEntries(Object.entries(lists).map(([k, words]) => [k, words.map(compile)]));
const MATCHERS = compileAll(LEXICON);
const NEWS = compileAll(USER_NEWS);
const CUES = GESTURE_CUES.map((c) => ({ ...c, matchers: c.words.map(compile) }));

const NEGATORS = new Set(["not", "no", "never", "nicht", "kein", "keine", "keinen", "keiner", "nie", "niemals", "لا", "ليس", "مش", "لم", "لن", "مو", "مب", "بدون"]);

// Is the word at `index` negated ("not happy", "nicht gut", "مش حلو")?
function negated(text, index) {
  const before = text.slice(Math.max(0, index - 32), index).trim().split(" ").slice(-2);
  return before.some((w) => NEGATORS.has(w.replace(/[^\p{L}']/gu, "")) || /n't$/.test(w));
}

// Where an entry first appears (-1 if nowhere)
function find(m, text) {
  if (m.emoji) return text.indexOf(m.word);
  const hit = m.re.exec(text);
  return hit ? hit.index : -1;
}

const LAUGHS = [
  [/(?<![\p{L}])(?:ha){2,}h?(?![\p{L}])/u, 2],
  [/(?<![\p{L}])(?:he){2,}h?(?![\p{L}])/u, 1.5],
  [/(?<![\p{L}])hi(?:hi)+(?![\p{L}])/u, 1.5],
  [/(?<![\p{L}])lo+l(?![\p{L}])/u, 1.8],
  [/ه{3,}/u, 2],
  [/خ{4,}/u, 1.5],
];

// text: some words (a sentence, a caption, a reply). options.role: "ai" or
// "user"; options.turnStart: these words begin a turn (for greetings).
// Returns { mood, confidence, scores, gesture, reaction }: `mood` is what the
// words sound like, `reaction` the robot's answering mood (for your words), and
// `gesture` one it could make, or null.
export function classify(text, { role = "ai", turnStart = false } = {}) {
  const original = String(text || "");
  const norm = normalize(original);
  const scores = Object.fromEntries(MOODS.map((m) => [m, 0]));
  if (!norm.trim()) return { mood: "neutral", confidence: 0, scores, gesture: null, reaction: "neutral" };

  const score = (matchers) => {
    for (const [mood, list] of Object.entries(matchers)) {
      for (const m of list) {
        const at = find(m, norm);
        if (at >= 0 && (m.emoji || !negated(norm, at))) scores[mood] += m.weight;
      }
    }
  };
  score(MATCHERS);
  if (role === "user") score(NEWS);

  for (const [re, w] of LAUGHS) if (re.test(norm)) scores.laughing += w;
  if (/(?<![\p{L}])ha(?![\p{L}])/u.test(norm)) scores.happy += 1; // "Ha, fair."

  const user = role === "user";
  const exclaims = (norm.match(/!/g) || []).length;
  const questions = (norm.match(/[?؟]/g) || []).length;
  scores.excited += Math.min(1, exclaims * (user ? 0.3 : 0.35));
  if (/[?؟]!|![?؟]/.test(norm)) scores.surprised += 1.2;
  scores.curious += Math.min(user ? 0.8 : 0.6, questions * (user ? 0.5 : 0.3));
  if (/\.\.\.|…/.test(norm)) scores.thinking += user ? 0.4 : 0.6;
  if (/(?<![\p{L}])[A-ZÄÖÜ]{4,}(?![\p{L}])/u.test(original)) scores.excited += 0.4;

  let mood = "neutral";
  let top = 0;
  for (const m of ORDER) {
    if (scores[m] > top + 1e-9) {
      top = scores[m];
      mood = m;
    }
  }
  if (top < 1) mood = "neutral";
  const confidence = mood === "neutral" ? 0 : Math.min(1, 0.35 + 0.25 * top);

  let gesture = null;
  for (const cue of CUES) {
    if (cue.who && cue.who !== role) continue;
    if (cue.at === "turn" && !turnStart) continue;
    // "start" and "turn": nothing but punctuation before it ("Na ja" isn't "ja")
    const hit = cue.matchers.some((m) => {
      const at = find(m, norm);
      return at >= 0 && (cue.at === "any" || !/[\p{L}\p{N}]/u.test(norm.slice(0, at)));
    });
    if (hit) {
      gesture = cue.gesture;
      break;
    }
  }
  return { mood, confidence, scores, gesture, reaction: REACTION[mood] || "neutral" };
}

// Captions arrive in pieces. This keeps the last few sentences and gives a
// reading each time a sentence ends (or enough text has come without one).
export class CaptionMood {
  constructor({ role = "ai", window = 220 } = {}) {
    this.role = role;
    this.window = window;
    this.reset();
  }

  reset() {
    this.recent = ""; // the sentences read so far this turn (the last `window` characters)
    this.pending = ""; // the sentence still coming
    this.turnStart = true;
  }

  // Returns a classify() result when a sentence ended, else null
  push(piece) {
    this.pending += piece;
    const ended = /[.!?؟…\n](?:["'”’)\]]*)\s*$/.test(this.pending) || /[.!?؟…](?:["'”’)\]]*)\s+\S/.test(this.pending);
    if (!ended && this.pending.length < 90) return null;
    return this.read();
  }

  // The rest, e.g. when the turn ends
  flush() {
    return this.pending.trim() ? this.read() : null;
  }

  read() {
    const sentence = this.pending.trim();
    this.pending = "";
    // Mostly this sentence; the one before adds a little context
    const result = classify(sentence, { role: this.role, turnStart: this.turnStart });
    const context = this.recent ? classify(`${this.recent} ${sentence}`.slice(-this.window), { role: this.role }) : null;
    if (result.mood === "neutral" && context && context.mood !== "neutral" && context.confidence >= 0.75) {
      result.mood = context.mood;
      result.reaction = context.reaction;
      result.confidence = context.confidence * 0.8;
    }
    this.recent = `${this.recent} ${sentence}`.slice(-this.window);
    this.turnStart = false;
    return result;
  }
}
