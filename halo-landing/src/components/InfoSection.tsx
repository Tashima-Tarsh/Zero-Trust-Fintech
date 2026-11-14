import React from 'react';
import { ArrowRight } from 'lucide-react';

export const InfoSection: React.FC = () => {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24">
      <div className="max-w-[88rem] mx-auto">
        {/* Row 1: 2-col grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16 items-start">
          {/* Left Column */}
          <div>
            <h2
              className="text-black text-4xl md:text-5xl font-medium leading-tight mb-8"
              style={{ letterSpacing: '-0.03em' }}
            >
              Meet USD Halo.
            </h2>

            {/* Black pill "Discover it" button */}
            <button
              type="button"
              className="group inline-flex items-center gap-3 bg-black text-white text-base font-medium pl-6 pr-2 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200"
            >
              <span>Discover it</span>
              <div className="bg-white rounded-full p-2 group-hover:bg-white/90 transition-colors duration-200">
                <ArrowRight className="w-4 h-4 text-black" />
              </div>
            </button>
          </div>

          {/* Right Column */}
          <div>
            <p className="text-black/70 text-2xl md:text-3xl leading-relaxed font-normal">
              USD Halo is a reward-earning dollar coin that lets your savings grow while remaining tied to the U.S. dollar.
            </p>
          </div>
        </div>

        {/* Row 2 — 4-col card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Spans 2 cols on lg with Background Image */}
          <div
            className="lg:col-span-2 rounded-2xl p-7 min-h-80 flex flex-col justify-between relative overflow-hidden"
            style={{
              backgroundImage: `url("https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260423_164207_f243351d-ed59-48ec-83a0-a5e996bdbe3c.png&w=1280&q=85")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {/* Title (top) */}
            <h3
              className="text-black text-2xl font-medium leading-snug"
              style={{ letterSpacing: '-0.02em' }}
            >
              Savings that bloom
            </h3>

            {/* Body (bottom) */}
            <p className="text-black/70 text-base max-w-xs">
              Gain steady returns as your dollar tokens are routed into top-performing DeFi strategies.
            </p>
          </div>

          {/* Card 2: Solid #2B2644 */}
          <div
            className="rounded-2xl p-7 min-h-80 flex flex-col justify-between"
            style={{ backgroundColor: '#2B2644' }}
          >
            <h3
              className="text-white text-2xl font-medium leading-snug whitespace-pre-line"
              style={{ letterSpacing: '-0.02em' }}
            >
              {'Always fluid,\nalways pegged.'}
            </h3>

            <p className="text-white/60 text-base">
              Keep fully dollar-anchored with on-demand access to funds — no lockups or waits.
            </p>
          </div>

          {/* Card 3: Solid #2B2644 */}
          <div
            className="rounded-2xl p-7 min-h-80 flex flex-col justify-between"
            style={{ backgroundColor: '#2B2644' }}
          >
            <h3
              className="text-white text-2xl font-medium leading-snug whitespace-pre-line"
              style={{ letterSpacing: '-0.02em' }}
            >
              {'Fully\nautomated'}
            </h3>

            <p className="text-white/60 text-base">
              Skip the task of tuning positions yourself. USD Halo runs in the background for you.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default InfoSection;
