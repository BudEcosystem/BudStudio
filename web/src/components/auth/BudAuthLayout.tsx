"use client";

import React, { ReactNode } from "react";
import GameOfLifeBackground from "./GameOfLifeBackground";
import {
  NEXT_PUBLIC_AUTH_LOGO_URL,
  NEXT_PUBLIC_AUTH_TAGLINE,
} from "@/lib/constants";

interface BudAuthLayoutProps {
  children: ReactNode;
  logoUrl?: string;
  tagline?: string;
}

const BudAuthLayout: React.FC<BudAuthLayoutProps> = ({
  children,
  logoUrl = NEXT_PUBLIC_AUTH_LOGO_URL,
  tagline = NEXT_PUBLIC_AUTH_TAGLINE,
}) => {
  return (
    <div className="w-full h-screen bg-[#0d0d0d] box-border relative">
      <div className="w-full h-full flex justify-between box-border">
        {/* Left Panel - Game of Life Background */}
        <div className="login-left-panel relative overflow-hidden rounded-[15px] w-[56.4%] m-[0.8rem] p-[0.8rem]">
          <GameOfLifeBackground />

          {/* Purple gradient overlays */}
          <div className="gol-overlay absolute inset-0 z-20 pointer-events-none" />

          <div className="relative z-30 w-full h-full">
            {/* Purple shadow decoration */}
            <div
              className="absolute bottom-[-28em] left-[-29em] rotate-[14deg] opacity-30 w-[600px] h-[600px]"
              style={{
                background: "radial-gradient(circle, rgba(150, 92, 222, 0.6) 0%, transparent 70%)",
              }}
            />

            <div className="flex flex-col justify-between w-full max-w-[500px] h-full px-14 pt-12 pb-12">
              {/* Logo */}
              <img
                alt="Logo"
                src={logoUrl}
                className="w-[100px] h-auto"
                onError={(e) => {
                  // Fallback if logo doesn't exist
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />

              {/* Tagline */}
              <div
                className="text-2xl xl:text-[2.5rem] text-white tracking-[0rem] leading-[3.1rem] w-[400px] xl:w-[500px]"
                style={{
                  background: "linear-gradient(253deg, #fff 19%, #fff 31.88%, #fff 70.09%, rgba(255, 255, 255, 0.39) 95.34%, #fff 111.89%)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {tagline}
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Form Content */}
        <div className="w-[43.6%] h-full flex flex-col justify-center items-center">
          {children}
        </div>
      </div>
    </div>
  );
};

export default BudAuthLayout;
