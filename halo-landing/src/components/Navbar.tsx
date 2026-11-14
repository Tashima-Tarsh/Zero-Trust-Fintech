import React from 'react';
import { LogoIcon } from './LogoIcon';

export const Navbar: React.FC = () => {
  return (
    <nav className="absolute top-0 left-0 right-0 z-20 px-6 py-5">
      <div className="max-w-[88rem] mx-auto flex items-center justify-between">
        {/* Left: Logo + Wordmark */}
        <a href="#" className="flex items-center gap-2.5 group">
          <LogoIcon className="w-7 h-7 text-black transition-transform duration-200 group-hover:scale-105" />
          <span className="text-2xl font-medium tracking-tight text-black">
            Halo
          </span>
        </a>

        {/* Center Links (hidden below md) */}
        <div className="hidden md:flex items-center gap-8">
          <a
            href="#network"
            className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
          >
            Network
          </a>
          <a
            href="#ecosystem"
            className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
          >
            Ecosystem
          </a>
          <a
            href="#rewards"
            className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
          >
            Rewards
          </a>
          <a
            href="#help"
            className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
          >
            Help
          </a>
          <a
            href="#news"
            className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
          >
            News
          </a>
        </div>

        {/* Right: Pill Button "Open Wallet" */}
        <button
          type="button"
          className="bg-black text-white text-base font-medium px-7 py-2.5 rounded-full hover:bg-gray-800 transition-colors duration-200"
        >
          Open Wallet
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
