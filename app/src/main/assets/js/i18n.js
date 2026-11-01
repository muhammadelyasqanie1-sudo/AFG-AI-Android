/* AFG AI · bilingual copy (Persian/Dari first, English second) */

import { bus, getPrefs, setPref } from "./core.js";

const fa = {
  skipToComposer: "رفتن به کادر پیام",
  brandTagline: "پلتفرم هوشمند نسل جدید",
  newChat: "گفت‌وگوی جدید",
  searchChats: "جست‌وجو در گفت‌وگوها…",
  workspaces: "فضاهای کاری",
  modeChat: "گفت‌وگو",
  modeResearch: "پژوهش زنده",
  modeCoding: "برنامه‌نویسی",
  modeStudy: "آموزش",
  modeCreative: "خلاقیت",
  recentChats: "گفت‌وگوهای اخیر",
  account: "حساب کاربری",
  settings: "تنظیمات",
  guest: "مهمان",
  statusConnecting: "در حال اتصال",
  statusOnline: "آنلاین",
  statusOffline: "آفلاین",
  statusWake: "بیدارکردن سرور",

  welcomeEyebrow: "هوش، بازطراحی‌شده",
  welcomeTitleA: "سلام.",
  welcomeTitleGrad: "امروز چه چیزی می‌سازیم؟",
  welcomeLead:
    "هر چیزی بپرس، ایده‌ای تازه خلق کن یا مسئله‌ای سخت را حل کن. AFG AI هر درخواست را به‌صورت خودکار به بهترین مدل موجود مسیر می‌دهد.",
  promptLearnTitle: "چیزی تازه یاد بگیر",
  promptLearnText: "در چند دقیقه برنامهٔ مطالعه بساز",
  promptBuildTitle: "ایده را به برنامه تبدیل کن",
  promptBuildText: "از تصور تا گام‌های عملی",
  promptCodeTitle: "کد را بهتر و امن‌تر کن",
  promptCodeText: "توضیح، بازبینی و اصلاح",
  promptCreateTitle: "چیزی بدیع خلق کن",
  promptCreateText: "نوشتن، تصویر و ایده‌های تازه",

  modeCaptionChat: "پرسش‌های عمومی، نوشتن و مشاوره.",
  modeCaptionResearch: "جست‌وجوی زنده در وب همراه با پیوند منابع.",
  modeCaptionCoding: "کدنویسی، اشکال‌زدایی، توضیح و بازبینی امنیتی.",
  modeCaptionStudy: "آموزش گام‌به‌گام با مثال و تمرین.",
  modeCaptionCreative: "ایده‌پردازی، داستان، متن تبلیغاتی و طرح‌های تازه.",

  autoRouteTitle: "خودکار · مسیریابی هوشمند",
  autoRouteDetail: "برای هر درخواست بهترین مدل انتخاب می‌شود.",
  autoRoutePinned: "مدل انتخاب‌شده",
  autoRoutePinnedDetail: "برای پیام بعدی از همین مدل استفاده می‌شود.",
  routeRecommended: "پیشنهاد برای این حالت: {model}",
  modelLabel: "مدل هوش مصنوعی",
  loadingModels: "در حال دریافت مدل‌ها…",
  modelAuto: "خودکار · انتخاب هوشمند",
  modelNone: "مدلی در دسترس نیست",
  modelLoadError: "فهرست مدل‌ها دریافت نشد",
  modelsAvailable: "{count} مدل در دسترس",
  refreshModels: "تازه‌سازی فهرست مدل‌ها",
  modelTierUltra: "استدلال فوق‌پیشرفته",
  modelTierPro: "حرفه‌ای",
  modelTierFast: "سریع",
  modelTierStandard: "استاندارد",
  modelVision: "بینایی",
  modelCoding: "کدنویسی",
  modelReasoning: "استدلال",

  attachPhoto: "انتخاب عکس",
  attachCamera: "بازکردن دوربین",
  attachFile: "انتخاب فایل متنی",
  messageLabel: "پیام",
  messagePlaceholder: "پیامت را برای AFG AI بنویس…",
  createImage: "ساخت تصویر",
  send: "ارسال",
  stop: "توقف",
  disclaimer: "هوش مصنوعی ممکن است اشتباه کند. اطلاعات مهم را بررسی کن و هرگز رازها را به اشتراک نگذار.",
  member: "عضو",
  planFree: "رایگان",

  authTitle: "حساب AFG AI تو",
  authLead: "گفت‌وگوها را میان دستگاه‌ها همگام کن و تاریخچه‌ات را خصوصی نگه دار.",
  signInTab: "ورود",
  createTab: "ساخت حساب",
  nameLabel: "نام",
  namePlaceholder: "نام تو",
  emailLabel: "ایمیل",
  passwordLabel: "رمز عبور",
  passwordHint: "دست‌کم ۸ نویسه. روی سرور با scrypt و نمک ذخیره می‌شود.",
  authSubmitSignIn: "ورود امن",
  authSubmitCreate: "ساخت حساب امن",
  orContinue: "یا",
  continueGuest: "ادامه به‌عنوان مهمان",
  guestNote: "در حالت مهمان گفت‌وگوها روی همین دستگاه می‌مانند. هر زمان می‌توانی حساب بسازی.",

  settingsTitle: "تنظیمات",
  settingsIntro: "AFG AI را مطابق روش کار خودت شکل بده.",
  settingsHeroTitle: "هوش، به قواعد تو",
  settingsHeroText: "حساب، زبان، ظاهر، مدل‌ها و داده‌ها — همه در یک جا.",
  accountTitle: "حساب",
  accountText: "همگام‌سازی خصوصی برای کاربران واردشده.",
  languageTitle: "زبان و پاسخ‌ها",
  languageText: "زبان رابط و زبان پاسخ‌ها.",
  uiLanguageLabel: "زبان رابط",
  responseLanguageLabel: "زبان پاسخ",
  autoDetect: "خودکار",
  langFa: "دری",
  langEn: "English",
  appearanceTitle: "ظاهر",
  appearanceText: "تم، رنگ تأکید و راحتی خواندن.",
  themeLabel: "تم",
  themeMidnight: "شبانهٔ شیشه‌ای",
  themeOled: "مشکی خالص OLED",
  themeAurora: "شفق بنفش",
  accentLabel: "رنگ تأکید",
  fontSizeLabel: "اندازهٔ متن",
  sizeSm: "فشرده",
  sizeMd: "متعادل",
  sizeLg: "بزرگ",
  reduceMotion: "کاهش حرکت",
  reduceMotionText: "انیمیشن‌های پس‌زمینه و گذار را غیرفعال کن.",
  sendOnEnter: "ارسال با Enter",
  sendOnEnterText: "برای خط جدید از Shift + Enter استفاده کن.",
  streaming: "پاسخ زنده",
  streamingText: "متن را همان‌طور که ساخته می‌شود نشان بده.",
  serviceTitle: "وضعیت سرویس",
  serviceText: "آمادگی زندهٔ قابلیت‌های متصل.",
  healthServer: "سرور",
  healthAI: "سرویس‌های هوش مصنوعی",
  healthSearch: "جست‌وجوی زنده",
  healthImage: "تولید تصویر",
  healthModels: "مدل‌های موجود",
  checkConnection: "بررسی اتصال",
  dataTitle: "داده‌های تو",
  dataText: "داده‌های این دستگاه را بیرون ببر یا پاک کن.",
  exportData: "دریافت نسخهٔ پشتیبان",
  clearHistory: "پاک‌کردن تاریخچهٔ محلی",
  advancedTitle: "پیشرفته",
  advancedText: "استفاده از سرور شخصی یا جایگزین AFG AI.",
  serverUrlLabel: "نشانی سرور API",
  serverUrlHint: "فقط HTTPS. مگر اینکه سرور خودت را داری، مقدار پیش‌فرض را نگه دار.",
  testConnection: "آزمایش اتصال",
  aboutTitle: "دربارهٔ AFG AI",
  aboutText: "پلتفرم هوشمند نسل جدید برای افغانستان و فراتر از آن.",
  versionLabel: "نسخه",
  privacyLabel: "حریم خصوصی",
  privacyValue: "کلیدها روی سرور می‌مانند",
  privacyText: "AFG AI هرگز کلید API سرویس‌ها را روی دستگاه تو ذخیره نمی‌کند. پاسخ‌های مهم را همیشه بررسی کن.",
  save: "ذخیرهٔ تنظیمات",
  saved: "ذخیره شد",

  imageTitle: "ساخت تصویر",
  imageLead: "صحنه، سبک، نور و حس تصویر را توصیف کن.",
  imagePromptLabel: "توصیف تصویر",
  imagePlaceholder: "مثلاً: طلوع سینمایی بر فراز کوه‌های افغانستان، نور حجمی، جزئیات بالا…",
  imageSizeLabel: "اندازه",
  imageNote: "تولید تصویر به IMAGE_API_KEY روی سرور نیاز دارد.",
  cancel: "انصراف",
  generate: "ساخت تصویر",
  imageGenerating: "در حال ساخت تصویر…",
  imageFailed: "ساخت تصویر ناموفق بود.",
  imageCreated: "تصویر ساخته شد.",

  palettePlaceholder: "یک فرمان را بنویس…",
  paletteHint: "↑ ↓ برای حرکت · Enter برای اجرا · Esc برای بستن",
  paletteEmpty: "فرمانی پیدا نشد",

  onboardingTitle: "هوشی که برای تو کار می‌کند.",
  onboardingLead: "یک فضای کاری سریع و چندزبانه با مسیریابی هوشمند مدل، پژوهش زنده، ابزار برنامه‌نویسی و ظاهری زیبا.",
  onboardingF1: "هر درخواست را خودکار به قوی‌ترین مدل موجود می‌فرستد.",
  onboardingF2: "حساب امن یا حالت مهمان خصوصی — انتخاب با توست.",
  onboardingF3: "پژوهش زنده با منابع و درک تصویر.",
  onboardingF4: "سه تم، چهار رنگ تأکید، فارسی‌محور و کاملاً دوزبانه.",
  onboardingSignIn: "ورود یا ساخت حساب",
  onboardingGuest: "ادامه به‌عنوان مهمان",

  copy: "کپی",
  copied: "کپی شد",
  copyFailed: "کپی انجام نشد.",
  confirmTitle: "تأیید",
  regenerate: "تولید دوباره",
  you: "تو",
  afgAI: "AFG AI",
  thinking: "AFG AI در حال فکر کردن است…",
  sources: "منابع",
  errorGeneric: "مشکلی پیش آمد. دوباره تلاش کن.",
  errorNetwork: "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کن.",
  errorTimeout: "درخواست زمان‌بر شد. دوباره تلاش کن.",
  errorRateLimit: "درخواست‌ها زیاد شد. کمی بعد دوباره تلاش کن.",
  errorNoModels: "هیچ مدلی روی سرور تنظیم نشده است. با مدیر سرویس تماس بگیر.",
  errorNoEligible: "مدل مناسبی برای این درخواست پیدا نشد. حالت یا پیوست را تغییر بده.",
  errorVision: "مدل انتخاب‌شده تصویر را نمی‌خواند. حالت خودکار را انتخاب کن.",
  errorSearch: "جست‌وجوی زنده نتیجه‌ای نداد. پرسش را دقیق‌تر بنویس.",
  errorImageConfig: "تولید تصویر روی سرور تنظیم نشده است.",
  errorModelGone: "این مدل دیگر در دسترس نیست. مدل دیگری یا حالت خودکار را انتخاب کن.",
  stopped: "تولید پاسخ متوقف شد.",
  connectionRestored: "اتصال برقرار شد.",
  connectionLost: "اتصال به سرور قطع شد. تلاش برای اتصال دوباره…",
  retry: "تلاش دوباره",

  newConversationTitle: "گفت‌وگوی جدید",
  conversationUntitled: "گفت‌وگو",
  deleteChat: "حذف گفت‌وگو",
  deleteConfirm: "این گفت‌وگو حذف شود؟ این کار برگشت‌پذیر نیست.",
  conversationDeleted: "گفت‌وگو حذف شد.",
  noChats: "هنوز گفت‌وگویی نداری. اولین پیامت را بفرست.",
  noSearchResults: "گفت‌وگویی با این نام پیدا نشد.",
  conversationsCount: "{count} گفت‌وگو",

  signedIn: "وارد شدی",
  signedOut: "خارج شدی",
  accountCreated: "حساب ساخته شد. خوش آمدی!",
  signInSuccess: "خوش برگشتی!",
  authRequired: "برای این کار باید وارد شوی.",
  authInvalid: "ایمیل یا رمز عبور درست نیست.",
  emailTaken: "با این ایمیل قبلاً حساب ساخته شده است.",
  passwordTooShort: "رمز عبور باید دست‌کم ۸ نویسه باشد.",
  emailInvalid: "یک ایمیل معتبر وارد کن.",
  continueAsGuest: "ادامه به‌عنوان مهمان",
  guestModeOn: "حالت مهمان فعال است. گفت‌وگوها فقط روی این دستگاه ذخیره می‌شوند.",
  signOut: "خروج از حساب",
  signIn: "ورود",
  createAccount: "ساخت حساب",
  guestAccountHint: "مهمان · تاریخچه روی این دستگاه",

  settingsSaved: "تنظیمات ذخیره شد.",
  healthChecking: "در حال بررسی…",
  healthOnline: "فعال",
  healthOffline: "آفلاین",
  healthConfigured: "تنظیم‌شده",
  healthNotConfigured: "تنظیم‌نشده",
  healthModelsValue: "{count} مدل",
  healthOK: "سرویس سالم است.",
  healthFail: "به سرور وصل نشدیم.",

  dataSummary: "{conversations} گفت‌وگو و {messages} پیام روی این دستگاه ذخیره شده است.",
  clearConfirm: "تمام گفت‌وگوهای این دستگاه پاک شود؟ این کار برگشت‌پذیر نیست.",
  cleared: "تاریخچهٔ محلی پاک شد.",
  exportDone: "نسخهٔ پشتیبان آماده شد.",
  exportEmpty: "هنوز داده‌ای برای بیرون‌بردن وجود ندارد.",

  serverSaved: "نشانی سرور ذخیره شد.",
  serverInvalid: "یک نشانی HTTPS معتبر وارد کن.",
  serverTestOk: "اتصال به سرور برقرار است.",
  serverTestFail: "اتصال به این سرور ممکن نشد.",

  attachImageLimit: "حداکثر اندازهٔ عکس ۵ مگابایت است.",
  attachImageType: "فقط PNG، JPEG یا WebP انتخاب کن.",
  attachFileType: "این نوع فایل پشتیبانی نمی‌شود.",
  attachFileLimit: "حداکثر اندازهٔ فایل متنی ۱٫۵ مگابایت است.",
  attachLoaded: "فایل آماده شد؛ ارسال را بزن.",
  attachImageLoaded: "عکس پیوست شد.",
  attachmentImage: "تصویر پیوست",
  attachmentTextFile: "فایل متنی",
  cameraUnavailable: "دوربین در این دستگاه در دسترس نیست.",
  imageOnlyPrompt: "این تصویر را با جزئیات بررسی و توصیف کن.",

  replyCopied: "پاسخ کپی شد.",
  imageReady: "تصویر آماده شد.",
  promptRequired: "اول تصویر را توصیف کن.",
  regenerateFailed: "پاسخ قبلی برای تولید دوباره پیدا نشد.",

  cmdNewChat: "گفت‌وگوی جدید",
  cmdSettings: "بازکردن تنظیمات",
  cmdImage: "ساخت تصویر",
  cmdTheme: "تغییر تم",
  cmdExport: "دریافت نسخهٔ پشتیبان",
  cmdClear: "پاک‌کردن تاریخچه",
  cmdAccount: "حساب کاربری",
  cmdSignOut: "خروج از حساب",
  cmdChat: "حالت گفت‌وگو",
  cmdResearch: "حالت پژوهش زنده",
  cmdCoding: "حالت برنامه‌نویسی",
  cmdStudy: "حالت آموزش",
  cmdCreative: "حالت خلاقیت",
  cmdCheckHealth: "بررسی اتصال سرویس",
  cmdRefreshModels: "تازه‌سازی مدل‌ها",
  cmdLanguage: "تغییر زبان رابط",

  promptLearn: "یک برنامهٔ یادگیری ۳۰ روزه برای یادگیری زبان انگلیسی برایم بساز؛ روزی ۳۰ دقیقه وقت دارم.",
  promptBuild: "این ایده را به یک برنامهٔ عملی با گام‌های روشن، زمان‌بندی و ریسک‌ها تبدیل کن: یک فروشگاه کوچک آنلاین برای صنایع دستی افغانستان.",
  promptCode: "این کد را بازبینی کن، باگ‌های احتمالی و مشکلات امنیتی را پیدا کن و نسخهٔ بهترش را توضیح بده.",
  promptCreate: "یک متن معرفی کوتاه و حرفه‌ای برای یک برند فناوری افغان بنویس؛ لحن آینده‌نگر و انسانی باشد.",
  promptResearch: "آخرین تحولات مهم در حوزهٔ هوش مصنوعی را با منابع معتبر بررسی کن.",
  promptStudy: "مفهوم شبکه‌های عصبی را ساده و گام‌به‌گام برای یک مبتدی توضیح بده.",
  promptCreative: "سه ایدهٔ تازه برای یک کمپین تبلیغاتی دربارهٔ آموزش دختران پیشنهاد بده.",

  modelGroupClaude: "Claude",
  modelGroupCodex: "GPT / Codex",
  modelGroupUncensored: "GLM / DeepSeek",
  modelGroupMulti: "چندمدلی",
  modelGroupLocal: "محلی",
  poweredBy: "قدرت‌گرفته از موتور AFG AI",
  sendHint: "Enter برای ارسال · Shift + Enter برای خط جدید",
  offlineHint: "حالت آفلاین",
  languageChanged: "زبان تغییر کرد.",
  themeChanged: "تم تغییر کرد.",
  updating: "در حال به‌روزرسانی…",
  close: "بستن",
  remove: "حذف",
  open: "بازکردن",
  download: "دانلود"
};

