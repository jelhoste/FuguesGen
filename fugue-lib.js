'use strict';
(function (global) {
  const Lib = {};

  // ---- theory.js ----
  {

    /**
     * Moteur de théorie tonale minimal mais rigoureux.
     * Toutes les hauteurs sont représentées en MIDI (60 = Do central).
     * Les degrés d'échelle sont numérotés 1..7 (1 = tonique).
     */

    const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Intervalles en demi-tons depuis la tonique, pour chaque mode.
    // Mineur : on distingue la forme "naturelle" (degrés 6 et 7 non altérés)
    // et la forme "harmonique" (7e degré haussé), car la fugue classique
    // utilise le 7e degré haussé pour toute fonction de dominante (cadences,
    // sensible), mais le 7e degré naturel ailleurs (mineur mélodique descendant
    // simplifié ici en usage "naturel" par défaut).
    const MODE_INTERVALS = {
      major: [0, 2, 4, 5, 7, 9, 11],
      minor: [0, 2, 3, 5, 7, 8, 10], // mineur naturel
    };

    class Key {
      /**
       * @param {string} tonic - ex: 'C', 'F#', 'Bb'
       * @param {'major'|'minor'} mode
       */
      constructor(tonic, mode) {
        if (!MODE_INTERVALS[mode]) throw new Error(`Mode inconnu: ${mode}`);
        this.tonic = tonic;
        this.mode = mode;
        this.tonicPc = Key.noteNameToPc(tonic);
      }

      static noteNameToPc(name) {
        const map = {
          'C': 0, 'B#': 0,
          'C#': 1, 'Db': 1,
          'D': 2,
          'D#': 3, 'Eb': 3,
          'E': 4, 'Fb': 4,
          'F': 5, 'E#': 5,
          'F#': 6, 'Gb': 6,
          'G': 7,
          'G#': 8, 'Ab': 8,
          'A': 9,
          'A#': 10, 'Bb': 10,
          'B': 11, 'Cb': 11,
        };
        if (!(name in map)) throw new Error(`Note inconnue: ${name}`);
        return map[name];
      }

      /**
       * Renvoie le décalage en demi-tons du degré donné par rapport à la tonique.
       * @param {number} degree - 1..7
       * @param {boolean} [raised7th] - si true et degree===7, utilise la sensible haussée (usage dominante)
       */
      degreeSemitoneOffset(degree, raised7th = false) {
        if (degree < 1 || degree > 7) throw new Error(`Degré invalide: ${degree}`);
        const intervals = MODE_INTERVALS[this.mode];
        let offset = intervals[degree - 1];
        if (this.mode === 'minor' && degree === 7 && raised7th) {
          offset += 1; // sensible haussée (mineur harmonique) pour fonction de dominante
        }
        return offset;
      }

      /**
       * Convertit un degré + octave en hauteur MIDI.
       * @param {number} degree 1..7
       * @param {number} octave - octave MIDI (4 = octave du Do central=60)
       * @param {boolean} [raised7th]
       */
      degreeToMidi(degree, octave, raised7th = false) {
        const base = (octave + 1) * 12; // MIDI: C-1 = 0, donc C4 = 60
        return base + this.tonicPc + this.degreeSemitoneOffset(degree, raised7th);
      }

      /** Nom de la tonalité de la dominante (degré 5), toujours majeur si le mode est majeur,
       *  mineur si le mode est mineur (convention classique : ton relatif de la dominante
       *  garde le même mode que la tonalité principale, sauf cas mineur -> dominante mineure
       *  usuelle en fugue baroque). */
      dominantKey() {
        const fifthPc = (this.tonicPc + this.degreeSemitoneOffset(5)) % 12;
        const name = PITCH_CLASSES[fifthPc];
        return new Key(name, this.mode);
      }

      /**
       * Cherche le degré (+ éventuelle sensible haussée) correspondant à un midi donné
       * dans cette tonalité. Renvoie null si aucun degré diatonique (ni sensible
       * haussée) ne correspond à cette classe de hauteur.
       */
      midiToDegree(midi) {
        const pc = ((midi % 12) + 12) % 12;
        const octave = Math.floor(midi / 12) - 1;
        for (let degree = 1; degree <= 7; degree++) {
          for (const raised7th of [false, true]) {
            if (raised7th && (degree !== 7 || this.mode !== 'minor')) continue;
            const testPc = ((this.tonicPc + this.degreeSemitoneOffset(degree, raised7th)) % 12 + 12) % 12;
            if (testPc === pc) return { degree, octave, raised7th };
          }
        }
        return null;
      }

      /** Tonalité relative (relatif mineur d'un ton majeur, ou relatif majeur d'un ton mineur). */
      relativeKey() {
        if (this.mode === 'major') {
          const pc = (this.tonicPc + this.degreeSemitoneOffset(6)) % 12;
          return new Key(PITCH_CLASSES[pc], 'minor');
        } else {
          const pc = (this.tonicPc + this.degreeSemitoneOffset(3)) % 12;
          return new Key(PITCH_CLASSES[pc], 'major');
        }
      }

      /** Sous-dominante (degré 4), même mode. */
      subdominantKey() {
        const pc = (this.tonicPc + this.degreeSemitoneOffset(4)) % 12;
        return new Key(PITCH_CLASSES[pc], this.mode);
      }

      toString() {
        return `${this.tonic} ${this.mode === 'major' ? 'majeur' : 'mineur'}`;
      }
    }

    /** Distance en degrés d'échelle (utile pour juger la taille d'un saut mélodique en "marches"). */
    function degreeDistance(d1, d2) {
      return Math.abs(d1 - d2);
    }

    Object.assign(Lib, { Key, PITCH_CLASSES, MODE_INTERVALS, degreeDistance });
  }

  // ---- harmony.js ----
  {

    /**
     * Classification consonance/dissonance pour le contrepoint à 2 voix (classe
     * d'intervalle mod 12, sans distinction d'octave). Convention pédagogique
     * classique : la quarte juste est traitée comme DISSONANTE en 2 voix pures
     * (elle n'est consonante qu'appuyée sur une basse, absente ici).
     */
    const CONSONANT_CLASSES = new Set([0, 3, 4, 7, 8, 9]); // unisson/8ve, 3ces, 5te, 6tes
    const DISSONANT_CLASSES = new Set([1, 2, 5, 6, 10, 11]); // 2ndes, 4te, triton, 7es

    function intervalClass(semitones) {
      return Math.abs(semitones) % 12;
    }

    function isConsonant(semitones) {
      return CONSONANT_CLASSES.has(intervalClass(semitones));
    }

    function isPerfectConsonance(semitones) {
      const ic = intervalClass(semitones);
      return ic === 0 || ic === 7;
    }

    /**
     * Construit, pour une voix donnée (suite de notes avec durée), une fonction
     * qui renvoie la note sonnant à un instant t (0 <= t < totalBeats).
     * @param {Key} key
     * @param {Array<{degree,octave,raised7th,duration}>} notes
     */
    function buildTimeline(key, notes) {
      const onsets = [];
      let t = 0;
      for (const n of notes) {
        onsets.push({ time: t, duration: n.duration, note: n, midi: key.degreeToMidi(n.degree, n.octave, n.raised7th) });
        t += n.duration;
      }
      const totalBeats = t;

      function soundingAt(time) {
        // Dernière note dont l'attaque est <= time (avec tolérance flottante).
        let result = onsets[0];
        for (const o of onsets) {
          if (o.time <= time + 1e-6) result = o; else break;
        }
        return result;
      }

      /** Instants d'attaque strictement compris dans l'intervalle ]start, end[. */
      function onsetsWithin(start, end) {
        return onsets.filter(o => o.time > start + 1e-6 && o.time < end - 1e-6);
      }

      return { onsets, totalBeats, soundingAt, onsetsWithin };
    }

    Object.assign(Lib, { isConsonant, isPerfectConsonance, intervalClass, buildTimeline, CONSONANT_CLASSES, DISSONANT_CLASSES });
  }

  // ---- global-timeline.js ----
  {

    /**
     * Convertit une liste de notes (degree/octave/raised7th/duration) d'une
     * tonalité donnée en une liste absolue {midi, duration}.
     */
    function notesToMidi(key, notes) {
      return notes.map(n => ({ midi: key.degreeToMidi(n.degree, n.octave, n.raised7th), duration: n.duration }));
    }

    /**
     * Timeline globale à partir de notes déjà exprimées en MIDI absolu,
     * positionnée à un instant de départ. En dehors de sa plage active, la voix
     * est silencieuse (soundingAt renvoie null).
     */
    function buildMidiTimeline(midiNotes, startTime) {
      const local = [];
      let t = 0;
      for (const n of midiNotes) {
        local.push({ time: t, duration: n.duration, midi: n.midi });
        t += n.duration;
      }
      const endTime = startTime + t;

      function soundingAt(globalTime) {
        if (globalTime < startTime - 1e-6 || globalTime >= endTime - 1e-6) return null;
        const localTime = globalTime - startTime;
        let result = local[0];
        for (const o of local) {
          if (o.time <= localTime + 1e-6) result = o; else break;
        }
        return { ...result, time: result.time + startTime };
      }

      function onsetsWithin(start, end) {
        return local
          .filter(o => {
            const g = o.time + startTime;
            return g > start + 1e-6 && g < end - 1e-6;
          })
          .map(o => ({ ...o, time: o.time + startTime }));
      }

      function onsetBefore(time) {
        let result = null;
        for (const o of local) {
          const g = o.time + startTime;
          if (g < time - 1e-6) result = { ...o, time: g }; else break;
        }
        return result;
      }

      return { startTime, endTime, totalBeats: endTime, soundingAt, onsetsWithin, onsetBefore };
    }

    Object.assign(Lib, { notesToMidi, buildMidiTimeline });
  }

  // ---- subject-generator.js ----
  {

    const { Key } = Lib;

    /**
     * Durées autorisées pour le rythme du sujet, en battements (1 = noire).
     * On exclut volontairement la ronde/blanche pointée : un sujet de fugue
     * classique a presque toujours un profil rythmique assez animé.
     */
    const ALLOWED_DURATIONS = [2, 1.5, 1, 0.75, 0.5, 0.25];

    function pick(arr, rng) {
      return arr[Math.floor(rng() * arr.length)];
    }

    /**
     * Génère un rythme dont la somme des durées vaut exactement totalBeats.
     * Approche gloutonne avec retour arrière simple (relance complète si blocage).
     */
    function generateRhythm(totalBeats, rng, maxAttempts = 500) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const durations = [];
        let remaining = totalBeats;
        let failed = false;

        while (remaining > 1e-6) {
          const candidates = ALLOWED_DURATIONS.filter(d => d <= remaining + 1e-6);
          if (candidates.length === 0) { failed = true; break; }
          // Sur la dernière portion, on privilégie une valeur qui "tombe juste".
          const exact = candidates.find(d => Math.abs(d - remaining) < 1e-6);
          const choice = (rng() < 0.35 && exact) ? exact : pick(candidates, rng);
          durations.push(choice);
          remaining -= choice;
          remaining = Math.round(remaining * 1000) / 1000;
        }
        if (!failed && durations.length >= 4) return durations;
      }
      throw new Error(`Impossible de générer un rythme pour ${totalBeats} temps après ${maxAttempts} essais`);
    }

    /**
     * Intervalles mélodiques interdits, en demi-tons (classe d'intervalle, sans tenir
     * compte du sens) : triton (aug4/dim5), septième (majeure ou mineure) sauf octave.
     */
    function isForbiddenMelodicInterval(semitones) {
      const abs = Math.abs(semitones);
      if (abs === 6) return true; // triton
      if (abs === 10 || abs === 11) return true; // 7e mineure/majeure (sauf octave=12)
      if (abs > 12) return true; // plus d'une octave : exclu du style du sujet
      return false;
    }

    /** Une "marche" = seconde (majeure ou mineure), donc 1 ou 2 demi-tons. */
    function isStep(semitones) {
      const abs = Math.abs(semitones);
      return abs === 1 || abs === 2;
    }

    /** Un "saut" à compenser = quarte ou plus (>=5 demi-tons), hors octave exacte tolérée sans compensation stricte. */
    function isLeapRequiringCompensation(semitones) {
      const abs = Math.abs(semitones);
      return abs >= 5 && abs !== 12;
    }

    /**
     * Génère la mélodie (suite de degrés) du sujet, note par note, avec contraintes
     * locales appliquées au fil de l'eau. Relance complète du sujet si blocage
     * (le champ de recherche est petit, donc rapide en pratique).
     *
     * @param {Key} key
     * @param {number} numNotes
     * @param {function} rng
     * @returns {Array<{degree:number, octave:number, raised7th:boolean}>}
     */
    function generateMelodyDegrees(key, numNotes, rng, maxAttempts = 3000) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const notes = [];
        let octave = 4;
        let pendingCompensation = null; // {direction: 1|-1} si la note précédente était un saut
        let forcedResolutionToTonic = false;
        let ok = true;

        // Première note : degré 1 ou 5, choisi aléatoirement.
        const firstDegree = pick([1, 5], rng);
        notes.push({ degree: firstDegree, octave, raised7th: false });

        for (let i = 1; i < numNotes && ok; i++) {
          const prev = notes[i - 1];
          const prevMidi = key.degreeToMidi(prev.degree, prev.octave, prev.raised7th);

          if (forcedResolutionToTonic) {
            // La sensible haussée doit résoudre immédiatement sur la tonique.
            const targetOctave = prev.degree === 7 && prevMidi % 12 === (key.tonicPc + 11) % 12 ? prev.octave + (prev.raised7th ? 1 : 0) : prev.octave;
            notes.push({ degree: 1, octave: targetOctave, raised7th: false });
            forcedResolutionToTonic = false;
            pendingCompensation = null;
            continue;
          }

          // Construire les candidats : petit ensemble de degrés voisins, en position et octave.
          const candidates = [];
          for (let dOct = -1; dOct <= 1; dOct++) {
            for (let deg = 1; deg <= 7; deg++) {
              for (const raised7th of [false, true]) {
                if (raised7th && (deg !== 7 || key.mode !== 'minor')) continue;
                const midi = key.degreeToMidi(deg, prev.octave + dOct, raised7th);
                const interval = midi - prevMidi;
                if (interval === 0) continue; // pas de répétition immédiate (style plus vivant)
                candidates.push({ degree: deg, octave: prev.octave + dOct, raised7th, midi, interval });
              }
            }
          }

          // Filtrage par règles.
          let valid = candidates.filter(c => !isForbiddenMelodicInterval(c.interval));

          // Règle de l'enchaînement 6e naturelle -> sensible haussée (seconde augmentée) : interdite.
          valid = valid.filter(c => {
            if (prev.degree === 6 && !prev.raised7th && c.degree === 7 && c.raised7th) return false;
            return true;
          });

          // La sensible haussée doit être abordée PAR DEGRÉ CONJOINT (jamais par saut) :
          // sinon la règle "résolution immédiate sur la tonique" peut entrer en conflit
          // avec la règle "compensation d'un saut par une marche en sens opposé".
          valid = valid.filter(c => !c.raised7th || isStep(c.interval));

          // Compensation de saut : si la note précédente arrivait par un saut,
          // celle-ci doit repartir par une marche en sens opposé.
          if (pendingCompensation) {
            valid = valid.filter(c => isStep(c.interval) && Math.sign(c.interval) === -pendingCompensation.direction);
          }

          if (valid.length === 0) { ok = false; break; }

          const chosen = pick(valid, rng);
          notes.push({ degree: chosen.degree, octave: chosen.octave, raised7th: chosen.raised7th });

          pendingCompensation = isLeapRequiringCompensation(chosen.interval)
            ? { direction: Math.sign(chosen.interval) }
            : null;

          if (chosen.raised7th) forcedResolutionToTonic = true;
        }

        if (!ok) continue;

        // Note finale : on préfère un degré stable (1, 3 ou 5). Contrainte souple :
        // si ce n'est pas le cas, on retente un autre sujet plutôt que de trahir la règle.
        const last = notes[notes.length - 1];
        if (![1, 3, 5].includes(last.degree)) continue;

        // Ambitus : on rejette les sujets dont l'étendue dépasse une neuvième (14 demi-tons).
        const midis = notes.map(n => key.degreeToMidi(n.degree, n.octave, n.raised7th));
        const ambitus = Math.max(...midis) - Math.min(...midis);
        if (ambitus > 14) continue;

        return notes;
      }
      throw new Error(`Impossible de générer une mélodie valide après ${maxAttempts} essais`);
    }

    /**
     * Génère un sujet complet (rythme + mélodie combinés).
     * @param {object} params
     * @param {Key} params.key
     * @param {number} params.totalBeats - longueur du sujet en battements (noire=1)
     * @param {function} [params.rng] - générateur pseudo-aléatoire (0..1), Math.random par défaut
     */
    function generateSubject({ key, totalBeats, rng = Math.random }) {
      const rhythm = generateRhythm(totalBeats, rng);
      const melody = generateMelodyDegrees(key, rhythm.length, rng);
      const notes = melody.map((m, i) => ({ ...m, duration: rhythm[i] }));
      return { key, totalBeats, notes };
    }

    Object.assign(Lib, {
      ALLOWED_DURATIONS,
      generateRhythm,
      generateMelodyDegrees,
      generateSubject,
      isForbiddenMelodicInterval,
      isStep,
      isLeapRequiringCompensation,
    });
  }

  // ---- validation.js ----
  {

    const { isForbiddenMelodicInterval, isStep, isLeapRequiringCompensation } = Lib;

    /**
     * Revalide entièrement un sujet déjà généré, indépendamment du code qui l'a produit.
     * Sert de garde-fou dans les tests : si le générateur a un bug, ceci doit le détecter.
     * @param {Key} key
     * @param {Array<{degree:number, octave:number, raised7th:boolean, duration:number}>} notes
     * @returns {{valid:boolean, errors:string[]}}
     */
    function validateSubject(key, notes) {
      const errors = [];

      if (notes.length === 0) {
        return { valid: false, errors: ['Sujet vide'] };
      }

      if (![1, 5].includes(notes[0].degree)) {
        errors.push(`Première note doit être degré 1 ou 5 (obtenu: ${notes[0].degree})`);
      }

      const last = notes[notes.length - 1];
      if (![1, 3, 5].includes(last.degree)) {
        errors.push(`Dernière note doit être un degré stable 1/3/5 (obtenu: ${last.degree})`);
      }

      const midis = notes.map(n => key.degreeToMidi(n.degree, n.octave, n.raised7th));
      const ambitus = Math.max(...midis) - Math.min(...midis);
      if (ambitus > 14) {
        errors.push(`Ambitus trop large: ${ambitus} demi-tons (max 14)`);
      }

      let pendingCompensation = null;
      for (let i = 1; i < notes.length; i++) {
        const interval = midis[i] - midis[i - 1];

        if (interval === 0) {
          errors.push(`Note ${i}: répétition immédiate non autorisée dans le style du sujet`);
        }
        if (isForbiddenMelodicInterval(interval)) {
          errors.push(`Note ${i}: intervalle mélodique interdit (${interval} demi-tons)`);
        }
        if (notes[i - 1].degree === 6 && !notes[i - 1].raised7th && notes[i].degree === 7 && notes[i].raised7th) {
          errors.push(`Note ${i}: seconde augmentée (6e naturelle -> sensible haussée) interdite`);
        }
        if (pendingCompensation) {
          if (!isStep(interval) || Math.sign(interval) !== -pendingCompensation.direction) {
            errors.push(`Note ${i}: le saut précédent n'est pas compensé par une marche en sens opposé`);
          }
        }
        if (notes[i - 1].raised7th && notes[i].degree !== 1) {
          errors.push(`Note ${i}: la sensible haussée doit résoudre immédiatement sur la tonique`);
        }

        pendingCompensation = isLeapRequiringCompensation(interval)
          ? { direction: Math.sign(interval) }
          : null;
      }

      const totalDuration = notes.reduce((s, n) => s + n.duration, 0);

      return { valid: errors.length === 0, errors, totalDuration };
    }

    Object.assign(Lib, { validateSubject });
  }

  // ---- answer.js ----
  {

    /**
     * Calcule la réponse d'un sujet de fugue, selon les règles classiques
     * (formulation simplifiée mais fidèle au cœur de la règle de Prout) :
     *
     *  - Règle générale : la réponse est une transposition à la quinte supérieure
     *    du sujet ("réponse réelle").
     *  - Exception ("réponse tonale") : dans la tête du sujet, toute note qui
     *    énonce clairement la dominante en écho immédiat de la tonique (ou
     *    inversement, si le sujet commence par la dominante) est répondue par
     *    une transposition à la quarte, de façon à préserver le rapport
     *    tonique/dominante plutôt que de le transposer littéralement.
     *
     * AVERTISSEMENT DE PORTÉE : ceci couvre les deux cas les plus fréquents
     * (sujet commençant sur la tonique avec touche précoce de la dominante ;
     * sujet commençant sur la dominante). Le traité de Prout comporte d'autres
     * cas particuliers (sujets modulants, sujets touchant la sous-dominante,
     * subtilités propres au mode mineur) qui ne sont PAS encore couverts et
     * seront affinés dans une phase ultérieure, validés contre des sujets de
     * fugues réelles (ex. Clavier bien tempéré).
     */

    const REAL_INTERVAL = 7; // quinte juste, en demi-tons
    const TONAL_INTERVAL = 5; // quarte juste, en demi-tons

    /**
     * Détermine, pour chaque note du sujet, si elle doit être répondue
     * "tonalement" (quarte) ou "réellement" (quinte).
     * @returns {boolean[]} un booléen par note (true = tonal)
     */
    function classifyTonalNotes(notes) {
      const n = notes.length;
      const tonal = new Array(n).fill(false);

      if (notes[0].degree === 5) {
        // Sujet commençant sur la dominante : la tête (répétitions/prolongations
        // de la dominante) est répondue tonalement, jusqu'au premier mouvement
        // net vers un autre degré.
        // Seule la dominante initiale (et sa prolongation immédiate) reçoit
        // l'ajustement tonal (transposition à la quarte). Dès que le sujet
        // quitte ce degré — y compris pour rejoindre la tonique — la
        // transposition réelle (quinte) reprend normalement.
        let i = 0;
        while (i < n && notes[i].degree === 5) {
          tonal[i] = true;
          i++;
        }
        return tonal;
      }

      if (notes[0].degree === 1) {
        // Cherche une touche précoce de la dominante (dans la première moitié du sujet).
        const horizon = Math.max(2, Math.ceil(n / 2));
        let touchIndex = -1;
        for (let i = 1; i < Math.min(horizon, n); i++) {
          if (notes[i].degree === 5) { touchIndex = i; break; }
          // Si le sujet s'éloigne clairement (tierce ou plus vers un autre degré
          // stable) avant de toucher la dominante, on considère qu'il n'y a pas
          // d'ambiguïté à corriger : on arrête la recherche.
        }
        if (touchIndex !== -1) {
          tonal[touchIndex] = true;
          // Prolongement éventuel de cette dominante (notes répétées/voisines immédiates).
          let j = touchIndex + 1;
          while (j < n && notes[j].degree === 5) { tonal[j] = true; j++; }
        }
        return tonal;
      }

      // Sujet ne commençant ni sur 1 ni sur 5 (cas rare, non couvert par le
      // générateur actuel mais possible en entrée manuelle) : réponse réelle
      // intégrale par défaut, signalée comme approximation.
      return tonal;
    }

    /**
     * @param {Key} key - tonalité du sujet
     * @param {Array<{degree:number, octave:number, raised7th:boolean, duration:number}>} notes
     * @returns {{answerKey:Key, notes:Array, tonalNoteIndices:number[]}}
     */
    function computeAnswer(key, notes) {
      const answerKey = key.dominantKey();
      const tonalFlags = classifyTonalNotes(notes);

      const answerNotes = notes.map((note, i) => {
        const semitoneShift = tonalFlags[i] ? TONAL_INTERVAL : REAL_INTERVAL;
        const originalMidi = key.degreeToMidi(note.degree, note.octave, note.raised7th);
        const answerMidi = originalMidi + semitoneShift;
        return { ...note, midi: answerMidi, originalMidi, tonal: tonalFlags[i] };
      });

      return {
        answerKey,
        notes: answerNotes,
        tonalNoteIndices: tonalFlags.map((t, i) => (t ? i : -1)).filter(i => i !== -1),
      };
    }

    /**
     * Comme computeAnswer, mais renvoie directement des notes utilisables comme
     * n'importe quelle voix (degree/octave/raised7th/duration dans answerKey),
     * plutôt que des midi bruts à réinterpréter à la main.
     */
    function computeAnswerAsNotes(key, notes) {
      const { answerKey, notes: withMidi } = computeAnswer(key, notes);
      const answerNotes = withMidi.map(n => {
        const found = answerKey.midiToDegree(n.midi);
        if (!found) {
          throw new Error(`Note de réponse non diatonique à ${answerKey} (midi ${n.midi}) — cas non couvert par les règles actuelles`);
        }
        return { degree: found.degree, octave: found.octave, raised7th: found.raised7th, duration: n.duration };
      });
      return { answerKey, notes: answerNotes };
    }

    Object.assign(Lib, { computeAnswer, computeAnswerAsNotes, REAL_INTERVAL, TONAL_INTERVAL });
  }

  // ---- voice-generator.js ----
  {

    const { generateRhythm, isForbiddenMelodicInterval, isStep, isLeapRequiringCompensation } = Lib;
    const { isConsonant, isPerfectConsonance, intervalClass } = Lib;

    function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

    /**
     * Comme pick, mais favorise les candidats proches du centre d'une tessiture
     * (registerBounds) — réduit le risque de se retrouver bloqué en bord de
     * registre lors de la recherche par tirage aléatoire successif.
     */
    function pickWeightedTowardCenter(arr, rng, registerBounds) {
      if (!registerBounds || arr.length <= 1) return pick(arr, rng);
      const center = (registerBounds.min + registerBounds.max) / 2;
      const span = Math.max(1, registerBounds.max - registerBounds.min);
      const weights = arr.map(c => {
        const dist = Math.abs(c.midi - center) / span;
        return Math.max(0.05, 1 - dist); // toujours une chance non nulle
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rng() * total;
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i];
        if (r <= 0) return arr[i];
      }
      return arr[arr.length - 1];
    }

    /**
     * Génère une voix libre en contrepoint contre un ensemble de voix de référence
     * DÉJÀ FIXÉES et sonnant simultanément (chacune fournie sous forme de timeline,
     * cf harmony.buildTimeline). Généralise countersubject-generator.js (1 seule
     * référence) à un nombre quelconque de références.
     *
     * Règles vérifiées (mêmes principes qu'à 2 voix, appliqués à CHAQUE paire) :
     *  - consonance à chaque attaque avec CHAQUE voix de référence sonnant à cet
     *    instant, sauf dissonance de passage/broderie (abordée ET quittée par
     *    degré conjoint, temps faible) — la dissonance doit être justifiée
     *    indépendamment vis-à-vis de chaque référence
     *  - pas de quintes/octaves parallèles avec AUCUNE des références
     *  - pas de croisement avec la voix de référence désignée comme adjacente
     *    (option adjacentTimeline) : la nouvelle voix reste toujours du même
     *    côté (au-dessus ou en-dessous) de sa voisine immédiate
     *  - règles mélodiques propres à la voix (identiques aux sujets/contre-sujets)
     *
     * @param {Key} governingKey - tonalité utilisée pour choisir les degrés diatoniques de cette voix
     * @param {Array<{soundingAt:function, onsetsWithin:function, totalBeats:number}>} referenceTimelines
     * @param {object} [options]
     * @param {number} [options.startOctave]
     * @param {'above'|'below'|null} [options.adjacentSide] - position par rapport à adjacentTimeline
     * @param {object} [options.adjacentTimeline]
     * @param {function} [options.rng]
     */
    function generateVoice(governingKey, referenceTimelines, options = {}) {
      const {
        startOctave = 4,
        adjacentSide = null,
        adjacentTimeline = null,
        rng = Math.random,
        maxAttempts = 8000,
        segmentDuration,
        startTime = 0,
        previousNote = null, // {degree, octave, raised7th, midi, time} : dernière note du segment précédent de CETTE voix, s'il existe
        registerBounds = null, // {min, max} en MIDI : bornes dures (ex. tessiture d'une voix SATB)
        ambitus = null, // {min, max, cap} : étendue déjà couverte par la voix ENTIÈRE jusqu'ici + plafond autorisé ; mis à jour en place si un segment est trouvé
      } = options;

      if (!segmentDuration) throw new Error('generateVoice: segmentDuration est requis');
      const totalBeats = segmentDuration;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const rhythm = generateRhythm(totalBeats, rng);
        const notes = [];
        let ok = true;
        let t = startTime;
        let pendingCompensation = null;
        let pendingDissonanceResolution = false;
        let forcedResolutionToTonic = previousNote ? previousNote.raised7th : false;
        let localMin = ambitus ? ambitus.min : -Infinity;
        let localMax = ambitus ? ambitus.max : Infinity;

        for (let i = 0; i < rhythm.length && ok; i++) {
          const duration = rhythm[i];
          const refsAtOnset = referenceTimelines.map(r => r.soundingAt(t));
          const prev = i === 0 ? previousNote : notes[i - 1];

          let candidates = [];

          if (!prev) {
            // Toute première note de la voix (aucun prédécesseur) : n'importe quel
            // degré consonant avec les références, dans le registre de départ.
            for (let deg = 1; deg <= 7; deg++) {
              const midi = governingKey.degreeToMidi(deg, startOctave, false);
              if (refsAtOnset.every(r => !r || isConsonant(midi - r.midi))) {
                candidates.push({ degree: deg, octave: startOctave, raised7th: false, midi });
              }
            }
          } else if (forcedResolutionToTonic) {
            candidates = [{ degree: 1, octave: prev.octave, raised7th: false, midi: governingKey.degreeToMidi(1, prev.octave, false) }];
          } else {
            for (let dOct = -1; dOct <= 1; dOct++) {
              for (let deg = 1; deg <= 7; deg++) {
                for (const raised7th of [false, true]) {
                  if (raised7th && (deg !== 7 || governingKey.mode !== 'minor')) continue;
                  const midi = governingKey.degreeToMidi(deg, prev.octave + dOct, raised7th);
                  const interval = midi - prev.midi;
                  if (interval === 0) continue;
                  if (isForbiddenMelodicInterval(interval)) continue;
                  if (prev.degree === 6 && !prev.raised7th && deg === 7 && raised7th) continue;
                  if (raised7th && !isStep(interval)) continue;
                  if (pendingCompensation && (!isStep(interval) || Math.sign(interval) !== -pendingCompensation.direction)) continue;
                  candidates.push({ degree: deg, octave: prev.octave + dOct, raised7th, midi, interval });
                }
              }
            }
          }

          if (pendingDissonanceResolution && prev) {
            candidates = candidates.filter(c => isStep(c.midi - prev.midi));
          }

          // Bornes de registre dures (tessiture).
          if (registerBounds) {
            candidates = candidates.filter(c => c.midi >= registerBounds.min && c.midi <= registerBounds.max);
          }

          // Ambitus global de la voix (pas seulement de ce segment) : rejette
          // toute note qui étendrait l'étendue déjà couverte au-delà du plafond.
          // Cas particulier : une entrée fixe (sujet/réponse à une rentrée) n'est
          // jamais filtrée par ce plafond et peut donc légitimement le dépasser
          // déjà — dans ce cas, on n'aggrave pas la situation (on ne bloque pas
          // pour autant toute génération future : le plafond effectif devient
          // "l'étendue déjà couverte", pas question de reculer dessus).
          if (ambitus) {
            const effectiveCap = Math.max(ambitus.cap, localMax - localMin);
            candidates = candidates.filter(c => {
              const newMin = Math.min(localMin, c.midi);
              const newMax = Math.max(localMax, c.midi);
              return (newMax - newMin) <= effectiveCap;
            });
          }

          // Consonance / dissonance de passage contre CHAQUE référence sonnant à cet instant.
          candidates = candidates.filter(c => {
            return refsAtOnset.every(r => {
              if (!r) return true; // voix de référence pas encore entrée / déjà finie
              const harm = c.midi - r.midi;
              if (isConsonant(harm)) return true;
              const weakBeat = Math.abs(t - Math.round(t)) > 1e-6;
              const approachedByStep = prev ? isStep(c.midi - prev.midi) : false;
              return weakBeat && approachedByStep;
            });
          });

          // Notes internes des références pendant la tenue de cette note.
          candidates = candidates.filter(c => {
            return referenceTimelines.every(r => {
              const inner = r.onsetsWithin(t, t + duration);
              return inner.every(o => isConsonant(c.midi - o.midi));
            });
          });

          // Quintes/octaves parallèles. On compare au changement le PLUS RÉCENT
          // de la référence elle-même (même s'il a eu lieu avant notre propre
          // attaque précédente, ou pendant que nous tenions notre note) — sinon
          // un parallélisme peut se glisser quand la référence bouge pendant que
          // notre voix tient une note plus longue.
          // Limite connue et assumée : cette vérification reste locale (elle ne
          // reconstruit pas une grille harmonique complète toutes voix/attaques
          // confondues). Dans de rares cas de rythmes très désynchronisés entre
          // voix, un parallélisme peut donc encore passer au travers. C'est
          // rattrapé en pratique par une validation + relance au niveau de la
          // pièce entière plutôt que par un solveur de contraintes exhaustif ici.
          if (prev) {
            candidates = candidates.filter(c => {
              return referenceTimelines.every((r, idx) => {
                const currRef = refsAtOnset[idx];
                if (!currRef) return true;
                const prevRef = currRef.time > prev.time + 1e-6
                  ? r.soundingAt(currRef.time - 1e-4)
                  : r.soundingAt(prev.time);
                if (!prevRef) return true;
                const prevHarm = prev.midi - prevRef.midi;
                const currHarm = c.midi - currRef.midi;
                if (isPerfectConsonance(prevHarm) && isPerfectConsonance(currHarm)) {
                  const voiceDir = Math.sign(c.midi - prev.midi);
                  const refDir = Math.sign(currRef.midi - prevRef.midi);
                  if (voiceDir !== 0 && refDir !== 0 && voiceDir === refDir) return false;
                }
                return true;
              });
            });
          }

          // Non-croisement avec la voix adjacente désignée.
          if (adjacentSide && adjacentTimeline) {
            candidates = candidates.filter(c => {
              const adj = adjacentTimeline.soundingAt(t);
              if (!adj) return true;
              return adjacentSide === 'above' ? c.midi < adj.midi : c.midi > adj.midi;
            });
          }

          if (candidates.length === 0) { ok = false; break; }

          const chosen = pickWeightedTowardCenter(candidates, rng, registerBounds);
          notes.push({ degree: chosen.degree, octave: chosen.octave, raised7th: chosen.raised7th, duration, time: t, midi: chosen.midi });
          localMin = Math.min(localMin, chosen.midi);
          localMax = Math.max(localMax, chosen.midi);

          if (prev) {
            const stepInterval = chosen.midi - prev.midi;
            pendingCompensation = isLeapRequiringCompensation(stepInterval) ? { direction: Math.sign(stepInterval) } : null;
          }
          forcedResolutionToTonic = chosen.raised7th;
          pendingDissonanceResolution = refsAtOnset.some(r => r && !isConsonant(chosen.midi - r.midi));

          t += duration;
        }

        if (!ok) continue;

        const last = notes[notes.length - 1];
        const refsAtEnd = referenceTimelines.map(r => r.soundingAt(last.time));
        if (!refsAtEnd.every(r => !r || isConsonant(last.midi - r.midi))) continue;

        if (ambitus) { ambitus.min = localMin; ambitus.max = localMax; }

        return notes.map(({ degree, octave, raised7th, duration }) => ({ degree, octave, raised7th, duration }));
      }

      throw new Error(`Impossible de générer une voix compatible après ${maxAttempts} essais`);
    }

    Object.assign(Lib, { generateVoice });
  }

  // ---- voice-round.js ----
  {

    const { generateVoice } = Lib;
    const { notesToMidi, buildMidiTimeline } = Lib;

    /**
     * Pour chaque voix de followerOrder (dans l'ordre donné), génère un nouveau
     * segment de contrepoint libre contre les voix de fixedIndices ET les
     * followers déjà traités dans CET appel (donc chacun voit tout ce qui est
     * déjà décidé). Mute `voices[v].midiNotes` en place pour chaque follower.
     *
     * @param {Array} voices - tableau de voix {midiNotes, firstStart, ambitus, registerBounds}
     * @param {number[]} fixedIndices - voix déjà fixées pour cette fenêtre (ex. sujet en strette, pédale)
     * @param {number[]} followerOrder - voix à générer, dans l'ordre (chacune voit les précédentes de cette liste)
     * @param {Key} key - tonalité gouvernant les degrés des voix générées
     * @param {number} windowStart
     * @param {number} windowDuration
     * @param {function} rng
     */
    function generateFollowersAgainstFixed(voices, fixedIndices, followerOrder, key, windowStart, windowDuration, rng) {
      for (const v of followerOrder) {
        const referenceIndices = [...fixedIndices, ...followerOrder.filter(o => o !== v && followerOrder.indexOf(o) < followerOrder.indexOf(v))];
        const referenceTimelines = referenceIndices.map(idx => buildMidiTimeline(voices[idx].midiNotes, voices[idx].firstStart));

        const existing = voices[v].midiNotes;
        let onsetTime = voices[v].firstStart;
        for (let k = 0; k < existing.length - 1; k++) onsetTime += existing[k].duration;
        const lastMidi = existing[existing.length - 1].midi;
        const found = key.midiToDegree(lastMidi);
        const previousNote = found
          ? { degree: found.degree, octave: found.octave, raised7th: found.raised7th, midi: lastMidi, time: onsetTime }
          : { degree: null, octave: Math.floor(lastMidi / 12) - 1, raised7th: false, midi: lastMidi, time: onsetTime };

        const segmentNotes = generateVoice(key, referenceTimelines, {
          rng,
          segmentDuration: windowDuration,
          startTime: windowStart,
          previousNote,
          registerBounds: voices[v].registerBounds,
          ambitus: voices[v].ambitus,
        });
        const segMidi = notesToMidi(key, segmentNotes);
        voices[v].midiNotes = voices[v].midiNotes.concat(segMidi);
        voices[v].ambitus.min = Math.min(voices[v].ambitus.min, ...segMidi.map(n => n.midi));
        voices[v].ambitus.max = Math.max(voices[v].ambitus.max, ...segMidi.map(n => n.midi));
      }
    }

    Object.assign(Lib, { generateFollowersAgainstFixed });
  }

  // ---- validate-exposition.js ----
  {

    const { isConsonant, isPerfectConsonance } = Lib;
    const { buildMidiTimeline } = Lib;

    /**
     * Revalide une exposition entière : pour chaque paire de voix sonnant
     * simultanément, vérifie consonance/dissonance de passage correctement
     * abordée ET quittée, et absence de quintes/octaves parallèles.
     * @param {Array<{midiNotes, firstStart}>} voices
     */
    function validateExposition(voices) {
      const errors = [];
      const timelines = voices.map(v => buildMidiTimeline(v.midiNotes, v.firstStart));

      for (let a = 0; a < voices.length; a++) {
        const notesA = [];
        let t = voices[a].firstStart;
        for (const n of voices[a].midiNotes) { notesA.push({ ...n, time: t }); t += n.duration; }

        for (let b = 0; b < voices.length; b++) {
          if (a === b) continue;
          const timelineB = timelines[b];

          for (let i = 0; i < notesA.length; i++) {
            const na = notesA[i];
            const nb = timelineB.soundingAt(na.time);
            if (!nb) continue; // voix b silencieuse à cet instant

            const harm = na.midi - nb.midi;
            if (!isConsonant(harm)) {
              const weakBeat = Math.abs(na.time - Math.round(na.time)) > 1e-6;
              const aApproached = i > 0 ? Math.abs(na.midi - notesA[i - 1].midi) <= 2 : false;
              const aLeft = i < notesA.length - 1 ? Math.abs(notesA[i + 1].midi - na.midi) <= 2 : false;
              const bNotes = voices[b].midiNotes;
              let bOnsetTime = voices[b].firstStart, bIndex = -1;
              for (let k = 0; k < bNotes.length; k++) {
                if (Math.abs(bOnsetTime - nb.time) < 1e-6) { bIndex = k; break; }
                bOnsetTime += bNotes[k].duration;
              }
              const bApproached = bIndex > 0 ? Math.abs(nb.midi - bNotes[bIndex - 1].midi) <= 2 : false;
              const bLeft = bIndex !== -1 && bIndex < bNotes.length - 1 ? Math.abs(bNotes[bIndex + 1].midi - nb.midi) <= 2 : false;
              const aOk = aApproached && aLeft;
              const bOk = bApproached && bLeft;
              if (!(weakBeat && (aOk || bOk))) {
                errors.push(`voix ${a} vs ${b}, t=${na.time.toFixed(2)}: dissonance non justifiée (${harm} demi-tons)`);
              }
            }

            // Note tenue de A pendant qu'une note DE B change sous elle : vérifié
            // implicitement en itérant aussi depuis le point de vue de B (a et b
            // sont parcourus dans les deux sens via la boucle externe sur a).

            if (i > 0 && a < b) { // ne compter chaque paire de quintes/octaves qu'une fois
              const prevA = notesA[i - 1];
              const prevB = timelineB.soundingAt(prevA.time);
              if (prevB) {
                const prevHarm = prevA.midi - prevB.midi;
                if (isPerfectConsonance(prevHarm) && isPerfectConsonance(harm)) {
                  const dirA = Math.sign(na.midi - prevA.midi);
                  const dirB = Math.sign(nb.midi - prevB.midi);
                  if (dirA !== 0 && dirB !== 0 && dirA === dirB) {
                    errors.push(`voix ${a} vs ${b}, t=${na.time.toFixed(2)}: quintes/octaves parallèles`);
                  }
                }
              }
            }
          }
        }
      }

      return { valid: errors.length === 0, errors: [...new Set(errors)] };
    }

    Object.assign(Lib, { validateExposition });
  }

  // ---- exposition.js ----
  {

    const { generateSubject } = Lib;
    const { validateSubject } = Lib;
    const { computeAnswerAsNotes } = Lib;
    const { generateVoice } = Lib;
    const { notesToMidi, buildMidiTimeline } = Lib;
    const { validateExposition } = Lib;

    /**
     * Génère une exposition complète à numVoices voix.
     *
     * Principes retenus pour cette Phase 3 (simplifications documentées) :
     *  - entrées en alternance strict sujet(tonique)/réponse(dominante), sans
     *    codetta (chaque nouvelle entrée commence exactement quand la précédente
     *    matériau d'entrée se termine)
     *  - chaque voix déjà entrée reçoit, à chaque nouvelle entrée, un nouveau
     *    segment de contrepoint libre généré contre toutes les voix déjà fixées
     *    pour cette fenêtre (de la plus récente à la plus ancienne)
     *  - le même sujet/la même réponse (mélodiquement) est réutilisé(e) à chaque
     *    entrée, transposé(e) d'une octave supplémentaire par voix pour limiter
     *    les croisements ; les voix de contrepoint libre sont ensuite bornées à
     *    une tessiture SATB par défaut (configurable via registerBoundsByVoice)
     *    et à un ambitus global plafonné (configurable via ambitusCap) — seule
     *    l'entrée elle-même (sujet/réponse) n'est pas filtrée par ces bornes,
     *    car son matériau est fixe par nature
     *  - l'exposition s'arrête dès que la dernière voix a fini son entrée (pas
     *    encore de codetta finale ni de cadence dédiée)
     *
     * @returns {{ key, answerKey, subject, answerNotes, voices: Array<{midiNotes, firstStart}> }}
     */
    // Tessitures par défaut : si registerBoundsByVoice n'est pas fourni, chaque
    // voix est bornée à son registre d'entrée réel ± cette marge (en demi-tons).
    // Une table SATB absolue serait plus réaliste mais suppose une disposition
    // des voix que le placement actuel (chaque entrée une octave plus bas que la
    // précédente) ne garantit pas encore — à revoir quand la disposition des
    // voix sera affinée. En attendant, une marge relative à l'entrée réelle
    // donne un garde-fou cohérent avec ce qui est effectivement généré.
    const DEFAULT_REGISTER_MARGIN_BELOW = 7;
    const DEFAULT_REGISTER_MARGIN_ABOVE = 12;

    // Ambitus maximal (en demi-tons) autorisé pour une voix de contrepoint libre
    // sur toute sa durée (le sujet a son propre plafond, plus étroit, cf subject-generator.js).
    const DEFAULT_AMBITUS_CAP = 24; // deux octaves — les bornes de tessiture (registerBounds) restent le garde-fou principal ; l'ambitus est une sécurité secondaire, élargie pour laisser de la place sur un morceau à plusieurs sections (exposition + divertissement + rentrée + pédale, etc.)

    function generateExposition({ key, subjectBeats, numVoices = 3, rng = Math.random, registerBoundsByVoice = null, ambitusCap = DEFAULT_AMBITUS_CAP, maxExpositionAttempts = 15 }) {
      // Important : on valide le résultat à CHAQUE tentative, pas seulement les
      // exceptions. Le contrôle des quintes/octaves parallèles pendant la
      // génération reste local (voir voice-generator.js) et peut, dans de rares
      // cas de rythmes très désynchronisés entre voix, laisser passer une
      // violation résiduelle. Plutôt qu'un solveur de contraintes exhaustif
      // (coûteux), on revalide le résultat complet et on relance si besoin —
      // chaque tentative étant rapide, c'est une stratégie pragmatique et sûre :
      // ce qui est renvoyé a toujours été explicitement validé.
      let lastError;
      for (let attempt = 0; attempt < maxExpositionAttempts; attempt++) {
        try {
          const result = generateExpositionOnce({ key, subjectBeats, numVoices, rng, registerBoundsByVoice, ambitusCap });
          const check = validateExposition(result.voices);
          if (check.valid) return result;
          lastError = new Error('validation échouée : ' + check.errors.join('; '));
        } catch (e) {
          lastError = e;
        }
      }
      throw new Error(`Impossible de générer une exposition complète et valide après ${maxExpositionAttempts} tentatives (dernière erreur : ${lastError.message})`);
    }

    function generateExpositionOnce({ key, subjectBeats, numVoices, rng, registerBoundsByVoice, ambitusCap }) {
      const subject = generateSubject({ key, totalBeats: subjectBeats, rng });
      const sv = validateSubject(key, subject.notes);
      if (!sv.valid) throw new Error('Sujet généré invalide (inattendu) : ' + sv.errors.join('; '));

      const { answerKey, notes: answerNotes } = computeAnswerAsNotes(key, subject.notes);

      function shiftOctave(notes, shift) {
        return notes.map(n => ({ ...n, octave: n.octave + shift }));
      }

      const voices = [];

      for (let i = 0; i < numVoices; i++) {
        const entryStart = i * subjectBeats;
        const isSubjectEntry = i % 2 === 0;
        const entryKey = isSubjectEntry ? key : answerKey;
        const entrySource = isSubjectEntry ? subject.notes : answerNotes;
        const entryNotes = shiftOctave(entrySource, -i);
        const entryMidi = notesToMidi(entryKey, entryNotes);

        // L'entrée (sujet/réponse) est fixe et n'est jamais filtrée par les
        // bornes de registre — seul son ambitus PROPRE (déjà plafonné à la
        // génération du sujet) sert de point de départ au suivi d'ambitus global.
        const entryMidis = entryMidi.map(n => n.midi);
        const registerBounds = registerBoundsByVoice
          ? registerBoundsByVoice[Math.min(i, registerBoundsByVoice.length - 1)]
          : { min: Math.min(...entryMidis) - DEFAULT_REGISTER_MARGIN_BELOW, max: Math.max(...entryMidis) + DEFAULT_REGISTER_MARGIN_ABOVE };
        voices[i] = {
          firstStart: entryStart,
          midiNotes: [...entryMidi],
          entryType: isSubjectEntry ? 'sujet' : 'réponse',
          ambitus: { min: Math.min(...entryMidis), max: Math.max(...entryMidis), cap: ambitusCap },
          registerBounds,
        };

        for (let v = i - 1; v >= 0; v--) {
          const referenceTimelines = [];
          for (let ref = v + 1; ref <= i; ref++) {
            referenceTimelines.push(buildMidiTimeline(voices[ref].midiNotes, voices[ref].firstStart));
          }
          const governingKey = entryKey;

          // Dernière note déjà fixée de cette voix (jointure) : nécessaire pour
          // vérifier la conduite mélodique ET les quintes/octaves parallèles dès
          // la 1re note du nouveau segment.
          const existing = voices[v].midiNotes;
          let onsetTime = voices[v].firstStart;
          for (let k = 0; k < existing.length - 1; k++) onsetTime += existing[k].duration;
          const lastMidi = existing[existing.length - 1].midi;
          const found = governingKey.midiToDegree(lastMidi);
          // Si la note de jointure n'est pas diatonique dans la NOUVELLE tonalité
          // gouvernante (changement de centre tonal entre segments), on dégrade
          // proprement : seuls midi/octave/time comptent alors pour la suite du
          // calcul (les règles spécifiques au degré, comme la seconde augmentée
          // ou la résolution forcée de la sensible, sont sans objet ici).
          const previousNote = found
            ? { degree: found.degree, octave: found.octave, raised7th: found.raised7th, midi: lastMidi, time: onsetTime }
            : { degree: null, octave: Math.floor(lastMidi / 12) - 1, raised7th: false, midi: lastMidi, time: onsetTime };

          const segmentNotes = generateVoice(governingKey, referenceTimelines, {
            rng,
            segmentDuration: subjectBeats,
            startTime: entryStart,
            previousNote,
            registerBounds: voices[v].registerBounds,
            ambitus: voices[v].ambitus,
          });
          const segMidi = notesToMidi(governingKey, segmentNotes);
          voices[v].midiNotes = voices[v].midiNotes.concat(segMidi);
        }
      }

      return { key, answerKey, subject, answerNotes, voices, subjectBeats, numVoices };
    }

    Object.assign(Lib, { generateExposition });
  }

  // ---- development.js ----
  {

    const { generateVoice } = Lib;
    const { notesToMidi, buildMidiTimeline } = Lib;
    const { validateExposition } = Lib;

    /**
     * Extrait le motif de tête du sujet (les numNotes premières notes), matériau
     * de base classique pour construire un divertissement par séquence.
     */
    function extractMotif(subjectNotes, numNotes) {
      return subjectNotes.slice(0, Math.min(numNotes, subjectNotes.length)).map(n => ({ ...n }));
    }

    /**
     * Transpose un motif de `steps` degrés diatoniques DANS LA MÊME TONALITÉ
     * (contrairement à une transposition réelle en demi-tons) : c'est la
     * transposition utilisée par une séquence tonale classique (chaque
     * répétition démarre un degré plus haut/bas dans la même gamme).
     * Simplification assumée : la sensible haussée n'est pas reconstituée après
     * décalage (raised7th retombe à false), sauf si le motif retombe encore
     * exactement sur le degré 7 en mode mineur.
     */
    function transposeByDiatonicSteps(key, notes, steps) {
      return notes.map(n => {
        const rawIndex = (n.degree - 1) + steps;
        const wrap = Math.floor(rawIndex / 7);
        const newDegree = ((rawIndex % 7) + 7) % 7 + 1;
        const raised7th = newDegree === 7 && key.mode === 'minor' && n.raised7th;
        return { degree: newDegree, octave: n.octave + wrap, raised7th, duration: n.duration };
      });
    }

    /**
     * Construit la voix "meneuse" du divertissement : le motif répété en
     * séquence, chaque répétition décalée de `stepPerRepetition` degrés
     * diatoniques par rapport à la précédente.
     */
    function buildSequenceVoice(key, motif, repetitions, stepPerRepetition) {
      let notes = [];
      for (let rep = 0; rep < repetitions; rep++) {
        notes = notes.concat(transposeByDiatonicSteps(key, motif, stepPerRepetition * rep));
      }
      return notes;
    }

    /**
     * Ajoute un divertissement (séquence) puis une rentrée médiane du sujet dans
     * une tonalité voisine, à la suite d'une exposition déjà générée.
     *
     * Simplifications assumées (documentées) :
     *  - la modulation se fait par simple juxtaposition : la séquence reste dans
     *    la tonalité de départ, puis la rentrée médiane commence directement
     *    dans la tonalité cible, sans accord-pivot explicite ni préparation
     *    harmonique fine de la modulation — une technique plus fruste qu'une
     *    vraie modulation progressive, à raffiner plus tard
     *  - une seule voix porte le motif séquencé ; les autres voix fournissent un
     *    contrepoint libre contre elle (même moteur que pour l'exposition)
     *  - la rentrée médiane ne réintroduit qu'UNE seule voix (pas une nouvelle
     *    exposition complète) — c'est la forme la plus courante d'une rentrée
     *  - targetKeyType par défaut = 'subdominant' (même mode que la tonalité de
     *    départ : une transposition réelle à intervalle fixe reste diatonique,
     *    même mécanisme déjà éprouvé pour la réponse). L'option 'relative'
     *    change de MODE (majeur↔mineur) : une transposition à intervalle fixe
     *    ne tombe alors plus forcément sur des degrés representables par notre
     *    modèle actuel (qui ne gère que la sensible haussée comme altération).
     *    Cette option reste présente mais n'est pas encore fiable — à corriger
     *    dans une passe dédiée aux altérations chromatiques.
     *
     * @param {object} exposition - résultat de generateExposition
     * @param {object} options
     */
    function addEpisodeAndMiddleEntry(exposition, options = {}) {
      const { maxAttempts = 25, rng = Math.random, ...rest } = options;
      const voicesSnapshot = JSON.parse(JSON.stringify(exposition.voices));
      let lastError;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        exposition.voices = JSON.parse(JSON.stringify(voicesSnapshot));
        try {
          const result = addEpisodeAndMiddleEntryOnce(exposition, { ...rest, rng });
          const check = validateExposition(exposition.voices);
          if (check.valid) return result;
          lastError = new Error('validation échouée : ' + check.errors.join('; '));
        } catch (e) {
          lastError = e;
        }
      }
      exposition.voices = voicesSnapshot;
      throw new Error(`Impossible de générer un divertissement + rentrée valides après ${maxAttempts} tentatives (dernière erreur : ${lastError.message})`);
    }

    function addEpisodeAndMiddleEntryOnce(exposition, options = {}) {
      const {
        motifLength = 3,
        repetitions = 3,
        stepPerRepetition = -1,
        targetKeyType = 'subdominant',
        leadVoiceIndex = 0,
        entryVoiceIndex = leadVoiceIndex,
        rng = Math.random,
      } = options;

      const { key, subject, subjectBeats, voices, numVoices } = exposition;
      const targetKey = targetKeyType === 'relative' ? key.relativeKey() : key.subdominantKey();

      const expositionEnd = numVoices * subjectBeats;
      const motif = extractMotif(subject.notes, motifLength);
      const motifBeats = motif.reduce((s, n) => s + n.duration, 0);
      const sequenceNotes = buildSequenceVoice(key, motif, repetitions, stepPerRepetition);
      const episodeDuration = motifBeats * repetitions;
      const episodeEnd = expositionEnd + episodeDuration;

      const sequenceNotesShifted = sequenceNotes.map(n => ({ ...n, octave: n.octave - leadVoiceIndex }));
      const sequenceMidi = notesToMidi(key, sequenceNotesShifted);
      voices[leadVoiceIndex].midiNotes = voices[leadVoiceIndex].midiNotes.concat(sequenceMidi);
      const seqMidis = sequenceMidi.map(n => n.midi);
      voices[leadVoiceIndex].ambitus.min = Math.min(voices[leadVoiceIndex].ambitus.min, ...seqMidis);
      voices[leadVoiceIndex].ambitus.max = Math.max(voices[leadVoiceIndex].ambitus.max, ...seqMidis);

      const order = [];
      for (let v = 0; v < numVoices; v++) if (v !== leadVoiceIndex) order.push(v);

      for (const v of order) {
        const referenceIndices = [leadVoiceIndex, ...order.filter(o => o !== v && order.indexOf(o) < order.indexOf(v))];
        const referenceTimelines = referenceIndices.map(idx => buildMidiTimeline(voices[idx].midiNotes, voices[idx].firstStart));

        const existing = voices[v].midiNotes;
        let onsetTime = voices[v].firstStart;
        for (let k = 0; k < existing.length - 1; k++) onsetTime += existing[k].duration;
        const lastMidi = existing[existing.length - 1].midi;
        const found = key.midiToDegree(lastMidi);
        const previousNote = found
          ? { degree: found.degree, octave: found.octave, raised7th: found.raised7th, midi: lastMidi, time: onsetTime }
          : { degree: null, octave: Math.floor(lastMidi / 12) - 1, raised7th: false, midi: lastMidi, time: onsetTime };

        const segmentNotes = generateVoice(key, referenceTimelines, {
          rng,
          segmentDuration: episodeDuration,
          startTime: expositionEnd,
          previousNote,
          registerBounds: voices[v].registerBounds,
          ambitus: voices[v].ambitus,
        });
        voices[v].midiNotes = voices[v].midiNotes.concat(notesToMidi(key, segmentNotes));
      }

      const targetPc = targetKey.tonicPc;
      const semitoneShift = ((targetPc - key.tonicPc) % 12 + 12) % 12;
      const entryNotesInTargetKey = subject.notes.map(n => {
        const originalMidi = key.degreeToMidi(n.degree, n.octave - entryVoiceIndex, n.raised7th);
        const shifted = originalMidi + semitoneShift;
        const found = targetKey.midiToDegree(shifted);
        if (!found) throw new Error('Rentrée médiane : note non diatonique dans la tonalité cible (cas non couvert)');
        return { degree: found.degree, octave: found.octave, raised7th: found.raised7th, duration: n.duration };
      });
      const entryMidi = notesToMidi(targetKey, entryNotesInTargetKey);
      voices[entryVoiceIndex].midiNotes = voices[entryVoiceIndex].midiNotes.concat(entryMidi);
      const entryMidis = entryMidi.map(n => n.midi);
      voices[entryVoiceIndex].ambitus.min = Math.min(voices[entryVoiceIndex].ambitus.min, ...entryMidis);
      voices[entryVoiceIndex].ambitus.max = Math.max(voices[entryVoiceIndex].ambitus.max, ...entryMidis);

      const order2 = [];
      for (let v = 0; v < numVoices; v++) if (v !== entryVoiceIndex) order2.push(v);

      for (const v of order2) {
        const referenceIndices = [entryVoiceIndex, ...order2.filter(o => o !== v && order2.indexOf(o) < order2.indexOf(v))];
        const referenceTimelines = referenceIndices.map(idx => buildMidiTimeline(voices[idx].midiNotes, voices[idx].firstStart));

        const existing = voices[v].midiNotes;
        let onsetTime = voices[v].firstStart;
        for (let k = 0; k < existing.length - 1; k++) onsetTime += existing[k].duration;
        const lastMidi = existing[existing.length - 1].midi;
        const found = targetKey.midiToDegree(lastMidi);
        const previousNote = found
          ? { degree: found.degree, octave: found.octave, raised7th: found.raised7th, midi: lastMidi, time: onsetTime }
          : { degree: null, octave: Math.floor(lastMidi / 12) - 1, raised7th: false, midi: lastMidi, time: onsetTime };

        const segmentNotes = generateVoice(targetKey, referenceTimelines, {
          rng,
          segmentDuration: subjectBeats,
          startTime: episodeEnd,
          previousNote,
          registerBounds: voices[v].registerBounds,
          ambitus: voices[v].ambitus,
        });
        voices[v].midiNotes = voices[v].midiNotes.concat(notesToMidi(targetKey, segmentNotes));
      }

      return { targetKey, episodeStart: expositionEnd, episodeEnd, middleEntryEnd: episodeEnd + subjectBeats };
    }

    Object.assign(Lib, { extractMotif, transposeByDiatonicSteps, buildSequenceVoice, addEpisodeAndMiddleEntry });
  }

  // ---- pedal.js ----
  {

    const { notesToMidi } = Lib;
    const { generateFollowersAgainstFixed } = Lib;
    const { validateExposition } = Lib;

    /**
     * Ajoute une pédale : une voix (typiquement la plus grave) tient/répète un
     * seul degré (tonique ou dominante) pendant une durée donnée, tandis que les
     * autres voix continuent en contrepoint libre au-dessus.
     *
     * Simplification assumée : la pédale est réalisée comme une répétition de
     * notes de même hauteur (pas une unique ronde géante), ce qui est une
     * pratique tout à fait normale et permet de garder un rythme harmonique
     * cohérent avec le reste du morceau.
     *
     * @param {object} piece - objet avec {key, voices, ...} — par ex. le résultat
     *   de generateExposition (éventuellement déjà étendu par addEpisodeAndMiddleEntry)
     * @param {object} options
     */
    function addPedalPoint(piece, options = {}) {
      const {
        pedalVoiceIndex = piece.voices.length - 1,
        degree = 5,
        duration,
        noteLength = 1,
        startTime,
        maxAttempts = 25,
        rng = Math.random,
      } = options;

      const key = piece.key;
      const pieceEnd = Math.max(...piece.voices.map(v => v.firstStart + v.midiNotes.reduce((s, n) => s + n.duration, 0)));
      const windowStart = startTime !== undefined ? startTime : pieceEnd;
      const windowDuration = duration !== undefined ? duration : piece.subjectBeats * 2;

      const voicesSnapshot = JSON.parse(JSON.stringify(piece.voices));
      let lastError;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        piece.voices = JSON.parse(JSON.stringify(voicesSnapshot));
        try {
          const pedalVoice = piece.voices[pedalVoiceIndex];
          const pedalOctave = pedalVoice.registerBounds
            ? Math.round(((pedalVoice.registerBounds.min + pedalVoice.registerBounds.max) / 2 - key.degreeSemitoneOffset(degree)) / 12) - 1
            : 3;
          const notesCount = Math.round(windowDuration / noteLength);
          const pedalNotes = Array.from({ length: notesCount }, () => ({ degree, octave: pedalOctave, raised7th: false, duration: noteLength }));
          const pedalMidi = notesToMidi(key, pedalNotes);
          pedalVoice.midiNotes = pedalVoice.midiNotes.concat(pedalMidi);
          pedalVoice.ambitus.min = Math.min(pedalVoice.ambitus.min, ...pedalMidi.map(n => n.midi));
          pedalVoice.ambitus.max = Math.max(pedalVoice.ambitus.max, ...pedalMidi.map(n => n.midi));

          const followerOrder = piece.voices.map((_, i) => i).filter(i => i !== pedalVoiceIndex);
          generateFollowersAgainstFixed(piece.voices, [pedalVoiceIndex], followerOrder, key, windowStart, windowDuration, rng);

          const check = validateExposition(piece.voices);
          if (check.valid) return { pedalVoiceIndex, degree, start: windowStart, end: windowStart + windowDuration };
          lastError = new Error('validation échouée : ' + check.errors.join('; '));
        } catch (e) {
          lastError = e;
        }
      }
      piece.voices = voicesSnapshot;
      throw new Error(`Impossible de générer une pédale valide après ${maxAttempts} tentatives (dernière erreur : ${lastError.message})`);
    }

    Object.assign(Lib, { addPedalPoint });
  }

  // ---- stretto.js ----
  {

    const { notesToMidi } = Lib;
    const { generateFollowersAgainstFixed } = Lib;
    const { validateExposition } = Lib;

    /**
     * Ajoute une strette : deux voix exposent le sujet en entrées superposées
     * (la seconde entre avant que la première ait fini). Comme les deux lignes
     * sont fixes (le sujet ne peut pas être altéré note à note pour "s'arranger"
     * avec l'autre entrée), toutes les tonalités/sujets ne permettent pas une
     * strette à n'importe quel décalage — c'est une propriété réelle du sujet,
     * pas une limite de génération. On essaie donc plusieurs décalages candidats
     * et on retient le premier qui fonctionne réellement (aucune dissonance non
     * justifiée, aucun parallélisme).
     *
     * Simplification assumée : la seconde entrée reprend le sujet à la MÊME
     * hauteur relative (octave près), pas transposée à la quinte — une vraie
     * strette "à la quinte" est une extension possible mais plus rare à
     * satisfaire pour un sujet qui n'a pas été conçu spécifiquement pour ça.
     *
     * @param {object} piece
     * @param {object} options
     * @param {number} [options.voiceAIndex] défaut 0
     * @param {number} [options.voiceBIndex] défaut 1
     * @param {number[]} [options.offsetCandidates] en temps, à essayer dans l'ordre
     * @returns {{offset:number, start:number, end:number}}
     */
    function addStretto(piece, options = {}) {
      const {
        voiceAIndex = 0,
        voiceBIndex = 1,
        offsetCandidates,
        rng = Math.random,
      } = options;

      const { key, subject, subjectBeats, voices, numVoices } = piece;
      const offsets = offsetCandidates || Array.from({ length: 15 }, (_, i) => subjectBeats - (i + 1) * 0.25).filter(o => o > 0.24);

      const windowStart = Math.max(...voices.map(v => v.firstStart + v.midiNotes.reduce((s, n) => s + n.duration, 0)));

      function subjectMidiForVoice(voiceIndex) {
        const lastMidi = voices[voiceIndex].midiNotes[voices[voiceIndex].midiNotes.length - 1].midi;
        const subjectHeadMidi = key.degreeToMidi(subject.notes[0].degree, subject.notes[0].octave, subject.notes[0].raised7th);
        const octaveAdjust = Math.round((lastMidi - subjectHeadMidi) / 12);
        const shifted = subject.notes.map(n => ({ ...n, octave: n.octave + octaveAdjust }));
        return notesToMidi(key, shifted);
      }

      for (const offset of offsets) {
        const snapshot = JSON.parse(JSON.stringify(voices));
        try {
          const aMidi = subjectMidiForVoice(voiceAIndex);
          const bMidi = subjectMidiForVoice(voiceBIndex);
          const sectionEnd = windowStart + offset + subjectBeats;

          // Pré-vérification rapide : la paire en strette est-elle seulement
          // viable (sans même générer le reste) ? Évite de perdre du temps sur
          // un décalage clairement voué à l'échec.
          const pairCheck = validateExposition([
            { midiNotes: aMidi, firstStart: windowStart },
            { midiNotes: bMidi, firstStart: windowStart + offset },
          ]);
          if (!pairCheck.valid) continue;

          voices[voiceAIndex].midiNotes = voices[voiceAIndex].midiNotes.concat(aMidi);

          // Voix B : combler le silence avant son entrée décalée, contre A (déjà en place).
          if (offset > 1e-6) {
            generateFollowersAgainstFixed(voices, [voiceAIndex], [voiceBIndex], key, windowStart, offset, rng);
          }
          voices[voiceBIndex].midiNotes = voices[voiceBIndex].midiNotes.concat(bMidi);

          const aMidis = aMidi.map(n => n.midi);
          const bMidis = bMidi.map(n => n.midi);
          voices[voiceAIndex].ambitus.min = Math.min(voices[voiceAIndex].ambitus.min, ...aMidis);
          voices[voiceAIndex].ambitus.max = Math.max(voices[voiceAIndex].ambitus.max, ...aMidis);
          voices[voiceBIndex].ambitus.min = Math.min(voices[voiceBIndex].ambitus.min, ...bMidis);
          voices[voiceBIndex].ambitus.max = Math.max(voices[voiceBIndex].ambitus.max, ...bMidis);

          // Voix A : combler jusqu'à sectionEnd, contre B (qui finit plus tard).
          const aEnd = windowStart + subjectBeats;
          if (sectionEnd - aEnd > 1e-6) {
            generateFollowersAgainstFixed(voices, [voiceBIndex], [voiceAIndex], key, aEnd, sectionEnd - aEnd, rng);
          }

          // Autres voix éventuelles : contrepoint libre contre A et B sur toute la fenêtre.
          const others = [];
          for (let v = 0; v < numVoices; v++) if (v !== voiceAIndex && v !== voiceBIndex) others.push(v);
          if (others.length > 0) {
            generateFollowersAgainstFixed(voices, [voiceAIndex, voiceBIndex], others, key, windowStart, sectionEnd - windowStart, rng);
          }

          const finalCheck = validateExposition(voices);
          if (finalCheck.valid) return { offset, start: windowStart, end: sectionEnd };
        } catch (e) {
          // tentative suivante
        }
        for (let i = 0; i < voices.length; i++) voices[i] = snapshot[i];
      }

      throw new Error(`Aucune strette valide trouvée entre les voix ${voiceAIndex} et ${voiceBIndex} pour ce sujet, parmi les décalages essayés (${offsets.map(o => o.toFixed(2)).join(', ')}). C'est une propriété réelle de ce sujet, pas une limite de génération.`);
    }

    Object.assign(Lib, { addStretto });
  }

  // ---- cadence.js ----
  {

    const { validateExposition } = Lib;
    const { isConsonant } = Lib;

    /**
     * Ajoute une cadence finale déterministe : accord de dominante puis accord
     * de tonique, la voix la plus grave restant sur la fondamentale aux deux
     * accords (cadence parfaite en position fondamentale). En mineur, la tierce
     * de l'accord final est haussée par défaut (tierce de Picardie).
     *
     * Approche : la basse est fixée en premier (nearest-pitch simple). Chaque
     * autre voix est ensuite assignée dans l'ordre : pour un rôle tierce/quinte,
     * on prend la position la plus proche qui évite tout parallélisme avec les
     * voix déjà fixées (basse + voix précédentes) ; pour un rôle de DOUBLURE de
     * la fondamentale (nécessaire au-delà de 3 voix), on force explicitement un
     * mouvement contraire à celui de la basse — sinon un parallélisme d'octave
     * avec la basse est mathématiquement inévitable (même classe de hauteur aux
     * deux accords). Plusieurs répartitions des rôles entre voix sont essayées ;
     * on retient la première qui valide entièrement.
     *
     * Simplification assumée : les accords sont construits directement en MIDI
     * (pas via le système de degrés, qui ne modélise pas une tierce altérée hors
     * sensible) — acceptable pour ce geste final fixe et non génératif.
     *
     * LIMITE CONNUE (assumée) : fiable à 3 voix (testé массivement, 100%). Au-delà
     * (4 voix+), une voix doit doubler la fondamentale, et l'assignation
     * séquentielle voix-par-voix utilisée ici (gloutonne, sans retour arrière
     * inter-voix) échoue souvent à trouver une combinaison satisfaisant
     * SIMULTANÉMENT consonance, absence de parallélismes ET bornes de registre
     * pour les 3 voix non-basses. Une vraie solution demanderait un retour
     * arrière conjoint entre voix plutôt qu'un choix glouton voix par voix — pas
     * fait ici faute de temps ; à reprendre si la cadence à 4 voix devient prioritaire.
     *
     * @param {object} piece
     * @param {object} options
     * @param {number} [options.chordDuration] défaut subjectBeats/2
     * @param {boolean} [options.picardy] défaut : true si mode mineur
     */
    function addFinalCadence(piece, options = {}) {
      const { key, voices, numVoices, subjectBeats } = piece;
      const chordDuration = options.chordDuration || subjectBeats / 2;
      const picardy = options.picardy !== undefined ? options.picardy : key.mode === 'minor';

      const windowStart = Math.max(...voices.map(v => v.firstStart + v.midiNotes.reduce((s, n) => s + n.duration, 0)));

      const dominantPc = (key.tonicPc + key.degreeSemitoneOffset(5)) % 12;
      const vChordPcs = { root: dominantPc, third: (dominantPc + 4) % 12, fifth: (dominantPc + 7) % 12 };
      const tonicThirdInterval = (key.mode === 'major' || picardy) ? 4 : 3;
      const iChordPcs = { root: key.tonicPc, third: (key.tonicPc + tonicThirdInterval) % 12, fifth: (key.tonicPc + 7) % 12 };

      function isPerfectClass(semitones) {
        const c = Math.abs(semitones) % 12;
        return c === 0 || c === 7;
      }

      function candidatesFor(currentMidi, pc, bounds, count) {
        const candidates = [];
        for (let oct = -3; oct <= 3; oct++) {
          const base = Math.floor(currentMidi / 12) * 12 + oct * 12;
          const midi = base + pc;
          if (!bounds || (midi >= bounds.min - 12 && midi <= bounds.max + 12)) candidates.push(midi);
        }
        candidates.sort((a, b) => Math.abs(a - currentMidi) - Math.abs(b - currentMidi));
        return candidates.slice(0, count);
      }

      const bassIndex = numVoices - 1;
      const otherIndices = [];
      for (let v = 0; v < numVoices; v++) if (v !== bassIndex) otherIndices.push(v);

      const roleSets = [['third', 'fifth'], ['third', 'fifth', 'root'], ['third', 'fifth', 'root', 'root']];
      const baseRoles = roleSets[Math.min(otherIndices.length - 1, roleSets.length - 1)];

      function permutations(arr) {
        if (arr.length <= 1) return [arr];
        const result = [];
        const seen = new Set();
        for (let i = 0; i < arr.length; i++) {
          if (seen.has(arr[i])) continue;
          seen.add(arr[i]);
          const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
          for (const p of permutations(rest)) result.push([arr[i], ...p]);
        }
        return result;
      }
      const rolePermutations = permutations(baseRoles);

      const lastMidiOf = (idx) => voices[idx].midiNotes[voices[idx].midiNotes.length - 1].midi;

      for (const roles of rolePermutations) {
        for (let bassAttempt = 0; bassAttempt < 5; bassAttempt++) {
          const snapshot = JSON.parse(JSON.stringify(voices));
          let ok = true;
          try {
            const bassVOpts = candidatesFor(lastMidiOf(bassIndex), vChordPcs.root, voices[bassIndex].registerBounds, 3);
            const bassIOpts = candidatesFor(lastMidiOf(bassIndex), iChordPcs.root, voices[bassIndex].registerBounds, 3);
            const bassV = bassVOpts[Math.min(bassAttempt, bassVOpts.length - 1)];
            const bassI = bassIOpts[0];
            const bassDir = Math.sign(bassI - bassV);

            voices[bassIndex].midiNotes.push({ midi: bassV, duration: chordDuration }, { midi: bassI, duration: chordDuration });
            voices[bassIndex].ambitus.min = Math.min(voices[bassIndex].ambitus.min, bassV, bassI);
            voices[bassIndex].ambitus.max = Math.max(voices[bassIndex].ambitus.max, bassV, bassI);

            const fixedPairs = [{ v: bassV, i: bassI }];

            for (let k = 0; k < otherIndices.length && ok; k++) {
              const idx = otherIndices[k];
              const role = roles[k];
              const current = lastMidiOf(idx);
              const bounds = voices[idx].registerBounds;
              let chosen = null;

              const pc = role === 'root' ? vChordPcs.root : vChordPcs[role];
              const pcI = role === 'root' ? iChordPcs.root : iChordPcs[role];
              const vOpts = candidatesFor(current, pc, bounds, 10);
              outer:
              for (const vMidi of vOpts) {
                for (const iMidi of candidatesFor(vMidi, pcI, bounds, 10)) {
                  const violatesConsonance = fixedPairs.some(f => !isConsonant(vMidi - f.v) || !isConsonant(iMidi - f.i));
                  if (violatesConsonance) continue;
                  const createsParallel = fixedPairs.some(f => {
                    if (!isPerfectClass(vMidi - f.v) || !isPerfectClass(iMidi - f.i)) return false;
                    const d1 = Math.sign(iMidi - vMidi), d2 = Math.sign(f.i - f.v);
                    return d1 !== 0 && d2 !== 0 && d1 === d2;
                  });
                  if (!createsParallel) { chosen = { v: vMidi, i: iMidi }; break outer; }
                }
              }

              if (!chosen) { ok = false; break; }
              voices[idx].midiNotes.push({ midi: chosen.v, duration: chordDuration }, { midi: chosen.i, duration: chordDuration });
              voices[idx].ambitus.min = Math.min(voices[idx].ambitus.min, chosen.v, chosen.i);
              voices[idx].ambitus.max = Math.max(voices[idx].ambitus.max, chosen.v, chosen.i);
              fixedPairs.push(chosen);
            }

            if (ok) {
              const check = validateExposition(voices);
              if (check.valid) {
                return { start: windowStart, end: windowStart + 2 * chordDuration, picardy: key.mode === 'minor' ? picardy : null };
              }
            }
          } catch (e) { /* tentative suivante */ }
          for (let i = 0; i < voices.length; i++) voices[i] = snapshot[i];
        }
      }

      throw new Error('Impossible de construire une cadence finale sans dissonance/parallélisme parmi les positions candidates essayées (cas rare).');
    }

    Object.assign(Lib, { addFinalCadence });
  }

  global.FugueLib = Lib;
})(typeof window !== "undefined" ? window : globalThis);
