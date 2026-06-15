/* ===== Gemini API Integration & Prompt Layer ===== */

const GeminiAPI = {
  MODEL_TEXT: 'gemini-2.5-flash',
  MODEL_TTS: 'gemini-2.5-flash',
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',

  _apiKey: null,

  setApiKey(key) {
    this._apiKey = key;
  },

  // System prompt for Manul Bilyash persona
  _systemPrompt: `Du bist Manul Bilyasch (Манул Біляш) — ein Pallas-Kater, der als Begleiter beim Deutschlernen hilft.

Charakter:
- Du bist ruhig, lakonisch, mit trockenem Humor
- Du liebst Kaffee und brummst manchmal
- Du bist ein Freund und Begleiter, KEIN Lehrer
- Du unterstützt, bewertest nicht und belehrst nicht
- Du machst manchmal selbst Fehler (absichtlich lustig)

VERBOTEN — niemals verwenden:
- "Falsch", "Fehler", "schlecht", "gescheitert", "verloren"
- Bewertungen, Prozente, Punkte, Strafen
- Druck, Moralisieren, Tadel

STATTDESSEN verwenden:
- "Fast!", "Dieses Wort will noch einen Kaffee", "Manul hat es auch nicht sofort gemerkt"
- Humor, sanfte Unterstützung, kleine Siege feiern

Antworte IMMER im geforderten JSON-Format. Keine Markdown-Umhüllungen. Nur valides JSON.
Erkläre auf Ukrainisch. Deutschniveau: A1-A2, nur einfache Strukturen.`,

  async _call(prompt, responseSchema, options = {}) {
    if (!this._apiKey) throw new Error('NO_API_KEY');

    const model = options.model || this.MODEL_TEXT;
    const url = `${this.BASE_URL}/models/${model}:generateContent?key=${this._apiKey}`;

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      systemInstruction: {
        parts: [{ text: this._systemPrompt }]
      },
      generationConfig: {
        temperature: options.temperature || 0.7,
        responseMimeType: 'application/json'
      }
    };

    if (responseSchema) {
      body.generationConfig.responseSchema = responseSchema;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 429) throw new Error('RATE_LIMIT');
      if (response.status === 403) throw new Error('INVALID_KEY');
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('EMPTY_RESPONSE');

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('PARSE_ERROR');
    }
  },

  // Validate API key
  async validateKey(key) {
    const prevKey = this._apiKey;
    this._apiKey = key;
    try {
      const url = `${this.BASE_URL}/models/${this.MODEL_TEXT}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Antworte mit {"ok":true}' }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      if (!response.ok) {
        // 429 = rate limit, key is valid but quota exceeded
        if (response.status === 429) return true;
        this._apiKey = prevKey;
        return false;
      }
      return true;
    } catch {
      this._apiKey = prevKey;
      return false;
    }
  },

  // Check answer (FR-16, section 4.5.1)
  async checkAnswer({ questionDe, expectedDe, userAnswer, wordIds, userName }) {
    const cacheKey = `check_${questionDe}_${userAnswer}`;
    const cached = await ManulDB.getCachedGeneration(cacheKey);
    if (cached) return cached.data;

    const prompt = `Aufgabe: Überprüfe die Antwort des Benutzers.

Kontext:
- Frage auf Deutsch: "${questionDe}"
- Erwartete Antwort: "${expectedDe}"
- Antwort des Benutzers: "${userAnswer}"
- Benutzer: ${userName}
- Wort-IDs: ${JSON.stringify(wordIds)}

Regeln der Normalisierung:
- Groß-/Kleinschreibung ignorieren für Anfänger
- ß/ss, ä/ae, ö/oe, ü/ue als gleichwertig behandeln
- Fehlender Artikel verzeihen
- Kleine Tippfehler als "close" bewerten, nicht "wrong"

Antworte NUR als JSON:`;

    const schema = {
      type: 'OBJECT',
      properties: {
        correct: { type: 'BOOLEAN' },
        match: { type: 'STRING', enum: ['exact', 'close', 'wrong'] },
        normalized_user_answer: { type: 'STRING' },
        issues: { type: 'ARRAY', items: { type: 'STRING' } },
        reaction_uk: { type: 'STRING' },
        correction_de: { type: 'STRING' },
        needs_repeat: { type: 'BOOLEAN' }
      },
      required: ['correct', 'match', 'reaction_uk', 'needs_repeat']
    };

    const result = await this._call(prompt, schema, { temperature: 0.3 });
    await ManulDB.cacheGeneration(cacheKey, 'check', result);
    return result;
  },

  // Generate hint (section 4.5.2)
  async getHint({ level, expectedDe, langExplain }) {
    const prompt = `Aufgabe: Gib einen Hinweis der Stufe ${level}.

Erwartete Antwort: "${expectedDe}"
Sprache der Erklärung: ${langExplain || 'uk'}

Hinweisstufen:
0 — kein Hinweis
1 — erster Buchstabe
2 — Übersetzung
3 — Teil der Antwort
4 — volle Antwort

Antworte NUR als JSON:`;

    const schema = {
      type: 'OBJECT',
      properties: {
        level: { type: 'INTEGER' },
        hint_uk: { type: 'STRING' },
        reveal: { type: 'STRING' }
      },
      required: ['level', 'hint_uk']
    };

    return this._call(prompt, schema, { temperature: 0.3 });
  },

  // Generate mini-story (section 4.5.3)
  async generateStory({ theme, newWordIds, knownWordIds, userName, allWords }) {
    const cacheKey = `story_${theme}_${newWordIds.sort().join(',')}`;
    const cached = await ManulDB.getCachedGeneration(cacheKey);
    if (cached) return cached.data;

    const newWordsDesc = newWordIds.map(id => {
      const w = allWords.find(x => x.id === id);
      return w ? `${id}: ${w.article ? w.article + ' ' : ''}${w.lemma} (${w.translation})` : id;
    }).join('\n');

    const knownWordsDesc = knownWordIds.map(id => {
      const w = allWords.find(x => x.id === id);
      return w ? `${id}: ${w.article ? w.article + ' ' : ''}${w.lemma}` : id;
    }).join(', ');

    const prompt = `Aufgabe: Erstelle eine Mini-Geschichte für A1-Niveau.

Thema: ${theme}
Benutzername: ${userName}
Neue Wörter (MÜSSEN verwendet werden):
${newWordsDesc}

Bekannte Wörter (können verwendet werden): ${knownWordsDesc || 'keine'}

Regeln:
- Maximal 5-8 kurze Sätze
- Nur A1-Grammatik (Präsens, einfache Sätze)
- Jeder neue Wort muss mindestens einmal vorkommen
- Name des Benutzers korrekt dekliniert einsetzen
- Manul kann auch vorkommen (als lustiger Begleiter)
- Humor und Wärme, keine Kompliziertheit

Antworte NUR als JSON:`;

    const schema = {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING' },
        theme: { type: 'STRING' },
        title_uk: { type: 'STRING' },
        lines: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              de: { type: 'STRING' },
              uk: { type: 'STRING' },
              word_ids: { type: 'ARRAY', items: { type: 'STRING' } }
            },
            required: ['de', 'uk']
          }
        },
        used_word_ids: { type: 'ARRAY', items: { type: 'STRING' } }
      },
      required: ['title_uk', 'lines']
    };

    const result = await this._call(prompt, schema);
    await ManulDB.cacheGeneration(cacheKey, 'story', result);
    return result;
  },

  // Generate mini-dialog (section 4.5.4)
  async generateDialog({ theme, wordIds, userName, allWords, questionCount }) {
    const cacheKey = `dialog_${theme}_${wordIds.sort().join(',')}`;
    const cached = await ManulDB.getCachedGeneration(cacheKey);
    if (cached) return cached.data;

    const wordsDesc = wordIds.map(id => {
      const w = allWords.find(x => x.id === id);
      return w ? `${id}: ${w.article ? w.article + ' ' : ''}${w.lemma} (${w.translation})` : id;
    }).join('\n');

    const prompt = `Aufgabe: Erstelle einen Mini-Dialog zur Überprüfung.

Thema: ${theme}
Benutzername: ${userName}
Anzahl der Fragen: ${questionCount || wordIds.length}
Wörter (MÜSSEN abgefragt werden):
${wordsDesc}

Regeln:
- Dialog zwischen Manul und Benutzer
- Manul stellt Fragen / sagt Sätze
- Benutzer muss antworten
- Jedes Wort mindestens einmal abgefragt
- Nur A1-Grammatik
- Für jede Frage: erwartete Antwort mitliefern
- Manul ist freundlich, mit Humor

Antworte NUR als JSON:`;

    const schema = {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING' },
        theme: { type: 'STRING' },
        turns: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              speaker: { type: 'STRING', enum: ['manul', 'question'] },
              de: { type: 'STRING' },
              uk: { type: 'STRING' },
              question_de: { type: 'STRING' },
              expected_de: { type: 'STRING' },
              word_ids: { type: 'ARRAY', items: { type: 'STRING' } }
            },
            required: ['speaker']
          }
        },
        question_count: { type: 'INTEGER' }
      },
      required: ['turns']
    };

    const result = await this._call(prompt, schema);
    await ManulDB.cacheGeneration(cacheKey, 'dialog', result);
    return result;
  },

  // Talk mode - free conversation (FR-21)
  async talkConversation({ messages, userName, knownWords }) {
    const history = messages.map(m => `${m.role}: ${m.text}`).join('\n');

    const prompt = `Aufgabe: Freies Gespräch im Modus "Erzähl deinen Tag".

Benutzername: ${userName}
Bekannte Wörter: ${knownWords?.join(', ') || 'wenige'}

Bisheriger Dialog:
${history}

Regeln:
- Nur A1-A2 Deutsch
- Antworte auf Deutsch mit ukrainischer Übersetzung
- Stelle eine einfache Frage zum Weitermachen
- Sei ermutigend, nicht korrigierend
- Manul-Persönlichkeit beibehalten

Antworte NUR als JSON:`;

    const schema = {
      type: 'OBJECT',
      properties: {
        response_de: { type: 'STRING' },
        response_uk: { type: 'STRING' },
        follow_up_de: { type: 'STRING' },
        follow_up_uk: { type: 'STRING' },
        encouragement_uk: { type: 'STRING' }
      },
      required: ['response_de', 'response_uk']
    };

    return this._call(prompt, schema);
  },

  // TTS via Gemini (basic browser speech synthesis fallback)
  async speak(text, lang = 'de-DE') {
    // Use browser's built-in speech synthesis as primary method
    // Gemini TTS requires different API setup
    if ('speechSynthesis' in window) {
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = 0.85;
        utterance.pitch = 1.0;

        // Try to find a German voice
        const voices = speechSynthesis.getVoices();
        const deVoice = voices.find(v => v.lang.startsWith('de'));
        if (deVoice) utterance.voice = deVoice;

        utterance.onend = resolve;
        utterance.onerror = resolve;
        speechSynthesis.speak(utterance);
      });
    }
  },

  // Friendly error messages from Manul
  getErrorMessage(error) {
    const msg = error.message || error;
    switch (msg) {
      case 'NO_API_KEY':
        return 'Хм, ключ кудись подівся. Може, перевіриш налаштування?';
      case 'RATE_LIMIT':
        return 'Занадто багато запитів... Манул теж іноді відпочиває. Спробуй за хвилинку.';
      case 'INVALID_KEY':
        return 'Цей ключ не працює. Може, перевіриш його в Google AI Studio?';
      case 'PARSE_ERROR':
        return 'Щось пішло не так із відповіддю. Спробуймо ще раз?';
      case 'EMPTY_RESPONSE':
        return 'Тиша... Манул задумався. Спробуймо ще раз.';
      default:
        if (!navigator.onLine) {
          return 'Схоже, немає інтернету. Але ми можемо повторити те, що вже вивчили!';
        }
        return 'Щось пішло не так. Манул бурчить і пробує ще раз...';
    }
  }
};
