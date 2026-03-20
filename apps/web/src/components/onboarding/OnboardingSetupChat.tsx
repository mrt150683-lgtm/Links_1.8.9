/**
 * OnboardingSetupChat — conversational wizard for pot setup
 *
 * State machine: idle → goal → role → search_targets → complete
 * Renders as a chat-style flow. Resumes from saved state_json.
 */

import { useState, useEffect, useRef } from 'react';
import './OnboardingSetupChat.css';

interface OnboardingState {
  pot_id: string;
  completed_at: number | null;
  goal_text: string | null;
  role_ref: string | null;
  search_targets: string[];
  state: {
    step?: string;
    goal?: string;
    role?: string;
  };
}

type WizardStep = 'loading' | 'goal' | 'role' | 'search_targets' | 'completing' | 'done';

interface Message {
  role: 'assistant' | 'user';
  text: string;
}

interface SearchTarget {
  id: string;
  label: string;
  category: string;
}

const API_BASE = '/api';

const FALLBACK_TARGETS: SearchTarget[] = [
  { id: 'google', label: 'Google', category: 'general' },
  { id: 'duckduckgo', label: 'DuckDuckGo', category: 'general' },
  { id: 'bing', label: 'Bing', category: 'general' },
  { id: 'github', label: 'GitHub', category: 'code' },
  { id: 'stackoverflow', label: 'Stack Overflow', category: 'code' },
  { id: 'arxiv', label: 'arXiv', category: 'academic' },
  { id: 'pubmed', label: 'PubMed', category: 'academic' },
  { id: 'wikipedia', label: 'Wikipedia', category: 'reference' },
  { id: 'youtube', label: 'YouTube', category: 'media' },
  { id: 'reddit', label: 'Reddit', category: 'community' },
];

