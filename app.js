'use strict';

const NOTE_LETTERS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const NOTE_ACCIDENTALS = ['', '^', '', '^', '', '', '^', '', '^', '', '^', ''];

/** Convertit un MIDI en jeton de hauteur ABC (lettre + altération + marques d'octave). */
function midiToAbcPitch(midi) {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octaveNum = Math.floor(m / 12) - 1; // 4 = octave du Do central (MIDI 60)
  let letter = NOTE_LETTERS[pc];
  const accidental = NOTE_ACCIDENTALS[pc];
  let marks = '';
  if (octaveNum >= 5) {
    letter = letter.toLowerCase();
    marks = "'".repeat(octaveNum - 5);
  } else if (octaveNum < 4) {
    marks = ','.repeat(4 - octaveNum);
  }
  return accidental + letter + marks;
}

/** Multiplicateur de durée ABC pour une unité de note = double-croche (L:1/16). */
function beatsToAbcLength(beats) {
  return Math.max(1, Math.round(beats * 4));
}

function noteName(midi) {
  const names = ['Do', 'Do#', 'Ré', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'Sib', 'Si'];
  return names[((Math.round(midi) % 12) + 12) % 12];
}

/** Convertit une séquence {midi,duration} en jetons ABC (notes/silences + barres de mesure, M:4/4). */
function notesToAbcTokens(midiNotes, leadingRestBeats) {
  const tokens = [];
  let beatsSinceBar = 0;

  function pushDuration(beats, tokenBuilder) {
    let remaining = beats;
    while (remaining > 1e-6) {
      const room = 4 - beatsSinceBar;
      const chunk = Math.min(remaining, room);
      tokens.push(tokenBuilder(chunk));
      beatsSinceBar += chunk;
      remaining -= chunk;
      if (beatsSinceBar >= 4 - 1e-6) {
        tokens.push('|');
        beatsSinceBar = 0;
      }
    }
  }

  if (leadingRestBeats > 1e-6) {
    pushDuration(leadingRestBeats, (chunk) => `z${beatsToAbcLength(chunk)}`);
  }
  for (const n of midiNotes) {
    const pitch = midiToAbcPitch(n.midi);
    pushDuration(n.duration, (chunk) => `${pitch}${beatsToAbcLength(chunk)}`);
  }
  if (tokens[tokens.length - 1] === '|') tokens.pop();
  tokens.push('|]');
  return tokens.join(' ');
}

// ---------- Génération (fugue complète) ----------

function attemptFullPiece(params) {
  const key = new FugueLib.Key(params.tonic, params.mode);
  const exp = FugueLib.generateExposition({ key, subjectBeats: params.subjectBeats, numVoices: params.numVoices });
  const structure = [];
  structure.push({ label: 'Exposition', start: 0, end: params.numVoices * params.subjectBeats });

  if (params.development) {
    const dev = FugueLib.addEpisodeAndMiddleEntry(exp, {});
    structure.push({ label: `Divertissement`, start: dev.episodeStart, end: dev.episodeEnd });
    structure.push({ label: `Rentrée (${dev.targetKey.toString()})`, start: dev.episodeEnd, end: dev.middleEntryEnd });
  }

  let strettoInfo = null;
  if (params.stretto) {
    try {
      const s = FugueLib.addStretto(exp, {});
      strettoInfo = { ok: true, ...s };
      structure.push({ label: `Strette (décalage ${s.offset.toFixed(2)}t)`, start: s.start, end: s.end });
    } catch (e) {
      strettoInfo = { ok: false, message: e.message };
    }
  }

  if (params.pedal) {
    const p = FugueLib.addPedalPoint(exp, {});
    structure.push({ label: `Pédale (${p.degree === 5 ? 'dominante' : 'tonique'}, voix ${p.pedalVoiceIndex + 1})`, start: p.start, end: p.end });
  }

  let cadenceOk = true;
  if (params.cadence) {
    try {
      const c = FugueLib.addFinalCadence(exp, {});
      structure.push({ label: 'Cadence finale' + (c.picardy ? ' (tierce de Picardie)' : ''), start: c.start, end: c.end });
    } catch (e) {
      cadenceOk = false;
    }
  }

  const check = FugueLib.validateExposition(exp.voices);
  if (!check.valid) throw new Error('validation échouée : ' + check.errors.join('; '));

  return { exp, structure, strettoInfo, cadenceOk, key };
}

