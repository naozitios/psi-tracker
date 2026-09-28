import { PsiApp } from '@/components/psi-app';
import { SiteHeader } from '@/components/site-header';

export default function Home() {
  return (
    <div className="relative isolate flex min-h-svh flex-col overflow-hidden">
      <SiteHeader />
      <h1 className="sr-only">Singapore PSI right now</h1>
      <PsiApp />
    </div>
  );
}