interface OnboardingSetupChatProps {
  potId: string;
  potName: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingSetupChat({ potId, potName, onComplete, onSkip }: OnboardingSetupChatProps) {
  const [step, setStep] = useState<WizardStep>('loading');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [goalText, setGoalText] = useState('');
  const [roleRef, setRoleRef] = useState('');
  const [searchTargets, setSearchTargets] = useState<string[]>([]);
  const [availableTargets, setAvailableTargets] = useState<SearchTarget[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load onboarding state + search targets
  useEffect(() => {
    (async () => {
      const [onboardingResult, targetsResult] = await Promise.allSettled([
        fetch(`${API_BASE}/pots/${potId}/onboarding`).then((r) => r.json() as Promise<OnboardingState>),
        fetch(`${API_BASE}/search-targets`).then((r) => r.json() as Promise<{ targets: SearchTarget[] }>),
      ]);

      const onboarding: OnboardingState = onboardingResult.status === 'fulfilled'
        ? onboardingResult.value
        : { pot_id: potId, completed_at: null, goal_text: null, role_ref: null, search_targets: [], state: {} };

      const targets: SearchTarget[] =
        targetsResult.status === 'fulfilled' && targetsResult.value.targets?.length
          ? targetsResult.value.targets
          : FALLBACK_TARGETS;

      setAvailableTargets(targets);

      // Resume from saved state
      const savedStep = onboarding.state?.step as WizardStep | undefined;
      const savedGoal = onboarding.state?.goal ?? onboarding.goal_text ?? '';

      if (savedGoal) setGoalText(savedGoal);
      if (onboarding.role_ref) setRoleRef(onboarding.role_ref);
      if (onboarding.search_targets?.length) setSearchTargets(onboarding.search_targets);

      const resumeStep = savedStep ?? 'goal';
      startStep(resumeStep, savedGoal);
    })();
  }, [potId]);

  function addMessage(role: 'assistant' | 'user', text: string) {
    setMessages((m) => [...m, { role, text }]);
  }

  function startStep(s: WizardStep, existingGoal = '') {
    setStep(s);
    switch (s) {
      case 'goal':
        addMessage('assistant',
          `Hi! Let's set up "${potName}". What is the main goal or research topic for this pot? ` +
          `(e.g. "Investigate AI safety research", "Track news about renewable energy")`
        );
        if (existingGoal) setInputValue(existingGoal);
        break;
      case 'role':
        addMessage('assistant',
          `Got it! Now, choose an agent role for this pot. ` +
          `The role shapes how the AI approaches your research.`
        );
        break;
      case 'search_targets':
        addMessage('assistant',
          `Almost done! Which search engines should the "Search" action use for this pot? ` +
          `Select any that are relevant, or click "Complete Setup" to skip this step.`
        );
        break;
      case 'done':
        addMessage('assistant', `Setup complete! Your pot is ready. Insights will start appearing as you add entries.`);
        break;
    }
  }

  async function saveState(updates: { step?: string; goal?: string; role?: string }) {
    await fetch(`${API_BASE}/pots/${potId}/onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: { step: step, goal: goalText, role: roleRef, ...updates },
      }),
    }).catch(() => {/* ignore save errors */});
  }

  async function handleGoalSubmit() {
    if (!inputValue.trim()) return;
    const goal = inputValue.trim();
    setGoalText(goal);
    addMessage('user', goal);
    setInputValue('');
    await saveState({ step: 'role', goal });
    startStep('role');
  }

  async function handleRoleSelect(role: string, label: string) {
    setRoleRef(role);
    addMessage('user', label);
    await saveState({ step: 'search_targets', role });
    startStep('search_targets');
  }

  function toggleTarget(id: string) {
    setSearchTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleComplete() {
    setSubmitting(true);
    setStep('completing');
    addMessage('user', `Selected ${searchTargets.length} search engine(s).`);

    try {
      const res = await fetch(`${API_BASE}/pots/${potId}/onboarding/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_text: goalText,
          role_ref: roleRef || undefined,
          search_targets: searchTargets,
        }),
      });
      if (!res.ok) {
        let errMsg = `Server error ${res.status}`;
        try { const b = await res.json(); errMsg = b.message ?? errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      startStep('done');
      setTimeout(() => onComplete(), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage('assistant', `Something went wrong: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (step === 'goal') handleGoalSubmit();
    }
  }

  const showInput = step === 'goal';
  const showRoles = step === 'role';
  const showTargets = step === 'search_targets';

  const PREDEFINED_ROLES = [
    { value: '', label: 'Default (general research)' },
    { value: 'builtin:forensic_analyst', label: 'Forensic Analyst' },
    { value: 'builtin:research_assistant', label: 'Research Assistant' },
  ];

  return (
    <div className="onboarding-chat">
      <div className="onboarding-chat__header">
        <span className="onboarding-chat__title">Set Up "{potName}"</span>
        <button className="onboarding-chat__skip" onClick={onSkip}>Skip setup</button>
      </div>

      <div className="onboarding-chat__messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`onboarding-chat__msg onboarding-chat__msg--${msg.role}`}
          >
            {msg.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {showRoles && (
        <div className="onboarding-chat__targets">
          {PREDEFINED_ROLES.map((r) => (
            <button
              key={r.value || 'default'}
              className={`onboarding-chat__target ${roleRef === r.value ? 'onboarding-chat__target--selected' : ''}`}
              onClick={() => handleRoleSelect(r.value, r.label)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {showTargets && (
        <div className="onboarding-chat__targets">
          {availableTargets.map((t) => (
            <button
              key={t.id}
              className={`onboarding-chat__target ${searchTargets.includes(t.id) ? 'onboarding-chat__target--selected' : ''}`}
              onClick={() => toggleTarget(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            className="onboarding-chat__done-btn"
            onClick={handleComplete}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Complete Setup'}
          </button>
        </div>
      )}

      {showInput && (
        <div className="onboarding-chat__input-row">
          <input
            className="onboarding-chat__input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your research goal..."
            autoFocus
          />
          <button
            className="onboarding-chat__send"
            onClick={handleGoalSubmit}
            disabled={submitting}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
