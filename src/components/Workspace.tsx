import type { ReactNode } from 'react';

interface WorkspaceProps {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Consistent chrome for the standalone tool workspaces. */
export function Workspace({ title, subtitle, icon, actions, children }: WorkspaceProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 flex-shrink-0 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-xl leading-none">{icon}</span>}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-zinc-100 truncate">{title}</h1>
              {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </div>
  );
}

/** A dashed "coming soon / to be continued" panel used by roadmap features. */
export function ComingSoon({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-mono uppercase tracking-wider text-amber-400/90 bg-amber-400/10 px-2 py-0.5 rounded">
          To be continued
        </span>
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      </div>
      <div className="text-sm text-zinc-400 leading-relaxed space-y-2">{children}</div>
    </div>
  );
}
