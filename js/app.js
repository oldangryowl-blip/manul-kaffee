/* ===== Манул сказав: Kaffee — Main App ===== */

const App = {
  profile: null,
  allWords: [],
  themes: [],
  currentScreen: 'splash',
  isDemo: false,
  wordCount: 3,
  lessonNumber: 0,
  dialogTurns: [],
  dialogCurrentTurn: 0,
  talkMessages: [],

  async init() {
    try {
      await ManulDB.open();
      await this.loadBaseData();
      this.profile = await ManulDB.getProfile();

      // Wait for voices to load
      if ('speechSynthesis' in window) {
        speechSynthesis.getVoices();
      }

      setTimeout(() => {
        if (this.profile?.name) {
          this.isDemo = !this.profile.apiKey;
          if (this.profile.apiKey) {
            GeminiAPI.setApiKey(this.profile.apiKey);
          }
          this.showScreen('home');
        } else {
          this.showScreen('welcome');
        }
      }, 1500);

      this.bindEvents();
    } catch (err) {
      console.error('Init error:', err);
      this.showScreen('welcome');
    }
  },

  async loadBaseData() {
    // Load words
    try {
      const wordsResp = await fetch('data/words.json');
      this.allWords = await wordsResp.json();
      await ManulDB.loadBaseWords(this.allWords);
    } catch { /* use cached */ }

    // Load themes
    try {
      const themesResp = await fetch('data/themes.json');
      this.themes = await themesResp.json();
      await ManulDB.loadThemes(this.themes);
    } catch { /* use cached */ }

    // Load achievements
    for (const theme of this.themes) {
      if (theme.achievements) {
        await ManulDB.loadAchievements(theme.achievements);
      }
    }
  },

  // ===== Navigation =====
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${screenId}`);
    if (screen) {
      screen.classList.add('active');
      this.currentScreen = screenId;
    }

    if (screenId === 'home') this.updateHome();
    if (screenId === 'settings') this.updateSettings();
  },

  // ===== Event Binding =====
  bindEvents() {
    // Profile form
    document.getElementById('form-profile')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveProfile();
    });

    // API key
    document.getElementById('btn-save-key')?.addEventListener('click', () => this.saveApiKey());
    document.getElementById('btn-skip-key')?.addEventListener('click', () => this.skipApiKey());
    document.getElementById('input-apikey')?.addEventListener('input', (e) => {
      document.getElementById('btn-save-key').disabled = !e.target.value.trim();
    });
    document.getElementById('btn-toggle-key')?.addEventListener('click', () => {
      const input = document.getElementById('input-apikey');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Home
    document.getElementById('btn-start-lesson')?.addEventListener('click', () => this.startLessonFlow());
    document.getElementById('btn-talk-mode')?.addEventListener('click', () => this.startTalkMode());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.showScreen('settings'));
    document.getElementById('btn-start-review')?.addEventListener('click', () => this.startReview());

    // Word count
    document.getElementById('btn-wc-minus')?.addEventListener('click', () => this.adjustWordCount(-1));
    document.getElementById('btn-wc-plus')?.addEventListener('click', () => this.adjustWordCount(1));
    document.getElementById('btn-start-with-count')?.addEventListener('click', () => this.startLesson());

    // Lesson
    document.getElementById('btn-lesson-next')?.addEventListener('click', () => this.lessonNext());

    // Dialog
    document.getElementById('btn-dialog-send')?.addEventListener('click', () => this.dialogSend());
    document.getElementById('dialog-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.dialogSend();
    });
    document.getElementById('btn-dialog-hint')?.addEventListener('click', () => this.dialogHint());

    // Story
    document.getElementById('btn-story-done')?.addEventListener('click', () => this.storyDone());

    // Summary
    document.getElementById('btn-summary-home')?.addEventListener('click', () => this.showScreen('home'));

    // Review
    document.getElementById('btn-review-send')?.addEventListener('click', () => this.reviewSend());
    document.getElementById('review-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.reviewSend();
    });

    // Talk
    document.getElementById('btn-talk-send')?.addEventListener('click', () => this.talkSend());
    document.getElementById('talk-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.talkSend();
    });
    document.getElementById('btn-talk-close')?.addEventListener('click', () => this.showScreen('home'));

    // Settings
    document.getElementById('btn-settings-back')?.addEventListener('click', () => this.showScreen('home'));
    document.getElementById('btn-save-profile')?.addEventListener('click', () => this.updateProfile());
    document.getElementById('btn-change-key')?.addEventListener('click', () => this.showScreen('apikey'));
    document.getElementById('btn-delete-key')?.addEventListener('click', () => this.deleteApiKey());
    document.getElementById('btn-export')?.addEventListener('click', () => this.exportProgress());
    document.getElementById('btn-import')?.addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file')?.addEventListener('change', (e) => this.importProgress(e));
    document.getElementById('settings-hint-level')?.addEventListener('change', (e) => {
      this.profile.hintLevel = parseInt(e.target.value);
      ManulDB.saveProfile(this.profile);
    });

    // Writing input handlers (delegated)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('writing-input')) {
        this.handleWritingInput(e.target);
      }
    });
  },

  // ===== Profile =====
  async saveProfile() {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return;

    const gender = document.querySelector('input[name="gender"]:checked')?.value || 'none';
    const ageGroup = document.getElementById('select-age').value;

    this.profile = {
      id: 'user',
      name,
      gender,
      ageGroup,
      langExplain: 'uk',
      hintLevel: 2,
      createdAt: new Date().toISOString()
    };

    await ManulDB.saveProfile(this.profile);
    this.showScreen('apikey');
  },

  // ===== API Key =====
  async saveApiKey() {
    const key = document.getElementById('input-apikey').value.trim();
    if (!key) return;

    const status = document.getElementById('apikey-status');
    const btn = document.getElementById('btn-save-key');

    status.textContent = 'Перевіряю ключ...';
    status.className = 'status-msg';
    btn.disabled = true;

    const valid = await GeminiAPI.validateKey(key);

    if (valid) {
      status.textContent = 'Ключ працює!';
      status.className = 'status-msg success';
      GeminiAPI.setApiKey(key);
      this.profile.apiKey = key;
      await ManulDB.saveProfile(this.profile);
      this.isDemo = false;

      setTimeout(() => this.showScreen('home'), 800);
    } else {
      status.textContent = 'Ключ не працює. Перевір і спробуй ще раз.';
      status.className = 'status-msg error';
      btn.disabled = false;
    }
  },

  skipApiKey() {
    this.isDemo = true;
    this.showScreen('home');
  },

  async deleteApiKey() {
    await ManulDB.deleteApiKey();
    delete this.profile.apiKey;
    GeminiAPI.setApiKey(null);
    this.isDemo = true;
    this.showToast('Ключ видалено');
    this.updateSettings();
  },

  // ===== Home =====
  async updateHome() {
    const greeting = document.getElementById('home-greeting');
    const hour = new Date().getHours();
    let greetText = 'Привіт';
    if (hour < 12) greetText = 'Доброго ранку';
    else if (hour < 18) greetText = 'Добрий день';
    else greetText = 'Добрий вечір';

    greeting.textContent = `${greetText}, ${this.profile?.name || ''}!`;

    // Stats
    const learnedCount = await SRS.getLearnedCount();
    const sessionCount = await ManulDB.getSessionCount();
    document.getElementById('stat-words-learned').textContent = learnedCount;
    document.getElementById('stat-lessons-done').textContent = sessionCount;

    // Review banner
    const dueWords = await SRS.getDueWords();
    const reviewBanner = document.getElementById('review-banner');
    const reviewText = document.getElementById('review-banner-text');
    if (dueWords.length > 0) {
      reviewBanner.style.display = 'flex';
      reviewText.textContent = `${dueWords.length} ${this._plural(dueWords.length, 'слово', 'слова', 'слів')} ${this._plural(dueWords.length, 'чекає', 'чекають', 'чекають')} на повторення`;
    } else {
      reviewBanner.style.display = 'none';
    }

    // Achievements
    await this.updateAchievements();

    // Demo badge
    if (this.isDemo) {
      greeting.textContent += ' (демо)';
    }
  },

  async updateAchievements() {
    const list = document.getElementById('achievements-list');
    if (!list) return;
    list.innerHTML = '';

    const allProgress = await ManulDB.getAllWordProgress();
    const learnedIds = new Set(allProgress.filter(p => p.box > 0).map(p => p.wordId));

    for (const theme of this.themes) {
      if (!theme.achievements) continue;
      for (const ach of theme.achievements) {
        const unlocked = ach.requiredWords.every(id => learnedIds.has(id));
        const li = document.createElement('li');
        li.className = unlocked ? '' : 'locked';
        li.textContent = (unlocked ? '✓ ' : '○ ') + ach.description;
        list.appendChild(li);
      }
    }
  },

  // ===== Lesson Flow =====
  async startLessonFlow() {
    this.lessonNumber = await ManulDB.getSessionCount();

    if (this.lessonNumber === 0) {
      // First lesson: always 1 word
      this.wordCount = 1;
      await this.startLesson();
    } else {
      // Show word count selector
      document.getElementById('wordcount-greeting').textContent =
        `${this.profile.name}, новий урок!`;
      document.getElementById('word-count-value').textContent = this.wordCount;
      this.showScreen('wordcount');
    }
  },

  adjustWordCount(delta) {
    this.wordCount = Math.max(1, Math.min(15, this.wordCount + delta));
    document.getElementById('word-count-value').textContent = this.wordCount;

    const warning = document.getElementById('wordcount-warning');
    if (this.wordCount > 10) {
      warning.style.display = 'block';
      warning.textContent = 'Манул бурчить: «Може, трохи менше? Я ж теж втомлююся...»';
    } else {
      warning.style.display = 'none';
    }
  },

  async startLesson() {
    const currentTheme = await ManulDB.getCurrentTheme() || this.themes[0];
    if (!currentTheme) {
      this.showToast('Немає доступних тем');
      return;
    }

    const isFirstLesson = this.lessonNumber === 0;
    const newWords = await LessonEngine.getNewWordsForLesson(
      this.wordCount, currentTheme, this.allWords
    );

    if (newWords.length === 0) {
      this.showToast('Усі слова цієї теми вже вивчені! Манул радіє.');
      this.showScreen('home');
      return;
    }

    const wordIds = newWords.map(w => w.id);

    // Check if demo
    if (this.isDemo) {
      await this.startDemoLesson(wordIds, currentTheme, isFirstLesson);
      return;
    }

    await LessonEngine.prepareLessonSteps(
      wordIds, currentTheme, this.allWords,
      this.profile.name, isFirstLesson
    );

    this.showScreen('lesson');
    this.showCurrentLessonStep();
  },

  async startDemoLesson(wordIds, theme, isFirstLesson) {
    // Load demo data
    const lessonNum = Math.min(this.lessonNumber + 1, 3);
    try {
      const resp = await fetch(`data/demo/lesson${lessonNum}.json`);
      LessonEngine.demoData = await resp.json();
      LessonEngine.isDemo = true;
    } catch {
      LessonEngine.demoData = null;
      LessonEngine.isDemo = true;
    }

    const demoWordIds = LessonEngine.demoData?.wordIds || wordIds;
    await LessonEngine.prepareLessonSteps(
      demoWordIds, theme, this.allWords,
      this.profile.name, isFirstLesson
    );

    this.showScreen('lesson');
    this.showCurrentLessonStep();
  },

  showCurrentLessonStep() {
    const step = LessonEngine.getCurrentStep();
    if (!step) return;

    const progress = LessonEngine.getProgress();
    document.getElementById('lesson-progress-fill').style.width = `${progress.percent}%`;
    document.getElementById('lesson-progress-text').textContent = `${progress.current}/${progress.total}`;

    const rendered = LessonEngine.renderStep(step);

    if (rendered === 'STORY_SCREEN') {
      this.showStory();
      return;
    }
    if (rendered === 'DIALOG_SCREEN') {
      this.showDialog();
      return;
    }
    if (rendered === 'SUMMARY_SCREEN') {
      this.showSummary();
      return;
    }

    document.getElementById('lesson-content').innerHTML = rendered;

    // Focus first writing input if present
    const writingInput = document.querySelector('.writing-input');
    if (writingInput) {
      setTimeout(() => writingInput.focus(), 100);
    }
  },

  async lessonNext() {
    const currentStep = LessonEngine.getCurrentStep();

    // Mark word as learned if it's a new word step
    if (currentStep?.type === 'new_word') {
      await SRS.markLearned(currentStep.data.word.id);
    }

    const next = LessonEngine.nextStep();
    if (next) {
      this.showCurrentLessonStep();
    }
  },

  // ===== Writing =====
  handleWritingInput(input) {
    const expected = input.dataset.expected;
    const attempt = parseInt(input.dataset.attempt);
    const result = LessonEngine.checkWriting(input.value, expected);

    const feedbackEl = document.getElementById(`writing-feedback-${attempt}`);

    if (result === 'exact') {
      input.classList.add('correct');
      input.disabled = true;
      if (feedbackEl) feedbackEl.textContent = 'Чудово! ✓';
      if (feedbackEl) feedbackEl.style.color = 'var(--success)';
    } else if (result === 'close') {
      input.classList.add('close');
      if (feedbackEl) feedbackEl.textContent = `Майже! Правильно: ${expected}`;
      if (feedbackEl) feedbackEl.style.color = 'var(--warning)';
    } else {
      input.classList.add('wrong');
      if (feedbackEl) feedbackEl.textContent = `Спробуй: ${expected}`;
      if (feedbackEl) feedbackEl.style.color = 'var(--danger)';
    }

    // Show next input
    const nextInput = document.getElementById(`writing-input-${attempt + 1}`);
    if (nextInput) {
      nextInput.style.display = 'block';
      setTimeout(() => nextInput.focus(), 100);
    }
  },

  // ===== Story =====
  async showStory() {
    const step = LessonEngine.getCurrentStep();
    let storyData;

    if (LessonEngine.isDemo && LessonEngine.demoData?.story) {
      storyData = LessonEngine.demoData.story;
    } else if (!this.isDemo) {
      try {
        const allProgress = await ManulDB.getAllWordProgress();
        const knownIds = allProgress.filter(p => p.box > 0).map(p => p.wordId);

        document.getElementById('story-title').textContent = 'Генерую історію...';
        document.getElementById('story-lines').innerHTML =
          '<div class="generating-overlay"><div class="loader"></div><p>Манул вигадує історію...</p></div>';
        this.showScreen('story');

        storyData = await GeminiAPI.generateStory({
          theme: step.data.theme,
          newWordIds: step.data.wordIds,
          knownWordIds: knownIds,
          userName: this.profile.name,
          allWords: this.allWords
        });
      } catch (err) {
        this.showToast(GeminiAPI.getErrorMessage(err));
        storyData = this._fallbackStory(step.data.wordIds);
      }
    } else {
      storyData = this._fallbackStory(step.data.wordIds);
    }

    document.getElementById('story-title').textContent = storyData.title_uk || 'Міні-історія';

    const linesHtml = (storyData.lines || []).map(line => `
      <div class="story-line">
        <div class="story-line-de">${line.de}</div>
        <div class="story-line-uk">${line.uk}</div>
        <button class="word-audio-btn" onclick="LessonEngine.playAudio('${line.de.replace(/'/g, "\\'")}')">
          🔊
        </button>
      </div>
    `).join('');

    document.getElementById('story-lines').innerHTML = linesHtml;
    this.showScreen('story');
  },

  _fallbackStory(wordIds) {
    const lines = wordIds.map(id => {
      const w = this.allWords.find(x => x.id === id);
      if (!w) return null;
      const s = w.sentences?.[0];
      return s ? { de: s.de, uk: s.uk, word_ids: [id] } : null;
    }).filter(Boolean);

    return { title_uk: 'Твої нові слова', lines };
  },

  storyDone() {
    LessonEngine.nextStep();
    this.showCurrentLessonStep();
  },

  // ===== Dialog =====
  async showDialog() {
    const step = LessonEngine.getCurrentStep();
    let dialogData;

    if (LessonEngine.isDemo && LessonEngine.demoData?.dialog) {
      dialogData = LessonEngine.demoData.dialog;
    } else if (!this.isDemo) {
      try {
        const msgArea = document.getElementById('dialog-messages');
        msgArea.innerHTML = '<div class="generating-overlay"><div class="loader"></div><p>Манул готує діалог...</p></div>';
        this.showScreen('dialog');

        dialogData = await GeminiAPI.generateDialog({
          theme: step.data.theme,
          wordIds: step.data.wordIds,
          userName: this.profile.name,
          allWords: this.allWords,
          questionCount: Math.max(step.data.wordIds.length, 3)
        });
      } catch (err) {
        this.showToast(GeminiAPI.getErrorMessage(err));
        dialogData = this._fallbackDialog(step.data.wordIds);
      }
    } else {
      dialogData = this._fallbackDialog(step.data.wordIds);
    }

    this.dialogTurns = dialogData.turns || [];
    this.dialogCurrentTurn = 0;
    document.getElementById('dialog-messages').innerHTML = '';
    document.getElementById('dialog-hint-area').style.display = 'block';
    this.showScreen('dialog');
    this.processDialogTurn();
  },

  _fallbackDialog(wordIds) {
    const turns = [];
    turns.push({ speaker: 'manul', de: 'Gut! Probieren wir!', uk: 'Добре! Спробуємо!' });

    for (const id of wordIds) {
      const w = this.allWords.find(x => x.id === id);
      if (!w) continue;
      turns.push({
        speaker: 'question',
        question_de: `Wie sagt man «${w.translation}» auf Deutsch?`,
        question_uk: `Як сказати «${w.translation}» німецькою?`,
        expected_de: w.article ? `${w.article} ${w.lemma}` : w.lemma,
        word_ids: [id]
      });
    }
    return { turns };
  },

  processDialogTurn() {
    if (this.dialogCurrentTurn >= this.dialogTurns.length) {
      this.dialogFinished();
      return;
    }

    const turn = this.dialogTurns[this.dialogCurrentTurn];

    if (turn.speaker === 'manul') {
      this.addDialogMessage('manul', turn.de, turn.uk);
      this.dialogCurrentTurn++;
      setTimeout(() => this.processDialogTurn(), 600);
    } else if (turn.speaker === 'question') {
      const questionText = turn.question_uk || turn.question_de;
      this.addDialogMessage('manul', turn.question_de, questionText);
      // Wait for user input
      document.getElementById('dialog-input').focus();
    }
  },

  async dialogSend() {
    const input = document.getElementById('dialog-input');
    const answer = input.value.trim();
    if (!answer) return;

    const turn = this.dialogTurns[this.dialogCurrentTurn];
    if (!turn || turn.speaker !== 'question') return;

    input.value = '';
    this.addDialogMessage('user', answer);

    // Check answer
    let result;
    if (!this.isDemo && this.profile.apiKey) {
      try {
        result = await GeminiAPI.checkAnswer({
          questionDe: turn.question_de,
          expectedDe: turn.expected_de,
          userAnswer: answer,
          wordIds: turn.word_ids || [],
          userName: this.profile.name
        });
      } catch {
        result = this._localCheck(answer, turn.expected_de);
      }
    } else {
      result = this._localCheck(answer, turn.expected_de);
    }

    // Show feedback
    const feedbackMsg = result.reaction_uk || (result.correct ? 'Так!' : `Правильно: ${turn.expected_de}`);
    this.addDialogMessage('system', feedbackMsg);

    // Update SRS
    if (turn.word_ids) {
      for (const wid of turn.word_ids) {
        await SRS.updateAfterReview(wid, !result.needs_repeat);
      }
    }

    this.dialogCurrentTurn++;
    setTimeout(() => this.processDialogTurn(), 800);
  },

  _localCheck(userAnswer, expected) {
    const result = LessonEngine.checkWriting(userAnswer, expected);
    if (result === 'exact') {
      return { correct: true, match: 'exact', reaction_uk: 'Точно! Манул задоволений.', needs_repeat: false };
    } else if (result === 'close') {
      return { correct: true, match: 'close', reaction_uk: `Майже! Правильно: ${expected}`, needs_repeat: false };
    }
    return { correct: false, match: 'wrong', reaction_uk: `Нічого! Правильно: ${expected}. Повторимо.`, needs_repeat: true };
  },

  async dialogHint() {
    const turn = this.dialogTurns[this.dialogCurrentTurn];
    if (!turn || turn.speaker !== 'question') return;

    const level = this.profile?.hintLevel ?? 2;

    if (!this.isDemo && this.profile.apiKey) {
      try {
        const hint = await GeminiAPI.getHint({
          level,
          expectedDe: turn.expected_de,
          langExplain: 'uk'
        });
        this.addDialogMessage('system', hint.hint_uk);
        return;
      } catch { /* fallback */ }
    }

    // Local hint
    let hintText;
    switch (level) {
      case 0: hintText = 'Підказок немає. Спробуй!'; break;
      case 1: hintText = `Починається з: ${turn.expected_de.charAt(0)}...`; break;
      case 2:
        const w = this.allWords.find(x => x.lemma === turn.expected_de || `${x.article} ${x.lemma}` === turn.expected_de);
        hintText = w ? `Це означає: ${w.translation}` : `Підказка: ${turn.expected_de.substring(0, 3)}...`;
        break;
      case 3: hintText = `${turn.expected_de.substring(0, Math.ceil(turn.expected_de.length / 2))}...`; break;
      case 4: hintText = `Відповідь: ${turn.expected_de}`; break;
      default: hintText = `${turn.expected_de.charAt(0)}...`;
    }
    this.addDialogMessage('system', hintText);
  },

  addDialogMessage(role, textDe, textUk) {
    const container = document.getElementById('dialog-messages');
    const msg = document.createElement('div');

    if (role === 'manul') {
      msg.className = 'msg msg-manul';
      msg.innerHTML = `<div>${textDe}</div>${textUk ? `<div class="msg-feedback">${textUk}</div>` : ''}`;
    } else if (role === 'user') {
      msg.className = 'msg msg-user';
      msg.textContent = textDe;
    } else {
      msg.className = 'msg msg-system';
      msg.textContent = textDe;
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  async dialogFinished() {
    document.getElementById('dialog-hint-area').style.display = 'none';
    document.getElementById('dialog-input-area').style.display = 'none';
    this.addDialogMessage('manul', 'Gut gemacht!', 'Чудово! Манул задоволений.');

    setTimeout(() => {
      document.getElementById('dialog-input-area').style.display = 'flex';
      LessonEngine.nextStep();
      this.showCurrentLessonStep();
    }, 1500);
  },

  // ===== Summary =====
  async showSummary() {
    const wordIds = LessonEngine.getCurrentStep()?.data?.wordIds || [];
    const words = wordIds.map(id => this.allWords.find(w => w.id === id)).filter(Boolean);

    document.getElementById('summary-title').textContent =
      `${this.profile.name}, урок завершено!`;
    document.getElementById('summary-message').textContent =
      'Манул пишається тобою. Без оцінок — просто ще один крок вперед.';

    // Word chips
    const chipsHtml = words.map(w =>
      `<span class="summary-word-chip">${w.emoji || ''} ${w.article ? w.article + ' ' : ''}${w.lemma} — ${w.translation}</span>`
    ).join('');
    document.getElementById('summary-words').innerHTML = chipsHtml;

    // Schedule
    document.getElementById('schedule-text').textContent = SRS.getScheduleText(words.length);

    // Save session
    await ManulDB.saveSession({
      type: 'lesson',
      theme: LessonEngine.theme?.id,
      wordIds,
      wordsCount: words.length,
    });

    this.showScreen('summary');
  },

  // ===== Review =====
  reviewWords: [],
  reviewIndex: 0,

  async startReview() {
    const dueProgress = await SRS.getDueWords();
    if (dueProgress.length === 0) {
      this.showToast('Немає слів для повторення!');
      return;
    }

    this.reviewWords = dueProgress.map(p => {
      const w = this.allWords.find(x => x.id === p.wordId);
      return w ? { ...w, progress: p } : null;
    }).filter(Boolean);

    this.reviewIndex = 0;
    this.showScreen('review');
    this.showReviewWord();
  },

  showReviewWord() {
    if (this.reviewIndex >= this.reviewWords.length) {
      this.reviewFinished();
      return;
    }

    const word = this.reviewWords[this.reviewIndex];
    const content = document.getElementById('review-content');

    content.innerHTML = `
      <div class="word-card">
        <div class="word-image">${word.emoji || '📝'}</div>
        <p style="color: var(--text-secondary); margin-bottom: 8px">
          ${this.reviewIndex + 1} / ${this.reviewWords.length}
        </p>
        <div class="word-uk" style="font-size: var(--font-size-xl); color: var(--accent)">
          ${word.translation}
        </div>
        <p style="margin-top: 8px; color: var(--text-secondary)">Як це німецькою?</p>
      </div>
    `;

    const input = document.getElementById('review-input');
    input.value = '';
    input.focus();
  },

  async reviewSend() {
    const input = document.getElementById('review-input');
    const answer = input.value.trim();
    if (!answer) return;

    const word = this.reviewWords[this.reviewIndex];
    const expected = word.article ? `${word.article} ${word.lemma}` : word.lemma;

    const result = LessonEngine.checkWriting(answer, expected);
    const remembered = result !== 'wrong';

    await SRS.updateAfterReview(word.id, remembered);

    const content = document.getElementById('review-content');
    const feedbackClass = result === 'exact' ? 'success' : result === 'close' ? 'warning' : 'danger';
    const feedbackText = result === 'exact' ? 'Точно!'
      : result === 'close' ? `Майже! ${expected}`
      : `${expected} — повторимо пізніше`;

    content.innerHTML += `
      <div class="msg msg-system" style="margin-top: 12px; border-left: 3px solid var(--${feedbackClass})">
        ${feedbackText}
      </div>
    `;

    input.value = '';
    this.reviewIndex++;

    setTimeout(() => this.showReviewWord(), 1200);
  },

  async reviewFinished() {
    const content = document.getElementById('review-content');
    content.innerHTML = `
      <div class="word-card">
        <div class="word-image">🐱</div>
        <div class="word-de" style="font-size: 1.3rem">Повторення завершено!</div>
        <div class="word-uk">Манул задоволений. Каву?</div>
        <button class="btn btn-primary" style="margin-top: 16px" onclick="App.showScreen('home')">
          На головну
        </button>
      </div>
    `;
    document.getElementById('review-input').parentElement.style.display = 'none';

    await ManulDB.saveSession({
      type: 'review',
      wordsCount: this.reviewWords.length
    });
  },

  // ===== Talk Mode =====
  async startTalkMode() {
    this.talkMessages = [];
    document.getElementById('talk-messages').innerHTML = '';
    this.showScreen('talk');

    // Initial greeting from Manul
    this.addTalkMessage('manul', 'Erzähl mir von deinem Tag!', 'Розкажи мені про свій день!');

    if (!this.isDemo && this.profile.apiKey) {
      // Will use AI for responses
    } else {
      this.addTalkMessage('manul',
        'Im Demo-Modus kann ich nicht richtig antworten...',
        'У демо-режимі я не можу нормально відповідати. Введи API-ключ для повноцінної розмови!'
      );
    }
  },

  async talkSend() {
    const input = document.getElementById('talk-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    this.addTalkMessage('user', text);
    this.talkMessages.push({ role: 'user', text });

    if (!this.isDemo && this.profile.apiKey) {
      // Show typing indicator
      const container = document.getElementById('talk-messages');
      const typing = document.createElement('div');
      typing.className = 'msg msg-manul';
      typing.id = 'talk-typing';
      typing.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
      container.appendChild(typing);
      container.scrollTop = container.scrollHeight;

      try {
        const allProgress = await ManulDB.getAllWordProgress();
        const knownWords = allProgress.filter(p => p.box > 0).map(p => {
          const w = this.allWords.find(x => x.id === p.wordId);
          return w?.lemma;
        }).filter(Boolean);

        const response = await GeminiAPI.talkConversation({
          messages: this.talkMessages,
          userName: this.profile.name,
          knownWords
        });

        document.getElementById('talk-typing')?.remove();

        if (response.encouragement_uk) {
          this.addTalkMessage('system', response.encouragement_uk);
        }
        this.addTalkMessage('manul', response.response_de, response.response_uk);

        if (response.follow_up_de) {
          setTimeout(() => {
            this.addTalkMessage('manul', response.follow_up_de, response.follow_up_uk);
          }, 800);
        }

        this.talkMessages.push({ role: 'manul', text: response.response_de });
      } catch (err) {
        document.getElementById('talk-typing')?.remove();
        this.addTalkMessage('system', GeminiAPI.getErrorMessage(err));
      }
    }
  },

  addTalkMessage(role, textDe, textUk) {
    const container = document.getElementById('talk-messages');
    const msg = document.createElement('div');

    if (role === 'manul') {
      msg.className = 'msg msg-manul';
      msg.innerHTML = `<div>${textDe}</div>${textUk ? `<div class="msg-feedback">${textUk}</div>` : ''}`;
    } else if (role === 'user') {
      msg.className = 'msg msg-user';
      msg.textContent = textDe;
    } else {
      msg.className = 'msg msg-system';
      msg.textContent = textDe;
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  // ===== Settings =====
  updateSettings() {
    if (!this.profile) return;

    document.getElementById('settings-name').value = this.profile.name || '';
    document.getElementById('settings-hint-level').value = this.profile.hintLevel ?? 2;

    const keyStatus = document.getElementById('settings-key-status');
    if (this.profile.apiKey) {
      keyStatus.textContent = '✓ Ключ встановлено';
      keyStatus.style.color = 'var(--success)';
    } else {
      keyStatus.textContent = '✕ Ключ не встановлено (демо-режим)';
      keyStatus.style.color = 'var(--warning)';
    }
  },

  async updateProfile() {
    const name = document.getElementById('settings-name').value.trim();
    if (name) {
      this.profile.name = name;
      await ManulDB.saveProfile(this.profile);
      this.showToast('Профіль оновлено');
    }
  },

  // ===== Export / Import =====
  async exportProgress() {
    try {
      const data = await ManulDB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manul-kaffee-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Резервну копію збережено');
    } catch (err) {
      this.showToast('Помилка експорту');
    }
  },

  async importProgress(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await ManulDB.importAll(data);
      this.profile = await ManulDB.getProfile();
      this.showToast('Прогрес відновлено!');
      this.showScreen('home');
    } catch (err) {
      this.showToast('Помилка імпорту: невірний формат файлу');
    }
    event.target.value = '';
  },

  // ===== Toast =====
  showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  },

  // ===== Utils =====
  _plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => App.init());
