export function AgentToolsSkeleton() {
  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="px-4 md:px-12 pt-24 pb-4 animate-pulse">
        {/* Header skeleton */}
        <div className="h-8 bg-background-tint-02 rounded w-48 mb-1" />
        <div className="h-4 bg-background-tint-02 rounded w-80 mb-8" />

        {/* Local Tools section */}
        <section className="mb-8">
          <div className="h-6 bg-background-tint-02 rounded w-32 mb-1" />
          <div className="h-3 bg-background-tint-02 rounded w-40 mb-4" />

          {/* Tool cards skeleton */}
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-5 bg-background-tint-02 rounded w-32" />
                  <div className="h-4 bg-background-tint-02 rounded w-24" />
                </div>
                <div className="h-4 bg-background-tint-02 rounded w-full" />
                <div className="h-4 bg-background-tint-02 rounded w-3/4 mt-1" />
              </div>
            ))}
          </div>
        </section>

        {/* Remote Tools section */}
        <section>
          <div className="h-6 bg-background-tint-02 rounded w-36 mb-1" />
          <div className="h-3 bg-background-tint-02 rounded w-44 mb-4" />

          {/* Tool cards skeleton */}
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-5 bg-background-tint-02 rounded w-32" />
                  <div className="h-4 bg-background-tint-02 rounded w-24" />
                </div>
                <div className="h-4 bg-background-tint-02 rounded w-full" />
                <div className="h-4 bg-background-tint-02 rounded w-3/4 mt-1" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
