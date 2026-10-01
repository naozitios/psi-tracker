import type { ReactNode } from 'react';

type AppShellProps = {
  hero: ReactNode;
  controls?: ReactNode;
  busy?: boolean;
};

// Every state renders through this shell so the turbine keeps spinning across state changes.
export function AppShell({ hero, controls, busy = false }: AppShellProps) {
  return (
    <main
      aria-busy={busy}
      className="relative z-0 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-4 sm:px-8"
    >
      <div className="relative flex w-full flex-1 flex-col items-center justify-center py-10">
        <div aria-hidden="true" className="turbine -z-10" />
        <div
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 -z-10 size-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,#000_62%,transparent)]"
        />
        {hero}
      </div>
      <div className="w-full max-w-xl">
        {controls}
        <footer className="mt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] text-center text-xs leading-relaxed text-faint">
          Data from the National Environment Agency via data.gov.sg. The 24-hour PSI updates hourly.
        </footer>
      </div>
    </main>
  );
}