const en = {
  skipToComposer: "Skip to message composer",
  brandTagline: "Advanced intelligence platform",
  newChat: "New conversation",
  searchChats: "Search conversations…",
  workspaces: "Workspaces",
  modeChat: "Chat",
  modeResearch: "Live research",
  modeCoding: "Coding",
  modeStudy: "Study",
  modeCreative: "Create",
  recentChats: "Recent chats",
  account: "Account",
  settings: "Settings",
  guest: "Guest",
  statusConnecting: "Connecting",
  statusOnline: "Online",
  statusOffline: "Offline",
  statusWake: "Waking server",

  welcomeEyebrow: "Intelligence, reimagined",
  welcomeTitleA: "Hello.",
  welcomeTitleGrad: "What will we build today?",
  welcomeLead:
    "Ask anything, create something original, or solve a hard problem. AFG AI routes every request to the best available model automatically.",
  promptLearnTitle: "Learn something new",
  promptLearnText: "Build a study plan in minutes",
  promptBuildTitle: "Turn an idea into a plan",
  promptBuildText: "From concept to concrete steps",
  promptCodeTitle: "Debug and improve code",
  promptCodeText: "Explain, review, and ship safely",
  promptCreateTitle: "Create something original",
  promptCreateText: "Writing, visuals, and fresh ideas",

  modeCaptionChat: "General questions, writing, and advice.",
  modeCaptionResearch: "Live web research with cited sources.",
  modeCaptionCoding: "Coding, debugging, explanations, and security-minded reviews.",
  modeCaptionStudy: "Step-by-step teaching with examples and practice.",
  modeCaptionCreative: "Brainstorming, stories, copywriting, and original concepts.",

  autoRouteTitle: "Auto · Intelligent routing",
  autoRouteDetail: "The best model is chosen for every request.",
  autoRoutePinned: "Pinned model",
  autoRoutePinnedDetail: "The next message will use this model.",
  routeRecommended: "Recommended for this mode: {model}",
  modelLabel: "AI model",
  loadingModels: "Loading models…",
  modelAuto: "Auto · Smart routing",
  modelNone: "No models available",
  modelLoadError: "Could not load models",
  modelsAvailable: "{count} models available",
  refreshModels: "Refresh model list",
  modelTierUltra: "Deep reasoning",
  modelTierPro: "Professional",
  modelTierFast: "Fast",
  modelTierStandard: "Standard",
  modelVision: "Vision",
  modelCoding: "Coding",
  modelReasoning: "Reasoning",

  attachPhoto: "Choose photo",
  attachCamera: "Open camera",
  attachFile: "Choose text file",
  messageLabel: "Message",
  messagePlaceholder: "Message AFG AI…",
  createImage: "Create image",
  send: "Send",
  stop: "Stop",
  disclaimer: "AI can make mistakes. Verify important information and never share secrets.",
  member: "Member",
  planFree: "Free",

  authTitle: "Your AFG AI account",
  authLead: "Sync conversations across devices and keep your history private to you.",
  signInTab: "Sign in",
  createTab: "Create account",
  nameLabel: "Name",
  namePlaceholder: "Your name",
  emailLabel: "Email",
  passwordLabel: "Password",
  passwordHint: "At least 8 characters. Stored as a salted scrypt hash on the server.",
  authSubmitSignIn: "Sign in securely",
  authSubmitCreate: "Create secure account",
  orContinue: "or",
  continueGuest: "Continue as guest",
  guestNote: "Guest mode keeps conversations on this device. You can create an account at any time.",

  settingsTitle: "Settings",
  settingsIntro: "Shape AFG AI around the way you work.",
  settingsHeroTitle: "Your intelligence, your rules",
  settingsHeroText: "Account, language, appearance, models, and data — all in one place.",
  accountTitle: "Account",
  accountText: "Private sync for signed-in users.",
  languageTitle: "Language & responses",
  languageText: "Interface and answer language.",
  uiLanguageLabel: "Interface language",
  responseLanguageLabel: "Answer language",
  autoDetect: "Automatic",
  langFa: "فارسی / دری",
  langEn: "English",
  appearanceTitle: "Appearance",
  appearanceText: "Theme, accent, and reading comfort.",
  themeLabel: "Theme",
  themeMidnight: "Midnight glass",
  themeOled: "OLED black",
  themeAurora: "Aurora violet",
  accentLabel: "Accent",
  fontSizeLabel: "Text size",
  sizeSm: "Compact",
  sizeMd: "Balanced",
  sizeLg: "Large",
  reduceMotion: "Reduce motion",
  reduceMotionText: "Disable ambient and transition animations.",
  sendOnEnter: "Enter to send",
  sendOnEnterText: "Use Shift + Enter for a new line.",
  streaming: "Stream responses",
  streamingText: "Show text as it is generated.",
  serviceTitle: "Service status",
  serviceText: "Live readiness of connected capabilities.",
  healthServer: "Server",
  healthAI: "AI providers",
  healthSearch: "Live search",
  healthImage: "Image generation",
  healthModels: "Models available",
  checkConnection: "Check connection",
  dataTitle: "Your data",
  dataText: "Export or delete what is stored on this device.",
  exportData: "Export backup",
  clearHistory: "Clear local history",
  advancedTitle: "Advanced",
  advancedText: "Use a self-hosted or alternate AFG AI server.",
  serverUrlLabel: "API server URL",
  serverUrlHint: "HTTPS only. Leave the default unless you run your own server.",
  testConnection: "Test connection",
  aboutTitle: "About AFG AI",
  aboutText: "A premium AI platform built for Afghanistan and beyond.",
  versionLabel: "Version",
  privacyLabel: "Privacy",
  privacyValue: "Keys stay on the server",
  privacyText: "AFG AI never stores provider API keys on your device. Important answers should always be verified.",
  save: "Save preferences",
  saved: "Saved",

  imageTitle: "Create an image",
  imageLead: "Describe the scene, style, lighting, and mood.",
  imagePromptLabel: "Prompt",
  imagePlaceholder: "A cinematic sunrise over the mountains of Afghanistan, volumetric light, ultra detailed…",
  imageSizeLabel: "Size",
  imageNote: "Image generation requires IMAGE_API_KEY on the server.",
  cancel: "Cancel",
  generate: "Generate",
  imageGenerating: "Generating image…",
  imageFailed: "Image generation failed.",
  imageCreated: "Image created.",

  palettePlaceholder: "Type a command…",
  paletteHint: "↑ ↓ to navigate · Enter to run · Esc to close",
  paletteEmpty: "No commands found",

  onboardingTitle: "Intelligence that works for you.",
  onboardingLead: "A fast, multilingual AI workspace with intelligent model routing, live research, coding tools, and a beautiful dark interface.",
  onboardingF1: "Auto-routes each request to the strongest available model.",
  onboardingF2: "Secure accounts or private guest mode — your choice.",
  onboardingF3: "Live research with sources and multimodal image understanding.",
  onboardingF4: "Three themes, four accents, Dari-first, with a separate English interface.",
  onboardingSignIn: "Sign in or create account",
  onboardingGuest: "Continue as guest",

  copy: "Copy",
  copied: "Copied",
  copyFailed: "Could not copy that.",
  confirmTitle: "Confirm",
  regenerate: "Regenerate",
  you: "You",
  afgAI: "AFG AI",
  thinking: "AFG AI is thinking…",
  sources: "Sources",
  errorGeneric: "Something went wrong. Please try again.",
  errorNetwork: "Could not reach the server. Check your connection.",
  errorTimeout: "The request took too long. Please try again.",
  errorRateLimit: "Too many requests. Please wait a moment.",
  errorNoModels: "No AI models are configured on the server yet.",
  errorNoEligible: "No model fits this request. Try another mode or attachment.",
  errorVision: "The selected model cannot read images. Use Auto mode.",
  errorSearch: "Live research returned no results. Try a more specific question.",
  errorImageConfig: "Image generation is not configured on the server.",
  errorModelGone: "That model is no longer available. Choose another or use Auto.",
  stopped: "Response stopped.",
  connectionRestored: "Connection restored.",
  connectionLost: "Server connection lost. Reconnecting…",
  retry: "Try again",

  newConversationTitle: "New conversation",
  conversationUntitled: "Conversation",
  deleteChat: "Delete conversation",
  deleteConfirm: "Delete this conversation? This cannot be undone.",
  conversationDeleted: "Conversation deleted.",
  noChats: "No conversations yet. Send your first message.",
  noSearchResults: "No conversation matches that search.",
  conversationsCount: "{count} conversations",

  signedIn: "Signed in",
  signedOut: "Signed out",
  accountCreated: "Account created. Welcome!",
  signInSuccess: "Welcome back!",
  authRequired: "Sign in to do that.",
  authInvalid: "Email or password is incorrect.",
  emailTaken: "An account with this email already exists.",
  passwordTooShort: "Password must be at least 8 characters.",
  emailInvalid: "Enter a valid email address.",
  continueAsGuest: "Continue as guest",
  guestModeOn: "Guest mode is on. Conversations stay on this device.",
  signOut: "Sign out",
  signIn: "Sign in",
  createAccount: "Create account",
  guestAccountHint: "Guest · history on this device",

  settingsSaved: "Preferences saved.",
  healthChecking: "Checking…",
  healthOnline: "Online",
  healthOffline: "Offline",
  healthConfigured: "Configured",
  healthNotConfigured: "Not configured",
  healthModelsValue: "{count} models",
  healthOK: "Service is healthy.",
  healthFail: "Could not reach the server.",

  dataSummary: "{conversations} conversations and {messages} messages stored on this device.",
  clearConfirm: "Clear all conversations on this device? This cannot be undone.",
  cleared: "Local history cleared.",
  exportDone: "Backup ready.",
  exportEmpty: "There is no data to export yet.",

  serverSaved: "Server URL saved.",
  serverInvalid: "Enter a valid HTTPS URL.",
  serverTestOk: "Connected to the server.",
  serverTestFail: "Could not reach that server.",

  attachImageLimit: "Images must be 5 MB or smaller.",
  attachImageType: "Choose a PNG, JPEG, or WebP image.",
  attachFileType: "That file type is not supported.",
  attachFileLimit: "Text files must be 1.5 MB or smaller.",
  attachLoaded: "File ready. Press Send to analyze it.",
  attachImageLoaded: "Image attached.",
  attachmentImage: "Attached image",
  attachmentTextFile: "Text file",
  cameraUnavailable: "The camera is not available on this device.",
  imageOnlyPrompt: "Describe and analyze this image in detail.",

  replyCopied: "Reply copied.",
  imageReady: "Image ready.",
  promptRequired: "Describe the image first.",
  regenerateFailed: "Could not find the previous reply to regenerate.",

  cmdNewChat: "New conversation",
  cmdSettings: "Open settings",
  cmdImage: "Create an image",
  cmdTheme: "Cycle theme",
  cmdExport: "Export backup",
  cmdClear: "Clear local history",
  cmdAccount: "Account",
  cmdSignOut: "Sign out",
  cmdChat: "Chat mode",
  cmdResearch: "Live research mode",
  cmdCoding: "Coding mode",
  cmdStudy: "Study mode",
  cmdCreative: "Creative mode",
  cmdCheckHealth: "Check service health",
  cmdRefreshModels: "Refresh models",
  cmdLanguage: "Switch interface language",

  promptLearn: "Build me a 30-day English learning plan. I can study 30 minutes per day.",
  promptBuild: "Turn this idea into an actionable plan with clear steps, a timeline, and risks: a small online store for Afghan handmade crafts.",
  promptCode: "Review this code, find likely bugs and security issues, and explain a better version.",
  promptCreate: "Write a short, premium brand introduction for an Afghan technology company. Futuristic but human.",
  promptResearch: "Research the most important recent developments in artificial intelligence using credible sources.",
  promptStudy: "Explain neural networks simply and step by step for a complete beginner.",
  promptCreative: "Give me three fresh ideas for a campaign about girls' education.",

  modelGroupClaude: "Claude",
  modelGroupCodex: "GPT / Codex",
  modelGroupUncensored: "GLM / DeepSeek",
  modelGroupMulti: "Multi-model",
  modelGroupLocal: "Local",
  poweredBy: "Powered by the AFG AI engine",
  sendHint: "Enter to send · Shift + Enter for a new line",
  offlineHint: "Offline mode",
  languageChanged: "Language changed.",
  themeChanged: "Theme changed.",
  updating: "Updating…",
  close: "Close",
  remove: "Remove",
  open: "Open",
  download: "Download"
};

