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

// ---------- Génération ----------

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

// ---------- Conversion vers ABC notation ----------

function pieceToAbc(piece) {
  const lines = [
    'X:1',
    `T:Fugue en ${piece.key.toString()}`,
    'M:4/4',
    'L:1/16',
    'K:C', // pas d'armure : toutes les altérations sont écrites explicitement note par note
  ];

  piece.exp.voices.forEach((voiceData, idx) => {
    lines.push(`V:${idx + 1} clef=${idx === piece.exp.voices.length - 1 ? 'bass' : 'treble'} name="Voix ${idx + 1}"`);

    const tokens = [];
    let beatsSinceBar = 0;

    function pushDuration(beats, tokenBuilder) {
      // Découpe une durée en morceaux qui ne dépassent jamais une mesure
      // (4 temps), pour insérer les barres de mesure au bon endroit.
      let remaining = beats;
      let first = true;
      while (remaining > 1e-6) {
        const room = 4 - beatsSinceBar;
        const chunk = Math.min(remaining, room);
        tokens.push(tokenBuilder(chunk, first));
        beatsSinceBar += chunk;
        remaining -= chunk;
        first = false;
        if (beatsSinceBar >= 4 - 1e-6) {
          tokens.push('|');
          beatsSinceBar = 0;
        }
      }
    }

    if (voiceData.firstStart > 1e-6) {
      pushDuration(voiceData.firstStart, (chunk) => `z${beatsToAbcLength(chunk)}`);
    }
    for (const n of voiceData.midiNotes) {
      const pitch = midiToAbcPitch(n.midi);
      pushDuration(n.duration, (chunk) => `${pitch}${beatsToAbcLength(chunk)}`);
    }
    if (tokens[tokens.length - 1] === '|') tokens.pop();
    tokens.push('|]');

    lines.push(tokens.join(' '));
  });

  return lines.join('\n');
}

// ---------- Rendu + lecture (abcjs) ----------

let currentSynthController = null;

function renderAndPreparePlayback(container, piece) {
  container.innerHTML = '';
  const abcText = pieceToAbc(piece);
  console.log('--- ABC généré ---\n' + abcText);

  const warnings = [];
  const visualObjs = ABCJS.renderAbc(container, abcText, {
    staffwidth: 740,
    add_classes: true,
  }, {}, { warningCallback: (w) => warnings.push(w) });

  if (warnings.length > 0) console.warn('Avertissements abcjs :', warnings);
  if (!visualObjs || !visualObjs[0] || container.children.length === 0) {
    throw new Error('abcjs n\'a produit aucun rendu visible (voir la console pour le texte ABC et les avertissements).');
  }
  return visualObjs[0];
}

async function stopPlayback() {
  if (currentSynthController) {
    try { await currentSynthController.stop(); } catch (e) { /* ignore */ }
    currentSynthController = null;
  }
}

async function playPiece(visualObj) {
  await stopPlayback();
  if (!ABCJS.synth.supportsAudio()) {
    throw new Error("ce navigateur ne supporte pas la lecture audio Web Audio.");
  }
  const synth = new ABCJS.synth.CreateSynth();
  await synth.init({ visualObj });
  await synth.prime();
  synth.start();
  currentSynthController = synth;
}

// ---------- Interface ----------

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
  play: document.getElementById('play'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  structure: document.getElementById('structure'),
  score: document.getElementById('score'),
};

let lastVisualObj = null;

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

els.generate.addEventListener('click', () => {
  const params = {
    tonic: els.tonic.value,
    mode: els.mode.value,
    numVoices: parseInt(els.voices.value, 10),
    subjectBeats: parseInt(els.subjectBeats.value, 10),
    development: els.development.checked,
    pedal: els.pedal.checked,
    stretto: els.stretto.checked,
    cadence: els.cadence.checked,
  };

  els.generate.disabled = true;
  els.play.disabled = true;
  stopPlayback();
  els.status.className = '';
  els.status.textContent = 'Génération en cours…';

  setTimeout(() => {
    try {
      const piece = generateFullPiece(params, 20);
      renderStructure(els.structure, piece, params);
      lastVisualObj = renderAndPreparePlayback(els.score, piece);
      els.result.hidden = false;
      els.status.textContent = 'Fugue générée.';
      els.play.disabled = false;
    } catch (e) {
      els.status.className = 'error';
      els.status.textContent = 'Échec de génération après plusieurs tentatives : ' + e.message;
    } finally {
      els.generate.disabled = false;
    }
  }, 20);
});

els.play.addEventListener('click', async () => {
  if (!lastVisualObj) return;
  els.play.disabled = true;
  try {
    await playPiece(lastVisualObj);
  } catch (e) {
    els.status.className = 'error';
    els.status.textContent = 'Lecture impossible : ' + e.message;
  } finally {
    els.play.disabled = false;
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
