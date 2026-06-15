/* ===== IndexedDB Storage Layer ===== */

const DB_NAME = 'ManulKaffeeDB';
const DB_VERSION = 1;

const ManulDB = {
  _db: null,

  async open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // User profile
        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'id' });
        }

        // Words (static base)
        if (!db.objectStoreNames.contains('words')) {
          const ws = db.createObjectStore('words', { keyPath: 'id' });
          ws.createIndex('theme', 'themes', { multiEntry: true });
          ws.createIndex('pos', 'pos');
        }

        // Themes
        if (!db.objectStoreNames.contains('themes')) {
          db.createObjectStore('themes', { keyPath: 'id' });
        }

        // Sentences
        if (!db.objectStoreNames.contains('sentences')) {
          const ss = db.createObjectStore('sentences', { keyPath: 'id' });
          ss.createIndex('wordIds', 'wordIds', { multiEntry: true });
        }

        // Stories (generated/cached)
        if (!db.objectStoreNames.contains('stories')) {
          const sts = db.createObjectStore('stories', { keyPath: 'id' });
          sts.createIndex('theme', 'theme');
        }

        // Dialogs (generated/cached)
        if (!db.objectStoreNames.contains('dialogs')) {
          const ds = db.createObjectStore('dialogs', { keyPath: 'id' });
          ds.createIndex('theme', 'theme');
        }

        // Word progress (SRS state per word)
        if (!db.objectStoreNames.contains('wordProgress')) {
          const wp = db.createObjectStore('wordProgress', { keyPath: 'wordId' });
          wp.createIndex('nextReview', 'nextReview');
          wp.createIndex('box', 'box');
        }

        // Session history
        if (!db.objectStoreNames.contains('sessions')) {
          const sh = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          sh.createIndex('date', 'date');
        }

        // Achievements
        if (!db.objectStoreNames.contains('achievements')) {
          db.createObjectStore('achievements', { keyPath: 'id' });
        }

        // Generation cache
        if (!db.objectStoreNames.contains('genCache')) {
          const gc = db.createObjectStore('genCache', { keyPath: 'key' });
          gc.createIndex('type', 'type');
        }

        // Lesson state (resume support)
        if (!db.objectStoreNames.contains('lessonState')) {
          db.createObjectStore('lessonState', { keyPath: 'id' });
        }
      };

      req.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };

      req.onerror = (e) => reject(e.target.error);
    });
  },

  async _tx(storeName, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = fn(store);
      if (result && result.onsuccess !== undefined) {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      }
    });
  },

  // Generic CRUD
  async put(storeName, data) {
    return this._tx(storeName, 'readwrite', s => s.put(data));
  },

  async get(storeName, key) {
    return this._tx(storeName, 'readonly', s => s.get(key));
  },

  async getAll(storeName) {
    return this._tx(storeName, 'readonly', s => s.getAll());
  },

  async delete(storeName, key) {
    return this._tx(storeName, 'readwrite', s => s.delete(key));
  },

  async clear(storeName) {
    return this._tx(storeName, 'readwrite', s => s.clear());
  },

  // Profile
  async getProfile() {
    return this.get('profile', 'user');
  },

  async saveProfile(profile) {
    return this.put('profile', { id: 'user', ...profile });
  },

  // API Key (stored in profile)
  async getApiKey() {
    const profile = await this.getProfile();
    return profile?.apiKey || null;
  },

  async saveApiKey(key) {
    const profile = await this.getProfile() || { id: 'user' };
    profile.apiKey = key;
    return this.put('profile', profile);
  },

  async deleteApiKey() {
    const profile = await this.getProfile();
    if (profile) {
      delete profile.apiKey;
      return this.put('profile', profile);
    }
  },

  // Words
  async loadBaseWords(words) {
    const db = await this.open();
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    for (const w of words) {
      store.put(w);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getWordsByTheme(themeId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('words', 'readonly');
      const store = tx.objectStore('words');
      const idx = store.index('theme');
      const req = idx.getAll(themeId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Word Progress
  async getWordProgress(wordId) {
    return this.get('wordProgress', wordId);
  },

  async getAllWordProgress() {
    return this.getAll('wordProgress');
  },

  async saveWordProgress(progress) {
    return this.put('wordProgress', progress);
  },

  // Get words due for review
  async getWordsForReview() {
    const allProgress = await this.getAllWordProgress();
    const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return allProgress.filter(p => p.nextReview <= now && p.box > 0);
  },

  // Themes
  async loadThemes(themes) {
    const db = await this.open();
    const tx = db.transaction('themes', 'readwrite');
    const store = tx.objectStore('themes');
    for (const t of themes) {
      store.put(t);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getCurrentTheme() {
    const themes = await this.getAll('themes');
    const allProgress = await this.getAllWordProgress();
    const learnedIds = new Set(allProgress.filter(p => p.box > 0).map(p => p.wordId));

    // Find first theme that has unlearned words
    themes.sort((a, b) => a.order - b.order);
    for (const theme of themes) {
      const hasUnlearned = theme.wordIds.some(id => !learnedIds.has(id));
      if (hasUnlearned) return theme;
    }
    return themes[themes.length - 1] || null;
  },

  // Sessions
  async saveSession(session) {
    return this.put('sessions', {
      ...session,
      date: new Date().toISOString()
    });
  },

  async getSessionCount() {
    const all = await this.getAll('sessions');
    return all.length;
  },

  // Generation Cache
  async getCachedGeneration(key) {
    return this.get('genCache', key);
  },

  async cacheGeneration(key, type, data) {
    return this.put('genCache', { key, type, data, cachedAt: Date.now() });
  },

  // Lesson State (for resume)
  async saveLessonState(state) {
    return this.put('lessonState', { id: 'current', ...state });
  },

  async getLessonState() {
    return this.get('lessonState', 'current');
  },

  async clearLessonState() {
    return this.delete('lessonState', 'current');
  },

  // Achievements
  async loadAchievements(achievements) {
    const db = await this.open();
    const tx = db.transaction('achievements', 'readwrite');
    const store = tx.objectStore('achievements');
    for (const a of achievements) {
      store.put(a);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  // Export all data
  async exportAll() {
    const profile = await this.getProfile();
    const wordProgress = await this.getAllWordProgress();
    const sessions = await this.getAll('sessions');
    const genCache = await this.getAll('genCache');
    const lessonState = await this.getLessonState();

    // Remove API key from export
    const exportProfile = { ...profile };
    delete exportProfile.apiKey;

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: exportProfile,
      wordProgress,
      sessions,
      genCache,
      lessonState
    };
  },

  // Import data
  async importAll(data) {
    if (data.version !== 1) throw new Error('Непідтримувана версія');

    // Keep existing API key
    const currentProfile = await this.getProfile();
    const apiKey = currentProfile?.apiKey;

    if (data.profile) {
      const profile = { ...data.profile, id: 'user' };
      if (apiKey) profile.apiKey = apiKey;
      await this.put('profile', profile);
    }

    if (data.wordProgress) {
      const db = await this.open();
      const tx = db.transaction('wordProgress', 'readwrite');
      const store = tx.objectStore('wordProgress');
      store.clear();
      for (const wp of data.wordProgress) {
        store.put(wp);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }

    if (data.sessions) {
      const db = await this.open();
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      store.clear();
      for (const s of data.sessions) {
        store.put(s);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }
};
