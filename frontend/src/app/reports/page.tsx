export default function ReportsPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-walksafe-bg">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-walksafe-text">
            City Reports
          </h1>
          <p className="text-walksafe-text-muted mt-2 max-w-2xl">
            Comprehensive pedestrian safety reports for Philadelphia, including
            annual summaries, corridor analyses, and equity assessments.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-walksafe-green/10 flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-walksafe-green"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-walksafe-text">
            Coming Soon
          </h2>
          <p className="text-sm text-walksafe-text-muted mt-1">
            City-level safety reports are under development.
          </p>
        </div>
      </div>
    </div>
  );
}
