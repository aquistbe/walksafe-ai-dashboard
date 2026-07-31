export default function DataPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-walksafe-bg">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-walksafe-text">
            Data Downloads
          </h1>
          <p className="text-walksafe-text-muted mt-2 max-w-2xl">
            Download intersection-level pedestrian safety data in multiple
            formats for your own analysis.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-walksafe-orange/10 flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-walksafe-orange"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-walksafe-text">
            Coming Soon
          </h2>
          <p className="text-sm text-walksafe-text-muted mt-1">
            Data download links will be available here.
          </p>
        </div>

        {/* Attribution is visible rather than buried: the dashboard
            republishes municipal open data, so the sources are credited on
            the page that offers it for download. */}
        <section className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-walksafe-text mb-3">
            Sources and attribution
          </h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-walksafe-text">Philadelphia</dt>
              <dd className="text-walksafe-text-muted mt-0.5 leading-relaxed">
                PennDOT PCDS crash records 2015&ndash;2024; DVRPC and PennDOT
                traffic volumes; City of Philadelphia GIS for street
                centerlines, nodes, the High Injury Network, schools and parks.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-walksafe-text">Bogot&aacute;</dt>
              <dd className="text-walksafe-text-muted mt-0.5 leading-relaxed">
                Source: City of Bogot&aacute; open data; processing by
                Universidad de los Andes.
              </dd>
            </div>
          </dl>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed">
            Derived layers are produced by the WalkSafe-AI pipeline in this
            repository. Risk estimates for different cities and analysis units
            are not numerically comparable &mdash; each uses its own crash
            definition, exposure measure and model.
          </p>
        </section>
      </div>
    </div>
  );
}