export const dictionaries = { fa, en };

let currentLanguage = "fa";

export function resolveLanguage(pref = getPrefs().uiLanguage) {
  if (pref === "fa" || pref === "en") return pref;
  const browser = String(navigator.language || "fa").toLowerCase();
  return browser.startsWith("en") ? "en" : "fa";
}

export function getLanguage() {
  return currentLanguage;
}

export function isEnglish() {
  return currentLanguage === "en";
}

export function t(key, vars = {}) {
  const table = dictionaries[currentLanguage] || fa;
  let value = table[key] ?? fa[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export function applyStaticTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (key) node.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", t(node.getAttribute("data-i18n-title")));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria")));
  });
}

export function applyLanguage(pref = getPrefs().uiLanguage) {
  currentLanguage = resolveLanguage(pref);
  document.documentElement.lang = currentLanguage === "fa" ? "fa-AF" : "en";
  document.documentElement.dir = currentLanguage === "fa" ? "rtl" : "ltr";
  applyStaticTranslations(document);
  const langButton = document.getElementById("langBtn");
  if (langButton) langButton.textContent = isEnglish() ? "دری / فارسی" : "English";
  bus.emit("language", currentLanguage);
  return currentLanguage;
}

export function setUiLanguage(value) {
  setPref("uiLanguage", value);
  applyLanguage(value);
  bus.emit("language:changed", currentLanguage);
}