function generateFullPiece(params, maxAttempts) {
  let lastError;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return attemptFullPiece(params);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('échec inconnu');
}

function pieceToAbc(piece, tuneIndex) {
  const lines = [
    `X:${tuneIndex || 1}`,
    `T:Fugue en ${piece.key.toString()}`,
    'M:4/4',
    'L:1/16',
    'K:C', // pas d'armure : toutes les altérations sont écrites explicitement note par note
  ];
  piece.exp.voices.forEach((voiceData, idx) => {
    lines.push(`V:${idx + 1} clef=${idx === piece.exp.voices.length - 1 ? 'bass' : 'treble'} name="Voix ${idx + 1}"`);
    lines.push(notesToAbcTokens(voiceData.midiNotes, voiceData.firstStart));
  });
  return lines.join('\n');
}

// ---------- Génération (sujet seul) ----------

function generateSubjectOnly(params) {
  const key = new FugueLib.Key(params.tonic, params.mode);
  let lastError;
  for (let i = 0; i < 10; i++) {
    try {
      const subject = FugueLib.generateSubject({ key, totalBeats: params.subjectBeats });
      const check = FugueLib.validateSubject(key, subject.notes);
      if (!check.valid) throw new Error('sujet invalide (inattendu) : ' + check.errors.join('; '));
      const midiNotes = FugueLib.notesToMidi(key, subject.notes);
      return { key, midiNotes };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('échec inconnu');
}

function subjectToAbc(key, midiNotes, tuneIndex) {
  const lines = [
    `X:${tuneIndex || 1}`,
    `T:Sujet en ${key.toString()}`,
    'M:4/4',
    'L:1/16',
    'K:C',
    notesToAbcTokens(midiNotes, 0),
  ];
  return lines.join('\n');
}

// ---------- Rendu (abcjs) ----------

function renderAbcToContainer(container, abcText, options) {
  container.innerHTML = '';
  console.log('--- ABC généré ---\n' + abcText);

  const staffwidth = Math.max(280, container.parentElement.clientWidth - 36);
  const warnings = [];
  const visualObjs = ABCJS.renderAbc(container, abcText, {
    responsive: 'resize',
    staffwidth,
    scale: (options && options.scale) || 0.78,
    wrap: {
      minSpacing: 1.8,
      maxSpacing: 2.7,
      preferredMeasuresPerLine: (options && options.measuresPerLine) || 4,
      lastLineLimit: 1,
    },
    add_classes: true,
  }, {}, { warningCallback: (w) => warnings.push(w) });

  if (warnings.length > 0) console.warn('Avertissements abcjs :', warnings);
  if (!visualObjs || !visualObjs[0] || container.children.length === 0) {
    throw new Error('abcjs n\'a produit aucun rendu visible (voir la console pour le texte ABC et les avertissements).');
  }
  return visualObjs[0];
}

// ---------- Lecture (abcjs synth), avec bouton Stop ----------

function createPlayer(playBtn, stopBtn) {
  let synth = null;

  async function stop() {
    if (synth) {
      try { await synth.stop(); } catch (e) { /* ignore */ }
      synth = null;
    }
    stopBtn.disabled = true;
  }

  async function play(visualObj, bpm) {
    await stop();
    if (!ABCJS.synth.supportsAudio()) {
      throw new Error("ce navigateur ne supporte pas la lecture audio Web Audio.");
    }
    const msPerMeasure = 240000 / (bpm || 110); // 4 temps par mesure (M:4/4)
    const s = new ABCJS.synth.CreateSynth();
    await s.init({ visualObj, millisecondsPerMeasure: msPerMeasure, options: {} });
    await s.prime();
    s.start();
    synth = s;
    stopBtn.disabled = false;
  }

  stopBtn.addEventListener('click', () => stop());
  return { play, stop };
}

// ---------- Interface : fugue complète ----------

const els = {
  tonic: document.getElementById('tonic'),
  mode: document.getElementById('mode'),
  voices: document.getElementById('voices'),
  subjectBeats: document.getElementById('subjectBeats'),
  development: document.getElementById('opt-development'),
  pedal: document.getElementById('opt-pedal'),
  stretto: document.getElementById('opt-stretto'),
  cadence: document.getElementById('opt-cadence'),
  generate: document.getElementById('generate'),
  generateBatch: document.getElementById('generate-batch'),
  batchCount: document.getElementById('batch-count'),
  batchControls: document.getElementById('batch-controls'),
  pieceSelector: document.getElementById('piece-selector'),
  downloadAbc: document.getElementById('download-abc'),
  play: document.getElementById('play'),
  stop: document.getElementById('stop'),
  tempo: document.getElementById('tempo'),
  tempoValue: document.getElementById('tempo-value'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  structure: document.getElementById('structure'),
  score: document.getElementById('score'),
};

const mainPlayer = createPlayer(els.play, els.stop);
let lastVisualObj = null;
let batch = []; // [{ piece, params }]

function currentParams() {
  return {
    tonic: els.tonic.value,
    mode: els.mode.value,
    numVoices: parseInt(els.voices.value, 10),
    subjectBeats: parseInt(els.subjectBeats.value, 10),
    development: els.development.checked,
    pedal: els.pedal.checked,
    stretto: els.stretto.checked,
    cadence: els.cadence.checked,
  };
}

function renderStructure(el, piece, params) {
  const rows = piece.structure.map(s => `<div><b>${s.label}</b> — t=${s.start.toFixed(2)} à t=${s.end.toFixed(2)}</div>`);
  if (params.stretto && piece.strettoInfo && !piece.strettoInfo.ok) {
    rows.push(`<div>Strette : aucun décalage viable trouvé pour ce sujet (propriété réelle du sujet, réessayez pour en générer un nouveau)</div>`);
  }
  if (params.cadence && !piece.cadenceOk) {
    rows.push(`<div>Cadence finale : non trouvée pour cette disposition de voix (cas rare, réessayez)</div>`);
  }
  const subjectDesc = piece.exp.subject.notes.map(n => noteName(piece.key.degreeToMidi(n.degree, n.octave, n.raised7th))).join(' – ');
  el.innerHTML = `<div><b>Tonalité</b> — ${piece.key.toString()}</div><div><b>Sujet</b> — ${subjectDesc}</div>` + rows.join('');
}

function showPiece(piece, params, tuneIndex) {
  renderStructure(els.structure, piece, params);
  lastVisualObj = renderAbcToContainer(els.score, pieceToAbc(piece, tuneIndex));
  els.result.hidden = false;
  els.play.disabled = false;
}

els.generate.addEventListener('click', () => {
  const params = currentParams();
  batch = [];
  els.batchControls.hidden = true;

  els.generate.disabled = true;
  els.generateBatch.disabled = true;
  els.play.disabled = true;
  mainPlayer.stop();
  els.status.className = '';
  els.status.textContent = 'Génération en cours…';

  setTimeout(() => {
    try {
      const piece = generateFullPiece(params, 20);
      showPiece(piece, params, 1);
      els.status.textContent = 'Fugue générée.';
    } catch (e) {
      els.status.className = 'error';
      els.status.textContent = 'Échec de génération après plusieurs tentatives : ' + e.message;
    } finally {
      els.generate.disabled = false;
      els.generateBatch.disabled = false;
    }
  }, 20);
});

els.generateBatch.addEventListener('click', async () => {
  const params = currentParams();
  const count = Math.max(2, Math.min(20, parseInt(els.batchCount.value, 10) || 5));

  els.generate.disabled = true;
  els.generateBatch.disabled = true;
  els.play.disabled = true;
  mainPlayer.stop();
  els.status.className = '';
  els.status.textContent = `Génération du recueil (0/${count})…`;

  const newBatch = [];
  let failures = 0;
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0)); // laisse l'interface se repeindre
    try {
      newBatch.push({ piece: generateFullPiece(params, 20), params });
    } catch (e) {
      failures++;
    }
    els.status.textContent = `Génération du recueil (${i + 1}/${count})…`;
  }

  batch = newBatch;
  if (batch.length === 0) {
    els.status.className = 'error';
    els.status.textContent = 'Aucune fugue du recueil n\'a pu être générée, réessayez.';
    els.generate.disabled = false;
    els.generateBatch.disabled = false;
    return;
  }

  els.pieceSelector.innerHTML = batch.map((_, i) => `<option value="${i}">Fugue ${i + 1}</option>`).join('');
  els.batchControls.hidden = false;
  showPiece(batch[0].piece, batch[0].params, 1);
  els.status.textContent = failures > 0
    ? `Recueil généré : ${batch.length}/${count} fugues (${failures} échec(s), réessayez le recueil si besoin).`
    : `Recueil de ${batch.length} fugues généré.`;
  els.generate.disabled = false;
  els.generateBatch.disabled = false;
});

