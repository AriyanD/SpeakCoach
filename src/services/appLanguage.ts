import { loadAppSettings, type AppLanguage } from '../storage/appSettings';

type Dictionary = Record<string, string>;

const fa: Dictionary = {
  "Practice weak word": "تمرین واژهٔ دشوار",
  "Retry weak words": "تمرین دوبارهٔ واژه‌های دشوار",
  "Retry remaining weak words": "تمرین دوبارهٔ واژه‌های باقی‌مانده",
  "All target words matched.": "همهٔ واژه‌های هدف درست تشخیص داده شدند.",
  "Correct words": "واژه‌های درست",
  "Each chip shows the latest result for that target word.": "هر برچسب، آخرین نتیجهٔ آن واژهٔ هدف را نشان می‌دهد.",
  "Improved": "بهبود یافته",
  "No change": "بدون تغییر",
  "Needs work": "نیازمند تمرین",
  "No words were recognized for this weak-word drill. Please try recording again.": "هیچ واژه‌ای در این تمرین تشخیص داده نشد. لطفاً دوباره ضبط کنید.",

  "For the best experience, we recommend configuring the providers manually in API Settings below. If you use free API plans, separate accounts may help distribute legitimate usage where the provider's terms allow it.": "برای بهترین تجربه، پیشنهاد می‌کنیم ارائه‌دهنده‌ها را به‌صورت دستی در بخش تنظیمات API پیکربندی کنید. اگر از طرح‌های رایگان API استفاده می‌کنید، در صورت مجاز بودن طبق شرایط ارائه‌دهنده، حساب‌های جداگانه می‌توانند به توزیع مصرف مجاز کمک کنند.",
  "You've reached the end of this sentence set. Generate a new set, or go back through your history to practice a previous one.": "به پایان این مجموعهٔ جمله‌ها رسیده‌اید. یک مجموعهٔ جدید بسازید یا برای تمرین جمله‌های قبلی به تاریخچه برگردید.",
  'Main navigation':'پیمایش اصلی', 'Shadowing':'شَدوئینگ', 'IELTS Test':'آزمون IELTS', 'Settings':'تنظیمات', 'Press back again to exit.':'برای خروج، یک بار دیگر دکمهٔ بازگشت را بزنید.', 'Quit this test?':'از این آزمون خارج می‌شوید؟', 'Your answers saved so far will remain in the session history. You can return to the question library.':'پاسخ‌هایی که تا این لحظه ثبت کرده‌اید در تاریخچه باقی می‌مانند. می‌توانید به مجموعهٔ سؤال‌ها برگردید.', 'Quit test':'خروج از آزمون', 'Keep practising':'ادامهٔ تمرین', 'Browser API-key storage':'ذخیره‌سازی API Key در مرورگر', 'In a desktop browser, API keys are stored in browser app storage and are not encrypted by Android Keystore. Use a trusted personal device and avoid shared browsers. Android installs use Android Keystore.':'در نسخهٔ مرورگر دسکتاپ، API Keyها در حافظهٔ برنامه ذخیره می‌شوند و با Android Keystore رمزگذاری نمی‌شوند. از دستگاه شخصی و مطمئن استفاده کنید و از مرورگرهای عمومی یا مشترک پرهیز کنید. نسخهٔ اندروید از Android Keystore استفاده می‌کند.', 'Data recovery notice':'هشدار بازیابی اطلاعات', 'Keep the app installed and do not clear its data until you have reviewed the preserved recovery copies. Export any accessible current data separately.':'تا زمانی که نسخه‌های بازیابی‌شده را بررسی نکرده‌اید، برنامه را حذف نکنید و داده‌های آن را پاک نکنید. از اطلاعات فعلیِ قابل‌دسترسی نیز جداگانه نسخهٔ پشتیبان بگیرید.', 'Saved API key needs recovery':'بازیابی API Key ذخیره‌شده', 'Do not save an empty value for these providers. Restore the key from an AI Settings backup, enter a replacement key, or switch providers. SpeakCoach will not silently erase the unreadable saved value.':'برای این Providerها مقدار خالی ذخیره نکنید. کلید را از نسخهٔ پشتیبان AI Settings بازیابی کنید، کلید جایگزین وارد کنید یا Provider را تغییر دهید. SpeakCoach کلیدِ غیرقابل‌خواندن را بی‌اطلاع شما پاک نمی‌کند.', 'Ready':'آماده', 'Error':'خطا', 'API key needed':'نیاز به API Key', 'Offline ready':'آمادهٔ آفلاین', 'Not tested':'آزمایش‌نشده', 'Dismiss error':'بستن پیام خطا', 'Primary provider':'Provider اصلی', 'Base URL':'آدرس پایه (Base URL)', 'Switch to Custom (OpenAI-compatible)':'تغییر به Custom (سازگار با OpenAI)', 'Copy from':'کپی از', 'Copy API key':'کپی API Key', 'Choose source':'انتخاب منبع', 'Fetch models':'دریافت فهرست مدل‌ها', 'Browse available models':'مشاهدهٔ مدل‌های موجود', 'After selecting a provider and adding its API key, tap Test API 1 below. Wait for a successful result before using online features. Test API 2 separately for a secondary provider.':'پس از انتخاب Provider و وارد کردن API Key، دکمهٔ Test API 1 را بزنید. پیش از استفاده از قابلیت‌های آنلاین، منتظر نتیجهٔ موفق بمانید. API 2 را جداگانه آزمایش کنید.', 'Custom provider authentication and endpoint':'احراز هویت و نشانی اختصاصی Provider', 'Authentication Style':'روش احراز هویت', 'Bearer Header (Authorization: Bearer <key>)':'هدر Bearer (Authorization: Bearer <key>)', 'Custom Header Name (e.g. X-API-Key)':'نام هدر سفارشی (مثلاً X-API-Key)', 'Query Parameter (e.g. ?key=<key>)':'پارامتر Query (مثلاً ?key=<key>)', 'Custom Header Name':'نام هدر سفارشی', 'Custom Query Parameter Name':'نام پارامتر Query سفارشی', 'Endpoint Path Override (Optional)':'مسیر اختصاصی Endpoint (اختیاری)', 'Backup / rotation':'پشتیبان / جایگزین', 'Tap to configure':'برای تنظیم لمس کنید', 'Secondary provider':'Provider دوم', 'Not configured':'تنظیم نشده', 'Secondary Base URL':'Base URL دوم', 'Secondary model / voice':'مدل / صدای دوم', 'Enter second API key':'API Key دوم را وارد کنید', 'Copy API key from another slot':'کپی API Key از بخش دیگر', 'You can copy an API 1 or API 2 key from another capability slot.':'می‌توانید API Key شمارهٔ ۱ یا ۲ را از یکی دیگر از بخش‌ها کپی کنید.', 'Secondary authentication':'روش احراز هویت دوم', 'Bearer':'Bearer', 'Custom header':'هدر سفارشی', 'Query parameter':'پارامتر Query', 'Custom header name':'نام هدر سفارشی', 'Custom query parameter':'پارامتر Query سفارشی', 'Endpoint path override (optional)':'مسیر اختصاصی Endpoint (اختیاری)', 'Test API 2':'آزمایش API 2', 'Test each configured provider separately. The test saves its current settings and checks the connection.':'هر Provider را جداگانه آزمایش کنید. این آزمایش تنظیمات فعلی آن را ذخیره و اتصال را بررسی می‌کند.', 'Save settings':'ذخیرهٔ تنظیمات', 'AI provider settings':'تنظیمات Providerهای هوش مصنوعی', 'About offline accuracy':'دربارهٔ دقت حالت آفلاین', 'IELTS Test Preferences':'تنظیمات آزمون IELTS', 'Show examiner questions as text':'نمایش متنی سؤال‌های ممتحن', 'When off, questions are presented by voice only. The Part 2 cue card remains visible, as in the real IELTS test.':'اگر غیرفعال باشد، سؤال‌ها فقط به‌صورت صوتی پخش می‌شوند. کارت موضوع Part 2 مانند آزمون واقعی همچنان نمایش داده می‌شود.', 'Show text':'نمایش متن', 'Backup & Restore':'پشتیبان‌گیری و بازیابی', 'Choose which information to export or restore.':'اطلاعاتی را که می‌خواهید خروجی بگیرید یا بازیابی کنید انتخاب کنید.', 'Import AI settings':'وارد کردن تنظیمات هوش مصنوعی', 'Security warning':'هشدار امنیتی', 'Export AI settings':'خروجی تنظیمات هوش مصنوعی', 'Export AI settings (with keys)':'خروجی تنظیمات هوش مصنوعی (همراه کلیدها)', 'Export settings only (no keys)':'خروجی تنظیمات (بدون کلیدها)', 'Test data & practice history':'داده‌های آزمون و تاریخچهٔ تمرین', 'Export test data':'خروجی گرفتن از داده‌های آزمون', 'Import test data':'وارد کردن داده‌های آزمون', 'Language / زبان':'زبان / Language', 'App language / زبان برنامه':'زبان برنامه', 'Choose English or فارسی. IELTS questions and final examiner feedback remain in English.':'زبان انگلیسی یا فارسی را انتخاب کنید. سؤال‌های IELTS و بازخورد نهایی ممتحن همچنان انگلیسی خواهند بود.', 'English':'انگلیسی', 'Language preference is saved on this device.':'تنظیم زبان روی همین دستگاه ذخیره می‌شود.', 'Appearance':'نمای ظاهری', 'Choose the look that feels comfortable. System follows your device setting.':'نمای دلخواهتان را انتخاب کنید. حالت System از تنظیمات دستگاه پیروی می‌کند.', 'System':'سیستم', 'Light':'روشن', 'Dark':'تیره', 'Software updates':'به‌روزرسانی نرم‌افزار', 'Installed version:':'نسخهٔ نصب‌شده:', 'Check for updates':'بررسی به‌روزرسانی', 'Updates are checked against the public SpeakCoach repository.':'به‌روزرسانی‌ها از مخزن عمومی SpeakCoach بررسی می‌شوند.', 'Download update':'دریافت به‌روزرسانی', 'Install downloaded update':'نصب به‌روزرسانی دریافت‌شده', 'View release':'مشاهدهٔ نسخه', 'About':'دربارهٔ برنامه', 'Developed by':'توسعه‌دهنده', 'Version':'نسخه', 'GitHub profile — github.com/AriyanD':'پروفایل GitHub — github.com/AriyanD', 'Project repository':'مخزن پروژه', 'Open setup guide / راهنمای شروع':'باز کردن راهنمای شروع', 'System Diagnostics':'عیب‌یابی سیستم', 'Connection checks, permissions and session logs':'بررسی اتصال‌ها، مجوزها و گزارش نشست‌ها', 'Open the detailed diagnostics screen.':'نمایش صفحهٔ کامل عیب‌یابی', 'Open Diagnostics':'باز کردن عیب‌یابی', 'Could not save the language setting. Please try again.':'ذخیرهٔ زبان انجام نشد. دوباره تلاش کنید.', 'Could not save the appearance setting. Please try again.':'ذخیرهٔ نمای ظاهری انجام نشد. دوباره تلاش کنید.', 'Could not save this setting. Please try again.':'ذخیرهٔ این تنظیم انجام نشد. دوباره تلاش کنید.', 'Reading and validating the selected backup…':'در حال خواندن و بررسی نسخهٔ پشتیبان…', 'Test data backup created.':'نسخهٔ پشتیبان داده‌های آزمون ساخته شد.', 'Settings-only backup created. It contains no API keys.':'نسخهٔ پشتیبان تنظیمات ساخته شد. این فایل شامل API Key نیست.', 'API 2: Changes not tested':'API 2: تغییرات آزمایش نشده‌اند', 'API 2: Not configured':'API 2: تنظیم نشده', 'API 2: Choose a provider first.':'API 2: ابتدا یک Provider انتخاب کنید.', 'API 2: Testing…':'API 2: در حال آزمایش…', 'API 1: Testing…':'API 1: در حال آزمایش…', 'Fetching models from endpoint...':'در حال دریافت مدل‌ها از Endpoint…', 'Provider connection tests':'آزمایش اتصال Provider', 'Offline feature accuracy notice':'اطلاعیهٔ دقت قابلیت‌های آفلاین', 'Shadowing Trainer':'تمرین Shadowing', 'Pronunciation accuracy notice':'اطلاعیهٔ دقت ارزیابی تلفظ', 'Learn more':'اطلاعات بیشتر', 'Sentence Library':'مجموعه جمله‌ها', 'Preloaded practice sentences':'جمله‌های آمادهٔ تمرین', 'AI Sentences':'جمله‌های هوش مصنوعی', 'Generate a new sentence on demand':'ساخت جملهٔ جدید با درخواست شما', 'Easy':'آسان', 'Medium':'متوسط', 'Hard':'سخت', 'Generate a new sentence set':'ساخت مجموعهٔ جدید جمله', 'Each request creates five sentences. Next and Previous move through this set without extra API calls.':'در هر درخواست پنج جمله ساخته می‌شود. با دکمه‌های بعدی و قبلی بین جمله‌ها جابه‌جا شوید؛ نیازی به درخواست API اضافی نیست.', 'Optional topic':'موضوع (اختیاری)', 'Random topic':'موضوع تصادفی', 'Get new sentence set':'ساخت مجموعهٔ جملهٔ جدید', 'Leave blank for fully random topics.':'برای انتخاب کاملاً تصادفی موضوع، این قسمت را خالی بگذارید.', 'Sentence source':'منبع جمله', 'Sentence difficulty':'سطح دشواری جمله', 'Sentence playback controls':'کنترل پخش جمله', 'Previous sentence':'جملهٔ قبلی', 'Next sentence':'جملهٔ بعدی', 'Play model at normal speed':'پخش نمونه با سرعت عادی', 'Slow playback (0.72×)':'پخش آهسته (۰٫۷۲ برابر)', 'Your speech will appear here.':'گفتار شما اینجا نمایش داده می‌شود.', 'Start recording repetition':'شروع ضبط تکرار جمله', 'Stop recording and score repetition':'توقف ضبط و ارزیابی تکرار', 'Full Sentence':'جملهٔ کامل', 'Recognized speech:':'گفتار تشخیص‌داده‌شده:', 'Record Repetition':'ضبط تکرار', 'Recording...':'در حال ضبط…', 'Stop & Score':'توقف و ارزیابی', 'Replay My Recording':'پخش صدای ضبط‌شدهٔ من', 'My Recording Slow (0.75x)':'پخش آهستهٔ صدای من (۰٫۷۵ برابر)', 'Shadowing Score Report':'گزارش ارزیابی Shadowing', 'Overall':'امتیاز کلی', 'Fluency':'روانی گفتار', 'Pace':'سرعت گفتار', 'Completeness':'کامل‌بودن', 'Retry Weak Words':'تمرین دوبارهٔ واژه‌های ضعیف', 'Timing & voice activity details':'جزئیات زمان‌بندی و فعالیت صوتی', 'Waveform & Voice Activity (Approximate)':'موج صدا و فعالیت صوتی (تخمینی)', 'Legend:':'راهنما:', 'Speech':'گفتار', 'Pause Marker':'نشانگر مکث', 'Leading/Trailing Silence':'سکوت ابتدا / انتها', 'Speech:':'گفتار:', 'Trailing Silence:':'سکوت پایانی:', 'Mid-Sentence Pauses':'مکث‌های میان جمله', 'Replay My Recording (Disabled in Offline Mode)':'پخش صدای من (در حالت آفلاین غیرفعال است)', 'IELTS Speaking':'مکالمهٔ IELTS', 'Question sets':'مجموعه سؤال‌ها', 'Optional topic for Parts 2 & 3':'موضوع دلخواه برای بخش‌های ۲ و ۳', 'Get new question sets':'ساخت مجموعه سؤال جدید', 'Test mode':'حالت آزمون', 'Full':'کامل', 'Full test · Parts 1, 2, 3':'آزمون کامل · بخش‌های ۱، ۲ و ۳', 'Part 1 only':'فقط بخش ۱', 'Part 2 only':'فقط بخش ۲', 'Part 3 only':'فقط بخش ۳', 'No saved question sets yet':'هنوز مجموعه سؤالی ذخیره نشده است', 'Open AI settings':'باز کردن تنظیمات هوش مصنوعی', 'View past results & trends':'مشاهدهٔ نتایج و روندهای قبلی', 'Restore previous sets':'بازیابی مجموعه‌های قبلی', 'Start practice':'شروع تمرین', 'Resume':'ادامه', 'Discard':'حذف', 'Cancel':'انصراف', 'Preparing your session…':'در حال آماده‌سازی نشست…', 'Getting your questions ready. This may take a moment; please keep this screen open.':'در حال آماده‌سازی سؤال‌ها هستیم. ممکن است کمی طول بکشد؛ لطفاً این صفحه را باز نگه دارید.', 'Evaluator connection warning':'هشدار اتصال ارزیاب', 'Your answers are saved even if evaluation is unavailable.':'حتی اگر ارزیابی در دسترس نباشد، پاسخ‌های شما ذخیره می‌شوند.', 'Review Settings':'بررسی تنظیمات', 'Transcription accuracy notice':'اطلاعیهٔ دقت تبدیل گفتار به متن', 'A saved session is waiting':'یک نشست ذخیره‌شده در انتظار ادامه است', 'Test session paused':'آزمون متوقف شده است', 'Retry this step':'تلاش دوباره', 'Evaluating your test…':'در حال ارزیابی آزمون…', 'Transcribing your answer…':'در حال تبدیل پاسخ شما به متن…', 'Processing audio through speech recognizer':'در حال پردازش صدا با سامانهٔ تشخیص گفتار', 'Nothing was recognized':'گفتاری تشخیص داده نشد', 'Re-record answer':'ضبط دوبارهٔ پاسخ', 'Continue without an answer':'ادامه بدون پاسخ', 'Your turn. Speak clearly into the microphone.':'نوبت شماست. واضح و رو به میکروفون صحبت کنید.', 'PREPARATION TIME':'زمان آماده‌سازی', 'Start speaking now':'اکنون صحبت را شروع کنید', 'Notes (optional):':'یادداشت‌ها (اختیاری):', 'Recording in progress':'ضبط در حال انجام است', 'Done speaking':'پایان صحبت', 'Your Notes:':'یادداشت‌های شما:', 'Question source:':'منبع سؤال:', 'Saved offline question set from an earlier version':'مجموعه سؤال آفلاین ذخیره‌شده از نسخهٔ قبلی', 'Saved offline question set':'مجموعه سؤال آفلاین ذخیره‌شده', 'AI connection required':'اتصال به هوش مصنوعی لازم است', 'Generating five sets…':'در حال ساخت پنج مجموعه…', 'Generating five new AI question sets. Your current unfinished sets will be replaced only after the new batch is saved.':'در حال ساخت پنج مجموعه سؤال جدید با هوش مصنوعی هستیم. مجموعه‌های ناتمام فعلی فقط پس از ذخیرهٔ موفق مجموعه‌های جدید جایگزین می‌شوند.', 'IELTS Test History':'تاریخچهٔ آزمون IELTS', 'Your completed speaking sessions, ready whenever you want to review them':'نشست‌های مکالمهٔ تکمیل‌شده؛ هر زمان بخواهید می‌توانید آن‌ها را مرور کنید', '← Back to IELTS Test':'← بازگشت به آزمون IELTS', 'No practice history yet':'هنوز سابقهٔ تمرینی وجود ندارد', 'Start a mock test':'شروع آزمون آزمایشی', 'Attempt':'تلاش', 'Not assessed':'ارزیابی نشده', 'Repeat same test':'تکرار همین آزمون', 'Re-evaluate':'ارزیابی دوباره', 'View full report':'مشاهدهٔ گزارش کامل', 'Inspect answers':'بررسی پاسخ‌ها', 'Delete':'حذف', 'Delete all history':'حذف تمام تاریخچه', 'Re-evaluation method':'روش ارزیابی دوباره', 'Delete this test record':'حذف این رکورد آزمون', 'Re-evaluating…':'در حال ارزیابی دوباره…', 'Progress compared with your previous attempt':'مقایسه با تلاش قبلی', 'Changes in actual answers':'تغییرات پاسخ‌ها', 'Previous:':'قبلی:', 'Current:':'فعلی:', 'Improvements:':'بهبودها:', 'Next priorities:':'اولویت‌های بعدی:', 'Attempt comparison unavailable':'مقایسهٔ تلاش‌ها در دسترس نیست', 'Your spoken answers':'پاسخ‌های گفتاری شما', 'Questions & Answers — Copy All':'سؤال‌ها و پاسخ‌ها — کپی همه', 'Copy all questions & answers':'کپی همهٔ سؤال‌ها و پاسخ‌ها', 'Previous evaluation results':'نتایج ارزیابی‌های قبلی', 'Each evaluation is kept separately, so comparing providers will not erase earlier results.':'هر ارزیابی جداگانه نگهداری می‌شود؛ بنابراین مقایسهٔ Providerها نتایج قبلی را پاک نمی‌کند.', 'When should you re-evaluate?':'چه زمانی دوباره ارزیابی کنید؟', 'The first API evaluation runs automatically after the test. You normally do not need to run it again.':'اولین ارزیابی API پس از آزمون به‌صورت خودکار انجام می‌شود و معمولاً نیازی به اجرای دوباره نیست.', 'Automatic (API 1 or API 2)':'خودکار (API 1 یا API 2)', 'API 1 only — compare model':'فقط API 1 — مقایسهٔ مدل', 'API 2 only — compare model':'فقط API 2 — مقایسهٔ مدل', '(Not assessed)':'(ارزیابی نشده)', 'A useful next focus':'تمرکز پیشنهادی برای تمرین بعدی', 'Speech statistics':'آمار گفتار', 'Speech statistics only':'فقط آمار گفتار', 'Pauses':'مکث‌ها', 'Fillers':'واژه‌های پُرکننده', 'WPM':'واژه در دقیقه','Word Count':'تعداد واژه‌ها', 'Answer Count':'تعداد پاسخ‌ها', 'Grammar corrections':'اصلاحات گرامری', 'Vocabulary upgrades':'ارتقای واژگان', 'Band 7–9 model answers':'پاسخ‌های نمونهٔ Band 7 تا 9', 'IELTS Speaking Test Report':'گزارش آزمون مکالمهٔ IELTS', 'IELTS practice scoring':'امتیازدهی تمرینی IELTS', 'No valid score available':'امتیاز معتبر در دسترس نیست', 'No band score this time':'این بار نمرهٔ Band ثبت نشد', 'Start New Test':'شروع آزمون جدید', 'Return to Menu':'بازگشت به منو', 'View History':'مشاهدهٔ تاریخچه', 'AI practice estimate':'برآورد تمرینی هوش مصنوعی', 'Legacy evaluation':'ارزیابی نسخهٔ قدیمی', 'Assessed criteria':'معیارهای ارزیابی‌شده', 'Three criteria are estimated. Pronunciation is not assessed by speech-recognition confidence.':'سه معیار برآورد می‌شوند. تلفظ بر اساس میزان اطمینان تشخیص گفتار ارزیابی نمی‌شود.', 'Next practice focus':'تمرکز تمرین بعدی', 'IELTS scoring criteria':'معیارهای امتیازدهی IELTS', 'Screenshot-ready status of permissions, storage, TTS & 5 slots':'وضعیت مجوزها، ذخیره‌سازی، TTS و پنج بخش', 'App / Build Version & Platform':'نسخهٔ برنامه / ساخت و پلتفرم', 'Microphone Permission':'مجوز میکروفون', 'Native TTS Availability':'دسترسی به TTS داخلی', 'Secure Key Storage R/W Self-Test':'آزمایش خواندن و نوشتن امن کلیدها', 'Request Mic Permission':'درخواست مجوز میکروفون', 'Run Live Check (All 5 Slots)':'آزمایش زنده (هر پنج بخش)', 'Per-Slot Active Tier & Connection Status':'سطح فعال و وضعیت اتصال هر بخش', 'Requesting Mic...':'در حال درخواست مجوز میکروفون…', 'Probing 5 Slots...':'در حال بررسی پنج بخش…', 'Last Shadowing Attempt':'آخرین تلاش Shadowing', 'NONE YET':'هنوز انجام نشده', 'Reference Sentence':'جملهٔ مرجع', 'Raw Recognizer Text & Confidence':'متن خام تشخیص‌گر و میزان اطمینان', 'Recognizer Alternatives':'گزینه‌های جایگزین تشخیص‌گر', 'STT Word List with Start/End Times':'فهرست واژه‌های STT همراه زمان شروع و پایان', 'Alignment Result Per Word':'نتیجهٔ هم‌ترازی هر واژه', 'Last IELTS Evaluation':'آخرین ارزیابی IELTS', 'Failure Reason':'دلیل شکست', 'Answers Preserved':'پاسخ‌ها حفظ شده‌اند', 'Last IELTS Session Log':'گزارش آخرین نشست IELTS', 'EMPTY':'خالی', 'HEALTHY':'سالم', 'ONLINE':'آنلاین', 'OFFLINE':'آفلاین', 'READY':'آماده', 'UNAVAILABLE':'در دسترس نیست', 'PASS':'موفق', 'FAIL':'ناموفق', 'Copied.':'کپی شد.', 'Copy':'کپی', 'Close':'بستن', 'Save':'ذخیره', 'Back':'بازگشت', 'Next':'بعدی', 'Previous':'قبلی', 'Done':'تمام', 'Topic:':'موضوع:',
  'API 1 result:':'نتیجهٔ API 1:',
  'After selecting a provider and adding its API key, tap':'پس از انتخاب Provider و افزودن API Key، دکمهٔ',
  'Test API 1':'آزمایش API 1',
  'Free-Text Voice Name (e.g. Puck, Charon, Kore, Fenrir, Aoede / alloy)':'نام صدای متنی (مثلاً Puck، Charon، Kore، Fenrir، Aoede یا alloy)',
  'Approximate VAD':'تشخیص تقریبی فعالیت صوتی (VAD)',
  'Word timing & recording replay disabled in System SpeechRecognizer mode:':'زمان‌بندی واژه‌ها و بازپخش ضبط در حالت System SpeechRecognizer غیرفعال است:',
  'Scored via':'روش ارزیابی:',
  'Voice:':'صدا:',
  '· Practise pronunciation at your own pace':'· تلفظ را با سرعت دلخواه خود تمرین کنید',
  'Saved offline set':'مجموعهٔ آفلاین ذخیره‌شده',
  'Saving your IELTS result...':'در حال ذخیرهٔ نتیجهٔ IELTS…',
  'If this is a repeated test, the app will also compare your new answers and scores with the previous attempt.':'اگر این آزمون را تکرار کرده باشید، برنامه پاسخ‌ها و امتیازهای جدید را با تلاش قبلی نیز مقایسه می‌کند.',
  'Part 1':'بخش ۱',
  'Part 2':'بخش ۲',
  'Part 3':'بخش ۳',
  'Skipped':'بدون پاسخ',
  'For external analysis outside the app, if needed.':'در صورت نیاز، برای تحلیل خارج از برنامه.',
  'View':'مشاهده',
  '3-criterion practice estimate:':'برآورد تمرینی بر اساس سه معیار:',
  'Backup evaluator:':'ارزیاب پشتیبان:',
  'Lexical':'واژگان',
  'Grammar':'دستور زبان',
  'Pronunciation':'تلفظ',
  'Scores (Overall / Word Match / Fluency / Completeness)':'امتیازها (کلی / تطبیق واژه / روانی / کامل‌بودن)',
  'FAILED':'ناموفق',
  'Assessed criteria (FC / LR / GRA; Pronunciation not assessed)':'معیارهای ارزیابی‌شده (روانی و انسجام / واژگان / دستور زبان؛ تلفظ ارزیابی نشده)',
  'Answers Evaluated':'پاسخ‌های ارزیابی‌شده',
  'Active:':'فعال:',
  'Enter your API key...':'API Key خود را وارد کنید…',
  'No API key needed':'نیازی به API Key نیست',
  'Basic offline':'آفلاین پایه',
  'Tap "Play Model 1.0x" to listen, then "Record Repetition" to repeat aloud.':'برای شنیدن جمله، «Play Model 1.0x» را بزنید و سپس با «Record Repetition» آن را با صدای بلند تکرار کنید.',
  'Everyday communication':'ارتباطات روزمره',
  'Travel and culture':'سفر و فرهنگ',
  'Work and careers':'کار و مسیر شغلی',
  'Learning and education':'یادگیری و آموزش',
  'Sustainable living':'زندگی پایدار',
  'Technology in daily life':'فناوری در زندگی روزمره',
  'Friendship and relationships':'دوستی و روابط',
  'Health and routines':'سلامت و عادت‌های روزانه',
  'Cities and communities':'شهرها و جوامع',
  'Nature and the environment':'طبیعت و محیط زیست',
  '(No speech detected)':'(گفتاری تشخیص داده نشد)',
  'No valid three-criterion practice estimate was produced':'برآورد تمرینی معتبر بر اساس سه معیار تولید نشد',
  'Delete this test record?':'این رکورد آزمون حذف شود؟',
  'Delete record':'حذف رکورد',
  'Recording 16 kHz WAV (Online STT mode)... Speak clearly, then tap "Stop & Score Repetition".':'در حال ضبط فایل WAV با فرکانس ۱۶ کیلوهرتز (حالت Online STT)… واضح صحبت کنید و سپس «Stop & Score Repetition» را بزنید.',
  'Listening via Android system speech recognition (no raw audio retained by SpeakCoach in this mode)... Speak clearly, then tap "Stop & Score Repetition".':'در حال شنیدن از طریق تشخیص گفتار Android هستیم (در این حالت فایل صوتی خام در SpeakCoach نگهداری نمی‌شود)… واضح صحبت کنید و سپس «Stop & Score Repetition» را بزنید.',
  'SpeakCoach is a personal practice app for English shadowing and IELTS Speaking. It brings together speech practice, AI-assisted feedback and test history in one place.':'SpeakCoach برنامه‌ای برای تمرین شخصی Shadowing انگلیسی و مکالمهٔ IELTS است. تمرین گفتار، بازخورد هوش مصنوعی و تاریخچهٔ آزمون‌ها را در یک محیط گرد هم می‌آورد.',
  'AI-generated feedback is for learning and practice only. It is not an official IELTS score or a substitute for a certified examiner.':'بازخورد تولیدشده با هوش مصنوعی فقط برای یادگیری و تمرین است؛ نمرهٔ رسمی IELTS محسوب نمی‌شود و جایگزین ممتحن دارای صلاحیت نیست.',
  'No release notes were provided.':'یادداشت انتشار ارائه نشده است.',
  'In-app APK updates are available in the Android app.':'به‌روزرسانی APK از داخل برنامه در نسخهٔ Android در دسترس است.',
  'You are using the latest published version of SpeakCoach.':'در حال حاضر از آخرین نسخهٔ منتشرشدهٔ SpeakCoach استفاده می‌کنید.',
  'Checking the latest published SpeakCoach release…':'در حال بررسی آخرین نسخهٔ منتشرشدهٔ SpeakCoach…',
  'A newer version is available. Download it when you are ready.':'نسخهٔ جدیدتری در دسترس است. هر زمان آماده بودید آن را دریافت کنید.',
  'The update APK has been downloaded. Tap Install downloaded update to continue.':'فایل به‌روزرسانی APK دریافت شد. برای ادامه، گزینهٔ Install downloaded update را بزنید.',
  'API key was not copied to the custom provider:':'API Key به Provider سفارشی کپی نشد:',
  'Suggestions added to the list.':'پیشنهادها به فهرست اضافه شدند.',
  'Saving the current provider settings and API keys before export...':'در حال ذخیرهٔ تنظیمات فعلی Providerها و API Keyها پیش از خروجی گرفتن…',
  'Creating a settings-only backup without API keys...':'در حال ساخت نسخهٔ پشتیبان تنظیمات بدون API Key…',
  'Settings-only backup created. It contains no API keys. Importing it on this device or another device':'نسخهٔ پشتیبان تنظیمات ساخته شد و شامل API Key نیست. می‌توانید آن را در همین دستگاه یا دستگاه دیگری وارد کنید.',
  'Continue':'ادامه',
  'Import backup':'وارد کردن نسخهٔ پشتیبان',
  'Cancel this test?':'این آزمون لغو شود؟',
  'Your answers saved so far will remain available in your session history.':'پاسخ‌هایی که تا این لحظه ثبت کرده‌اید در تاریخچهٔ نشست باقی می‌مانند.',
  'Cancel test':'لغو آزمون',
  'Delete all test history?':'تمام تاریخچهٔ آزمون‌ها حذف شود؟',
  'All saved IELTS sessions and their results will be permanently deleted.':'تمام نشست‌های ذخیره‌شدهٔ IELTS و نتایج آن‌ها برای همیشه حذف خواهند شد.',
  'Keep history':'حفظ تاریخچه',
  'This saved session and its report will be removed from your history.':'این نشست ذخیره‌شده و گزارش آن از تاریخچه حذف خواهند شد.',
  'Keep record':'حفظ رکورد',
  'Current appearance: System.':'نمای فعلی: سیستم.',
  'Current appearance: Dark.':'نمای فعلی: تیره.',
  'Current appearance: Light.':'نمای فعلی: روشن.',
  'AI sentence':'جملهٔ هوش مصنوعی',
  'Generate an AI sentence to begin shadowing.':'برای شروع Shadowing یک جملهٔ هوش مصنوعی بسازید.',
  'Generate a sentence to see its pronunciation focus':'برای مشاهدهٔ نکتهٔ تلفظی، یک جمله بسازید',
  'Weak-word practice is active — choose Full Sentence to return.':'تمرین واژه‌های ضعیف فعال است؛ برای بازگشت، گزینهٔ Full Sentence را انتخاب کنید.',
  'Word match':'تطبیق واژه',
  'Pronunciation assessment':'ارزیابی تلفظ',
  '1. Voice (Text-to-Speech)':'۱. صدا (تبدیل متن به گفتار)',
  'Natural model voice for shadowing & IELTS examiner prompts':'صدای طبیعی مدل برای Shadowing و پرسش‌های ممتحن IELTS',
  '2. Shadowing: Speech-to-Text & Pronunciation Analysis':'۲. Shadowing: تبدیل گفتار به متن و تحلیل تلفظ',
  'Transcribes Shadowing audio, aligns words and timing, and analyzes pronunciation':'صدای تمرین Shadowing را به متن تبدیل می‌کند، زمان‌بندی واژه‌ها را هم‌تراز می‌کند و تلفظ را تحلیل می‌کند.',
  '3. Speech-to-Text for IELTS Answers':'۳. تبدیل پاسخ‌های IELTS از گفتار به متن',
  'Transcribes IELTS answers into text; no word-level pronunciation scoring':'پاسخ‌های IELTS را به متن تبدیل می‌کند؛ امتیازدهی تلفظ در سطح واژه انجام نمی‌دهد.',
  '4. LLM Evaluator (IELTS Scoring & Feedback)':'۴. ارزیاب LLM (امتیازدهی و بازخورد IELTS)',
  'Band 0–9 criteria scoring, sentence rewrites, and vocabulary upgrades':'امتیازدهی معیارها در بازهٔ Band 0 تا 9، بازنویسی جمله‌ها و ارتقای واژگان',
  '5. LLM Generator (Questions & Sentences)':'۵. تولیدکنندهٔ LLM (سؤال‌ها و جمله‌ها)',
  'AI-generated IELTS questions & shadowing practice sentences':'تولید سؤال‌های IELTS و جمله‌های تمرینی Shadowing با هوش مصنوعی',
  'Online AI':'هوش مصنوعی آنلاین',
  'Online':'آنلاین',
  'No internet connection':'اتصال اینترنت برقرار نیست',
  'No API key configured':'هیچ API Keyای تنظیم نشده است',
  'No base URL configured':'Base URL تنظیم نشده است',
  'No model configured':'نام مدل تنظیم نشده است',
  'Provider has not passed a successful test.':'Provider هنوز آزمون اتصال موفقی را پشت سر نگذاشته است.',
  'Connect the services you want to use. Requests are sent directly from your device. If a service is unavailable, supported practice can continue with offline tools.':'سرویس‌هایی را که می‌خواهید استفاده کنید متصل کنید. درخواست‌ها مستقیماً از دستگاه شما ارسال می‌شوند. اگر سرویسی در دسترس نباشد، بخش‌هایی از تمرین که پشتیبانی می‌شوند همچنان با ابزارهای آفلاین قابل استفاده‌اند.',
  'Some features can run without an AI connection, but their results are basic estimates. IELTS question generation and speaking evaluation are more useful with a tested AI provider. Android speech recognition and word/timing matching are approximate; they do not assess phoneme-level pronunciation. Connect and test a validated pronunciation-assessment provider for that capability.':'برخی قابلیت‌ها بدون اتصال به هوش مصنوعی نیز اجرا می‌شوند، اما نتایج آن‌ها تخمینی و پایه‌ای است. تولید سؤال‌های IELTS و ارزیابی مکالمه با یک Provider هوش مصنوعی که اتصالش آزمایش شده باشد، نتیجهٔ بهتری می‌دهد. تشخیص گفتار Android و تطبیق واژه و زمان‌بندی تقریبی‌اند و تلفظ را در سطح واج ارزیابی نمی‌کنند. برای این قابلیت، یک Provider معتبر ارزیابی تلفظ را متصل و آزمایش کنید.',
  'Android\'s system SpeechRecognizer returns transcript text only to SpeakCoach in this mode; the OS recognition service controls audio processing and may require network access. Configure an online Whisper STT slot for recording replay and per-word timing.':'در این حالت، System SpeechRecognizer اندروید فقط متن تشخیص‌داده‌شده را به SpeakCoach می‌دهد؛ سرویس تشخیص گفتار سیستم‌عامل پردازش صدا را کنترل می‌کند و ممکن است به اینترنت نیاز داشته باشد. برای بازپخش ضبط و زمان‌بندی تک‌تک واژه‌ها، یک Slot آنلاین Whisper STT تنظیم کنید.',
  'Offline feedback uses Android\'s system SpeechRecognizer and approximate word/timing checks. It is still useful for practising repetition, fluency and matching the target sentence, but it is not a precise pronunciation score. For more dependable transcription and word-level timing, connect and test an online speech-to-text provider in Slot 2 (for example, Groq Whisper when available for your account). This improves the information available to the practice feedback, but true phoneme-level pronunciation assessment requires a dedicated pronunciation-assessment service.':'بازخورد این حالت با استفاده از SpeechRecognizer خود Android و بررسی تقریبی تطبیق واژه و زمان‌بندی ارائه می‌شود. این قابلیت همچنان برای تمرین تکرار، روانی گفتار و تطبیق جملهٔ هدف مفید است، اما نمرهٔ دقیق تلفظ محسوب نمی‌شود. برای تبدیل گفتار به متن و زمان‌بندی قابل‌اتکاتر واژه‌ها، یک Provider آنلاین تبدیل گفتار به متن را در Slot 2 متصل و آزمایش کنید؛ برای مثال Groq Whisper، در صورت دسترس‌پذیری برای حساب شما. این کار اطلاعات دقیق‌تری برای بازخورد تمرین فراهم می‌کند، اما ارزیابی واقعی تلفظ در سطح واج همچنان به سرویس تخصصی ارزیابی تلفظ نیاز دارد.',
  'An AI API is required for IELTS evaluation. Your answers are saved if evaluation cannot be completed; reconnect and retry from Test History.':'برای ارزیابی IELTS به یک AI API نیاز است. اگر ارزیابی کامل نشود، پاسخ‌های شما ذخیره می‌شوند؛ اتصال را برقرار کنید و از بخش Test History دوباره تلاش کنید.',
  'Answers are currently transcribed with the device\'s system speech recognizer. Depending on your Android speech service and device settings, it may use online services. Accuracy may vary, especially with accents or background noise; a tested AI speech-to-text provider may offer more consistent results.':'در حال حاضر پاسخ‌ها با سامانهٔ تشخیص گفتار خود دستگاه به متن تبدیل می‌شوند. بسته به سرویس گفتار Android و تنظیمات دستگاه، ممکن است از خدمات آنلاین استفاده شود. دقت، به‌ویژه در لهجه‌ها یا محیط‌های پرسروصدا، متغیر است؛ یک Provider آزمایش‌شدهٔ تبدیل گفتار به متن مبتنی بر هوش مصنوعی ممکن است نتایج یکنواخت‌تری ارائه دهد.',
  'Provider choices, model names, connection settings and preferences are saved here. You can export them with or without API keys.':'انتخاب Providerها، نام مدل‌ها، تنظیمات اتصال و ترجیحات برنامه در این بخش ذخیره می‌شوند. می‌توانید از آن‌ها همراه API Key یا بدون کلید خروجی بگیرید.',
  'includes your API keys. Anyone who gets that file could use those keys. Keep it private and store it securely. For sharing or cloud storage, use the no-key export instead.':'شامل API Keyهای شماست. هر کسی به این فایل دسترسی پیدا کند ممکن است بتواند از کلیدهایتان استفاده کند. فایل را محرمانه نگه دارید و در محل امن ذخیره کنید. برای اشتراک‌گذاری یا نگهداری در فضای ابری، از خروجی بدون کلید استفاده کنید.',
  'Feedback uses Android\'s system SpeechRecognizer and word/timing heuristics. Android may still use a network service even when offline recognition is preferred. This is rough word-match practice guidance, not phoneme-level pronunciation assessment.':'بازخورد این حالت با استفاده از SpeechRecognizer خود Android و روش‌های تخمینی تطبیق واژه و زمان‌بندی تولید می‌شود. حتی اگر تشخیص آفلاین را ترجیح دهید، Android ممکن است همچنان از سرویس اینترنتی استفاده کند. بنابراین نتیجه برای تمرین و بررسی تقریبی تطبیق واژه‌ها مفید است، اما ارزیابی دقیق تلفظ در سطح واج نیست. برای دریافت نتیجهٔ قابل‌اتکاتر، یک Provider آنلاین تبدیل گفتار به متن را در Slot 2 تنظیم و اتصال آن را آزمایش کنید؛ برای مثال Groq با مدل Whisper، در صورت پشتیبانی و دسترس‌پذیری در حساب شما. این اتصال می‌تواند متن و زمان‌بندی واژه‌ها را بهتر در اختیار ابزار تمرین قرار دهد، اما جایگزین سرویس تخصصی ارزیابی تلفظ در سطح واج نیست.',
  'Offline pronunciation accuracy notice':'اطلاعیهٔ دقت ارزیابی تلفظ آفلاین',
  'Offline transcription accuracy notice':'اطلاعیهٔ دقت تبدیل گفتار به متن آفلاین',
  'API key recovery notice':'اطلاعیهٔ بازیابی API Key',

  'IELTS evaluation requires an online AI API. Offline IELTS evaluation is not available.':'برای ارزیابی IELTS به یک API هوش مصنوعی آنلاین نیاز است. ارزیابی آفلاین IELTS در دسترس نیست.',
  'Configure a separate provider and key. It is used if the primary fails. Speech recognition rotates between verified providers.':'یک Provider و کلید جداگانه تنظیم کنید. اگر Provider اصلی از کار بیفتد، از این Provider استفاده می‌شود. تشخیص گفتار میان Providerهای تأییدشده جابه‌جا می‌شود.',
  'No previous question-set generation is available.':'مجموعهٔ سؤال قبلی برای بازیابی وجود ندارد.',
  'No clear speech was detected. You can record your answer again, or continue without answering this question.':'گفتار واضحی تشخیص داده نشد. می‌توانید پاسخ را دوباره ضبط کنید یا بدون پاسخ به سؤال بعدی بروید.',
  'Using the basic Android voice. Online TTS was unavailable for this question.':'برای این سؤال از صدای پایهٔ Android استفاده می‌شود؛ سرویس آنلاین تبدیل متن به گفتار در دسترس نبود.',
  'If the API connection fails, your answers remain saved in History. Re-evaluate after restoring the connection. Choose API 1 or API 2 separately only when comparing models; Automatic tries API 1 and falls back to API 2.':'اگر اتصال API ناموفق باشد، پاسخ‌های شما در تاریخچه باقی می‌مانند. پس از برقراری دوبارهٔ اتصال، ارزیابی را تکرار کنید. فقط هنگام مقایسهٔ مدل‌ها API 1 یا API 2 را جداگانه انتخاب کنید؛ حالت خودکار ابتدا API 1 را امتحان می‌کند و در صورت نیاز به API 2 می‌رود.',
  'An AI evaluator was not available, so this report shows speech statistics only.':'ارزیاب هوش مصنوعی در دسترس نبود؛ بنابراین این گزارش فقط آمار گفتار را نمایش می‌دهد.',
  'Take an IELTS mock test to view band telemetry and detailed criteria breakdown here.':'برای مشاهدهٔ اطلاعات Band و جزئیات معیارهای ارزیابی، یک آزمون آزمایشی IELTS انجام دهید.',
  'Start a test to record transition timestamps and error diagnostics here.':'برای ثبت زمان تغییر مراحل و اطلاعات خطاها، یک آزمون را شروع کنید.',


  'Securely stored on this device':'به‌صورت امن در این دستگاه ذخیره شده است',
  'Browser storage (not encrypted)':'ذخیره‌شده در مرورگر (بدون رمزگذاری)',
  'IELTS history, AI-generated question sets and their undo history, question repetition tracking, and your latest Shadowing attempt.':'تاریخچهٔ IELTS، مجموعه‌سؤال‌های تولیدشده با هوش مصنوعی و سابقهٔ بازگردانی آن‌ها، پیگیری سؤال‌های تکراری و آخرین تمرین Shadowing شما.',
  'AI settings can be exported with API keys for device migration, or without keys for safer sharing. Importing a no-key backup leaves the API keys already stored on this device unchanged.':'می‌توانید تنظیمات هوش مصنوعی را برای انتقال به دستگاه دیگر همراه API Keyها خروجی بگیرید یا برای اشتراک‌گذاری امن‌تر، بدون کلیدها ذخیره کنید. با وارد کردن نسخهٔ پشتیبان بدون کلید، API Keyهای موجود در این دستگاه تغییر نمی‌کنند.',
  'Check the official SpeakCoach GitHub releases for a newer version.':'برای بررسی نسخهٔ جدیدتر، بخش انتشارهای رسمی SpeakCoach در GitHub را بررسی کنید.',
  'It brings together speech practice, AI-assisted feedback and test history in one place.':'تمرین گفتار، بازخورد هوش مصنوعی و تاریخچهٔ آزمون‌ها را در یک برنامه گرد هم می‌آورد.',
  'It is not an official IELTS score or a substitute for a certified examiner.':'این امتیاز رسمی IELTS نیست و جایگزین ارزیابی ممتحن معتبر نمی‌شود.',
  'Saving the current provider settings and API keys...':'در حال ذخیرهٔ تنظیمات فعلی Providerها و API Keyها…',
  'Import AI provider settings AND API keys? This will replace the current provider settings and keys with the values in the backup. Only import a file you trust.':'تنظیمات Providerهای هوش مصنوعی و API Keyها وارد شوند؟ این کار تنظیمات و کلیدهای فعلی را با مقادیر موجود در فایل پشتیبان جایگزین می‌کند. فقط فایلی را وارد کنید که به آن اعتماد دارید.',
  'A settings-only backup contains no API keys. Existing keys on this device will remain unchanged.':'نسخهٔ پشتیبانِ فقط تنظیمات، هیچ API Keyای ندارد. کلیدهای موجود در این دستگاه بدون تغییر باقی می‌مانند.',
  'No saved key was found for:':'کلید ذخیره‌شده‌ای برای این مورد پیدا نشد:',
  'Keep this file private and secure':'این فایل را محرمانه و در محل امن نگهداری کنید',
  'Fluency (approx.)':'روانی گفتار (تخمینی)',
  'Pace (approx.)':'سرعت گفتار (تخمینی)',
  'Open API Settings':'باز کردن تنظیمات API',
  'I understand':'متوجه شدم',
  'Audio playback failed. Check Voice / TTS settings and open Troubleshooting for help.':'پخش صدا ناموفق بود. تنظیمات Voice / TTS را بررسی کنید و برای راهنمایی، بخش عیب‌یابی را باز کنید.',
  'Microphone could not start. Check microphone permission and try again.':'میکروفون شروع به کار نکرد. مجوز میکروفون را بررسی کنید و دوباره تلاش کنید.',
  'Speech could not be transcribed. Check API Settings and try recording again. Technical details are available below.':'گفتار به متن تبدیل نشد. تنظیمات API را بررسی کنید و دوباره ضبط کنید. جزئیات فنی در پایین صفحه موجود است.',
  'No speech was recognized. Check microphone access and speech API settings, then record again.':'گفتاری تشخیص داده نشد. دسترسی میکروفون و تنظیمات API گفتار را بررسی کنید و دوباره ضبط کنید.',
  'Recording could not be stopped. Please try again.':'ضبط متوقف نشد. لطفاً دوباره تلاش کنید.',
  'Could not generate a new sentence set. Check your connection and Question & Sentence Generator API settings, then try again.':'ساخت مجموعهٔ جملهٔ جدید ممکن نشد. اتصال اینترنت و تنظیمات API بخش تولید سؤال و جمله را بررسی کنید و دوباره تلاش کنید.',
  'Technical details':'جزئیات فنی',
  '1 Part 2 cue card':'یک کارت موضوع برای بخش ۲',

};

