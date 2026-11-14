import React from 'react';

interface BackerBrand {
  name: string;
  style: React.CSSProperties;
}

const BACKER_BRANDS: BackerBrand[] = [
  {
    name: 'Fundamental Labs',
    style: {
      fontFamily: '"Times New Roman", Times, serif',
      fontWeight: 400,
      letterSpacing: '0.02em',
      fontSize: '14px',
    },
  },
  {
    name: 'KUCOIN',
    style: {
      fontFamily: '"Arial Black", Arial, sans-serif',
      fontWeight: 900,
      letterSpacing: '0.08em',
      fontSize: '16px',
    },
  },
  {
    name: 'NGC',
    style: {
      fontFamily: 'Impact, sans-serif',
      fontWeight: 700,
      letterSpacing: '0.05em',
      fontSize: '18px',
    },
  },
  {
    name: 'NxGen',
    style: {
      fontFamily: 'Georgia, serif',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      fontSize: '17px',
    },
  },
  {
    name: 'Matter Labs',
    style: {
      fontFamily: 'Helvetica, Arial, sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.01em',
      fontSize: '15px',
    },
  },
  {
    name: 'DEXTools',
    style: {
      fontFamily: 'Verdana, sans-serif',
      fontWeight: 700,
      letterSpacing: '0.06em',
      fontSize: '14px',
      textTransform: 'uppercase',
    },
  },
  {
    name: 'NGRAVE',
    style: {
      fontFamily: '"Courier New", monospace',
      fontWeight: 700,
      letterSpacing: '0.18em',
      fontSize: '14px',
    },
  },
  {
    name: 'Polychain',
    style: {
      fontFamily: 'Palatino, "Book Antiqua", serif',
      fontWeight: 500,
      letterSpacing: '0.03em',
      fontSize: '15px',
    },
  },
];

export const BackedBySection: React.FC = () => {
  return (
    <section className="bg-[#F5F5F5] px-6 py-12 md:py-16">
      <style>{`
        @keyframes backers-marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .backers-track {
          display: flex;
          width: max-content;
          animation: backers-marquee 30s linear infinite;
        }
        .backers-track:hover {
          animation-play-state: paused;
        }
      `}</style>

      <div className="max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
        {/* Left column (1/4) */}
        <div className="md:col-span-1 text-black/70 text-base leading-relaxed whitespace-pre-line">
          {'Funded by premier partners\nand forward-thinking leaders.'}
        </div>

        {/* Right column (3/4): Infinite Marquee */}
        <div className="md:col-span-3 overflow-hidden">
          <div className="backers-track">
            {/* Render 1st set */}
            {BACKER_BRANDS.map((brand, idx) => (
              <div
                key={`backer-1-${idx}`}
                className="mx-10 shrink-0 text-black/50 whitespace-nowrap"
                style={brand.style}
              >
                {brand.name}
              </div>
            ))}
            {/* Render 2nd set for seamless infinite loop */}
            {BACKER_BRANDS.map((brand, idx) => (
              <div
                key={`backer-2-${idx}`}
                className="mx-10 shrink-0 text-black/50 whitespace-nowrap"
                style={brand.style}
              >
                {brand.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default BackedBySection;
