/* ===== Lesson Engine ===== */

const LessonEngine = {
  currentLesson: null,
  currentStepIndex: 0,
  steps: [],
  lessonWords: [],
  allWords: [],
  theme: null,
  userName: '',
  isDemo: false,
  demoData: null,

  // Build lesson steps according to algorithm (section 8.1)
  async prepareLessonSteps(wordIds, theme, allWords, userName, isFirstLesson) {
    this.lessonWords = wordIds.map(id => allWords.find(w => w.id === id)).filter(Boolean);
    this.allWords = allWords;
    this.theme = theme;
    this.userName = userName;
    this.steps = [];
    this.currentStepIndex = 0;

    // 1. Greeting
    this.steps.push({
      type: 'greeting',
      data: { isFirstLesson }
    });

    // 2-3. Review old words if any
    const dueWords = await SRS.getDueWords();
    if (dueWords.length > 0 && !isFirstLesson) {
      const reviewWordIds = dueWords.slice(0, 5).map(p => p.wordId);
      const reviewWords = reviewWordIds.map(id => allWords.find(w => w.id === id)).filter(Boolean);
      if (reviewWords.length > 0) {
        this.steps.push({
          type: 'review_intro',
          data: { count: reviewWords.length }
        });
        for (const word of reviewWords) {
          this.steps.push({
            type: 'review_word',
            data: { word }
          });
        }
      }
    }

    // 4-6. New words - each word: image, audio, sentence, writing
    for (const word of this.lessonWords) {
      this.steps.push({
        type: 'new_word',
        data: { word }
      });
      this.steps.push({
        type: 'word_sentence',
        data: { word }
      });
      this.steps.push({
        type: 'word_writing',
        data: { word }
      });
    }

    // 7. Mini-story
    this.steps.push({
      type: 'story',
      data: { wordIds, theme: theme.id }
    });

    // 8. Mini-dialog
    this.steps.push({
      type: 'dialog',
      data: { wordIds, theme: theme.id }
    });

    // 9-10. Summary + schedule
    this.steps.push({
      type: 'summary',
      data: { wordIds }
    });

    return this.steps;
  },

  getCurrentStep() {
    return this.steps[this.currentStepIndex] || null;
  },

  nextStep() {
    this.currentStepIndex++;
    return this.getCurrentStep();
  },

  getProgress() {
    return {
      current: this.currentStepIndex + 1,
      total: this.steps.length,
      percent: Math.round(((this.currentStepIndex + 1) / this.steps.length) * 100)
    };
  },

  // Render current step to HTML
  renderStep(step) {
    if (!step) return '';
    switch (step.type) {
      case 'greeting': return this.renderGreeting(step.data);
      case 'review_intro': return this.renderReviewIntro(step.data);
      case 'review_word': return this.renderReviewWord(step.data);
      case 'new_word': return this.renderNewWord(step.data);
      case 'word_sentence': return this.renderWordSentence(step.data);
      case 'word_writing': return this.renderWordWriting(step.data);
      case 'story': return 'STORY_SCREEN';
      case 'dialog': return 'DIALOG_SCREEN';
      case 'summary': return 'SUMMARY_SCREEN';
      default: return '';
    }
  },

  renderGreeting(data) {
    const greetings = data.isFirstLesson
      ? [
          `${this.userName}, починаємо з одного слова. Просто одного!`,
          'Жодного тиску. Жодних оцінок. Тільки ти, я і кава.'
        ]
      : [
          `${this.userName}, раді бачити! Готові до нових слів?`,
          'Манул уже заварив каву. Починаймо!'
        ];

    return `
      <div class="word-card">
        <div class="word-image">🐱</div>
        <div class="word-de" style="font-size: 1.5rem">${greetings[0]}</div>
        <div class="word-uk" style="margin-top: 12px">${greetings[1]}</div>
      </div>
    `;
  },

  renderReviewIntro(data) {
    return `
      <div class="word-card">
        <div class="word-image">🔄</div>
        <div class="word-de" style="font-size: 1.3rem">Спершу — швидке повторення</div>
        <div class="word-uk">${data.count} ${this._pluralWords(data.count)} чекають на тебе</div>
      </div>
    `;
  },

  renderReviewWord(data) {
    const { word } = data;
    return `
      <div class="word-card">
        <div class="word-image">${word.emoji || '📝'}</div>
        <div class="word-de">${word.article ? word.article + ' ' : ''}${word.lemma}</div>
        <div class="word-uk">${word.translation}</div>
        <button class="word-audio-btn" onclick="LessonEngine.playAudio('${word.lemma}')">
          🔊 Послухати
        </button>
      </div>
      <div class="writing-area">
        <div class="writing-prompt">Напиши: ${word.lemma}</div>
        <input type="text" class="writing-input" id="review-writing"
               placeholder="${word.lemma.charAt(0)}..." autocomplete="off">
        <div class="writing-feedback" id="review-feedback"></div>
      </div>
    `;
  },

  renderNewWord(data) {
    const { word } = data;
    let grammarHtml = '';

    if (word.pos === 'noun') {
      grammarHtml = `
        <div class="word-grammar">
          <strong>${word.article} ${word.lemma}</strong> — ${word.gender === 'm' ? 'чоловічий' : word.gender === 'f' ? 'жіночий' : 'середній'} рід
          ${word.plural ? `<br>Множина: ${word.plural}` : ''}
        </div>
      `;
    } else if (word.pos === 'verb' && word.conjugation) {
      grammarHtml = `
        <div class="word-grammar">
          <strong>${word.lemma}</strong> — дієслово<br>
          ich ${word.conjugation.ich} · du ${word.conjugation.du} · er/sie/es ${word.conjugation.er_sie_es}
        </div>
      `;
    }

    return `
      <div class="word-card">
        <div class="word-image">${word.emoji || '📝'}</div>
        ${word.article ? `<div class="word-article">${word.article}</div>` : ''}
        <div class="word-de">${word.lemma}</div>
        <div class="word-uk">${word.translation}</div>
        <button class="word-audio-btn" onclick="LessonEngine.playAudio('${word.article ? word.article + ' ' : ''}${word.lemma}')">
          🔊 Послухати
        </button>
        ${grammarHtml}
      </div>
    `;
  },

  renderWordSentence(data) {
    const { word } = data;
    const sentence = word.sentences?.[0];
    if (!sentence) return this.renderNewWord(data);

    return `
      <div class="sentence-card">
        <div class="sentence-de">${sentence.de}</div>
        <div class="sentence-uk">${sentence.uk}</div>
        <button class="word-audio-btn" onclick="LessonEngine.playAudio('${sentence.de}')">
          🔊 Послухати речення
        </button>
      </div>
      ${word.sentences?.[1] ? `
        <div class="sentence-card" style="margin-top: 12px">
          <div class="sentence-de">${word.sentences[1].de}</div>
          <div class="sentence-uk">${word.sentences[1].uk}</div>
        </div>
      ` : ''}
    `;
  },

  renderWordWriting(data) {
    const { word } = data;
    const writeTarget = word.article ? `${word.article} ${word.lemma}` : word.lemma;

    return `
      <div class="writing-area">
        <div class="writing-prompt">Напиши: <strong>${writeTarget}</strong></div>
        <input type="text" class="writing-input" id="writing-input-1"
               placeholder="${writeTarget.charAt(0)}..." autocomplete="off"
               data-expected="${writeTarget}" data-attempt="1">
        <div class="writing-feedback" id="writing-feedback-1"></div>

        <input type="text" class="writing-input" id="writing-input-2"
               placeholder="Ще раз..." autocomplete="off"
               data-expected="${writeTarget}" data-attempt="2" style="display:none">
        <div class="writing-feedback" id="writing-feedback-2"></div>

        <input type="text" class="writing-input" id="writing-input-3"
               placeholder="І ще раз..." autocomplete="off"
               data-expected="${writeTarget}" data-attempt="3" style="display:none">
        <div class="writing-feedback" id="writing-feedback-3"></div>
      </div>
    `;
  },

  // Check writing input
  checkWriting(input, expected) {
    const normalize = s => s.trim().toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue');

    const n_input = normalize(input);
    const n_expected = normalize(expected);

    if (n_input === n_expected) return 'exact';
    if (this._editDistance(n_input, n_expected) <= 2) return 'close';
    return 'wrong';
  },

  _editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  },

  // Play audio via browser TTS
  playAudio(text) {
    GeminiAPI.speak(text, 'de-DE');
  },

  // Get new words for lesson (unlearned words from current theme)
  async getNewWordsForLesson(count, theme, allWords) {
    const allProgress = await ManulDB.getAllWordProgress();
    const learnedIds = new Set(allProgress.filter(p => p.box > 0).map(p => p.wordId));

    const themeWords = theme.wordIds
      .map(id => allWords.find(w => w.id === id))
      .filter(Boolean)
      .filter(w => !learnedIds.has(w.id));

    return themeWords.slice(0, count);
  },

  _pluralWords(n) {
    if (n === 1) return 'слово';
    if (n >= 2 && n <= 4) return 'слова';
    return 'слів';
  }
};
