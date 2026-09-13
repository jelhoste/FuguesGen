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

function renderAndPreparePlayback(container, piece, tuneIndex) {
  container.innerHTML = '';
  const abcText = pieceToAbc(piece, tuneIndex);
  console.log('--- ABC généré ---\n' + abcText);

  const staffwidth = Math.max(320, container.parentElement.clientWidth - 40);
  const warnings = [];
  const visualObjs = ABCJS.renderAbc(container, abcText, {
    responsive: 'resize',
    staffwidth,
    wrap: {
      minSpacing: 1.8,
      maxSpacing: 2.7,
      preferredMeasuresPerLine: 4,
      lastLineLimit: 1,
    },
    add_classes: true,
  }, {}, { warningCallback: (w) => warnings.push(w) });

  if (warnings.length > 0) console.warn('Avertissements abcjs :', warnings);
  if (!visualObjs || !visualObjs[0] || container.children.length === 0) {
    throw new Error('abcjs n\'a produit aucun rendu visible (voir la console pour le texte ABC et les avertissements).');
  }
  return { visualObj: visualObjs[0], abcText };
}

async function stopPlayback() {
  if (currentSynthController) {
    try { await currentSynthController.stop(); } catch (e) { /* ignore */ }
    currentSynthController = null;
  }
}

async function playPiece(visualObj, bpm) {
  await stopPlayback();
  if (!ABCJS.synth.supportsAudio()) {
    throw new Error("ce navigateur ne supporte pas la lecture audio Web Audio.");
  }
  const msPerMeasure = 240000 / (bpm || 110); // 4 temps par mesure (M:4/4)
  const synth = new ABCJS.synth.CreateSynth();
  await synth.init({
    visualObj,
    millisecondsPerMeasure: msPerMeasure,
    options: {},
  });
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
  generateBatch: document.getElementById('generate-batch'),
  batchCount: document.getElementById('batch-count'),
  batchControls: document.getElementById('batch-controls'),
  pieceSelector: document.getElementById('piece-selector'),
  downloadAbc: document.getElementById('download-abc'),
  play: document.getElementById('play'),
  tempo: document.getElementById('tempo'),
  tempoValue: document.getElementById('tempo-value'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  structure: document.getElementById('structure'),
  score: document.getElementById('score'),
};

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
  const rendered = renderAndPreparePlayback(els.score, piece, tuneIndex);
  lastVisualObj = rendered.visualObj;
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
  stopPlayback();
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
  stopPlayback();
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
  stopPlayback();
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
    await playPiece(lastVisualObj, parseInt(els.tempo.value, 10));
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