const dynamicPrefixes: Array<[string, string]> = [['Version ', 'نسخهٔ '], ['Evaluation could not finish: ', 'ارزیابی کامل نشد: '], ['Using the basic Android voice. Online TTS was unavailable for this question.', 'برای این سؤال از صدای پایهٔ Android استفاده می‌شود؛ سرویس آنلاین تبدیل متن به گفتار در دسترس نبود.'], ['Tested: ', 'زمان آزمایش: '], ['Attempt ', 'تلاش '], ['Saved ', 'ذخیره‌شده '], ['Generating ', 'در حال ساخت '], ['Topic: ', 'موضوع: '], ['WPM:', 'واژه در دقیقه:'], ['Pauses:', 'مکث‌ها:'], ['Fillers:', 'واژه‌های پُرکننده:'], ['Words:', 'واژه‌ها:'], ['Answers:', 'پاسخ‌ها:'], ['Reason: ', 'دلیل: '], ['AI · ', 'هوش مصنوعی · '], ['Microphone error: ', 'خطای میکروفون: '], ['Basic offline (', 'آفلاین پایه ('], ['Provider has not passed a successful test. ', 'Provider هنوز آزمون اتصال موفقی را پشت سر نگذاشته است. '], ['Retry Weak Words (', 'تمرین دوبارهٔ واژه‌های ضعیف ('], ['Mid-Sentence Pauses (', 'مکث‌های میان جمله ('], ['Focus: ', 'تمرکز: '], ['Alternatives / Confidence: ', 'گزینه‌های جایگزین / میزان اطمینان: '], ['Question source: AI', 'منبع سؤال: هوش مصنوعی'], ['Question source: saved offline set', 'منبع سؤال: مجموعهٔ آفلاین ذخیره‌شده'], ['API key was not copied to the custom provider: ', 'API Key به Provider سفارشی کپی نشد: '], ['Save failed — ', 'ذخیره ناموفق بود — '], ['API 2: FAIL — ', 'API 2: ناموفق — '], ['API 1: FAIL — ', 'API 1: ناموفق — '], ['API 2: PASS — ', 'API 2: موفق — '], ['API 1: PASS — ', 'API 1: موفق — '], ['Question source: AI', 'منبع سؤال: هوش مصنوعی']];
const attributes = ['placeholder', 'title', 'aria-label'];
let observer: MutationObserver | null = null;
let currentLanguage: AppLanguage = 'en';
const originalTextNodes = new WeakMap<Text, { source: string; translated: string }>();
const originalAttributes = new WeakMap<Element, Map<string, { source: string; translated: string }>>();

