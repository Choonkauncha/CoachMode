import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react';

export interface TourStep {
  selector: string;
  title: string;
  description: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const MAIN_STEPS: TourStep[] = [
  {
    selector: '#main-header',
    title: 'Welcome to SPEAX Coach',
    description: 'This setup screen builds the evidence the coach uses to run a personalized interview. You can start here even with no files loaded.',
    placement: 'bottom'
  },
  {
    selector: '#resume-card',
    title: '1. Your Background',
    description: 'Upload your resume as a PDF, or paste your professional background. This gives the coach verified candidate context.',
    placement: 'bottom'
  },
  {
    selector: '#job-card',
    title: '2. Target Role',
    description: 'Load the job description as a PDF or paste it into the editor. The coach uses this to understand what you are practicing for.',
    placement: 'bottom'
  },
  {
    selector: '#projects-card',
    title: '3. Your Technical Projects',
    description: 'Upload one or more project ZIPs. Each project stays separate so technical questions can be tied to real code and documentation.',
    placement: 'bottom'
  },
  {
    selector: '#main-start-coach',
    title: '4. Start the Coach',
    description: 'When your context is ready, open the live interviewer. You can return here anytime to change the interview evidence.',
    placement: 'top'
  },
  {
    selector: '#main-tutorial',
    title: 'Tutorial Anytime',
    description: 'Use this button whenever you want to replay this walkthrough. You never have to remember where anything is.',
    placement: 'bottom'
  }
];

const COACH_STEPS: TourStep[] = [
  {
    selector: '#context-status-widget',
    title: '1. Interview Context',
    description: 'These indicators show which candidate, role, and technical project evidence is available to the live coach.',
    placement: 'top'
  },
  {
    selector: '#coach-orb',
    title: '2. Start the Interview',
    description: 'Press the coach orb to connect to Gemini Live. Your browser will ask for microphone permission the first time.',
    placement: 'top'
  },
  {
    selector: '#coach-status-text',
    title: '3. Live Status',
    description: 'The status area tells you whether the coach is listening, thinking, speaking, connecting, or paused.',
    placement: 'bottom'
  },
  {
    selector: '#transcript-log',
    title: '4. Interview Log',
    description: 'Expand the Interview Log to review the live conversation as it happens. It stays available after the session is saved.',
    placement: 'top'
  },
  {
    selector: '#coach-tutorial',
    title: '5. Tutorial Anytime',
    description: 'Replay this walkthrough from the Coach whenever you need a refresher.',
    placement: 'left'
  }
];

interface TourGuideProps {
  view: 'main' | 'coach';
}

export function TourGuide({ view }: TourGuideProps) {
  const steps = view === 'main' ? MAIN_STEPS : COACH_STEPS;
  const storageKey = `speax-coach-tour-completed-${view}`;
  const [isActive, setIsActive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const completed = localStorage.getItem(storageKey);
    if (!completed) {
      const timer = window.setTimeout(() => {
        setCurrentIndex(0);
        setIsActive(true);
      }, 450);
      return () => window.clearTimeout(timer);
    }
  }, [storageKey]);

  useEffect(() => {
    const restartEvent = `speax-restart-tour-${view}`;
    const handleRestart = () => {
      setCurrentIndex(0);
      setIsActive(true);
    };
    window.addEventListener(restartEvent, handleRestart);
    return () => window.removeEventListener(restartEvent, handleRestart);
  }, [view]);

