'use strict';

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

function midiToVexKey(midi) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return { key: `${NOTE_NAMES[pc]}/${octave}`, sharp: NOTE_NAMES[pc].includes('#') };
}

/** Convertit une durée en temps (noire=1) vers un code de durée VexFlow (avec point si besoin). */
function beatsToVexDuration(beats) {
  const table = [[4, 'w'], [3, 'hd'], [2, 'h'], [1.5, 'qd'], [1, 'q'], [0.75, '8d'], [0.5, '8'], [0.375, '16d'], [0.25, '16']];
  for (const [val, code] of table) if (Math.abs(val - beats) < 1e-6) return code;
  // Fallback : la valeur la plus proche dans la table.
  let best = table[0];
  for (const t of table) if (Math.abs(t[0] - beats) < Math.abs(best[0] - beats)) best = t;
  return best[1];
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

// ---------- Rendu VexFlow ----------

function renderScore(container, piece) {
  container.innerHTML = '';
  const labelsContainer = container.parentElement;
  labelsContainer.querySelectorAll('.voice-label').forEach(el => el.remove());

  const width = Math.max(900, piece.exp.voices[0].midiNotes.reduce((s, n) => s + n.duration, 0) * 45);
  const staveHeight = 110;
  const { Renderer, Stave, StaveNote, Voice, Formatter, Dot, Accidental } = Vex.Flow;
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width, staveHeight * piece.exp.voices.length + 30);
  const context = renderer.getContext();

  piece.exp.voices.forEach((voiceData, idx) => {
    const label = document.createElement('div');
    label.className = 'voice-label';
    label.textContent = `Voix ${idx + 1}`;
    container.before(label);
  });

  let y = 10;
  piece.exp.voices.forEach((voiceData, idx) => {
    const stave = new Stave(10, y, width - 30);
    if (idx === 0) stave.addClef('treble');
    stave.setContext(context).draw();

    const notes = [];
    let restBeats = voiceData.firstStart;
    while (restBeats > 1e-6) {
      const step = [4, 2, 1, 0.5, 0.25].find(v => v <= restBeats + 1e-6) || 0.25;
      notes.push(new StaveNote({ keys: ['b/4'], duration: beatsToVexDuration(step) + 'r' }));
      restBeats -= step;
    }
    for (const n of voiceData.midiNotes) {
      const { key, sharp } = midiToVexKey(n.midi);
      const durCode = beatsToVexDuration(n.duration);
      const dotted = durCode.endsWith('d');
      const base = dotted ? durCode.slice(0, -1) : durCode;
      const staveNote = new StaveNote({ keys: [key], duration: base });
      if (sharp) staveNote.addModifier(new Accidental('#'));
      if (dotted) Dot.buildAndAttach([staveNote], { all: true });
      notes.push(staveNote);
    }

    const voice = new Voice({ num_beats: notes.length, beat_value: 4 });
    voice.setMode(Voice.Mode.SOFT);
    voice.addTickables(notes);
    new Formatter().joinVoices([voice]).format([voice], width - 60);
    voice.draw(context, stave);

    y += staveHeight;
  });
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

// ---------- Lecture ----------

let currentSynths = [];
function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  currentSynths.forEach(s => s.dispose());
  currentSynths = [];
}

function playPiece(piece) {
  stopPlayback();
  const secondsPerBeat = 0.42; // ~140 noires/minute
  piece.exp.voices.forEach((voiceData, idx) => {
    const synth = new Tone.Synth({ oscillator: { type: idx === 0 ? 'triangle' : idx === 1 ? 'sine' : 'sawtooth' }, volume: -8 }).toDestination();
    currentSynths.push(synth);
    let t = voiceData.firstStart * secondsPerBeat;
    for (const n of voiceData.midiNotes) {
      const freq = Tone.Frequency(n.midi, 'midi').toFrequency();
      const dur = n.duration * secondsPerBeat * 0.92;
      Tone.Transport.scheduleOnce((time) => synth.triggerAttackRelease(freq, dur, time), t);
      t += n.duration * secondsPerBeat;
    }
  });
  Tone.Transport.start();
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

let lastPiece = null;

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
      lastPiece = piece;
      renderStructure(els.structure, piece, params);
      renderScore(els.score, piece);
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
  if (!lastPiece) return;
  await Tone.start();
  playPiece(lastPiece);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
