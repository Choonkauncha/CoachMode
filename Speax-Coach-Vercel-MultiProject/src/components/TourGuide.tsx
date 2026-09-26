import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HelpCircle, ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react';

export interface TourStep {
  selector: string;
  title: string;
  description: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const MAIN_STEPS: TourStep[] = [];

const COACH_STEPS: TourStep[] = [
  {
    selector: '#context-status-widget',
    title: '1. Personalization Context',
    description: 'Verify your resume details, target job, and codebase ZIP files are loaded. The coach uses these to ask highly specific technical questions.',
    placement: 'top'
  },
  {
    selector: '#coach-orb',
    title: '2. Tap the Coach Orb',
    description: 'Click the glowing sphere to establish a real-time WebSocket connection to the Gemini Live API. Grant mic permissions when prompted.',
    placement: 'top'
  },
  {
    selector: '#coach-status-text',
    title: '3. Live Status Indicators',
    description: 'Watch the orb change states: breathing blue when listening, pulsing purple when thinking, and orange/rose when speaking. Speak at any time to interrupt!',
    placement: 'bottom'
  },
  {
    selector: '#transcript-log',
    title: '4. Dialogue History Feed',
    description: 'Review transcripts of both your spoken responses and the coach\'s live replies as you conduct the mock interview.',
    placement: 'left'
  }
];

interface TourGuideProps {
  view: 'main' | 'coach';
}

export function TourGuide({ view }: TourGuideProps) {
  const steps = view === 'main' ? MAIN_STEPS : COACH_STEPS;
  const storageKey = `speax-coach-tour-completed-${view}`;

  const [isActive, setIsActive] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const tooltipRef = useRef<HTMLDivElement>(null);

  // Check if tour has been completed before, or start it automatically
  useEffect(() => {
    const completed = localStorage.getItem(storageKey);
    if (!completed) {
      // Delay slightly to allow the DOM to fully render
      const timer = setTimeout(() => {
        setIsActive(true);
        setCurrentIndex(0);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [storageKey]);

  // Restart the tour handler (exposed via window event for button triggers)
  useEffect(() => {
    const restartEvent = `speax-restart-tour-${view}`;
    const handleRestart = () => {
      setIsActive(true);
      setCurrentIndex(0);
    };
    window.addEventListener(restartEvent, handleRestart);
    return () => window.removeEventListener(restartEvent, handleRestart);
  }, [view]);

  // Main positioning logic for active step target highlight & tooltip placement
  useEffect(() => {
    if (!isActive || currentIndex >= steps.length) {
      setCoords(null);
      setTooltipPos(null);
      return;
    }

    const updatePosition = () => {
      const step = steps[currentIndex];
      const element = document.querySelector(step.selector);

      if (!element) {
        // Fallback to center if element is not rendered or visible
        setCoords(null);
        const w = window.innerWidth;
        const h = window.innerHeight;
        const cardW = 320;
        const cardH = 200;
        setTooltipPos({
          top: h / 2 - cardH / 2,
          left: w / 2 - cardW / 2
        });
        return;
      }

      // 1. Get Target bounding box
      const rect = element.getBoundingClientRect();
      setCoords({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });

      // 2. Compute tooltip card coordinates
      const cardW = tooltipRef.current?.offsetWidth || 340;
      const cardH = tooltipRef.current?.offsetHeight || 190;
      const margin = 16; // space between target and tooltip

      let targetTop = rect.top + window.scrollY;
      let targetLeft = rect.left + window.scrollX;

      let calcTop = window.innerHeight / 2 - cardH / 2;
      let calcLeft = window.innerWidth / 2 - cardW / 2;

      switch (step.placement) {
        case 'top':
          calcTop = targetTop - cardH - margin;
          calcLeft = targetLeft + rect.width / 2 - cardW / 2;
          break;
        case 'bottom':
          calcTop = targetTop + rect.height + margin;
          calcLeft = targetLeft + rect.width / 2 - cardW / 2;
          break;
        case 'left':
          calcTop = targetTop + rect.height / 2 - cardH / 2;
          calcLeft = targetLeft - cardW - margin;
          break;
        case 'right':
          calcTop = targetTop + rect.height / 2 - cardH / 2;
          calcLeft = targetLeft + rect.width + margin;
          break;
        case 'center':
        default:
          break;
      }

      // 3. Bound within viewport margins
      const maxLeft = window.innerWidth - cardW - 16;
      const maxTop = window.innerHeight - cardH - 16;

      calcLeft = Math.max(16, Math.min(maxLeft, calcLeft));
      calcTop = Math.max(16, Math.min(maxTop, calcTop));

      setTooltipPos({ top: calcTop, left: calcLeft });
    };

    updatePosition();
    
    // Set a polling checker to handle dynamic resizing or layout reflows during the tour
    const interval = setInterval(updatePosition, 400);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
    };
  }, [isActive, currentIndex, steps]);

  const handleNext = () => {
    if (currentIndex < steps.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    setIsActive(false);
    localStorage.setItem(storageKey, 'true');
  };

  if (!isActive) return null;

  const currentStep = steps[currentIndex];

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden pointer-events-none select-none">
      {/* Semi-transparent dark backdrop overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleSkip}
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px] pointer-events-auto cursor-pointer"
      />

      {/* Target Focus Ring Overlay */}
      {coords && (
        <motion.div
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          className="fixed border-2 border-blue-500 rounded-xl pointer-events-none z-[201] shadow-[0_0_20px_rgba(59,130,246,0.35)]"
          style={{
            top: coords.top - 8,
            left: coords.left - 8,
            width: coords.width + 16,
            height: coords.height + 16,
          }}
        >
          {/* Subtle outer pulse effect */}
          <span className="absolute -inset-1 rounded-xl border border-blue-400/40 animate-ping opacity-60 pointer-events-none" />
        </motion.div>
      )}

      {/* Onboarding Tooltip Card */}
      {tooltipPos && (
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="fixed z-[202] w-[340px] bg-zinc-950/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] p-5 pointer-events-auto text-gray-200"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <span className="flex items-center gap-1.5 text-blue-400 text-xs font-bold uppercase tracking-wider">
              <Sparkles size={12} className="animate-pulse" />
              Quick Tour Guide
            </span>
            <button
              onClick={handleSkip}
              className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded-md hover:bg-white/5 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-1.5 mb-5">
            <h4 className="text-sm font-semibold text-white leading-tight">
              {currentStep.title}
            </h4>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              {currentStep.description}
            </p>
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-between border-t border-white/5 pt-3.5">
            {/* Step Indicators */}
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentIndex ? 'w-4 bg-blue-500' : 'w-1.5 bg-white/10'
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSkip}
                className="text-[10px] uppercase font-bold tracking-wider text-gray-500 hover:text-gray-300 px-2 py-1 rounded transition-colors cursor-pointer"
              >
                Skip
              </button>

              {currentIndex > 0 && (
                <button
                  onClick={handleBack}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 border border-white/5 text-gray-300 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={14} />
                </button>
              )}

              <button
                onClick={handleNext}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-900/20 transition-all cursor-pointer"
              >
                {currentIndex === steps.length - 1 ? 'Finish' : 'Next'}
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Utility function to restart tour from other components
export function triggerTourRestart(view: 'main' | 'coach') {
  window.dispatchEvent(new CustomEvent(`speax-restart-tour-${view}`));
}