function translateTextNode(node: Text): void {
  const parent = node.parentElement;
  if (!parent || parent.closest('[data-no-translate],input,textarea,code,pre,.setup-prompt,.setup-link,.ielts-question-text,.ielts-cue-card,.sentence-box,#sh-target-text,#sh-transcript-input,.ielts-criterion-comment,.ielts-subscore-desc,.ielts-model-question,.ielts-model-answer,.ielts-comparison-answer-card,.ielts-comparison-analysis,.ielts-next-focus p,.ielts-transcript-question,.ielts-transcript-answer,.examiner-question,.candidate-answer,.spoken-answer,.feedback-content,.evaluation-feedback,.model-answer-content')) return;
  const current = node.nodeValue ?? '';
  const previous = originalTextNodes.get(node);
  const original = previous && current === previous.translated ? previous.source : current;
  const trimmed = original.trim();
  if (!trimmed) return;
  let translated = fa[trimmed];
  if (!translated) {
    const historyCount = trimmed.match(/^(\d+) completed (session|sessions) recorded$/);
    if (historyCount) translated = `${historyCount[1]} نشست تکمیل‌شده در تاریخچه ثبت شده`;
    const evaluatorWarning = trimmed.match(/^Evaluator pre-test warning \(([\s\S]*)\)\. Your answers are still saved if evaluation fails\.$/);
    if (evaluatorWarning) translated = 'هشدار پیش از آزمون ارزیاب (' + evaluatorWarning[1] + '). پاسخ‌های شما حتی در صورت ناموفق بودن ارزیابی ذخیره می‌شوند.';
    const partialSave = trimmed.match(/^(.*?)(\d+) completed set\(s\) from this request were saved; your existing sets were kept\. You can retry later to add more\.$/);
    if (partialSave) translated = `${partialSave[1]}${partialSave[2]} مجموعهٔ تکمیل‌شده از این درخواست ذخیره شد و مجموعه‌های قبلی شما حفظ شدند. بعداً می‌توانید برای افزودن مجموعه‌های بیشتر دوباره تلاش کنید.`;
    const retryLimit = trimmed.match(/^The AI generated (\d+) of (\d+) requested sets before reaching its retry limit\. (\d+) set\(s\) were saved and your existing sets were kept\. Try again later to add the remaining sets\.$/);
    if (retryLimit) translated = `هوش مصنوعی پیش از رسیدن به سقف تلاش، ${retryLimit[1]} مجموعه از ${retryLimit[2]} مجموعهٔ درخواستی را تولید کرد. ${retryLimit[3]} مجموعه ذخیره شد و مجموعه‌های قبلی شما حفظ شدند. بعداً برای دریافت بقیه دوباره تلاش کنید.`;
    const readyCount = trimmed.match(/^(\d+) new set\(s\) ready\. Previous unfinished sets were replaced; completed sets remain in history\.$/);
    if (readyCount) translated = `${readyCount[1]} مجموعهٔ سؤال جدید آماده شد. مجموعه‌های ناتمام قبلی جایگزین شدند و مجموعه‌های تکمیل‌شده در تاریخچه باقی ماندند.`;
    const setMetaFull = trimmed.match(/^(\d+) Part 1 prompts · 1 Part 2 cue card · (\d+) Part 3 prompts$/);
    const setMetaPart1 = trimmed.match(/^(\d+) Part 1 prompts$/);
    const setMetaPart3 = trimmed.match(/^(\d+) Part 3 prompts$/);
    if (setMetaFull) translated = `${setMetaFull[1]} پرسش بخش ۱ · یک کارت موضوع بخش ۲ · ${setMetaFull[2]} پرسش بخش ۳`;
    else if (setMetaPart1) translated = `${setMetaPart1[1]} پرسش بخش ۱`;
    else if (setMetaPart3) translated = `${setMetaPart3[1]} پرسش بخش ۳`;
    const restoredSets = trimmed.match(/^Restored (\d+) previous question sets\. The set batch you replaced is now available as the previous generation\.$/);
    if (restoredSets) translated = `مجموعهٔ سؤال قبلی بازیابی شد (تعداد: ${restoredSets[1]}). مجموعهٔ جایگزین‌شده اکنون به‌عنوان نسل قبلی در دسترس است.`;
    const sentenceCount = trimmed.match(/^Sentence (\d+) of (\d+)$/);
    const questionCount = trimmed.match(/^Question (\d+) of (\d+)$/);
    if (!translated && sentenceCount) translated = `جملهٔ ${sentenceCount[1]} از ${sentenceCount[2]}`;
    else if (!translated && questionCount) translated = `سؤال ${questionCount[1]} از ${questionCount[2]}`;
    else {
      const dynamic = dynamicPrefixes.find(([prefix]) => trimmed.startsWith(prefix));
      if (dynamic) translated = dynamic[1] + trimmed.slice(dynamic[0].length);
    }
  }
  if (!translated) return;
  const start = original.indexOf(trimmed);
  const translatedValue = original.slice(0, start) + translated + original.slice(start + trimmed.length);
  originalTextNodes.set(node, { source: original, translated: translatedValue });
  if (current !== translatedValue) node.nodeValue = translatedValue;
}

