/* ===== Spaced Repetition System (Leitner) ===== */

const SRS = {
  // Leitner intervals in days: box 0 = learning day, then 1, 3, 7, 14, 30
  INTERVALS: [0, 1, 3, 7, 14, 30],
  MAX_BOX: 5,

  // Get today as YYYY-MM-DD
  today() {
    return new Date().toISOString().slice(0, 10);
  },

  // Add days to a date string
  addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  },

  // Initialize word progress when a word is first learned
  createProgress(wordId) {
    const today = this.today();
    return {
      wordId,
      box: 1, // Start in box 1 (just learned)
      nextReview: this.addDays(today, this.INTERVALS[1]), // +1 day
      lastSeen: today,
      encounters: 1,
      learnedDate: today
    };
  },

  // Update progress after a review
  async updateAfterReview(wordId, remembered) {
    let progress = await ManulDB.getWordProgress(wordId);
    if (!progress) {
      progress = this.createProgress(wordId);
    }

    const today = this.today();
    progress.lastSeen = today;
    progress.encounters = (progress.encounters || 0) + 1;

    if (remembered) {
      // Move to next box (max = MAX_BOX)
      progress.box = Math.min(progress.box + 1, this.MAX_BOX);
    } else {
      // Move back to box 1 (needs repeat sooner)
      progress.box = 1;
    }

    // Set next review date based on current box
    const interval = this.INTERVALS[progress.box] || this.INTERVALS[this.MAX_BOX];
    progress.nextReview = this.addDays(today, interval);

    await ManulDB.saveWordProgress(progress);
    return progress;
  },

  // Mark word as just learned (first encounter)
  async markLearned(wordId) {
    let progress = await ManulDB.getWordProgress(wordId);
    if (progress) {
      progress.encounters = (progress.encounters || 0) + 1;
      progress.lastSeen = this.today();
      await ManulDB.saveWordProgress(progress);
      return progress;
    }

    progress = this.createProgress(wordId);
    await ManulDB.saveWordProgress(progress);
    return progress;
  },

  // Get all words due for review today
  async getDueWords() {
    const allProgress = await ManulDB.getAllWordProgress();
    const today = this.today();
    return allProgress.filter(p => p.nextReview <= today);
  },

  // Get count of learned words
  async getLearnedCount() {
    const allProgress = await ManulDB.getAllWordProgress();
    return allProgress.filter(p => p.box > 0).length;
  },

  // Get words that have reached the final box (30-day interval)
  async getMasteredCount() {
    const allProgress = await ManulDB.getAllWordProgress();
    return allProgress.filter(p => p.box >= this.MAX_BOX).length;
  },

  // Get review schedule description
  getScheduleText(wordsCount) {
    if (wordsCount === 0) return 'Поки немає слів для повторення.';
    const today = this.today();
    const tomorrow = this.addDays(today, 1);
    return `Наступне повторення: завтра (${tomorrow}). Манул нагадає!`;
  },

  // Get human-friendly interval description
  getIntervalText(box) {
    switch (box) {
      case 0: return 'сьогодні';
      case 1: return 'завтра';
      case 2: return 'через 3 дні';
      case 3: return 'через тиждень';
      case 4: return 'через 2 тижні';
      case 5: return 'через місяць';
      default: return 'через місяць';
    }
  }
};
