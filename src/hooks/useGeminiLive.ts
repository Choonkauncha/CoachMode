import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { getCoachSystemInstruction, getContextReadiness, detectsRedundantContextRequest } from '../lib/coach-prompt';

export interface TranscriptMessage {
  id: string;
  sender: 'user' | 'coach';
  text: string;
  isStreaming?: boolean;
  timestamp: Date;
}

export type OrbState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'paused';
export const GEMINI_LIVE_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'] as const;
export type GeminiLiveVoice = (typeof GEMINI_LIVE_VOICES)[number];

interface UseGeminiLiveProps {
  jobDetails?: string;
  candidateInfo?: string;
  projectContext?: string;
  voiceName: GeminiLiveVoice;
}

// Utility to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function searchInterviewContext(
  query: string,
  requestedSource: string,
  jobDetails?: string,
  candidateInfo?: string,
  projectContext?: string
): string {
  const sources = [
    { key: 'job', label: 'Job description', text: jobDetails?.trim() || '' },
    { key: 'background', label: 'Candidate background', text: candidateInfo?.trim() || '' },
    { key: 'projects', label: 'Project context', text: projectContext?.trim() || '' },
  ].filter(source => source.text && (requestedSource === 'all' || requestedSource === source.key));

  const terms = [...new Set((query.toLowerCase().match(/[a-z0-9+#.-]{2,}/g) || [])
    .filter(term => !['about', 'after', 'before', 'from', 'have', 'into', 'that', 'them', 'then', 'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'with'].includes(term)))];
  const candidates = sources.flatMap(source => {
    const chunks: { label: string; text: string; score: number }[] = [];
    const chunkSize = 1200;
    const overlap = 180;
    for (let start = 0; start < source.text.length; start += chunkSize - overlap) {
      const text = source.text.slice(start, start + chunkSize).trim();
      if (!text) continue;
      const normalized = text.toLowerCase();
      const score = terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0)
        + (query.trim().length > 2 && normalized.includes(query.trim().toLowerCase()) ? 4 : 0);
      chunks.push({ label: source.label, text, score });
    }
    return chunks;
  });

  const matches = candidates
    .filter(candidate => terms.length === 0 || candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  if (!matches.length) return 'No matching passage was found in the requested context. Try a broader search query.';
  return matches.map(match => `[${match.label}]\n${match.text}`).join('\n\n---\n\n');
}

export function useGeminiLive({ jobDetails, candidateInfo, projectContext, voiceName }: UseGeminiLiveProps) {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [currentPhase, setCurrentPhase] = useState<string>('warmup');
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Connection and pipeline refs
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Playback refs
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const isModelTurnCompleteRef = useRef<boolean>(false);

  // Reconnection and pause refs
  const sessionResumptionHandleRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isIntentionallyDisconnectedRef = useRef<boolean>(true);
  const reconnectTimerRef = useRef<any>(null);
  const isPausedRef = useRef<boolean>(false);

  // Deterministic context guardrail refs — see sendContextCorrection below.
  // coachTurnBufferRef accumulates the plain text of the CURRENT coach turn only
  // (reset on turnComplete/interruption) so it can be checked against known
  // "asked for context we already have" patterns the instant the turn ends.
  const coachTurnBufferRef = useRef<string>('');

  // Clean up all audio playbacks
  const stopAudioPlayback = useCallback(() => {
    scheduledSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might have already ended
      }
    });
    scheduledSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  // Cleanup helper for WebSocket and microphone streaming
  const cleanup = useCallback(() => {
    console.log('[LiveAPI] Cleaning up connections and audio nodes');
    
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Stop recording
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch (e) {}
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
      } catch (e) {}
      audioSourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch (e) {}
      analyserRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }

    // Stop playback
    stopAudioPlayback();

    // Close session
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) {}
      sessionRef.current = null;
    }

    setOrbState('idle');
    setAudioLevel(0);
  }, [stopAudioPlayback]);

  // Decodes and queues base64 audio chunks from the model for gapless playback
  const playPCMChunk = useCallback((base64Data: string, mimeType: string) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    
    // Determine sample rate, default to 24000 Hz for Gemini Live
    const match = mimeType.match(/rate=(\d+)/);
    const sampleRate = match ? parseInt(match[1]) : 24000;
    
    // Decode base64 to binary string
    const binary = window.atob(base64Data);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const arrayBuffer = bytes.buffer;
    const numSamples = arrayBuffer.byteLength / 2;
    const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    const dataView = new DataView(arrayBuffer);
    
    // Convert 16-bit PCM to Float32 [-1.0, 1.0]
    for (let i = 0; i < numSamples; i++) {
      channelData[i] = dataView.getInt16(i * 2, true) / 32768;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Connect to visualizer analyser node if available
    if (analyserRef.current) {
      source.connect(analyserRef.current);
    } else {
      source.connect(ctx.destination);
    }
    
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) {
      // Small buffer to smooth out network jitter
      nextPlayTimeRef.current = now + 0.05;
    }
    
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
    
    scheduledSourcesRef.current.push(source);
    
    source.onended = () => {
      scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
      // Once all audio finishes playing and the turn is complete, go back to listening state (unless paused or reconnecting)
      if (scheduledSourcesRef.current.length === 0 && isModelTurnCompleteRef.current) {
        setOrbState(prev => (prev === 'speaking' ? 'listening' : prev));
      }
    };
  }, []);

  // Deterministically corrects the model in-session if it asked for context that
  // was already supplied. This is triggered by handleServerMessage's own check of
  // the model's completed turn against detectsRedundantContextRequest — a plain
  // code check against actual readiness state, not something the model opts into.
  const sendContextCorrection = useCallback((kind: 'job' | 'resume') => {
    if (!sessionRef.current) return;
    const text = kind === 'job'
      ? '[System: The job description and target role were already provided before this session started. Do not ask the candidate for them again — continue the interview using the job description you already have. Call retrieveInterviewContext if you need a specific detail.]'
      : "[System: The candidate's resume and background were already provided before this session started. Do not ask for them again — continue using the background you already have. Call retrieveInterviewContext if you need a specific detail.]";
    console.log('[LiveAPI] Deterministic guardrail: coach asked for already-supplied context, sending correction:', kind);
    try {
      sessionRef.current.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }]
      });
      setOrbState('thinking');
    } catch (err) {
      console.error('[LiveAPI] Failed to send context correction:', err);
    }
  }, []);

  // Handle incoming server WebSocket messages
  const handleServerMessage = useCallback((e: any) => {
    // 1. Session Resumption Token Update
    if (e.sessionResumptionUpdate) {
      const { newHandle, resumable } = e.sessionResumptionUpdate;
      if (resumable && newHandle) {
        sessionResumptionHandleRef.current = newHandle;
        console.log('[LiveAPI] Cached new session resumption handle:', newHandle);
      }
    }

    // 2. Tool Calls (Function Calling for phase tracking)
    if (e.toolCall?.functionCalls) {
      for (const call of e.toolCall.functionCalls) {
        if (call.name === 'setPhase') {
          const phase = call.args?.phase;
          if (phase) {
            console.log('[LiveAPI] Phase transition called:', phase);
            setCurrentPhase(phase);
          }
          // Send tools response to unblock the API
          if (sessionRef.current && call.id) {
            sessionRef.current.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: 'setPhase',
                response: { ok: true }
              }]
            });
          }
        } else if (call.name === 'retrieveInterviewContext') {
          const result = searchInterviewContext(
            call.args?.query || '',
            call.args?.source || 'all',
            jobDetails,
            candidateInfo,
            projectContext
          );
          if (sessionRef.current && call.id) {
            sessionRef.current.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: 'retrieveInterviewContext',
                response: { result }
              }]
            });
          }
        }
      }
    }

    if (e.serverContent) {
      const { modelTurn, turnComplete, interrupted, inputTranscription, outputTranscription } = e.serverContent;
      
      // Update transcript with user input speech
      if (inputTranscription?.text) {
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.sender === 'user' && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              text: inputTranscription.text,
              isStreaming: !inputTranscription.finished,
            };
            return updated;
          } else {
            return [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                sender: 'user',
                text: inputTranscription.text,
                isStreaming: !inputTranscription.finished,
                timestamp: new Date()
              }
            ];
          }
        });
      }
      
      // Update transcript with coach model response speech
      if (outputTranscription?.text) {
        coachTurnBufferRef.current += outputTranscription.text;
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.sender === 'coach' && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              text: last.text + outputTranscription.text,
              isStreaming: true,
            };
            return updated;
          } else {
            return [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                sender: 'coach',
                text: outputTranscription.text,
                isStreaming: true,
                timestamp: new Date()
              }
            ];
          }
        });
      }
      
      // Play back audio output chunks
      if (modelTurn?.parts) {
        let hasAudio = false;
        modelTurn.parts.forEach((part: any) => {
          if (part.inlineData?.data) {
            hasAudio = true;
            playPCMChunk(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
          }
        });
        if (hasAudio) {
          setOrbState(prev => (prev === 'listening' || prev === 'thinking' ? 'speaking' : prev));
        }
      }
      
      // Handle barge-in interruption (user started speaking while coach was playing output)
      if (interrupted) {
        console.log('[LiveAPI] Model interrupted by user speech');
        coachTurnBufferRef.current = '';
        stopAudioPlayback();
        setOrbState('listening');
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.sender === 'coach' && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              text: last.text + ' [Interrupted]',
              isStreaming: false
            };
            return updated;
          }
          return prev;
        });
      }
      
      // Turn complete
      if (turnComplete) {
        isModelTurnCompleteRef.current = true;

        // Pull the just-finished coach turn's full text and reset the buffer
        // before doing anything else, so a slow guardrail check can never
        // bleed into the next turn's accumulation.
        const completedCoachText = coachTurnBufferRef.current;
        coachTurnBufferRef.current = '';

        setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.sender === 'coach' && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              isStreaming: false
            };
            return updated;
          }
          return prev;
        });

        // Deterministic guardrail: verify — via a plain code check, not the
        // model's word — that the coach didn't just ask for context that was
        // already uploaded. If it did, correct it immediately rather than
        // relying on the system prompt alone.
        if (completedCoachText) {
          const readiness = getContextReadiness(jobDetails, candidateInfo, projectContext);
          const redundantAsk = detectsRedundantContextRequest(completedCoachText, readiness);
          if (redundantAsk === 'job') {
            sendContextCorrection('job');
          } else if (redundantAsk === 'resume') {
            sendContextCorrection('resume');
          }
        }

        if (scheduledSourcesRef.current.length === 0) {
          setOrbState(prev => (prev === 'speaking' ? 'listening' : prev));
        }
      }
    }

    // Capture Voice Activity Detection updates to transition orb states
    if (e.voiceActivity) {
      const type = e.voiceActivity.voiceActivityType;
      if (type === 'ACTIVITY_START') {
        console.log('[LiveAPI] User started speaking');
        setOrbState(prev => (prev !== 'paused' && prev !== 'reconnecting' ? 'listening' : prev));
        stopAudioPlayback();
      } else if (type === 'ACTIVITY_END') {
        console.log('[LiveAPI] User stopped speaking');
        setOrbState(prev => (prev !== 'paused' && prev !== 'reconnecting' ? 'thinking' : prev));
        isModelTurnCompleteRef.current = false;
      }
    }
  }, [jobDetails, candidateInfo, projectContext, playPCMChunk, stopAudioPlayback, sendContextCorrection]);

  // Initializes user microphone capture and downsamples PCM to 16kHz
  const startMicPipeline = useCallback(async (session: any) => {
    try {
      if (audioContextRef.current && mediaStreamRef.current) {
        console.log('[LiveAPI] Reusing existing microphone and audio pipeline');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      // ── Set up amplitude analyser node ──
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      analyser.connect(audioCtx.destination);

      const source = audioCtx.createMediaStreamSource(stream);
      audioSourceRef.current = source;

      // Create a 2048 sample buffer node (128ms of audio at 16kHz)
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      audioProcessorRef.current = processor;

      processor.onaudioprocess = (evt) => {
        // Halt mic data if user paused mock interview
        if (isPausedRef.current) return;

        const inputData = evt.inputBuffer.getChannelData(0);
        // Convert Float32 samples to 16-bit signed PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        // Send base64-encoded audio chunk to WebSocket
        const base64 = arrayBufferToBase64(pcm16.buffer);
        if (sessionRef.current) {
          sessionRef.current.sendRealtimeInput({
            audio: {
              data: base64,
              mimeType: 'audio/pcm;rate=16000'
            }
          });
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (err: any) {
      console.error('[LiveAPI] Microphone pipeline setup failed:', err);
      setError('Could not access microphone. Verify device permissions.');
      cleanup();
    }
  }, [cleanup]);

  // Drives dynamic amplitude updates to driving hook subscribers at ~30fps
  useEffect(() => {
    let animationId: number;
    let lastUpdate = 0;
    const dataArray = new Uint8Array(128); // fftSize (256) / 2 = 128

    const tick = () => {
      animationId = requestAnimationFrame(tick);
      if (!analyserRef.current || !audioContextRef.current || orbState === 'idle' || orbState === 'paused') {
        if (lastUpdate > 0) {
          setAudioLevel(0);
          lastUpdate = 0;
        }
        return;
      }

      const now = performance.now();
      if (now - lastUpdate < 33) return; // limit to ~30fps
      lastUpdate = now;

      // Extract time domain data
      analyserRef.current.getByteTimeDomainData(dataArray);

      // Compute Root Mean Square (RMS) amplitude
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const value = (dataArray[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Normalize & scale amplitude for vocal peaks (voice RMS sits around 0.1-0.2)
      const level = Math.min(1.0, rms * 5.5);
      setAudioLevel(level);
    };

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [orbState]);

  // Starts the WebSocket session connection to the Gemini Live API
  const connect = useCallback(async (isReconnect = false) => {
    if (sessionRef.current) return;
    setError(null);

    if (isReconnect) {
      setOrbState('reconnecting');
      console.log(`[LiveAPI] Reconnecting attempt #${reconnectAttemptsRef.current + 1}...`);
    } else {
      setOrbState('connecting');
      setTranscript([]);
      setCurrentPhase('warmup');
      reconnectAttemptsRef.current = 0;
      isIntentionallyDisconnectedRef.current = false;
      isPausedRef.current = false;
      coachTurnBufferRef.current = '';
    }

    try {
      // 1. Request a short-lived Gemini Live token from the Vercel serverless function.
      // The long-lived GEMINI_API_KEY never reaches the browser.
      const tokenRes = await fetch('/api/live-token', { method: 'POST' });
      if (!tokenRes.ok) {
        const detail = await tokenRes.json().catch(() => ({}));
        throw new Error(detail.error || `Failed to provision Gemini Live access (${tokenRes.status})`);
      }
      const { token } = await tokenRes.json();
      if (!token) {
        throw new Error('Gemini Live access token was not returned by the server.');
      }

      // 2. Initialize the client with the short-lived token.
      const ai = new GoogleGenAI({ apiKey: token });

      // 3. Construct prompt instructions based on context parameters
      const sysInstr = getCoachSystemInstruction(jobDetails, candidateInfo, projectContext);

      // Construct resumption configuration (only include if we have a handle)
      const resumptionConfig = sessionResumptionHandleRef.current
        ? { sessionResumption: { handle: sessionResumptionHandleRef.current } }
        : {};

      // 4. Establish real-time live WebSocket session
      const session = await ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{ text: sysInstr }]
          },
          tools: [
            {
              functionDeclarations: [{
                name: 'setPhase',
                description: 'Update the UI to show the current interview phase',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    phase: {
                      type: Type.STRING,
                      description: 'The current phase: warmup, behavioral, technical, role-specific, candidate-questions, wrap-up'
                    }
                  },
                  required: ['phase']
                }
              }, {
                name: 'retrieveInterviewContext',
                description: 'Search the uploaded job description, candidate background, and project materials for details to recall during the interview. Use this instead of asking the candidate to repeat supplied information.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    query: {
                      type: Type.STRING,
                      description: 'A focused search for a fact, skill, employer, project, responsibility, result, or technology.'
                    },
                    source: {
                      type: Type.STRING,
                      description: 'Optional context source to search: all, job, background, or projects.'
                    }
                  },
                  required: ['query']
                }
              }]
            }
          ],
          ...resumptionConfig,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName
              }
            }
          }
        },
        callbacks: {
          onopen: () => {
            console.log('[LiveAPI] WebSocket opened successfully');
            reconnectAttemptsRef.current = 0;
          },
          onmessage: (msg: any) => {
            handleServerMessage(msg);
          },
          onclose: (closeEvent: any) => {
            const code = closeEvent?.code;
            console.log('[LiveAPI] WebSocket closed code:', code);
            sessionRef.current = null;

            // Only auto-reconnect on abnormal closures (network drops).
            // 1007 = invalid payload, 1008 = policy violation, 1011 = server error
            // — these won't be fixed by retrying.
            const isRecoverable = code === 1006;
            
            if (!isIntentionallyDisconnectedRef.current && isRecoverable) {
              const attempts = reconnectAttemptsRef.current;
              if (attempts < 3) {
                setOrbState('reconnecting');
                const backoffs = [1000, 3000, 8000];
                const delay = backoffs[attempts];
                console.log(`[LiveAPI] Scheduling reconnect in ${delay}ms (attempt ${attempts + 1})`);
                
                // Tear down stale mic pipeline so reconnect creates a fresh one
                if (audioProcessorRef.current) {
                  audioProcessorRef.current.disconnect();
                  audioProcessorRef.current = null;
                }
                if (audioSourceRef.current) {
                  audioSourceRef.current.disconnect();
                  audioSourceRef.current = null;
                }
                
                reconnectAttemptsRef.current += 1;
                reconnectTimerRef.current = setTimeout(() => {
                  connect(true);
                }, delay);
              } else {
                setError('Connection lost. Please check your network and try again.');
                cleanup();
              }
            } else {
              if (!isIntentionallyDisconnectedRef.current) {
                console.log('[LiveAPI] Session ended (non-recoverable close code). Not retrying.');
              }
              cleanup();
            }
          },
          onerror: (err: any) => {
            console.error('[LiveAPI] WebSocket connection error:', err);
            // WebSocket close callback will handle the retry path
          }
        }
      });

      // ai.live.connect() resolves only after onopen fires, so session is safe here
      sessionRef.current = session;
      setOrbState(isPausedRef.current ? 'paused' : 'listening');
      startMicPipeline(session);

      // On fresh connect (not reconnect), send an initial prompt so the coach speaks first.
      // What this message says is driven entirely by the same deterministic readiness
      // check the system prompt uses (getContextReadiness) — computed per-field, not as
      // a single "is anything uploaded" flag, so a partially-uploaded session (e.g. resume
      // only, no job description) correctly asks for just the missing piece instead of
      // either asking for everything or silently skipping intake altogether.
      if (!isReconnect) {
        const readiness = getContextReadiness(jobDetails, candidateInfo, projectContext);
        const missing: string[] = [];
        if (!readiness.hasJobDetails) missing.push('the target role or job description — a spoken summary or just the role title is fine');
        if (!readiness.hasCandidateInfo) missing.push('a brief overview of your background, experience, and relevant skills');

        let kickoffText: string;
        if (missing.length === 0) {
          kickoffText = "Hi, I'm ready to start the mock interview coaching session. My job description and background are already loaded, so please introduce yourself and begin the interview directly — there's no need to ask me for either of those.";
        } else {
          const alreadyHave: string[] = [];
          if (readiness.hasJobDetails) alreadyHave.push('my job description');
          if (readiness.hasCandidateInfo) alreadyHave.push('my background/resume');
          kickoffText = `Hi, I'm ready to start. Before we begin, please ask me for ${missing.join(' and ')}.`
            + (alreadyHave.length ? ` You already have ${alreadyHave.join(' and ')}, so don't ask me about ${alreadyHave.length > 1 ? 'those' : 'that'}.` : '')
            + ' This is setup context; begin interview questions only after gathering it.';
        }

        session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: kickoffText }]
          }],
          turnComplete: true
        });
        setOrbState('thinking');
      }
    } catch (err: any) {
      console.error('[LiveAPI] Connection initialization error:', err);
      if (!isReconnect) {
        setError(err?.message || 'Failed to start coach session.');
        setOrbState('idle');
      } else {
        // For reconnect, retry loop will continue unless maxed out
        const attempts = reconnectAttemptsRef.current;
        if (attempts < 3) {
          reconnectAttemptsRef.current += 1;
          const backoffs = [1000, 3000, 8000];
          const delay = backoffs[attempts];
          reconnectTimerRef.current = setTimeout(() => {
            connect(true);
          }, delay);
        } else {
          setError('Failed to restore connection. Try manual reconnect.');
          cleanup();
        }
      }
    }
  }, [jobDetails, candidateInfo, projectContext, voiceName, startMicPipeline, handleServerMessage, cleanup]);

  // Clean up connections on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const disconnect = useCallback(() => {
    isIntentionallyDisconnectedRef.current = true;
    sessionResumptionHandleRef.current = null;
    cleanup();
  }, [cleanup]);

  // ── Session Controls ──
  const pause = useCallback(() => {
    if (orbState === 'idle' || orbState === 'connecting' || orbState === 'reconnecting') return;
    isPausedRef.current = true;
    setOrbState('paused');
    console.log('[LiveAPI] Session paused');
  }, [orbState]);

  const resume = useCallback(() => {
    if (orbState !== 'paused') return;
    isPausedRef.current = false;
    setOrbState('listening');
    console.log('[LiveAPI] Session resumed');
  }, [orbState]);

  const skip = useCallback(() => {
    if (!sessionRef.current) return;
    console.log('[LiveAPI] Sending skip instruction tool/content to Gemini');
    sessionRef.current.sendClientContent({
      turns: [{
        role: 'user',
        parts: [{ text: '[System: Candidate requested next question. Move on.]' }]
      }]
    });
    setOrbState('thinking');
  }, []);

  const end = useCallback(async () => {
    isIntentionallyDisconnectedRef.current = true;
    sessionResumptionHandleRef.current = null;
    cleanup();
  }, [cleanup]);

  return {
    orbState,
    audioLevel,
    currentPhase,
    transcript,
    setTranscript,
    error,
    connect,
    disconnect,
    pause,
    resume,
    skip,
    end
  };
}
