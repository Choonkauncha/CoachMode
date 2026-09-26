import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, SkipForward, X, ChevronUp, History, Calendar, Clock, AlertTriangle, Sparkles, Mic, Loader2, Volume2, HelpCircle } from 'lucide-react';
import localforage from 'localforage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGeminiLive, OrbState } from '../hooks/useGeminiLive';
import { TourGuide, triggerTourRestart } from './TourGuide';

interface CoachModeProps {
  jobDetails?: string;
  candidateInfo?: string;
  projectContext?: string;
  onSessionActiveChange?: (active: boolean) => void;
}

interface PastSession {
  id: string;
  date: number;
  durationMs: number;
  role: string;
  transcriptMarkdown: string;
}

export const CoachMode = forwardRef<{
  endSession: () => Promise<void>;
  openPastSessions: () => void;
}, CoachModeProps>(({ jobDetails, candidateInfo, projectContext, onSessionActiveChange }, ref) => {
  const {
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
  } = useGeminiLive({
    jobDetails,
    candidateInfo,
    projectContext
  });

  const [seconds, setSeconds] = useState(0);
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  
  // History panel states
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [activeHistorySession, setActiveHistorySession] = useState<PastSession | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Notify parent of session activity state
  const isSessionActive = orbState !== 'idle';
  useEffect(() => {
    if (onSessionActiveChange) {
      onSessionActiveChange(isSessionActive);
    }
  }, [isSessionActive, onSessionActiveChange]);

  // Load past sessions from localforage
  const loadPastSessions = useCallback(async () => {
    try {
      const history: PastSession[] = (await localforage.getItem('coach-sessions')) || [];
      setPastSessions(history);
    } catch (err) {
      console.error('[CoachMode] Failed to load past sessions:', err);
    }
  }, []);

  useEffect(() => {
    loadPastSessions();
  }, [loadPastSessions]);

  // Handle session timer
  useEffect(() => {
    let interval: any = null;
    const isTimerRunning = orbState !== 'idle' && orbState !== 'connecting' && orbState !== 'paused' && orbState !== 'reconnecting';
    if (isTimerRunning) {
      interval = setInterval(() => {
        setSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [orbState]);

  // Auto-scroll transcript log bottom
  useEffect(() => {
    if (isTranscriptExpanded) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, isTranscriptExpanded]);

  // Format timer
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (seconds >= 2700) return 'text-red-500 font-extrabold'; // 45+ mins
    if (seconds >= 1800) return 'text-amber-500 font-extrabold'; // 30+ mins
    return 'text-gray-300';
  };

  const getPhaseLabel = () => {
    switch (currentPhase) {
      case 'warmup': return 'Introduction & Warm-up';
      case 'behavioral': return 'Behavioral Questions';
      case 'technical': return 'Technical System Design';
      case 'role-specific': return 'Role-Specific Deep Dive';
      case 'candidate-questions': return 'Candidate Q&A';
      case 'wrap-up': return 'Closing & Feedback';
      default: return 'Mock Interview';
    }
  };

  // Status helper text
  const getStatusText = () => {
    switch (orbState) {
      case 'idle':
        return 'Mock Interview Ready. Tap the orb below to begin.';
      case 'connecting':
        return 'Connecting to Gemini Mock Interview Coach...';
      case 'reconnecting':
        return 'Connection lost. Reconnecting to active session...';
      case 'listening':
        return 'Coach is listening. Answer the question naturally.';
      case 'thinking':
        return 'Coach is thinking...';
      case 'speaking':
        return 'Coach is speaking...';
      case 'paused':
        return 'Session Paused. Mic stream suspended.';
      default:
        return '';
    }
  };

  // Orb gradient color matching state
  const getOrbColor = () => {
    switch (orbState) {
      case 'connecting': return 'rgba(59, 130, 246, 0.4)';
      case 'reconnecting': return 'rgba(239, 68, 68, 0.3)';
      case 'listening': return 'rgba(59, 130, 246, 0.5)';
      case 'thinking': return 'rgba(167, 139, 250, 0.5)';
      case 'speaking': return 'rgba(245, 158, 11, 0.6)';
      case 'paused': return 'rgba(107, 114, 128, 0.4)';
      default: return 'rgba(255, 255, 255, 0.1)';
    }
  };

  // Toggle call trigger
  const handleToggleConnection = () => {
    if (orbState === 'idle') {
      setSeconds(0);
      connect();
    } else {
      if (confirm('End coach session? Your transcript will be finalized and saved.')) {
        handleEndSession();
      }
    }
  };

  // Finalizes the session, exports to MD, and saves to history
  const handleEndSession = async () => {
    if (transcript.length > 0) {
      // 1. Compile Markdown
      const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const timeStr = new Date().toLocaleTimeString();
      const durationStr = formatTime(seconds);
      const firstLineOfJob = jobDetails ? jobDetails.split('\n')[0].substring(0, 50) : '';
      const roleStr = firstLineOfJob.trim() || 'Software Engineer';

      const lines: string[] = [
        `# SPEAX Mock Interview Coach Export`,
        `* **Role**: ${roleStr}`,
        `* **Date**: ${dateStr} at ${timeStr}`,
        `* **Duration**: ${durationStr}`,
        "", "---", "", "## Conversation Transcript", "",
      ];

      transcript.forEach(msg => {
        lines.push(`**${msg.sender === 'user' ? 'Candidate' : 'Coach'}** *(${msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})})*:`, `${msg.text}`, "");
      });

      const markdown = lines.join('\n');

      // 2. Trigger Markdown Download
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filenameDate = new Date().toISOString().slice(0, 10) + '-' + new Date().toTimeString().slice(0,5).replace(':', '');
      a.href = url;
      a.download = `speax-coach-${filenameDate}.md`;
      a.click();
      URL.revokeObjectURL(url);

      // 3. Save to localforage
      try {
        const history: PastSession[] = (await localforage.getItem('coach-sessions')) || [];
        const newSession: PastSession = {
          id: Math.random().toString(36).substring(7),
          date: Date.now(),
          durationMs: seconds * 1000,
          role: roleStr,
          transcriptMarkdown: markdown
        };
        const updated = [newSession, ...history].slice(0, 20);
        await localforage.setItem('coach-sessions', updated);
        setPastSessions(updated);
      } catch (err) {
        console.error('[CoachMode] Failed to save session to logs history:', err);
      }
    }

    // 4. Reset connections
    await end();
    setSeconds(0);
  };

  // Expose methods to App parent via ref
  useImperativeHandle(ref, () => ({
    endSession: async () => {
      await handleEndSession();
    },
    openPastSessions: () => {
      setShowHistoryPanel(true);
    }
  }));

  return (
    <div className="h-screen w-full flex flex-col bg-[#070708] text-gray-200 overflow-hidden font-sans select-none relative">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px] pointer-events-none" />

      {/* ── Top Header Control Bar ── */}
      <div className="flex-none flex items-center justify-between gap-3 px-4 py-3 md:px-5 border-b border-white/5 bg-[#0A0A0C]/95 z-20">
        {/* Phase Tracker */}
        <div className="flex flex-col">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-500">Current Phase</span>
          <span className="text-xs font-semibold text-gray-200">{getPhaseLabel()}</span>
        </div>

        {/* Timer display */}
        {isSessionActive && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/5">
            <Clock size={12} className="text-gray-400" />
            <span className={`text-xs font-mono ${getTimerColor()}`}>{formatTime(seconds)}</span>
          </div>
        )}

        {/* Session Action Controls */}
        <div className="flex items-center gap-1.5">
          <button id="coach-tutorial" onClick={()=>triggerTourRestart('coach')} title="Open tutorial" className="p-2 rounded-lg bg-white/5 border border-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"><HelpCircle size={14}/></button>
          {isSessionActive && (
            <>
              {/* Play / Pause Toggle */}
              {orbState === 'paused' ? (
                <button
                  onClick={resume}
                  title="Resume Interview Session"
                  className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:text-white hover:bg-emerald-600 transition-all cursor-pointer"
                >
                  <Play size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={pause}
                  title="Pause Interview Session"
                  className="p-2 rounded-lg bg-white/5 border border-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                >
                  <Pause size={13} fill="currentColor" />
                </button>
              )}

              {/* Skip Question Button */}
              <button
                onClick={skip}
                title="Skip Current Question"
                className="p-2 rounded-lg bg-white/5 border border-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <SkipForward size={13} />
              </button>

              {/* End Session Button */}
              <button
                onClick={() => {
                  if (confirm('End coach session? Your transcript will be finalized and saved.')) {
                    handleEndSession();
                  }
                }}
                title="End Interview Session"
                className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:text-white hover:bg-red-600 transition-all cursor-pointer"
              >
                <X size={13} />
              </button>
            </>
          )}

          {/* Offline trigger indicator */}
          {!isSessionActive && (
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-gray-500 font-bold pr-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              Coach Offline
            </div>
          )}
        </div>
      </div>

      {/* ── Main Workspace Body ── */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative px-4 pb-16 pt-3 z-10">
        {/* Animated Interactive Voice-Driven Orb */}
        <div className="relative w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 flex items-center justify-center">
          <AnimatePresence mode="popLayout">
            {/* Ripple rings triggered when speaking */}
            {orbState === 'speaking' && (
              <>
                <motion.div
                  initial={{ scale: 0.8, opacity: 0.5 }}
                  animate={{ scale: 1.8, opacity: 0 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-500/20 to-rose-500/20 border border-amber-500/30 blur-sm pointer-events-none"
                />
                <motion.div
                  initial={{ scale: 0.8, opacity: 0.6 }}
                  animate={{ scale: 1.4, opacity: 0 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: 'easeOut', delay: 0.5 }}
                  className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-500/30 to-rose-500/30 border border-rose-500/40 blur-xs pointer-events-none"
                />
              </>
            )}

            {/* Spinner connecting ring */}
            {(orbState === 'connecting' || orbState === 'reconnecting') && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.8, ease: 'linear' }}
                className="absolute w-64 h-64 md:w-72 md:h-72 rounded-full border-t-2 border-r border-transparent border-t-blue-500 border-r-indigo-500 blur-xs pointer-events-none"
              />
            )}

            {/* Listening halo */}
            {orbState === 'listening' && (
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                className="absolute inset-[-10px] rounded-full border border-blue-500/20 bg-blue-500/[0.01] blur-md pointer-events-none"
              />
            )}

            {/* Thinking morphing ring */}
            {orbState === 'thinking' && (
              <motion.div
                animate={{ 
                  scale: [1, 1.05, 0.95, 1],
                  borderRadius: ["50% 50% 50% 50%", "45% 55% 48% 52%", "53% 47% 55% 45%", "50% 50% 50% 50%"],
                  rotate: 360 
                }}
                transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                className="absolute inset-[-5px] rounded-full bg-gradient-to-tr from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 border border-violet-500/30 blur-xs pointer-events-none"
              />
            )}
          </AnimatePresence>

          {/* Central Interactive Orb Button */}
          <motion.button
            id="coach-orb"
            onClick={handleToggleConnection}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            // Driving visual styles dynamically from the hook's real-time audioLevel
            style={{
              transform: `scale(${1 + audioLevel * 0.15})`,
              boxShadow: `0 0 ${20 + audioLevel * 60}px ${getOrbColor()}`,
              transition: 'transform 80ms ease-out, box-shadow 80ms ease-out'
            }}
            className={`relative z-20 w-36 h-36 sm:w-40 sm:h-40 md:w-48 md:h-48 rounded-full flex flex-col items-center justify-center border shadow-2xl cursor-pointer ${
              orbState === 'idle'
                ? 'bg-gradient-to-tr from-white/[0.02] to-white/[0.05] border-white/10 hover:border-white/20 shadow-black/60'
                : orbState === 'connecting'
                ? 'bg-gradient-to-tr from-blue-950/20 to-indigo-950/20 border-blue-500/40 shadow-blue-900/30'
                : orbState === 'reconnecting'
                ? 'bg-gradient-to-tr from-red-950/20 to-red-900/20 border-red-500/40 shadow-red-900/30'
                : orbState === 'listening'
                ? 'bg-gradient-to-tr from-blue-950/30 via-indigo-950/20 to-blue-950/30 border-blue-400/50 shadow-indigo-900/40'
                : orbState === 'thinking'
                ? 'bg-gradient-to-tr from-violet-950/30 via-fuchsia-950/20 to-violet-950/30 border-violet-400/50 shadow-violet-900/40 animate-pulse'
                : orbState === 'paused'
                ? 'bg-gradient-to-tr from-gray-900/40 to-gray-800/40 border-gray-600/50 shadow-gray-900/40'
                : 'bg-gradient-to-tr from-amber-950/40 via-rose-950/20 to-amber-950/40 border-amber-400/60 shadow-amber-900/50'
            }`}
          >
            {orbState === 'idle' && (
              <>
                <div className="p-3.5 rounded-full bg-white/5 text-gray-400 hover:text-white transition-colors mb-2">
                  <Mic size={24} />
                </div>
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Start Interview</span>
                <span className="text-[8px] text-gray-500 mt-0.5">Audio Grounding</span>
              </>
            )}

            {(orbState === 'connecting' || orbState === 'reconnecting') && (
              <>
                <Loader2 size={24} className="animate-spin text-blue-400 mb-2" />
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-blue-400">
                  {orbState === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
                </span>
                <span className="text-[8px] text-gray-500 mt-0.5">Please wait</span>
              </>
            )}

            {orbState === 'listening' && (
              <>
                <div className="p-3.5 rounded-full bg-blue-500/10 text-blue-400 mb-2 animate-pulse">
                  <Mic size={24} />
                </div>
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-blue-400 animate-pulse">Listening</span>
                <span className="text-[8px] text-gray-400 mt-0.5">Speak naturally</span>
              </>
            )}

            {orbState === 'thinking' && (
              <>
                <Sparkles size={24} className="text-violet-400 mb-2 animate-bounce" />
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-violet-400">Thinking</span>
                <span className="text-[8px] text-gray-400 mt-0.5">Gathering details</span>
              </>
            )}

            {orbState === 'speaking' && (
              <>
                <Volume2 size={24} className="text-amber-400 mb-2 animate-pulse" />
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400">Coach Speaking</span>
                <span className="text-[8px] text-gray-400 mt-0.5">Barge-in allowed</span>
              </>
            )}

            {orbState === 'paused' && (
              <>
                <Play size={24} className="text-gray-400 mb-2" fill="currentColor" />
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Paused</span>
                <span className="text-[8px] text-gray-500 mt-0.5">Click to resume</span>
              </>
            )}
          </motion.button>
        </div>

        {/* Dynamic Status Text */}
        <div id="coach-status-text" className="mt-6 text-center max-w-sm px-4">
          <h2 className="text-xs font-semibold text-gray-400">
            {getStatusText()}
          </h2>
          {error && (
            <div className="mt-3 flex items-center justify-center gap-2 p-2.5 rounded-lg bg-red-950/20 border border-red-500/20 text-red-400 text-[10px] leading-relaxed max-w-xs mx-auto">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Context Status Widget ── */}
      <div id="context-status-widget" className="absolute bottom-[52px] left-4 right-4 z-20 bg-[#0F0F12]/90 border border-white/5 rounded-xl p-3 text-[10px] space-y-2 max-w-lg mx-auto backdrop-blur-sm pointer-events-none hidden sm:block">
        <div className="flex items-center justify-between text-gray-400 border-b border-white/5 pb-1">
          <span className="font-bold uppercase tracking-wider text-[8px]">Active Interview Context</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1.5 truncate">
            <span className={`h-1.5 w-1.5 rounded-full ${candidateInfo ? 'bg-emerald-500' : 'bg-gray-600'}`} />
            <span className={candidateInfo ? 'text-gray-300' : 'text-gray-600'}>Resume Bio</span>
          </div>
          <div className="flex items-center gap-1.5 truncate">
            <span className={`h-1.5 w-1.5 rounded-full ${jobDetails ? 'bg-emerald-500' : 'bg-gray-600'}`} />
            <span className={jobDetails ? 'text-gray-300' : 'text-gray-600'}>Job Specs</span>
          </div>
          <div className="flex items-center gap-1.5 truncate">
            <span className={`h-1.5 w-1.5 rounded-full ${projectContext ? 'bg-emerald-500' : 'bg-gray-600'}`} />
            <span className={projectContext ? 'text-gray-300' : 'text-gray-600'}>Code Repository</span>
          </div>
        </div>
      </div>

      {/* ── Sliding Bottom Expandable Transcript sheet ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-30 bg-[#0A0A0C]/95 backdrop-blur-md border-t border-white/10 flex flex-col transition-all duration-300 select-text"
        style={{ height: isTranscriptExpanded ? '45%' : '44px' }}
      >
        {/* Toggle bar */}
        <button
          onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
          className="flex-none h-11 flex items-center justify-between px-6 border-b border-white/5 cursor-pointer w-full text-left bg-white/[0.01]"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${transcript.length > 0 ? 'bg-blue-500' : 'bg-gray-600'}`} />
            Interview Log {transcript.length > 0 ? `(${transcript.length} turns)` : ''}
          </span>
          <ChevronUp
            size={14}
            className={`text-gray-500 transition-transform duration-300 ${isTranscriptExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Scrollable conversation stream */}
        <div id="transcript-log" className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scrollbar-hide pb-12">
          {transcript.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-2 opacity-50">
              <span className="text-[10px] uppercase tracking-wider">No turns recorded yet</span>
              <p className="text-[9px] leading-relaxed max-w-[200px]">
                The live speech-to-speech dialog log will build here as you converse with the coach.
              </p>
            </div>
          ) : (
            transcript.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
              >
                {/* Sender Tag */}
                <span className="text-[9px] text-gray-500 font-bold mb-0.5 uppercase tracking-wider px-1">
                  {msg.sender === 'user' ? 'Candidate' : 'Coach'}
                </span>

                {/* Bubble */}
                <div
                  className={`p-3 rounded-xl text-xs leading-relaxed transition-all ${
                    msg.sender === 'user'
                      ? 'bg-blue-600/10 border border-blue-500/20 text-gray-100 rounded-tr-none'
                      : 'bg-white/[0.03] border border-white/5 text-gray-200 rounded-tl-none shadow-lg'
                  } ${msg.isStreaming ? 'opacity-85 shadow-indigo-500/5' : ''}`}
                >
                  {msg.text}
                  {msg.isStreaming && (
                    <span className="inline-flex gap-0.5 ml-1.5 align-middle">
                      <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* ── Past Sessions Drawer Overlay ── */}
      <AnimatePresence>
        {showHistoryPanel && (
          <div className="fixed inset-0 z-[210] flex items-center justify-end">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistoryPanel(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-xs cursor-pointer"
            />

            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="relative w-full max-w-md bg-[#0D0D0F] border-l border-white/10 h-full flex flex-col p-6 shadow-2xl z-10"
            >
              <button
                onClick={() => setShowHistoryPanel(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/5 text-gray-500 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <X size={15} />
              </button>

              <h2 className="text-sm font-semibold tracking-wider uppercase text-white mb-6 flex items-center gap-2 border-b border-white/5 pb-3">
                <History size={16} className="text-blue-500" /> Past Sessions
              </h2>

              <div className="flex-1 overflow-y-auto space-y-3 scrollbar-hide pb-6">
                {pastSessions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-600 space-y-2">
                    <History size={36} strokeWidth={1} />
                    <span className="text-[10px] uppercase tracking-wider">No history recorded</span>
                    <p className="text-[9px] max-w-[200px]">
                      Complete your first coach interview session to see it logged here.
                    </p>
                  </div>
                ) : (
                  pastSessions.map(session => (
                    <div
                      key={session.id}
                      onClick={() => setActiveHistorySession(session)}
                      className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-blue-500/30 hover:bg-white/[0.04] transition-all cursor-pointer space-y-2 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest truncate max-w-[200px]">
                          {session.role}
                        </span>
                        <div className="flex items-center gap-1 text-[9px] text-gray-500 font-mono">
                          <Calendar size={10} />
                          {new Date(session.date).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-gray-400 text-[10px]">
                        <span className="truncate text-gray-500">Session Log</span>
                        <div className="flex items-center gap-1 font-mono text-[9px]">
                          <Clock size={10} />
                          {formatTime(Math.round(session.durationMs / 1000))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Read-only Transcript Viewer Modal ── */}
      <AnimatePresence>
        {activeHistorySession && (
          <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 backdrop-blur-sm bg-black/80">
            <div className="absolute inset-0 cursor-pointer" onClick={() => setActiveHistorySession(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 w-full max-w-2xl bg-[#0E0E10] border border-white/10 rounded-2xl flex flex-col max-h-[85vh] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Close button */}
              <button
                onClick={() => setActiveHistorySession(null)}
                className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/5 text-gray-500 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <X size={15} />
              </button>

              {/* Title Header */}
              <div className="p-6 border-b border-white/5 flex flex-col justify-start text-left">
                <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">
                  Historical Log Viewer
                </span>
                <h3 className="text-sm font-semibold text-white truncate pr-12 mt-1">
                  {activeHistorySession.role}
                </h3>
                <div className="flex gap-4 text-[9px] text-gray-500 mt-2 font-mono">
                  <div className="flex items-center gap-1">
                    <Calendar size={10} />
                    {new Date(activeHistorySession.date).toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatTime(Math.round(activeHistorySession.durationMs / 1000))}
                  </div>
                </div>
              </div>

              {/* MD Scrollable Container */}
              <div className="flex-1 overflow-y-auto p-6 text-xs text-gray-300 leading-relaxed font-sans prose prose-invert max-w-none text-left select-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {activeHistorySession.transcriptMarkdown}
                </ReactMarkdown>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/5 bg-white/[0.01] flex justify-end">
                <button
                  onClick={() => setActiveHistorySession(null)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  Close Transcript
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <TourGuide view="coach" />
    </div>
  );
});

CoachMode.displayName = 'CoachMode';
export default CoachMode;
