import React from 'react';
import { LumenIndex } from './components/LumenIndex';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { InfoSection } from './components/InfoSection';
import { BackedBySection } from './components/BackedBySection';
import { UseCasesSection } from './components/UseCasesSection';

export const App: React.FC = () => {
  const isHalo = typeof window !== 'undefined' && window.location.search.includes('view=halo');

  if (isHalo) {
    return (
      <div className="flex flex-col bg-[#F5F5F5] min-h-screen text-black">
        <div className="h-screen flex flex-col overflow-hidden relative">
          <Navbar />
          <HeroSection />
        </div>
        <InfoSection />
        <BackedBySection />
        <UseCasesSection />
      </div>
    );
  }

  // Pure single-screen LŪMEN // ÍNDEX component as specified
  return <LumenIndex />;
};

export default App;
