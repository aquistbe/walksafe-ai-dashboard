export default function EquityPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-walksafe-bg">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-walksafe-text">
            Equity Dashboard
          </h1>
          <p className="text-walksafe-text-muted mt-2 max-w-2xl">
            Explore how pedestrian safety risk intersects with socioeconomic
            factors, environmental justice areas, and historically underserved
            communities.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-walksafe-blue/10 flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-walksafe-blue"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-walksafe-text">
            Coming Soon
          </h2>
          <p className="text-sm text-walksafe-text-muted mt-1">
            Equity analysis features are under development.
          </p>
        </div>
      </div>
    </div>
  );
}