els.pieceSelector.addEventListener('change', () => {
  const idx = parseInt(els.pieceSelector.value, 10);
  const entry = batch[idx];
  if (!entry) return;
  mainPlayer.stop();
  showPiece(entry.piece, entry.params, idx + 1);
});

els.downloadAbc.addEventListener('click', () => {
  if (batch.length === 0) return;
  const combined = batch.map((entry, i) => pieceToAbc(entry.piece, i + 1)).join('\n\n');
  const blob = new Blob([combined], { type: 'text/vnd.abc' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'recueil-de-fugues.abc';
  a.click();
  URL.revokeObjectURL(url);
});

els.tempo.addEventListener('input', () => {
  els.tempoValue.textContent = `${els.tempo.value} noires/min`;
});

els.play.addEventListener('click', async () => {
  if (!lastVisualObj) return;
  els.play.disabled = true;
  try {
    await mainPlayer.play(lastVisualObj, parseInt(els.tempo.value, 10));
  } catch (e) {
    els.status.className = 'error';
    els.status.textContent = 'Lecture impossible : ' + e.message;
  } finally {
    els.play.disabled = false;
  }
});

// ---------- Interface : atelier du sujet ----------

const subjEls = {
  tonic: document.getElementById('subj-tonic'),
  mode: document.getElementById('subj-mode'),
  beats: document.getElementById('subj-beats'),
  generate: document.getElementById('subj-generate'),
  status: document.getElementById('subj-status'),
  result: document.getElementById('subj-result'),
  score: document.getElementById('subj-score'),
  abc: document.getElementById('subj-abc'),
  update: document.getElementById('subj-update'),
  play: document.getElementById('subj-play'),
  stop: document.getElementById('subj-stop'),
};

const subjPlayer = createPlayer(subjEls.play, subjEls.stop);
let subjVisualObj = null;

subjEls.generate.addEventListener('click', () => {
  const params = {
    tonic: subjEls.tonic.value,
    mode: subjEls.mode.value,
    subjectBeats: parseInt(subjEls.beats.value, 10),
  };
  subjEls.generate.disabled = true;
  subjPlayer.stop();
  subjEls.status.className = '';
  subjEls.status.textContent = 'Génération…';

  setTimeout(() => {
    try {
      const { key, midiNotes } = generateSubjectOnly(params);
      const abcText = subjectToAbc(key, midiNotes, 1);
      subjEls.abc.value = abcText;
      subjVisualObj = renderAbcToContainer(subjEls.score, abcText, { scale: 1, measuresPerLine: 8 });
      subjEls.result.hidden = false;
      subjEls.play.disabled = false;
      subjEls.status.textContent = 'Sujet généré.';
    } catch (e) {
      subjEls.status.className = 'error';
      subjEls.status.textContent = 'Échec : ' + e.message;
    } finally {
      subjEls.generate.disabled = false;
    }
  }, 20);
});

subjEls.update.addEventListener('click', () => {
  subjPlayer.stop();
  subjEls.status.className = '';
  try {
    subjVisualObj = renderAbcToContainer(subjEls.score, subjEls.abc.value, { scale: 1, measuresPerLine: 8 });
    subjEls.play.disabled = false;
    subjEls.status.textContent = 'Aperçu mis à jour.';
  } catch (e) {
    subjEls.status.className = 'error';
    subjEls.status.textContent = 'Notation ABC invalide : ' + e.message;
    subjEls.play.disabled = true;
  }
});

subjEls.play.addEventListener('click', async () => {
  if (!subjVisualObj) return;
  subjEls.play.disabled = true;
  try {
    await subjPlayer.play(subjVisualObj, 100);
  } catch (e) {
    subjEls.status.className = 'error';
    subjEls.status.textContent = 'Lecture impossible : ' + e.message;
  } finally {
    subjEls.play.disabled = false;
  }
});

// ---------- Service worker ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
