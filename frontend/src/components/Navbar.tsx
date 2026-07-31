"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, PLANNED_CITIES } from "@/lib/constants";
import { CITY_LIST } from "@/lib/cities";
import { useCity } from "@/lib/cityContext";

export default function Navbar() {
  const pathname = usePathname();
  const { cityId: selectedCity, setCityId: setSelectedCity } = useCity();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-walksafe-nav text-white h-14 shadow-lg">
      <div className="h-full flex items-center px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-8 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-walksafe-green flex items-center justify-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white"
            >
              <circle cx="12" cy="5" r="2" />
              <path d="M10 22V18L7 15V11L10 9H14L17 11V15L14 18V22" />
            </svg>
          </div>
          <span className="font-bold text-lg tracking-tight">
            WalkSafe<span className="text-walksafe-green">-AI</span>
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-1 flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-gray-300 hover:text-white hover:bg-white/10"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* City Selector */}
        <div className="hidden md:flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-400 uppercase tracking-wider mr-1">
            City
          </span>
          {CITY_LIST.map((city) => (
            <button
              key={city.id}
              onClick={() => setSelectedCity(city.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedCity === city.id
                  ? "bg-walksafe-green text-white"
                  : "bg-white/10 text-gray-300 hover:bg-white/20"
              }`}
              title={`${city.label} — ${city.maturityLabel}. ${city.maturityNote}`}
            >
              {city.label}
              {/* The two cities are at very different stages. Saying so here
                  stops the switcher from implying they are equivalent. */}
              <span
                className={`ml-1.5 text-[9px] uppercase tracking-wide ${
                  selectedCity === city.id ? "text-white/70" : "text-gray-500"
                }`}
              >
                {city.maturity === "demonstrated" ? "demo" : "phase 0"}
              </span>
            </button>
          ))}
          {PLANNED_CITIES.map((city) => (
            <button
              key={city.label}
              disabled
              className="px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-gray-500 cursor-not-allowed"
              title={`${city.label} — ${city.note}`}
            >
              {city.label}
              <span className="ml-1 text-[10px] text-gray-500">soon</span>
            </button>
          ))}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden ml-auto p-2 rounded-md hover:bg-white/10"
          aria-label="Toggle menu"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {mobileMenuOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-walksafe-nav border-t border-white/10 px-4 py-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-gray-300 hover:text-white hover:bg-white/10"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {/* City selector in mobile */}
          <div className="pt-2 border-t border-white/10 mt-2">
            <span className="block text-xs text-gray-400 uppercase tracking-wider px-3 mb-1">
              City
            </span>
            <div className="flex flex-wrap gap-2 px-3">
              {CITY_LIST.map((city) => (
                <button
                  key={city.id}
                  onClick={() => {
                    setSelectedCity(city.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    selectedCity === city.id
                      ? "bg-walksafe-green text-white"
                      : "bg-white/10 text-gray-300"
                  }`}
                >
                  {city.label}
                </button>
              ))}
              {PLANNED_CITIES.map((city) => (
                <button
                  key={city.label}
                  disabled
                  className="px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-gray-500 cursor-not-allowed"
                >
                  {city.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
