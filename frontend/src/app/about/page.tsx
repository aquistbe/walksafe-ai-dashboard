export default function AboutPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-walksafe-bg">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-walksafe-text mb-6">
          About WalkSafe-AI
        </h1>

        <div className="space-y-6">
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-walksafe-text mb-3">
              Project Overview
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              WalkSafe-AI is a data-driven pedestrian safety platform that
              identifies and ranks dangerous intersections using empirical Bayes
              analysis of crash data. The project combines PennDOT crash
              records, DVRPC traffic volumes, and City of Philadelphia GIS data
              to produce reliable risk estimates for over 16,000 intersections.
            </p>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-walksafe-text mb-3">
              Methodology
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              The core ranking uses an empirical Bayes (EB) approach that
              combines an intersection&apos;s observed crash history with a
              safety performance function (SPF) fitted to similar
              intersections. This reduces the influence of random year-to-year
              variation and produces more stable, reliable risk estimates than
              raw crash counts alone.
            </p>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-walksafe-text mb-3">
              Data Sources
            </h2>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-walksafe-green font-bold mt-0.5">-</span>
                <span>
                  <strong>PennDOT PCDS:</strong> Pennsylvania crash data system
                  covering pedestrian-involved crashes from 2015 through 2024.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-walksafe-green font-bold mt-0.5">-</span>
                <span>
                  <strong>DVRPC AADT:</strong> Annual average daily traffic
                  volume estimates from the Delaware Valley Regional Planning
                  Commission.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-walksafe-green font-bold mt-0.5">-</span>
                <span>
                  <strong>City of Philadelphia GIS:</strong> High Injury
                  Network, speed camera locations, street classifications,
                  parks, and school locations.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-walksafe-green font-bold mt-0.5">-</span>
                <span>
                  <strong>City of Bogot&aacute; open data:</strong> street
                  segments, transport analysis zones, crash records and
                  built-environment attributes. Processing by Universidad de
                  los Andes under subcontract to the WalkSafe-AI project.
                </span>
              </li>
            </ul>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-walksafe-text mb-3">
              Team
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              WalkSafe-AI is developed at Drexel University as part of a
              research initiative on pedestrian safety and urban infrastructure
              analytics.
            </p>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-walksafe-text mb-3">
              Contact
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              For questions, data requests, or collaboration inquiries, please
              contact the project team at Drexel University.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