  useEffect(() => {
    if (!isActive) return;

    const updatePosition = () => {
      const step = steps[currentIndex];
      const element = document.querySelector(step.selector) as HTMLElement | null;

      if (!element) {
        setCoords(null);
        const cardW = Math.min(360, window.innerWidth - 32);
        const cardH = tooltipRef.current?.offsetHeight || 220;
        setTooltipPos({
          top: Math.max(16, window.innerHeight / 2 - cardH / 2),
          left: Math.max(16, window.innerWidth / 2 - cardW / 2)
        });
        return;
      }

      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      setCoords({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });

      const cardW = Math.min(360, window.innerWidth - 32);
      const cardH = tooltipRef.current?.offsetHeight || 210;
      const margin = 18;
      let top = window.innerHeight / 2 - cardH / 2;
      let left = window.innerWidth / 2 - cardW / 2;

      if (step.placement === 'top') {
        top = rect.top - cardH - margin;
        left = rect.left + rect.width / 2 - cardW / 2;
      } else if (step.placement === 'bottom') {
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - cardW / 2;
      } else if (step.placement === 'left') {
        top = rect.top + rect.height / 2 - cardH / 2;
        left = rect.left - cardW - margin;
      } else if (step.placement === 'right') {
        top = rect.top + rect.height / 2 - cardH / 2;
        left = rect.right + margin;
      }

      top = Math.max(16, Math.min(window.innerHeight - cardH - 16, top));
      left = Math.max(16, Math.min(window.innerWidth - cardW - 16, left));
      setTooltipPos({ top, left });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isActive, currentIndex, steps]);

  const complete = () => {
    setIsActive(false);
    localStorage.setItem(storageKey, 'true');
  };

  const next = () => currentIndex < steps.length - 1 ? setCurrentIndex(i => i + 1) : complete();
  const back = () => currentIndex > 0 && setCurrentIndex(i => i - 1);

  if (!isActive || !steps.length) return null;
  const currentStep = steps[currentIndex];

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none select-none" aria-label="Tutorial">
      {/* Deliberately no backdrop blur: the application stays readable while the tutorial is active. */}
      <div
        className={`absolute inset-0 pointer-events-auto cursor-pointer ${coords ? 'bg-transparent' : 'bg-black/25'}`}
        onClick={complete}
        aria-hidden="true"
      />

      {coords && (
        <motion.div
          key={`${view}-${currentIndex}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="fixed z-[201] rounded-xl border-2 border-blue-400 pointer-events-none"
          style={{
            top: coords.top - 7,
            left: coords.left - 7,
            width: coords.width + 14,
            height: coords.height + 14,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.28), 0 0 26px rgba(59,130,246,0.45)',
          }}
        >
          <span className="absolute -inset-1 rounded-xl border border-blue-300/30 animate-pulse" />
        </motion.div>
      )}

      {tooltipPos && (
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed z-[202] w-[min(360px,calc(100vw-32px))] rounded-2xl border border-blue-300/45 bg-[#151b27] p-5 text-gray-200 shadow-[0_20px_60px_rgba(0,0,0,0.75),0_0_24px_rgba(59,130,246,0.16)] ring-1 ring-white/10 pointer-events-auto"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-400">
              <Sparkles size={12} /> SPEAX Tutorial
            </span>
            <button onClick={complete} className="rounded-md p-1 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Close tutorial">
              <X size={14} />
            </button>
          </div>
          <h4 className="text-sm font-semibold leading-tight text-white">{currentStep.title}</h4>
          <p className="mt-2 text-xs leading-relaxed text-gray-300">{currentStep.description}</p>
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-3">
            <div className="flex gap-1.5" aria-label={`Step ${currentIndex + 1} of ${steps.length}`}>
              {steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === currentIndex ? 'w-5 bg-blue-500' : 'w-1.5 bg-white/15'}`} />)}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={complete} className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-500 hover:text-white">Skip</button>
              {currentIndex > 0 && <button onClick={back} className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-300 hover:bg-white/10" aria-label="Previous step"><ChevronLeft size={14} /></button>}
              <button onClick={next} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-500">
                {currentIndex === steps.length - 1 ? 'Finish' : 'Next'} <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export function triggerTourRestart(view: 'main' | 'coach') {
  window.dispatchEvent(new CustomEvent(`speax-restart-tour-${view}`));
}
