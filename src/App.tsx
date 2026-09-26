import { useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
import { FileText, BriefcaseBusiness, Code2, Upload, Trash2, ArrowRight, Loader2, Sparkles, HelpCircle } from 'lucide-react';
import { CoachMode } from './components/CoachMode';
import { TourGuide, triggerTourRestart } from './components/TourGuide';
import { extractTextFromPDF } from './lib/pdfUtil';
import { extractProjectFromZip, ProjectMeta } from './lib/zipUtil';

type ProjectEntry = ProjectMeta & { context: string };
type ContextState = { jobDetails: string; candidateInfo: string; projects: ProjectEntry[] };

const KEYS = { job:'coach-job', candidate:'coach-candidate', projects:'coach-projects', project:'coach-project', meta:'coach-project-meta', screen:'coach-screen' };

export default function App() {
  const [context, setContext] = useState<ContextState>({ jobDetails:'', candidateInfo:'', projects:[] });
  const [loaded, setLoaded] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [busy, setBusy] = useState<'resume'|'job'|'project'|null>(null);
  const resumeRef = useRef<HTMLInputElement>(null), jobRef = useRef<HTMLInputElement>(null), projectRef = useRef<HTMLInputElement>(null);

  useEffect(() => { (async()=>{
    const [job,candidate,projects,legacyProject,legacyMeta,savedCoachOpen] = await Promise.all([
      localforage.getItem<string>(KEYS.job),
      localforage.getItem<string>(KEYS.candidate),
      localforage.getItem<ProjectEntry[]>(KEYS.projects),
      localforage.getItem<string>(KEYS.project),
      localforage.getItem<ProjectMeta>(KEYS.meta),
      localforage.getItem<boolean>(KEYS.screen)
    ]);
    const restored = projects?.length ? projects : (legacyProject && legacyMeta ? [{...legacyMeta, context: legacyProject}] : []);
    setContext({jobDetails:job||'',candidateInfo:candidate||'',projects:restored}); setCoachOpen(savedCoachOpen ?? false); setLoaded(true);
  })(); },[]);

  useEffect(() => { if(loaded) Promise.all([localforage.setItem(KEYS.job,context.jobDetails),localforage.setItem(KEYS.candidate,context.candidateInfo),localforage.setItem(KEYS.projects,context.projects)]); },[context,loaded]);

  const loadPdf = async (kind:'resume'|'job', file?:File) => {
    if(!file) return; setBusy(kind);
    try { const text=await extractTextFromPDF(file); setContext(c=>({...c,[kind==='resume'?'candidateInfo':'jobDetails']:text})); }
    catch(e){ alert(e instanceof Error?e.message:'Failed to extract PDF.'); } finally { setBusy(null); }
  };
  const loadZip = async(fileList?:FileList|null) => {
    const files = Array.from(fileList || []);
    if(!files.length) return;
    setBusy('project');
    try {
      const existing = new Set(context.projects.map(p => p.fileName));
      const added: ProjectEntry[] = [];
      for (const file of files) {
        if (existing.has(file.name)) continue;
        const r = await extractProjectFromZip(file);
        added.push({...r.meta, context:r.context});
      }
      if (added.length) setContext(c=>({...c, projects:[...c.projects, ...added]}));
    } catch(e){ alert(e instanceof Error?e.message:'Failed to extract ZIP.'); } finally { setBusy(null); if(projectRef.current) projectRef.current.value=''; }
  };
  const clear = (key:keyof ContextState) => {
    if (key === 'projects') setContext(c=>({...c,projects:[]}));
    else setContext(c=>({...c,[key]:''}));
  };
  const removeProject = (id:string) => setContext(c=>({...c,projects:c.projects.filter(p=>p.id!==id)}));
  const projectContext = useMemo(() => context.projects.map((p,i)=>`\n\n===== PROJECT ${i+1}: ${p.fileName} =====\n${p.context}`).join('\n'),[context.projects]);
  const readiness = useMemo(()=>({resume:!!context.candidateInfo.trim(),job:!!context.jobDetails.trim(),project:context.projects.length>0}),[context]);
  const openCoach = () => { setCoachOpen(true); localforage.setItem(KEYS.screen,true).catch(error=>console.error('Failed to save current screen:',error)); };
  const returnToSetup = () => { setCoachOpen(false); localforage.setItem(KEYS.screen,false).catch(error=>console.error('Failed to save current screen:',error)); };

  if(!loaded) return <main className="flex h-screen items-center justify-center bg-[#08090d] text-sm text-gray-400">Restoring your workspace…</main>;
  if(coachOpen) return <CoachMode jobDetails={context.jobDetails} candidateInfo={context.candidateInfo} projectContext={projectContext} onBack={returnToSetup} onSessionActiveChange={()=>{}} />;

  return <main className="h-screen overflow-y-auto bg-[#070708] text-gray-200 px-4 md:px-6">
    <div className="mx-auto max-w-6xl">
      <header id="main-header" className="sticky top-0 z-20 -mx-4 mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-[#0A0A0C]/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6"><div><div className="flex items-center gap-2 text-base font-semibold"><Sparkles size={18} className="text-blue-400"/> SPEAX Coach</div><p className="mt-1 text-xs text-gray-500">Interview setup</p></div><div className="flex items-center gap-2"><button id="main-tutorial" onClick={()=>triggerTourRestart('main')} className="inline-flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white"><HelpCircle size={14}/> Tutorial</button><button id="main-start-coach" onClick={openCoach} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Open Coach <ArrowRight size={15} className="ml-1 inline"/></button></div></header>
      <section className="mb-6"><div className="mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-500">Session Setup</div><h1 className="text-lg font-semibold text-gray-100">Interview context</h1><p className="mt-1 text-sm text-gray-500">Add a role, background, or project. Coach will use these details to tailor your interview.</p></section>
      <div className="grid gap-4 md:grid-cols-3">
        <div id="resume-card"><ContextCard icon={<FileText/>} title="Your Background" subtitle="Resume / CV PDF" loaded={readiness.resume} busy={busy==='resume'} onUpload={()=>resumeRef.current?.click()} onClear={()=>clear('candidateInfo')} detail={readiness.resume?'Resume text extracted and ready.':'Upload a PDF'} /></div>
        <div id="job-card"><ContextCard icon={<BriefcaseBusiness/>} title="Target Role" subtitle="Job description PDF or text" loaded={readiness.job} busy={busy==='job'} onUpload={()=>jobRef.current?.click()} onClear={()=>clear('jobDetails')} detail={readiness.job?'Job requirements loaded.':'Upload a PDF or paste below'} /></div>
        <div id="projects-card"><ContextCard icon={<Code2/>} title="Technical Background" subtitle="Project / code ZIP" loaded={readiness.project} busy={busy==='project'} onUpload={()=>projectRef.current?.click()} onClear={()=>clear('projects')} detail={context.projects.length ? `${context.projects.length} project${context.projects.length===1?'':'s'} loaded.` : 'Upload one or more ZIPs'} /></div>
      </div>
      <input ref={resumeRef} hidden type="file" accept="application/pdf" onChange={e=>loadPdf('resume',e.target.files?.[0])}/>
      <input ref={jobRef} hidden type="file" accept="application/pdf" onChange={e=>loadPdf('job',e.target.files?.[0])}/>
      <input ref={projectRef} hidden multiple type="file" accept=".zip,application/zip" onChange={e=>loadZip(e.target.files)}/>
      {context.projects.length > 0 && <section className="mt-4 rounded-xl border border-white/5 bg-[#0F0F12] p-4"><div className="mb-3 flex items-center justify-between"><div><div className="text-sm font-medium">Loaded projects</div><div className="text-xs text-gray-500">Each ZIP stays separate and is included as its own evidence source.</div></div><button onClick={()=>clear('projects')} className="text-xs text-gray-500 hover:text-white">Clear all</button></div><div className="grid gap-2 md:grid-cols-2">{context.projects.map(p=><div key={p.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-[#0A0A0C] px-3 py-2.5"><div className="min-w-0"><div className="truncate text-sm">{p.fileName}</div><div className="text-xs text-gray-500">{p.fileCount} source files · {Math.round(p.totalChars/1000)}k chars</div></div><button onClick={()=>removeProject(p.id)} title={`Remove ${p.fileName}`} className="ml-3 shrink-0 text-gray-500 hover:text-white"><Trash2 size={14}/></button></div>)}</div></section>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-400">Job description<textarea value={context.jobDetails} onChange={e=>setContext(c=>({...c,jobDetails:e.target.value}))} placeholder="Paste the job description here…" className="min-h-44 rounded-xl border border-white/5 bg-[#0A0A0C] p-4 text-sm font-normal text-gray-200 outline-none placeholder:text-gray-600 focus:border-blue-400/50" /></label>
        <label className="flex flex-col gap-2 text-xs font-semibold text-gray-400">Your background<textarea value={context.candidateInfo} onChange={e=>setContext(c=>({...c,candidateInfo:e.target.value}))} placeholder="Paste your resume or professional background here…" className="min-h-44 rounded-xl border border-white/5 bg-[#0A0A0C] p-4 text-sm font-normal text-gray-200 outline-none placeholder:text-gray-600 focus:border-blue-400/50" /></label>
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-[#0F0F12] p-4"><div><div className="text-sm font-semibold text-gray-200">{readiness.resume || readiness.job || readiness.project ? 'Context ready' : 'Ready when you are'}</div><div className="mt-1 text-xs text-gray-500">{[readiness.resume&&'background',readiness.job&&'target role',readiness.project&&'technical projects'].filter(Boolean).join(' · ')||(loaded?'No context uploaded. Coach will ask about your target role and background.':'Restoring saved context…')}</div></div><button onClick={openCoach} className="shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Start Coach <ArrowRight size={15} className="ml-1 inline"/></button></div>
      <TourGuide view="main" />
    </div>
  </main>;
}

function ContextCard({icon,title,subtitle,loaded,busy,onUpload,onClear,detail}:{icon:React.ReactNode;title:string;subtitle:string;loaded:boolean;busy:boolean;onUpload:()=>void;onClear:()=>void;detail:string}){return <div className="rounded-xl border border-white/5 bg-[#0F0F12] p-4"><div className="mb-4 flex items-start justify-between"><div className="rounded-lg border border-blue-400/10 bg-blue-500/10 p-2 text-blue-300">{icon}</div>{loaded&&<button onClick={onClear} title="Clear" aria-label={`Clear ${title}`} className="rounded-md p-1 text-gray-500 hover:bg-white/5 hover:text-white"><Trash2 size={15}/></button>}</div><h2 className="text-sm font-semibold text-gray-200">{title}</h2><p className="mt-1 text-xs text-gray-500">{subtitle}</p><p className="mt-3 min-h-8 text-xs text-gray-400">{detail}</p><button onClick={onUpload} disabled={busy} className="mt-3 w-full rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-50">{busy?<Loader2 size={15} className="mr-2 inline animate-spin"/>:<Upload size={15} className="mr-2 inline"/>}{busy?'Extracting…':'Upload'}</button></div>}
