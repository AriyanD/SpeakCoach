import type { ShadowingDifficulty, ShadowingSentence } from './shadowingBank';
import type { ShadowingLanguageCode } from './shadowingLanguages';

type StarterRow = { topic: string; text: string; phoneticFocus: string };
type LanguageRows = Record<ShadowingDifficulty, StarterRow[]>;

// Compact offline starter: one native-language sentence at each difficulty.
// English remains in its original, separate sentence bank.
const SENTENCES: Record<Exclude<ShadowingLanguageCode, 'en'>, LanguageRows> = {
  sv: {
    easy: [{ topic: 'Vardag', text: 'Jag brukar ta en kort promenad efter frukosten.', phoneticFocus: 'Swedish pitch accent and clear long vowels' }],
    medium: [{ topic: 'Kollektivtrafik', text: 'När fler väljer bussen minskar trängseln på vägarna.', phoneticFocus: 'Sentence stress and the Swedish sj sound' }],
    hard: [{ topic: 'Hållbarhet', text: 'En omställning blir trovärdig först när dess sociala konsekvenser tas på allvar.', phoneticFocus: 'Compound words, pitch accent and consonant clusters' }]
  },
  de: {
    easy: [{ topic: 'Alltag', text: 'Ich gehe morgens gern eine Runde durch den Park.', phoneticFocus: 'Clear vowels and the German ch sound' }],
    medium: [{ topic: 'Öffentlicher Verkehr', text: 'Wenn mehr Menschen Bus und Bahn nutzen, gibt es weniger Autos auf den Straßen.', phoneticFocus: 'Sentence stress and subordinate-clause word order' }],
    hard: [{ topic: 'Nachhaltigkeit', text: 'Ein gesellschaftlicher Wandel ist nur glaubwürdig, wenn seine sozialen Folgen ernst genommen werden.', phoneticFocus: 'Long compounds, consonant clusters and sentence rhythm' }]
  },
  fr: {
    easy: [{ topic: 'Quotidien', text: 'Je prends toujours un café noir avant de partir au travail.', phoneticFocus: 'Nasal vowels in « prends » and « avant », plus the French uvular r' }],
    medium: [{ topic: 'Vie quotidienne', text: 'Même lorsque la journée est chargée, je prends le temps de lire quelques pages.', phoneticFocus: 'Liaison, syllable grouping and nasal vowels' }],
    hard: [{ topic: 'Société', text: 'Une transition durable exige que les conséquences sociales des décisions collectives soient examinées avec attention.', phoneticFocus: 'Connected speech, silent final consonants and sentence intonation' }]
  },
  es: {
    easy: [{ topic: 'Vida diaria', text: 'Me gusta caminar por el parque después del desayuno.', phoneticFocus: 'Pure vowels and the Spanish tapped r' }],
    medium: [{ topic: 'Transporte', text: 'Cuando más personas utilizan el transporte público, hay menos tráfico en el centro.', phoneticFocus: 'Vowel linking and natural sentence stress' }],
    hard: [{ topic: 'Sostenibilidad', text: 'Una transformación sostenible requiere analizar quién se beneficia y quién asume sus consecuencias.', phoneticFocus: 'Consonant clarity and stress in longer words' }]
  },
  it: {
    easy: [{ topic: 'Quotidianità', text: 'La mattina preparo un caffè e ascolto la radio.', phoneticFocus: 'Open and closed vowels with clear double consonants' }],
    medium: [{ topic: 'Trasporti', text: 'Usare la bicicletta per gli spostamenti brevi può rendere la città più vivibile.', phoneticFocus: 'Double consonants and connected speech' }],
    hard: [{ topic: 'Sostenibilità', text: 'Una transizione giusta deve considerare anche le disuguaglianze che influenzano la vita quotidiana.', phoneticFocus: 'Sentence rhythm, geminate consonants and word stress' }]
  },
  nl: {
    easy: [{ topic: 'Dagelijks leven', text: 'Ik drink graag thee terwijl ik de krant lees.', phoneticFocus: 'Dutch g and clear vowel contrasts' }],
    medium: [{ topic: 'Mobiliteit', text: 'Veilige fietspaden maken het voor meer mensen aantrekkelijk om de auto thuis te laten.', phoneticFocus: 'Vowel combinations and word stress' }],
    hard: [{ topic: 'Samenleving', text: 'Een rechtvaardige verandering vraagt aandacht voor de mensen die de gevolgen ervan het sterkst ervaren.', phoneticFocus: 'Consonant clusters and compound-word stress' }]
  },
  pt: {
    easy: [{ topic: 'Rotina', text: 'Gosto de tomar café antes de começar a trabalhar.', phoneticFocus: 'Open vowels and nasal diphthongs' }],
    medium: [{ topic: 'Transportes', text: 'O transporte público eficiente ajuda a reduzir o número de carros nas cidades.', phoneticFocus: 'Vowel reduction and connected speech' }],
    hard: [{ topic: 'Sustentabilidade', text: 'Uma mudança duradoura depende de decisões coletivas que respeitem diferentes necessidades sociais.', phoneticFocus: 'Nasal vowels, unstressed vowels and sentence rhythm' }]
  },
  ru: {
    easy: [{ topic: 'Повседневная жизнь', text: 'Утром я обычно пью чай и читаю новости.', phoneticFocus: 'Vowel reduction and soft consonants' }],
    medium: [{ topic: 'Транспорт', text: 'Когда больше людей пользуются общественным транспортом, на дорогах становится меньше машин.', phoneticFocus: 'Word stress and consonant clusters' }],
    hard: [{ topic: 'Общество', text: 'Устойчивые изменения требуют учитывать интересы разных групп и долгосрочные последствия решений.', phoneticFocus: 'Unstressed vowel reduction and palatalized consonants' }]
  },
  tr: {
    easy: [{ topic: 'Günlük hayat', text: 'Sabahları kahvemi içtikten sonra kısa bir yürüyüş yaparım.', phoneticFocus: 'Vowel harmony and clear dotted/dotless vowels' }],
    medium: [{ topic: 'Ulaşım', text: 'Toplu taşıma daha fazla kişi tarafından kullanıldığında şehir trafiği azalabilir.', phoneticFocus: 'Word stress and vowel harmony' }],
    hard: [{ topic: 'Toplum', text: 'Kalıcı bir dönüşüm, farklı toplumsal grupların ihtiyaçlarının birlikte değerlendirilmesini gerektirir.', phoneticFocus: 'Suffix chains, stress placement and consonant transitions' }]
  },
  fa: {
    easy: [{ topic: 'زندگی روزمره', text: 'من هر روز صبح قبل از شروع کار یک فنجان چای می‌نوشم.', phoneticFocus: 'Clear short and long vowels with natural stress' }],
    medium: [{ topic: 'حمل‌ونقل', text: 'گسترش حمل‌ونقل عمومی می‌تواند رفت‌وآمد در مرکز شهر را آسان‌تر کند.', phoneticFocus: 'Connected words and consonant clarity' }],
    hard: [{ topic: 'جامعه', text: 'تغییرات پایدار زمانی امکان‌پذیرند که پیامدهای اجتماعی تصمیم‌ها نیز جدی گرفته شوند.', phoneticFocus: 'Sentence rhythm and clear articulation of joined words' }]
  },
  ar: {
    easy: [{ topic: 'الحياة اليومية', text: 'أشرب القهوة كل صباح قبل الذهاب إلى العمل.', phoneticFocus: 'Clear emphatic consonants and short vowels' }],
    medium: [{ topic: 'النقل', text: 'يساعد النقل العام على تقليل الازدحام في شوارع المدينة.', phoneticFocus: 'Consonant articulation and natural phrase stress' }],
    hard: [{ topic: 'المجتمع', text: 'يتطلب التغيير المستدام دراسة آثاره الاجتماعية ومراعاة احتياجات الفئات المختلفة.', phoneticFocus: 'Emphatic consonants, long vowels and sentence rhythm' }]
  },
  zh: {
    easy: [{ topic: '日常生活', text: '我每天早上喝一杯茶，然后开始工作。', phoneticFocus: 'Four lexical tones and clear syllable boundaries' }],
    medium: [{ topic: '交通', text: '如果更多人选择公共交通，城市里的道路就不会那么拥挤。', phoneticFocus: 'Tone changes and smooth syllable transitions' }],
    hard: [{ topic: '社会', text: '可持续的转型不仅需要技术创新，也需要认真考虑不同群体所面临的社会影响。', phoneticFocus: 'Tone accuracy across longer phrases and neutral tone' }]
  },
  ja: {
    easy: [{ topic: '日常生活', text: '毎朝、仕事の前に温かいお茶を飲みます。', phoneticFocus: 'Mora timing and clear vowel length' }],
    medium: [{ topic: '交通', text: '公共交通機関を利用する人が増えると、 街の渋滞を減らすことができます。', phoneticFocus: 'Pitch accent and particle pronunciation' }],
    hard: [{ topic: '社会', text: '持続可能な社会への移行には、さまざまな人々への社会的な影響を考慮する必要があります。', phoneticFocus: 'Mora timing, devoiced vowels and sentence intonation' }]
  },
  ko: {
    easy: [{ topic: '일상생활', text: '저는 아침마다 커피를 마시고 하루를 시작해요.', phoneticFocus: 'Vowel clarity and natural phrase endings' }],
    medium: [{ topic: '교통', text: '대중교통을 이용하는 사람이 많아지면 도시의 교통 체증을 줄일 수 있습니다.', phoneticFocus: 'Batchim (final consonant) pronunciation and sound linking' }],
    hard: [{ topic: '사회', text: '지속 가능한 변화를 위해서는 다양한 집단이 겪는 사회적 영향을 함께 고려해야 합니다.', phoneticFocus: 'Batchim assimilation, spacing and sentence rhythm' }]
  }
};

export function getInitialMultilingualShadowingSets(
  languageCode: Exclude<ShadowingLanguageCode, 'en'>,
  difficulty: ShadowingDifficulty
): ShadowingSentence[][] {
  const rows = SENTENCES[languageCode][difficulty];
  const rate = difficulty === 'easy' ? 390 : difficulty === 'medium' ? 430 : 470;
  return rows.map((row, setIndex) => [{
    id: `builtin-${languageCode}-${difficulty}-set-${setIndex + 1}-1`,
    difficulty,
    topic: row.topic,
    text: row.text,
    phoneticFocus: row.phoneticFocus,
    expectedTotalDurationMs: Math.max(
      2600,
      Math.round(Array.from(row.text).length * rate / (languageCode === 'zh' || languageCode === 'ja' ? 2 : 4))
    )
  }]);
}

export function getSupportedMultilingualSentenceLanguages(): ShadowingLanguageCode[] {
  return Object.keys(SENTENCES) as ShadowingLanguageCode[];
}