export function modeCaption(mode) {
  return t(
    {
      chat: "modeCaptionChat",
      research: "modeCaptionResearch",
      coding: "modeCaptionCoding",
      study: "modeCaptionStudy",
      creative: "modeCaptionCreative"
    }[mode] || "modeCaptionChat"
  );
}

export function suggestionPrompt(key) {
  return t(
    {
      learn: "promptLearn",
      build: "promptBuild",
      code: "promptCode",
      create: "promptCreate",
      research: "promptResearch",
      study: "promptStudy",
      creative: "promptCreative"
    }[key] || "promptLearn"
  );
}

export function modelTierLabel(tier) {
  return t(
    {
      ultra: "modelTierUltra",
      pro: "modelTierPro",
      fast: "modelTierFast",
      standard: "modelTierStandard"
    }[tier] || "modelTierStandard"
  );
}

export function modeLabel(mode) {
  return t(
    {
      chat: "modeChat",
      research: "modeResearch",
      coding: "modeCoding",
      study: "modeStudy",
      creative: "modeCreative"
    }[mode] || "modeChat"
  );
}

export function groupLabel(group) {
  return t(
    {
      claude: "modelGroupClaude",
      codex: "modelGroupCodex",
      uncensored: "modelGroupUncensored",
      multi: "modelGroupMulti",
      local: "modelGroupLocal"
    }[group] || "modelGroupMulti"
  );
}

export function initI18n() {
  applyLanguage();
  bus.on("prefs", (prefs) => {
    if (resolveLanguage(prefs.uiLanguage) !== currentLanguage) applyLanguage(prefs.uiLanguage);
  });
}