function translateElement(element: Element): void {
  if (element.closest('[data-no-translate],code,pre,.setup-prompt,.setup-link,.ielts-question-text,.examiner-question,.candidate-answer,.spoken-answer,.feedback-content,.evaluation-feedback,.model-answer-content')) return;
  for (const attr of attributes) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const saved = originalAttributes.get(element) ?? new Map<string, { source: string; translated: string }>();
    const previous = saved.get(attr);
    const source = previous && value === previous.translated ? previous.source : value;
    if (fa[source]) {
      const translated = fa[source];
      element.setAttribute(attr, translated);
      saved.set(attr, { source, translated });
      originalAttributes.set(element, saved);
    }
  }
}

export function applyLanguageToDocument(language: AppLanguage): void {
  currentLanguage = language ?? 'en';
  if (typeof document === 'undefined') return;
  const isPersian = currentLanguage === 'fa';
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = isPersian ? 'rtl' : 'ltr';
  document.documentElement.dataset.appLanguage = currentLanguage;
  const root = document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  if (!isPersian) {
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const saved = originalTextNodes.get(textNode);
      if (saved && textNode.nodeValue === saved.translated) textNode.nodeValue = saved.source;
      originalTextNodes.delete(textNode);
    }
    root.querySelectorAll('*').forEach((element) => {
      const saved = originalAttributes.get(element);
      if (!saved) return;
      for (const [attr, entry] of saved) {
        if (element.getAttribute(attr) === entry.translated) element.setAttribute(attr, entry.source);
      }
      originalAttributes.delete(element);
    });
    return;
  }
  while ((node = walker.nextNode())) translateTextNode(node as Text);
  root.querySelectorAll('*').forEach(translateElement);
}

export async function initializeAppLanguage(): Promise<void> {
  const settings = await loadAppSettings();
  applyLanguageToDocument(settings.language ?? 'en');
}

export function observeAppLanguage(root: HTMLElement): void {
  if (observer) observer.disconnect();
  observer = new MutationObserver((records) => {
    if (currentLanguage !== 'fa') return;
    for (const record of records) {
      if (record.type === 'characterData' && record.target instanceof Text) {
        translateTextNode(record.target);
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
        else if (node instanceof Element) {
          translateElement(node);
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let child: Node | null;
          while ((child = walker.nextNode())) translateTextNode(child as Text);
          node.querySelectorAll('*').forEach(translateElement);
        }
      });
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  applyLanguageToDocument(currentLanguage);
}

export function getUiLanguage(): AppLanguage {
  return currentLanguage;
}
